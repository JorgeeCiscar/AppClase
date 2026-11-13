// Genera build/icon.png (512×512) a partir de un SVG, con el Chromium de Playwright.
// Uso: node scripts/make-icon.cjs
// Si Playwright no encuentra su navegador, indica uno con CHROMIUM_PATH=/ruta/a/chrome.
const path = require('node:path')
const fs = require('node:fs')
const { chromium } = require('playwright')

const OUT = path.resolve(__dirname, '..', 'build', 'icon.png')

// Una pila de hojas con una marca de «hecho»: el curso ordenado en un solo sitio.
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#5b9bff"/>
      <stop offset="1" stop-color="#2c5fd6"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#bg)"/>
  <rect x="138" y="104" width="214" height="276" rx="24" fill="#fff" opacity=".42"
        transform="rotate(-9 245 242)"/>
  <rect x="160" y="126" width="214" height="276" rx="24" fill="#fff"/>
  <rect x="196" y="180" width="142" height="18" rx="9" fill="#2c5fd6" opacity=".32"/>
  <rect x="196" y="222" width="112" height="18" rx="9" fill="#2c5fd6" opacity=".32"/>
  <rect x="196" y="264" width="142" height="18" rx="9" fill="#2c5fd6" opacity=".32"/>
  <circle cx="364" cy="376" r="66" fill="#2fbf71" stroke="#fff" stroke-width="12"/>
  <path d="M333 377 l22 22 l42 -46" fill="none" stroke="#fff" stroke-width="16"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>`

;(async () => {
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}
  )
  const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 })
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`)
  await page.locator('svg').screenshot({ path: OUT, omitBackground: true })
  await browser.close()
  console.log('icono generado en', OUT)
})()
