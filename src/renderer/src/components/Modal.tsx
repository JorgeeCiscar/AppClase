import type { ReactNode } from 'react'

export default function Modal({
  title,
  children,
  onClose
}: {
  title: string
  children: ReactNode
  onClose: () => void
}) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="modal" role="dialog" aria-label={title}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  )
}
