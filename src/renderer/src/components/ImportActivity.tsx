import { useEffect, useRef, useState } from 'react'
import type { Item, ScrapedActivity, Subject } from '../../../shared/types'
import { FILE_SECTION_LABEL, FILE_SECTIONS } from '../../../shared/types'
import { matchSubject } from '../../../shared/match'
import { errorMessage, fmtDate } from '../util'
import ItemForm from './ItemForm'
import Modal from './Modal'

/** Un enlace de la cola de importación y lo que ha pasado con él. */
interface Entry {
  url: string
  status: 'en espera' | 'leyendo' | 'leída' | 'error' | 'no leída'
  act?: ScrapedActivity
  error?: string
  outcome?: { kind: 'guardada'; title: string; files: number; errors: string[] } | { kind: 'saltada' }
}

const URL_RE = /https?:\/\/[^\s<>"']+/g
/** Los enlaces que hay en un texto (al pegar varios de golpe). */
const urlsIn = (text: string): string[] => text.match(URL_RE) ?? []

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

function describe(e: Entry): { kind: string; text: string } {
  if (e.outcome?.kind === 'guardada') {
    const text = `Guardada · ${plural(e.outcome.files, 'fichero', 'ficheros')}`
    return { kind: 'guardada', text: e.outcome.errors.length ? `${text} · no se pudo descargar ${e.outcome.errors[0]}` : text }
  }
  if (e.outcome?.kind === 'saltada') return { kind: 'saltada', text: 'Saltada' }
  if (e.status === 'error') return { kind: 'error', text: `No se pudo leer: ${e.error}` }
  if (e.status === 'no leída') return { kind: 'no-leida', text: 'No se leyó: se canceló la lectura' }
  return { kind: 'sin-importar', text: 'Sin importar: terminaste antes de llegar a esta' }
}

/**
 * Importar actividades desde sus enlaces: puedes poner varios, y se leen uno tras
 * otro en ese orden (pidiendo iniciar sesión la primera vez). Después revisas cada
 * actividad, también en orden, y al final ves un resumen de lo que se ha guardado.
 */
function ImportDialog({
  defaultSubjectId,
  onToast,
  onImported,
  onClose
}: {
  defaultSubjectId?: number
  onToast: (msg: string, bad?: boolean) => void
  onImported: (item: Item) => void
  onClose: () => void
}) {
  const [step, setStep] = useState<'urls' | 'reading' | 'review' | 'summary'>('urls')
  const [urls, setUrls] = useState<string[]>([''])
  const [error, setError] = useState('')
  const [queue, setQueue] = useState<Entry[]>([])
  const [idx, setIdx] = useState(0)
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const stopRef = useRef(false)

  useEffect(() => {
    void window.api.subjects.list().then(setSubjects)
  }, [])

  const links = urls.map((u) => u.trim()).filter(Boolean)
  const unique = links.filter((u, i) => links.indexOf(u) === i)

  const setUrl = (i: number, v: string): void => setUrls((u) => u.map((x, j) => (j === i ? v : x)))
  const addRow = (): void => setUrls((u) => [...u, ''])
  const removeRow = (i: number): void => setUrls((u) => (u.length > 1 ? u.filter((_, j) => j !== i) : ['']))
  // Si pegas varios enlaces a la vez en un campo, se reparten en campos seguidos.
  const onPaste = (i: number, e: React.ClipboardEvent<HTMLInputElement>): void => {
    const found = urlsIn(e.clipboardData.getData('text'))
    if (found.length < 2) return
    e.preventDefault()
    setUrls((u) => [...u.slice(0, i), ...found, ...u.slice(i + 1)])
  }

  const finish = (q: Entry[]): void => {
    if (q.length === 1) {
      onClose()
      return
    }
    setQueue(q)
    setStep('summary')
  }

  /** Pasa a revisar la siguiente actividad leída a partir de «from», o al resumen. */
  const reviewFrom = (q: Entry[], from: number): void => {
    const next = q.findIndex((e, i) => i >= from && e.status === 'leída')
    if (next === -1) {
      finish(q)
      return
    }
    setQueue(q)
    setIdx(next)
    // Se marca todo lo recogido: el enunciado y, si está calificada, tu archivo enviado.
    setSelected(new Set(q[next].act!.files.map((f) => f.url)))
    setStep('review')
  }

  const readAll = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!unique.length) return
    setError('')
    stopRef.current = false
    let q: Entry[] = unique.map((url) => ({ url, status: 'en espera' }))
    setQueue(q)
    setStep('reading')
    if (!subjects.length) setSubjects(await window.api.subjects.list())

    for (let i = 0; i < q.length; i++) {
      if (stopRef.current) {
        q = q.map((x, j) => (j >= i ? { ...x, status: 'no leída' } : x))
        break
      }
      q = q.map((x, j) => (j === i ? { ...x, status: 'leyendo' } : x))
      setQueue(q)
      try {
        const act = await window.api.importer.read(q[i].url)
        q = q.map((x, j) => (j === i ? { ...x, status: 'leída', act } : x))
      } catch (err) {
        const msg = errorMessage(err)
        q = q.map((x, j) => (j === i ? { ...x, status: 'error', error: msg } : x))
        // Si cierras la ventana de inicio de sesión, no se siguen leyendo los demás.
        if (/cancelada/i.test(msg)) stopRef.current = true
      }
      setQueue(q)
    }

    if (q.length === 1 && q[0].status !== 'leída') {
      setError(q[0].error ?? 'No se pudo leer la actividad')
      setStep('urls')
      return
    }
    reviewFrom(q, 0)
  }

  const close = (): void => {
    if (step === 'reading') {
      stopRef.current = true
      void window.api.importer.cancel()
    }
    onClose()
  }

  // ------------------------------------------------------------------ resumen
  if (step === 'summary') {
    const saved = queue.filter((e) => e.outcome?.kind === 'guardada').length
    return (
      <Modal title="Resultado de la importación" onClose={onClose}>
        <p className="small">
          {plural(saved, 'actividad guardada', 'actividades guardadas')} de {queue.length}.
        </p>
        <div className="list">
          {queue.map((e, i) => {
            const d = describe(e)
            return (
              <div key={i} className="list-row" data-result={d.kind}>
                <span className="badge kind">{i + 1}</span>
                <div className="col">
                  <div className="title">{e.act?.title || e.url}</div>
                  <div className={`sub${d.kind === 'error' || d.kind === 'no-leida' ? ' due-over' : ''}`}>{d.text}</div>
                </div>
              </div>
            )
          })}
        </div>
        <div className="modal-actions">
          <button className="primary" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </Modal>
    )
  }

  // ------------------------------------------------------- enlaces y lectura
  if (step !== 'review') {
    const reading = step === 'reading'
    const current = queue.findIndex((e) => e.status === 'leyendo')
    return (
      <Modal title="Importar actividades desde enlaces" onClose={close}>
        <form className="form" onSubmit={readAll}>
          {error && <div className="error">{error}</div>}
          <div className="field">Enlaces de las actividades (Aules, Moodle u otra web) · se leen en este orden</div>

          {!reading ? (
            <div className="url-list">
              {urls.map((u, i) => (
                <div key={i} className="row">
                  <span className="muted small url-num">{i + 1}.</span>
                  <input
                    name="activity_url"
                    autoFocus={i === urls.length - 1}
                    value={u}
                    onChange={(e) => setUrl(i, e.target.value)}
                    onPaste={(e) => onPaste(i, e)}
                    placeholder="https://aules.edu.gva.es/…/mod/assign/view.php?id=…"
                    style={{ flex: 1, minWidth: 0 }}
                  />
                  {urls.length > 1 && (
                    <button type="button" className="tiny ghost" aria-label={`Quitar el enlace ${i + 1}`} onClick={() => removeRow(i)}>
                      ✕
                    </button>
                  )}
                </div>
              ))}
              <div>
                <button type="button" className="tiny" onClick={addRow}>
                  + Añadir otro enlace
                </button>
              </div>
            </div>
          ) : (
            <div className="url-list">
              {queue.map((e, i) => (
                <div key={i} className="row small" data-status={e.status}>
                  <span className="muted url-num">{i + 1}.</span>
                  <span className="fpath" style={{ flex: 1, minWidth: 0 }} title={e.url}>
                    {e.url}
                  </span>
                  <span className={e.status === 'error' ? 'due-over' : e.status === 'leída' ? '' : 'muted'}>
                    {e.status === 'leyendo' ? 'leyendo…' : e.status === 'error' ? 'error' : e.status}
                  </span>
                </div>
              ))}
            </div>
          )}

          {reading ? (
            <div className="notice small">
              Leyendo {queue.length > 1 ? `la actividad ${current + 1} de ${queue.length}` : 'la actividad'}… Si la
              plataforma te pide iniciar sesión, se abrirá una ventana: entra con tu usuario y la lectura seguirá sola.
              La sesión se guarda para la próxima vez.
            </div>
          ) : (
            <p className="muted small">
              De cada actividad se leen el título, la asignatura, la fecha de entrega, el enunciado y los ficheros.
              Luego las revisas una a una, en el mismo orden, antes de guardarlas. Puedes pegar varios enlaces de golpe
              en un campo.
            </p>
          )}

          <div className="modal-actions">
            <button type="button" className="ghost" onClick={close}>
              Cancelar
            </button>
            <button type="submit" className="primary" disabled={reading || !unique.length}>
              {reading
                ? 'Leyendo…'
                : unique.length > 1
                  ? `Leer ${unique.length} actividades`
                  : 'Leer actividad'}
            </button>
          </div>
        </form>
      </Modal>
    )
  }

  // ------------------------------------------------------------------ revisión
  const entry = queue[idx]
  const act = entry.act!
  const multi = queue.length > 1
  const matched = matchSubject(act.course, act.title, subjects)
  const matchedSubject = subjects.find((s) => s.id === matched)
  const notes = [act.description, act.due_raw ? `Entrega según la plataforma: ${act.due_raw}` : '']
    .filter(Boolean)
    .join('\n\n')
  const toggle = (u: string): void =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(u)) next.delete(u)
      else next.add(u)
      return next
    })
  const record = (outcome: NonNullable<Entry['outcome']>): Entry[] =>
    queue.map((x, j) => (j === idx ? { ...x, outcome } : x))

  const header = (
    <div className="notice small">
      Leído de {act.platform === 'moodle' ? 'la plataforma (Moodle/Aules)' : 'la página'}
      {act.course ? (
        <>
          {' '}
          · curso «{act.course}» →{' '}
          {matchedSubject ? <strong>{matchedSubject.name}</strong> : <strong>sin asignatura reconocida, elígela</strong>}
        </>
      ) : null}
      {act.due_date ? (
        <> · entrega el {fmtDate(act.due_date)}</>
      ) : (
        <>
          {' '}
          · <strong>no se encontró la fecha de entrega</strong>, revísala
        </>
      )}
      {act.graded && (
        <>
          {' '}
          · <strong>tarea calificada</strong>: se guarda también tu archivo enviado
        </>
      )}
    </div>
  )

  const footer = (
    <div>
      {act.files.length === 0 && (
        <>
          <div className="field" style={{ marginBottom: 6 }}>
            {FILE_SECTION_LABEL.enunciado}
          </div>
          <p className="muted small">La tarea no tiene ficheros adjuntos: su texto se ha copiado en las notas.</p>
        </>
      )}
      {FILE_SECTIONS.map((section) => {
        const list = act.files.filter((f) => f.section === section)
        if (!list.length) return null
        return (
          <div key={section} data-section={section} style={{ marginBottom: 10 }}>
            <div className="field" style={{ marginBottom: 6 }}>
              {FILE_SECTION_LABEL[section]}
            </div>
            <div className="files">
              {list.map((f) => (
                <label key={f.url} className="file-row clickable" style={{ gap: 8 }}>
                  <input type="checkbox" checked={selected.has(f.url)} onChange={() => toggle(f.url)} />
                  <span className="fname" style={{ flex: 1 }}>
                    {f.name}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )
      })}
      {act.files.length > 0 && (
        <p className="muted small" style={{ marginTop: 6 }}>
          Los marcados se descargan con tu sesión y se guardan en la carpeta del curso (Ajustes).
        </p>
      )}
    </div>
  )

  return (
    <ItemForm
      key={idx}
      modalTitle={multi ? `Revisa la actividad ${idx + 1} de ${queue.length}` : 'Revisa la actividad importada'}
      subjects={subjects}
      units={[]}
      prefill={{
        subject_id: matched ?? defaultSubjectId ?? subjects[0]?.id,
        kind: 'ejercicio',
        title: act.title,
        notes,
        url: act.url,
        due_date: act.due_date ?? '',
        // Una tarea ya calificada no está pendiente: si no, saldría «fuera de plazo» en el Panel.
        status: act.graded ? 'corregida' : 'pendiente'
      }}
      header={header}
      footer={footer}
      cancelLabel={multi ? 'Terminar aquí' : 'Cancelar'}
      extraActions={
        multi ? (
          <button type="button" className="ghost" onClick={() => reviewFrom(record({ kind: 'saltada' }), idx + 1)}>
            Saltar esta
          </button>
        ) : undefined
      }
      onClose={() => (multi ? finish(queue) : onClose())}
      onSaved={async (item) => {
        const files = act.files
          .filter((f) => selected.has(f.url))
          .map(({ name, url: u, section }) => ({ name, url: u, section }))
        let added = 0
        const errors: string[] = []
        let dir = ''
        if (files.length) {
          try {
            const r = await window.api.importer.download(item.id, files)
            added = r.added
            dir = r.dir
            errors.push(...r.errors)
          } catch (err) {
            errors.push(`los ficheros: ${errorMessage(err)}`)
          }
        }
        onImported(item)
        if (multi) {
          reviewFrom(record({ kind: 'guardada', title: item.title, files: added, errors }), idx + 1)
          return
        }
        const parts = [files.length ? `Actividad guardada · ${plural(added, 'fichero', 'ficheros')} en ${dir}` : 'Actividad guardada']
        if (errors.length) parts.push(`No se pudo descargar ${errors[0]}`)
        onToast(parts.join(' · '), errors.length > 0)
        onClose()
      }}
    />
  )
}

/** Botón que abre el diálogo de importación. */
export default function ImportButton({
  defaultSubjectId,
  onToast,
  onImported,
  className
}: {
  defaultSubjectId?: number
  onToast: (msg: string, bad?: boolean) => void
  onImported: (item: Item) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button className={className} onClick={() => setOpen(true)}>
        Importar desde enlace…
      </button>
      {open && (
        <ImportDialog
          defaultSubjectId={defaultSubjectId}
          onToast={onToast}
          onImported={onImported}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
