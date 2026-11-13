import { app, BrowserWindow, ipcMain } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateStatus } from '../shared/types'

const { autoUpdater } = electronUpdater
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000 // cada 4 horas

let status: UpdateStatus = { state: 'idle' }

function broadcast(s: UpdateStatus): void {
  status = s
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('update:status', s)
}

/** Traduce los errores habituales de electron-updater a algo que se entienda. */
export function friendlyError(raw: string): string {
  if (/No published versions|Unable to find latest version|latest\.yml|\b404\b/i.test(raw)) {
    return 'todavía no hay ninguna versión publicada en GitHub'
  }
  if (/net::ERR_|ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ECONNRESET|EAI_AGAIN/i.test(raw)) {
    return 'sin conexión a internet'
  }
  return raw
}

/**
 * Actualizaciones automáticas desde GitHub Releases: se descargan en segundo plano
 * y se instalan al cerrar la app (o al pulsar «Reiniciar y actualizar»).
 */
export function setupUpdater(): void {
  ipcMain.handle('update:status', () => status)
  ipcMain.handle('update:check', () => check(true))
  ipcMain.handle('update:install', () => {
    if (status.state === 'downloaded') autoUpdater.quitAndInstall(true, true)
  })

  if (!app.isPackaged) {
    status = { state: 'disabled', message: 'Las actualizaciones solo funcionan en la app instalada' }
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => broadcast({ state: 'checking' }))
  autoUpdater.on('update-available', (i) => broadcast({ state: 'downloading', version: i.version, percent: 0 }))
  autoUpdater.on('download-progress', (p) =>
    broadcast({ state: 'downloading', version: status.version, percent: Math.round(p.percent) })
  )
  autoUpdater.on('update-not-available', () => broadcast({ state: 'none' }))
  autoUpdater.on('update-downloaded', (i) => broadcast({ state: 'downloaded', version: i.version }))
  autoUpdater.on('error', (err) =>
    broadcast({ state: 'error', message: friendlyError(err?.message ?? String(err)) })
  )

  setTimeout(() => void check(false), 10_000)
  setInterval(() => void check(false), CHECK_EVERY_MS)
}

async function check(manual: boolean): Promise<UpdateStatus> {
  if (!app.isPackaged) return status
  // No interrumpir una descarga en curso ni volver a descargar lo ya descargado.
  if (status.state === 'downloading' || status.state === 'downloaded') return status
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    // Sin conexión, etc.: solo se muestra si el usuario lo pidió.
    if (manual) broadcast({ state: 'error', message: friendlyError(err instanceof Error ? err.message : String(err)) })
  }
  return status
}
