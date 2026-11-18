// Genera build/icon.png (512×512) a partir de un SVG, con el Chromium de Playwright.
// Uso: node scripts/make-icon.cjs
// Si Playwright no encuentra su navegador, indica uno con CHROMIUM_PATH=/ruta/a/chrome.
const path = require('node:path')
const fs = require('node:fs')
const { chromium } = require('playwright')

const OUT = path.resolve(__dirname, '..', 'build', 'icon.png')

// Logo de Cursia: una «C» en tres tramos (los mismos trazos que components/Logo.tsx),
// con colores que se ven bien sobre la barra de tareas clara u oscura.
const PATHS = [
  'M46.72 15.65A22 22 0 0 0 18.46 14.66',
  'M16.17 16.72A22 22 0 0 0 16.17 47.28',
  'M18.46 49.34A22 22 0 0 0 46.72 48.35'
]
const COLORS = ['#1a8c96', '#1a8c96', '#ee8a44']
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="-5 -1 66 66">
  ${PATHS.map((d, i) => `<path d="${d}" fill="none" stroke="${COLORS[i]}" stroke-width="9.5"/>`).join('\n  ')}
</svg>`

;(async () => {
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
  const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 })
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`)
  await page.locator('svg').screenshot({ path: OUT, omitBackground: true })
  await browser.close()
  console.log('icono generado en', OUT)
})()
