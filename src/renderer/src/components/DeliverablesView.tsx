import { useCallback, useEffect, useState } from 'react'
import type { Item, Opener, Status, Subject } from '../../../shared/types'
import { STATUSES } from '../../../shared/types'
import { today } from '../util'
import ImportButton from './ImportActivity'
import ItemDetail from './ItemDetail'
import ItemRow from './ItemRow'

type Grouping = 'asignatura' | 'fecha'

/** La forma de agrupar se recuerda en este ordenador (por defecto, por asignatura). */
const GROUPING_KEY = 'appclase.entregas.agrupar'
function readGrouping(): Grouping {
  try {
    return localStorage.getItem(GROUPING_KEY) === 'fecha' ? 'fecha' : 'asignatura'
  } catch {
    return 'asignatura'
  }
}
function saveGrouping(g: Grouping): void {
  try {
    localStorage.setItem(GROUPING_KEY, g)
  } catch {
    /* sin almacenamiento: se queda solo para esta vez */
  }
}

const isOverdue = (i: Item): boolean =>
  !!i.due_date && !!i.status && ['pendiente', 'en curso'].includes(i.status) && i.due_date < today()

interface Group {
  id: number
  name: string
  color: string | null
  items: Item[]
}

/**
 * Agrupa las entregas por asignatura, en el orden de la pestaña Asignaturas.
 * Dentro de cada grupo se mantiene el orden por fecha de entrega.
 */
function groupBySubject(items: Item[], subjects: Subject[]): Group[] {
  const order = new Map(subjects.map((s, idx) => [s.id, idx]))
  const groups = new Map<number, Group>()
  for (const i of items) {
    let g = groups.get(i.subject_id)
    if (!g) {
      g = { id: i.subject_id, name: i.subject_name, color: i.subject_color, items: [] }
      groups.set(i.subject_id, g)
    }
    g.items.push(i)
  }
  return [...groups.values()].sort(
    (a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity) || a.name.localeCompare(b.name, 'es')
  )
}

export default function DeliverablesView({ openers, onToast }: { openers: Opener[]; onToast: (m: string, bad?: boolean) => void }) {
  const [items, setItems] = useState<Item[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [status, setStatus] = useState<Status | ''>('')
  const [onlyOverdue, setOnlyOverdue] = useState(false)
  const [grouping, setGrouping] = useState<Grouping>(readGrouping)
  const [openItem, setOpenItem] = useState<number | null>(null)

  const load = useCallback(async () => {
    const [list, subs] = await Promise.all([
      window.api.items.list({
        dueOnly: !onlyOverdue,
        overdueOnly: onlyOverdue || undefined,
        status: status || undefined
      }),
      window.api.subjects.list()
    ])
    setItems(list)
    setSubjects(subs)
  }, [status, onlyOverdue])

  useEffect(() => {
    void load()
  }, [load])

  const open = (x: Item): void => setOpenItem(x.id)

  return (
    <div className="page">
      <div className="page-header">
        <h1>Entregas</h1>
        <ImportButton className="primary" onToast={onToast} onImported={() => void load()} />
      </div>

      <div className="row-wrap" style={{ marginTop: 12 }}>
        <select
          name="grouping"
          value={grouping}
          onChange={(e) => {
            const g = e.target.value as Grouping
            setGrouping(g)
            saveGrouping(g)
          }}
        >
          <option value="asignatura">Por asignatura</option>
          <option value="fecha">Todas por fecha</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as Status | '')}>
          <option value="">Todos los estados</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <label className="row small">
          <input type="checkbox" checked={onlyOverdue} onChange={(e) => setOnlyOverdue(e.target.checked)} />
          solo fuera de plazo
        </label>
      </div>

      {items.length === 0 ? (
        <p className="empty">Nada con fecha límite que cumpla el filtro.</p>
      ) : grouping === 'fecha' ? (
        <div className="list">
          {items.map((i) => (
            <ItemRow key={i.id} item={i} onOpen={open} showSubject />
          ))}
        </div>
      ) : (
        groupBySubject(items, subjects).map((g) => {
          const overdue = g.items.filter(isOverdue).length
          return (
            <section key={g.id} className="subject-group" data-subject={g.name}>
              <h2 className="subject-group-title" style={{ borderLeftColor: g.color ?? 'var(--accent)' }}>
                <span>{g.name}</span>
                <span className="count">
                  {g.items.length} entrega{g.items.length === 1 ? '' : 's'}
                  {overdue > 0 && <span className="due-over"> · {overdue} fuera de plazo</span>}
                </span>
              </h2>
              <div className="list">
                {g.items.map((i) => (
                  <ItemRow key={i.id} item={i} onOpen={open} />
                ))}
              </div>
            </section>
          )
        })
      )}

      {openItem !== null && (
        <ItemDetail
          itemId={openItem}
          openers={openers}
          onToast={onToast}
          onChanged={() => void load()}
          onEdit={() => setOpenItem(null)}
          onClose={() => setOpenItem(null)}
        />
      )}
    </div>
  )
}
