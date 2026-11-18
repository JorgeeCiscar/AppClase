# Cursia

(Antes AppClase.) Aplicación de escritorio para tener el curso en un solo sitio: asignaturas, temas,
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
- **Unidades** numeradas dentro de cada asignatura.
- **Seleccionar dentro de una asignatura** (apuntes, ejercicios, enlaces…): «Seleccionar», o la
  casilla de una unidad para marcar todos los suyos; combinado con el filtro de tipo sirve, por
  ejemplo, para elegir todos los apuntes. Mismas acciones que en Entregas y, además, **mover a otra
  unidad** de la asignatura (nunca a una unidad de otra asignatura).
- **Elementos** de cinco tipos: apunte, enunciado, ejercicio, examen y enlace. Con notas,
  enlace a Aules/Moodle/Classroom, etiquetas y, si son entregables, **fecha límite,
  estado** (pendiente → en curso → entregada → corregida) **y nota**.
- **Ficheros** añadidos por diálogo, por carpeta entera o **arrastrándolos** desde el
  explorador. Se guarda la ruta, el tamaño y la fecha de modificación.
- **Abrir con la aplicación del sistema** (`shell.openPath`), **mostrar en la carpeta** y un
  menú **«Abrir con»** con los programas que configures en Ajustes (por ejemplo VS Code).
- **Sincronizada con tus carpetas, en directo**: la app vigila las carpetas de los ficheros
  indexados. Si **editas** un fichero con otro programa, se actualiza al momento; si lo
  **renombras** dentro de su carpeta, lo sigue con el nombre nuevo; si lo **borras**, desaparece
  de la app. Si desaparece la **carpeta entera** (por ejemplo, un USB sin conectar), no se quita:
  queda marcado como **«no se encuentra»** y se puede **volver a localizar**. Además se repasa
  todo cada minuto y al volver a la ventana.
- **Borrar una actividad borra también sus ficheros**: van a la **papelera de reciclaje** (se
  pueden recuperar), salvo los que use también otra actividad, y se quitan las carpetas de
  descarga que queden vacías. Al borrar, una casilla permite conservarlos.
- **Panel** con lo que está fuera de plazo, lo que vence en dos semanas y los últimos
  ficheros añadidos.
- **Entregas**: todo lo que tiene fecha límite, en **tarjetas**; al pulsar una, su **ficha se abre
  al lado** sin tapar las demás (Escape la cierra). Cada asignatura se puede **plegar** pulsando su nombre (o todas a la vez), y
  la app recuerda cuáles dejaste plegadas. Las tarjetas van **agrupadas por asignatura y,
  dentro, por unidad**
  (en el orden de la pestaña Asignaturas, con cuántas hay y cuántas están fuera de plazo) o, si lo
  prefieres, todo junto por fecha; la app recuerda la opción. Filtrable por estado y por fuera de plazo.
- **Seleccionar entregas** («Seleccionar», o la casilla de una asignatura para marcar todas las suyas)
  y actuar sobre ellas a la vez: **eliminar** (con la opción de enviar sus ficheros a la papelera),
  **cambiar de asignatura** (pasan a la unidad equivalente de la nueva o, si no la tiene, quedan sin
  unidad), **cambiar estado**, **añadir etiqueta** y **añadir nota** (esta, con una sola). Escape sale.
- **Colores según el plazo**: cada entrega cambia de color según se acerca su fecha: verde (más de
  una semana), amarillo (esta semana), naranja (2 o 3 días), rojo anaranjado (hoy o mañana) y rojo
  (fuera de plazo). Lo entregado o corregido queda en gris. La leyenda está en Entregas.
- **Disposición**: menú en pestañas arriba, con iconos; el Panel es un tablero con los contadores
  arriba, lo urgente a la izquierda y los últimos ficheros a la derecha.
- **Búsqueda global** (`Ctrl+K`) de asignaturas, elementos, nombres de fichero y etiquetas,
  y opcionalmente **dentro del contenido** de los ficheros de texto indexados
  (`.java`, `.sql`, `.html`, `.md`, `.txt`…), con el número de línea y la línea encontrada.
- **Importar una actividad desde su enlace** (Aules, Moodle u otra web): se leen el título,
  la asignatura, la fecha de entrega, el enunciado y los adjuntos; se crea el elemento como
  entrega pendiente y los ficheros se descargan a la carpeta del curso y se indexan.
- **Apariencia**: estilo sobrio con esquinas marcadas y **modo claro, modo oscuro o como el sistema**
  (Ajustes → Apariencia; se recuerda y se aplica al arrancar, sin parpadeo).
- **Sincronizar entre ordenadores con OneDrive** (Ajustes → «Sincronizar entre ordenadores»): ver abajo.
- **Actualizaciones automáticas** desde GitHub Releases, con botón «Buscar actualizaciones»
  en Ajustes y aviso en la barra lateral cuando hay una versión nueva descargada.

## Importar desde un enlace

Botón **«Importar desde enlace…»** en el Panel, en cada asignatura y en Entregas.

- **Asignatura entera**: si pegas el enlace de la asignatura (la página del curso,
  `…/course/view.php?id=…`), se leen todas sus secciones y actividades. Cada sección es una
  **unidad** («Unitat 1: …», «UD 3 - Arrays»; la «General» queda sin unidad) y cada actividad se
  importa según su tipo: **tarea** → ejercicio (con fecha, estado, enunciado y adjuntos),
  **cuestionario** → examen (con su fecha de cierre), **fichero** o **carpeta** → apunte (con el
  fichero o un .zip de la carpeta), **página** → apunte (con su texto), **URL** → enlace. Los foros
  y las etiquetas de texto se ignoran. Antes de importar se revisa todo por unidades y se pueden
  desmarcar actividades o tipos enteros; lo que **ya está en la app** sale desmarcado, así que
  se puede repetir cada semana sin duplicar nada. Las unidades se reutilizan si ya existen.

- Puedes poner **varios enlaces**: «+ Añadir otro enlace» añade campos, y si pegas varios enlaces
  de golpe en un campo se reparten solos. Se leen uno tras otro **en ese orden**; después revisas
  cada actividad, también en orden («Revisa la actividad 2 de 5»), y puedes guardarla o saltarla.
  Al final, un resumen dice qué se guardó, qué saltaste y qué enlaces no se pudieron leer.

- La página se abre en una ventana de la app con **sesión propia y persistente**. Si la
  plataforma pide iniciar sesión, entras con tu usuario en esa ventana y la lectura sigue sola;
  la sesión se recuerda para las siguientes importaciones. «Cerrar sesión de la plataforma»
  (Ajustes) la borra.
- En Moodle/Aules la tarea se lee de la **cabecera de actividad**
  (`<div class="activity-header" data-for="page-activity-header">`): su **texto** se copia en las
  notas (sin las fechas ni los requisitos de finalización) y sus **ficheros** (adjuntos e imágenes
  del enunciado) se adjuntan en el apartado **«Enunciado del profesor»**. Lo que está fuera de la
  cabecera se ignora. El curso sale de la ruta de navegación.
- Se detecta el **estado de tu entrega** (de la tabla de estado y los requisitos de finalización,
  nunca del enunciado): sin entregar → pendiente, borrador → en curso, enviada para calificar →
  entregada, calificada → corregida. En castellano, valenciano e inglés.
- Se lee la **unidad** de la actividad de la ruta de navegación («UD 3 - Arrays», «Unitat 1: …»,
  «Tema 4. Funciones») y se guarda en esa unidad de la asignatura: si ya existe (mismo número o mismo
  nombre) se reutiliza y, si no, se crea. En el formulario se ve como «(nueva)» antes de guardar.
- Si la tarea aparece como **calificada** («Calificado», «Qualificat», «Graded», «Hecho: Recibir
  una calificación»…), se añade el apartado **«Archivo enviado»** con tu entrega, aparte del
  enunciado (en disco, en la subcarpeta `Archivo enviado`). Sin calificar, tu entrega no se recoge.
- En otras webs (sin esa cabecera) se leen el título, los enlaces a documentos y la fecha que siga
  a «Fecha de entrega», «Fecha límite», «Venciment», «Due»…
- Fechas en castellano, valenciano e inglés, y en formato `dd/mm/aaaa`.
- La asignatura se reconoce por el nombre del curso, también en valenciano («Programació»,
  «Bases de dades»…). Si no encaja ninguna, la eliges en el formulario.
- Antes de guardar se revisa todo, y puedes desmarcar cualquier fichero.
- Los ficheros se guardan en `<carpeta de descargas>/<asignatura>/<actividad>/` (por defecto
  `Documentos/AppClase`, configurable en Ajustes). En la ficha del elemento se ven agrupados por
  apartado; los que añadas a mano aparecen en «Otros ficheros».

## Sincronizar entre ordenadores (OneDrive)

En **Ajustes → Sincronizar entre ordenadores**, en cada ordenador:

- En el primero, **«Activar sincronización»** copia los datos a `OneDrive\AppClase\datos\appclase.db` y
  reinicia la app usándolos. En los demás, la app ve que ya hay datos y ofrece **«Usar los datos de
  OneDrive»** (los que tuviera ese ordenador se quedan guardados en su carpeta local).
- **Un ordenador a la vez**: mientras está abierta, la app deja una marca `appclase.lock` (con el nombre
  del ordenador) que renueva cada minuto. Si al abrir la marca es de otro ordenador y está viva, avisa
  (Reintentar / Abrir igualmente / Salir). Si un ordenador ve que otro ha tomado el relevo, se cierra sin
  escribir más. Una marca sin renovar en 3 minutos se considera abandonada.
- **Rutas**: OneDrive puede estar en otra ruta en cada ordenador; al abrir, las rutas de los ficheros que
  están dentro de OneDrive (y la carpeta de descargas) se pasan al OneDrive de ese ordenador. Los ficheros
  **fuera de OneDrive** solo existen donde se añadieron: en los demás salen como «no se encuentra», pero
  nunca se quitan del índice.
- **Copias de seguridad** en `OneDrive\AppClase\datos\copias`: al abrir, antes de borrar varias entregas y
  antes de importar una asignatura (como mucho una cada 10 minutos). Se guardan las 10 últimas.
- **«Desactivar en este ordenador»** copia a este ordenador lo que hay en OneDrive (los datos locales
  anteriores se apartan como `appclase-antes-<fecha>.db`) y vuelve a usar datos locales.
- Con los datos en OneDrive, SQLite usa `journal_mode = DELETE` para que todo quede en un único fichero.
- Solo puede haber una ventana de AppClase abierta en cada ordenador.

## Desarrollo

```bash
npm install
npm run dev          # arranca la app con recarga en caliente
npm run typecheck
npm run test:e2e     # prueba de extremo a extremo con Playwright
npm run dist:win     # genera dist/AppClase-Setup-<versión>.exe
```

- `test:e2e` ejecuta también `scripts/e2e-sync.cjs`, que simula dos ordenadores con su propio OneDrive
  (variables `APPCLASE_CONFIG_DIR`, `APPCLASE_ONEDRIVE`, `APPCLASE_HOST`, `APPCLASE_TEST`) y comprueba
  el módulo `syncCore` por separado.
- En Linux sin pantalla: `xvfb-run -a npm run test:e2e`. `KEEP_E2E=1` conserva el
  directorio temporal con la base de datos y las capturas.
- `scripts/demo.cjs <carpeta>` siembra datos de ejemplo y guarda capturas de la app.
- `scripts/make-icon.cjs` regenera `build/icon.png`.
- `dist:win` desde Linux necesita Wine (`dpkg --add-architecture i386` y luego
  `apt install wine wine32:i386 wine64`). En Windows funciona directamente.
- El instalador no está firmado digitalmente: Windows SmartScreen mostrará «Editor desconocido».

## Actualizaciones automáticas

La app instalada busca versiones nuevas en GitHub Releases al arrancar y cada 4 horas. Las descarga
en segundo plano y las instala al cerrarse (o con «Reiniciar y actualizar»). En Ajustes hay un botón
«Buscar actualizaciones». El repositorio debe ser **público** para que la app pueda leer las versiones.

Para publicar una versión nueva:

```bash
npm run release    # sube la versión (0.1.0 → 0.1.1) en package.json, hace commit y push a main
```

En cada push a `main`, `.github/workflows/release.yml` pasa las pruebas en Windows. Si la versión de
`package.json` aún no está publicada, compila el instalador y lo publica en Releases con la etiqueta `vX.Y.Z`.

## Nombre e identidad

El nombre visible es **Cursia** (ventana, barra superior, accesos directos y desinstalador). Por dentro
siguen llamándose AppClase la carpeta de datos (`%APPDATA%/AppClase`), el `appId`, el instalador y el
repositorio, y la carpeta `OneDrive\AppClase`: cambiarlos haría perder los datos o romper las
actualizaciones. El logo está en `src/renderer/src/components/Logo.tsx` y `scripts/make-icon.cjs`
genera `build/icon.png` con los mismos trazos.

## Estructura

```
src/
  main/       proceso principal: base de datos, IPC y gestión de ficheros
    db.ts       esquema, migraciones y siembra de las asignaturas
    files.ts    indexar rutas, abrir con el sistema, revalidar y buscar en contenido
    ipc.ts      handlers de asignaturas, temas, elementos, ficheros, búsqueda y ajustes
    updater.ts  actualizaciones automáticas desde GitHub Releases
    importer.ts leer una actividad desde su enlace y descargar sus ficheros con la sesión
    sync.ts     datos en OneDrive: abrir, marca «en uso», copias, activar y desactivar
    syncCore.ts lo anterior sin Electron (configuración, marca, rutas y copias), probado aparte
  preload/    puente seguro (contextBridge) → window.api
  renderer/   interfaz en React
  shared/     tipos compartidos entre procesos
scripts/      prueba E2E (con una plataforma falsa tipo Moodle), generador de capturas e icono
build/        recursos del instalador (icono)
```

## Datos

La base de datos se guarda en la carpeta de datos de usuario de Electron
(`%APPDATA%/AppClase/datos/appclase.db` en Windows), o en OneDrive si la sincronización está activada.
Se puede cambiar con la variable
de entorno `APPCLASE_DATA_DIR`, que es lo que usa la prueba E2E.

Borrar un elemento o una asignatura **no borra ningún fichero del disco**: solo se
quitan del índice.
