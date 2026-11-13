import { useEffect, useState } from 'react'
import type { Subject, SubjectInput } from '../../../shared/types'
import Modal from './Modal'

function SubjectForm({
  initial,
  onSaved,
  onClose
}: {
  initial?: Subject
  onSaved: () => void
  onClose: () => void
}) {
  const [form, setForm] = useState<SubjectInput>({
    id: initial?.id,
    name: initial?.name ?? '',
    short_name: initial?.short_name ?? '',
    color: initial?.color ?? '#4c8bf5',
    teacher: initial?.teacher ?? ''
  })
  const [error, setError] = useState('')

  return (
    <Modal title={initial ? 'Editar asignatura' : 'Nueva asignatura'} onClose={onClose}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault()
          try {
            await window.api.subjects.save(form)
            onSaved()
          } catch (err) {
            setError((err as Error).message)
          }
        }}
      >
        {error && <div className="error">{error}</div>}
        <label className="field">
          Nombre
          <input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <div className="grid-3">
          <label className="field">
            Abreviatura
            <input
              value={form.short_name ?? ''}
              placeholder="PRO"
              onChange={(e) => setForm({ ...form, short_name: e.target.value })}
            />
          </label>
          <label className="field">
            Color
            <input type="color" value={form.color ?? '#4c8bf5'} onChange={(e) => setForm({ ...form, color: e.target.value })} />
          </label>
          <label className="field">
            Profesor/a
            <input value={form.teacher ?? ''} onChange={(e) => setForm({ ...form, teacher: e.target.value })} />
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

export default function SubjectsView({ onOpen }: { onOpen: (id: number) => void }) {
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [editing, setEditing] = useState<Subject | undefined>()
  const [creating, setCreating] = useState(false)

  const load = async (): Promise<void> => setSubjects(await window.api.subjects.list())
  useEffect(() => {
    void load()
  }, [])

  return (
    <div className="page">
      <div className="page-header">
        <h1>Asignaturas</h1>
        <button onClick={() => void window.api.subjects.seedDaw1().then(() => load())}>Añadir módulos de 1º DAW</button>
        <button className="primary" onClick={() => setCreating(true)}>
          Nueva asignatura
        </button>
      </div>

      {subjects.length === 0 && <p className="empty">No hay asignaturas todavía.</p>}

      <div className="card-grid">
        {subjects.map((s) => (
          <div key={s.id} className="subject-card" style={{ borderLeftColor: s.color ?? 'var(--accent)' }}>
            <div className="row">
              <span className="name clickable" onClick={() => onOpen(s.id)} style={{ flex: 1 }}>
                {s.short_name ? `${s.short_name} · ` : ''}
                {s.name}
              </span>
            </div>
            {s.teacher && <div className="meta">{s.teacher}</div>}
            <div className="meta">
              {s.item_count} elemento{s.item_count === 1 ? '' : 's'} · {s.file_count} fichero{s.file_count === 1 ? '' : 's'}
              {s.pending_count > 0 ? ` · ${s.pending_count} sin terminar` : ''}
            </div>
            <div className="row" style={{ marginTop: 4 }}>
              <button className="tiny" onClick={() => onOpen(s.id)}>
                Abrir
              </button>
              <button className="tiny ghost" onClick={() => setEditing(s)}>
                Editar
              </button>
              <button
                className="tiny danger ghost"
                onClick={async () => {
                  if (!window.confirm(`¿Borrar «${s.name}» con sus temas y elementos? Los ficheros seguirán en el disco.`)) return
                  await window.api.subjects.remove(s.id)
                  void load()
                }}
              >
                Borrar
              </button>
            </div>
          </div>
        ))}
      </div>

      {(creating || editing) && (
        <SubjectForm
          initial={editing}
          onClose={() => {
            setCreating(false)
            setEditing(undefined)
          }}
          onSaved={() => {
            setCreating(false)
            setEditing(undefined)
            void load()
          }}
        />
      )}
    </div>
  )
}
