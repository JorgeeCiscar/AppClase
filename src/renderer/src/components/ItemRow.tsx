import type { Item } from '../../../shared/types'
import { KIND_LABEL, URGENCY_LABEL, dueLabel, fmtDate, urgencyOf } from '../util'

const statusClass = (s: string | null): string => (s ? `status-${s.replace(/\s+/g, '')}` : '')

/** Fila compacta de un elemento, reutilizada en panel, asignatura, entregas y búsqueda. */
export default function ItemRow({
  item,
  onOpen,
  showSubject = false,
  selected = false,
  selectable = false,
  checked = false
}: {
  item: Item
  onOpen: (i: Item) => void
  showSubject?: boolean
  /** Es la que tiene la ficha abierta al lado. */
  selected?: boolean
  /** Modo selección: muestra una casilla y pulsar la marca o desmarca. */
  selectable?: boolean
  checked?: boolean
}) {
  // El color de la fila cambia según se acerca la fecha de entrega.
  const urgency = urgencyOf(item.due_date, item.status)
  // Asignatura, unidad y ficheros, unidos con « · » solo entre los que haya.
  const sub = [
    showSubject ? item.subject_name : null,
    item.unit_title ? `${item.unit_number !== null ? item.unit_number + '. ' : ''}${item.unit_title}` : null,
    item.file_count > 0 ? `${item.file_count} fichero${item.file_count === 1 ? '' : 's'}` : null,
    item.missing_count > 0 ? `${item.missing_count} sin encontrar` : null
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div
      className={`list-row clickable${urgency ? ` urg urg-${urgency}` : ''}${selected ? ' is-open' : ''}${
        selectable ? ' selectable' : ''
      }${checked ? ' is-checked' : ''}`}
      aria-checked={selectable ? checked : undefined}
      data-urgency={urgency ?? undefined}
      title={urgency ? URGENCY_LABEL[urgency] : undefined}
      onClick={() => onOpen(item)}
    >
      {selectable && (
        <input
          type="checkbox"
          className="card-check"
          checked={checked}
          readOnly
          tabIndex={-1}
          aria-label={`Seleccionar «${item.title}»`}
        />
      )}
      <span className="badge kind">{KIND_LABEL[item.kind] ?? item.kind}</span>
      <div className="col">
        <div className="title">{item.title}</div>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {item.tags.slice(0, 3).map((t) => (
        <span className="badge tag" key={t}>
          {t}
        </span>
      ))}
      {item.grade !== null && <span className="badge">{item.grade}</span>}
      {item.due_date && (
        <span className="small due">
          {fmtDate(item.due_date)} ({dueLabel(item.due_date)})
        </span>
      )}
      {item.status && <span className={`badge ${statusClass(item.status)}`}>{item.status}</span>}
    </div>
  )
}
