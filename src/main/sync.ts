// Datos sincronizados entre ordenadores por OneDrive: dónde se abren, la marca de
// «en uso», las copias de seguridad y activar o desactivar la sincronización.
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { SyncStatus } from '../shared/types'
import { openDatabase, type DB } from './db'
import { setSyncRoot } from './files'
import {
  BEAT_MS,
  DB_FILE,
  backupDb,
  beat,
  cloudDataDir,
  copyDbTo,
  detectOneDrive,
  lockState,
  newMe,
  readConfig,
  readLock,
  rebasePaths,
  releaseLock,
  setAside,
  thisHost,
  writeConfig,
  writeLock,
  type Me
} from './syncCore'

/** En las pruebas: sin diálogos nativos (se usa APPCLASE_LOCK_ANSWER) y sin reiniciar. */
const TEST = process.env.APPCLASE_TEST === '1'

interface State {
  db: DB
  configDir: string
  localDir: string
  /** Carpeta de OneDrive cuando los datos están sincronizados; null si son locales. */
  root: string | null
  dataDir: string
  me: Me
  /** La sincronización está activada pero no se encontró OneDrive en este ordenador. */
  noOneDrive: boolean
  timer: NodeJS.Timeout | null
  lastBackup: number
  cleanup: () => void
}

let st: State | null = null

const beatMs = (): number => Number(process.env.APPCLASE_BEAT_MS) || BEAT_MS

/** Pregunta con un diálogo nativo (o con la respuesta fijada en las pruebas). */
async function ask(message: string, detail: string, buttons: string[], testAnswer?: string): Promise<number> {
  if (TEST) {
    const i = buttons.findIndex((b) => b.toLowerCase().startsWith((testAnswer ?? '').toLowerCase()))
    return i >= 0 ? i : buttons.length - 1
  }
  const r = await dialog.showMessageBox({
    type: 'warning',
    title: 'Cursia',
    message,
    detail,
    buttons,
    cancelId: buttons.length - 1,
    noLink: true
  })
  return r.response
}

const fmtTime = (iso: string | undefined): string => {
  const d = iso ? new Date(iso) : null
  return d && !isNaN(+d) ? d.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : '¿?'
}

/**
 * Abre la base de datos que toque en este ordenador. Devuelve null si el usuario
 * prefiere salir (los datos están abiertos en otro ordenador).
 */
export async function openData(cleanup: () => void): Promise<DB | null> {
  const configDir = process.env.APPCLASE_CONFIG_DIR ?? app.getPath('userData')
  const localDir = process.env.APPCLASE_DATA_DIR ?? join(app.getPath('userData'), 'datos')
  const config = readConfig(configDir)
  const me = newMe()
  let root = config.sync ? detectOneDrive() : null
  let noOneDrive = false

  if (config.sync && !root) {
    const r = await ask(
      'No se encuentra la carpeta de OneDrive',
      'La sincronización está activada, pero OneDrive no está en este ordenador (o no ha iniciado sesión). ' +
        'Puedes abrir los datos que hay solo en este ordenador; lo que cambies no llegará a los demás.',
      ['Abrir los datos de este ordenador', 'Salir'],
      process.env.APPCLASE_LOCK_ANSWER
    )
    if (r !== 0) return null
    noOneDrive = true
  }

  const dataDir = root ? cloudDataDir(root) : localDir
  mkdirSync(dataDir, { recursive: true })

  if (root) {
    for (;;) {
      const l = lockState(dataDir, me)
      if (l.state === 'libre') break
      const r = await ask(
        `Cursia está abierta en «${l.info?.host}»`,
        `Los datos se están usando en el otro ordenador (desde ${fmtTime(l.info?.since)}). Ciérrala allí, ` +
          'espera a que OneDrive termine de sincronizar y pulsa «Reintentar». ' +
          'Si la abres igualmente, el otro ordenador se cerrará al darse cuenta, y lo que cambiaste allí ' +
          'desde su última sincronización puede perderse.',
        ['Reintentar', 'Abrir igualmente', 'Salir'],
        process.env.APPCLASE_LOCK_ANSWER
      )
      if (r === 1) break
      if (r !== 0) return null
    }
    writeLock(dataDir, me)
  }

  const db = openDatabase(join(dataDir, DB_FILE), root ? 'DELETE' : 'WAL')
  st = { db, configDir, localDir, root, dataDir, me, noOneDrive, timer: null, lastBackup: 0, cleanup }
  if (root) {
    rebasePaths(db, root)
    setSyncRoot(root)
    backup('inicio', true)
    st.timer = setInterval(heartbeat, beatMs())
  }
  return db
}

/** Renueva la marca «en uso»; si otro ordenador ha tomado el relevo, se cierra sin escribir más. */
function heartbeat(): void {
  if (!st?.root) return
  let mine = true
  try {
    mine = beat(st.dataDir, st.me)
  } catch {
    return // OneDrive no disponible un momento: se reintenta en el siguiente latido
  }
  if (mine) return
  const other = readLock(st.dataDir)
  stopTimer()
  st.cleanup() // cierra la base de datos: desde aquí ya no se escribe nada
  st.cleanup = () => {}
  void (async () => {
    if (!TEST)
      await dialog.showMessageBox({
        type: 'warning',
        title: 'Cursia',
        message: `Se ha abierto Cursia en «${other?.host ?? 'otro ordenador'}»`,
        detail: 'Para no mezclar cambios, aquí se cierra. Lo que hiciste antes ya está guardado.',
        buttons: ['Cerrar']
      })
    app.exit(0)
  })()
}

function stopTimer(): void {
  if (st?.timer) clearInterval(st.timer)
  if (st) st.timer = null
}

/** Al cerrar la app: se quita la marca «en uso». */
export function closeData(): void {
  if (!st) return
  stopTimer()
  if (st.root) {
    try {
      releaseLock(st.dataDir, st.me)
    } catch {
      /* OneDrive no disponible */
    }
  }
}

/**
 * Copia de seguridad antes de algo delicado, solo con los datos en OneDrive. Como
 * mucho una cada 10 minutos (salvo force).
 */
export function backup(reason: string, force = false): void {
  if (!st?.root) return
  const now = Date.now()
  if (!force && now - st.lastBackup < 10 * 60 * 1000) return
  try {
    backupDb(st.db, st.dataDir, reason)
    st.lastBackup = now
  } catch (e) {
    console.error('No se pudo hacer la copia de seguridad:', e)
  }
}

function status(): SyncStatus {
  const root = st?.root ?? detectOneDrive()
  const cloud = root ? cloudDataDir(root) : null
  const lock = cloud ? readLock(cloud) : null
  return {
    enabled: !!st?.root,
    noOneDrive: !!st?.noOneDrive,
    oneDrive: root,
    dataDir: st?.dataDir ?? '',
    cloudHasData: !!cloud && existsSync(join(cloud, DB_FILE)),
    host: thisHost(),
    otherHost: lock && lock.id !== st?.me.id && lock.host !== thisHost() ? lock.host : null,
    backupsDir: cloud ? join(cloud, 'copias') : null
  }
}

/** Cierra todo y vuelve a abrir la app (en las pruebas, solo se cierra). */
function restart(): void {
  if (!st) return
  const s = st
  closeData()
  s.cleanup()
  s.cleanup = () => {}
  st = null
  if (!TEST) app.relaunch()
  setTimeout(() => app.exit(0), 50)
}

export function registerSyncIpc(): void {
  const h = (channel: string, fn: (...args: never[]) => unknown): void => {
    ipcMain.handle(channel, (_e, ...args) => (fn as (...a: unknown[]) => unknown)(...args))
  }
  h('sync:status', () => status())
  h('sync:backup', (reason: string) => backup(String(reason || 'manual')))

  // Activar: subir estos datos a OneDrive o, si ya hay, usar los de OneDrive (adopt).
  h('sync:enable', (opts?: { adopt?: boolean }) => {
    if (!st) throw new Error('La app aún no ha terminado de abrir los datos')
    if (st.root) throw new Error('La sincronización ya está activada')
    const root = detectOneDrive()
    if (!root) throw new Error('No se encuentra la carpeta de OneDrive en este ordenador')
    const cloud = cloudDataDir(root)
    const cloudFile = join(cloud, DB_FILE)
    if (existsSync(cloudFile)) {
      if (!opts?.adopt) throw new Error('Ya hay datos de Cursia en OneDrive: elige si usarlos')
      const l = lockState(cloud, st.me)
      if (l.state === 'otro') throw new Error(`Ahora están abiertos en «${l.info?.host}»: ciérrala allí primero`)
      // Los datos de este ordenador no se pierden: quedan en su carpeta local.
    } else {
      copyDbTo(st.db, cloudFile)
    }
    writeConfig(st.configDir, { sync: true })
    BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('sync:restarting'))
    restart()
  })

  // Desactivar: los datos de OneDrive pasan a este ordenador (los locales anteriores se apartan).
  h('sync:disable', () => {
    if (!st) throw new Error('La app aún no ha terminado de abrir los datos')
    if (!st.root) {
      writeConfig(st.configDir, { sync: false })
      return restart()
    }
    mkdirSync(st.localDir, { recursive: true })
    const localFile = join(st.localDir, DB_FILE)
    setAside(localFile)
    copyDbTo(st.db, localFile)
    writeConfig(st.configDir, { sync: false })
    restart()
  })
}
