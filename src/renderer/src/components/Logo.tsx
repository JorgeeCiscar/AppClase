/** Trazos del logo de Cursia: una «C» en tres tramos (el último, en el color de acento). */
export const LOGO_PATHS = [
  'M46.72 15.65A22 22 0 0 0 18.46 14.66',
  'M16.17 16.72A22 22 0 0 0 16.17 47.28',
  'M18.46 49.34A22 22 0 0 0 46.72 48.35'
] as const

/** Logo de Cursia. Sus colores (--logo-a y --logo-b) cambian con el tema claro u oscuro. */
export default function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg className="brand-logo" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <path d={LOGO_PATHS[0]} fill="none" stroke="var(--logo-a)" strokeWidth="9" />
      <path d={LOGO_PATHS[1]} fill="none" stroke="var(--logo-a)" strokeWidth="9" />
      <path d={LOGO_PATHS[2]} fill="none" stroke="var(--logo-b)" strokeWidth="9" />
    </svg>
  )
}
