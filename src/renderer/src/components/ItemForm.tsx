import { useEffect, useState } from 'react'
import type { Item, ItemInput, ItemKind, Status, Subject, Unit } from '../../../shared/types'
import { ITEM_KINDS, STATUSES } from '../../../shared/types'
import { KIND_LABEL } from '../util'
import Modal from './Modal'
import TagInput from './TagInput'

export default function ItemForm({
  subjects,
  units,
  initial,
  defaultSubjectId,
  defaultUnitId,
  onSaved,
  onClose
}: {
  subjects: Subject[]
  units: Unit[]
  initial?: Item
  defaultSubjectId?: number
  defaultUnitId?: number | null
  onSaved: (i: Item) => void
  onClose: () => void
}) {
  const [form, setForm] = useState<ItemInput>({
    id: initial?.id,
    subject_id: initial?.subject_id ?? defaultSubjectId ?? subjects[0]?.id ?? 0,
    unit_id: initial?.unit_id ?? defaultUnitId ?? null,
    kind: initial?.kind ?? 'ejercicio',
    title: initial?.title ?? '',
    notes: initial?.notes ?? '',
    url: initial?.url ?? '',
    due_date: initial?.due_date ?? '',
    status: initial?.status ?? null,
    grade: initial?.grade ?? null,
    tags: initial?.tags ?? []
  })
  const [subjectUnits, setSubjectUnits] = useState<Unit[]>(units)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void window.api.tags().then(setSuggestions)
  }, [])

  // Al cambiar de asignatura cambian los temas disponibles.
  useEffect(() => {
    let alive = true
    void window.api.units.list(form.subject_id).then((u) => {
      if (!alive) return
      setSubjectUnits(u)
      if (form.unit_id && !u.some((x) => x.id === form.unit_id)) setForm((f) => ({ ...f, unit_id: null }))
    })
    return () => {
      alive = false
    }
  }, [form.subject_id])

  const set = <K extends keyof ItemInput>(k: K, v: ItemInput[K]): void => setForm((f) => ({ ...f, [k]: v }))

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      onSaved(await window.api.items.save(form))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={initial ? 'Editar elemento' : 'Nuevo elemento'} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        {error && <div className="error">{error}</div>}

        <label className="field">
          Título
          <input name="title" autoFocus value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Ejercicio 3: bucles" />
        </label>

        <div className="grid-3">
          <label className="field">
            Asignatura
            <select name="subject_id" value={form.subject_id} onChange={(e) => set('subject_id', Number(e.target.value))}>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Tema
            <select
              name="unit_id"
              value={form.unit_id ?? ''}
              onChange={(e) => set('unit_id', e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">— sin tema —</option>
              {subjectUnits.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.number !== null ? `${u.number}. ` : ''}
                  {u.title}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Tipo
            <select name="kind" value={form.kind} onChange={(e) => set('kind', e.target.value as ItemKind)}>
              {ITEM_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid-3">
          <label className="field">
            Fecha límite
            <input name="due_date" type="date" value={form.due_date ?? ''} onChange={(e) => set('due_date', e.target.value)} />
          </label>
          <label className="field">
            Estado
            <select
              name="status"
              value={form.status ?? ''}
              onChange={(e) => set('status', (e.target.value || null) as Status | null)}
            >
              <option value="">— no es una entrega —</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Nota (0–10)
            <input
              name="grade"
              type="number"
              min={0}
              max={10}
              step={0.1}
              value={form.grade ?? ''}
              onChange={(e) => set('grade', e.target.value === '' ? null : Number(e.target.value))}
            />
          </label>
        </div>

        <label className="field">
          Enlace (Aules, Moodle, Classroom…)
          <input name="url" value={form.url ?? ''} onChange={(e) => set('url', e.target.value)} placeholder="https://" />
        </label>

        <label className="field">
          Etiquetas
          <TagInput tags={form.tags ?? []} onChange={(t) => set('tags', t)} suggestions={suggestions} />
        </label>

        <label className="field">
          Notas
          <textarea name="notes" value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
        </label>

        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="primary" disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
