import assert from 'node:assert/strict'
import { mkdirSync, readFileSync } from 'node:fs'
import { chromium, webkit } from 'playwright'

mkdirSync('test-results', { recursive: true })
for (const engine of [chromium, webkit]) {
 const browser = await engine.launch()
 try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, acceptDownloads: true })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:5173')
  await page.getByRole('button', { name: 'Start creating', exact: true }).click()
  await page.getByRole('button', { name: 'Done editing comic', exact: true }).click()
  const png = await page.evaluate(() => {
   const c = document.createElement('canvas'); c.width = 1600; c.height = 1000
   const ctx = c.getContext('2d')
   ctx.fillStyle = '#ed7253'; ctx.fillRect(0, 0, 800, 1000)
   ctx.fillStyle = '#4083b8'; ctx.fillRect(800, 0, 800, 1000)
   return c.toDataURL().split(',')[1]
  })
  const upload = () => page.setInputFiles('.photo-upload', { name: 'panorama.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
  const slides = async () => {
   if (!await page.getByRole('tab', { name: 'Slides', exact: true }).isVisible()) await page.getByRole('button', { name: 'Controls', exact: true }).click()
   await page.getByRole('tab', { name: 'Slides', exact: true }).click()
  }
  const records = () => page.evaluate(async () => {
   const db = await new Promise((resolve, reject) => { const r = indexedDB.open('instacomic'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
   const result = await new Promise((resolve, reject) => { const r = db.transaction('projects').objectStore('projects').getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
   db.close(); return result
  })
  const waitSaved = async (name, count) => {
   for (let attempt = 0; attempt < 100; attempt++) {
    if ((await records()).some(p => p.name === name && p.document.carousel.slides.length === count)) return
    await page.waitForTimeout(100)
   }
   assert.fail(`Project ${name} with ${count} slides was not persisted`)
  }
  await upload()
  await page.locator('.live-panel img').waitFor()
  const original = await page.locator('.live-panel img').getAttribute('src')
  await slides()
  await page.getByLabel('Project name', { exact: true }).fill('Weekend story')
  await page.getByRole('button', { name: 'Duplicate slide', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: /^Edit slide / }).count(), 2)
  assert.equal(await page.locator('.live-panel img').getAttribute('src'), original)
  await page.getByRole('button', { name: 'Add slide', exact: true }).click()
  assert.equal(await page.locator('.live-panel img').count(), 0)
  await page.getByRole('button', { name: 'Move earlier', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: 'Edit slide 2', exact: true }).getAttribute('aria-current'), 'true')
  await page.getByRole('button', { name: 'Remove slide', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: /^Edit slide / }).count(), 2)
  await page.getByRole('button', { name: 'Edit slide 1', exact: true }).click()
  await page.getByRole('button', { name: 'Split photo across slides', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.carousel-slide-list > button').length === 4)
  const thumbnails = page.getByRole('button', { name: /^Edit slide / })
  assert.equal(await thumbnails.count(), 4)
  await page.getByRole('button', { name: 'Done editing comic', exact: true }).click()
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await slides()
  assert.equal(await thumbnails.count(), 2)
  await page.getByRole('button', { name: 'Done editing comic', exact: true }).click()
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await slides()
  assert.equal(await thumbnails.count(), 4)
  await page.getByRole('button', { name: 'Edit slide 2', exact: true }).click()
  await page.screenshot({ path: `test-results/carousel-${engine.name()}.png` })
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export carousel ZIP', exact: true }).click()
  const download = await downloadPromise
  const path = `test-results/carousel-${engine.name()}.zip`
  await download.saveAs(path)
  const zip = readFileSync(path)
  const entries = []
  let offset = 0
  while (zip.readUInt32LE(offset) === 0x04034b50) {
   const size = zip.readUInt32LE(offset + 18), nameLength = zip.readUInt16LE(offset + 26), extraLength = zip.readUInt16LE(offset + 28)
   const name = zip.subarray(offset + 30, offset + 30 + nameLength).toString()
   const start = offset + 30 + nameLength + extraLength
   const data = zip.subarray(start, start + size)
   assert.equal(data.readUInt32BE(16), 1440)
   assert.equal(data.readUInt32BE(20), 1800)
   entries.push({ name, png: data.toString('base64') }); offset = start + size
  }
  assert.deepEqual(entries.map(e => e.name), ['slide-01.png', 'slide-02.png', 'slide-03.png', 'slide-04.png'])
  const colors = await page.evaluate(async entries => Promise.all(entries.slice(1, 3).map(async entry => {
   const img = new Image(); img.src = `data:image/png;base64,${entry.png}`; await img.decode()
   const c = document.createElement('canvas'); c.width = 1; c.height = 1; const ctx = c.getContext('2d')
   ctx.drawImage(img, 720, 900, 1, 1, 0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data]
  })), entries)
  assert.deepEqual(colors, [[237,114,83,255], [64,131,184,255]], 'Panorama slices do not follow source order')
  await waitSaved('Weekend story', 4)
  await page.getByRole('button', { name: 'Done editing comic', exact: true }).click()
  await page.getByRole('button', { name: 'Back to projects', exact: true }).click()
  await page.getByRole('button', { name: 'Open project Weekend story', exact: true }).waitFor()
  await page.getByRole('button', { name: 'New comic', exact: true }).click()
  await page.getByRole('button', { name: 'Start new comic', exact: true }).click()
  await page.getByRole('tab', { name: 'Slides', exact: true }).click()
  await page.getByLabel('Project name', { exact: true }).fill('Second project')
  await waitSaved('Second project', 1)
  assert.equal((await records()).length, 2)
  await page.getByRole('button', { name: 'Done editing comic', exact: true }).click()
  await page.getByRole('button', { name: 'Back to projects', exact: true }).click()
  await page.reload()
  await page.getByRole('button', { name: 'Open project Weekend story', exact: true }).waitFor()
  await page.locator('.start-screen:not([data-draft-phase="checking"])').waitFor()
  await page.locator('.project-card img').first().waitFor()
  await page.waitForFunction(() => [...document.querySelectorAll('.project-card img')].every(img => img.complete && img.naturalWidth > 0))
  await page.screenshot({ path: `test-results/project-library-${engine.name()}.png` })
  await page.getByRole('button', { name: 'Open project Weekend story', exact: true }).click()
  await page.locator('.start-screen').waitFor({ state: 'detached' })
  await slides()
  assert.equal(await thumbnails.count(), 4)
  await page.getByRole('button', { name: 'Edit slide 1', exact: true }).click()
  await page.locator('.live-panel img').waitFor()
  assert.equal(await page.locator('.live-panel img').evaluate(img => img.complete && img.naturalWidth > 0), true)
  await page.getByRole('button', { name: 'Done editing comic', exact: true }).click()
  await page.getByRole('button', { name: 'Back to projects', exact: true }).click()
  await page.getByRole('button', { name: 'Delete project Second project', exact: true }).click()
  await page.getByRole('button', { name: 'Delete project', exact: true }).click()
  await page.getByRole('button', { name: 'Open project Second project', exact: true }).waitFor({ state: 'detached' })
  assert.equal((await records()).length, 1)
  await page.getByRole('button', { name: 'Open project Weekend story', exact: true }).click()
  await page.locator('.start-screen').waitFor({ state: 'detached' })
  await page.locator('.live-panel img').waitFor()
  assert.deepEqual(errors, [])
  console.log(`${engine.name()}: project library, four-slide recovery, add/duplicate/reorder/remove, panorama undo, numbered ZIP pixels and independent deletion passed`)
 } finally { await browser.close() }
}
