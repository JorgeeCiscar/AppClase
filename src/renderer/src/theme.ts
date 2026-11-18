import type { Theme } from '../../shared/types'

const KEY = 'cursia.tema'
const media = window.matchMedia('(prefers-color-scheme: light)')
let current: Theme = 'oscuro'

/** «claro» u «oscuro» según el tema elegido (y el del sistema, con «sistema»). */
const resolve = (t: Theme): 'claro' | 'oscuro' => (t === 'sistema' ? (media.matches ? 'claro' : 'oscuro') : t)

/** Aplica el tema a la interfaz y lo recuerda para el próximo arranque (sin parpadeo). */
export function applyTheme(t: Theme): void {
  current = t
  document.documentElement.dataset.theme = resolve(t)
  try {
    localStorage.setItem(KEY, t)
  } catch {
    /* sin almacenamiento */
  }
}

/** Al arrancar, antes de leer los ajustes: el último tema usado. */
export function applyStoredTheme(): void {
  let t: Theme = 'oscuro'
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'claro' || v === 'oscuro' || v === 'sistema') t = v
  } catch {
    /* sin almacenamiento */
  }
  applyTheme(t)
}

// Con «Como el sistema», sigue los cambios del sistema en directo.
media.addEventListener('change', () => current === 'sistema' && applyTheme(current))
