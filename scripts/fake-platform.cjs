// Plataforma falsa con el comportamiento de Moodle/Aules, para la prueba E2E:
// - pide iniciar sesión y, tras entrar, te deja en la portada (no en la actividad),
// - la tarea está dentro de <div class="activity-header" data-for="page-activity-header">,
// - id=7: calificada, en valenciano, con texto, imagen y adjuntos del profesor, un
//   fichero fuera de la cabecera que no debe recogerse, y tu archivo enviado,
// - id=8: sin calificar, en castellano, solo texto, con una entrega tuya que no se recoge,
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
      return send(200, html, u.searchParams.get('id') === '8' ? ASSIGN_TEXT : ASSIGN)
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
