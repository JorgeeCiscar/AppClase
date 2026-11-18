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
// Un fichero en una carpeta aparte, que luego desaparecerá entera (como un USB sin conectar).
const usbDir = path.join(S, 'curso', 'usb')
fs.mkdirSync(usbDir)
const usbFile = path.join(usbDir, 'notas-usb.txt')
fs.writeFileSync(usbFile, 'notas guardadas en el USB\n')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
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
      env: {
        ...process.env,
        APPCLASE_DATA_DIR: path.join(S, 'data'),
        APPCLASE_CONFIG_DIR: path.join(S, 'config'),
        APPCLASE_DEBUG_WATCH: '1'
      }
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

    await win.click('button:has-text("Nueva unidad")')
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
      [itemId, [javaFile, txtFile, sqlFile, usbFile]]
    )
    check('se indexan 4 ficheros', added.added === 4, JSON.stringify(added))

    const dup = await win.evaluate(([id, paths]) => window.api.files.addPaths(id, paths), [itemId, [javaFile]])
    check('no se duplica un fichero ya indexado', dup.added === 0 && dup.skipped === 1, JSON.stringify(dup))

    check(
      'el fichero original no se ha movido ni copiado',
      fs.existsSync(javaFile) && fs.readdirSync(path.join(S, 'curso')).length === 4
    )

    await win.click('.list-row:has-text("Ejercicio 3: bucles")')
    await win.waitForSelector('.modal .file-row')
    const shownPath = await win.locator('.modal .file-row:has-text("Ejercicio3.java") .fpath').first().textContent()
    check('la lista muestra la ruta real del fichero', (shownPath || '').includes('curso'), shownPath || '')

    // --- la app sigue en directo lo que haces en la carpeta, sin pulsar nada ---
    await win.evaluate(() => {
      window.__cambios = 0
      window.api.files.onChanged(() => {
        window.__cambios++
      })
    })
    const waitChange = async (before) => {
      for (let i = 0; i < 80; i++) {
        if ((await win.evaluate(() => window.__cambios)) > before) return true
        await sleep(100)
      }
      return false
    }
    const filesNow = () => win.evaluate((id) => window.api.files.list(id), itemId)
    const before = await filesNow()
    const javaBefore = before.find((f) => f.name === 'Ejercicio3.java')
    const txtBefore = before.find((f) => f.name === 'apuntes-tema1.txt')

    let n0 = await win.evaluate(() => window.__cambios)
    fs.appendFileSync(javaFile, '// cambio hecho con otro programa\n')
    check('editar un fichero en su carpeta avisa a la app al momento', await waitChange(n0))
    const javaAfter = (await filesNow()).find((f) => f.id === javaBefore.id)
    check('y se actualiza su tamaño', javaAfter && javaAfter.size > javaBefore.size, `${javaBefore.size} → ${javaAfter && javaAfter.size}`)

    n0 = await win.evaluate(() => window.__cambios)
    const renamedTxt = path.join(S, 'curso', 'apuntes-tema1-v2.txt')
    fs.renameSync(txtFile, renamedTxt)
    check('renombrar un fichero en su carpeta avisa a la app', await waitChange(n0))
    const txtAfter = (await filesNow()).find((f) => f.id === txtBefore.id)
    check(
      'y la app lo sigue con el nombre nuevo (mismo elemento, sin perderlo)',
      txtAfter && txtAfter.name === 'apuntes-tema1-v2.txt' && txtAfter.path === renamedTxt && !txtAfter.missing,
      txtAfter ? txtAfter.name : '(desapareció)'
    )

    n0 = await win.evaluate(() => window.__cambios)
    fs.unlinkSync(sqlFile)
    check('borrar un fichero de su carpeta avisa a la app', await waitChange(n0))
    check('y desaparece de la app', !(await filesNow()).some((f) => f.name === 'consultas.sql'))
    await win.waitForSelector('.modal .file-row:has-text("consultas.sql")', { state: 'detached', timeout: 5000 })
    check('la ficha abierta se actualiza sola', (await win.locator('.modal .file-row:has-text("apuntes-tema1-v2.txt")').count()) === 1)

    n0 = await win.evaluate(() => window.__cambios)
    fs.rmSync(usbDir, { recursive: true, force: true })
    const usbAviso = await waitChange(n0)
    if (!usbAviso) {
      // Diagnóstico para Windows: qué ve el sistema y qué tiene la app.
      console.log('  diagnóstico: existe la carpeta para la prueba =', fs.existsSync(usbDir))
      console.log('  diagnóstico: contenido de curso =', fs.readdirSync(path.join(S, 'curso')).join(', '))
      console.log('  diagnóstico: ficheros en la app =', JSON.stringify((await filesNow()).map((f) => [f.name, f.missing])))
    }
    check('si desaparece la carpeta entera, también avisa', usbAviso)
    await win.waitForSelector('.modal .file-row.missing:has-text("notas-usb.txt")', { timeout: 5000 })
    check(
      'pero no lo quita: queda «no se encuentra» para volver a localizarlo (USB sin conectar)',
      (await win.locator('.modal .file-row.missing button:has-text("Buscar de nuevo")').count()) === 1
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
    const notice = async () => (await win.locator('.modal .notice').textContent()) || ''
    const unitChosen = async () => (await win.locator('.modal select[name="unit_id"] option:checked').textContent()) || ''
    const unit7 = await unitChosen()
    check('lee la unidad («Unitat 1: …») y la coloca en la unidad 1 que ya existía', unit7 === '1. Estructuras de control', unit7)
    check(
      'detecta el estado de la entrega: «Qualificat» → corregida',
      (await value('.modal select[name="status"]')) === 'corregida' && /«Qualificat»/.test(await notice())
    )
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
    const proUnits = () =>
      win.evaluate(async (sid) => (await window.api.units.list(sid)).map((u) => `${u.number}. ${u.title}`), Number(idOf('Programación')))
    const units7 = await proUnits()
    check(
      'no duplica la unidad: la guarda en la «1. Estructuras de control» que ya había',
      imported.unit_title === 'Estructuras de control' && units7.length === 1,
      units7.join(' | ')
    )
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
    await win.waitForSelector('.detail-pane [data-section="enviado"]')
    // Entregas: tarjetas en cuadrícula y la ficha al lado, sin ventana encima.
    check('en Entregas la ficha se abre al lado, no como ventana', (await win.locator('.modal').count()) === 0)
    const paneBox = await win.locator('.detail-pane').boundingBox()
    const cardBox = await win.locator('.list-row.is-open').boundingBox()
    check(
      'las tarjetas siguen a la vista a la izquierda y la abierta queda marcada',
      !!cardBox && cardBox.x + cardBox.width <= paneBox.x,
      `tarjeta x=${cardBox && Math.round(cardBox.x)} · ficha x=${Math.round(paneBox.x)}`
    )
    const cardsPerRow = await win.locator('.deliv-groups .list').first().evaluate((l) => getComputedStyle(l).gridTemplateColumns.split(' ').length)
    check('las entregas se ven como tarjetas en cuadrícula', cardsPerRow >= 2, `${cardsPerRow} columnas`)
    const groupText = async (s) => (await win.locator(`.detail-pane [data-section="${s}"]`).textContent()) || ''
    const enviadoUi = await groupText('enviado')
    const enunciadoUi = await groupText('enunciado')
    check(
      'la ficha muestra el apartado «Archivo enviado» aparte del enunciado del profesor',
      enviadoUi.startsWith('Archivo enviado') && enviadoUi.includes('mi-entrega.zip') &&
        enunciadoUi.startsWith('Enunciado del profesor') && !enunciadoUi.includes('mi-entrega.zip')
    )
    await win.screenshot({ path: path.join(S, 'shots', 'ficha-calificada.png') })
    await win.click('.detail-pane button:has-text("Cerrar")')
    check('«Cerrar» quita la ficha lateral', (await win.locator('.detail-pane').count()) === 0)

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
      'detecta «Enviado para calificar» → entregada',
      (await value('.modal select[name="status"]')) === 'entregada' && /«Enviado para calificar»/.test(await notice()),
      await value('.modal select[name="status"]')
    )
    const unit4 = await unitChosen()
    check('lee «UD 3 - Arrays» y la ofrece como unidad nueva', unit4 === '3. Arrays (nueva)', unit4)
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
    check('se guarda como «entregada»', imported4.status === 'entregada', imported4.status)
    check(
      'crea la unidad «3. Arrays» en Programación y mete ahí la actividad',
      imported4.unit_number === 3 && imported4.unit_title === 'Arrays',
      `${imported4.unit_number}. ${imported4.unit_title}`
    )

    // Borrador, con la unidad como texto (sin enlace) y un enunciado que dice «será calificado».
    await win.click('button:has-text("Importar desde enlace")')
    await win.fill('.modal input[name="activity_url"]', `${base}/mod/assign/view.php?id=9`)
    await win.click('.modal button:has-text("Leer actividad")')
    await win.waitForSelector('.modal input[name="title"]', { timeout: 30000 })
    const st5 = await value('.modal select[name="status"]')
    check('detecta «Borrador (no enviado)» → en curso', st5 === 'en curso', st5)
    check('«será calificado» en el enunciado no la marca como calificada', !/tarea calificada/.test(await notice()))
    const unit5 = await unitChosen()
    check('lee la unidad aunque en la ruta no sea un enlace («Tema 4. Funciones»)', unit5 === '4. Funciones (nueva)', unit5)
    await win.click('.modal button:has-text("Guardar")')
    await win.waitForSelector('.modal', { state: 'detached', timeout: 30000 })
    const imported5 = await win.evaluate(async () => (await window.api.items.list({ text: 'Tarea 5' }))[0])
    check(
      'se guarda en curso y en la unidad «4. Funciones»',
      imported5.status === 'en curso' && imported5.unit_number === 4 && imported5.unit_title === 'Funciones',
      `${imported5.status} · ${imported5.unit_number}. ${imported5.unit_title}`
    )

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

    // --- Varios enlaces a la vez: se leen y se revisan en el orden en que los pones ---
    await win.click('button:has-text("Importar desde enlace")')
    const rows = win.locator('.modal input[name="activity_url"]')
    // Pegar dos enlaces de golpe en el primer campo los reparte en dos campos.
    await rows.first().evaluate((el, text) => {
      const dt = new DataTransfer()
      dt.setData('text/plain', text)
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    }, `${base}/mod/assign/view.php?id=8\n${base}/actividad-generica.html`)
    check(
      'pegar dos enlaces de golpe crea dos campos',
      (await rows.count()) === 2 && (await rows.nth(1).inputValue()).endsWith('/actividad-generica.html')
    )
    await win.click('.modal button:has-text("Añadir otro enlace")')
    check('«+ Añadir otro enlace» añade un campo más', (await rows.count()) === 3)
    await rows.nth(2).fill('esto no es un enlace')
    check('el botón dice cuántas se van a leer', /Leer 3 actividades/.test((await win.locator('.modal button[type="submit"]').textContent()) || ''))
    await win.screenshot({ path: path.join(S, 'shots', 'varios-enlaces.png') })
    await win.click('.modal button[type="submit"]')

    await win.waitForSelector('.modal:has-text("Revisa la actividad 1 de 3")', { timeout: 30000 })
    check('revisa primero la actividad del primer enlace', (await value('.modal input[name="title"]')) === 'Tarea 4: arrays')
    await win.click('.modal button:has-text("Guardar")')
    await win.waitForSelector('.modal:has-text("Revisa la actividad 2 de 3")', { timeout: 30000 })
    check('después, la del segundo', (await value('.modal input[name="title"]')) === 'Práctica 2: formulario accesible')
    await win.click('.modal button:has-text("Saltar esta")')

    await win.waitForSelector('.modal:has-text("Resultado de la importación")', { timeout: 30000 })
    const results = await win.locator('.modal [data-result]').evaluateAll((els) => els.map((e) => e.getAttribute('data-result')))
    check('el resumen recoge cada enlace en orden: guardada, saltada, error', results.join(',') === 'guardada,saltada,error', results.join(','))
    check('y explica por qué falló el tercero', /no es válido/.test((await win.locator('.modal [data-result="error"]').textContent()) || ''))
    await win.screenshot({ path: path.join(S, 'shots', 'resumen.png') })
    await win.click('.modal button:has-text("Cerrar")')
    const count = (t) => win.evaluate(async (text) => (await window.api.items.list({ text })).length, t)
    const [n4, n2] = [await count('Tarea 4'), await count('Práctica 2')]
    check('solo se guarda la que confirmaste, no la saltada', n4 === 2 && n2 === 1, `Tarea 4: ${n4}, Práctica 2: ${n2}`)
    const unitsAfter = await proUnits()
    check(
      'volver a importar una actividad de la unidad 3 no crea otra unidad 3',
      unitsAfter.filter((u) => u.startsWith('3.')).length === 1,
      unitsAfter.join(' | ')
    )

    // --- Entregas: por defecto, agrupadas por asignatura ---
    await win.click('.sidebar nav button:has-text("Panel")')
    await win.click('.sidebar nav button:has-text("Entregas")')
    await win.waitForSelector('.subject-group')
    const groupsInfo = await win.locator('.subject-group').evaluateAll((els) =>
      els.map((s) => ({
        name: s.getAttribute('data-subject'),
        rows: Array.from(s.querySelectorAll('.list-row .title')).map((t) => t.textContent),
        units: Array.from(s.querySelectorAll('.unit-group-title')).map((t) => t.textContent)
      }))
    )
    check(
      'por defecto, Entregas agrupa por asignatura, en el orden de Asignaturas',
      groupsInfo.map((g) => g.name).join(' | ') === 'Programación | Lenguajes de marcas y sistemas de gestión de información',
      groupsInfo.map((g) => g.name).join(' | ')
    )
    check(
      'dentro de cada asignatura, agrupa por unidad, en orden de unidad',
      JSON.stringify(groupsInfo.map((g) => g.units)) ===
        JSON.stringify([['1. Estructuras de control', '3. Arrays', '4. Funciones'], []]),
      JSON.stringify(groupsInfo.map((g) => g.units))
    )
    check(
      'cada actividad va en su asignatura y su unidad, ordenada por fecha',
      JSON.stringify(groupsInfo.map((g) => g.rows)) ===
        JSON.stringify([
          ['Tasca 3: bucles', 'Ejercicio 3: bucles', 'Tarea 4: arrays', 'Tarea 4: arrays', 'Tarea 5: funciones'],
          ['Práctica 2: formulario accesible']
        ]),
      JSON.stringify(groupsInfo.map((g) => g.rows))
    )
    check(
      'el título de cada grupo dice cuántas entregas tiene',
      /5 entregas/.test((await win.locator('.subject-group[data-subject="Programación"] .subject-group-title').textContent()) || '')
    )
    await win.screenshot({ path: path.join(S, 'shots', 'entregas-por-asignatura.png') })
    await win.selectOption('select[name="grouping"]', 'fecha')
    check(
      '«Todas por fecha» vuelve a la lista única',
      (await win.locator('.subject-group').count()) === 0 && (await win.locator('.list-row').count()) === 6
    )
    await win.click('.sidebar nav button:has-text("Panel")')
    await win.click('.sidebar nav button:has-text("Entregas")')
    check('recuerda la forma de agrupar elegida', (await win.locator('select[name="grouping"]').inputValue()) === 'fecha')
    await win.selectOption('select[name="grouping"]', 'asignatura')

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

    // --- Colores según se acerca el plazo (en una asignatura sin más entregas) ---
    const plus = (n) => {
      const d = new Date(Date.now() + n * 86400000)
      const p2 = (v) => String(v).padStart(2, '0')
      return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
    }
    const urgentCases = [
      ['U-tiempo de sobra', 10, 'pendiente', 'later'],
      ['U-esta semana', 5, 'pendiente', 'week'],
      ['U-en dos días', 2, 'en curso', 'soon'],
      ['U-hoy', 0, 'pendiente', 'today'],
      ['U-ayer', -1, 'pendiente', 'over'],
      ['U-ya entregada', 1, 'entregada', 'done']
    ]
    await win.evaluate(
      async ([cases, dates]) => {
        const subs = await window.api.subjects.list()
        const ed = subs.find((x) => x.name === 'Entornos de desarrollo').id
        for (const [title, , status] of cases) {
          await window.api.items.save({ subject_id: ed, kind: 'ejercicio', title, status, due_date: dates[title] })
        }
      },
      [urgentCases, Object.fromEntries(urgentCases.map(([t, n]) => [t, plus(n)]))]
    )
    await win.click('.sidebar nav button:has-text("Panel")')
    await win.click('.sidebar nav button:has-text("Entregas")')
    await win.waitForSelector('.subject-group[data-subject="Entornos de desarrollo"]')
    const urg = await win
      .locator('.subject-group[data-subject="Entornos de desarrollo"] .list-row')
      .evaluateAll((rows) =>
        rows.map((r) => ({
          title: r.querySelector('.title').textContent,
          u: r.getAttribute('data-urgency'),
          // En Entregas son tarjetas: el color del plazo va en la barra de arriba.
          border: getComputedStyle(r).borderTopColor
        }))
      )
    const wrong = urgentCases.filter(([t, , , u]) => (urg.find((r) => r.title === t) || {}).u !== u)
    check(
      'cada entrega toma el color de lo que falta para su plazo',
      wrong.length === 0,
      wrong.length ? `fallan: ${wrong.map((w) => w[0]).join(', ')}` : urg.map((r) => `${r.title}=${r.u}`).join(', ')
    )
    const colorOf = (t) => (urg.find((r) => r.title === t) || {}).border
    check(
      'los colores son distintos según se acerca el plazo',
      new Set(['U-tiempo de sobra', 'U-esta semana', 'U-en dos días', 'U-hoy', 'U-ayer'].map(colorOf)).size === 5
    )
    check('la leyenda explica los colores', (await win.locator('.urg-legend span').count()) === 6)
    await win.screenshot({ path: path.join(S, 'shots', 'colores-plazo.png') })

    // --- Disposición: menú en pestañas arriba y Panel en tablero ---
    const bar = await win.locator('.sidebar').boundingBox()
    const viewport = await win.evaluate(() => ({ w: window.innerWidth }))
    check('el menú es una barra arriba, a lo ancho', bar.y === 0 && bar.width >= viewport.w - 2 && bar.height < 80, JSON.stringify(bar))
    check('las pestañas llevan icono', (await win.locator('.sidebar nav button svg.nav-icon:visible').count()) === 5)
    await win.click('.sidebar nav button:has-text("Panel")')
    await win.waitForSelector('.dash-recent')
    const soonBox = await win.locator('.dash-soon').boundingBox()
    const recentBox = await win.locator('.dash-recent').boundingBox()
    check(
      'Panel en tablero: los últimos ficheros van en una columna a la derecha',
      recentBox.x > soonBox.x + soonBox.width - 1,
      `próximas x=${Math.round(soonBox.x)} · recientes x=${Math.round(recentBox.x)}`
    )
    await win.screenshot({ path: path.join(S, 'shots', 'panel-tablero.png') })

    // --- Editar desde la ficha lateral (antes «Editar» solo cerraba la ficha) ---
    await win.click('.sidebar nav button:has-text("Entregas")')
    await win.click('.list-row:has-text("U-hoy")')
    await win.waitForSelector('.detail-pane')
    await win.click('.detail-pane button:has-text("Editar")')
    await win.waitForSelector('.modal input[name="title"]')
    await win.fill('.modal input[name="title"]', 'U-hoy (editada)')
    await win.click('.modal button:has-text("Guardar")')
    await win.waitForSelector('.modal', { state: 'detached' })
    await win.waitForSelector('.detail-pane-head h3:has-text("U-hoy (editada)")', { timeout: 5000 })
    check('«Editar» abre el formulario y la ficha muestra el cambio', true)
    await win.click('.detail-pane button:has-text("Cerrar")')

    // --- Borrar una actividad: sus ficheros van a la papelera ---
    const p2 = await win.evaluate(async () => (await window.api.items.list({ text: 'Práctica 2' }))[0])
    const p2File = (await win.evaluate((id) => window.api.files.list(id), p2.id))[0]
    check('la actividad a borrar tiene su fichero descargado', !!p2File && fs.existsSync(p2File.path), p2File && p2File.path)
    await win.click('.list-row:has-text("Práctica 2")')
    await win.waitForSelector('.detail-pane')
    await win.click('.detail-pane button:has-text("Borrar elemento")')
    await win.waitForSelector('.modal input[name="trash_files"]')
    check('al borrar, por defecto se envían sus ficheros a la papelera', await win.locator('.modal input[name="trash_files"]').isChecked())
    await win.click('.modal button:has-text("Borrar")')
    await win.waitForSelector('.modal', { state: 'detached', timeout: 10000 })
    const toast1 = (await win.locator('.toast').textContent().catch(() => '')) || ''
    check('la actividad desaparece de la app', (await win.evaluate(async () => (await window.api.items.list({ text: 'Práctica 2' })).length)) === 0)
    check('su fichero ya no está en la carpeta (está en la papelera)', !fs.existsSync(p2File.path), `${p2File.path} · aviso: ${toast1}`)
    check(
      'y se quita la carpeta de descargas que había quedado vacía',
      !fs.existsSync(path.dirname(p2File.path)) && !fs.existsSync(path.join(descargas, 'LM')),
      path.dirname(p2File.path)
    )
    check('la ficha lateral se cierra', (await win.locator('.detail-pane').count()) === 0)

    // Borrar sin enviar a la papelera: los ficheros se quedan en su carpeta.
    await win.click('.list-row:has-text("Ejercicio 3: bucles")')
    await win.waitForSelector('.detail-pane')
    await win.click('.detail-pane button:has-text("Borrar elemento")')
    await win.waitForSelector('.modal input[name="trash_files"]')
    await win.uncheck('.modal input[name="trash_files"]')
    await win.click('.modal button:has-text("Borrar")')
    await win.waitForSelector('.modal', { state: 'detached', timeout: 10000 })
    check(
      'si desmarcas la casilla, los ficheros se quedan en la carpeta',
      (await win.evaluate(async () => (await window.api.items.list({ text: 'Ejercicio 3' })).length)) === 0 &&
        fs.existsSync(javaFile) && fs.existsSync(renamedTxt)
    )

    // --- Entregas: nombres de asignatura algo más grandes y asignaturas plegables ---
    const waitFor = async (cond) => {
      for (let i = 0; i < 40; i++) {
        if (await cond()) return true
        await sleep(100)
      }
      return false
    }
    await win.click('.sidebar nav button:has-text("Panel")')
    await win.click('.sidebar nav button:has-text("Entregas")')
    await win.waitForSelector('.subject-group')
    const titleSize = await win.locator('.subject-group-title').first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
    check('los nombres de las asignaturas son un poco más grandes (17 px)', titleSize === 17, `${titleSize}px`)
    const proGroup = '.subject-group[data-subject="Programación"]'
    const proCards = () => win.locator(`${proGroup} .list-row`).count()
    const proBefore = await proCards()
    await win.click(`${proGroup} .group-toggle`)
    check('al pulsar el nombre, la asignatura se pliega', proBefore > 0 && (await proCards()) === 0, `${proBefore} → ${await proCards()}`)
    check(
      'plegada, la cabecera sigue diciendo cuántas tiene',
      new RegExp(`${proBefore} entregas`).test((await win.locator(`${proGroup} .subject-group-title`).textContent()) || '')
    )
    await win.click('.sidebar nav button:has-text("Panel")')
    await win.click('.sidebar nav button:has-text("Entregas")')
    await win.waitForSelector(proGroup)
    check('recuerda qué asignaturas dejaste plegadas', (await proCards()) === 0)
    await win.click(`${proGroup} .group-toggle`)
    check('y se vuelve a desplegar', (await proCards()) === proBefore)
    await win.click('button:has-text("Plegar todas")')
    check('«Plegar todas» las pliega todas', (await win.locator('.subject-group .list-row').count()) === 0)
    await win.click('button:has-text("Desplegar todas")')
    check('«Desplegar todas» las despliega', (await win.locator('.subject-group .list-row').count()) > 0)

    // --- Seleccionar entregas y actuar sobre ellas ---
    const card = (t) => `.list-row:has-text("${t}")`
    const getItem = (t) => win.evaluate(async (text) => (await window.api.items.list({ text }))[0], t)
    const barText = async () => (await win.locator('.bulk-bar').textContent()) || ''
    await win.click('.deliv-main button:text-is("Seleccionar")')
    await win.waitForSelector('.bulk-bar')
    await win.click(card('U-tiempo de sobra'))
    await win.click(card('U-esta semana'))
    check(
      'en modo selección, pulsar las tarjetas las marca (sin abrir la ficha)',
      (await win.locator('.list-row.is-checked').count()) === 2 && (await win.locator('.detail-pane').count()) === 0
    )
    check('la barra dice cuántas hay seleccionadas', /2 seleccionadas/.test(await barText()))
    check('«Añadir nota» está desactivado con más de una', await win.locator('.bulk-bar button:has-text("Añadir nota")').isDisabled())
    await win.screenshot({ path: path.join(S, 'shots', 'seleccion.png') })

    await win.selectOption('select[name="bulk_status"]', 'entregada')
    await waitFor(async () => (await getItem('U-esta semana')).status === 'entregada')
    check(
      'cambiar el estado de varias a la vez',
      (await getItem('U-tiempo de sobra')).status === 'entregada' && (await getItem('U-esta semana')).status === 'entregada'
    )
    check('la selección se mantiene tras una acción', /2 seleccionadas/.test(await barText()))

    await win.click('.bulk-bar button:has-text("Añadir etiqueta")')
    await win.fill('.modal input[name="bulk_tag"]', 'repaso')
    await win.click('.modal button:has-text("Añadir")')
    await win.waitForSelector('.modal', { state: 'detached' })
    check(
      'añadir una etiqueta a varias a la vez',
      (await getItem('U-tiempo de sobra')).tags.includes('repaso') && (await getItem('U-esta semana')).tags.includes('repaso')
    )

    await win.click(card('U-esta semana'))
    check('con una sola seleccionada, «Añadir nota» se activa', !(await win.locator('.bulk-bar button:has-text("Añadir nota")').isDisabled()))
    await win.click('.bulk-bar button:has-text("Añadir nota")')
    await win.fill('.modal input[name="bulk_grade"]', '7,5')
    await win.click('.modal button:has-text("Guardar nota")')
    await win.waitForSelector('.modal', { state: 'detached' })
    check('añadir nota a la seleccionada (acepta coma decimal)', (await getItem('U-tiempo de sobra')).grade === 7.5)

    // Cambiar de asignatura: «Tarea 5» está en la unidad 4 de Programación; Sistemas no tiene unidad 4.
    await win.click(card('Tarea 5: funciones'))
    await win.selectOption('select[name="bulk_subject"]', idOf('Sistemas informáticos'))
    await waitFor(async () => String((await getItem('Tarea 5')).subject_id) === idOf('Sistemas informáticos'))
    const t5 = await getItem('Tarea 5')
    const ut = await getItem('U-tiempo de sobra')
    check(
      'cambiar de asignatura a varias a la vez',
      String(t5.subject_id) === idOf('Sistemas informáticos') && String(ut.subject_id) === idOf('Sistemas informáticos')
    )
    check('si la nueva asignatura no tiene su unidad, queda sin unidad (nunca apunta a otra asignatura)', t5.unit_id === null)

    await win.click('.bulk-bar button:has-text("Eliminar")')
    await win.waitForSelector('.modal:has-text("¿Eliminar 2 entregas?")')
    await win.click('.modal button.danger-solid')
    await win.waitForSelector('.modal', { state: 'detached' })
    check('eliminar varias a la vez', !(await getItem('U-tiempo de sobra')) && !(await getItem('Tarea 5')))
    check('tras eliminarlas, la selección queda vacía', /Ninguna seleccionada/.test(await barText()))

    const edGroup = '.subject-group[data-subject="Entornos de desarrollo"]'
    await win.check(`${edGroup} .group-check`)
    const edCards = await win.locator(`${edGroup} .list-row`).count()
    check(
      'la casilla de la asignatura selecciona todas las suyas',
      edCards > 0 && (await win.locator(`${edGroup} .list-row.is-checked`).count()) === edCards,
      `${edCards} tarjetas`
    )
    await win.keyboard.press('Escape')
    check('Escape sale del modo selección', (await win.locator('.bulk-bar').count()) === 0 && (await win.locator('.list-row.is-checked').count()) === 0)

    // --- Importar una asignatura entera desde su enlace ---
    const courseUrl = `${base}/course/view.php?id=55`
    await win.click('.sidebar nav button:has-text("Entregas")')
    await win.click('button:has-text("Importar desde enlace")')
    await win.fill('.modal input[name="activity_url"]', courseUrl)
    const courseLoginP = app.waitForEvent('window')
    await win.click('.modal button[type="submit"]')
    // Antes se cerró la sesión: la plataforma vuelve a pedir el login.
    const courseLogin = await courseLoginP
    await courseLogin.waitForSelector('input[type="password"]')
    await courseLogin.fill('input[name="username"]', 'alumne')
    await courseLogin.fill('input[type="password"]', 'secret')
    await courseLogin.click('#loginbtn')
    await win.waitForSelector('.modal .course-sections', { timeout: 30000 })
    check('reconoce el enlace de una asignatura entera y lee sus unidades', true)
    const units = await win.locator('.modal .course-section').evaluateAll((els) => els.map((e) => e.getAttribute('data-unit')))
    check(
      'cada sección del curso es una unidad (la «General» queda sin unidad)',
      JSON.stringify(units) ===
        JSON.stringify(['Sin unidad', 'Unidad 1 · Estructures de control', 'Unidad 3 · Arrays', 'Unidad 5 · Fitxers']),
      JSON.stringify(units)
    )
    const courseText = (await win.locator('.modal').textContent()) || ''
    check('ignora los foros de avisos y las etiquetas de texto', !courseText.includes('Avisos') && !courseText.includes('Llegiu els apunts'))
    check('lo que ya está en la app sale marcado y no se repite', (await win.locator('.modal .course-act.exists').count()) === 2)
    check(
      'reconoce la asignatura por el nombre del curso',
      (await win.locator('.modal select[name="course_subject"]').inputValue()) === idOf('Programación')
    )
    const importBtn = win.locator('.modal button.primary')
    check('marca las 7 actividades nuevas', /Importar 7 actividades/.test((await importBtn.textContent()) || ''), await importBtn.textContent())
    await win.uncheck('.modal input[name="type_enlaces"]')
    check('se puede desmarcar un tipo entero (enlaces)', /Importar 6 actividades/.test((await importBtn.textContent()) || ''))
    await win.check('.modal input[name="type_enlaces"]')
    await win.screenshot({ path: path.join(S, 'shots', 'asignatura-revision.png') })
    await importBtn.click()
    await win.waitForSelector('.modal h3:has-text("Asignatura importada")', { timeout: 90000 })
    const done = await win.locator('.modal [data-result="hecha"]').count()
    const problems = await win.locator('.modal [data-result="error"], .modal [data-result="aviso"]').allTextContents()
    check('importa las 7 en orden, sin errores', done === 7 && problems.length === 0, problems.join(' | ') || `${done} hechas`)
    await win.screenshot({ path: path.join(S, 'shots', 'asignatura-importada.png') })
    await win.click('.modal button:has-text("Cerrar")')

    const it = (t) => win.evaluate(async (text) => (await window.api.items.list({ text }))[0], t)
    const filesOf = (id) => win.evaluate((x) => window.api.files.list(x), id)
    const proId = idOf('Programación')
    const prog = await it('Programació didàctica')
    const progFiles = prog ? await filesOf(prog.id) : []
    check(
      'un fichero de la sección General → apunte sin unidad, con el PDF descargado',
      prog && prog.kind === 'apunte' && prog.unit_id === null && progFiles.length === 1 && progFiles[0].name === 'programacio-didactica.pdf' && fs.existsSync(progFiles[0].path),
      progFiles.map((f) => f.name).join(', ')
    )
    const apunts = await it('Apunts tema 1')
    check(
      '«Unitat 1» va a la unidad 1 que ya existía (aunque esté en castellano)',
      apunts && apunts.unit_number === 1 && apunts.unit_title === 'Estructuras de control' && String(apunts.subject_id) === proId,
      apunts && `${apunts.unit_number}. ${apunts.unit_title}`
    )
    const docs = await it('Documentació Java')
    check('un enlace se guarda como enlace', docs && docs.kind === 'enlace' && docs.unit_number === 1)
    const folder = await it('Exercicis resolts')
    const folderFiles = folder ? await filesOf(folder.id) : []
    check(
      'una carpeta se descarga entera en un .zip',
      folder && folder.kind === 'apunte' && folderFiles.length === 1 && folderFiles[0].name === 'Exercicis resolts.zip',
      folderFiles.map((f) => f.name).join(', ')
    )
    const quizItem = (await win.evaluate(async () => (await window.api.items.list({ text: 'Qüestionari' }))[0]))
    check(
      'un cuestionario → examen en la unidad 3, con su fecha de cierre («Tanca»)',
      quizItem && quizItem.kind === 'examen' && quizItem.unit_number === 3 && quizItem.due_date === '2026-12-11',
      quizItem && `${quizItem.kind} · ${quizItem.unit_number} · ${quizItem.due_date}`
    )
    const pageItem = await win.evaluate(async () => (await window.api.items.list({ text: 'Resum' }))[0])
    check('una página → apunte con su texto en las notas', pageItem && pageItem.kind === 'apunte' && /col·lecció/.test(pageItem.notes || ''))
    const t6 = await it('Tasca 6')
    check(
      'una tarea nueva → ejercicio pendiente con su fecha, en la unidad 5 creada («Fitxers»)',
      t6 && t6.kind === 'ejercicio' && t6.status === 'pendiente' && t6.due_date === '2026-12-16' && t6.unit_number === 5 && t6.unit_title === 'Fitxers',
      t6 && `${t6.status} · ${t6.due_date} · ${t6.unit_number}. ${t6.unit_title}`
    )
    const unitsNow = await proUnits()
    check(
      'no duplica unidades: solo añade la 5',
      JSON.stringify(unitsNow) === JSON.stringify(['1. Estructuras de control', '3. Arrays', '4. Funciones', '5. Fitxers']),
      unitsNow.join(' | ')
    )
    check(
      'no repite las tareas que ya estaban',
      (await win.evaluate(async () => (await window.api.items.list({ text: 'Tasca 3' })).length)) === 1 &&
        (await win.evaluate(async () => (await window.api.items.list({ text: 'Tarea 4' })).length)) === 2
    )

    // Volver a importar la misma asignatura: todo está ya, no se repite nada.
    await win.click('button:has-text("Importar desde enlace")')
    await win.fill('.modal input[name="activity_url"]', courseUrl)
    await win.click('.modal button[type="submit"]')
    await win.waitForSelector('.modal .course-sections', { timeout: 30000 })
    check(
      'al repetirlo, todo sale como «ya en la app» y no hay nada que importar',
      (await win.locator('.modal .course-act.exists').count()) === 9 && (await win.locator('.modal button.primary').isDisabled())
    )
    await win.click('.modal button:has-text("Cancelar")')

    // --- Seleccionar apuntes dentro de una asignatura ---
    const proSid = Number(idOf('Programación'))
    const apuntesPro = () => win.evaluate((sid) => window.api.items.list({ subject_id: sid, kind: 'apunte' }), proSid)
    await win.click('.sidebar nav button:has-text("Asignaturas")')
    await win.click('.subject-card:has-text("Programación") button:has-text("Abrir")')
    await win.waitForSelector('h1:has-text("Programación")')
    await win.selectOption('select[name="kind_filter"]', 'apunte')
    await waitFor(async () => (await win.locator('.list-row').count()) === 4)
    check('en la asignatura, el filtro deja solo sus 4 apuntes', (await win.locator('.list-row').count()) === 4)
    await win.click('.page button:text-is("Seleccionar")')
    await win.waitForSelector('.bulk-bar')
    await win.click('button:has-text("Seleccionar todos")')
    check('«Seleccionar todos» marca los apuntes filtrados', /4 seleccionadas/.test(await barText()), await barText())
    check('los apuntes muestran su casilla marcada', (await win.locator('.list-row.is-checked').count()) === 4)
    await win.screenshot({ path: path.join(S, 'shots', 'asignatura-seleccion.png') })

    const arraysUnit = (await win.evaluate((sid) => window.api.units.list(sid), proSid)).find((u) => u.title === 'Arrays')
    await win.selectOption('select[name="bulk_unit"]', String(arraysUnit.id))
    await waitFor(async () => (await apuntesPro()).every((i) => i.unit_title === 'Arrays'))
    const moved = await apuntesPro()
    check(
      '«Cambiar de unidad» mueve los apuntes seleccionados',
      moved.length === 4 && moved.every((i) => i.unit_title === 'Arrays'),
      moved.map((i) => `${i.title}→${i.unit_title}`).join(', ')
    )

    await win.click('.bulk-bar button:has-text("Añadir etiqueta")')
    await win.fill('.modal input[name="bulk_tag"]', 'teoría')
    await win.click('.modal button:has-text("Añadir")')
    await win.waitForSelector('.modal', { state: 'detached' })
    check('y se les pone una etiqueta a todos a la vez', (await apuntesPro()).every((i) => i.tags.includes('teoría')))

    await win.click('button:has-text("Quitar selección")')
    check('«Quitar selección» los desmarca', /Ninguna seleccionada/.test(await barText()))
    await win.check('.unit-section h2 .group-check')
    check('la casilla de una unidad marca todos los suyos', /4 seleccionadas/.test(await barText()), await barText())

    // Protección: nada puede ir a una unidad de otra asignatura.
    const bdUnit = await win.evaluate(
      (sid) => window.api.units.save({ subject_id: sid, number: 1, title: 'Modelo relacional' }),
      Number(idOf('Bases de datos'))
    )
    const refused = await win.evaluate(
      ([ids, uid]) => window.api.items.bulkUpdate(ids, { unit_id: uid }).then(() => 'aceptado', (e) => e.message),
      [moved.map((i) => i.id), bdUnit.id]
    )
    check('no deja meter un elemento en una unidad de otra asignatura', /otra asignatura/.test(refused), refused)
    check('y no cambia ninguno (todo o nada)', (await apuntesPro()).every((i) => i.unit_title === 'Arrays'))
    await win.keyboard.press('Escape')
    check('Escape sale del modo selección también aquí', (await win.locator('.bulk-bar').count()) === 0)
    server.close()

    check('sin errores de JavaScript en la interfaz', errors.length === 0, errors.join(' | '))
    await app.close()
  }

  if (!process.env.KEEP_E2E) fs.rmSync(S, { recursive: true, force: true })
  else console.log('resultados en', S)
  console.log(failures ? `\n${failures} comprobación(es) fallidas` : '\nTodo correcto')
  process.exit(failures ? 1 : 0)
})()
