// Plataforma falsa con el comportamiento de Moodle/Aules, para la prueba E2E:
// - pide iniciar sesión y, tras entrar, te deja en la portada (no en la actividad),
// - la tarea está en valenciano, con fecha de apertura y de vencimiento,
// - los adjuntos solo se descargan con la sesión iniciada,
// - hay un fichero «tuyo» (tu entrega) que no debe descargarse.
// Además sirve una página genérica (no Moodle) en castellano.
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

const ASSIGN = page(
  'Programació (1r DAW): Tasca 3: bucles',
  'path-mod-assign pagelayout-incourse',
  `<nav aria-label="Barra de navegació"><ol class="breadcrumb">
     <li><a href="/course/view.php?id=55">Programació (1r DAW)</a></li>
     <li><a href="/mod/assign/view.php?id=7">Tasca 3: bucles</a></li>
   </ol></nav>
   <div id="page-header"><div class="page-header-headings"><h1>Tasca 3: bucles</h1></div></div>
   <div id="region-main">
     <div data-region="activity-dates" class="activity-dates">
       <div><strong>Obertura:</strong> dilluns, 10 de novembre de 2026, 00:00</div>
       <div><strong>Venciment:</strong> divendres, 21 de novembre de 2026, 23:59</div>
     </div>
     <div class="activity-description" id="intro">
       <p>Feu els exercicis de bucles del full adjunt.</p>
       <div><a href="/pluginfile.php/123/mod_assign/introattachment/0/enunciat%20tasca%203.pdf?forcedownload=1">enunciat tasca 3.pdf</a></div>
       <div><a href="/pluginfile.php/123/mod_assign/introattachment/0/Plantilla.java?forcedownload=1">Plantilla.java</a></div>
     </div>
     <table class="generaltable submissionstatustable">
       <tr><th>Estat de la tramesa</th><td>No s'ha fet cap intent</td></tr>
       <tr><th>Fitxers enviats</th><td><a href="/pluginfile.php/123/assignsubmission_file/submission_files/9/mi-entrega.zip?forcedownload=1">mi-entrega.zip</a></td></tr>
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
    if (u.pathname === '/mod/assign/view.php') return logged ? send(200, html, ASSIGN) : toLogin()
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
