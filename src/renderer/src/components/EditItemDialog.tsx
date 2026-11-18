import { useEffect, useState } from 'react'
import type { Item, Subject } from '../../../shared/types'
import ItemForm from './ItemForm'

/** Editar un elemento desde cualquier vista (Panel, Entregas, Buscar). */
export default function EditItemDialog({
  item,
  onSaved,
  onClose
}: {
  item: Item
  onSaved: (i: Item) => void
  onClose: () => void
}) {
  const [subjects, setSubjects] = useState<Subject[] | null>(null)
  useEffect(() => {
    void window.api.subjects.list().then(setSubjects)
  }, [])
  if (!subjects) return null
  return <ItemForm subjects={subjects} units={[]} initial={item} onSaved={onSaved} onClose={onClose} />
}
