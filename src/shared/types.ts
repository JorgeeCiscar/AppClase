// Tipos compartidos entre el proceso principal, el preload y la interfaz.

export const ITEM_KINDS = ['apunte', 'enunciado', 'ejercicio', 'examen', 'enlace'] as const
export type ItemKind = (typeof ITEM_KINDS)[number]

/** Estados de una entrega. Un elemento sin estado no es entregable (p. ej. un apunte). */
export const STATUSES = ['pendiente', 'en curso', 'entregada', 'corregida'] as const
export type Status = (typeof STATUSES)[number]

/** Extensiones cuyo contenido se puede buscar como texto. */
export const TEXT_EXT = [
  '.txt', '.md', '.java', '.sql', '.html', '.htm', '.css', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.json', '.xml', '.xsd', '.dtd', '.php', '.py', '.c', '.h', '.cpp', '.cs', '.sh', '.bat', '.csv',
  '.yml', '.yaml', '.ini', '.cfg', '.properties', '.log', '.gitignore'
] as const

export interface Subject {
  id: number
  name: string
  short_name: string | null
  color: string | null
  teacher: string | null
  position: number
  item_count: number
  pending_count: number
  file_count: number
}

export type SubjectInput = Omit<Subject, 'item_count' | 'pending_count' | 'file_count' | 'position' | 'id'> & {
  id?: number
  position?: number
}

export interface Unit {
  id: number
  subject_id: number
  number: number | null
  title: string
  item_count: number
}

export type UnitInput = Omit<Unit, 'item_count' | 'id'> & { id?: number }

export interface FileRef {
  id: number
  item_id: number
  path: string
  name: string
  ext: string | null
  size: number | null
  mtime: string | null
  /** 1 cuando la ruta ya no existe en el disco. */
  missing: number
  added_at: string
  /** Apartado del elemento; null para los ficheros añadidos a mano. */
  section: FileSection | null
}

export interface Item {
  id: number
  subject_id: number
  unit_id: number | null
  kind: ItemKind
  title: string
  notes: string | null
  url: string | null
  due_date: string | null
  status: Status | null
  grade: number | null
  created_at: string
  subject_name: string
  subject_color: string | null
  unit_title: string | null
  unit_number: number | null
  file_count: number
  missing_count: number
  tags: string[]
}

export type ItemInput = {
  id?: number
  subject_id: number
  unit_id?: number | null
  kind: ItemKind
  title: string
  notes?: string | null
  url?: string | null
  due_date?: string | null
  status?: Status | null
  grade?: number | null
  tags?: string[]
  /**
   * Unidad leída de la plataforma: si unit_id es null, al guardar se busca en la
   * asignatura (por número o por nombre) y, si no existe, se crea.
   */
  new_unit?: DetectedUnit | null
}

/** Unidad leída de la plataforma («UD 3 - Arrays» → 3, «Arrays»). */
export interface DetectedUnit {
  number: number | null
  title: string
}

export interface ItemFilter {
  subject_id?: number
  unit_id?: number | null
  kind?: ItemKind
  status?: Status
  tag?: string
  text?: string
  /** Solo elementos con fecha límite, ordenados por ella. */
  dueOnly?: boolean
  /** Entregas sin terminar (pendiente o en curso) cuya fecha ya pasó. */
  overdueOnly?: boolean
}

export interface Opener {
  name: string
  command: string
  args?: string
}

export interface Settings {
  course_name: string
  openers: Opener[]
  /** Carpeta donde se guardan los ficheros descargados de la plataforma del curso. */
  downloads_dir: string
}

/** Apartado de un fichero dentro de un elemento. */
export const FILE_SECTIONS = ['enunciado', 'enviado'] as const
export type FileSection = (typeof FILE_SECTIONS)[number]
export const FILE_SECTION_LABEL: Record<FileSection, string> = {
  enunciado: 'Enunciado del profesor',
  enviado: 'Archivo enviado'
}

/** Un fichero enlazado en la página de una actividad. */
export interface ActivityFile {
  name: string
  url: string
  /** «enunciado»: del profesor, en la cabecera de la tarea. «enviado»: tu entrega. */
  section: FileSection
}

/** Datos leídos de la página de una actividad (Aules, Moodle u otra web). */
export interface ScrapedActivity {
  url: string
  platform: 'moodle' | 'generic'
  title: string
  course: string
  description: string
  /** Fecha de entrega en AAAA-MM-DD, si se encontró. */
  due_date: string | null
  /** Texto original de la fecha de entrega, con la hora (p. ej. «viernes, 21 de noviembre de 2026, 23:59»). */
  due_raw: string | null
  /** La tarea aparece como calificada: entonces también se recoge tu archivo enviado. */
  graded: boolean
  /** Estado de tu entrega según la plataforma, y el texto tal como aparece allí. */
  submission: { status: Status; label: string } | null
  /** Unidad de la actividad dentro de la asignatura, si la plataforma la indica. */
  unit: DetectedUnit | null
  files: ActivityFile[]
}

export interface DownloadResult extends AddFilesResult {
  /** Carpeta donde se guardaron los ficheros. */
  dir: string
}

export interface Stats {
  subjects: number
  items: number
  files: number
  missing: number
  pending: number
  overdue: number
  dueSoon: Item[]
  overdueItems: Item[]
  recentFiles: (FileRef & { item_title: string; subject_name: string; item_id: number })[]
}

export interface ContentMatch {
  file_id: number
  item_id: number
  path: string
  name: string
  item_title: string
  subject_name: string
  line: number
  snippet: string
}

export interface SearchResult {
  subjects: Subject[]
  items: Item[]
  files: (FileRef & { item_title: string; subject_name: string })[]
  tags: string[]
  content: ContentMatch[]
  /** true cuando la búsqueda en contenido se cortó por el límite de resultados. */
  contentTruncated: boolean
}

export interface OpenResult {
  ok: boolean
  error?: string
}

export interface AddFilesResult {
  added: number
  skipped: number
  /** Ficheros que no se pudieron leer, con el motivo. */
  errors: string[]
}

export interface Api {
  subjects: {
    list: () => Promise<Subject[]>
    save: (s: SubjectInput) => Promise<Subject>
    remove: (id: number) => Promise<void>
    seedDaw1: () => Promise<Subject[]>
  }
  units: {
    list: (subjectId: number) => Promise<Unit[]>
    save: (u: UnitInput) => Promise<Unit>
    remove: (id: number) => Promise<void>
  }
  items: {
    list: (filter?: ItemFilter) => Promise<Item[]>
    get: (id: number) => Promise<Item | undefined>
    save: (i: ItemInput) => Promise<Item>
    /** Con trashFiles, sus ficheros van también a la papelera de reciclaje. */
    remove: (id: number, opts?: { trashFiles?: boolean }) => Promise<{ trashed: number; errors: string[] }>
    setStatus: (id: number, status: Status | null) => Promise<Item>
    addTag: (id: number, tag: string) => Promise<void>
    removeTag: (id: number, tag: string) => Promise<void>
    /** Cambia varias entregas a la vez (todo o nada). Devuelve cuántos cambios hubo. */
    bulkUpdate: (
      ids: number[],
      patch: { status?: Status | null; subject_id?: number; addTag?: string; grade?: number | null }
    ) => Promise<number>
    bulkRemove: (
      ids: number[],
      opts?: { trashFiles?: boolean }
    ) => Promise<{ removed: number; trashed: number; errors: string[] }>
  }
  files: {
    list: (itemId: number) => Promise<FileRef[]>
    choose: (itemId: number) => Promise<AddFilesResult>
    chooseFolder: (itemId: number) => Promise<AddFilesResult>
    addPaths: (itemId: number, paths: string[]) => Promise<AddFilesResult>
    remove: (id: number) => Promise<void>
    open: (id: number) => Promise<OpenResult>
    openWith: (id: number, openerIndex: number) => Promise<OpenResult>
    reveal: (id: number) => Promise<OpenResult>
    relocate: (id: number) => Promise<FileRef | undefined>
    revalidate: (itemId?: number) => Promise<number>
    /** Algún fichero indexado cambió en el disco (editado, renombrado o borrado). */
    onChanged: (cb: () => void) => () => void
  }
  tags: () => Promise<string[]>
  search: (q: string, inContent?: boolean) => Promise<SearchResult>
  stats: () => Promise<Stats>
  settings: {
    get: () => Promise<Settings>
    save: (s: Partial<Settings>) => Promise<Settings>
    chooseExecutable: () => Promise<string | null>
    chooseDownloadsDir: () => Promise<string | null>
  }
  importer: {
    /** Abre la página (pidiendo iniciar sesión si hace falta) y lee la actividad. */
    read: (url: string) => Promise<ScrapedActivity>
    /** Cierra la ventana de lectura en curso. */
    cancel: () => Promise<void>
    /** Descarga ficheros de la plataforma con la sesión iniciada y los indexa en el elemento. */
    download: (itemId: number, files: { name: string; url: string; section: FileSection }[]) => Promise<DownloadResult>
    /** Borra la sesión guardada de la plataforma. */
    logout: () => Promise<void>
  }
  app: {
    version: () => Promise<string>
    pathForFile: (file: File) => string
    updateStatus: () => Promise<UpdateStatus>
    checkForUpdates: () => Promise<UpdateStatus>
    installUpdate: () => Promise<void>
    onUpdateStatus: (cb: (s: UpdateStatus) => void) => () => void
  }
}

export interface UpdateStatus {
  state: 'idle' | 'disabled' | 'checking' | 'none' | 'downloading' | 'downloaded' | 'error'
  version?: string
  percent?: number
  message?: string
  /** Cuándo terminó la última comprobación (ISO), para que cada pulsación se note. */
  checkedAt?: string
}
