import { useState } from 'react'

export default function TagInput({
  tags,
  onChange,
  suggestions = []
}: {
  tags: string[]
  onChange: (tags: string[]) => void
  suggestions?: string[]
}) {
  const [draft, setDraft] = useState('')

  const add = (raw: string): void => {
    const t = raw.trim().replace(/\s+/g, ' ')
    if (!t) return
    if (!tags.some((x) => x.toLowerCase() === t.toLowerCase())) onChange([...tags, t])
    setDraft('')
  }

  return (
    <div>
      <div className="tags-input">
        {tags.map((t) => (
          <span className="badge tag" key={t}>
            {t}
            <button type="button" aria-label={`Quitar ${t}`} onClick={() => onChange(tags.filter((x) => x !== t))}>
              ×
            </button>
          </span>
        ))}
        <input
          value={draft}
          placeholder="etiqueta y Enter"
          list="tag-suggestions"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              add(draft)
            } else if (e.key === 'Backspace' && !draft && tags.length) {
              onChange(tags.slice(0, -1))
            }
          }}
          onBlur={() => add(draft)}
        />
      </div>
      <datalist id="tag-suggestions">
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </div>
  )
}
