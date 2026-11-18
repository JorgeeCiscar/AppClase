import { useEffect, useRef, useState } from 'react'
import type {
  CourseActivity,
  DetectedUnit,
  FileSection,
  Item,
  ItemKind,
  ScrapedCourse,
  Subject
} from '../../../shared/types'
import { matchSubject, parseUnit } from '../../../shared/match'
import { KIND_LABEL, errorMessage } from '../util'
import Modal from './Modal'

/** ¿Es el enlace de una asignatura entera (la página del curso en Moodle/Aules)? */
export const isCourseUrl = (u: string): boolean =>
  /\/course\/view\.php\?(?:[^#]*&)?id=\d+/i.test(u) || /\/course\/section\.php\?(?:[^#]*&)?id=\d+/i.test(u)

/** Tipos de actividad de Moodle y cómo se importan. */
const TYPES: { key: string; label: string; kind: ItemKind; mods: string[]; on: boolean }[] = [
  { key: 'tareas', label: 'Tareas', kind: 'ejercicio', mods: ['assign'], on: true },
  { key: 'examenes', label: 'Exámenes', kind: 'examen', mods: ['quiz'], on: true },
  { key: 'apuntes', label: 'Apuntes', kind: 'apunte', mods: ['resource', 'folder', 'page', 'book'], on: true },
  { key: 'enlaces', label: 'Enlaces', kind: 'enlace', mods: ['url'], on: true },
  { key: 'otras', label: 'Otras actividades', kind: 'ejercicio', mods: [], on: false }
]
/** No son actividades que guardar: avisos, etiquetas de texto, videoconferencias… */
const IGNORED = new Set(['forum', 'label', 'qbank', 'subsection', 'chat', 'bigbluebuttonbn'])
const typeOf = (modtype: string): (typeof TYPES)[number] => TYPES.find((t) => t.mods.includes(modtype)) ?? TYPES[4]

/** Identifica una actividad de Moodle aunque el enlace cambie de forma («…/mod/assign/7»). */
export function moodleKey(raw: string | null | undefined): string {
  if (!raw) return ''
  try {
    const u = new URL(raw)
    const m = /\/mod\/([a-z0-9_]+)\/view\.php$/i.exec(u.pathname)
    const id = u.searchParams.get('id')
    return m && id ? `${u.origin}/mod/${m[1].toLowerCase()}/${id}` : u.href.split('#')[0]
  } catch {
    return raw
  }
}

function withParam(raw: string, key: string, value: string): string {
  const u = new URL(raw)
  u.searchParams.set(key, value)
  return u.href
}

/** «Descargar carpeta» de Moodle: un .zip con todo lo que hay dentro. */
function folderZip(raw: string): string {
  const u = new URL(raw)
  return `${u.origin}${u.pathname.replace(/\/view\.php$/, '/download_folder.php')}?id=${u.searchParams.get('id')}`
}

const unitText = (u: DetectedUnit | null): string =>
  u ? `${u.number !== null ? `Unidad ${u.number} · ` : ''}${u.title}` : 'Sin unidad'

type Result = { state: 'espera' | 'importando' | 'hecha' | 'error' | 'aviso'; msg?: string }

interface Row {
  act: CourseActivity
  unit: DetectedUnit | null
  key: string
  exists: boolean
}

/**
 * Importar una asignatura entera desde su enlace: lee sus unidades y actividades,
 * te deja elegir qué importar y luego importa cada una en su unidad, en orden.
 */
export default function CourseImport({
  url,
  defaultSubjectId,
  onToast,
  onImported,
  onClose
}: {
  url: string
  defaultSubjectId?: number
  onToast: (msg: string, bad?: boolean) => void
  onImported: () => void
  onClose: () => void
}) {
  const [step, setStep] = useState<'leyendo' | 'revision' | 'importando' | 'hecho'>('leyendo')
  const [error, setError] = useState('')
  const [course, setCourse] = useState<ScrapedCourse | null>(null)
  const [sections, setSections] = useState<{ title: string; unit: DetectedUnit | null; rows: Row[] }[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [subjectId, setSubjectId] = useState<number>(0)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [results, setResults] = useState<Record<string, Result>>({})
  const stopRef = useRef(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const [c, subs, items] = await Promise.all([
          window.api.importer.readCourse(url),
          window.api.subjects.list(),
          window.api.items.list({})
        ])
        if (!alive) return
        const existing = new Set(items.map((i) => moodleKey(i.url)).filter(Boolean))
        const secs = c.sections
          .map((s) => ({
            title: s.title,
            unit: parseUnit(s.title),
            rows: s.activities
              .filter((a) => !IGNORED.has(a.modtype))
              .map((a) => ({
                act: a,
                unit: parseUnit(s.title),
                key: moodleKey(a.url),
                exists: existing.has(moodleKey(a.url))
              }))
          }))
          .filter((s) => s.rows.length)
        if (!secs.length)
          throw new Error('No se encontraron actividades en esa página. ¿Es la página principal de la asignatura?')
        setCourse(c)
        setSubjects(subs)
        setSubjectId(matchSubject(c.course, '', subs) ?? defaultSubjectId ?? subs[0]?.id ?? 0)
        setSections(secs)
        // Se marca lo nuevo de los tipos activados; lo que ya está en la app, no.
        setChosen(
          new Set(
            secs
              .flatMap((s) => s.rows)
              .filter((r) => !r.exists && typeOf(r.act.modtype).on)
              .map((r) => r.key)
          )
        )
        setStep('revision')
      } catch (err) {
        if (alive) setError(errorMessage(err))
      }
    })()
    return () => {
      alive = false
    }
  }, [url])

  const allRows = sections.flatMap((s) => s.rows)
  const newRows = allRows.filter((r) => !r.exists)
  const toggle = (keys: string[], on?: boolean): void =>
    setChosen((prev) => {
      const next = new Set(prev)
      const add = on ?? !keys.every((k) => next.has(k))
      for (const k of keys) {
        if (add) next.add(k)
        else next.delete(k)
      }
      return next
    })

  /** Importa una actividad en la asignatura elegida, en la unidad de su sección. */
  const importOne = async (r: Row): Promise<Result> => {
    const typ = typeOf(r.act.modtype)
    const base = { subject_id: subjectId, kind: typ.kind, title: r.act.name, url: r.act.url, new_unit: r.unit }
    const download = async (
      item: Item,
      files: { name: string; url: string; section: FileSection }[]
    ): Promise<Result> => {
      if (!files.length) return { state: 'hecha' }
      const d = await window.api.importer.download(item.id, files)
      return d.errors.length
        ? { state: 'aviso', msg: `importada, pero no se pudo descargar ${d.errors[0]}` }
        : { state: 'hecha' }
    }
    if (r.act.modtype === 'resource' || r.act.modtype === 'folder' || r.act.modtype === 'url') {
      const item = await window.api.items.save(base)
      if (r.act.modtype === 'resource') {
        return download(item, [{ name: r.act.name, url: withParam(r.act.url, 'redirect', '1'), section: 'enunciado' }])
      }
      if (r.act.modtype === 'folder') {
        return download(item, [{ name: `${r.act.name}.zip`, url: folderZip(r.act.url), section: 'enunciado' }])
      }
      return { state: 'hecha' }
    }
    // Tareas, cuestionarios, páginas…: se lee su página como al importar una sola.
    const a = await window.api.importer.read(r.act.url)
    const notes = [a.description, a.due_raw ? `Entrega según la plataforma: ${a.due_raw}` : '']
      .filter(Boolean)
      .join('\n\n')
    const item = await window.api.items.save({
      ...base,
      title: a.title || r.act.name,
      notes,
      url: a.url || r.act.url,
      due_date: a.due_date,
      status: a.submission?.status ?? (typ.kind === 'ejercicio' ? 'pendiente' : null),
      new_unit: r.unit ?? a.unit
    })
    return download(
      item,
      a.files.map(({ name, url: u, section }) => ({ name, url: u, section }))
    )
  }

  const run = async (): Promise<void> => {
    const queue = allRows.filter((r) => chosen.has(r.key) && !r.exists)
    stopRef.current = false
    setResults(Object.fromEntries(queue.map((r) => [r.key, { state: 'espera' } as Result])))
    setStep('importando')
    await window.api.sync.backup('antes-de-importar').catch(() => {})
    let done = 0
    for (const r of queue) {
      if (stopRef.current) break
      setResults((prev) => ({ ...prev, [r.key]: { state: 'importando' } }))
      let res: Result
      try {
        res = await importOne(r)
        done++
      } catch (err) {
        res = { state: 'error', msg: errorMessage(err) }
        // Si cierras la ventana de inicio de sesión, se para todo.
        if (/cancelada/i.test(res.msg ?? '')) stopRef.current = true
      }
      setResults((prev) => ({ ...prev, [r.key]: res }))
    }
    if (done) onImported()
    setStep('hecho')
  }

  // ------------------------------------------------------------------ lectura
  if (step === 'leyendo') {
    return (
      <Modal title="Importar una asignatura entera" onClose={onClose}>
        {error ? (
          <div className="error">{error}</div>
        ) : (
          <div className="notice small">
            Leyendo la asignatura… Si la plataforma te pide iniciar sesión, se abrirá una ventana: entra con tu usuario
            y la lectura seguirá sola.
          </div>
        )}
        <div className="modal-actions">
          <button
            className="ghost"
            onClick={() => {
              if (!error) void window.api.importer.cancel()
              onClose()
            }}
          >
            {error ? 'Cerrar' : 'Cancelar'}
          </button>
        </div>
      </Modal>
    )
  }

  // ---------------------------------------------------------- revisión
  if (step === 'revision' && course) {
    const nChosen = newRows.filter((r) => chosen.has(r.key)).length
    return (
      <Modal title={`Importar «${course.course || 'la asignatura'}»`} onClose={onClose} wide>
        <div className="form">
          <div className="notice small">
            {newRows.length} actividades nuevas en {sections.length} {sections.length === 1 ? 'sección' : 'secciones'}
            {allRows.length > newRows.length && (
              <> · {allRows.length - newRows.length} ya están en la app (no se repiten)</>
            )}
            . Cada una irá a su unidad; si la unidad no existe en la asignatura, se crea.
          </div>
          <label className="field" style={{ maxWidth: 420 }}>
            Guardar en la asignatura
            <select name="course_subject" value={subjectId} onChange={(e) => setSubjectId(Number(e.target.value))}>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <div className="type-chips">
            {TYPES.map((t) => {
              const keys = newRows.filter((r) => typeOf(r.act.modtype) === t).map((r) => r.key)
              if (!keys.length) return null
              const all = keys.every((k) => chosen.has(k))
              return (
                <label key={t.key} className="type-chip">
                  <input
                    type="checkbox"
                    name={`type_${t.key}`}
                    checked={all}
                    onChange={(e) => toggle(keys, e.target.checked)}
                  />
                  {t.label} <span className="muted">({keys.length})</span>
                </label>
              )
            })}
          </div>

          <div className="course-sections">
            {sections.map((s, i) => {
              const keys = s.rows.filter((r) => !r.exists).map((r) => r.key)
              return (
                <section key={i} className="course-section" data-unit={unitText(s.unit)}>
                  <label className="course-section-title">
                    <input
                      type="checkbox"
                      disabled={!keys.length}
                      checked={keys.length > 0 && keys.every((k) => chosen.has(k))}
                      onChange={(e) => toggle(keys, e.target.checked)}
                    />
                    <strong>{unitText(s.unit)}</strong>
                    {s.title && s.unit?.title !== s.title && <span className="muted small">«{s.title}»</span>}
                  </label>
                  {s.rows.map((r) => (
                    <label key={r.key} className={`course-act${r.exists ? ' exists' : ''}`} data-key={r.key}>
                      <input
                        type="checkbox"
                        disabled={r.exists}
                        checked={!r.exists && chosen.has(r.key)}
                        onChange={() => toggle([r.key])}
                      />
                      <span className="badge kind">{KIND_LABEL[typeOf(r.act.modtype).kind]}</span>
                      <span className="course-act-name">{r.act.name}</span>
                      {r.exists && <span className="badge tag">ya en la app</span>}
                    </label>
                  ))}
                </section>
              )
            })}
          </div>

          <div className="modal-actions">
            <button className="ghost" onClick={onClose}>
              Cancelar
            </button>
            <button className="primary" disabled={!nChosen || !subjectId} onClick={() => void run()}>
              Importar {nChosen} {nChosen === 1 ? 'actividad' : 'actividades'}
            </button>
          </div>
        </div>
      </Modal>
    )
  }

  // ----------------------------------------------- importación y resumen
  const queue = allRows.filter((r) => results[r.key])
  const count = (st: Result['state']): number => queue.filter((r) => results[r.key].state === st).length
  const finished = step === 'hecho'
  const current = queue.findIndex((r) => results[r.key].state === 'importando')
  return (
    <Modal
      title={finished ? 'Asignatura importada' : 'Importando la asignatura…'}
      onClose={finished ? onClose : () => {}}
      wide
    >
      <div className="form">
        <div className={`notice small${finished && count('error') ? ' warn-box' : ''}`}>
          {finished ? (
            <>
              {count('hecha') + count('aviso')} importadas
              {count('error') > 0 && <> · {count('error')} con error</>}
              {count('espera') > 0 && <> · {count('espera')} sin importar (se detuvo)</>}
            </>
          ) : (
            <>
              Importando {current + 1} de {queue.length}…
            </>
          )}
        </div>
        <div className="course-sections">
          {queue.map((r) => {
            const res = results[r.key]
            return (
              <div key={r.key} className={`course-act result-${res.state}`} data-result={res.state}>
                <span className="badge kind">{KIND_LABEL[typeOf(r.act.modtype).kind]}</span>
                <span className="course-act-name">{r.act.name}</span>
                <span className="muted small">{unitText(r.unit)}</span>
                <span className="result-label">
                  {res.state === 'importando'
                    ? 'importando…'
                    : res.state === 'espera'
                      ? 'en espera'
                      : res.state === 'hecha'
                        ? 'hecha'
                        : res.msg}
                </span>
              </div>
            )
          })}
        </div>
        <div className="modal-actions">
          {finished ? (
            <button
              className="primary"
              onClick={() => {
                onToast(`Asignatura importada: ${count('hecha') + count('aviso')} actividades`, count('error') > 0)
                onClose()
              }}
            >
              Cerrar
            </button>
          ) : (
            <button
              className="ghost"
              onClick={() => {
                stopRef.current = true
              }}
            >
              Detener
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}
