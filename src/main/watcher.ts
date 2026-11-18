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
/**
 * Espera tras el primer aviso antes de revisar, para agrupar los que llegan seguidos
 * (guardar desde un editor dispara varios). El plazo NO se reinicia con cada aviso:
 * en Windows, una carpeta vigilada que se borra emite avisos sin parar, y reiniciar
 * la espera con cada uno impedía revisar nunca.
 */
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

/** Con APPCLASE_DEBUG_WATCH=1 (lo usa la prueba E2E) se registra lo que ve el vigilante. */
const debug = (...args: unknown[]): void => {
  if (process.env.APPCLASE_DEBUG_WATCH) console.log('[vigilante]', ...args)
}

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
  debug('revisadas', [...dirs], '→ cambios:', changed)
  if (changed > 0) notify()
  // Un renombrado o un borrado puede dejar carpetas sin ficheros que vigilar.
  syncWatchers()
}

function onChange(dir: string, why = 'evento'): void {
  debug(why, dir)
  dirty.add(dir)
  if (!timer) timer = setTimeout(flush, DEBOUNCE_MS)
}

function unwatch(dir: string): void {
  const w = watchers.get(dir)
  if (!w) return
  debug('deja de vigilar', dir)
  w.close()
  watchers.delete(dir)
}

/** Ajusta las carpetas vigiladas a las de los ficheros que hay ahora en el índice. */
export function syncWatchers(): void {
  if (!db) return
  const dirs = new Set((db.prepare('SELECT DISTINCT path FROM files').all() as { path: string }[]).map((r) => dirname(r.path)))
  for (const [dir, w] of watchers) {
    // También se deja de vigilar una carpeta que ya no existe: en Windows, mantenerla
    // vigilada deja la carpeta borrada «a medias» hasta que se cierra la app.
    if (!dirs.has(dir) || !existsSync(dir)) {
      unwatch(dir)
    }
  }
  for (const dir of dirs) {
    if (watchers.has(dir) || watchers.size >= MAX_WATCHED_DIRS || !existsSync(dir)) continue
    try {
      const w = watch(dir, { persistent: false }, (type, name) => {
        // Si la carpeta vigilada ya no existe, se suelta al momento: en Windows, si no,
        // sigue emitiendo avisos sin parar y la carpeta queda borrada «a medias».
        if (!existsSync(dir)) unwatch(dir)
        onChange(dir, `evento ${type} ${name}`)
      })
      debug('vigilando', dir)
      w.on('error', (err) => {
        debug('error', dir, String(err))
        // La carpeta desapareció o dejó de estar accesible: se revisa y se deja de vigilar.
        unwatch(dir)
        onChange(dir, 'error')
      })
      watchers.set(dir, w)
    } catch (err) {
      // Sin permiso o no se puede vigilar: queda el repaso periódico.
      debug('no se puede vigilar', dir, String(err))
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
    for (const dir of [...watchers.keys()]) {
      if (!existsSync(dir)) {
        unwatch(dir)
        onChange(dir, 'ya no existe')
      }
    }
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
