import { useEffect, useState } from 'react'
import type { Opener, Settings } from '../../../shared/types'
import { describeUpdate, useUpdateStatus } from './UpdateBanner'

/**
 * Ajustes: nombre del curso y programas para «Abrir con».
 * «Abrir» usa siempre la aplicación predeterminada del sistema; aquí se
 * añaden programas concretos (por ejemplo VS Code) para abrir con ellos.
 */
export default function SettingsView({
  onSaved,
  onToast
}: {
  onSaved: (s: Settings) => void
  onToast: (m: string, bad?: boolean) => void
}) {
  const [settings, setSettings] = useState<Settings | undefined>()
  const [version, setVersion] = useState('')
  const update = useUpdateStatus()

  useEffect(() => {
    void window.api.settings.get().then(setSettings)
    void window.api.app.version().then(setVersion)
  }, [])

  if (!settings) return <div className="page" />

  const save = async (next: Settings): Promise<void> => {
    const saved = await window.api.settings.save(next)
    setSettings(saved)
    onSaved(saved)
  }

  const setOpener = (idx: number, patch: Partial<Opener>): void => {
    const openers = settings.openers.map((o, i) => (i === idx ? { ...o, ...patch } : o))
    setSettings({ ...settings, openers })
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Ajustes</h1>
      </div>

      <h2>Curso</h2>
      <label className="field" style={{ maxWidth: 320 }}>
        Nombre del curso
        <input
          value={settings.course_name}
          onChange={(e) => setSettings({ ...settings, course_name: e.target.value })}
          onBlur={() => void save(settings)}
        />
      </label>

      <h2>Plataforma del curso</h2>
      <p className="muted small" style={{ maxWidth: 620 }}>
        Al importar una actividad desde un enlace, sus ficheros se descargan en esta carpeta, dentro de una
        subcarpeta por asignatura y actividad.
      </p>
      <div className="row" style={{ maxWidth: 620 }}>
        <input readOnly value={settings.downloads_dir} style={{ flex: 1 }} title={settings.downloads_dir} />
        <button
          onClick={async () => {
            const dir = await window.api.settings.chooseDownloadsDir()
            if (dir) await save({ ...settings, downloads_dir: dir })
          }}
        >
          Cambiar…
        </button>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button
          onClick={async () => {
            await window.api.importer.logout()
            onToast('Sesión de la plataforma cerrada: la próxima importación te pedirá entrar de nuevo')
          }}
        >
          Cerrar sesión de la plataforma
        </button>
      </div>

      <h2>Abrir con</h2>
      <p className="muted small" style={{ maxWidth: 620 }}>
        El botón «Abrir» usa la aplicación que el sistema tenga asociada a cada tipo de fichero. Aquí puedes añadir
        programas concretos para abrir un fichero con ellos desde el menú «Abrir con».
      </p>

      <div className="list">
        {settings.openers.map((o, idx) => (
          <div key={idx} className="list-row">
            <input placeholder="Nombre (VS Code)" value={o.name} onChange={(e) => setOpener(idx, { name: e.target.value })} style={{ width: 150 }} />
            <input
              placeholder="Ruta del programa"
              value={o.command}
              onChange={(e) => setOpener(idx, { command: e.target.value })}
              style={{ flex: 1, minWidth: 180 }}
            />
            <input placeholder="Argumentos" value={o.args ?? ''} onChange={(e) => setOpener(idx, { args: e.target.value })} style={{ width: 120 }} />
            <button
              className="tiny"
              onClick={async () => {
                const p = await window.api.settings.chooseExecutable()
                if (p) setOpener(idx, { command: p })
              }}
            >
              Elegir…
            </button>
            <button className="tiny primary" onClick={() => void save(settings)}>
              Guardar
            </button>
            <button
              className="tiny danger ghost"
              onClick={() => void save({ ...settings, openers: settings.openers.filter((_, i) => i !== idx) })}
            >
              Quitar
            </button>
          </div>
        ))}
      </div>

      <div className="row" style={{ marginTop: 12 }}>
        <button onClick={() => setSettings({ ...settings, openers: [...settings.openers, { name: '', command: '', args: '' }] })}>
          Añadir programa
        </button>
      </div>

      <h2>Actualizaciones</h2>
      <div className="update-row">
        <div>
          <div>
            AppClase <strong>v{version}</strong>
          </div>
          <div className="muted small">{describeUpdate(update)}</div>
        </div>
        {update.state === 'downloaded' ? (
          <button className="primary" onClick={() => void window.api.app.installUpdate()}>
            Reiniciar y actualizar
          </button>
        ) : (
          <button
            onClick={() => void window.api.app.checkForUpdates()}
            disabled={['checking', 'downloading', 'disabled'].includes(update.state)}
          >
            Buscar actualizaciones
          </button>
        )}
      </div>

      <h2>Mantenimiento</h2>
      <div className="row-wrap">
        <button
          onClick={async () => {
            const n = await window.api.files.revalidate()
            onToast(n ? `${n} fichero${n === 1 ? '' : 's'} con cambios` : 'Todos los ficheros están al día')
          }}
        >
          Comprobar todos los ficheros
        </button>
      </div>
      <p className="muted small" style={{ marginTop: 16 }}>
        AppClase {version}. Los ficheros nunca se copian ni se mueven: la app guarda su ruta.
      </p>
    </div>
  )
}
