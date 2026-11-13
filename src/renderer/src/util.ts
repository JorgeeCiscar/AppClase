export function errorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  // Electron envuelve los errores de IPC: "Error invoking remote method 'x': Error: ..."
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/** Formatea una fecha AAAA-MM-DD como «12 nov 2026». */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return iso
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function fmtSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return ''
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(0)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}

export const today = (): string => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Días que faltan para una fecha (negativo si ya pasó). */
export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return null
  const target = new Date(y, m - 1, d)
  const now = new Date()
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((target.getTime() - base.getTime()) / 86400000)
}

export function dueLabel(iso: string | null | undefined): string {
  const n = daysUntil(iso)
  if (n === null) return ''
  if (n === 0) return 'hoy'
  if (n === 1) return 'mañana'
  if (n === -1) return 'ayer'
  return n > 0 ? `en ${n} días` : `hace ${Math.abs(n)} días`
}

/** Icono según la extensión, para que la lista de ficheros se lea de un vistazo. */
export function fileIcon(ext: string | null | undefined): string {
  const e = (ext || '').toLowerCase()
  if (['.pdf'].includes(e)) return '📕'
  if (['.doc', '.docx', '.odt', '.rtf'].includes(e)) return '📄'
  if (['.xls', '.xlsx', '.ods', '.csv'].includes(e)) return '📊'
  if (['.ppt', '.pptx', '.odp'].includes(e)) return '📑'
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'].includes(e)) return '🖼️'
  if (['.zip', '.rar', '.7z', '.tar', '.gz'].includes(e)) return '🗜️'
  if (['.java', '.class', '.jar'].includes(e)) return '☕'
  if (['.sql', '.db', '.sqlite'].includes(e)) return '🗄️'
  if (['.html', '.htm', '.xml', '.css'].includes(e)) return '🌐'
  if (['.js', '.ts', '.jsx', '.tsx', '.py', '.php', '.c', '.cpp', '.cs', '.sh'].includes(e)) return '📜'
  if (['.mp4', '.avi', '.mkv', '.mov'].includes(e)) return '🎬'
  return '📎'
}

export const KIND_LABEL: Record<string, string> = {
  apunte: 'Apunte',
  enunciado: 'Enunciado',
  ejercicio: 'Ejercicio',
  examen: 'Examen',
  enlace: 'Enlace'
}
