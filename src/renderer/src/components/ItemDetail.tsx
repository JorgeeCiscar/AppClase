import { useEffect, useState, type ReactNode } from 'react'
import type { Item, Opener, Status } from '../../../shared/types'
import { STATUSES } from '../../../shared/types'
import { KIND_LABEL, dueLabel, errorMessage, fmtDate } from '../util'
import FileList from './FileList'
import Modal from './Modal'

/** Confirmación de borrado: por defecto, los ficheros también van a la papelera. */
function ConfirmDelete({
  item,
  onDone,
  onCancel,
  onToast
}: {
  item: Item
  onDone: () => void
  onCancel: () => void
  onToast: (msg: string, bad?: boolean) => void
}) {
  const [trash, setTrash] = useState(item.file_count > 0)
  const [busy, setBusy] = useState(false)
  const n = item.file_count
  return (
    <Modal title={`¿Borrar «${item.title}»?`} onClose={onCancel}>
      <div className="form">
        {n > 0 ? (
          <label className="row">
            <input name="trash_files" type="checkbox" checked={trash} onChange={(e) => setTrash(e.target.checked)} />
            Enviar también {n === 1 ? 'su fichero' : `sus ${n} ficheros`} a la papelera de reciclaje
          </label>
        ) : (
          <p className="muted small">No tiene ficheros.</p>
        )}
        {n > 0 && (
          <p className="muted small">
            {trash
              ? 'Se pueden recuperar desde la papelera. Si algún fichero lo usa también otra actividad, no se toca.'
              : 'Los ficheros se quedarán en su carpeta; solo se quita la actividad de la app.'}
          </p>
        )}
        <div className="modal-actions">
          <button className="ghost" onClick={onCancel} disabled={busy}>
            Cancelar
          </button>
          <button
            className="danger-solid"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                const r = await window.api.items.remove(item.id, { trashFiles: trash })
                if (r.errors.length) onToast(`Actividad borrada, pero no se pudo enviar a la papelera ${r.errors[0]}`, true)
                else if (r.trashed) onToast(`Actividad borrada · ${r.trashed} fichero${r.trashed === 1 ? '' : 's'} a la papelera`)
                else onToast('Actividad borrada')
                onDone()
              } catch (err) {
                onToast(errorMessage(err), true)
                setBusy(false)
              }
            }}
          >
            Borrar
          </button>
        </div>
      </div>
    </Modal>
  )
}

/**
 * Ficha de un elemento. En Entregas se muestra como panel a la derecha (asPanel),
 * sin tapar la lista; en el resto, como ventana.
 */
export default function ItemDetail({
  itemId,
  openers,
  onToast,
  onEdit,
  onChanged,
  onClose,
  asPanel = false
}: {
  itemId: number
  openers: Opener[]
  onToast: (msg: string, bad?: boolean) => void
  onEdit: (i: Item) => void
  onChanged: () => void
  onClose: () => void
  asPanel?: boolean
}) {
  const [item, setItem] = useState<Item | undefined>()
  const [confirming, setConfirming] = useState(false)

  const load = async (): Promise<void> => setItem(await window.api.items.get(itemId))
  useEffect(() => {
    void load()
    // Si un fichero cambia en la carpeta, se actualizan también los contadores de la ficha.
    return window.api.files.onChanged(() => void load())
  }, [itemId])

  if (!item) return null

  const setStatus = async (s: Status | null): Promise<void> => {
    setItem(await window.api.items.setStatus(item.id, s))
    onChanged()
  }

  const body = (
    <>
      <div className="row-wrap" style={{ marginBottom: 6 }}>
        <span className="badge kind">{KIND_LABEL[item.kind] ?? item.kind}</span>
        <span className="muted small">{item.subject_name}</span>
        {item.unit_title && (
          <span className="muted small">
            · {item.unit_number !== null ? `${item.unit_number}. ` : ''}
            {item.unit_title}
          </span>
        )}
        {item.grade !== null && <span className="badge">nota {item.grade}</span>}
      </div>

      {item.due_date && (
        <p className="small" style={{ margin: '4px 0' }}>
          Fecha límite: <strong>{fmtDate(item.due_date)}</strong> <span className="muted">({dueLabel(item.due_date)})</span>
        </p>
      )}

      <div className="row-wrap" style={{ margin: '10px 0' }}>
        <span className="muted small">Estado:</span>
        {STATUSES.map((s) => (
          <button key={s} className={`tiny${item.status === s ? ' primary' : ''}`} onClick={() => void setStatus(s)}>
            {s}
          </button>
        ))}
        {item.status && (
          <button className="tiny ghost" onClick={() => void setStatus(null)}>
            quitar
          </button>
        )}
      </div>

      {item.tags.length > 0 && (
        <div className="row-wrap" style={{ margin: '8px 0' }}>
          {item.tags.map((t) => (
            <span className="badge tag" key={t}>
              {t}
            </span>
          ))}
        </div>
      )}

      {item.url && (
        <p className="small detail-url">
          <a href={item.url} target="_blank" rel="noreferrer">
            {item.url}
          </a>
        </p>
      )}

      {item.notes && <p style={{ whiteSpace: 'pre-wrap' }}>{item.notes}</p>}

      <h2>Ficheros</h2>
      <FileList
        itemId={item.id}
        openers={openers}
        onToast={onToast}
        onChanged={() => {
          void load()
          onChanged()
        }}
      />

      <div className="modal-actions">
        <button className="danger" onClick={() => setConfirming(true)}>
          Borrar elemento
        </button>
        <span className="spacer" />
        <button onClick={() => onEdit(item)}>Editar</button>
        <button className="primary" onClick={onClose}>
          Cerrar
        </button>
      </div>

      {confirming && (
        <ConfirmDelete
          item={item}
          onToast={onToast}
          onCancel={() => setConfirming(false)}
          onDone={() => {
            setConfirming(false)
            onChanged()
            onClose()
          }}
        />
      )}
    </>
  )

  const shell = (children: ReactNode): JSX.Element =>
    asPanel ? (
      <aside className="detail-pane" aria-label={item.title}>
        <div className="detail-pane-head">
          <h3>{item.title}</h3>
          <button className="ghost tiny" aria-label="Cerrar la ficha" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </aside>
    ) : (
      <Modal title={item.title} onClose={onClose}>
        {children}
      </Modal>
    )

  return shell(body)
}
