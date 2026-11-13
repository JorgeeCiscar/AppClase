import { useEffect, useState } from 'react'
import type { UpdateStatus } from '../../../shared/types'

export function useUpdateStatus(): UpdateStatus {
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' })
  useEffect(() => {
    void window.api.app.updateStatus().then(setStatus)
    return window.api.app.onUpdateStatus(setStatus)
  }, [])
  return status
}

const timeOf = (iso?: string): string =>
  iso ? new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''

export function describeUpdate(s: UpdateStatus): string {
  const at = timeOf(s.checkedAt)
  switch (s.state) {
    case 'checking':
      return 'Buscando actualizaciones…'
    case 'none':
      return at ? `Tienes la última versión · comprobado a las ${at}` : 'Tienes la última versión'
    case 'downloading':
      return `Descargando la versión ${s.version ?? ''}… ${s.percent ?? 0} %`
    case 'downloaded':
      return `Versión ${s.version} lista para instalar`
    case 'error':
      return `No se pudo comprobar${at ? ` (${at})` : ''}: ${s.message ?? 'error desconocido'}`
    case 'disabled':
      return s.message ?? 'Actualizaciones desactivadas'
    default:
      return 'Se comprueban automáticamente al abrir la app y cada 4 horas'
  }
}

/** Aviso en la barra lateral cuando hay una actualización descargada o en curso. */
export default function UpdateBanner() {
  const s = useUpdateStatus()
  if (s.state === 'downloading') return <div className="update-banner muted small">{describeUpdate(s)}</div>
  if (s.state !== 'downloaded') return null
  return (
    <div className="update-banner ready">
      <strong>Nueva versión {s.version}</strong>
      <span className="small">Se instalará al cerrar AppClase.</span>
      <button className="primary" onClick={() => void window.api.app.installUpdate()}>
        Reiniciar y actualizar
      </button>
    </div>
  )
}

export function AppVersion() {
  const [v, setV] = useState('')
  useEffect(() => {
    void window.api.app.version().then(setV)
  }, [])
  return <div className="app-version muted small">{v && `v${v}`}</div>
}
