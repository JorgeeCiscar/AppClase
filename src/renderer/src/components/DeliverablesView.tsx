import { useCallback, useEffect, useState } from 'react'
import type { Item, Opener, Status, Subject } from '../../../shared/types'
import { STATUSES } from '../../../shared/types'
import { URGENCY_LABEL, URGENCY_ORDER, today } from '../util'
import BulkBar from './BulkBar'
import EditItemDialog from './EditItemDialog'
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

/** Asignaturas plegadas, recordadas en este ordenador. */
const COLLAPSED_KEY = 'appclase.entregas.plegadas'
function readCollapsed(): Set<number> {
  try {
    const raw = JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '[]')
    return new Set(Array.isArray(raw) ? raw.map(Number).filter(Number.isFinite) : [])
  } catch {
    return new Set()
  }
}
function saveCollapsed(c: Set<number>): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...c]))
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

interface UnitGroup {
  key: string
  label: string | null
  items: Item[]
}

/**
 * Dentro de una asignatura, las entregas se agrupan por unidad (por número de
 * unidad) y las que no tienen unidad van al final. Sin unidades, un solo grupo.
 */
function groupByUnit(items: Item[]): UnitGroup[] {
  if (!items.some((i) => i.unit_id !== null)) return [{ key: 'todas', label: null, items }]
  const map = new Map<string, UnitGroup & { number: number | null }>()
  for (const i of items) {
    const key = i.unit_id === null ? 'sin' : String(i.unit_id)
    let g = map.get(key)
    if (!g) {
      const label =
        i.unit_id === null ? 'Sin unidad' : `${i.unit_number !== null ? `${i.unit_number}. ` : ''}${i.unit_title ?? ''}`
      g = { key, label, items: [], number: i.unit_id === null ? null : i.unit_number }
      map.set(key, g)
    }
    g.items.push(i)
  }
  return [...map.values()].sort((a, b) => {
    if (a.key === 'sin' || b.key === 'sin') return a.key === 'sin' ? 1 : -1
    if (a.number === null || b.number === null) return a.number === null ? 1 : -1
    return a.number - b.number || (a.label ?? '').localeCompare(b.label ?? '', 'es')
  })
}

export default function DeliverablesView({
  openers,
  onToast
}: {
  openers: Opener[]
  onToast: (m: string, bad?: boolean) => void
}) {
  const [items, setItems] = useState<Item[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [status, setStatus] = useState<Status | ''>('')
  const [onlyOverdue, setOnlyOverdue] = useState(false)
  const [grouping, setGrouping] = useState<Grouping>(readGrouping)
  const [openItem, setOpenItem] = useState<number | null>(null)
  const [editing, setEditing] = useState<Item | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [collapsed, setCollapsed] = useState<Set<number>>(readCollapsed)
  const [selecting, setSelecting] = useState(false)
  const [picked, setPicked] = useState<Set<number>>(new Set())

  const updateCollapsed = (fn: (c: Set<number>) => Set<number>): void =>
    setCollapsed((prev) => {
      const next = fn(new Set(prev))
      saveCollapsed(next)
      return next
    })
  const togglePicked = (ids: number[], on?: boolean): void =>
    setPicked((prev) => {
      const next = new Set(prev)
      const add = on ?? !ids.every((id) => next.has(id))
      for (const id of ids) {
        if (add) next.add(id)
        else next.delete(id)
      }
      return next
    })
  const startSelecting = (): void => {
    setOpenItem(null)
    setSelecting(true)
  }
  const stopSelecting = (): void => {
    setSelecting(false)
    setPicked(new Set())
  }

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
    // Si un fichero cambia en la carpeta, se actualizan los contadores de las tarjetas.
    return window.api.files.onChanged(() => void load())
  }, [load])

  // Escape cierra la ficha lateral o sale del modo selección (si no hay una ventana encima).
  useEffect(() => {
    if (openItem === null && !selecting) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || document.querySelector('.modal')) return
      if (selecting) stopSelecting()
      else setOpenItem(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openItem, selecting])

  // En modo selección, pulsar una tarjeta la marca; si no, abre su ficha al lado.
  const open = (x: Item): void => (selecting ? togglePicked([x.id]) : setOpenItem(x.id))
  const pickedItems = items.filter((i) => picked.has(i.id))
  const groups = grouping === 'asignatura' ? groupBySubject(items, subjects) : []

  return (
    <div className={`page deliv-page${openItem !== null ? ' with-detail' : ''}${selecting ? ' selecting' : ''}`}>
      <div className="deliv-layout">
        <div className="deliv-main">
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
            <span className="spacer" />
            {grouping === 'asignatura' && groups.length > 0 && (
              <>
                <button
                  className="ghost small"
                  onClick={() => updateCollapsed(() => new Set(groups.map((g) => g.id)))}
                  disabled={groups.every((g) => collapsed.has(g.id))}
                >
                  Plegar todas
                </button>
                <button
                  className="ghost small"
                  onClick={() => updateCollapsed(() => new Set())}
                  disabled={!groups.some((g) => collapsed.has(g.id))}
                >
                  Desplegar todas
                </button>
              </>
            )}
            {selecting ? (
              <button
                onClick={() =>
                  togglePicked(
                    items.map((i) => i.id),
                    pickedItems.length < items.length
                  )
                }
              >
                {pickedItems.length < items.length ? 'Seleccionar todas' : 'Quitar selección'}
              </button>
            ) : (
              <button onClick={startSelecting} disabled={items.length === 0}>
                Seleccionar
              </button>
            )}
          </div>
          <div className="urg-legend" aria-label="Colores según el plazo">
            {URGENCY_ORDER.map((u) => (
              <span key={u} className={`urg-${u}`}>
                {URGENCY_LABEL[u]}
              </span>
            ))}
          </div>

          {items.length === 0 ? (
            <p className="empty">Nada con fecha límite que cumpla el filtro.</p>
          ) : grouping === 'fecha' ? (
            <div className="deliv-groups" data-grouping="fecha">
              <div className="list">
                {items.map((i) => (
                  <ItemRow
                    key={i.id}
                    item={i}
                    onOpen={open}
                    showSubject
                    selected={i.id === openItem}
                    selectable={selecting}
                    checked={picked.has(i.id)}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="deliv-groups" data-grouping="asignatura">
              {groups.map((g) => {
                const overdue = g.items.filter(isOverdue).length
                const isCollapsed = collapsed.has(g.id)
                const groupIds = g.items.map((i) => i.id)
                const nPicked = groupIds.filter((id) => picked.has(id)).length
                return (
                  <section
                    key={g.id}
                    className={`subject-group${isCollapsed ? ' collapsed' : ''}`}
                    data-subject={g.name}
                  >
                    <h2 className="subject-group-title" style={{ borderLeftColor: g.color ?? 'var(--accent)' }}>
                      {selecting && (
                        <input
                          type="checkbox"
                          className="group-check"
                          aria-label={`Seleccionar todas las de ${g.name}`}
                          checked={nPicked === groupIds.length}
                          ref={(el) => {
                            if (el) el.indeterminate = nPicked > 0 && nPicked < groupIds.length
                          }}
                          onChange={(e) => togglePicked(groupIds, e.target.checked)}
                        />
                      )}
                      <button
                        className="group-toggle"
                        aria-expanded={!isCollapsed}
                        title={isCollapsed ? 'Desplegar' : 'Plegar'}
                        onClick={() =>
                          updateCollapsed((c) => {
                            if (c.has(g.id)) c.delete(g.id)
                            else c.add(g.id)
                            return c
                          })
                        }
                      >
                        <span className="chevron" aria-hidden="true">
                          ▸
                        </span>
                        <span>{g.name}</span>
                      </button>
                      <span className="count">
                        {g.items.length} entrega{g.items.length === 1 ? '' : 's'}
                        {overdue > 0 && <span className="due-over"> · {overdue} fuera de plazo</span>}
                        {selecting && nPicked > 0 && (
                          <span>
                            {' '}
                            · {nPicked} seleccionada{nPicked === 1 ? '' : 's'}
                          </span>
                        )}
                      </span>
                    </h2>
                    {!isCollapsed &&
                      groupByUnit(g.items).map((u) => (
                        <div key={u.key} className="unit-group" data-unit={u.label ?? undefined}>
                          {u.label && <div className="unit-group-title">{u.label}</div>}
                          <div className="list">
                            {u.items.map((i) => (
                              <ItemRow
                                key={i.id}
                                item={i}
                                onOpen={open}
                                selected={i.id === openItem}
                                selectable={selecting}
                                checked={picked.has(i.id)}
                              />
                            ))}
                          </div>
                        </div>
                      ))}
                  </section>
                )
              })}
            </div>
          )}
          {selecting && (
            <BulkBar
              selected={pickedItems}
              subjects={subjects}
              onToast={onToast}
              onCancel={stopSelecting}
              onDone={(removedIds) => {
                if (removedIds) togglePicked(removedIds, false)
                void load()
              }}
            />
          )}
        </div>

        {openItem !== null && (
          <ItemDetail
            key={`${openItem}:${refresh}`}
            asPanel
            itemId={openItem}
            openers={openers}
            onToast={onToast}
            onChanged={() => void load()}
            onEdit={(i) => setEditing(i)}
            onClose={() => setOpenItem(null)}
          />
        )}
      </div>

      {editing && (
        <EditItemDialog
          item={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            setRefresh((r) => r + 1)
            void load()
          }}
        />
      )}
    </div>
  )
}
