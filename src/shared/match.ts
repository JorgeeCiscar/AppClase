// Relaciona el curso que muestra la plataforma con una de tus asignaturas.

/** Minúsculas y sin tildes: «Programació» y «programacio» se comparan igual. */
export const norm = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Otros nombres con los que aparecen los módulos de 1º de DAW en las plataformas,
 * sobre todo en valenciano (Aules). La clave es el nombre normalizado de la asignatura.
 */
const ALIASES: Record<string, string[]> = {
  'sistemas informaticos': ['sistemes informatics'],
  'bases de datos': ['bases de dades'],
  programacion: ['programacio'],
  'lenguajes de marcas y sistemas de gestion de informacion': [
    'lenguajes de marcas',
    'llenguatges de marques',
    'llenguatge de marques'
  ],
  'entornos de desarrollo': ['entorns de desenvolupament'],
  'formacion y orientacion laboral': ['formacio i orientacio laboral']
}

// ------------------------------------------------------------------ unidades

/** «UD 3 - Arrays», «U.D. 3», «Unidad didáctica 3:», «Unitat 1:», «Tema 2.», «Unit 4», «U3 …». */
const UNIT_RE =
  /^\s*(?:u\.?\s*d\.?|unidad(?:\s+did[aá]ctica)?|unitat(?:\s+did[aà]ctica)?|unit|tema|bloque|bloc|u(?=\s*\d))\s*(\d{1,3})\b[\s:.\-–—)|]*(.*)$/i
/** La sección 0 de Moodle no es una unidad. */
const NOT_A_UNIT = /^(general|generalidades|generalitats|general section|presentaci[oó]n|presentaci[oó])$/i

/**
 * Saca la unidad de la sección de Moodle donde está la actividad; si no la hay,
 * prueba con el principio del título («UD3 - Tarea 2»). Devuelve null si no hay.
 */
export function parseUnit(section: string, title = ''): { number: number | null; title: string } | null {
  const sec = (section || '').replace(/\s+/g, ' ').trim()
  if (sec && !NOT_A_UNIT.test(sec)) {
    const m = UNIT_RE.exec(sec)
    if (m) {
      const n = Number(m[1])
      return { number: n, title: m[2].trim() || `Unidad ${n}` }
    }
    return { number: null, title: sec.slice(0, 120) }
  }
  const m = UNIT_RE.exec((title || '').trim())
  if (m) return { number: Number(m[1]), title: `Unidad ${Number(m[1])}` }
  return null
}

interface UnitLike {
  id: number
  number: number | null
  title: string
}

/**
 * La unidad de la asignatura que corresponde a la leída: por número si los dos
 * lo tienen (los profesores no siempre la titulan igual), si no por nombre.
 */
export function findUnit<T extends UnitLike>(units: T[], wanted: { number: number | null; title: string }): T | undefined {
  if (wanted.number !== null) {
    const byNumber = units.find((u) => u.number === wanted.number)
    if (byNumber) return byNumber
  }
  const t = norm(wanted.title)
  return units.find((u) => norm(u.title) === t)
}

interface SubjectLike {
  id: number
  name: string
  short_name: string | null
}

/**
 * Devuelve el id de la asignatura que mejor encaja con el curso (y, en segundo
 * plano, con el título de la actividad), o null si ninguna encaja.
 */
export function matchSubject(course: string, title: string, subjects: SubjectLike[]): number | null {
  const sources: [string, number][] = [
    [course, 2],
    [title, 1]
  ]
  let best: { id: number; score: number } | null = null
  for (const s of subjects) {
    const key = norm(s.name)
    const phrases = [key, ...(ALIASES[key] ?? [])]
    let score = 0
    for (const [text, weight] of sources) {
      if (!text) continue
      const t = norm(text)
      for (const p of phrases) {
        if (p.length >= 4 && t.includes(p)) score = Math.max(score, p.length * weight)
      }
      // La abreviatura solo cuenta en mayúsculas y como palabra suelta («PRO», «BD»),
      // para no confundir «SI» con la palabra «si».
      if (s.short_name && s.short_name.length >= 2) {
        const re = new RegExp(`(^|[^A-Za-z0-9])${s.short_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9]|$)`)
        if (re.test(text)) score = Math.max(score, 3 * weight)
      }
    }
    if (score > 0 && (!best || score > best.score)) best = { id: s.id, score }
  }
  return best?.id ?? null
}
