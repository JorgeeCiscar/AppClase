import { useCallback, useEffect, useState } from 'react'
import type { Item, Opener, Stats } from '../../../shared/types'
import { fmtDateTime, fileIcon } from '../util'
import EditItemDialog from './EditItemDialog'
import ImportButton from './ImportActivity'
import ItemDetail from './ItemDetail'
import ItemRow from './ItemRow'

export default function Dashboard({
  openers,
  onToast
}: {
  openers: Opener[]
  onToast: (msg: string, bad?: boolean) => void
}) {
  const [stats, setStats] = useState<Stats | undefined>()
  const [openItem, setOpenItem] = useState<number | null>(null)
  const [editing, setEditing] = useState<Item | null>(null)

  const load = useCallback(async () => setStats(await window.api.stats()), [])
  useEffect(() => {
    void load()
    const onFocus = (): void => void load()
    window.addEventListener('focus', onFocus)
    const off = window.api.files.onChanged(() => void load())
    return () => {
      window.removeEventListener('focus', onFocus)
      off()
    }
  }, [load])

  if (!stats) return <div className="page" />

  const open = (i: Item): void => setOpenItem(i.id)

  return (
    <div className="page">
      <div className="page-header">
        <h1>Panel</h1>
        <ImportButton className="primary" onToast={onToast} onImported={() => void load()} />
      </div>

      <div className="dash">
        <div className="stats dash-stats">
          <div className="stat">
            <span>{stats.items}</span>elementos
          </div>
          <div className="stat">
            <span>{stats.files}</span>ficheros indexados
          </div>
          <div className={`stat${stats.pending ? ' warn' : ''}`}>
            <span>{stats.pending}</span>entregas sin terminar
          </div>
          <div className={`stat${stats.overdue ? ' alert' : ''}`}>
            <span>{stats.overdue}</span>fuera de plazo
          </div>
          <div className={`stat${stats.missing ? ' alert' : ''}`}>
            <span>{stats.missing}</span>ficheros sin encontrar
          </div>
        </div>

        {stats.overdueItems.length > 0 && (
          <section className="dash-block dash-overdue">
            <h2>Fuera de plazo</h2>
            <div className="list">
              {stats.overdueItems.map((i) => (
                <ItemRow key={i.id} item={i} onOpen={open} showSubject />
              ))}
            </div>
          </section>
        )}

        <section className="dash-block dash-soon">
          <h2>Próximas dos semanas</h2>
          {stats.dueSoon.length === 0 ? (
            <p className="muted small">Nada con fecha límite próxima.</p>
          ) : (
            <div className="list">
              {stats.dueSoon.map((i) => (
                <ItemRow key={i.id} item={i} onOpen={open} showSubject />
              ))}
            </div>
          )}
        </section>

        <section className="dash-block dash-recent">
          <h2>Últimos ficheros añadidos</h2>
          {stats.recentFiles.length === 0 ? (
            <p className="muted small">Todavía no has indexado ningún fichero.</p>
          ) : (
            <div className="files">
              {stats.recentFiles.map((f) => (
                <div key={f.id} className={`file-row${f.missing ? ' missing' : ''}`}>
                  <span className="icon">{fileIcon(f.ext)}</span>
                  <div className="col" style={{ minWidth: 0, flex: 1 }}>
                    <div className="fname">{f.name}</div>
                    <div className="small muted">
                      {f.subject_name} · {f.item_title}
                      {f.added_at ? ` · añadido ${fmtDateTime(f.added_at)}` : ''}
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
          )}
        </section>
      </div>

      {openItem !== null && (
        <ItemDetail
          itemId={openItem}
          openers={openers}
          onToast={onToast}
          onChanged={() => void load()}
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
            void load()
          }}
        />
      )}
    </div>
  )
}
