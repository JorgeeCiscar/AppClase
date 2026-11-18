import { useEffect, useRef, useState } from 'react'
import type { Item, Opener, SearchResult } from '../../../shared/types'
import { fileIcon } from '../util'
import EditItemDialog from './EditItemDialog'
import ItemDetail from './ItemDetail'
import ItemRow from './ItemRow'

const EMPTY: SearchResult = { subjects: [], items: [], files: [], tags: [], content: [], contentTruncated: false }

export default function SearchView({
  initialQuery,
  openers,
  onToast,
  onOpenSubject
}: {
  initialQuery?: string
  openers: Opener[]
  onToast: (m: string, bad?: boolean) => void
  onOpenSubject: (id: number) => void
}) {
  const [q, setQ] = useState(initialQuery ?? '')
  const [inContent, setInContent] = useState(false)
  const [res, setRes] = useState<SearchResult>(EMPTY)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const [openItem, setOpenItem] = useState<number | null>(null)
  const [editing, setEditing] = useState<Item | null>(null)
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    input.current?.focus()
  }, [])

  // La búsqueda en nombres es inmediata; la de contenido lee ficheros, así que
  // se espera un poco más antes de lanzarla.
  useEffect(() => {
    if (q.trim().length < 2) {
      setRes(EMPTY)
      return
    }
    setBusy(true)
    const t = setTimeout(
      () => {
        void window.api
          .search(q, inContent)
          .then(setRes)
          .finally(() => setBusy(false))
      },
      inContent ? 350 : 120
    )
    return () => clearTimeout(t)
  }, [q, inContent, refresh])

  const nothing =
    q.trim().length >= 2 &&
    !busy &&
    res.subjects.length === 0 &&
    res.items.length === 0 &&
    res.files.length === 0 &&
    res.tags.length === 0 &&
    res.content.length === 0

  return (
    <div className="page">
      <div className="page-header">
        <h1>Buscar</h1>
      </div>

      <div className="search-box">
        <input
          ref={input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Asignatura, elemento, nombre de fichero, etiqueta…"
        />
        <label className="row small" title="Lee el contenido de los ficheros de texto indexados">
          <input type="checkbox" checked={inContent} onChange={(e) => setInContent(e.target.checked)} />
          dentro de los ficheros
        </label>
      </div>

      {q.trim().length < 2 && <p className="muted small">Escribe al menos dos letras.</p>}
      {busy && <p className="muted small">Buscando…</p>}
      {nothing && <p className="empty">Sin resultados para «{q}».</p>}

      {res.tags.length > 0 && (
        <>
          <h2>Etiquetas</h2>
          <div className="row-wrap">
            {res.tags.map((t) => (
              <span className="badge tag" key={t}>
                {t}
              </span>
            ))}
          </div>
        </>
      )}

      {res.subjects.length > 0 && (
        <>
          <h2>Asignaturas</h2>
          <div className="list">
            {res.subjects.map((s) => (
              <div key={s.id} className="list-row clickable" onClick={() => onOpenSubject(s.id)}>
                <div className="col">
                  <div className="title">{s.name}</div>
                  <div className="sub">
                    {s.item_count} elementos · {s.file_count} ficheros
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {res.items.length > 0 && (
        <>
          <h2>Elementos</h2>
          <div className="list">
            {res.items.map((i) => (
              <ItemRow key={i.id} item={i} onOpen={(x) => setOpenItem(x.id)} showSubject />
            ))}
          </div>
        </>
      )}

      {res.files.length > 0 && (
        <>
          <h2>Ficheros</h2>
          <div className="files">
            {res.files.map((f) => (
              <div key={f.id} className={`file-row${f.missing ? ' missing' : ''}`}>
                <span className="icon">{fileIcon(f.ext)}</span>
                <div className="col" style={{ minWidth: 0, flex: 1 }}>
                  <div className="fname">{f.name}</div>
                  <div className="small muted">
                    {f.subject_name} · {f.item_title}
                  </div>
                </div>
                {f.missing ? (
                  <span className="chip-missing">no se encuentra</span>
                ) : (
                  <button
                    className="tiny primary"
                    onClick={async () => {
                      const r = await window.api.files.open(f.id)
                      if (!r.ok && r.error) onToast(r.error, true)
                    }}
                  >
                    Abrir
                  </button>
                )}
                <button className="tiny ghost" onClick={() => setOpenItem(f.item_id)}>
                  Ver elemento
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {res.content.length > 0 && (
        <>
          <h2>Dentro de los ficheros</h2>
          {res.contentTruncated && <div className="notice small">Hay más coincidencias de las que se muestran; afina la búsqueda.</div>}
          <div className="files">
            {res.content.map((c, idx) => (
              <div key={`${c.file_id}-${c.line}-${idx}`} className="file-row">
                <span className="icon">{fileIcon(c.name.slice(c.name.lastIndexOf('.')))}</span>
                <div className="col" style={{ minWidth: 0, flex: 1 }}>
                  <div className="fname">
                    {c.name} <span className="muted small">línea {c.line}</span>
                  </div>
                  <div className="snippet">{c.snippet}</div>
                  <div className="small muted">
                    {c.subject_name} · {c.item_title}
                  </div>
                </div>
                <button
                  className="tiny primary"
                  onClick={async () => {
                    const r = await window.api.files.open(c.file_id)
                    if (!r.ok && r.error) onToast(r.error, true)
                  }}
                >
                  Abrir
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {openItem !== null && (
        <ItemDetail
          itemId={openItem}
          openers={openers}
          onToast={onToast}
          onChanged={() => {}}
          onEdit={(i) => {
            setOpenItem(null)
            setEditing(i)
          }}
          onClose={() => setOpenItem(null)}
        />
      )}

      {editing && (
        <EditItemDialog
          item={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            // Repetir la búsqueda para que se vean los cambios.
            setRefresh((r) => r + 1)
          }}
        />
      )}
    </div>
  )
}
