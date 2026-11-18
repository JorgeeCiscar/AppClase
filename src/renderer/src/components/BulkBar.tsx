import { useEffect, useState } from 'react'
import type { Item, Status, Subject } from '../../../shared/types'
import { STATUSES } from '../../../shared/types'
import { errorMessage } from '../util'
import Modal from './Modal'

type Dialog = null | 'tag' | 'grade' | 'delete'

/**
 * Barra de acciones para las entregas seleccionadas: eliminar, cambiar de
 * asignatura, cambiar estado, añadir nota (solo con una) y añadir etiqueta.
 */
export default function BulkBar({
  selected,
  subjects,
  onDone,
  onCancel,
  onToast
}: {
  selected: Item[]
  subjects: Subject[]
  /** Tras aplicar una acción; removedIds son las entregas que ya no existen. */
  onDone: (removedIds?: number[]) => void
  onCancel: () => void
  onToast: (msg: string, bad?: boolean) => void
}) {
  const [dialog, setDialog] = useState<Dialog>(null)
  const [busy, setBusy] = useState(false)
  const [tag, setTag] = useState('')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [grade, setGrade] = useState('')
  const [trash, setTrash] = useState(true)
  const ids = selected.map((i) => i.id)
  const n = ids.length
  const one = n === 1 ? selected[0] : null
  const files = selected.reduce((sum, i) => sum + i.file_count, 0)
  const plural = (k: number, a: string, b: string): string => `${k} ${k === 1 ? a : b}`

  useEffect(() => {
    void window.api.tags().then(setSuggestions)
  }, [])

  /** Aplica una acción; puede devolver un aviso normal o uno de error que no impide terminar. */
  const run = async (
    fn: () => Promise<string | { msg: string; bad: boolean }>,
    removedIds?: number[]
  ): Promise<void> => {
    setBusy(true)
    try {
      const res = await fn()
      if (typeof res === 'string') onToast(res)
      else onToast(res.msg, res.bad)
      setDialog(null)
      onDone(removedIds)
    } catch (err) {
      onToast(errorMessage(err), true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="bulk-bar" role="toolbar" aria-label="Acciones con las entregas seleccionadas">
        <strong className="bulk-count">
          {n === 0 ? 'Ninguna seleccionada' : plural(n, 'seleccionada', 'seleccionadas')}
        </strong>
        <select
          name="bulk_status"
          value=""
          disabled={!n || busy}
          onChange={(e) => {
            const st = e.target.value === '__none' ? null : (e.target.value as Status)
            void run(async () => {
              await window.api.items.bulkUpdate(ids, { status: st })
              return st ? `Estado cambiado a «${st}»` : 'Estado quitado'
            })
          }}
        >
          <option value="" disabled>
            Cambiar estado…
          </option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
          <option value="__none">— sin estado —</option>
        </select>
        <select
          name="bulk_subject"
          value=""
          disabled={!n || busy}
          onChange={(e) => {
            const target = subjects.find((s) => s.id === Number(e.target.value))
            if (!target) return
            void run(async () => {
              await window.api.items.bulkUpdate(ids, { subject_id: target.id })
              return `${plural(n, 'entrega movida', 'entregas movidas')} a «${target.name}»`
            })
          }}
        >
          <option value="" disabled>
            Cambiar de asignatura…
          </option>
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button disabled={!n || busy} onClick={() => setDialog('tag')}>
          Añadir etiqueta
        </button>
        <button
          disabled={!one || busy}
          title={one ? undefined : 'Selecciona una sola entrega para ponerle nota'}
          onClick={() => {
            setGrade(one?.grade !== null && one?.grade !== undefined ? String(one.grade) : '')
            setDialog('grade')
          }}
        >
          Añadir nota
        </button>
        <button
          className="danger"
          disabled={!n || busy}
          onClick={() => {
            setTrash(files > 0)
            setDialog('delete')
          }}
        >
          Eliminar
        </button>
        <span className="spacer" />
        <button className="ghost" onClick={onCancel}>
          Terminar selección
        </button>
      </div>

      {dialog === 'tag' && (
        <Modal title={`Añadir etiqueta a ${plural(n, 'entrega', 'entregas')}`} onClose={() => setDialog(null)}>
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault()
              const t = tag.trim()
              if (!t) return
              void run(async () => {
                await window.api.items.bulkUpdate(ids, { addTag: t })
                setTag('')
                return `Etiqueta «${t}» añadida`
              })
            }}
          >
            <label className="field">
              Etiqueta
              <input
                name="bulk_tag"
                autoFocus
                list="bulk-tag-suggestions"
                value={tag}
                onChange={(e) => setTag(e.target.value)}
              />
            </label>
            <datalist id="bulk-tag-suggestions">
              {suggestions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <div className="modal-actions">
              <button type="button" className="ghost" onClick={() => setDialog(null)}>
                Cancelar
              </button>
              <button type="submit" className="primary" disabled={busy || !tag.trim()}>
                Añadir
              </button>
            </div>
          </form>
        </Modal>
      )}

      {dialog === 'grade' && one && (
        <Modal title={`Nota de «${one.title}»`} onClose={() => setDialog(null)}>
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault()
              void run(async () => {
                const g = grade.trim() === '' ? null : Number(grade.replace(',', '.'))
                await window.api.items.bulkUpdate([one.id], { grade: g })
                return g === null ? 'Nota quitada' : `Nota ${g} guardada`
              })
            }}
          >
            <label className="field">
              Nota (0–10, vacía para quitarla)
              <input
                name="bulk_grade"
                autoFocus
                inputMode="decimal"
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
                placeholder="7,5"
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="ghost" onClick={() => setDialog(null)}>
                Cancelar
              </button>
              <button type="submit" className="primary" disabled={busy}>
                Guardar nota
              </button>
            </div>
          </form>
        </Modal>
      )}

      {dialog === 'delete' && (
        <Modal title={`¿Eliminar ${plural(n, 'entrega', 'entregas')}?`} onClose={() => setDialog(null)}>
          <div className="form">
            <ul className="bulk-list small">
              {selected.slice(0, 8).map((i) => (
                <li key={i.id}>{i.title}</li>
              ))}
              {n > 8 && <li className="muted">y {n - 8} más…</li>}
            </ul>
            {files > 0 ? (
              <label className="row">
                <input
                  name="trash_files"
                  type="checkbox"
                  checked={trash}
                  onChange={(e) => setTrash(e.target.checked)}
                />
                Enviar también {plural(files, 'su fichero', 'sus ficheros')} a la papelera de reciclaje
              </label>
            ) : (
              <p className="muted small">No tienen ficheros.</p>
            )}
            <div className="modal-actions">
              <button className="ghost" onClick={() => setDialog(null)} disabled={busy}>
                Cancelar
              </button>
              <button
                className="danger-solid"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const r = await window.api.items.bulkRemove(ids, { trashFiles: trash })
                    const msg = `${plural(r.removed, 'entrega eliminada', 'entregas eliminadas')}${
                      r.trashed ? ` · ${plural(r.trashed, 'fichero', 'ficheros')} a la papelera` : ''
                    }`
                    if (r.errors.length)
                      return { msg: `${msg}, pero no se pudo enviar a la papelera ${r.errors[0]}`, bad: true }
                    return msg
                  }, ids)
                }
              >
                Eliminar
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
