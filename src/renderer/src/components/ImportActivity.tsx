import { useEffect, useState } from 'react'
import type { Item, ScrapedActivity, Subject } from '../../../shared/types'
import { FILE_SECTION_LABEL, FILE_SECTIONS } from '../../../shared/types'
import { matchSubject } from '../../../shared/match'
import { errorMessage, fmtDate } from '../util'
import ItemForm from './ItemForm'
import Modal from './Modal'

/**
 * Importar una actividad desde su enlace: la app abre la página (pidiendo iniciar
 * sesión la primera vez), lee título, curso, fecha de entrega, enunciado y
 * adjuntos, y te deja revisar los datos antes de guardar y descargar los ficheros.
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
  const [step, setStep] = useState<'url' | 'reading' | 'form'>('url')
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [act, setAct] = useState<ScrapedActivity | null>(null)
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [matched, setMatched] = useState<number | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    void window.api.subjects.list().then(setSubjects)
  }, [])

  const read = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setError('')
    setStep('reading')
    try {
      const a = await window.api.importer.read(url)
      const list = subjects.length ? subjects : await window.api.subjects.list()
      setSubjects(list)
      setAct(a)
      setMatched(matchSubject(a.course, a.title, list))
      // Se marca todo lo recogido: el enunciado y, si está calificada, tu archivo enviado.
      setSelected(new Set(a.files.map((f) => f.url)))
      setStep('form')
    } catch (err) {
      setError(errorMessage(err))
      setStep('url')
    }
  }

  const close = (): void => {
    if (step === 'reading') void window.api.importer.cancel()
    onClose()
  }

  if (step !== 'form' || !act) {
    return (
      <Modal title="Importar actividad desde un enlace" onClose={close}>
        <form className="form" onSubmit={read}>
          {error && <div className="error">{error}</div>}
          <label className="field">
            Enlace de la actividad (Aules, Moodle u otra web)
            <input
              name="activity_url"
              autoFocus
              value={url}
              disabled={step === 'reading'}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://aules.edu.gva.es/…/mod/assign/view.php?id=…"
            />
          </label>
          {step === 'reading' ? (
            <div className="notice small">
              Leyendo la actividad… Si la plataforma te pide iniciar sesión, se abrirá una ventana: entra con tu
              usuario y la lectura seguirá sola. La sesión se guarda para la próxima vez.
            </div>
          ) : (
            <p className="muted small">
              Se leerán el título, la asignatura, la fecha de entrega, el enunciado y los ficheros adjuntos. Podrás
              revisarlo todo antes de guardar.
            </p>
          )}
          <div className="modal-actions">
            <button type="button" className="ghost" onClick={close}>
              Cancelar
            </button>
            <button type="submit" className="primary" disabled={step === 'reading' || !url.trim()}>
              {step === 'reading' ? 'Leyendo…' : 'Leer actividad'}
            </button>
          </div>
        </form>
      </Modal>
    )
  }

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
      modalTitle="Revisa la actividad importada"
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
      onClose={onClose}
      onSaved={async (item) => {
        const files = act.files
          .filter((f) => selected.has(f.url))
          .map(({ name, url: u, section }) => ({ name, url: u, section }))
        if (files.length === 0) {
          onToast('Actividad guardada')
        } else {
          try {
            const r = await window.api.importer.download(item.id, files)
            const parts = [`Actividad guardada · ${r.added} fichero${r.added === 1 ? '' : 's'} en ${r.dir}`]
            if (r.errors.length) parts.push(`No se pudo descargar ${r.errors[0]}`)
            onToast(parts.join(' · '), r.errors.length > 0)
          } catch (err) {
            onToast(`Actividad guardada, pero la descarga falló: ${errorMessage(err)}`, true)
          }
        }
        onImported(item)
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
