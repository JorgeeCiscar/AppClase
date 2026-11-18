import { useCallback, useEffect, useState } from 'react'
import type { Item, ItemKind, Opener, Subject, Unit } from '../../../shared/types'
import { ITEM_KINDS } from '../../../shared/types'
import { KIND_LABEL, errorMessage } from '../util'
import BulkBar from './BulkBar'
import ImportButton from './ImportActivity'
import ItemDetail from './ItemDetail'
import ItemForm from './ItemForm'
import ItemRow from './ItemRow'
import Modal from './Modal'

function UnitForm({
  subjectId,
  initial,
  onSaved,
  onClose
}: {
  subjectId: number
  initial?: Unit
  onSaved: () => void
  onClose: () => void
}) {
  const [number, setNumber] = useState(initial?.number != null ? String(initial.number) : '')
  const [title, setTitle] = useState(initial?.title ?? '')
  const [error, setError] = useState('')
  return (
    <Modal title={initial ? 'Editar unidad' : 'Nueva unidad'} onClose={onClose}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault()
          try {
            await window.api.units.save({
              id: initial?.id,
              subject_id: subjectId,
              number: number === '' ? null : Number(number),
              title
            })
            onSaved()
          } catch (err) {
            setError(errorMessage(err))
          }
        }}
      >
        {error && <div className="error">{error}</div>}
        <div className="row">
          <label className="field" style={{ width: 90 }}>
            Nº
            <input name="unit_number" value={number} onChange={(e) => setNumber(e.target.value)} inputMode="numeric" />
          </label>
          <label className="field" style={{ flex: 1 }}>
            Título
            <input
              name="unit_title"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Estructuras de control"
            />
          </label>
        </div>
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="primary">
            Guardar
          </button>
        </div>
      </form>
    </Modal>
  )
}

export default function SubjectDetail({
  subjectId,
  openers,
  onToast,
  onBack
}: {
  subjectId: number
  openers: Opener[]
  onToast: (msg: string, bad?: boolean) => void
  onBack: () => void
}) {
  const [subject, setSubject] = useState<Subject | undefined>()
  const [units, setUnits] = useState<Unit[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [kind, setKind] = useState<ItemKind | ''>('')
  const [text, setText] = useState('')
  const [openItem, setOpenItem] = useState<number | null>(null)
  const [editItem, setEditItem] = useState<Item | undefined>()
  const [creatingFor, setCreatingFor] = useState<{ unitId: number | null } | null>(null)
  const [unitForm, setUnitForm] = useState<{ initial?: Unit } | null>(null)
  // Modo selección: pulsar un elemento lo marca para actuar sobre varios a la vez.
  const [selecting, setSelecting] = useState(false)
  const [picked, setPicked] = useState<Set<number>>(new Set())
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
  const stopSelecting = (): void => {
    setSelecting(false)
    setPicked(new Set())
  }

  const load = useCallback(async () => {
    const [all, u, i] = await Promise.all([
      window.api.subjects.list(),
      window.api.units.list(subjectId),
      window.api.items.list({ subject_id: subjectId, kind: kind || undefined, text: text || undefined })
    ])
    setSubjects(all)
    setSubject(all.find((s) => s.id === subjectId))
    setUnits(u)
    setItems(i)
  }, [subjectId, kind, text])

  useEffect(() => {
    void load()
    // Si un fichero cambia en la carpeta, se actualizan los contadores.
    return window.api.files.onChanged(() => void load())
  }, [load])

  // Escape sale del modo selección (si no hay una ventana abierta encima).
  useEffect(() => {
    if (!selecting) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !document.querySelector('.modal')) stopSelecting()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selecting])

  if (!subject) return <div className="page" />

  const pickedItems = items.filter((i) => picked.has(i.id))
  const open = (x: Item): void => (selecting ? togglePicked([x.id]) : setOpenItem(x.id))

  const groups: { unit: Unit | null; items: Item[] }[] = [
    ...units.map((u) => ({ unit: u, items: items.filter((i) => i.unit_id === u.id) })),
    { unit: null, items: items.filter((i) => i.unit_id === null) }
  ]

  return (
    <div className="page">
      <div className="page-header">
        <button className="ghost" onClick={onBack}>
          ← Asignaturas
        </button>
        <h1 style={{ marginLeft: 4 }}>{subject.name}</h1>
        <button onClick={() => setUnitForm({})}>Nueva unidad</button>
        <ImportButton defaultSubjectId={subjectId} onToast={onToast} onImported={() => void load()} />
        <button className="primary" onClick={() => setCreatingFor({ unitId: null })}>
          Nuevo elemento
        </button>
      </div>

      <div className="row-wrap" style={{ marginTop: 12 }}>
        <input
          placeholder="Filtrar por título, notas o nombre de fichero"
          value={text}
          onChange={(e) => setText(e.target.value)}
          style={{ flex: 1, minWidth: 220 }}
        />
        <select name="kind_filter" value={kind} onChange={(e) => setKind(e.target.value as ItemKind | '')}>
          <option value="">Todos los tipos</option>
          {ITEM_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
        {selecting ? (
          <button
            onClick={() =>
              togglePicked(
                items.map((i) => i.id),
                pickedItems.length < items.length
              )
            }
          >
            {pickedItems.length < items.length ? 'Seleccionar todos' : 'Quitar selección'}
          </button>
        ) : (
          <button
            onClick={() => {
              setOpenItem(null)
              setSelecting(true)
            }}
            disabled={items.length === 0}
          >
            Seleccionar
          </button>
        )}
      </div>

      {items.length === 0 && <p className="empty">Sin elementos. Crea el primero con «Nuevo elemento».</p>}

      {groups.map(({ unit, items: list }) => {
        if (list.length === 0 && unit === null) return null
        return (
          <section key={unit?.id ?? 'none'} className="unit-section" data-unit={unit ? `${unit.number ?? ''}` : 'sin'}>
            <h2 className="row">
              {selecting && list.length > 0 && (
                <input
                  type="checkbox"
                  className="group-check"
                  aria-label={`Seleccionar todos los de ${unit ? unit.title : 'sin unidad'}`}
                  checked={list.every((i) => picked.has(i.id))}
                  ref={(el) => {
                    const n = list.filter((i) => picked.has(i.id)).length
                    if (el) el.indeterminate = n > 0 && n < list.length
                  }}
                  onChange={(e) =>
                    togglePicked(
                      list.map((i) => i.id),
                      e.target.checked
                    )
                  }
                />
              )}
              <span style={{ flex: 1 }}>
                {unit ? `${unit.number !== null ? unit.number + '. ' : ''}${unit.title}` : 'Sin unidad'}
              </span>
              {unit && (
                <>
                  <button className="tiny ghost" onClick={() => setCreatingFor({ unitId: unit.id })}>
                    + elemento
                  </button>
                  <button className="tiny ghost" onClick={() => setUnitForm({ initial: unit })}>
                    editar
                  </button>
                  <button
                    className="tiny ghost danger"
                    onClick={async () => {
                      if (!window.confirm(`¿Borrar la unidad «${unit.title}»? Sus elementos quedarán sin unidad.`))
                        return
                      await window.api.units.remove(unit.id)
                      void load()
                    }}
                  >
                    borrar
                  </button>
                </>
              )}
            </h2>
            {list.length === 0 ? (
              <p className="muted small">Sin elementos en esta unidad.</p>
            ) : (
              <div className="list">
                {list.map((i) => (
                  <ItemRow key={i.id} item={i} onOpen={open} selectable={selecting} checked={picked.has(i.id)} />
                ))}
              </div>
            )}
          </section>
        )
      })}

      {selecting && (
        <BulkBar
          selected={pickedItems}
          subjects={subjects}
          units={units}
          onToast={onToast}
          onCancel={stopSelecting}
          onDone={(removedIds) => {
            if (removedIds) togglePicked(removedIds, false)
            void load()
          }}
        />
      )}

      {openItem !== null && (
        <ItemDetail
          itemId={openItem}
          openers={openers}
          onToast={onToast}
          onChanged={() => void load()}
          onEdit={(i) => {
            setOpenItem(null)
            setEditItem(i)
          }}
          onClose={() => setOpenItem(null)}
        />
      )}

      {(creatingFor || editItem) && (
        <ItemForm
          subjects={subjects}
          units={units}
          initial={editItem}
          defaultSubjectId={subjectId}
          defaultUnitId={creatingFor?.unitId ?? null}
          onClose={() => {
            setCreatingFor(null)
            setEditItem(undefined)
          }}
          onSaved={() => {
            setCreatingFor(null)
            setEditItem(undefined)
            void load()
          }}
        />
      )}

      {unitForm && (
        <UnitForm
          subjectId={subjectId}
          initial={unitForm.initial}
          onClose={() => setUnitForm(null)}
          onSaved={() => {
            setUnitForm(null)
            void load()
          }}
        />
      )}
    </div>
  )
}
