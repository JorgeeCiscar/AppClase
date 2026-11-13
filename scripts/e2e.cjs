// Prueba de extremo a extremo de AppClase con Playwright.
// Uso: npm run test:e2e   (en Linux sin pantalla: xvfb-run -a npm run test:e2e)
// KEEP_E2E=1 conserva el directorio temporal con la base de datos y las capturas.
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { _electron } = require('playwright')

const ROOT = path.resolve(__dirname, '..')
const S = fs.mkdtempSync(path.join(process.env.E2E_OUT || os.tmpdir(), 'appclase-e2e-'))
for (const d of ['data', 'curso', 'shots']) fs.mkdirSync(path.join(S, d))

// Ficheros de ejemplo que la app indexará por su ruta.
const javaFile = path.join(S, 'curso', 'Ejercicio3.java')
const txtFile = path.join(S, 'curso', 'apuntes-tema1.txt')
const sqlFile = path.join(S, 'curso', 'consultas.sql')
fs.writeFileSync(javaFile, 'public class Ejercicio3 {\n  // bucle while de ejemplo\n  void run() { while (true) {} }\n}\n')
fs.writeFileSync(txtFile, 'Tema 1: introduccion a la programacion\n')
fs.writeFileSync(sqlFile, 'SELECT * FROM alumnos;\n')
console.log('directorio de prueba:', S)

let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ' — ' + detail : ''}`)
  if (!ok) failures++
}

;(async () => {
  let win
  try {
    await run()
  } catch (e) {
    console.error('✘ ERROR:', e.message.split('\n')[0])
    if (win) {
      await win.screenshot({ path: path.join(S, 'shots', 'fallo.png'), timeout: 5000 }).catch(() => {})
      const text = await Promise.race([
        win.evaluate(() => (document.querySelector('.modal') ?? document.querySelector('main'))?.textContent ?? ''),
        new Promise((r) => setTimeout(() => r('(la ventana no responde)'), 5000))
      ]).catch((err) => `(error: ${err.message})`)
      console.error('pantalla:', String(text).slice(0, 800))
    }
    console.error('resultados en', S)
    process.exit(1)
  }

  async function run() {
    const app = await _electron.launch({
      executablePath: require('electron'),
      args: [ROOT, '--no-sandbox'],
      env: { ...process.env, APPCLASE_DATA_DIR: path.join(S, 'data') }
    })
    const errors = []
    const mainLog = []
    app.process().stdout.on('data', (d) => mainLog.push(String(d)))
    app.process().stderr.on('data', (d) => mainLog.push(String(d)))
    process.on('exit', (code) => {
      if (code) console.error('--- proceso principal ---\n' + mainLog.join('').slice(-4000))
    })
    win = await app.firstWindow()
    win.on('pageerror', (e) => errors.push(e.message))
    await win.waitForSelector('.sidebar')

    // --- arranque: las asignaturas de 1º DAW vienen sembradas ---
    await win.click('.sidebar nav button:has-text("Asignaturas")')
    await win.waitForSelector('.subject-card')
    const cards = await win.locator('.subject-card').count()
    check('se siembran los 6 módulos de 1º DAW', cards === 6, `${cards} asignaturas`)
    check('aparece Programación', await win.locator('.subject-card:has-text("Programación")').count() > 0)

    // --- crear un tema y un elemento desde la interfaz ---
    await win.click('.subject-card:has-text("Programación") button:has-text("Abrir")')
    await win.waitForSelector('h1:has-text("Programación")')

    await win.click('button:has-text("Nuevo tema")')
    await win.waitForSelector('.modal')
    await win.fill('.modal input[name="unit_number"]', '1')
    await win.fill('.modal input[name="unit_title"]', 'Estructuras de control')
    await win.click('.modal button:has-text("Guardar")')
    await win.waitForSelector('h2:has-text("Estructuras de control")')
    check('se crea un tema', true)

    await win.click('button:has-text("Nuevo elemento")')
    await win.waitForSelector('.modal')
    await win.fill('.modal input[name="title"]', 'Ejercicio 3: bucles')
    await win.selectOption('.modal select[name="unit_id"]', { label: '1. Estructuras de control' })
    await win.fill('.modal input[name="due_date"]', '2027-01-15')
    await win.selectOption('.modal select[name="status"]', 'pendiente')
    await win.click('.modal button:has-text("Guardar")')
    await win.waitForSelector('.list-row:has-text("Ejercicio 3: bucles")')
    check('se crea un elemento con fecha límite y estado', true)

    const itemId = await win.evaluate(async () => {
      const items = await window.api.items.list({})
      return items[0]?.id
    })
    check('el elemento se guardó en la base de datos', typeof itemId === 'number', `id ${itemId}`)

    // --- indexar ficheros por su ruta (sin copiarlos) ---
    const added = await win.evaluate(
      ([id, paths]) => window.api.files.addPaths(id, paths),
      [itemId, [javaFile, txtFile, sqlFile]]
    )
    check('se indexan 3 ficheros', added.added === 3, JSON.stringify(added))

    const dup = await win.evaluate(([id, paths]) => window.api.files.addPaths(id, paths), [itemId, [javaFile]])
    check('no se duplica un fichero ya indexado', dup.added === 0 && dup.skipped === 1, JSON.stringify(dup))

    check(
      'el fichero original no se ha movido ni copiado',
      fs.existsSync(javaFile) && fs.readdirSync(path.join(S, 'curso')).length === 3
    )

    await win.click('.list-row:has-text("Ejercicio 3: bucles")')
    await win.waitForSelector('.modal .file-row')
    const shownPath = await win.locator('.modal .file-row:has-text("Ejercicio3.java") .fpath').first().textContent()
    check('la lista muestra la ruta real del fichero', (shownPath || '').includes('curso'), shownPath || '')

    // --- fichero movido fuera de la app: queda marcado como perdido ---
    fs.unlinkSync(sqlFile)
    await win.click('.modal button:has-text("Comprobar ficheros")')
    await win.waitForSelector('.modal .file-row.missing')
    check('un fichero borrado fuera se marca como «no se encuentra»', true)
    check(
      'y se puede volver a localizar',
      await win.locator('.modal .file-row.missing button:has-text("Buscar de nuevo")').count() > 0
    )

    // --- abrir con la aplicación del sistema: se comprueba el error controlado ---
    const missingId = await win.evaluate(async (id) => {
      const files = await window.api.files.list(id)
      return files.find((f) => f.missing)?.id
    }, itemId)
    const javaId = await win.evaluate(async (id) => {
      const files = await window.api.files.list(id)
      return files.find((f) => f.name === 'Ejercicio3.java')?.id
    }, itemId)
    const openMissing = await win.evaluate((id) => window.api.files.open(id), missingId)
    check(
      'abrir un fichero que falta da un error claro en vez de romper',
      openMissing.ok === false && /No se encuentra/.test(openMissing.error || ''),
      openMissing.error || ''
    )

    // --- «Abrir con»: se lanza un programa de verdad y se comprueba que recibe la ruta ---
    const probeOut = path.join(S, 'abierto.txt')
    const probe = path.join(S, 'programa-falso.sh')
    fs.writeFileSync(probe, `#!/bin/sh\nprintf '%s' "$1" > ${probeOut}\n`)
    fs.chmodSync(probe, 0o755)
    const openedWith = await win.evaluate(
      async ([cmd, id]) => {
        await window.api.settings.save({ openers: [{ name: 'Programa de prueba', command: cmd, args: '' }] })
        return window.api.files.openWith(id, 0)
      },
      [probe, javaId]
    )
    check('«Abrir con» lanza el programa configurado', openedWith.ok === true, JSON.stringify(openedWith))
    for (let i = 0; i < 50 && !fs.existsSync(probeOut); i++) await new Promise((r) => setTimeout(r, 100))
    check(
      'el programa recibe la ruta real del fichero',
      fs.existsSync(probeOut) && fs.readFileSync(probeOut, 'utf8') === javaFile,
      fs.existsSync(probeOut) ? fs.readFileSync(probeOut, 'utf8') : '(no se ejecutó)'
    )

    await win.click('.modal button:has-text("Cerrar")')

    // --- búsqueda dentro del contenido de los ficheros ---
    await win.click('.sidebar nav button:has-text("Buscar")')
    await win.fill('.search-box input[type="text"], .search-box input:not([type])', 'bucle')
    await win.check('.search-box input[type="checkbox"]')
    await win.waitForSelector('h2:has-text("Dentro de los ficheros")')
    const snippet = await win.locator('.snippet').first().textContent()
    check('encuentra texto dentro de un .java indexado', /bucle/.test(snippet || ''), snippet || '')

    // --- entregas y panel ---
    await win.click('.sidebar nav button:has-text("Entregas")')
    await win.waitForSelector('.list-row:has-text("Ejercicio 3: bucles")')
    check('la entrega aparece en la lista de Entregas', true)

    await win.click('.sidebar nav button:has-text("Panel")')
    await win.waitForSelector('.stats')
    const statsText = await win.locator('.stats').textContent()
    check('el panel cuenta las entregas sin terminar', /1\s*entregas sin terminar/.test(statsText || ''), (statsText || '').replace(/\s+/g, ' ').slice(0, 120))
    const panelMissing = await win.evaluate(() => window.api.stats().then((s) => s.missing))
    check('el panel cuenta el fichero que falta', panelMissing === 1, String(panelMissing))

    await win.screenshot({ path: path.join(S, 'shots', 'panel.png') })

    check('sin errores de JavaScript en la interfaz', errors.length === 0, errors.join(' | '))
    await app.close()
  }

  if (!process.env.KEEP_E2E) fs.rmSync(S, { recursive: true, force: true })
  else console.log('resultados en', S)
  console.log(failures ? `\n${failures} comprobación(es) fallidas` : '\nTodo correcto')
  process.exit(failures ? 1 : 0)
})()
