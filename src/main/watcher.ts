import { BrowserWindow } from 'electron'
import { existsSync, watch, type FSWatcher } from 'node:fs'
import { dirname } from 'node:path'
import type { DB } from './db'
import { revalidate, revalidateDirs } from './files'

/**
 * Vigila las carpetas donde están los ficheros indexados. Si editas, renombras o
 * borras un fichero desde el explorador, la app se pone al día sola y avisa a la
 * interfaz con el evento «files:changed».
 */
const MAX_WATCHED_DIRS = 400
/** Espera tras el último cambio: guardar desde un editor dispara varios eventos seguidos. */
const DEBOUNCE_MS = 350
/** Además, por si algún cambio no llega (unidades de red, etc.), se repasa todo cada minuto. */
const SWEEP_MS = 60 * 1000
/**
 * Cada poco se comprueba que las carpetas vigiladas sigan existiendo. Hace falta en
 * Windows: vigilar una carpeta la mantiene abierta, y si la borras queda «pendiente
 * de borrar» sin que llegue ningún aviso (ni de ella ni de la de arriba) hasta que la
 * app la suelta. Una carpeta pendiente de borrar ya no cuenta como existente, así que
 * aquí se detecta, se marca y se deja de vigilar, y Windows termina de borrarla.
 */
const EXISTS_MS = 2000

const watchers = new Map<string, FSWatcher>()
const dirty = new Set<string>()
let timer: NodeJS.Timeout | null = null
let sweep: NodeJS.Timeout | null = null
let existence: NodeJS.Timeout | null = null
let db: DB | null = null

function notify(): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('files:changed')
}

function flush(): void {
  timer = null
  if (!db || dirty.size === 0) return
  const dirs = new Set(dirty)
  dirty.clear()
  const changed = revalidateDirs(db, dirs)
  if (changed > 0) notify()
  // Un renombrado o un borrado puede dejar carpetas sin ficheros que vigilar.
  syncWatchers()
}

function onChange(dir: string): void {
  dirty.add(dir)
  if (timer) clearTimeout(timer)
  timer = setTimeout(flush, DEBOUNCE_MS)
}

/** Ajusta las carpetas vigiladas a las de los ficheros que hay ahora en el índice. */
export function syncWatchers(): void {
  if (!db) return
  const dirs = new Set((db.prepare('SELECT DISTINCT path FROM files').all() as { path: string }[]).map((r) => dirname(r.path)))
  for (const [dir, w] of watchers) {
    // También se deja de vigilar una carpeta que ya no existe: en Windows, mantenerla
    // vigilada deja la carpeta borrada «a medias» hasta que se cierra la app.
    if (!dirs.has(dir) || !existsSync(dir)) {
      w.close()
      watchers.delete(dir)
    }
  }
  for (const dir of dirs) {
    if (watchers.has(dir) || watchers.size >= MAX_WATCHED_DIRS || !existsSync(dir)) continue
    try {
      const w = watch(dir, { persistent: false }, () => onChange(dir))
      w.on('error', () => {
        // La carpeta desapareció o dejó de estar accesible: se revisa y se deja de vigilar.
        w.close()
        watchers.delete(dir)
        onChange(dir)
      })
      watchers.set(dir, w)
    } catch {
      /* sin permiso o no se puede vigilar: queda el repaso periódico */
    }
  }
}

export function startWatching(database: DB): void {
  db = database
  syncWatchers()
  sweep = setInterval(() => {
    if (!db) return
    if (revalidate(db) > 0) notify()
    syncWatchers()
  }, SWEEP_MS)
  existence = setInterval(() => {
    for (const dir of watchers.keys()) if (!existsSync(dir)) onChange(dir)
  }, EXISTS_MS)
}

export function stopWatching(): void {
  if (timer) clearTimeout(timer)
  if (sweep) clearInterval(sweep)
  if (existence) clearInterval(existence)
  for (const w of watchers.values()) w.close()
  watchers.clear()
  db = null
}
