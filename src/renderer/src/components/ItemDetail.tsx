import { useEffect, useState } from 'react'
import type { Item, Opener, Status } from '../../../shared/types'
import { STATUSES } from '../../../shared/types'
import { KIND_LABEL, dueLabel, fmtDate } from '../util'
import FileList from './FileList'
import Modal from './Modal'

export default function ItemDetail({
  itemId,
  openers,
  onToast,
  onEdit,
  onChanged,
  onClose
}: {
  itemId: number
  openers: Opener[]
  onToast: (msg: string, bad?: boolean) => void
  onEdit: (i: Item) => void
  onChanged: () => void
  onClose: () => void
}) {
  const [item, setItem] = useState<Item | undefined>()

  const load = async (): Promise<void> => setItem(await window.api.items.get(itemId))
  useEffect(() => {
    void load()
  }, [itemId])

  if (!item) return null

  const setStatus = async (s: Status | null): Promise<void> => {
    setItem(await window.api.items.setStatus(item.id, s))
    onChanged()
  }

  return (
    <Modal title={item.title} onClose={onClose}>
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
          <button
            key={s}
            className={`tiny${item.status === s ? ' primary' : ''}`}
            onClick={() => void setStatus(s)}
          >
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
        <p className="small">
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
        <button
          className="danger"
          onClick={async () => {
            if (!window.confirm(`¿Borrar «${item.title}»? Los ficheros seguirán en el disco.`)) return
            await window.api.items.remove(item.id)
            onChanged()
            onClose()
          }}
        >
          Borrar elemento
        </button>
        <span className="spacer" />
        <button onClick={() => onEdit(item)}>Editar</button>
        <button className="primary" onClick={onClose}>
          Cerrar
        </button>
      </div>
    </Modal>
  )
}
