import { DatabaseSync } from 'node:sqlite'

export type DB = DatabaseSync

export const MIGRATIONS: string[] = [
  `
  CREATE TABLE subjects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    short_name TEXT,
    color TEXT,
    teacher TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE units (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    number INTEGER,
    title TEXT NOT NULL
  );
  CREATE INDEX idx_units_subject ON units(subject_id);

  CREATE TABLE items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    unit_id INTEGER REFERENCES units(id) ON DELETE SET NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    notes TEXT,
    url TEXT,
    due_date TEXT,
    status TEXT,
    grade REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_items_subject ON items(subject_id);
  CREATE INDEX idx_items_unit ON items(unit_id);
  CREATE INDEX idx_items_due ON items(due_date);

  -- Los ficheros se REFERENCIAN por su ruta; nunca se copian ni se mueven.
  CREATE TABLE files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    name TEXT NOT NULL,
    ext TEXT,
    size INTEGER,
    mtime TEXT,
    missing INTEGER NOT NULL DEFAULT 0,
    added_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (item_id, path)
  );
  CREATE INDEX idx_files_item ON files(item_id);
  CREATE INDEX idx_files_name ON files(name);

  CREATE TABLE item_tags (
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    tag TEXT NOT NULL COLLATE NOCASE,
    PRIMARY KEY (item_id, tag)
  );
  CREATE INDEX idx_item_tags_tag ON item_tags(tag);

  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
  `,
  // v0.3: apartado de cada fichero («enunciado» del profesor o «enviado» por ti).
  `
  ALTER TABLE files ADD COLUMN section TEXT;
  `
]

/** Módulos de primero de DAW. Se siembran al crear la base de datos y son editables. */
export const DAW1_SUBJECTS: { name: string; short_name: string; color: string }[] = [
  { name: 'Sistemas informáticos', short_name: 'SI', color: '#4c8bf5' },
  { name: 'Bases de datos', short_name: 'BD', color: '#2f855a' },
  { name: 'Programación', short_name: 'PRO', color: '#d9a441' },
  { name: 'Lenguajes de marcas y sistemas de gestión de información', short_name: 'LM', color: '#b5565a' },
  { name: 'Entornos de desarrollo', short_name: 'ED', color: '#6c5b9e' },
  { name: 'Formación y orientación laboral', short_name: 'FOL', color: '#5c7080' }
]

const depth = new WeakMap<DB, number>()

export function transaction<T>(db: DB, fn: () => T): T {
  const d = depth.get(db) ?? 0
  if (d > 0) {
    depth.set(db, d + 1)
    try {
      return fn()
    } finally {
      depth.set(db, d)
    }
  }
  depth.set(db, 1)
  try {
    return runTransaction(db, fn)
  } finally {
    depth.set(db, 0)
  }
}

function runTransaction<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

export function seedSubjects(db: DB): void {
  const insert = db.prepare('INSERT INTO subjects (name, short_name, color, position) VALUES (?, ?, ?, ?)')
  DAW1_SUBJECTS.forEach((s, i) => insert.run(s.name, s.short_name, s.color, i))
}

/**
 * journal 'DELETE' cuando el fichero está en OneDrive: así todo queda en un único
 * fichero (sin -wal aparte que pueda sincronizarse a destiempo).
 */
export function openDatabase(file: string, journal: 'WAL' | 'DELETE' = 'WAL'): DB {
  const db = new DatabaseSync(file)
  db.exec(`PRAGMA journal_mode = ${journal}`)
  db.exec('PRAGMA foreign_keys = ON')
  const current = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
  for (let v = current; v < MIGRATIONS.length; v++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[v])
      db.exec(`PRAGMA user_version = ${v + 1}`)
    })
  }
  // Base de datos nueva: se siembran las asignaturas del curso.
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM subjects').get() as { n: number }
  if (n === 0) transaction(db, () => seedSubjects(db))
  return db
}
