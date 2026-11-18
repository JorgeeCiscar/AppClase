// Prueba de la sincronización entre ordenadores por OneDrive. Simula dos ordenadores
// (PC-A y PC-B) con su propia carpeta de usuario y su propio OneDrive; la
// «sincronización» de OneDrive se hace copiando carpetas.
//   xvfb-run -a node scripts/e2e-sync.cjs   (después de electron-vite build)
const { _electron } = require('playwright')
const { spawn, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const ELECTRON = require('electron')
const S = fs.mkdtempSync(path.join(process.env.E2E_OUT || os.tmpdir(), 'appclase-sync-'))
let fails = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✔' : '✘'} ${name}${extra ? ` (${extra})` : ''}`)
  if (!ok) fails++
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const pc = (name) => {
  const base = path.join(S, name)
  const p = {
    host: name,
    config: path.join(base, 'config'),
    data: path.join(base, 'datos-locales'),
    oneDrive: path.join(base, 'OneDrive'),
    desktop: path.join(base, 'Escritorio')
  }
  for (const d of [p.config, p.data, p.oneDrive, p.desktop]) fs.mkdirSync(d, { recursive: true })
  p.cloud = path.join(p.oneDrive, 'AppClase', 'datos')
  p.env = (extra = {}) => ({
    ...process.env,
    APPCLASE_TEST: '1',
    APPCLASE_HOST: name,
    APPCLASE_CONFIG_DIR: p.config,
    APPCLASE_DATA_DIR: p.data,
    APPCLASE_ONEDRIVE: p.oneDrive,
    ...extra
  })
  return p
}

async function launch(p, extra) {
  const app = await _electron.launch({ executablePath: ELECTRON, args: [ROOT, '--no-sandbox'], env: p.env(extra) })
  const log = []
  app.process().stdout.on('data', (d) => log.push(String(d)))
  app.process().stderr.on('data', (d) => log.push(String(d)))
  const exited = new Promise((r) => app.process().once('exit', (code) => r(code)))
  const win = await app.firstWindow()
  win.on('pageerror', (e) => check(`sin errores en la página: ${e.message}`, false))
  await win.waitForSelector('.sidebar')
  return { app, win, exited, log }
}

const settings = async (win) => {
  await win.click('.sidebar nav button:has-text("Ajustes")')
  await win.waitForSelector('.sync-box')
}

/** Espera a que la app termine sola, como mucho ms. */
const exitsWithin = (exited, ms) => Promise.race([exited.then(() => true), sleep(ms).then(() => false)])

const copyDir = (from, to) => fs.cpSync(from, to, { recursive: true, force: true })
const lockOf = (p) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(p.cloud, 'appclase.lock'), 'utf8'))
  } catch {
    return null
  }
}
const itemByTitle = (win, title) =>
  win.evaluate(async (t) => (await window.api.items.list({ text: t })).find((i) => i.title === t) ?? null, title)

async function main() {
  // ----- módulo de sincronización por separado
  const bundle = path.join(S, 'syncCore.cjs')
  require('esbuild').buildSync({
    entryPoints: [path.join(ROOT, 'src/main/syncCore.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: bundle,
    logLevel: 'error'
  })
  fs.mkdirSync(path.join(S, 'unit'))
  const unit = spawnSync(ELECTRON, [path.join(__dirname, 'sync-unit.cjs'), bundle, path.join(S, 'unit')], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8'
  })
  process.stdout.write(unit.stdout + unit.stderr)
  if (unit.status !== 0) fails++

  const A = pc('PC-A')
  const B = pc('PC-B')

  // ----- PC-A: datos locales con una entrega y dos ficheros (uno dentro de OneDrive y otro fuera)
  fs.mkdirSync(path.join(A.oneDrive, 'Clase'), { recursive: true })
  fs.writeFileSync(path.join(A.oneDrive, 'Clase', 'practica.txt'), 'práctica 1')
  fs.writeFileSync(path.join(A.desktop, 'fuera.txt'), 'solo en PC-A')
  fs.writeFileSync(path.join(A.desktop, 'otro.txt'), 'para que la carpeta siga existiendo')
  let a = await launch(A)
  await a.win.evaluate(
    async ({ inside, outside }) => {
      const subjects = await window.api.subjects.list()
      const item = await window.api.items.save({
        subject_id: subjects[0].id,
        kind: 'ejercicio',
        title: 'Práctica sincronizada',
        due_date: '2026-12-01',
        status: 'pendiente'
      })
      await window.api.files.addPaths(item.id, [inside, outside])
    },
    { inside: path.join(A.oneDrive, 'Clase', 'practica.txt'), outside: path.join(A.desktop, 'fuera.txt') }
  )
  await settings(a.win)
  check('Ajustes muestra el OneDrive de este ordenador', (await a.win.textContent('.sync-box')).includes(A.oneDrive))
  await a.win.click('button[name="sync_enable"]')
  await a.win.click('button[name="sync_confirm"]')
  check('al activar, la app se reinicia', await exitsWithin(a.exited, 10000))
  check('los datos se copian a OneDrive', fs.existsSync(path.join(A.cloud, 'appclase.db')))
  check(
    'este ordenador recuerda que usa OneDrive',
    JSON.parse(fs.readFileSync(path.join(A.config, 'config.json'), 'utf8')).sync === true
  )

  a = await launch(A)
  await settings(a.win)
  check(
    'tras reiniciar, la sincronización está activada',
    (await a.win.getAttribute('.sync-box', 'data-sync')) === 'on'
  )
  check('la entrega sigue ahí, ahora desde OneDrive', !!(await itemByTitle(a.win, 'Práctica sincronizada')))
  check('mientras está abierta, deja la marca «en uso» con su nombre', lockOf(A)?.host === 'PC-A')
  check('hace una copia de seguridad al abrir', fs.readdirSync(path.join(A.cloud, 'copias')).length === 1)
  await a.app.close()
  check('al cerrar quita la marca «en uso»', lockOf(A) === null)

  // ----- OneDrive sincroniza: PC-B recibe la carpeta AppClase y la de clase
  copyDir(path.join(A.oneDrive, 'AppClase'), path.join(B.oneDrive, 'AppClase'))
  copyDir(path.join(A.oneDrive, 'Clase'), path.join(B.oneDrive, 'Clase'))
  // En PC-B el fichero del Escritorio de PC-A no existe (su carpeta sí, con otro fichero).
  fs.renameSync(path.join(A.desktop, 'fuera.txt'), path.join(S, 'fuera-apartado.txt'))

  let b = await launch(B)
  check('PC-B arranca con sus propios datos', !(await itemByTitle(b.win, 'Práctica sincronizada')))
  await settings(b.win)
  check('PC-B ve que ya hay datos en OneDrive', (await b.win.locator('button[name="sync_adopt"]').count()) === 1)
  await b.win.click('button[name="sync_adopt"]')
  await b.win.click('button[name="sync_confirm"]')
  check('al usar los datos de OneDrive, la app se reinicia', await exitsWithin(b.exited, 10000))
  check('los datos que tenía PC-B se quedan guardados', fs.existsSync(path.join(B.data, 'appclase.db')))

  b = await launch(B, { APPCLASE_BEAT_MS: '700' })
  const item = await itemByTitle(b.win, 'Práctica sincronizada')
  check('PC-B ve la entrega creada en PC-A', !!item)
  const files = await b.win.evaluate((id) => window.api.files.list(id), item.id)
  const inside = files.find((f) => f.name === 'practica.txt')
  const outside = files.find((f) => f.name === 'fuera.txt')
  check(
    'el fichero de OneDrive apunta al OneDrive de PC-B',
    inside?.path === path.join(B.oneDrive, 'Clase', 'practica.txt') && inside.missing === 0,
    inside?.path
  )
  check(
    'el fichero de fuera de OneDrive no se quita: sale como «no se encuentra»',
    !!outside && outside.missing === 1,
    outside ? `missing=${outside.missing}` : 'quitado'
  )
  await b.win.evaluate((id) => window.api.items.setStatus(id, 'entregada'), item.id)

  // ----- PC-A intenta abrir mientras PC-B la tiene abierta (marca recién sincronizada)
  await sleep(1000)
  fs.copyFileSync(path.join(B.cloud, 'appclase.lock'), path.join(A.cloud, 'appclase.lock'))
  const blocked = spawn(ELECTRON, [ROOT, '--no-sandbox'], {
    env: A.env({ APPCLASE_LOCK_ANSWER: 'salir' }),
    stdio: 'ignore'
  })
  const blockedExit = new Promise((r) => blocked.once('exit', () => r(true)))
  const stopped = await Promise.race([blockedExit, sleep(15000).then(() => false)])
  if (!stopped) blocked.kill()
  check('si está abierta en otro ordenador, avisa y no abre los datos', stopped)
  check('no le quita la marca al otro ordenador', lockOf(A)?.host === 'PC-B')

  // ----- PC-A la abre igualmente: PC-B se da cuenta en el siguiente latido y se cierra
  const takeover = {
    id: 'otra-apertura',
    host: 'PC-A',
    since: new Date().toISOString(),
    beat: new Date().toISOString()
  }
  fs.writeFileSync(path.join(B.cloud, 'appclase.lock'), JSON.stringify(takeover))
  check('si otro ordenador toma el relevo, esta se cierra sola', await exitsWithin(b.exited, 8000))
  check('al cerrarse así, respeta la marca del otro', lockOf(B)?.id === 'otra-apertura')
  fs.rmSync(path.join(B.cloud, 'appclase.lock'))

  // ----- desactivar en PC-B: los datos de OneDrive pasan a PC-B
  b = await launch(B)
  check(
    'lo que cambió PC-B antes de cerrarse está guardado',
    (await itemByTitle(b.win, 'Práctica sincronizada'))?.status === 'entregada'
  )
  await settings(b.win)
  await b.win.click('button[name="sync_disable"]')
  await b.win.click('button[name="sync_confirm"]')
  check('al desactivar, la app se reinicia', await exitsWithin(b.exited, 10000))
  check(
    'los datos anteriores de PC-B se apartan, no se borran',
    fs.readdirSync(B.data).some((f) => /^appclase-antes-.*\.db$/.test(f))
  )
  b = await launch(B)
  await settings(b.win)
  check('tras desactivar, usa datos locales', (await b.win.getAttribute('.sync-box', 'data-sync')) === 'off')
  check(
    'con una copia de lo que había en OneDrive',
    (await itemByTitle(b.win, 'Práctica sincronizada'))?.status === 'entregada'
  )
  await b.app.close()

  console.log(fails ? `\n✘ ${fails} comprobaciones fallidas (resultados en ${S})` : '\n✔ sincronización: todo correcto')
  if (!process.env.KEEP_E2E && !fails) fs.rmSync(S, { recursive: true, force: true })
  process.exit(fails ? 1 : 0)
}

main().catch((e) => {
  console.error('✘ ERROR:', e)
  console.error('resultados en', S)
  process.exit(1)
})
