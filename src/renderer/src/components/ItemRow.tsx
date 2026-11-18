import type { Item } from '../../../shared/types'
import { KIND_LABEL, dueLabel, fmtDate } from '../util'

const statusClass = (s: string | null): string => (s ? `status-${s.replace(/\s+/g, '')}` : '')

/** Fila compacta de un elemento, reutilizada en panel, asignatura, entregas y búsqueda. */
export default function ItemRow({
  item,
  onOpen,
  showSubject = false
}: {
  item: Item
  onOpen: (i: Item) => void
  showSubject?: boolean
}) {
  const overdue = item.due_date && item.status && ['pendiente', 'en curso'].includes(item.status)
    ? new Date(item.due_date) < new Date(new Date().toDateString())
    : false
  const soon = !overdue && item.due_date
  // Asignatura, tema y ficheros, unidos con « · » solo entre los que haya.
  const sub = [
    showSubject ? item.subject_name : null,
    item.unit_title ? `${item.unit_number !== null ? item.unit_number + '. ' : ''}${item.unit_title}` : null,
    item.file_count > 0 ? `${item.file_count} fichero${item.file_count === 1 ? '' : 's'}` : null,
    item.missing_count > 0 ? `${item.missing_count} sin encontrar` : null
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="list-row clickable" onClick={() => onOpen(item)}>
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
        <span className={`small ${overdue ? 'due-over' : soon ? 'due-soon' : 'muted'}`}>
          {fmtDate(item.due_date)} ({dueLabel(item.due_date)})
        </span>
      )}
      {item.status && <span className={`badge ${statusClass(item.status)}`}>{item.status}</span>}
    </div>
  )
}
