// Siembra datos de ejemplo y toma capturas de la app, para el README o para verla.
// Uso: xvfb-run -a node scripts/demo.cjs <carpeta-de-salida>
const path = require('node:path'); const fs = require('node:fs'); const os = require('node:os')
const { _electron } = require('playwright')
const ROOT = path.resolve(__dirname, '..')
const S = fs.mkdtempSync(path.join(os.tmpdir(), 'appclase-demo-'))
const OUT = process.argv[2]
fs.mkdirSync(path.join(S, 'data')); fs.mkdirSync(path.join(S, 'curso'))
const mk = (n, c) => { const p = path.join(S, 'curso', n); fs.writeFileSync(p, c); return p }
const files = {
  bucles: mk('Ejercicio3_Bucles.java', 'public class Ejercicio3 {\n  // bucle while\n}\n'),
  apuntes: mk('Tema2-Estructuras.pdf', '%PDF-1.4 falso\n'),
  sql: mk('consultas-tema3.sql', 'SELECT nombre FROM alumnos WHERE nota >= 5;\n'),
  html: mk('practica-formulario.html', '<!doctype html><form></form>\n'),
  er: mk('modelo-ER.png', 'png falso'),
  fol: mk('contrato-practicas.docx', 'docx falso')
}
const d = (n) => { const x = new Date(Date.now() + n * 86400000); const p = (v) => String(v).padStart(2, '0'); return `${x.getFullYear()}-${p(x.getMonth()+1)}-${p(x.getDate())}` }

;(async () => {
  const app = await _electron.launch({ executablePath: require('electron'), args: [ROOT, '--no-sandbox'],
    env: { ...process.env, APPCLASE_DATA_DIR: path.join(S, 'data') } })
  const win = await app.firstWindow()
  await win.waitForSelector('.sidebar')
  await win.evaluate(async ([files, dates]) => {
    const subs = await window.api.subjects.list()
    const by = (n) => subs.find((s) => s.name.startsWith(n)).id
    const pro = by('Programación'), bd = by('Bases de datos'), lm = by('Lenguajes'), ed = by('Entornos'), fol = by('Formación')
    const u = async (s, n, t) => (await window.api.units.save({ subject_id: s, number: n, title: t })).id
    const u2 = await u(pro, 2, 'Estructuras de control')
    const u3 = await u(pro, 3, 'Métodos y arrays')
    const ub = await u(bd, 3, 'Consultas SQL')
    const ul = await u(lm, 1, 'HTML y formularios')
    const mk = async (o, paths) => {
      const it = await window.api.items.save(o)
      if (paths) await window.api.files.addPaths(it.id, paths)
      return it
    }
    await mk({ subject_id: pro, unit_id: u2, kind: 'ejercicio', title: 'Ejercicio 3: bucles anidados',
      status: 'en curso', due_date: dates[2], tags: ['bucles', 'entregable'], notes: 'Hacer la tabla de multiplicar con for anidado.' }, [files.bucles])
    await mk({ subject_id: pro, unit_id: u2, kind: 'apunte', title: 'Apuntes del tema 2', tags: ['teoría'] }, [files.apuntes])
    await mk({ subject_id: pro, unit_id: u3, kind: 'examen', title: 'Examen del tema 3', due_date: dates[9], status: 'pendiente' })
    await mk({ subject_id: bd, unit_id: ub, kind: 'ejercicio', title: 'Consultas con JOIN', status: 'pendiente',
      due_date: dates[1], tags: ['sql'] }, [files.sql])
    await mk({ subject_id: bd, unit_id: ub, kind: 'enunciado', title: 'Modelo entidad-relación de la biblioteca',
      status: 'entregada', grade: 8.5, due_date: dates[-6] }, [files.er])
    await mk({ subject_id: lm, unit_id: ul, kind: 'ejercicio', title: 'Práctica: formulario accesible',
      status: 'pendiente', due_date: dates[-3], tags: ['html'] }, [files.html])
    await mk({ subject_id: ed, kind: 'apunte', title: 'Guía de Git y ramas', tags: ['git'] })
    await mk({ subject_id: fol, kind: 'enunciado', title: 'Análisis del contrato de prácticas',
      status: 'corregida', grade: 9, due_date: dates[-12] }, [files.fol])
    await window.api.settings.save({ course_name: '1º DAW · curso 2026/27' })
  }, [files, { 1: d(1), 2: d(2), 9: d(9), '-3': d(-3), '-6': d(-6), '-12': d(-12) }])

  const shot = async (name) => { await win.waitForTimeout(500); await win.screenshot({ path: path.join(OUT, name) }) }
  // El panel se captura al final: hay que salir y volver para que se recargue.
  await win.click('.sidebar nav button:has-text("Asignaturas")')
  await win.waitForSelector('.subject-card'); await shot('2-asignaturas.png')
  await win.click('.subject-card:has-text("Programación") button:has-text("Abrir")')
  await win.waitForSelector('h1:has-text("Programación")'); await shot('3-asignatura.png')
  await win.click('.list-row:has-text("bucles anidados")')
  await win.waitForSelector('.modal .file-row'); await shot('4-elemento-ficheros.png')
  await win.click('.modal button:has-text("Cerrar")')
  await win.click('.sidebar nav button:has-text("Entregas")')
  await win.waitForSelector('.list-row'); await shot('5-entregas.png')
  await win.click('.sidebar nav button:has-text("Panel")')
  await win.waitForSelector('.stats'); await shot('1-panel.png')
  await app.close()
  fs.rmSync(S, { recursive: true, force: true })
  console.log('capturas en', OUT)
})()
