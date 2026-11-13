import { useCallback, useEffect, useState } from 'react'
import type { Item, ItemKind, Opener, Subject, Unit } from '../../../shared/types'
import { ITEM_KINDS } from '../../../shared/types'
import { KIND_LABEL, errorMessage } from '../util'
import ImportButton from './ImportActivity'
import ItemDetail from './ItemDetail'
import ItemForm from './ItemForm'
import ItemRow from './ItemRow'
import Modal from './Modal'

function UnitForm({ subjectId, initial, onSaved, onClose }: { subjectId: number; initial?: Unit; onSaved: () => void; onClose: () => void }) {
  const [number, setNumber] = useState(initial?.number != null ? String(initial.number) : '')
  const [title, setTitle] = useState(initial?.title ?? '')
  const [error, setError] = useState('')
  return (
    <Modal title={initial ? 'Editar tema' : 'Nuevo tema'} onClose={onClose}>
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
            <input name="unit_title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Estructuras de control" />
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
  }, [load])

  if (!subject) return <div className="page" />

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
        <button onClick={() => setUnitForm({})}>Nuevo tema</button>
        <ImportButton defaultSubjectId={subjectId} onToast={onToast} onImported={() => void load()} />
        <button className="primary" onClick={() => setCreatingFor({ unitId: null })}>
          Nuevo elemento
        </button>
      </div>

      <div className="row-wrap" style={{ marginTop: 12 }}>
        <input placeholder="Filtrar por título, notas o nombre de fichero" value={text} onChange={(e) => setText(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
        <select value={kind} onChange={(e) => setKind(e.target.value as ItemKind | '')}>
          <option value="">Todos los tipos</option>
          {ITEM_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </div>

      {items.length === 0 && <p className="empty">Sin elementos. Crea el primero con «Nuevo elemento».</p>}

      {groups.map(({ unit, items: list }) => {
        if (list.length === 0 && unit === null) return null
        return (
          <section key={unit?.id ?? 'none'}>
            <h2 className="row">
              <span style={{ flex: 1 }}>
                {unit ? `${unit.number !== null ? unit.number + '. ' : ''}${unit.title}` : 'Sin tema'}
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
                      if (!window.confirm(`¿Borrar el tema «${unit.title}»? Sus elementos quedarán sin tema.`)) return
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
              <p className="muted small">Sin elementos en este tema.</p>
            ) : (
              <div className="list">
                {list.map((i) => (
                  <ItemRow key={i.id} item={i} onOpen={(x) => setOpenItem(x.id)} />
                ))}
              </div>
            )}
          </section>
        )
      })}

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
