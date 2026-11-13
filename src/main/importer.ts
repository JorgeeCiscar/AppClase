import { BrowserWindow, session } from 'electron'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { ActivityFile, DownloadResult, ScrapedActivity } from '../shared/types'
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
    || !!q('[data-region="activity-dates"]') || !!q('a[href*="pluginfile.php"]');

  let title = txt(q('.page-header-headings h1')) || txt(q('#region-main h2')) || txt(q('main h1')) || txt(q('h1'));
  const docTitle = String(document.title || '');
  if (!title) title = docTitle.split(/[:|]/).pop().trim();

  let course = '';
  const links = Array.from(document.querySelectorAll('.breadcrumb a, nav a'));
  const courseLink = links.find((a) => /course\/view\.php/.test(a.getAttribute('href') || ''));
  if (courseLink) course = txt(courseLink);
  if (!course) {
    const parts = docTitle.split(/\s[:|]\s|:\s/);
    if (parts.length > 1) course = parts[0].trim();
  }

  const descEl = q('.activity-description') || q('#intro') || q('.box.generalbox');
  const root = q('#region-main') || q('main') || body;
  let description = txt(descEl);
  if (!description) description = txt(root).slice(0, 4000);

  // Líneas de texto donde buscar la fecha de entrega: primero las zonas de fechas
  // de Moodle y las tablas de estado, luego todo el contenido principal.
  const zones = ['[data-region="activity-dates"]', '.activity-dates', '.submissionstatustable', '.generaltable']
    .map((s) => Array.from(document.querySelectorAll(s))).flat();
  zones.push(root);
  const lines = [];
  for (const z of zones) {
    for (const l of txt(z).split('\n')) {
      const t = l.trim();
      if (t && lines.length < 600) lines.push(t);
    }
  }

  const seen = new Set();
  const files = [];
  for (const a of Array.from(root.querySelectorAll('a[href]'))) {
    const href = a.href;
    if (!/^https?:/i.test(href)) continue;
    const isPluginfile = /pluginfile\.php/i.test(href);
    const isResource = /mod\/resource\/view\.php/i.test(href);
    const isDoc = /\.(pdf|docx?|odt|rtf|xlsx?|ods|csv|pptx?|odp|zip|rar|7z|txt|md|java|sql|html?|xml|json|png|jpe?g|gif)(\?|#|$)/i.test(href);
    if (!isPluginfile && !isResource && !isDoc) continue;
    const key = href.split('#')[0];
    if (seen.has(key)) continue;
    seen.add(key);
    let name = txt(a);
    if (!name) {
      try { name = decodeURIComponent(key.split('?')[0].split('/').pop() || ''); } catch (e) { name = ''; }
    }
    const own = /submission_files|assignfeedback|feedback_files/i.test(href);
    files.push({ name: (name || 'fichero').slice(0, 200), url: key, own });
    if (files.length >= 50) break;
  }

  return {
    isLogin, platform: isMoodle ? 'moodle' : 'generic', url: location.href,
    title: title.slice(0, 300), course: course.slice(0, 300), description: description.slice(0, 8000),
    lines, files
  };
})()`

interface RawPage {
  isLogin: boolean
  platform: 'moodle' | 'generic'
  url: string
  title: string
  course: string
  description: string
  lines: string[]
  files: ActivityFile[]
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')

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
    description: str(r.description, 8000).trim(),
    lines: (Array.isArray(r.lines) ? r.lines : []).filter((l): l is string => typeof l === 'string').slice(0, 600),
    files: files
      .map((f) => (f && typeof f === 'object' ? (f as Record<string, unknown>) : {}))
      .map((f) => ({ name: str(f.name, 200).trim() || 'fichero', url: str(f.url, 2000), own: f.own === true }))
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
  'cierre', 'se cierra', 'tancament', 'es tanca', 'closes', 'close'
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

function buildActivity(p: RawPage): ScrapedActivity {
  const due = findDueDate(p.lines)
  return {
    url: p.url,
    platform: p.platform,
    title: p.title,
    course: p.course,
    description: p.description,
    due_date: due?.date ?? null,
    due_raw: due?.raw ?? null,
    files: p.files
  }
}

/**
 * Abre la página en una ventana con la sesión de la plataforma. Si la página pide
 * iniciar sesión, la ventana se muestra para que entres con tu usuario; cuando
 * vuelve a la actividad, se lee sola y la ventana se cierra.
 */
export function readActivity(rawUrl: string): Promise<ScrapedActivity> {
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

  return new Promise<ScrapedActivity>((resolve, reject) => {
    const win = new BrowserWindow({
      width: 1000,
      height: 760,
      show: false,
      title: 'Plataforma del curso — AppClase',
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

    const finish = (err: Error | null, value?: ScrapedActivity): void => {
      if (done) return
      done = true
      clearTimeout(showTimer)
      clearTimeout(killTimer)
      if (current === win) current = null
      if (!win.isDestroyed()) win.destroy()
      if (err) reject(err)
      else resolve(value as ScrapedActivity)
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
        raw = await win.webContents.executeJavaScript(EXTRACT, false)
      } catch {
        return // la página cambió mientras se leía; llegará otro did-finish-load
      }
      if (done) return
      const page = sanitizeRaw(raw)
      if (page.isLogin) {
        sawLogin = true
        if (!win.isVisible()) {
          win.setTitle('Inicia sesión en la plataforma — AppClase')
          win.show()
          win.focus()
        }
        return
      }
      // Tras iniciar sesión algunas plataformas te dejan en la portada, no en la actividad.
      if (sawLogin && !sameUrl(page.url, target.href) && !retried) {
        retried = true
        void win.loadURL(target.href).catch(() => {})
        return
      }
      finish(null, buildActivity(page))
    })

    // Si tarda (redirecciones de inicio de sesión raras, avisos…), se enseña la ventana.
    const showTimer = setTimeout(() => {
      if (!done && !win.isDestroyed() && !win.isVisible()) win.show()
    }, SHOW_WINDOW_AFTER_MS)
    const killTimer = setTimeout(() => finish(new Error('La lectura tardó demasiado')), READ_TIMEOUT_MS)

    void win.loadURL(target.href).catch(() => {}) // los errores llegan por did-fail-load
  })
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
 */
export async function downloadFiles(
  db: DB,
  downloadsDir: string,
  itemId: number,
  files: { name: string; url: string }[]
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
  const saved: string[] = []
  const errors: string[] = []
  for (const f of files.slice(0, 50)) {
    const label = safeName(f.name)
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
      const path = uniquePath(dir, safeName(filenameFrom(res, f.url, label), label))
      writeFileSync(path, buf)
      saved.push(path)
    } catch (e) {
      errors.push(`«${label}»: ${(e as Error).message}`)
    }
  }
  const indexed = saved.length ? addPaths(db, itemId, saved) : { added: 0, skipped: 0, errors: [] }
  return { added: indexed.added, skipped: indexed.skipped, errors: [...errors, ...indexed.errors], dir }
}
