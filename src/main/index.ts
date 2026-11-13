import { app, BrowserWindow, shell } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { openDatabase } from './db'
import { registerIpc } from './ipc'

const dataDir = process.env.APPCLASE_DATA_DIR ?? join(app.getPath('userData'), 'datos')

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 940,
    minHeight: 600,
    title: 'AppClase',
    backgroundColor: '#16171b',
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

app.whenReady().then(() => {
  mkdirSync(dataDir, { recursive: true })
  const db = openDatabase(join(dataDir, 'appclase.db'))
  registerIpc(db)
  createWindow()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
  app.on('will-quit', () => db.close())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
