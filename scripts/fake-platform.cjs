// Plataforma falsa con el comportamiento de Moodle/Aules, para la prueba E2E:
// - pide iniciar sesión y, tras entrar, te deja en la portada (no en la actividad),
// - la tarea está dentro de <div class="activity-header" data-for="page-activity-header">,
// - id=7: calificada, en valenciano, con texto, imagen y adjuntos del profesor, un
//   fichero fuera de la cabecera que no debe recogerse, y tu archivo enviado,
// - id=8: enviada para calificar (sin calificar), en castellano, solo texto, unidad «UD 3 - Arrays»,
//   con una entrega tuya que no se recoge,
// - id=9: borrador, unidad como texto sin enlace y un enunciado que dice «será calificado»,
// - los adjuntos solo se descargan con la sesión iniciada.
// Además sirve una página genérica (no Moodle, sin cabecera) en castellano.
const http = require('node:http')

const page = (title, bodyClass, body) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>` +
  `<body class="${bodyClass}">${body}</body></html>`

const LOGIN = page(
  'Accés',
  'pagelayout-login',
  `<form method="post" action="/login/index.php">
     <input name="username" placeholder="Usuari">
     <input type="password" name="password" placeholder="Contrasenya">
     <button id="loginbtn" type="submit">Accedeix</button>
   </form>`
)

const DASHBOARD = page('Àrea personal', 'pagelayout-mydashboard', '<div id="region-main"><h2>Àrea personal</h2></div>')

// Tarea CALIFICADA, en valenciano, con la estructura de Moodle 4: la tarea está en
// <div class="activity-header" data-for="page-activity-header">.
const ASSIGN = page(
  'Programació (1r DAW): Tasca 3: bucles',
  'path-mod-assign pagelayout-incourse',
  `<nav aria-label="Barra de navegació"><ol class="breadcrumb">
     <li><a href="/course/view.php?id=55">Programació (1r DAW)</a></li>
     <li><a href="/course/section.php?id=201">Unitat 1: Estructures de control</a></li>
     <li><a href="/mod/assign/view.php?id=7">Tasca 3: bucles</a></li>
   </ol></nav>
   <div id="page-header"><div class="page-header-headings"><h1>Tasca 3: bucles</h1></div></div>
   <div id="region-main">
     <div class="activity-header" data-for="page-activity-header">
       <span class="sr-only">Requisits de compleció</span>
       <div data-region="activity-information" class="activity-information">
         <div class="completion-info" data-region="completionrequirements">
           <div class="badge">Fet: Rebre una qualificació</div>
         </div>
         <div data-region="activity-dates" class="activity-dates">
           <div><strong>Obertura:</strong> dilluns, 10 de novembre de 2026, 00:00</div>
           <div><strong>Venciment:</strong> divendres, 21 de novembre de 2026, 23:59</div>
         </div>
       </div>
       <div class="activity-description" id="intro">
         <div class="no-overflow">
           <p>Feu els exercicis de bucles del full adjunt.</p>
           <p>Entregueu un únic fitxer .zip amb el codi.</p>
           <img src="/pluginfile.php/123/mod_assign/intro/diagrama.png" alt="Diagrama del bucle">
         </div>
         <div id="assign_files_tree1"><ul>
           <li><a href="/pluginfile.php/123/mod_assign/introattachment/0/enunciat%20tasca%203.pdf?forcedownload=1">enunciat tasca 3.pdf</a></li>
           <li><a href="/pluginfile.php/123/mod_assign/introattachment/0/Plantilla.java?forcedownload=1">Plantilla.java</a></li>
         </ul></div>
       </div>
     </div>
     <p>Horari del grup: <a href="/pluginfile.php/999/block_html/content/horari.pdf">horari.pdf</a></p>
     <table class="generaltable submissionstatustable">
       <tr><th>Estat de la tramesa</th><td>Tramés per a qualificació</td></tr>
       <tr><th>Estat de la qualificació</th><td>Qualificat</td></tr>
       <tr><th>Tramesa de fitxers</th><td><a href="/pluginfile.php/123/assignsubmission_file/submission_files/9/mi-entrega.zip?forcedownload=1">mi-entrega.zip</a></td></tr>
     </table>
   </div>`
)

// Tarea SIN CALIFICAR, en castellano, solo con texto (sin adjuntos del profesor),
// pero con una entrega tuya que no debe recogerse porque no está calificada.
const ASSIGN_TEXT = page(
  'Programación (1º DAW): Tarea 4: arrays',
  'path-mod-assign pagelayout-incourse',
  `<nav aria-label="Ruta de navegación"><ol class="breadcrumb">
     <li><a href="/course/view.php?id=56">Programación (1º DAW)</a></li>
     <li><a href="/course/view.php?id=56#section-3">UD 3 - Arrays</a></li>
     <li><a href="/mod/assign/view.php?id=8">Tarea 4: arrays</a></li>
   </ol></nav>
   <div id="page-header"><div class="page-header-headings"><h1>Tarea 4: arrays</h1></div></div>
   <div id="region-main">
     <div class="activity-header" data-for="page-activity-header">
       <div data-region="activity-information" class="activity-information">
         <div class="completion-info" data-region="completionrequirements">
           <div class="badge">Para hacer: Recibir una calificación</div>
         </div>
         <div data-region="activity-dates" class="activity-dates">
           <div><strong>Apertura:</strong> lunes, 16 de noviembre de 2026, 00:00</div>
           <div><strong>Pendiente:</strong> lunes, 30 de noviembre de 2026, 23:59</div>
         </div>
       </div>
       <div class="activity-description" id="intro">
         <div class="no-overflow">
           <p>Declara un array de 10 enteros y muestra la suma de sus elementos.</p>
         </div>
       </div>
     </div>
     <table class="generaltable submissionstatustable">
       <tr><th>Estado de la entrega</th><td>Enviado para calificar</td></tr>
       <tr><th>Estado de la calificación</th><td>Sin calificar</td></tr>
       <tr><th>Envío de archivos</th><td><a href="/pluginfile.php/124/assignsubmission_file/submission_files/10/entrega-arrays.zip?forcedownload=1">entrega-arrays.zip</a></td></tr>
     </table>
   </div>`
)

// Tarea en BORRADOR, en castellano: la unidad aparece en la ruta como texto sin enlace,
// y el enunciado dice «será calificado» (no debe tomarse por una tarea calificada).
const ASSIGN_DRAFT = page(
  'Programación (1º DAW): Tarea 5: funciones',
  'path-mod-assign pagelayout-incourse',
  `<nav aria-label="Ruta de navegación"><ol class="breadcrumb">
     <li><a href="/course/view.php?id=56">Programación (1º DAW)</a></li>
     <li><span>Tema 4. Funciones</span></li>
     <li><a href="/mod/assign/view.php?id=9">Tarea 5: funciones</a></li>
   </ol></nav>
   <div id="page-header"><div class="page-header-headings"><h1>Tarea 5: funciones</h1></div></div>
   <div id="region-main">
     <div class="activity-header" data-for="page-activity-header">
       <div data-region="activity-information" class="activity-information">
         <div class="completion-info" data-region="completionrequirements">
           <div class="badge">Para hacer: Hacer un envío</div>
         </div>
         <div data-region="activity-dates" class="activity-dates">
           <div><strong>Pendiente:</strong> viernes, 4 de diciembre de 2026, 23:59</div>
         </div>
       </div>
       <div class="activity-description" id="intro">
         <div class="no-overflow"><p>Escribe una función que calcule el factorial. Este ejercicio será calificado sobre 10.</p></div>
       </div>
     </div>
     <table class="generaltable submissionstatustable">
       <tr><th>Estado de la entrega</th><td>Borrador (no enviado)</td></tr>
       <tr><th>Estado de la calificación</th><td>Sin calificar</td></tr>
     </table>
   </div>`
)

const GENERIC = page(
  'Lenguajes de marcas | Práctica 2: formulario',
  '',
  `<main>
     <h1>Práctica 2: formulario accesible</h1>
     <p>Haz un formulario accesible con etiquetas y validación.</p>
     <p>Fecha límite: 05/12/2026</p>
     <p><a href="/docs/practica2.pdf">Enunciado de la práctica</a></p>
     <p><a href="https://example.com/">Un enlace que no es un fichero</a></p>
   </main>`
)

// Una ASIGNATURA ENTERA (página del curso, como en Aules con el formato «Temas»):
// sección General con un foro (se ignora) y la programación; unidades con tareas,
// ficheros, un enlace, una carpeta, un cuestionario y una página. Las tareas 7 y 8
// ya estarán importadas cuando se lea.
const act = (mod, id, name, kind) =>
  `<li class="activity ${mod} modtype_${mod}"><a class="aalink" href="/mod/${mod}/view.php?id=${id}">` +
  `<span class="instancename">${name}<span class="accesshide"> ${kind}</span></span></a></li>`
const section = (n, title, items) =>
  `<li class="section course-section" id="section-${n}" data-for="section">` +
  `<h3 class="sectionname" data-for="section_title">${title}</h3><ul class="section">${items.join('')}</ul></li>`
const COURSE = page(
  'Curs: Programació (1r DAW)',
  'path-course-view pagelayout-course',
  `<div id="page-header"><div class="page-header-headings"><h1>Programació (1r DAW)</h1></div></div>
   <div id="region-main"><ul class="topics">
     ${section(0, 'General', [act('forum', 1, 'Avisos', 'Fòrum'), act('resource', 19, 'Programació didàctica', 'Fitxer')])}
     ${section(1, 'Unitat 1: Estructures de control', [
       act('assign', 7, 'Tasca 3: bucles', 'Tasca'),
       act('resource', 20, 'Apunts tema 1', 'Fitxer'),
       act('url', 21, 'Documentació Java', 'URL'),
       act('folder', 22, 'Exercicis resolts', 'Carpeta'),
       '<li class="activity label modtype_label"><div class="contentwithoutlink">Llegiu els apunts abans de la tasca.</div></li>'
     ])}
     ${section(3, 'UD 3 - Arrays', [
       act('assign', 8, 'Tarea 4: arrays', 'Tasca'),
       act('quiz', 30, "Qüestionari d'arrays", 'Qüestionari'),
       act('page', 31, "Resum d'arrays", 'Pàgina')
     ])}
     ${section(5, 'Unitat 5: Fitxers', [act('assign', 32, 'Tasca 6: fitxers', 'Tasca')])}
   </ul></div>`
)

const QUIZ = page(
  "Programació (1r DAW): Qüestionari d'arrays",
  'path-mod-quiz pagelayout-incourse',
  `<div id="page-header"><div class="page-header-headings"><h1>Qüestionari d'arrays</h1></div></div>
   <div id="region-main"><div class="activity-header" data-for="page-activity-header">
     <div data-region="activity-dates" class="activity-dates">
       <div><strong>Obert:</strong> dilluns, 16 de novembre de 2026, 08:00</div>
       <div><strong>Tanca:</strong> divendres, 11 de desembre de 2026, 23:59</div>
     </div>
     <div class="activity-description" id="intro"><p>Qüestionari de 10 preguntes sobre arrays.</p></div>
   </div></div>`
)

const PAGE = page(
  "Programació (1r DAW): Resum d'arrays",
  'path-mod-page pagelayout-incourse',
  `<div id="page-header"><div class="page-header-headings"><h1>Resum d'arrays</h1></div></div>
   <div id="region-main">
     <div class="activity-header" data-for="page-activity-header"></div>
     <div role="main"><div class="box generalbox"><p>Un array és una col·lecció d'elements del mateix tipus.</p></div></div>
   </div>`
)

const ASSIGN6 = page(
  'Programació (1r DAW): Tasca 6: fitxers',
  'path-mod-assign pagelayout-incourse',
  `<nav><ol class="breadcrumb"><li><a href="/course/view.php?id=55">Programació (1r DAW)</a></li>
     <li><a href="/course/section.php?id=205">Unitat 5: Fitxers</a></li></ol></nav>
   <div id="page-header"><div class="page-header-headings"><h1>Tasca 6: fitxers</h1></div></div>
   <div id="region-main">
     <div class="activity-header" data-for="page-activity-header">
       <div data-region="activity-dates" class="activity-dates">
         <div><strong>Venciment:</strong> dimecres, 16 de desembre de 2026, 23:59</div>
       </div>
       <div class="activity-description" id="intro"><p>Llegiu un fitxer de text i compteu les línies.</p></div>
     </div>
     <table class="generaltable submissionstatustable">
       <tr><th>Estat de la tramesa</th><td>No s'ha fet cap intent</td></tr>
     </table>
   </div>`
)

function startFakePlatform() {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://localhost')
    const logged = /(^|;\s*)MoodleSession=ok/.test(req.headers.cookie || '')
    const send = (code, type, body, headers = {}) => {
      res.writeHead(code, { 'Content-Type': type, ...headers })
      res.end(body)
    }
    const toLogin = () => {
      res.writeHead(303, { Location: '/login/index.php' })
      res.end()
    }
    const html = 'text/html; charset=utf-8'

    if (u.pathname === '/login/index.php' && req.method === 'POST') {
      req.resume()
      res.writeHead(303, { 'Set-Cookie': 'MoodleSession=ok; Path=/; HttpOnly', Location: '/my/' })
      return res.end()
    }
    if (u.pathname === '/login/index.php') return send(200, html, LOGIN)
    if (u.pathname === '/my/') return logged ? send(200, html, DASHBOARD) : toLogin()
    if (u.pathname === '/mod/assign/view.php') {
      if (!logged) return toLogin()
      const id = u.searchParams.get('id')
      return send(200, html, id === '8' ? ASSIGN_TEXT : id === '9' ? ASSIGN_DRAFT : id === '32' ? ASSIGN6 : ASSIGN)
    }
    // Asignatura entera y sus actividades.
    if (u.pathname === '/course/view.php') return logged ? send(200, html, COURSE) : toLogin()
    if (u.pathname === '/mod/quiz/view.php') return logged ? send(200, html, QUIZ) : toLogin()
    if (u.pathname === '/mod/page/view.php') return logged ? send(200, html, PAGE) : toLogin()
    if (u.pathname === '/mod/url/view.php') return logged ? send(200, html, page('URL', '', '<a href="https://docs.oracle.com/">Java</a>')) : toLogin()
    if (u.pathname === '/mod/resource/view.php') {
      if (!logged) return toLogin()
      const name = u.searchParams.get('id') === '19' ? 'programacio-didactica.pdf' : 'apunts-tema1.pdf'
      // Con redirect=1, Moodle redirige directamente al fichero.
      if (u.searchParams.get('redirect') === '1') {
        res.writeHead(303, { Location: `/pluginfile.php/500/mod_resource/content/1/${name}` })
        return res.end()
      }
      return send(200, html, page('Fitxer', 'path-mod-resource', `<a href="/pluginfile.php/500/mod_resource/content/1/${name}">${name}</a>`))
    }
    if (u.pathname === '/mod/folder/download_folder.php') {
      if (!logged) return toLogin()
      return send(200, 'application/zip', 'PK\u0003\u0004 carpeta comprimida de prova', {
        'Content-Disposition': 'attachment; filename="Exercicis resolts.zip"'
      })
    }
    if (u.pathname.startsWith('/pluginfile.php/')) {
      if (!logged) return toLogin()
      const name = decodeURIComponent(u.pathname.split('/').pop())
      if (name.endsWith('.pdf')) {
        return send(200, 'application/pdf', '%PDF-1.4 enunciat de prova\n', {
          'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(name)}`
        })
      }
      return send(200, 'application/octet-stream', `contingut de ${name}\n`, {
        'Content-Disposition': `attachment; filename="${name}"`
      })
    }
    if (u.pathname === '/actividad-generica.html') return send(200, html, GENERIC)
    if (u.pathname === '/docs/practica2.pdf') return send(200, 'application/pdf', '%PDF-1.4 practica 2\n')
    send(404, 'text/plain', 'no existe')
  })
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }))
  )
}

module.exports = { startFakePlatform }
