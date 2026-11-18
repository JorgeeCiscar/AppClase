// Comprobaciones del módulo de sincronización (src/main/syncCore.ts) sin la app.
// Se ejecuta con Electron como Node (ELECTRON_RUN_AS_NODE=1) para usar su node:sqlite:
//   electron scripts/sync-unit.cjs <syncCore empaquetado.cjs> <carpeta temporal>
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

const core = require(path.resolve(process.argv[2]))
const T = process.argv[3]
let fails = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✔' : '✘'} ${name}${extra ? ` (${extra})` : ''}`)
  if (!ok) fails++
}

// --- configuración local
const cfg = path.join(T, 'cfg')
check('sin config.json, la sincronización está desactivada', core.readConfig(cfg).sync === false)
core.writeConfig(cfg, { sync: true })
check('se guarda y se lee la configuración', core.readConfig(cfg).sync === true)

// --- detectar OneDrive
const od = path.join(T, 'OneDrive')
fs.mkdirSync(od, { recursive: true })
check('detecta la carpeta de OneDrive', core.detectOneDrive({ APPCLASE_ONEDRIVE: od }) === path.resolve(od))
check('usa la variable OneDrive de Windows', core.detectOneDrive({ OneDrive: od }) === path.resolve(od))
check(
  'ignora variables que apuntan a carpetas inexistentes',
  core.detectOneDrive({ APPCLASE_ONEDRIVE: path.join(T, 'no'), OneDrive: od }) === path.resolve(od)
)

// --- marca «en uso»
const dir = path.join(T, 'datos')
const a = { id: 'a', host: 'PC-A' }
const a2 = { id: 'a2', host: 'PC-A' }
const b = { id: 'b', host: 'PC-B' }
check('sin marca: libre', core.lockState(dir, b).state === 'libre')
core.writeLock(dir, a)
check('marcada por otro ordenador: ocupada', core.lockState(dir, b).state === 'otro')
check('marcada por este mismo ordenador (se cerró mal): libre', core.lockState(dir, a2).state === 'libre')
check(
  'una marca sin renovar en 3 minutos se considera abandonada',
  core.lockState(dir, b, Date.now() + core.STALE_MS + 1000).state === 'libre'
)
const since = core.readLock(dir).since
check('el latido renueva la marca propia', core.beat(dir, a) === true && core.readLock(dir).since === since)
core.writeLock(dir, b)
check(
  'el latido detecta que otro ordenador tomó el relevo',
  core.beat(dir, a) === false && core.readLock(dir).id === 'b'
)
core.releaseLock(dir, a)
check('al cerrar no se quita la marca de otro', core.readLock(dir)?.id === 'b')
core.releaseLock(dir, b)
check('al cerrar se quita la marca propia', core.readLock(dir) === null)

// --- rutas entre dos OneDrive distintos
const db = new DatabaseSync(':memory:')
db.exec(
  'CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE files (id INTEGER PRIMARY KEY, path TEXT)'
)
const rootA = path.join(T, 'A', 'OneDrive')
const rootB = path.join(T, 'B', 'OneDrive - Personal')
const ins = db.prepare('INSERT INTO files (id, path) VALUES (?, ?)')
ins.run(1, path.join(rootA, 'Clase', 'tema1.pdf'))
ins.run(2, path.join(T, 'A', 'Escritorio', 'fuera.txt'))
ins.run(3, path.join(T, 'A', 'OneDrive2', 'parecido.txt'))
db.prepare('INSERT INTO settings VALUES (?, ?)').run('downloads_dir', path.join(rootA, 'AppClase'))
check('la primera vez solo se apunta la carpeta de OneDrive', core.rebasePaths(db, rootA) === 0)
const n = core.rebasePaths(db, rootB)
const paths = Object.fromEntries(
  db
    .prepare('SELECT id, path FROM files')
    .all()
    .map((r) => [r.id, r.path])
)
const setting = (k) => db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value
check(
  'en otro ordenador, las rutas dentro de OneDrive pasan a su OneDrive',
  paths[1] === path.join(rootB, 'Clase', 'tema1.pdf'),
  paths[1]
)
check('las rutas fuera de OneDrive no cambian', paths[2] === path.join(T, 'A', 'Escritorio', 'fuera.txt'))
check(
  'una carpeta con nombre parecido no se confunde con OneDrive',
  paths[3] === path.join(T, 'A', 'OneDrive2', 'parecido.txt')
)
check('la carpeta de descargas también se ajusta', setting('downloads_dir') === path.join(rootB, 'AppClase'))
check('cuenta los cambios', n === 2, String(n))
check('se apunta el OneDrive de este ordenador', setting('sync_root') === rootB)

// --- copias de seguridad
const bdir = path.join(T, 'bk')
const fdb = new DatabaseSync(path.join(T, 'f.db'))
fdb.exec('CREATE TABLE x (a); INSERT INTO x VALUES (42)')
let last = ''
for (let i = 0; i < 12; i++) last = core.backupDb(fdb, bdir, 'inicio')
const copies = fs.readdirSync(path.join(bdir, 'copias'))
check('se guardan las 10 copias más recientes', copies.length === 10, String(copies.length))
const copy = new DatabaseSync(last)
check('la copia es una base de datos completa', copy.prepare('SELECT a FROM x').get().a === 42)
copy.close()

// --- apartar los datos anteriores
fdb.close()
const kept = core.setAside(path.join(T, 'f.db'))
check(
  'aparta la base de datos con otro nombre sin perderla',
  !!kept && fs.existsSync(kept) && !fs.existsSync(path.join(T, 'f.db'))
)

console.log(fails ? `\n${fails} comprobaciones fallidas` : '\nmódulo de sincronización: todo correcto')
process.exit(fails ? 1 : 0)
