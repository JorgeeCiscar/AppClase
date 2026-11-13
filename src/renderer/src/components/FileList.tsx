import { useCallback, useEffect, useRef, useState } from 'react'
import type { FileRef, Opener } from '../../../shared/types'
import { fileIcon, fmtDateTime, fmtSize } from '../util'

/**
 * Lista de ficheros de un elemento. Los ficheros se REFERENCIAN por su ruta:
 * «Abrir» los abre con la aplicación que tenga asociada el sistema, así que
 * los editas con tus programas de siempre y la app solo guarda dónde están.
 */
export default function FileList({
  itemId,
  openers,
  onToast,
  onChanged
}: {
  itemId: number
  openers: Opener[]
  onToast: (msg: string, bad?: boolean) => void
  onChanged?: () => void
}) {
  const [files, setFiles] = useState<FileRef[]>([])
  const [over, setOver] = useState(false)
  const [menuFor, setMenuFor] = useState<number | null>(null)
  const dragDepth = useRef(0)

  const load = useCallback(async () => {
    setFiles(await window.api.files.list(itemId))
  }, [itemId])

  useEffect(() => {
    void load()
  }, [load])

  // Al volver a la ventana se comprueba el disco: si editaste un fichero fuera,
  // la fecha se actualiza; si lo moviste o borraste, sale marcado como perdido.
  useEffect(() => {
    const onFocus = (): void => void load()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load])

  const report = (r: { added: number; skipped: number; errors: string[] }): void => {
    const parts: string[] = []
    if (r.added) parts.push(`${r.added} fichero${r.added === 1 ? '' : 's'} añadido${r.added === 1 ? '' : 's'}`)
    if (r.skipped) parts.push(`${r.skipped} ya estaba${r.skipped === 1 ? '' : 'n'}`)
    if (r.errors.length) parts.push(r.errors[0])
    if (parts.length) onToast(parts.join(' · '), r.added === 0 && r.errors.length > 0)
    void load()
    onChanged?.()
  }

  const act = async (fn: () => Promise<{ ok: boolean; error?: string }>): Promise<void> => {
    const r = await fn()
    if (!r.ok && r.error) onToast(r.error, true)
    void load()
  }

  const onDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    dragDepth.current = 0
    setOver(false)
    const dropped = Array.from(e.dataTransfer.files)
    if (!dropped.length) return
    // Electron 32 quitó File.path; la ruta real llega por webUtils (ver preload).
    const paths = dropped.map((f) => window.api.app.pathForFile(f)).filter(Boolean)
    if (!paths.length) {
      onToast('No se pudo leer la ruta de lo que has soltado', true)
      return
    }
    report(await window.api.files.addPaths(itemId, paths))
  }

  return (
    <div onClick={() => setMenuFor(null)}>
      <div className="row-wrap" style={{ marginBottom: 10 }}>
        <button onClick={async () => report(await window.api.files.choose(itemId))}>Añadir ficheros…</button>
        <button onClick={async () => report(await window.api.files.chooseFolder(itemId))}>Añadir carpeta…</button>
        <span className="spacer" />
        <button
          className="ghost small"
          onClick={async () => {
            const n = await window.api.files.revalidate(itemId)
            onToast(n ? `${n} fichero${n === 1 ? '' : 's'} con cambios` : 'Todo al día')
            void load()
          }}
        >
          Comprobar ficheros
        </button>
      </div>

      {files.length === 0 && <p className="muted small">Sin ficheros. Añádelos o arrástralos aquí desde el explorador.</p>}

      <div className="files">
        {files.map((f) => (
          <div key={f.id} className={`file-row${f.missing ? ' missing' : ''}`}>
            <span className="icon">{fileIcon(f.ext)}</span>
            <div className="col" style={{ minWidth: 0, flex: 1 }}>
              <div className="fname" title={f.name}>
                {f.name} {f.missing ? <span className="chip-missing">no se encuentra</span> : null}
              </div>
              <div className="fpath" title={f.path}>
                {f.path}
              </div>
              {!f.missing && (
                <div className="small muted">
                  {fmtSize(f.size)}
                  {f.mtime ? ` · modificado ${fmtDateTime(f.mtime)}` : ''}
                </div>
              )}
            </div>

            {f.missing ? (
              <button
                className="tiny"
                onClick={async () => {
                  try {
                    await window.api.files.relocate(f.id)
                    void load()
                  } catch (e) {
                    onToast((e as Error).message, true)
                  }
                }}
              >
                Buscar de nuevo…
              </button>
            ) : (
              <>
                <button className="tiny primary" onClick={() => act(() => window.api.files.open(f.id))}>
                  Abrir
                </button>
                {openers.length > 0 && (
                  <span style={{ position: 'relative' }}>
                    <button
                      className="tiny"
                      onClick={(e) => {
                        e.stopPropagation()
                        setMenuFor(menuFor === f.id ? null : f.id)
                      }}
                    >
                      Abrir con ▾
                    </button>
                    {menuFor === f.id && (
                      <span
                        style={{
                          position: 'absolute',
                          right: 0,
                          top: '100%',
                          marginTop: 4,
                          background: 'var(--panel)',
                          border: '1px solid var(--border)',
                          borderRadius: 6,
                          zIndex: 20,
                          display: 'flex',
                          flexDirection: 'column',
                          minWidth: 150
                        }}
                      >
                        {openers.map((o, idx) => (
                          <button
                            key={o.name + idx}
                            className="ghost tiny"
                            style={{ textAlign: 'left' }}
                            onClick={() => {
                              setMenuFor(null)
                              void act(() => window.api.files.openWith(f.id, idx))
                            }}
                          >
                            {o.name}
                          </button>
                        ))}
                      </span>
                    )}
                  </span>
                )}
                <button className="tiny" onClick={() => act(() => window.api.files.reveal(f.id))}>
                  Carpeta
                </button>
              </>
            )}
            <button
              className="tiny danger"
              title="Quitar del índice (el fichero no se borra del disco)"
              onClick={async () => {
                await window.api.files.remove(f.id)
                void load()
                onChanged?.()
              }}
            >
              Quitar
            </button>
          </div>
        ))}
      </div>

      <div
        className={`dropzone${over ? ' over' : ''}`}
        onDragEnter={(e) => {
          e.preventDefault()
          dragDepth.current++
          setOver(true)
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => {
          dragDepth.current--
          if (dragDepth.current <= 0) setOver(false)
        }}
        onDrop={onDrop}
      >
        Arrastra aquí ficheros o carpetas del explorador
      </div>
    </div>
  )
}
