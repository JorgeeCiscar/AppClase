// Prueba de extremo a extremo de AppClase con Playwright.
// Uso: npm run test:e2e   (en Linux sin pantalla: xvfb-run -a npm run test:e2e)
// KEEP_E2E=1 conserva el directorio temporal con la base de datos y las capturas.
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { _electron } = require('playwright')
const { startFakePlatform } = require('./fake-platform.cjs')

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
    // El «programa» es Node ejecutando un script que escribe la ruta que recibe:
    // así la prueba funciona igual en Windows (donde corre la CI) y en Linux.
    const probeOut = path.join(S, 'abierto.txt')
    const probe = path.join(S, 'programa-falso.cjs')
    fs.writeFileSync(probe, `require('fs').writeFileSync(${JSON.stringify(probeOut)}, process.argv[2])\n`)
    const openedWith = await win.evaluate(
      async ([cmd, args, id]) => {
        await window.api.settings.save({ openers: [{ name: 'Programa de prueba', command: cmd, args }] })
        return window.api.files.openWith(id, 0)
      },
      [process.execPath, probe, javaId]
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

    // --- actualizaciones: sin empaquetar, el botón existe pero está desactivado ---
    await win.click('.sidebar nav button:has-text("Ajustes")')
    await win.waitForSelector('.update-row')
    const updateBtn = win.locator('.update-row button:has-text("Buscar actualizaciones")')
    check('Ajustes muestra el botón «Buscar actualizaciones»', (await updateBtn.count()) === 1)
    check('fuera de la app instalada el botón está desactivado', await updateBtn.isDisabled())
    const updateText = await win.locator('.update-row').textContent()
    check(
      'y explica por qué',
      /solo funcionan en la app instalada/.test(updateText || ''),
      (updateText || '').replace(/\s+/g, ' ').trim()
    )

    // --- importar una actividad desde su enlace (plataforma falsa tipo Moodle/Aules) ---
    const { server, base } = await startFakePlatform()
    const descargas = path.join(S, 'descargas')
    await win.evaluate((d) => window.api.settings.save({ downloads_dir: d }), descargas)
    const subjectsNow = await win.evaluate(() => window.api.subjects.list())
    const idOf = (name) => String(subjectsNow.find((s) => s.name.startsWith(name)).id)
    const value = (sel) => win.locator(sel).inputValue()

    await win.click('.sidebar nav button:has-text("Panel")')
    await win.click('button:has-text("Importar desde enlace")')
    await win.fill('.modal input[name="activity_url"]', `${base}/mod/assign/view.php?id=7`)
    const loginWinP = app.waitForEvent('window')
    await win.click('.modal button:has-text("Leer actividad")')
    const loginWin = await loginWinP
    await loginWin.waitForSelector('input[type="password"]')
    check('la plataforma pide iniciar sesión en una ventana aparte', true)
    await loginWin.fill('input[name="username"]', 'alumne')
    await loginWin.fill('input[type="password"]', 'secret')
    await loginWin.click('#loginbtn')

    await win.waitForSelector('.modal input[name="title"]', { timeout: 30000 })
    const t1 = await value('.modal input[name="title"]')
    check('tras el login vuelve a la actividad y lee el título', t1 === 'Tasca 3: bucles', t1)
    check(
      'reconoce «Programació (1r DAW)» como Programación',
      (await value('.modal select[name="subject_id"]')) === idOf('Programación')
    )
    const due1 = await value('.modal input[name="due_date"]')
    check('lee la fecha de vencimiento en valenciano (no la de apertura)', due1 === '2026-11-21', due1)
    const notes1 = await value('.modal textarea[name="notes"]')
    check('copia el texto de la cabecera de la tarea en las notas', /Feu els exercicis de bucles/.test(notes1) && /Entregueu un únic fitxer/.test(notes1))
    check('y la hora de entrega', /23:59/.test(notes1))
    check(
      'sin copiar las fechas ni los requisitos de finalización',
      !/Obertura|Fet: Rebre|Requisits de compleció/.test(notes1),
      notes1.replace(/\s+/g, ' ').slice(0, 160)
    )
    check('avisa de que la tarea está calificada', /tarea calificada/.test(await win.locator('.modal .notice').textContent()))
    const namesIn = (section) => win.locator(`.modal [data-section="${section}"] .fname`).allTextContents()
    const enun = await namesIn('enunciado')
    check(
      'adjunta los ficheros del profesor de la cabecera (incluida la imagen)',
      enun.length === 3 && ['enunciat tasca 3.pdf', 'Plantilla.java', 'diagrama.png'].every((n) => enun.includes(n)),
      enun.join(', ')
    )
    const env = await namesIn('enviado')
    check('al estar calificada, añade el apartado «Archivo enviado» con tu entrega', env.length === 1 && env[0] === 'mi-entrega.zip', env.join(', '))
    check(
      'ignora los ficheros que están fuera de la cabecera',
      !(await win.locator('.modal').textContent()).includes('horari.pdf')
    )
    const boxes = win.locator('.modal [data-section] input[type="checkbox"]')
    const nBoxes = await boxes.count()
    let nChecked = 0
    for (let i = 0; i < nBoxes; i++) if (await boxes.nth(i).isChecked()) nChecked++
    check('todos marcados para descargar', nBoxes === 4 && nChecked === 4, `${nChecked} de ${nBoxes}`)
    await win.screenshot({ path: path.join(S, 'shots', 'importar.png') })

    await win.click('.modal button:has-text("Guardar")')
    await win.waitForSelector('.modal', { state: 'detached', timeout: 30000 })
    const imported = await win.evaluate(async () => (await window.api.items.list({ text: 'Tasca 3' }))[0])
    check('al estar calificada, se guarda como «corregida» (no pendiente)', imported && imported.status === 'corregida' && imported.kind === 'ejercicio', imported && imported.status)
    const files1 = await win.evaluate((id) => window.api.files.list(id), imported.id)
    const bySection = (s) => files1.filter((f) => f.section === s).map((f) => f.name).sort()
    check(
      'guarda 3 ficheros como enunciado y 1 como archivo enviado',
      bySection('enunciado').join(',') === 'Plantilla.java,diagrama.png,enunciat tasca 3.pdf' &&
        bySection('enviado').join(',') === 'mi-entrega.zip',
      files1.map((f) => `${f.name}[${f.section}]`).join(', ')
    )
    const pdf = files1.find((f) => f.name === 'enunciat tasca 3.pdf')
    check(
      'el PDF se descarga con la sesión iniciada (no la página de login)',
      !!pdf && fs.readFileSync(pdf.path, 'utf8').startsWith('%PDF-1.4 enunciat'),
      pdf ? pdf.path : '(no está)'
    )
    const activityDir = path.join(descargas, 'PRO', 'Tasca 3_ bucles')
    check('el enunciado se guarda en <descargas>/<asignatura>/<actividad>', !!pdf && path.dirname(pdf.path) === activityDir)
    const sent = files1.find((f) => f.section === 'enviado')
    check(
      'el archivo enviado va aparte, en la subcarpeta «Archivo enviado»',
      !!sent && path.dirname(sent.path) === path.join(activityDir, 'Archivo enviado'),
      sent ? sent.path : '(no está)'
    )

    // En la ficha del elemento, los dos apartados se ven por separado.
    await win.click('.sidebar nav button:has-text("Entregas")')
    await win.click('.list-row:has-text("Tasca 3: bucles")')
    await win.waitForSelector('.modal [data-section="enviado"]')
    const groupText = async (s) => (await win.locator(`.modal [data-section="${s}"]`).textContent()) || ''
    const enviadoUi = await groupText('enviado')
    const enunciadoUi = await groupText('enunciado')
    check(
      'la ficha muestra el apartado «Archivo enviado» aparte del enunciado del profesor',
      enviadoUi.startsWith('Archivo enviado') && enviadoUi.includes('mi-entrega.zip') &&
        enunciadoUi.startsWith('Enunciado del profesor') && !enunciadoUi.includes('mi-entrega.zip')
    )
    await win.screenshot({ path: path.join(S, 'shots', 'ficha-calificada.png') })
    await win.click('.modal button:has-text("Cerrar")')

    // Tarea sin calificar y solo con texto: el texto va a las notas y no se recoge tu entrega.
    await win.click('button:has-text("Importar desde enlace")')
    await win.fill('.modal input[name="activity_url"]', `${base}/mod/assign/view.php?id=8`)
    await win.click('.modal button:has-text("Leer actividad")')
    await win.waitForSelector('.modal input[name="title"]', { timeout: 30000 })
    const t4 = await value('.modal input[name="title"]')
    check('tarea de solo texto: lee el título', t4 === 'Tarea 4: arrays', t4)
    const notes4 = await value('.modal textarea[name="notes"]')
    check('tarea de solo texto: copia el texto en las notas', /Declara un array de 10 enteros/.test(notes4), notes4.slice(0, 80))
    const due4 = await value('.modal input[name="due_date"]')
    check('lee «Pendiente:» (Moodle 4 en castellano) como fecha de entrega', due4 === '2026-11-30', due4)
    check(
      'sin calificar: no hay apartado «Archivo enviado» ni se recoge tu entrega',
      (await win.locator('.modal [data-section="enviado"]').count()) === 0 &&
        !(await win.locator('.modal').textContent()).includes('entrega-arrays.zip')
    )
    check('sin calificar: no avisa de calificada', !/tarea calificada/.test(await win.locator('.modal .notice').textContent()))
    await win.click('.modal button:has-text("Guardar")')
    await win.waitForSelector('.modal', { state: 'detached', timeout: 30000 })
    const imported4 = await win.evaluate(async () => (await window.api.items.list({ text: 'Tarea 4' }))[0])
    const files4 = await win.evaluate((id) => window.api.files.list(id), imported4.id)
    check('tarea de solo texto: se guarda sin ficheros', files4.length === 0, files4.map((f) => f.name).join(', '))
    check('sin calificar: se guarda como entrega pendiente', imported4.status === 'pendiente', imported4.status)

    // Página genérica (no Moodle) en castellano: no pide sesión.
    await win.click('button:has-text("Importar desde enlace")')
    await win.fill('.modal input[name="activity_url"]', `${base}/actividad-generica.html`)
    await win.click('.modal button:has-text("Leer actividad")')
    await win.waitForSelector('.modal input[name="title"]', { timeout: 30000 })
    const t2 = await value('.modal input[name="title"]')
    check('página genérica: lee el título', t2 === 'Práctica 2: formulario accesible', t2)
    const due2 = await value('.modal input[name="due_date"]')
    check('página genérica: lee «Fecha límite: 05/12/2026»', due2 === '2026-12-05', due2)
    check(
      'página genérica: reconoce Lenguajes de marcas',
      (await value('.modal select[name="subject_id"]')) === idOf('Lenguajes de marcas')
    )
    await win.click('.modal button:has-text("Guardar")')
    await win.waitForSelector('.modal', { state: 'detached', timeout: 30000 })
    const imported2 = await win.evaluate(async () => (await window.api.items.list({ text: 'Práctica 2' }))[0])
    const files2 = await win.evaluate((id) => window.api.files.list(id), imported2.id)
    check('página genérica: descarga el PDF enlazado', files2.length === 1 && files2[0].name === 'practica2.pdf', files2.map((f) => f.name).join(', '))

    // Cerrar sesión y cancelar: la siguiente lectura vuelve a pedir el login, y cerrar la ventana cancela.
    await win.evaluate(() => window.api.importer.logout())
    const relogP = app.waitForEvent('window')
    const pending = win.evaluate((u) => window.api.importer.read(u).then(() => 'leída', (e) => e.message), `${base}/mod/assign/view.php?id=7`)
    const relog = await relogP
    await relog.waitForSelector('input[type="password"]')
    check('tras cerrar sesión, la plataforma vuelve a pedir el login', true)
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('/login/'))
      if (w) w.close()
    })
    const outcome = await pending
    check('cerrar esa ventana cancela la lectura con un mensaje claro', /cancelada/.test(outcome), outcome)
    server.close()

    check('sin errores de JavaScript en la interfaz', errors.length === 0, errors.join(' | '))
    await app.close()
  }

  if (!process.env.KEEP_E2E) fs.rmSync(S, { recursive: true, force: true })
  else console.log('resultados en', S)
  console.log(failures ? `\n${failures} comprobación(es) fallidas` : '\nTodo correcto')
  process.exit(failures ? 1 : 0)
})()
