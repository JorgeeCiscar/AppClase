import { dialog, shell, type BrowserWindow, type OpenDialogOptions } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmdirSync, statSync, type Dirent, type Stats } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import type { AddFilesResult, ContentMatch, FileRef, FileSection, OpenResult } from '../shared/types'
import { TEXT_EXT } from '../shared/types'
import { transaction, type DB } from './db'

/** Tope de ficheros que se añaden de una vez al indexar una carpeta. */
const MAX_FOLDER_FILES = 500
/** Carpetas que no se indexan nunca al añadir una carpeta entera. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'out', 'dist', 'target', '__pycache__', '.idea', '.vscode'])
/** Tamaño máximo de fichero cuyo contenido se busca como texto. */
const MAX_CONTENT_BYTES = 1024 * 1024
const MAX_CONTENT_MATCHES = 100

const textExt = new Set<string>(TEXT_EXT)

export const isTextFile = (p: string): boolean => textExt.has(extname(p).toLowerCase())

/** Recorre una carpeta y devuelve sus ficheros, sin entrar en las carpetas de SKIP_DIRS. */
export function collectFiles(dir: string, out: string[] = []): string[] {
  let entries: Dirent<string>[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (out.length >= MAX_FOLDER_FILES) return out
    if (e.name.startsWith('.')) continue
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) collectFiles(full, out)
    } else if (e.isFile()) {
      out.push(full)
    }
  }
  return out
}

const isoMtime = (s: Stats): string => new Date(s.mtimeMs).toISOString()

/**
 * Indexa rutas dentro de un elemento. Las carpetas se expanden.
 * No copia nada: el fichero sigue donde esté, y la app guarda su ruta.
 */
export function addPaths(db: DB, itemId: number, paths: string[], section: FileSection | null = null): AddFilesResult {
  const item = db.prepare('SELECT id FROM items WHERE id = ?').get(itemId)
  if (!item) throw new Error('El elemento ya no existe')

  const expanded: string[] = []
  const errors: string[] = []
  for (const p of paths) {
    const full = resolve(p)
    try {
      const st = statSync(full)
      if (st.isDirectory()) expanded.push(...collectFiles(full))
      else expanded.push(full)
    } catch {
      errors.push(`No se puede leer «${basename(full)}»`)
    }
  }

  let added = 0
  let skipped = 0
  transaction(db, () => {
    const insert = db.prepare(
      `INSERT INTO files (item_id, path, name, ext, size, mtime, missing, section)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)
       ON CONFLICT (item_id, path) DO NOTHING`
    )
    for (const full of expanded.slice(0, MAX_FOLDER_FILES)) {
      let st: Stats
      try {
        st = statSync(full)
      } catch {
        errors.push(`No se puede leer «${basename(full)}»`)
        continue
      }
      const res = insert.run(itemId, full, basename(full), extname(full).toLowerCase() || null, st.size, isoMtime(st), section)
      if (res.changes > 0) added++
      else skipped++
    }
  })
  return { added, skipped, errors }
}

export async function chooseFiles(db: DB, win: BrowserWindow | null, itemId: number): Promise<AddFilesResult> {
  const r = await openDialog(win, {
    title: 'Añadir ficheros al elemento',
    buttonLabel: 'Añadir',
    properties: ['openFile', 'multiSelections']
  })
  if (r.canceled || r.filePaths.length === 0) return { added: 0, skipped: 0, errors: [] }
  return addPaths(db, itemId, r.filePaths)
}

export async function chooseFolder(db: DB, win: BrowserWindow | null, itemId: number): Promise<AddFilesResult> {
  const r = await openDialog(win, {
    title: 'Añadir una carpeta entera',
    buttonLabel: 'Añadir',
    properties: ['openDirectory']
  })
  if (r.canceled || r.filePaths.length === 0) return { added: 0, skipped: 0, errors: [] }
  return addPaths(db, itemId, r.filePaths)
}

/** showOpenDialog acepta ventana padre o ninguna; pasar undefined como padre es un error. */
const openDialog = (win: BrowserWindow | null, opts: OpenDialogOptions) =>
  win ? dialog.showOpenDialog(win, opts) : dialog.showOpenDialog(opts)

const getFile = (db: DB, id: number): FileRef | undefined =>
  db.prepare('SELECT * FROM files WHERE id = ?').get(id) as FileRef | undefined

type FileState = Pick<FileRef, 'id' | 'item_id' | 'path' | 'size' | 'mtime' | 'missing'>

/**
 * Si un fichero ya no está pero su carpeta sí, ¿se ha renombrado? Lo es si en la
 * carpeta hay exactamente un fichero, aún no indexado en ese elemento, con el mismo
 * tamaño y la misma fecha de modificación (renombrar no cambia ninguna de las dos).
 */
function findRenamed(db: DB, f: FileState, dir: string): string | null {
  if (f.size === null || f.mtime === null) return null
  let entries: Dirent<string>[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return null
  }
  const indexed = db.prepare('SELECT 1 FROM files WHERE item_id = ? AND path = ?')
  const candidates: string[] = []
  for (const e of entries) {
    if (!e.isFile()) continue
    const full = join(dir, e.name)
    if (indexed.get(f.item_id, full)) continue
    try {
      const st = statSync(full)
      if (st.size === f.size && isoMtime(st) === f.mtime) candidates.push(full)
    } catch {
      /* desapareció mientras se miraba */
    }
    if (candidates.length > 1) return null
  }
  return candidates.length === 1 ? candidates[0] : null
}

/**
 * Pone el índice al día con el disco. Por cada fichero:
 * - sigue ahí → se actualizan tamaño y fecha si lo editaste fuera;
 * - su carpeta sigue ahí pero él no → si se renombró dentro de la carpeta se sigue
 *   con el nombre nuevo; si no, se borró desde la carpeta y se quita de la app;
 * - ha desaparecido la carpeta entera (p. ej. un USB sin conectar) → se marca como
 *   «no se encuentra», sin quitarlo, para poder volver a localizarlo.
 * Devuelve cuántos ficheros cambiaron.
 */
export function reconcile(db: DB, rows: FileState[]): number {
  let changed = 0
  transaction(db, () => {
    const upd = db.prepare('UPDATE files SET size = ?, mtime = ?, missing = 0 WHERE id = ?')
    const markMissing = db.prepare('UPDATE files SET missing = 1 WHERE id = ?')
    const moveTo = db.prepare('UPDATE files SET path = ?, name = ?, ext = ?, size = ?, mtime = ?, missing = 0 WHERE id = ?')
    const remove = db.prepare('DELETE FROM files WHERE id = ?')
    for (const f of rows) {
      let st: Stats | null = null
      try {
        st = statSync(f.path)
      } catch {
        st = null
      }
      if (st) {
        const mtime = isoMtime(st)
        if (f.missing || st.size !== f.size || mtime !== f.mtime) {
          upd.run(st.size, mtime, f.id)
          changed++
        }
        continue
      }
      const dir = dirname(f.path)
      if (!existsSync(dir)) {
        if (!f.missing) {
          markMissing.run(f.id)
          changed++
        }
        continue
      }
      const renamed = findRenamed(db, f, dir)
      if (renamed) {
        const rs = statSync(renamed)
        moveTo.run(renamed, basename(renamed), extname(renamed).toLowerCase() || null, rs.size, isoMtime(rs), f.id)
      } else {
        remove.run(f.id)
      }
      changed++
    }
  })
  return changed
}

const FILE_STATE = 'SELECT id, item_id, path, size, mtime, missing FROM files'

/** Comprueba en el disco los ficheros de un elemento (o todos). Ver reconcile(). */
export function revalidate(db: DB, itemId?: number): number {
  const rows = (
    itemId === undefined ? db.prepare(FILE_STATE).all() : db.prepare(`${FILE_STATE} WHERE item_id = ?`).all(itemId)
  ) as FileState[]
  return reconcile(db, rows)
}

/** Comprueba solo los ficheros que están en estas carpetas (lo usa el vigilante). */
export function revalidateDirs(db: DB, dirs: Set<string>): number {
  const rows = (db.prepare(FILE_STATE).all() as FileState[]).filter((f) => dirs.has(dirname(f.path)))
  return reconcile(db, rows)
}

/** Abre el fichero con la aplicación predeterminada del sistema. */
export async function openFile(db: DB, id: number): Promise<OpenResult> {
  const f = getFile(db, id)
  if (!f) return { ok: false, error: 'El fichero ya no está en el índice' }
  revalidate(db, f.item_id)
  const fresh = getFile(db, id)
  if (!fresh) return { ok: false, error: `«${f.name}» se ha borrado de su carpeta` }
  if (fresh.missing) return { ok: false, error: `No se encuentra «${f.name}». Usa «Buscar de nuevo» para indicar su ruta actual.` }
  // openPath devuelve '' si todo fue bien, o el mensaje de error del sistema.
  const err = await shell.openPath(fresh.path)
  return err ? { ok: false, error: err } : { ok: true }
}

/** Abre el fichero con un programa concreto configurado en Ajustes. */
export function openWith(db: DB, id: number, command: string, args: string[]): OpenResult {
  const f = getFile(db, id)
  if (!f) return { ok: false, error: 'El fichero ya no está en el índice' }
  if (f.missing) return { ok: false, error: `No se encuentra «${f.name}»` }
  if (!command.trim()) return { ok: false, error: 'Ese programa no tiene una ruta configurada' }
  try {
    const child = spawn(command, [...args, f.path], { detached: true, stdio: 'ignore' })
    child.on('error', () => {})
    child.unref()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: `No se pudo abrir el programa: ${(e as Error).message}` }
  }
}

export function reveal(db: DB, id: number): OpenResult {
  const f = getFile(db, id)
  if (!f) return { ok: false, error: 'El fichero ya no está en el índice' }
  if (f.missing) return { ok: false, error: `No se encuentra «${f.name}»` }
  shell.showItemInFolder(f.path)
  return { ok: true }
}

/** Vuelve a apuntar un fichero cuya ruta se rompió porque lo moviste o renombraste. */
export async function relocate(db: DB, win: BrowserWindow | null, id: number): Promise<FileRef | undefined> {
  const f = getFile(db, id)
  if (!f) throw new Error('El fichero ya no está en el índice')
  const r = await openDialog(win, {
    title: `¿Dónde está ahora «${f.name}»?`,
    buttonLabel: 'Usar este fichero',
    properties: ['openFile']
  })
  if (r.canceled || !r.filePaths[0]) return getFile(db, id)
  const full = resolve(r.filePaths[0])
  const st = statSync(full)
  const dup = db.prepare('SELECT id FROM files WHERE item_id = ? AND path = ? AND id <> ?').get(f.item_id, full, id)
  if (dup) throw new Error('Ese fichero ya está en el elemento')
  db.prepare('UPDATE files SET path = ?, name = ?, ext = ?, size = ?, mtime = ?, missing = 0 WHERE id = ?').run(
    full,
    basename(full),
    extname(full).toLowerCase() || null,
    st.size,
    isoMtime(st),
    id
  )
  return getFile(db, id)
}

/** Busca un texto DENTRO de los ficheros indexados que sean de texto. */
export function searchContent(db: DB, q: string): { matches: ContentMatch[]; truncated: boolean } {
  const needle = q.trim().toLowerCase()
  if (needle.length < 2) return { matches: [], truncated: false }
  const rows = db
    .prepare(
      `SELECT f.id AS file_id, f.item_id, f.path, f.name, f.size, i.title AS item_title, s.name AS subject_name
       FROM files f
       JOIN items i ON i.id = f.item_id
       JOIN subjects s ON s.id = i.subject_id
       WHERE f.missing = 0
       ORDER BY f.id`
    )
    .all() as unknown as (ContentMatch & { size: number | null })[]

  const matches: ContentMatch[] = []
  let truncated = false
  for (const r of rows) {
    if (matches.length >= MAX_CONTENT_MATCHES) {
      truncated = true
      break
    }
    if (!isTextFile(r.path)) continue
    if ((r.size ?? 0) > MAX_CONTENT_BYTES) continue
    let text: string
    try {
      text = readFileSync(r.path, 'utf8')
    } catch {
      continue
    }
    if (!text.toLowerCase().includes(needle)) continue
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length && matches.length < MAX_CONTENT_MATCHES; i++) {
      if (!lines[i].toLowerCase().includes(needle)) continue
      matches.push({
        file_id: r.file_id,
        item_id: r.item_id,
        path: r.path,
        name: r.name,
        item_title: r.item_title,
        subject_name: r.subject_name,
        line: i + 1,
        snippet: lines[i].trim().slice(0, 200)
      })
    }
  }
  return { matches, truncated }
}

/** ¿Está «p» dentro de «root» (sin ser «root»)? */
function isInside(root: string, p: string): boolean {
  const rel = relative(root, p)
  return !!rel && !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * Quita las carpetas que hayan quedado vacías, subiendo hacia arriba, pero solo
 * dentro de la carpeta de descargas de la app: nunca se toca una carpeta tuya.
 */
function pruneEmptyDirs(dirs: Iterable<string>, downloadsDir: string): void {
  const root = resolve(downloadsDir)
  for (const start of dirs) {
    let dir = resolve(start)
    while (isInside(root, dir)) {
      try {
        if (readdirSync(dir).length > 0) break
        rmdirSync(dir)
      } catch {
        break
      }
      dir = dirname(dir)
    }
  }
}

/**
 * Borra un elemento. Con trashFiles, sus ficheros van a la papelera de reciclaje
 * (se pueden recuperar), salvo los que use también otro elemento; después se
 * quitan las carpetas de descarga que hayan quedado vacías.
 */
export async function removeItem(
  db: DB,
  itemId: number,
  trashFiles: boolean,
  downloadsDir: string
): Promise<{ trashed: number; errors: string[] }> {
  const paths = (db.prepare('SELECT path FROM files WHERE item_id = ?').all(itemId) as { path: string }[]).map(
    (r) => r.path
  )
  db.prepare('DELETE FROM items WHERE id = ?').run(itemId)
  if (!trashFiles) return { trashed: 0, errors: [] }

  let trashed = 0
  const errors: string[] = []
  const usedElsewhere = db.prepare('SELECT 1 FROM files WHERE path = ?')
  for (const p of new Set(paths)) {
    if (usedElsewhere.get(p) || !existsSync(p)) continue
    try {
      await shell.trashItem(p)
      trashed++
    } catch (e) {
      errors.push(`«${basename(p)}»: ${(e as Error).message}`)
    }
  }
  pruneEmptyDirs(new Set(paths.map((p) => dirname(p))), downloadsDir)
  return { trashed, errors }
}
