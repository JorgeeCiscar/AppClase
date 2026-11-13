import { useCallback, useEffect, useState } from 'react'
import type { Item, Opener, Status } from '../../../shared/types'
import { STATUSES } from '../../../shared/types'
import ImportButton from './ImportActivity'
import ItemDetail from './ItemDetail'
import ItemRow from './ItemRow'

export default function DeliverablesView({ openers, onToast }: { openers: Opener[]; onToast: (m: string, bad?: boolean) => void }) {
  const [items, setItems] = useState<Item[]>([])
  const [status, setStatus] = useState<Status | ''>('')
  const [onlyOverdue, setOnlyOverdue] = useState(false)
  const [openItem, setOpenItem] = useState<number | null>(null)

  const load = useCallback(async () => {
    setItems(
      await window.api.items.list({
        dueOnly: !onlyOverdue,
        overdueOnly: onlyOverdue || undefined,
        status: status || undefined
      })
    )
  }, [status, onlyOverdue])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="page">
      <div className="page-header">
        <h1>Entregas</h1>
        <ImportButton className="primary" onToast={onToast} onImported={() => void load()} />
      </div>

      <div className="row-wrap" style={{ marginTop: 12 }}>
        <select value={status} onChange={(e) => setStatus(e.target.value as Status | '')}>
          <option value="">Todos los estados</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <label className="row small">
          <input type="checkbox" checked={onlyOverdue} onChange={(e) => setOnlyOverdue(e.target.checked)} />
          solo fuera de plazo
        </label>
      </div>

      {items.length === 0 ? (
        <p className="empty">Nada con fecha límite que cumpla el filtro.</p>
      ) : (
        <div className="list">
          {items.map((i) => (
            <ItemRow key={i.id} item={i} onOpen={(x) => setOpenItem(x.id)} showSubject />
          ))}
        </div>
      )}

      {openItem !== null && (
        <ItemDetail
          itemId={openItem}
          openers={openers}
          onToast={onToast}
          onChanged={() => void load()}
          onEdit={() => setOpenItem(null)}
          onClose={() => setOpenItem(null)}
        />
      )}
    </div>
  )
}
