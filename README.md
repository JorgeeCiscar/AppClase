# AppClase

Aplicación de escritorio para tener el curso en un solo sitio: asignaturas, temas,
entregas y **todos los ficheros de clase indexados por su ruta**, para abrirlos y
editarlos con los programas que ya tienes instalados.

**Stack:** Electron · React · TypeScript · Vite (electron-vite) · SQLite (`node:sqlite`, integrado en Electron)

## La idea

Los ficheros **no se copian ni se mueven**: la app guarda dónde están. Así el PDF de
apuntes sigue en su carpeta, el `.java` sigue dentro de tu proyecto, y AppClase es solo
la capa que los organiza y te los encuentra. Al pulsar **Abrir** se abren con la
aplicación que el sistema tenga asociada, se editan ahí y la app detecta el cambio.

## Funcionalidades (v0.1)

- **Asignaturas** con color, abreviatura y profesor. Al crear la base de datos se siembran
  los seis módulos de 1º de DAW; son editables y se pueden borrar o añadir otros.
- **Temas** numerados dentro de cada asignatura.
- **Elementos** de cinco tipos: apunte, enunciado, ejercicio, examen y enlace. Con notas,
  enlace a Aules/Moodle/Classroom, etiquetas y, si son entregables, **fecha límite,
  estado** (pendiente → en curso → entregada → corregida) **y nota**.
- **Ficheros** añadidos por diálogo, por carpeta entera o **arrastrándolos** desde el
  explorador. Se guarda la ruta, el tamaño y la fecha de modificación.
- **Abrir con la aplicación del sistema** (`shell.openPath`), **mostrar en la carpeta** y un
  menú **«Abrir con»** con los programas que configures en Ajustes (por ejemplo VS Code).
- **Control de cambios**: al volver a la ventana, o con «Comprobar ficheros», se relee el
  disco. Si editaste un fichero fuera, se actualiza su fecha; si lo moviste o borraste,
  queda marcado como **«no se encuentra»** y se puede **volver a localizar** sin perder
  etiquetas ni notas.
- **Panel** con lo que está fuera de plazo, lo que vence en dos semanas y los últimos
  ficheros añadidos.
- **Entregas**: todo lo que tiene fecha límite, filtrable por estado y por fuera de plazo.
- **Búsqueda global** (`Ctrl+K`) de asignaturas, elementos, nombres de fichero y etiquetas,
  y opcionalmente **dentro del contenido** de los ficheros de texto indexados
  (`.java`, `.sql`, `.html`, `.md`, `.txt`…), con el número de línea y la línea encontrada.

## Desarrollo

```bash
npm install
npm run dev          # arranca la app con recarga en caliente
npm run typecheck
npm run test:e2e     # prueba de extremo a extremo con Playwright
npm run dist:win     # genera dist/AppClase-Setup-<versión>.exe
```

- En Linux sin pantalla: `xvfb-run -a npm run test:e2e`. `KEEP_E2E=1` conserva el
  directorio temporal con la base de datos y las capturas.
- `scripts/demo.cjs <carpeta>` siembra datos de ejemplo y guarda capturas de la app.
- `dist:win` desde Linux necesita Wine; en Windows funciona directamente.

## Estructura

```
src/
  main/       proceso principal: base de datos, IPC y gestión de ficheros
    db.ts       esquema, migraciones y siembra de las asignaturas
    files.ts    indexar rutas, abrir con el sistema, revalidar y buscar en contenido
    ipc.ts      handlers de asignaturas, temas, elementos, ficheros, búsqueda y ajustes
  preload/    puente seguro (contextBridge) → window.api
  renderer/   interfaz en React
  shared/     tipos compartidos entre procesos
scripts/      prueba E2E y generador de capturas
```

## Datos

La base de datos se guarda en la carpeta de datos de usuario de Electron
(`%APPDATA%/AppClase/datos/appclase.db` en Windows). Se puede cambiar con la variable
de entorno `APPCLASE_DATA_DIR`, que es lo que usa la prueba E2E.

Borrar un elemento o una asignatura **no borra ningún fichero del disco**: solo se
quitan del índice.
