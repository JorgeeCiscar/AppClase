import { BrowserWindow, app, dialog, ipcMain, type OpenDialogOptions } from 'electron'
import { isAbsolute, join } from 'node:path'
import type { SQLInputValue } from 'node:sqlite'
import type {
  FileSection, Item, ItemFilter, ItemInput, Opener, Settings, Stats, Subject, SubjectInput, Unit, UnitInput
} from '../shared/types'
import { ITEM_KINDS, STATUSES } from '../shared/types'
import { DAW1_SUBJECTS, seedSubjects, transaction, type DB } from './db'
import {
  addPaths, chooseFiles, chooseFolder, openFile, openWith, relocate, removeItem, revalidate, reveal, searchContent
} from './files'
import { cancelRead, downloadFiles, logoutPlatform, readActivity, readCourse } from './importer'
import { syncWatchers } from './watcher'
import { findUnit } from '../shared/match'

const SEP = String.fromCharCode(31) // separador para group_concat de etiquetas

const SUBJECT_SELECT = `
  SELECT s.*,
    (SELECT COUNT(*) FROM items i WHERE i.subject_id = s.id) AS item_count,
    (SELECT COUNT(*) FROM items i WHERE i.subject_id = s.id AND i.status IN ('pendiente', 'en curso')) AS pending_count,
    (SELECT COUNT(*) FROM files f JOIN items i ON i.id = f.item_id WHERE i.subject_id = s.id) AS file_count
  FROM subjects s`

const ITEM_SELECT = `
  SELECT i.*, s.name AS subject_name, s.color AS subject_color,
    u.title AS unit_title, u.number AS unit_number,
    (SELECT COUNT(*) FROM files f WHERE f.item_id = i.id) AS file_count,
    (SELECT COUNT(*) FROM files f WHERE f.item_id = i.id AND f.missing = 1) AS missing_count,
    (SELECT group_concat(t.tag, char(31)) FROM item_tags t WHERE t.item_id = i.id) AS tags_raw
  FROM items i
  JOIN subjects s ON s.id = i.subject_id
  LEFT JOIN units u ON u.id = i.unit_id`

type Row = Record<string, unknown>

/** Convierte la columna tags_raw en un array ordenado. */
function withTags<T>(row: Row | undefined): T {
  if (!row) return row as T
  const { tags_raw, ...rest } = row
  return {
    ...rest,
    tags: tags_raw ? String(tags_raw).split(SEP).sort((a, b) => a.localeCompare(b, 'es')) : []
  } as T
}

const nullIfEmpty = (v: unknown): string | null => {
  if (v === undefined || v === null) return null
  const t = String(v).trim()
  return t === '' ? null : t
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const checkDate = (v: unknown, label: string): string | null => {
  const d = nullIfEmpty(v)
  if (d && !DATE_RE.test(d)) throw new Error(`${label} no es una fecha válida (usa AAAA-MM-DD)`)
  return d
}

const normalizeTag = (t: string): string => t.trim().replace(/\s+/g, ' ')

// ---------------------------------------------------------------- asignaturas

export function saveSubject(db: DB, s: SubjectInput): Subject {
  const name = nullIfEmpty(s.name)
  if (!name) throw new Error('El nombre de la asignatura es obligatorio')
  const dup = db
    .prepare('SELECT id FROM subjects WHERE name = ? COLLATE NOCASE AND id IS NOT ?')
    .get(name, s.id ?? null)
  if (dup) throw new Error('Ya tienes una asignatura con ese nombre')
  const fields: Record<string, SQLInputValue> = {
    name,
    short_name: nullIfEmpty(s.short_name),
    color: nullIfEmpty(s.color),
    teacher: nullIfEmpty(s.teacher)
  }
  let id = s.id
  if (id) {
    db.prepare('UPDATE subjects SET name = ?, short_name = ?, color = ?, teacher = ? WHERE id = ?').run(
      fields.name, fields.short_name, fields.color, fields.teacher, id
    )
  } else {
    const { next } = db.prepare('SELECT COALESCE(MAX(position) + 1, 0) AS next FROM subjects').get() as { next: number }
    const res = db
      .prepare('INSERT INTO subjects (name, short_name, color, teacher, position) VALUES (?, ?, ?, ?, ?)')
      .run(fields.name, fields.short_name, fields.color, fields.teacher, next)
    id = Number(res.lastInsertRowid)
  }
  return db.prepare(`${SUBJECT_SELECT} WHERE s.id = ?`).get(id) as unknown as Subject
}

// ------------------------------------------------------------------- unidades

export function saveUnit(db: DB, u: UnitInput): Unit {
  const title = nullIfEmpty(u.title)
  if (!title) throw new Error('El título de la unidad es obligatorio')
  if (!db.prepare('SELECT id FROM subjects WHERE id = ?').get(u.subject_id)) {
    throw new Error('La asignatura no existe')
  }
  const number = u.number === null || u.number === undefined || Number.isNaN(Number(u.number)) ? null : Number(u.number)
  let id = u.id
  if (id) db.prepare('UPDATE units SET number = ?, title = ? WHERE id = ?').run(number, title, id)
  else {
    const res = db.prepare('INSERT INTO units (subject_id, number, title) VALUES (?, ?, ?)').run(u.subject_id, number, title)
    id = Number(res.lastInsertRowid)
  }
  return db
    .prepare(
      `SELECT u.*, (SELECT COUNT(*) FROM items i WHERE i.unit_id = u.id) AS item_count FROM units u WHERE u.id = ?`
    )
    .get(id) as unknown as Unit
}

// ------------------------------------------------------------------ elementos

export function saveItem(db: DB, i: ItemInput): Item {
  const title = nullIfEmpty(i.title)
  if (!title) throw new Error('El título es obligatorio')
  if (!ITEM_KINDS.includes(i.kind)) throw new Error('Tipo de elemento no válido')
  if (!db.prepare('SELECT id FROM subjects WHERE id = ?').get(i.subject_id)) {
    throw new Error('La asignatura no existe')
  }
  const status = nullIfEmpty(i.status)
  if (status && !STATUSES.includes(status as (typeof STATUSES)[number])) throw new Error('Estado no válido')
  const due = checkDate(i.due_date, 'La fecha límite')
  let unitId: number | null = null
  if (i.unit_id) {
    const u = db.prepare('SELECT id FROM units WHERE id = ? AND subject_id = ?').get(i.unit_id, i.subject_id)
    if (!u) throw new Error('La unidad elegida no pertenece a esa asignatura')
    unitId = i.unit_id
  }
  const newUnit = !unitId && i.new_unit && nullIfEmpty(i.new_unit.title) ? i.new_unit : null
  const grade = i.grade === null || i.grade === undefined || String(i.grade) === '' ? null : Number(i.grade)
  if (grade !== null && (Number.isNaN(grade) || grade < 0 || grade > 10)) throw new Error('La nota debe estar entre 0 y 10')

  const id = transaction(db, () => {
    // Unidad leída de la plataforma: se reutiliza la de la asignatura o se crea.
    if (newUnit) {
      const units = db.prepare('SELECT id, number, title FROM units WHERE subject_id = ?').all(i.subject_id) as {
        id: number
        number: number | null
        title: string
      }[]
      const found = findUnit(units, newUnit)
      unitId = found
        ? found.id
        : Number(
            db
              .prepare('INSERT INTO units (subject_id, number, title) VALUES (?, ?, ?)')
              .run(i.subject_id, newUnit.number, String(newUnit.title).trim().slice(0, 120)).lastInsertRowid
          )
    }
    let itemId = i.id
    if (itemId) {
      db.prepare(
        `UPDATE items SET subject_id = ?, unit_id = ?, kind = ?, title = ?, notes = ?, url = ?,
         due_date = ?, status = ?, grade = ? WHERE id = ?`
      ).run(i.subject_id, unitId, i.kind, title, nullIfEmpty(i.notes), nullIfEmpty(i.url), due, status, grade, itemId)
    } else {
      const res = db
        .prepare(
          `INSERT INTO items (subject_id, unit_id, kind, title, notes, url, due_date, status, grade)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(i.subject_id, unitId, i.kind, title, nullIfEmpty(i.notes), nullIfEmpty(i.url), due, status, grade)
      itemId = Number(res.lastInsertRowid)
    }
    if (i.tags) {
      db.prepare('DELETE FROM item_tags WHERE item_id = ?').run(itemId)
      const ins = db.prepare('INSERT INTO item_tags (item_id, tag) VALUES (?, ?) ON CONFLICT DO NOTHING')
      for (const raw of i.tags) {
        const tag = normalizeTag(raw)
        if (tag) ins.run(itemId, tag)
      }
    }
    return itemId
  })
  return withTags<Item>(db.prepare(`${ITEM_SELECT} WHERE i.id = ?`).get(id) as Row)
}

/** Cambios en bloque sobre varias entregas seleccionadas. */
export interface BulkPatch {
  status?: string | null
  subject_id?: number
  addTag?: string
  /** Solo con una entrega seleccionada. */
  grade?: number | null
}

const MAX_BULK = 1000

function cleanIds(ids: unknown): number[] {
  if (!Array.isArray(ids)) throw new Error('No hay entregas seleccionadas')
  const out = [...new Set(ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))]
  if (!out.length) throw new Error('No hay entregas seleccionadas')
  if (out.length > MAX_BULK) throw new Error(`Como mucho ${MAX_BULK} entregas a la vez`)
  return out
}

/**
 * Aplica un cambio a varias entregas a la vez, todo o nada. Al cambiar de asignatura,
 * cada entrega pasa a la unidad equivalente de la nueva (mismo número o nombre) o, si
 * no la tiene, se queda sin unidad: nunca apunta a una unidad de otra asignatura.
 */
export function bulkUpdate(db: DB, rawIds: unknown, patch: BulkPatch): number {
  const ids = cleanIds(rawIds)
  const p = patch && typeof patch === 'object' ? patch : {}
  return transaction(db, () => {
    let changed = 0
    if ('status' in p) {
      const st = nullIfEmpty(p.status)
      if (st && !STATUSES.includes(st as (typeof STATUSES)[number])) throw new Error('Estado no válido')
      const upd = db.prepare('UPDATE items SET status = ? WHERE id = ?')
      for (const id of ids) changed += Number(upd.run(st, id).changes)
    }
    if (p.subject_id !== undefined) {
      const target = Number(p.subject_id)
      if (!db.prepare('SELECT id FROM subjects WHERE id = ?').get(target)) throw new Error('La asignatura no existe')
      const units = db.prepare('SELECT id, number, title FROM units WHERE subject_id = ?').all(target) as {
        id: number
        number: number | null
        title: string
      }[]
      const current = db.prepare(
        'SELECT i.subject_id, u.number, u.title FROM items i LEFT JOIN units u ON u.id = i.unit_id WHERE i.id = ?'
      )
      const upd = db.prepare('UPDATE items SET subject_id = ?, unit_id = ? WHERE id = ?')
      for (const id of ids) {
        const row = current.get(id) as { subject_id: number; number: number | null; title: string | null } | undefined
        if (!row || row.subject_id === target) continue
        const unit = row.title !== null ? findUnit(units, { number: row.number, title: row.title }) : undefined
        changed += Number(upd.run(target, unit ? unit.id : null, id).changes)
      }
    }
    if (p.addTag !== undefined) {
      const tag = normalizeTag(String(p.addTag ?? ''))
      if (!tag) throw new Error('Escribe la etiqueta')
      const ins = db.prepare('INSERT INTO item_tags (item_id, tag) VALUES (?, ?) ON CONFLICT DO NOTHING')
      for (const id of ids) changed += Number(ins.run(id, tag).changes)
    }
    if ('grade' in p) {
      if (ids.length !== 1) throw new Error('La nota se pone a una sola entrega')
      const g = p.grade === null || p.grade === undefined || String(p.grade) === '' ? null : Number(p.grade)
      if (g !== null && (Number.isNaN(g) || g < 0 || g > 10)) throw new Error('La nota debe estar entre 0 y 10')
      changed += Number(db.prepare('UPDATE items SET grade = ? WHERE id = ?').run(g, ids[0]).changes)
    }
    return changed
  })
}

export function listItems(db: DB, f: ItemFilter = {}): Item[] {
  const where: string[] = []
  const params: SQLInputValue[] = []
  if (f.subject_id) { where.push('i.subject_id = ?'); params.push(f.subject_id) }
  if (f.unit_id === null) where.push('i.unit_id IS NULL')
  else if (f.unit_id !== undefined) { where.push('i.unit_id = ?'); params.push(f.unit_id) }
  if (f.kind) { where.push('i.kind = ?'); params.push(f.kind) }
  if (f.status) { where.push('i.status = ?'); params.push(f.status) }
  if (f.tag) { where.push('EXISTS (SELECT 1 FROM item_tags t WHERE t.item_id = i.id AND t.tag = ? COLLATE NOCASE)'); params.push(f.tag) }
  if (f.text) {
    where.push(`(i.title LIKE ? COLLATE NOCASE OR i.notes LIKE ? COLLATE NOCASE
      OR EXISTS (SELECT 1 FROM files fl WHERE fl.item_id = i.id AND fl.name LIKE ? COLLATE NOCASE))`)
    const like = `%${f.text}%`
    params.push(like, like, like)
  }
  if (f.dueOnly || f.overdueOnly) where.push('i.due_date IS NOT NULL')
  if (f.overdueOnly) where.push(`i.due_date < date('now', 'localtime') AND i.status IN ('pendiente', 'en curso')`)

  const order = f.dueOnly || f.overdueOnly
    ? 'ORDER BY i.due_date, i.title COLLATE NOCASE'
    : `ORDER BY u.number IS NULL, u.number, i.due_date IS NULL, i.due_date, i.created_at DESC`
  const sql = `${ITEM_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ${order}`
  return (db.prepare(sql).all(...params) as Row[]).map((r) => withTags<Item>(r))
}

// -------------------------------------------------------------------- ajustes

const DEFAULT_COURSE_NAME = '1º DAW'
/** Por defecto, Documentos/AppClase. */
const defaultDownloadsDir = (): string => join(app.getPath('documents'), 'AppClase')

export function getSettings(db: DB): Settings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
  const map = new Map(rows.map((r) => [r.key, r.value]))
  let openers: Opener[] = []
  try {
    const raw = map.get('openers')
    if (raw) openers = JSON.parse(raw) as Opener[]
  } catch {
    openers = []
  }
  return {
    course_name: map.get('course_name') || DEFAULT_COURSE_NAME,
    openers,
    downloads_dir: map.get('downloads_dir') || defaultDownloadsDir()
  }
}

export function saveSettings(db: DB, s: Partial<Settings>): Settings {
  transaction(db, () => {
    const put = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
    if (s.course_name !== undefined) put.run('course_name', nullIfEmpty(s.course_name) ?? DEFAULT_COURSE_NAME)
    if (s.downloads_dir !== undefined) {
      const dir = nullIfEmpty(s.downloads_dir)
      if (dir && !isAbsolute(dir)) throw new Error('La carpeta de descargas tiene que ser una ruta completa')
      if (dir) put.run('downloads_dir', dir)
      else db.prepare(`DELETE FROM settings WHERE key = 'downloads_dir'`).run()
    }
    if (s.openers !== undefined) {
      const clean = s.openers
        .map((o) => ({ name: normalizeTag(o.name || ''), command: (o.command || '').trim(), args: (o.args || '').trim() }))
        .filter((o) => o.name && o.command)
      put.run('openers', JSON.stringify(clean))
    }
  })
  return getSettings(db)
}

// ------------------------------------------------------------------ panel

export function getStats(db: DB): Stats {
  const one = (sql: string): number => (db.prepare(sql).get() as { n: number }).n
  const dueSoon = (db
    .prepare(
      `${ITEM_SELECT} WHERE i.due_date IS NOT NULL AND i.status IN ('pendiente', 'en curso')
       AND i.due_date >= date('now', 'localtime') AND i.due_date <= date('now', 'localtime', '+14 days')
       ORDER BY i.due_date LIMIT 20`
    )
    .all() as Row[]).map((r) => withTags<Item>(r))
  const overdueItems = (db
    .prepare(
      `${ITEM_SELECT} WHERE i.due_date IS NOT NULL AND i.status IN ('pendiente', 'en curso')
       AND i.due_date < date('now', 'localtime') ORDER BY i.due_date LIMIT 20`
    )
    .all() as Row[]).map((r) => withTags<Item>(r))
  const recentFiles = db
    .prepare(
      `SELECT f.*, i.title AS item_title, s.name AS subject_name
       FROM files f JOIN items i ON i.id = f.item_id JOIN subjects s ON s.id = i.subject_id
       ORDER BY f.added_at DESC, f.id DESC LIMIT 10`
    )
    .all() as unknown as Stats['recentFiles']
  return {
    subjects: one('SELECT COUNT(*) AS n FROM subjects'),
    items: one('SELECT COUNT(*) AS n FROM items'),
    files: one('SELECT COUNT(*) AS n FROM files'),
    missing: one('SELECT COUNT(*) AS n FROM files WHERE missing = 1'),
    pending: one(`SELECT COUNT(*) AS n FROM items WHERE status IN ('pendiente', 'en curso')`),
    overdue: one(
      `SELECT COUNT(*) AS n FROM items WHERE due_date IS NOT NULL
       AND status IN ('pendiente', 'en curso') AND due_date < date('now', 'localtime')`
    ),
    dueSoon,
    overdueItems,
    recentFiles
  }
}

// ----------------------------------------------------------------------- IPC

export function registerIpc(db: DB): void {
  const win = (): BrowserWindow | null => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
  const h = (channel: string, fn: (...args: never[]) => unknown): void => {
    ipcMain.handle(channel, (_e, ...args) => (fn as (...a: unknown[]) => unknown)(...args))
  }
  /** Tras cambiar los ficheros indexados, el vigilante ajusta las carpetas que observa. */
  const synced = async <T>(result: T | Promise<T>): Promise<T> => {
    const r = await result
    syncWatchers()
    return r
  }

  h('subjects:list', () => db.prepare(`${SUBJECT_SELECT} ORDER BY s.position, s.name COLLATE NOCASE`).all())
  h('subjects:save', (s: SubjectInput) => saveSubject(db, s))
  h('subjects:remove', (id: number) => {
    db.prepare('DELETE FROM subjects WHERE id = ?').run(id)
    syncWatchers()
  })
  h('subjects:seedDaw1', () => {
    transaction(db, () => {
      const existing = new Set(
        (db.prepare('SELECT name FROM subjects').all() as { name: string }[]).map((r) => r.name.toLowerCase())
      )
      const missing = DAW1_SUBJECTS.filter((s) => !existing.has(s.name.toLowerCase()))
      if (missing.length === DAW1_SUBJECTS.length && existing.size === 0) seedSubjects(db)
      else {
        const { next } = db.prepare('SELECT COALESCE(MAX(position) + 1, 0) AS next FROM subjects').get() as { next: number }
        const ins = db.prepare('INSERT INTO subjects (name, short_name, color, position) VALUES (?, ?, ?, ?)')
        missing.forEach((s, idx) => ins.run(s.name, s.short_name, s.color, next + idx))
      }
    })
    return db.prepare(`${SUBJECT_SELECT} ORDER BY s.position, s.name COLLATE NOCASE`).all()
  })

  h('units:list', (subjectId: number) =>
    db
      .prepare(
        `SELECT u.*, (SELECT COUNT(*) FROM items i WHERE i.unit_id = u.id) AS item_count
         FROM units u WHERE u.subject_id = ? ORDER BY u.number IS NULL, u.number, u.title COLLATE NOCASE`
      )
      .all(subjectId)
  )
  h('units:save', (u: UnitInput) => saveUnit(db, u))
  h('units:remove', (id: number) => {
    db.prepare('DELETE FROM units WHERE id = ?').run(id)
  })

  h('items:list', (f?: ItemFilter) => listItems(db, f ?? {}))
  h('items:get', (id: number) => withTags<Item>(db.prepare(`${ITEM_SELECT} WHERE i.id = ?`).get(id) as Row))
  h('items:save', (i: ItemInput) => saveItem(db, i))
  // Con trashFiles, los ficheros del elemento van a la papelera de reciclaje.
  h('items:remove', (id: number, opts?: { trashFiles?: boolean }) =>
    synced(removeItem(db, id, opts?.trashFiles === true, getSettings(db).downloads_dir))
  )
  h('items:setStatus', (id: number, status: string | null) => {
    const s = nullIfEmpty(status)
    if (s && !STATUSES.includes(s as (typeof STATUSES)[number])) throw new Error('Estado no válido')
    db.prepare('UPDATE items SET status = ? WHERE id = ?').run(s, id)
    return withTags<Item>(db.prepare(`${ITEM_SELECT} WHERE i.id = ?`).get(id) as Row)
  })
  h('items:addTag', (id: number, tag: string) => {
    const t = normalizeTag(tag)
    if (t) db.prepare('INSERT INTO item_tags (item_id, tag) VALUES (?, ?) ON CONFLICT DO NOTHING').run(id, t)
  })
  h('items:bulkUpdate', (ids: number[], patch: BulkPatch) => bulkUpdate(db, ids, patch))
  // Borrar varias: una a una, para que cada una lleve sus ficheros a la papelera.
  h('items:bulkRemove', (ids: number[], opts?: { trashFiles?: boolean }) =>
    synced(
      (async () => {
        let trashed = 0
        let removed = 0
        const errors: string[] = []
        const dir = getSettings(db).downloads_dir
        for (const id of cleanIds(ids)) {
          const r = await removeItem(db, id, opts?.trashFiles === true, dir)
          trashed += r.trashed
          removed++
          errors.push(...r.errors)
        }
        return { removed, trashed, errors }
      })()
    )
  )
  h('items:removeTag', (id: number, tag: string) => {
    db.prepare('DELETE FROM item_tags WHERE item_id = ? AND tag = ? COLLATE NOCASE').run(id, tag)
  })

  h('files:list', (itemId: number) => {
    revalidate(db, itemId)
    return db.prepare('SELECT * FROM files WHERE item_id = ? ORDER BY name COLLATE NOCASE').all(itemId)
  })
  h('files:choose', (itemId: number) => synced(chooseFiles(db, win(), itemId)))
  h('files:chooseFolder', (itemId: number) => synced(chooseFolder(db, win(), itemId)))
  h('files:addPaths', (itemId: number, paths: string[]) => synced(addPaths(db, itemId, paths)))
  h('files:remove', (id: number) => {
    // Solo se quita del índice: el fichero sigue en el disco.
    db.prepare('DELETE FROM files WHERE id = ?').run(id)
    syncWatchers()
  })
  h('files:open', (id: number) => openFile(db, id))
  h('files:openWith', (id: number, openerIndex: number) => {
    const o = getSettings(db).openers[openerIndex]
    if (!o) return { ok: false, error: 'Ese programa ya no está configurado' }
    const args = (o.args || '').trim() ? (o.args as string).trim().split(/\s+/) : []
    return openWith(db, id, o.command, args)
  })
  h('files:reveal', (id: number) => reveal(db, id))
  h('files:relocate', (id: number) => synced(relocate(db, win(), id)))
  h('files:revalidate', (itemId?: number) => revalidate(db, itemId))

  h('tags', () =>
    (db.prepare('SELECT DISTINCT tag FROM item_tags ORDER BY tag COLLATE NOCASE').all() as { tag: string }[]).map((r) => r.tag)
  )

  h('search', (q: string, inContent?: boolean) => {
    const text = (q ?? '').trim()
    const empty = { subjects: [], items: [], files: [], tags: [], content: [], contentTruncated: false }
    if (text.length < 2) return empty
    const like = `%${text}%`
    const subjects = db
      .prepare(`${SUBJECT_SELECT} WHERE s.name LIKE ? COLLATE NOCASE OR s.short_name LIKE ? COLLATE NOCASE ORDER BY s.position`)
      .all(like, like)
    const items = listItems(db, { text })
    const files = db
      .prepare(
        `SELECT f.*, i.title AS item_title, s.name AS subject_name
         FROM files f JOIN items i ON i.id = f.item_id JOIN subjects s ON s.id = i.subject_id
         WHERE f.name LIKE ? COLLATE NOCASE ORDER BY f.name COLLATE NOCASE LIMIT 100`
      )
      .all(like)
    const tags = (
      db.prepare('SELECT DISTINCT tag FROM item_tags WHERE tag LIKE ? COLLATE NOCASE ORDER BY tag').all(like) as { tag: string }[]
    ).map((r) => r.tag)
    const { matches, truncated } = inContent ? searchContent(db, text) : { matches: [], truncated: false }
    return { subjects, items, files, tags, content: matches, contentTruncated: truncated }
  })

  h('stats', () => {
    revalidate(db)
    return getStats(db)
  })

  h('settings:get', () => getSettings(db))
  h('settings:save', (s: Partial<Settings>) => saveSettings(db, s))
  h('settings:chooseExecutable', async () => {
    const w = win()
    const opts = { title: 'Elige el programa', buttonLabel: 'Usar este programa', properties: ['openFile'] as const }
    const r = w
      ? await dialog.showOpenDialog(w, { ...opts, properties: [...opts.properties] })
      : await dialog.showOpenDialog({ ...opts, properties: [...opts.properties] })
    return r.canceled ? null : r.filePaths[0] ?? null
  })
  h('settings:chooseDownloadsDir', async () => {
    const w = win()
    const opts: OpenDialogOptions = {
      title: 'Carpeta para los ficheros de la plataforma',
      buttonLabel: 'Usar esta carpeta',
      defaultPath: getSettings(db).downloads_dir,
      properties: ['openDirectory', 'createDirectory']
    }
    const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts)
    return r.canceled ? null : r.filePaths[0] ?? null
  })

  h('importer:read', (url: string) => readActivity(url))
  h('importer:readCourse', (url: string) => readCourse(url))
  h('importer:cancel', () => cancelRead())
  h('importer:download', (itemId: number, files: { name: string; url: string; section?: FileSection }[]) =>
    synced(downloadFiles(db, getSettings(db).downloads_dir, itemId, Array.isArray(files) ? files : []))
  )
  h('importer:logout', () => logoutPlatform())

  h('app:version', () => app.getVersion())
}
