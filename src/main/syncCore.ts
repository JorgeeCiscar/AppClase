// Sincronizar los datos de AppClase entre ordenadores a través de OneDrive.
// Este módulo no usa Electron (solo fs, os y SQLite) para poder probarlo aparte.
import { randomUUID } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { hostname, homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

// ------------------------------------------------------------- configuración local
// Dónde están los datos lo decide un fichero pequeño de ESTE ordenador (no se sincroniza).

export interface LocalConfig {
  /** Los datos están en OneDrive y se comparten con otros ordenadores. */
  sync: boolean
}

const CONFIG_FILE = 'config.json'

export function readConfig(configDir: string): LocalConfig {
  try {
    const raw = JSON.parse(readFileSync(join(configDir, CONFIG_FILE), 'utf8'))
    return { sync: raw && raw.sync === true }
  } catch {
    return { sync: false }
  }
}

export function writeConfig(configDir: string, c: LocalConfig): void {
  mkdirSync(configDir, { recursive: true })
  const file = join(configDir, CONFIG_FILE)
  writeFileSync(`${file}.tmp`, JSON.stringify(c, null, 2))
  renameSync(`${file}.tmp`, file)
}

// ----------------------------------------------------------------------- OneDrive

/**
 * Carpeta de OneDrive de este ordenador. Windows la publica en la variable OneDrive
 * (o OneDriveConsumer / OneDriveCommercial); si no, se prueba ~/OneDrive.
 * APPCLASE_ONEDRIVE la sustituye (lo usan las pruebas).
 */
export function detectOneDrive(env: NodeJS.ProcessEnv = process.env): string | null {
  const candidates = [
    env.APPCLASE_ONEDRIVE,
    env.OneDrive,
    env.OneDriveConsumer,
    env.OneDriveCommercial,
    join(homedir(), 'OneDrive')
  ]
  for (const c of candidates) {
    if (c && isAbsolute(c) && existsSync(c)) return resolve(c)
  }
  return null
}

/** Carpeta de los datos dentro de OneDrive. */
export const cloudDataDir = (root: string): string => join(root, 'AppClase', 'datos')
export const DB_FILE = 'appclase.db'

// ------------------------------------------------------------- «en uso» (cerrojo)

/** Cada cuánto se renueva la marca y cuándo se considera abandonada. */
export const BEAT_MS = 60 * 1000
export const STALE_MS = 3 * 60 * 1000
const LOCK_FILE = 'appclase.lock'

export interface LockInfo {
  /** Identificador de esta apertura de la app. */
  id: string
  host: string
  since: string
  beat: string
}

export interface Me {
  id: string
  host: string
}

/** APPCLASE_HOST sustituye el nombre del ordenador (lo usan las pruebas para simular dos). */
export const thisHost = (): string => process.env.APPCLASE_HOST || hostname()
export const newMe = (): Me => ({ id: randomUUID(), host: thisHost() })

export function readLock(dir: string): LockInfo | null {
  try {
    const raw = JSON.parse(readFileSync(join(dir, LOCK_FILE), 'utf8'))
    if (raw && typeof raw.id === 'string' && typeof raw.host === 'string' && typeof raw.beat === 'string')
      return raw as LockInfo
  } catch {
    /* sin marca o ilegible */
  }
  return null
}

/**
 * ¿Puedo abrir los datos? «libre» si no hay marca, es mía, es de este mismo ordenador
 * (la app se cerró mal) o lleva más de STALE_MS sin renovarse; «otro» si otro
 * ordenador la tiene abierta ahora.
 */
export function lockState(dir: string, me: Me, now = Date.now()): { state: 'libre' | 'otro'; info: LockInfo | null } {
  const info = readLock(dir)
  if (!info || info.id === me.id || info.host === me.host) return { state: 'libre', info }
  const age = now - Date.parse(info.beat)
  return { state: Number.isFinite(age) && age < STALE_MS ? 'otro' : 'libre', info }
}

export function writeLock(dir: string, me: Me, since?: string): void {
  mkdirSync(dir, { recursive: true })
  const now = new Date().toISOString()
  const info: LockInfo = { id: me.id, host: me.host, since: since ?? now, beat: now }
  const file = join(dir, LOCK_FILE)
  writeFileSync(`${file}.tmp`, JSON.stringify(info))
  renameSync(`${file}.tmp`, file)
}

/** Renueva la marca. Devuelve false si otro ordenador ha tomado el relevo. */
export function beat(dir: string, me: Me): boolean {
  const info = readLock(dir)
  if (info && info.id !== me.id) return false
  writeLock(dir, me, info?.since)
  return true
}

export function releaseLock(dir: string, me: Me): void {
  const info = readLock(dir)
  if (info && info.id === me.id) {
    try {
      unlinkSync(join(dir, LOCK_FILE))
    } catch {
      /* ya no estaba */
    }
  }
}

// ------------------------------------------------------------------ rutas

const sameOrInside = (root: string, p: string): boolean => {
  const rel = relative(root, p)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * La carpeta de OneDrive puede estar en otra ruta en cada ordenador. Al abrir los
 * datos en uno, las rutas de los ficheros (y la carpeta de descargas) que estaban
 * dentro del OneDrive del último ordenador se pasan al OneDrive de este.
 * Devuelve cuántas rutas cambiaron.
 */
export function rebasePaths(db: DatabaseSync, root: string): number {
  const get = (k: string): string | null => {
    const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(k) as { value: string } | undefined
    return r?.value ?? null
  }
  const put = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'
  )
  const old = get('sync_root')
  let changed = 0
  if (old && resolve(old) !== resolve(root)) {
    const move = (p: string): string | null => (sameOrInside(old, p) ? join(root, relative(old, p)) : null)
    db.exec('BEGIN')
    try {
      const upd = db.prepare('UPDATE files SET path = ? WHERE id = ?')
      for (const f of db.prepare('SELECT id, path FROM files').all() as { id: number; path: string }[]) {
        const np = move(f.path)
        if (np && np !== f.path) {
          upd.run(np, f.id)
          changed++
        }
      }
      const dl = get('downloads_dir')
      const ndl = dl ? move(dl) : null
      if (ndl) {
        put.run('downloads_dir', ndl)
        changed++
      }
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
  put.run('sync_root', root)
  put.run('last_host', thisHost())
  put.run('last_open', new Date().toISOString())
  return changed
}

// ------------------------------------------------------------ copias de seguridad

const KEEP_BACKUPS = 10

/**
 * Copia de seguridad consistente de la base de datos (VACUUM INTO funciona con la
 * base abierta). Se guardan las KEEP_BACKUPS más recientes. Devuelve la ruta.
 */
export function backupDb(db: DatabaseSync, dir: string, reason: string): string {
  const folder = join(dir, 'copias')
  mkdirSync(folder, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const safeReason = reason.replace(/[^a-z0-9-]+/gi, '-').slice(0, 30)
  let file = join(folder, `appclase-${stamp}-${safeReason}.db`)
  for (let n = 2; existsSync(file); n++) file = join(folder, `appclase-${stamp}-${safeReason}-${n}.db`)
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`)
  const all = readdirSync(folder)
    .filter((f) => /^appclase-.*\.db$/.test(f))
    .map((f) => ({ f, t: statSync(join(folder, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
  for (const old of all.slice(KEEP_BACKUPS)) rmSync(join(folder, old.f), { force: true })
  return file
}

/** Copia la base de datos abierta a otro sitio (sin pisar nada: el destino no debe existir). */
export function copyDbTo(db: DatabaseSync, file: string): void {
  mkdirSync(dirname(file), { recursive: true })
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`)
}

/** Aparta un fichero existente con un nombre «…-antes-<fecha>.db» para no perderlo. */
export function setAside(file: string): string | null {
  if (!existsSync(file)) return null
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const target = file.replace(/\.db$/, `-antes-${stamp}.db`)
  copyFileSync(file, target)
  for (const extra of ['', '-wal', '-shm', '-journal']) rmSync(`${file}${extra}`, { force: true })
  return target
}
