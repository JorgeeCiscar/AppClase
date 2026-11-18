import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import type { DB } from './db'
import { applyTheme, getSettings, registerIpc, windowBackground } from './ipc'
import { closeData, openData, registerSyncIpc } from './sync'
import { setupUpdater } from './updater'
import { startWatching, stopWatching } from './watcher'

// Las pruebas usan su propia carpeta de usuario (y así pueden simular dos ordenadores).
if (process.env.APPCLASE_CONFIG_DIR) app.setPath('userData', process.env.APPCLASE_CONFIG_DIR)

// Una sola ventana de Cursia: abrirla otra vez lleva a la que ya está abierta.
if (!app.requestSingleInstanceLock()) app.quit()
else
  app.on('second-instance', () => {
    const w = BrowserWindow.getAllWindows()[0]
    if (w) {
      if (w.isMinimized()) w.restore()
      w.focus()
    }
  })

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 940,
    minHeight: 600,
    title: 'Cursia',
    backgroundColor: windowBackground(),
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.once('ready-to-show', () => win.show())
  // Los enlaces externos se abren en el navegador del sistema, no en la app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(async () => {
  let db: DB | null = null
  /** Deja de vigilar y cierra la base de datos (una sola vez). */
  let closed = false
  const cleanup = (): void => {
    if (closed) return
    closed = true
    stopWatching()
    db?.close()
  }
  db = await openData(cleanup)
  if (!db) return app.exit(0)
  applyTheme(getSettings(db).theme)
  registerIpc(db)
  registerSyncIpc()
  startWatching(db)
  setupUpdater()
  createWindow()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
  app.on('will-quit', () => {
    closeData()
    cleanup()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
