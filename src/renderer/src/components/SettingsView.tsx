import { useEffect, useState } from 'react'
import type { Opener, Settings, SyncStatus, Theme } from '../../../shared/types'
import { errorMessage } from '../util'
import Modal from './Modal'
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
  const [sync, setSync] = useState<SyncStatus | undefined>()
  /** Diálogo: 'subir' (activar con estos datos), 'adoptar' (usar los de OneDrive) o 'desactivar'. */
  const [syncDialog, setSyncDialog] = useState<null | 'subir' | 'adoptar' | 'desactivar'>(null)
  const [syncBusy, setSyncBusy] = useState(false)

  useEffect(() => {
    void window.api.settings.get().then(setSettings)
    void window.api.app.version().then(setVersion)
    void window.api.sync.status().then(setSync)
  }, [])

  const syncAction = async (fn: () => Promise<void>): Promise<void> => {
    setSyncBusy(true)
    try {
      await fn() // la app se reinicia
    } catch (err) {
      onToast(errorMessage(err), true)
      setSyncBusy(false)
      setSyncDialog(null)
      void window.api.sync.status().then(setSync)
    }
  }

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

      <h2>Apariencia</h2>
      <div className="theme-options" role="radiogroup" aria-label="Tema">
        {(
          [
            ['claro', 'Modo claro'],
            ['oscuro', 'Modo oscuro'],
            ['sistema', 'Como el sistema']
          ] as [Theme, string][]
        ).map(([t, label]) => (
          <button
            key={t}
            name={`theme_${t}`}
            role="radio"
            aria-checked={settings.theme === t}
            className={settings.theme === t ? 'active' : undefined}
            onClick={() => void save({ ...settings, theme: t })}
          >
            <span className={`theme-swatch ${t}`} />
            {label}
          </button>
        ))}
      </div>

      <h2>Plataforma del curso</h2>
      <p className="muted small" style={{ maxWidth: 620 }}>
        Al importar una actividad desde un enlace, sus ficheros se descargan en esta carpeta, dentro de una subcarpeta
        por asignatura y actividad.
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
            <input
              placeholder="Nombre (VS Code)"
              value={o.name}
              onChange={(e) => setOpener(idx, { name: e.target.value })}
              style={{ width: 150 }}
            />
            <input
              placeholder="Ruta del programa"
              value={o.command}
              onChange={(e) => setOpener(idx, { command: e.target.value })}
              style={{ flex: 1, minWidth: 180 }}
            />
            <input
              placeholder="Argumentos"
              value={o.args ?? ''}
              onChange={(e) => setOpener(idx, { args: e.target.value })}
              style={{ width: 120 }}
            />
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
        <button
          onClick={() =>
            setSettings({ ...settings, openers: [...settings.openers, { name: '', command: '', args: '' }] })
          }
        >
          Añadir programa
        </button>
      </div>

      <h2>Actualizaciones</h2>
      <div className="update-row">
        <div>
          <div>
            Cursia <strong>v{version}</strong>
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

      <h2>Sincronizar entre ordenadores</h2>
      {sync && (
        <div className="sync-box" data-sync={sync.enabled ? 'on' : 'off'}>
          {sync.enabled ? (
            <>
              <p>
                <strong className="sync-on">● Activada.</strong> Los datos están en OneDrive y se comparten con tus
                otros ordenadores.
              </p>
              <p className="muted small">
                Carpeta: <code>{sync.dataDir}</code>
              </p>
              <p className="muted small">
                Abre Cursia en un solo ordenador a la vez: si la abres en otro, te avisará. Antes de cambiar de
                ordenador, ciérrala y deja que OneDrive termine de sincronizar. Las copias de seguridad automáticas (las
                10 últimas) están en <code>{sync.backupsDir}</code>.
              </p>
              <p className="muted small">
                Los ficheros que estén fuera de OneDrive solo existen en el ordenador donde los añadiste: en los demás
                salen como «no se encuentra», pero no se quitan.
              </p>
              <div className="row-wrap">
                <button name="sync_disable" onClick={() => setSyncDialog('desactivar')}>
                  Desactivar en este ordenador
                </button>
              </div>
            </>
          ) : sync.oneDrive ? (
            <>
              {sync.noOneDrive && (
                <p className="bad small">
                  La sincronización estaba activada, pero al abrir no se encontró OneDrive: estás usando los datos de
                  este ordenador.
                </p>
              )}
              <p className="muted small" style={{ maxWidth: 620 }}>
                Guarda los datos de Cursia (asignaturas, entregas, notas e índice de ficheros) en tu OneDrive para
                tenerlos en todos tus ordenadores. Actívalo en cada uno.
                <br />
                OneDrive de este ordenador: <code>{sync.oneDrive}</code>
              </p>
              {sync.cloudHasData ? (
                <>
                  <p className="small">
                    Ya hay datos de Cursia en OneDrive
                    {sync.otherHost ? ` (ahora abiertos en «${sync.otherHost}»)` : ''}.
                  </p>
                  <div className="row-wrap">
                    <button name="sync_adopt" className="primary" onClick={() => setSyncDialog('adoptar')}>
                      Usar los datos de OneDrive
                    </button>
                  </div>
                </>
              ) : (
                <div className="row-wrap">
                  <button name="sync_enable" className="primary" onClick={() => setSyncDialog('subir')}>
                    Activar sincronización
                  </button>
                </div>
              )}
            </>
          ) : (
            <p className="muted small" style={{ maxWidth: 620 }}>
              No se encuentra OneDrive en este ordenador. Instálalo e inicia sesión para poder sincronizar los datos
              entre ordenadores.
            </p>
          )}
        </div>
      )}

      {syncDialog && (
        <Modal
          title={
            syncDialog === 'subir'
              ? '¿Activar la sincronización?'
              : syncDialog === 'adoptar'
                ? '¿Usar los datos de OneDrive?'
                : '¿Desactivar la sincronización?'
          }
          onClose={() => !syncBusy && setSyncDialog(null)}
        >
          <div className="form">
            {syncDialog === 'subir' && <p>Tus datos se copiarán a OneDrive y Cursia se reiniciará usándolos.</p>}
            {syncDialog === 'adoptar' && (
              <p>
                Cursia se reiniciará con los datos que hay en OneDrive (los de tu otro ordenador). Los datos que tenías
                en este ordenador no se borran: se quedan guardados aparte, pero dejarás de verlos.
              </p>
            )}
            {syncDialog === 'desactivar' && (
              <p>
                Se copiará a este ordenador lo que hay ahora en OneDrive y Cursia se reiniciará usando esa copia. Los
                cambios que hagas aquí ya no llegarán a tus otros ordenadores.
              </p>
            )}
            <div className="modal-actions">
              <button className="ghost" disabled={syncBusy} onClick={() => setSyncDialog(null)}>
                Cancelar
              </button>
              <button
                name="sync_confirm"
                className="primary"
                disabled={syncBusy}
                onClick={() =>
                  void syncAction(() =>
                    syncDialog === 'desactivar'
                      ? window.api.sync.disable()
                      : window.api.sync.enable({ adopt: syncDialog === 'adoptar' })
                  )
                }
              >
                {syncBusy ? 'Reiniciando…' : 'Aceptar y reiniciar'}
              </button>
            </div>
          </div>
        </Modal>
      )}

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
        Cursia {version}. Los ficheros nunca se copian ni se mueven: la app guarda su ruta.
      </p>
    </div>
  )
}
