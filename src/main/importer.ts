import { BrowserWindow, session } from 'electron'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { ActivityFile, DownloadResult, FileSection, ScrapedActivity, ScrapedCourse, Status } from '../shared/types'
import { parseUnit } from '../shared/match'
import { FILE_SECTION_LABEL } from '../shared/types'
import type { DB } from './db'
import { addPaths } from './files'

/**
 * Sesión propia y persistente para la plataforma del curso: inicias sesión una vez
 * en la ventana de lectura y las cookies se guardan para las siguientes lecturas y
 * para descargar los ficheros. Está separada de la sesión de la app.
 */
export const PLATFORM_PARTITION = 'persist:plataforma'

const READ_TIMEOUT_MS = 10 * 60 * 1000
const SHOW_WINDOW_AFTER_MS = 15 * 1000
const MAX_FILE_BYTES = 200 * 1024 * 1024

let current: BrowserWindow | null = null

// ------------------------------------------------------------ lectura de la página

/**
 * Se ejecuta DENTRO de la página de la actividad. Es JavaScript plano en un texto
 * (no una función del bundle) para que el empaquetador no lo transforme.
 * Devuelve datos en bruto; la interpretación se hace en el proceso principal.
 */
const EXTRACT = String.raw`(() => {
  const txt = (el) => (el ? String(el.innerText || el.textContent || '').replace(/[ \t]+\n/g, '\n').trim() : '');
  const q = (sel) => document.querySelector(sel);
  const visiblePassword = Array.from(document.querySelectorAll('input[type="password"]'))
    .some((i) => i.offsetParent !== null);
  const isLogin = visiblePassword || /\/login\//i.test(location.pathname);
  const body = document.body;
  const isMoodle = !!(body && /\bpath-mod-|\bpagelayout-/.test(body.className))
    || !!q('[data-for="page-activity-header"]')
    || !!q('[data-region="activity-dates"]') || !!q('a[href*="pluginfile.php"]');

  let title = txt(q('.page-header-headings h1')) || txt(q('#region-main h2')) || txt(q('main h1')) || txt(q('h1'));
  const docTitle = String(document.title || '');
  if (!title) title = docTitle.split(/[:|]/).pop().trim();

  let course = '';
  const links = Array.from(document.querySelectorAll('.breadcrumb a, nav a'));
  const isSectionHref = (h) => /course\/section\.php|#section-\d+|[?&]section=\d+/.test(h || '');
  const courseLink = links.find((a) => /course\/view\.php/.test(a.getAttribute('href') || '') && !isSectionHref(a.getAttribute('href')));
  if (courseLink) course = txt(courseLink);

  // Sección (unidad) de la actividad: en la ruta de navegación, entre el curso y la actividad.
  let section = '';
  const sectionLink = links.find((a) => isSectionHref(a.getAttribute('href')));
  if (sectionLink) section = txt(sectionLink);
  else {
    const crumbs = Array.from(document.querySelectorAll('.breadcrumb li'));
    const ci = crumbs.findIndex((li) => li.querySelector('a[href*="course/view.php"]'));
    if (ci >= 0 && crumbs.length - ci > 2) section = txt(crumbs[crumbs.length - 2]);
  }
  if (!course) {
    const parts = docTitle.split(/\s[:|]\s|:\s/);
    if (parts.length > 1) course = parts[0].trim();
  }

  const root = q('#region-main') || q('main') || body;
  // La tarea (texto y ficheros del profesor) está siempre en la cabecera de actividad.
  const header = q('div.activity-header[data-for="page-activity-header"]') || q('[data-for="page-activity-header"]');

  // Líneas de texto donde buscar la fecha de entrega y si está calificada: la
  // cabecera, las zonas de fechas, las tablas de estado y el contenido principal.
  const zones = ['[data-region="activity-dates"]', '.activity-dates', '.submissionstatustable', '.generaltable']
    .map((s) => Array.from(document.querySelectorAll(s))).flat();
  if (header) zones.unshift(header);
  zones.push(root);
  const lines = [];
  for (const z of zones) {
    for (const l of txt(z).split('\n')) {
      const t = l.trim();
      if (t && lines.length < 600) lines.push(t);
    }
  }
  // Estado de la entrega: SOLO la tabla de estado y los requisitos de finalización,
  // para que un enunciado que diga «será calificado» no se tome por una nota.
  const statusLines = [];
  const statusZones = ['.submissionstatustable', '[data-region="completionrequirements"]', '[data-region="completion-info"]', '.completion-info']
    .map((s) => Array.from(document.querySelectorAll(s))).flat();
  for (const z of statusZones) {
    for (const l of txt(z).split('\n')) {
      const t = l.trim();
      if (t && statusLines.length < 200) statusLines.push(t);
    }
  }

  // Texto de la tarea: el de la cabecera, sin las fechas, los requisitos de
  // finalización ni la lista de adjuntos (esos van aparte).
  let description = '';
  if (header) {
    const hide = Array.from(header.querySelectorAll(
      '[data-region="activity-dates"], .activity-dates, [data-region="completionrequirements"], ' +
      '[data-region="completion-info"], .completion-info, .automatic-completion-conditions, ' +
      '.sr-only, .visually-hidden, [id^="assign_files_tree"], .fileuploadsubmission'));
    const prev = hide.map((el) => el.style.display);
    hide.forEach((el) => { el.style.display = 'none'; });
    description = txt(header);
    hide.forEach((el, i) => { el.style.display = prev[i]; });
    // En las «páginas» y «libros» de Moodle el texto va fuera de la cabecera.
    if (!description && body && /\bpath-mod-(page|book)\b/.test(body.className)) {
      description = txt(q('#region-main .box.generalbox') || q('#region-main [role="main"]') || root).slice(0, 8000);
    }
  } else {
    const descEl = q('.activity-description') || q('#intro') || q('.box.generalbox');
    description = txt(descEl) || txt(root).slice(0, 4000);
  }

  const seen = new Set();
  const files = [];
  const add = (href, name, section) => {
    if (!/^https?:/i.test(href) || files.length >= 50) return;
    const key = href.split('#')[0];
    if (seen.has(key)) return;
    seen.add(key);
    if (!name) {
      try { name = decodeURIComponent(key.split('?')[0].split('/').pop() || ''); } catch (e) { name = ''; }
    }
    files.push({ name: (name || 'fichero').slice(0, 200), url: key, section });
  };
  const isFileLink = (href) => /pluginfile\.php/i.test(href) || /mod\/resource\/view\.php/i.test(href)
    || /\.(pdf|docx?|odt|rtf|xlsx?|ods|csv|pptx?|odp|zip|rar|7z|txt|md|java|sql|html?|xml|json|png|jpe?g|gif)(\?|#|$)/i.test(href);
  const isOwn = (href) => /submission_files|assignfeedback|feedback_files/i.test(href);

  // Ficheros del profesor: los de la cabecera (o, en una web sin cabecera, los del contenido).
  const scope = header || root;
  for (const a of Array.from(scope.querySelectorAll('a[href]'))) {
    if (isFileLink(a.href) && !isOwn(a.href)) add(a.href, txt(a), 'enunciado');
  }
  // Las imágenes incrustadas en el enunciado también forman parte de él.
  if (header) {
    for (const img of Array.from(header.querySelectorAll('img[src]'))) {
      if (/pluginfile\.php/i.test(img.src)) add(img.src, '', 'enunciado');
    }
  }
  // Tu entrega: se recoge siempre, pero solo se guarda si la tarea está calificada.
  for (const a of Array.from(document.querySelectorAll('a[href*="submission_files"]'))) {
    add(a.href, txt(a), 'enviado');
  }

  return {
    isLogin, platform: isMoodle ? 'moodle' : 'generic', url: location.href,
    title: title.slice(0, 300), course: course.slice(0, 300), section: section.slice(0, 300),
    description: description.slice(0, 8000), lines, statusLines, files
  };
})()`

/**
 * Se ejecuta DENTRO de la página de una asignatura (curso de Moodle): devuelve el
 * nombre del curso y sus secciones (unidades) con las actividades de cada una.
 */
const COURSE_EXTRACT = String.raw`(() => {
  const q = (sel) => document.querySelector(sel);
  const clean = (el) => {
    if (!el) return '';
    const c = el.cloneNode(true);
    c.querySelectorAll('.accesshide, .sr-only, .visually-hidden').forEach((x) => x.remove());
    return String(c.textContent || '').replace(/\s+/g, ' ').trim();
  };
  const visiblePassword = Array.from(document.querySelectorAll('input[type="password"]')).some((i) => i.offsetParent !== null);
  const isLogin = visiblePassword || /\/login\//i.test(location.pathname);
  const course = clean(q('.page-header-headings h1')) || clean(q('#page-header h1')) || String(document.title || '').split(/[:|]/)[0].trim();

  const seen = new Set();
  const add = (list, a, li) => {
    const href = String(a.href || '').split('#')[0];
    const m = /\/mod\/([a-z0-9_]+)\/view\.php\?(?:[^#]*&)?id=\d+/.exec(href);
    if (!m || seen.has(href)) return;
    seen.add(href);
    const typed = /\bmodtype_([a-z0-9_]+)/.exec((li && li.className) || '');
    const name = clean(a.querySelector('.instancename')) || clean(a);
    list.push({ name: name.slice(0, 200), url: href, modtype: typed ? typed[1] : m[1] });
  };
  const sections = [];
  for (const sec of Array.from(document.querySelectorAll('li.section, li.course-section, [data-for="section"]'))) {
    const title = clean(sec.querySelector('.sectionname, [data-for="section_title"], h3, h4'));
    const acts = [];
    for (const li of Array.from(sec.querySelectorAll('li.activity, [data-for="cmitem"]'))) {
      const a = li.querySelector('a[href*="/mod/"]');
      if (a) add(acts, a, li);
    }
    if (acts.length) sections.push({ title: title.slice(0, 200), activities: acts });
  }
  // Otras plantillas: todos los enlaces a actividades del contenido, en una sola sección.
  if (!sections.length) {
    const acts = [];
    for (const a of Array.from((q('#region-main') || document.body).querySelectorAll('a[href*="/mod/"]'))) add(acts, a, a.closest('li'));
    if (acts.length) sections.push({ title: '', activities: acts });
  }
  return { isLogin, url: location.href, course: course.slice(0, 300), sections };
})()`

interface RawPage {
  isLogin: boolean
  platform: 'moodle' | 'generic'
  url: string
  title: string
  course: string
  section: string
  description: string
  lines: string[]
  statusLines: string[]
  files: ActivityFile[]
}

const strList = (v: unknown, max: number): string[] =>
  (Array.isArray(v) ? v : []).filter((l): l is string => typeof l === 'string').slice(0, max)

const str =(v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')

/** Lo que llega de la página no es de fiar: se comprueba tipo y tamaño de todo. */
function sanitizeRaw(raw: unknown): RawPage {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const files = Array.isArray(r.files) ? r.files : []
  return {
    isLogin: r.isLogin === true,
    platform: r.platform === 'moodle' ? 'moodle' : 'generic',
    url: str(r.url, 2000),
    title: str(r.title, 300).trim(),
    course: str(r.course, 300).trim(),
    section: str(r.section, 300).trim(),
    description: str(r.description, 8000).trim(),
    lines: strList(r.lines, 600),
    statusLines: strList(r.statusLines, 200),
    files: files
      .map((f) => (f && typeof f === 'object' ? (f as Record<string, unknown>) : {}))
      .map((f) => ({
        name: str(f.name, 200).trim() || 'fichero',
        url: str(f.url, 2000),
        section: (f.section === 'enviado' ? 'enviado' : 'enunciado') as FileSection
      }))
      .filter((f) => /^https?:\/\//i.test(f.url))
      .slice(0, 50)
  }
}

// ---------------------------------------------------------------------- fechas

const fold = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

const MONTHS: Record<string, number> = {
  // castellano
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
  septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  // valenciano / catalán
  gener: 1, febrer: 2, marc: 3, maig: 5, juny: 6, juliol: 7, setembre: 9, novembre: 11, desembre: 12,
  // inglés
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8,
  september: 9, october: 10, november: 11, december: 12
}

const pad = (n: number): string => String(n).padStart(2, '0')

function toIso(y: number, m: number, d: number): string | null {
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return null
  const dt = new Date(y, m - 1, d)
  if (dt.getMonth() !== m - 1) return null // 31 de febrero, etc.
  return `${y}-${pad(m)}-${pad(d)}`
}

/** Saca una fecha AAAA-MM-DD de un texto en castellano, valenciano o inglés. */
export function parseDate(text: string): string | null {
  const t = fold(text).replace(/[’`]/g, "'")
  let m = /(\d{4})-(\d{2})-(\d{2})/.exec(t)
  if (m) return toIso(+m[1], +m[2], +m[3])
  // «21 de noviembre de 2026», «21 de novembre de 2026», «3 d'abril de 2026», «21 November 2026»
  m = /(\d{1,2})\s+(?:de\s+|d')?([a-z]+)\s+(?:de\s+)?(\d{4})/.exec(t)
  if (m && MONTHS[m[2]]) return toIso(+m[3], MONTHS[m[2]], +m[1])
  // «November 21, 2026»
  m = /([a-z]+)\s+(\d{1,2}),?\s+(\d{4})/.exec(t)
  if (m && MONTHS[m[1]]) return toIso(+m[3], MONTHS[m[1]], +m[2])
  // «21/11/2026», «21-11-2026», «21.11.2026» (día primero, como en España)
  m = /(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(t)
  if (m) return toIso(+m[3], +m[2], +m[1])
  return null
}

/** Etiquetas de la fecha de entrega, de más a menos específica. */
const DUE_LABELS = [
  'fecha de entrega', 'fecha limite', 'fecha de vencimiento', 'data de lliurament', 'data limit',
  'due date', 'vencimiento', 'venciment', 'pendiente', 'vence', 'venc', 'due',
  'cierre', 'se cierra', 'cierra', 'tancament', 'es tanca', 'tanca', 'closes', 'close'
]

/**
 * Busca la fecha de entrega entre las líneas de la página: una línea que empiece por
 * una de las etiquetas («Fecha de entrega: …», «Venciment: …», «Due date<TAB>…»),
 * con la fecha en la misma línea o en la siguiente. Las de apertura se ignoran.
 */
export function findDueDate(lines: string[]): { date: string; raw: string } | null {
  const folded = lines.map((l) => fold(l))
  for (const label of DUE_LABELS) {
    const re = new RegExp(`^${label.replace(/ /g, '\\s+')}\\b\\s*[:\\t]?\\s*(.*)$`)
    for (let i = 0; i < folded.length; i++) {
      const m = re.exec(folded[i])
      if (!m) continue
      const rest = lines[i].slice(lines[i].length - m[1].length).trim()
      const sameLine = rest ? parseDate(rest) : null
      if (sameLine) return { date: sameLine, raw: rest }
      if (!rest && i + 1 < lines.length) {
        const next = parseDate(lines[i + 1])
        if (next) return { date: next, raw: lines[i + 1].trim() }
      }
    }
  }
  return null
}

// -------------------------------------------------------------------- lectura

function sameUrl(a: string, b: string): boolean {
  try {
    const x = new URL(a)
    const y = new URL(b)
    return x.origin === y.origin && x.pathname.replace(/\/$/, '') === y.pathname.replace(/\/$/, '') && x.search === y.search
  } catch {
    return false
  }
}

/** Palabras de «calificada» en castellano, valenciano e inglés. */
const GRADED_WORD = '(?:calificad[ao]|qualificad[ao]|qualificat|graded)'
const GRADED_RE = new RegExp(`\\b${GRADED_WORD}\\b`)
const NOT_GRADED_RE = new RegExp(`\\b(?:no|not|sin|sense)\\s+(?:\\w+\\s+)?${GRADED_WORD}\\b`)
// Requisito de finalización cumplido: «Hecho: Recibir una calificación», «Fet: Rebre una qualificació», «Done: Receive a grade».
const GRADE_DONE_RE = /\b(?:hecho|fet|done)\s*:\s*.*\b(?:calificacion|qualificacio|grade)\b/

/**
 * ¿La tarea aparece como calificada? Se busca en la cabecera y en la tabla de
 * estado («Estado de la calificación: Calificado», «Qualificat», «Graded»…).
 * «Sin calificar», «No calificado» o «Para hacer: Recibir una calificación» no cuentan.
 */
export function isGraded(lines: string[]): boolean {
  for (const line of lines) {
    const l = fold(line)
    if (NOT_GRADED_RE.test(l)) continue
    if (GRADED_RE.test(l) || GRADE_DONE_RE.test(l)) return true
  }
  return false
}

// Estados de la entrega en castellano, valenciano e inglés (texto ya sin tildes).
const SUBMITTED_RE =
  /enviad[oa] para (?:su )?calificar|enviad[oa] para (?:su )?calificacion|trames(?:a)? per (?:a )?qualifica|submitted for grading|\b(?:hecho|fet|done)\s*:\s*(?:hacer|fer|make)\s+(?:un|una|a)\s+(?:envio|tramesa|submission)/
const DRAFT_RE = /\b(?:borrador|esborrany|draft)\b/
const NOT_SUBMITTED_RE =
  /no entregad|sin entrega|no se ha (?:hecho|realizado|enviado|entregado)|ningun (?:intento|envio)|no hay (?:ningun|ninguna) (?:intento|entrega|envio)|no s'ha fet cap|cap intent|no hi ha cap tramesa|no trames|no attempt|no submission|nothing has been submitted|\b(?:para hacer|per fer|to do)\s*:\s*(?:hacer|fer|make)\s+(?:un|una|a)\s+(?:envio|tramesa|submission)/

/** El valor de una fila de estado: «Estado de la entrega<TAB>Enviado para calificar» → «Enviado para calificar». */
function statusValue(line: string): string {
  const v = line.includes('\t') ? line.slice(line.lastIndexOf('\t') + 1) : line
  return v.trim().slice(0, 80) || line.trim().slice(0, 80)
}

/**
 * Estado de tu entrega según la plataforma, mirando solo la tabla de estado y los
 * requisitos de finalización. Si hay varias señales gana la más avanzada:
 * calificada → «corregida», enviada → «entregada», borrador → «en curso»,
 * sin entregar → «pendiente».
 */
export function detectSubmission(lines: string[]): { status: Status; label: string } | null {
  const find = (test: (l: string) => boolean): string | null => {
    const hit = lines.find((line) => test(fold(line).replace(/[’`]/g, "'")))
    return hit ? statusValue(hit) : null
  }
  const graded = find((l) => !NOT_GRADED_RE.test(l) && (GRADED_RE.test(l) || GRADE_DONE_RE.test(l)))
  if (graded) return { status: 'corregida', label: graded }
  const submitted = find((l) => SUBMITTED_RE.test(l))
  if (submitted) return { status: 'entregada', label: submitted }
  const draft = find((l) => DRAFT_RE.test(l))
  if (draft) return { status: 'en curso', label: draft }
  const pending = find((l) => NOT_SUBMITTED_RE.test(l))
  if (pending) return { status: 'pendiente', label: pending }
  return null
}

function buildActivity(p: RawPage): ScrapedActivity {
  const due = findDueDate(p.lines)
  const submission = detectSubmission(p.statusLines)
  const graded = submission?.status === 'corregida'
  return {
    url: p.url,
    platform: p.platform,
    title: p.title,
    course: p.course,
    description: p.description,
    due_date: due?.date ?? null,
    due_raw: due?.raw ?? null,
    graded,
    submission,
    unit: parseUnit(p.section, p.title),
    // Tu archivo enviado solo se recoge cuando la tarea está calificada.
    files: graded ? p.files : p.files.filter((f) => f.section === 'enunciado')
  }
}

/**
 * Abre una página en una ventana con la sesión de la plataforma y ejecuta en ella un
 * script de lectura. Si la página pide iniciar sesión, la ventana se muestra para que
 * entres con tu usuario; cuando vuelve a la página pedida, se lee sola y se cierra.
 * El script debe devolver un objeto con «isLogin» y «url».
 */
function readPage(rawUrl: string, script: string): Promise<Record<string, unknown>> {
  let target: URL
  try {
    target = new URL(String(rawUrl ?? '').trim())
  } catch {
    return Promise.reject(new Error('Ese enlace no es válido'))
  }
  if (!/^https?:$/.test(target.protocol)) {
    return Promise.reject(new Error('El enlace tiene que empezar por http:// o https://'))
  }
  if (current && !current.isDestroyed()) current.destroy()

  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const win = new BrowserWindow({
      width: 1000,
      height: 760,
      show: false,
      title: 'Plataforma del curso — Cursia',
      autoHideMenuBar: true,
      webPreferences: {
        partition: PLATFORM_PARTITION,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    current = win
    let done = false
    let sawLogin = false
    let retried = false

    const finish = (err: Error | null, value?: Record<string, unknown>): void => {
      if (done) return
      done = true
      clearTimeout(showTimer)
      clearTimeout(killTimer)
      if (current === win) current = null
      if (!win.isDestroyed()) win.destroy()
      if (err) reject(err)
      else resolve(value as Record<string, unknown>)
    }

    // Nada de ventanas emergentes desde la página.
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.on('closed', () => finish(new Error('Lectura cancelada: se cerró la ventana de la plataforma')))
    win.webContents.on('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
      if (!isMainFrame || code === -3) return // -3: navegación interrumpida por otra (redirecciones)
      finish(new Error(`No se pudo abrir la página (${desc})`))
    })
    win.webContents.on('did-finish-load', async () => {
      if (done || win.isDestroyed()) return
      let raw: unknown
      try {
        raw = await win.webContents.executeJavaScript(script, false)
      } catch {
        return // la página cambió mientras se leía; llegará otro did-finish-load
      }
      if (done) return
      const page = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
      if (page.isLogin === true) {
        sawLogin = true
        if (!win.isVisible()) {
          win.setTitle('Inicia sesión en la plataforma — Cursia')
          win.show()
          win.focus()
        }
        return
      }
      // Tras iniciar sesión algunas plataformas te dejan en la portada, no en la actividad.
      if (sawLogin && !sameUrl(str(page.url, 2000), target.href) && !retried) {
        retried = true
        void win.loadURL(target.href).catch(() => {})
        return
      }
      finish(null, page)
    })

    // Si tarda (redirecciones de inicio de sesión raras, avisos…), se enseña la ventana.
    const showTimer = setTimeout(() => {
      if (!done && !win.isDestroyed() && !win.isVisible()) win.show()
    }, SHOW_WINDOW_AFTER_MS)
    const killTimer = setTimeout(() => finish(new Error('La lectura tardó demasiado')), READ_TIMEOUT_MS)

    void win.loadURL(target.href).catch(() => {}) // los errores llegan por did-fail-load
  })
}

/** Lee la página de una asignatura: su nombre y sus secciones con las actividades. */
export async function readCourse(rawUrl: string): Promise<ScrapedCourse> {
  const r = await readPage(rawUrl, COURSE_EXTRACT)
  const sections = (Array.isArray(r.sections) ? r.sections : []).slice(0, 100).map((sec) => {
    const x = (sec && typeof sec === 'object' ? sec : {}) as Record<string, unknown>
    const acts = (Array.isArray(x.activities) ? x.activities : []).slice(0, 300).map((a) => {
      const y = (a && typeof a === 'object' ? a : {}) as Record<string, unknown>
      return { name: str(y.name, 200).trim() || 'Actividad', url: str(y.url, 2000), modtype: str(y.modtype, 40).toLowerCase() }
    })
    return {
      title: str(x.title, 200).trim(),
      activities: acts.filter((a) => /^https?:\/\//i.test(a.url) && /^[a-z0-9_]+$/.test(a.modtype))
    }
  })
  return { url: str(r.url, 2000), course: str(r.course, 300).trim(), sections: sections.filter((s) => s.activities.length) }
}

/** Lee una actividad: título, curso, fechas, estado, unidad, enunciado y ficheros. */
export async function readActivity(rawUrl: string): Promise<ScrapedActivity> {
  return buildActivity(sanitizeRaw(await readPage(rawUrl, EXTRACT)))
}

export function cancelRead(): void {
  if (current && !current.isDestroyed()) current.close()
}

export async function logoutPlatform(): Promise<void> {
  cancelRead()
  await session.fromPartition(PLATFORM_PARTITION).clearStorageData()
}

// ------------------------------------------------------------------- descargas

/** Nombre de fichero o carpeta válido en Windows, sin rutas. */
export function safeName(name: string, fallback = 'fichero'): string {
  const clean = basename(String(name).replace(/\\/g, '/'))
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 120)
  return clean || fallback
}

function filenameFrom(res: Response, url: string, fallback: string): string {
  const cd = res.headers.get('content-disposition') || ''
  let m = /filename\*\s*=\s*(?:utf-8)?''([^;]+)/i.exec(cd)
  if (m) {
    try {
      return decodeURIComponent(m[1].trim().replace(/^"|"$/g, ''))
    } catch {
      /* sigue con el siguiente método */
    }
  }
  m = /filename\s*=\s*"([^"]+)"/i.exec(cd) || /filename\s*=\s*([^;]+)/i.exec(cd)
  if (m) return m[1].trim()
  try {
    const last = decodeURIComponent(new URL(res.url || url).pathname.split('/').pop() || '')
    if (/\.[a-z0-9]{1,6}$/i.test(last)) return last
  } catch {
    /* nombre de la página */
  }
  return fallback
}

/** «enunciado.pdf» → «enunciado (2).pdf» si ya existe. */
function uniquePath(dir: string, name: string): string {
  const ext = extname(name)
  const stem = name.slice(0, name.length - ext.length)
  let candidate = join(dir, name)
  for (let n = 2; existsSync(candidate); n++) candidate = join(dir, `${stem} (${n})${ext}`)
  return candidate
}

/**
 * Descarga los ficheros con la sesión de la plataforma, los guarda en
 * <carpeta de descargas>/<asignatura>/<actividad>/ y los indexa en el elemento.
 * Tu archivo enviado va aparte, en la subcarpeta «Archivo enviado».
 */
export async function downloadFiles(
  db: DB,
  downloadsDir: string,
  itemId: number,
  files: { name: string; url: string; section?: FileSection }[]
): Promise<DownloadResult> {
  const item = db
    .prepare(
      `SELECT i.title, s.name AS subject_name, s.short_name
       FROM items i JOIN subjects s ON s.id = i.subject_id WHERE i.id = ?`
    )
    .get(itemId) as { title: string; subject_name: string; short_name: string | null } | undefined
  if (!item) throw new Error('El elemento ya no existe')

  const dir = join(downloadsDir, safeName(item.short_name || item.subject_name, 'Asignatura'), safeName(item.title, 'Actividad'))
  mkdirSync(dir, { recursive: true })

  const ses = session.fromPartition(PLATFORM_PARTITION)
  const saved: Record<FileSection, string[]> = { enunciado: [], enviado: [] }
  const errors: string[] = []
  for (const f of files.slice(0, 50)) {
    const label = safeName(f.name)
    const section: FileSection = f.section === 'enviado' ? 'enviado' : 'enunciado'
    const target = section === 'enviado' ? join(dir, FILE_SECTION_LABEL.enviado) : dir
    try {
      if (!/^https?:\/\//i.test(f.url)) throw new Error('enlace no válido')
      const res = await ses.fetch(f.url)
      if (!res.ok) throw new Error(`la plataforma respondió ${res.status}`)
      const type = res.headers.get('content-type') || ''
      const finalUrl = res.url || f.url
      if (/text\/html/i.test(type) && !/\.html?($|\?)/i.test(finalUrl)) {
        throw new Error('la plataforma devolvió una página en vez del fichero (¿ha caducado la sesión?)')
      }
      const len = Number(res.headers.get('content-length') || 0)
      if (len > MAX_FILE_BYTES) throw new Error('es demasiado grande')
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length > MAX_FILE_BYTES) throw new Error('es demasiado grande')
      mkdirSync(target, { recursive: true })
      const path = uniquePath(target, safeName(filenameFrom(res, f.url, label), label))
      writeFileSync(path, buf)
      saved[section].push(path)
    } catch (e) {
      errors.push(`«${label}»: ${(e as Error).message}`)
    }
  }
  let added = 0
  let skipped = 0
  for (const section of ['enunciado', 'enviado'] as const) {
    if (!saved[section].length) continue
    const r = addPaths(db, itemId, saved[section], section)
    added += r.added
    skipped += r.skipped
    errors.push(...r.errors)
  }
  return { added, skipped, errors, dir }
}
