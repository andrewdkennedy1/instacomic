import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { chromium, webkit } from 'playwright'

mkdirSync('test-results', { recursive: true })
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(() => {
      window.cameraRequests = 0
      if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => {
        window.cameraRequests++
        throw new DOMException('Test camera unavailable', 'NotFoundError')
      }
      // An old preference must not prepopulate a new comic.
      localStorage.setItem('instacomic.activeLayout.v1', 'shard')
    })
    await page.goto(process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:5173')
    assert.equal(await page.getByRole('group', { name: 'Starting grid', exact: true }).count(), 0)
    await page.getByRole('button', { name: 'Start creating', exact: true }).click()
    await page.getByRole('dialog', { name: 'Grids', exact: true }).waitFor()
    assert.equal(await page.locator('.live-strip').getAttribute('data-layout-id'), 'blank')
    assert.equal(await page.locator('.live-panel').count(), 1)
    assert.equal(await page.locator('.panel-placeholder').count(), 0)
    assert.equal(await page.evaluate(() => window.cameraRequests), 0)
    const options = page.locator('[data-custom-layout="false"]')
    assert.ok(await options.count() >= 24)
    for (const viewport of [{ width: 280, height: 568 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport)
      await page.waitForFunction(() => Math.abs(document.querySelector('.motion-drawer-layout').getBoundingClientRect().bottom - innerHeight) < 1)
      const geometry = await page.evaluate(() => {
        const canvas = document.querySelector('.live-strip').getBoundingClientRect()
        const drawer = document.querySelector('.motion-drawer-layout').getBoundingClientRect()
        const cards = [...document.querySelectorAll('[data-custom-layout="false"]')].slice(0, 4).map(e => e.getBoundingClientRect())
        return { separate: canvas.bottom <= drawer.top || canvas.right <= drawer.left,
          visible: canvas.height > 140 && canvas.top >= 64, columns: new Set(cards.map(c => Math.round(c.top))).size,
          targets: cards.every(c => c.width >= 44 && c.height >= 44), overflow: document.documentElement.scrollWidth > innerWidth }
      })
      assert.ok(geometry.separate && geometry.visible && geometry.columns === 1 && geometry.targets && !geometry.overflow, `${engine.name()} ${viewport.width}: ${JSON.stringify(geometry)}`)
      await page.screenshot({ path: `test-results/blank-grids-${viewport.width}-${engine.name()}.png` })
    }
    await page.setViewportSize({ width: 390, height: 844 })
    const ids = await options.evaluateAll(items => items.map(e => ({ id: e.dataset.layoutOptionId, count: Number(e.dataset.panelCount) })))
    for (const { id, count } of ids) {
      await page.locator(`[data-layout-option-id="${id}"]`).click()
      assert.equal(await page.locator('.live-strip').getAttribute('data-layout-id'), id)
      assert.equal(await page.locator('.live-panel').count(), count)
    }
    await page.getByRole('button', { name: 'Use Blank layout, 1 panel', exact: true }).click()
    await page.getByRole('button', { name: 'Done editing comic', exact: true }).click()
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 400
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#a8b8a1'; ctx.fillRect(0, 0, 300, 400)
      ctx.fillStyle = '#ecb77c'; ctx.beginPath(); ctx.arc(210, 90, 48, 0, Math.PI * 2); ctx.fill()
      return canvas.toDataURL().split(',')[1]
    })
    await page.setInputFiles('.photo-upload', { name: 'moment.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
    await page.locator('.live-panel img').waitFor()
    const photo = await page.locator('.live-panel img').getAttribute('src')
    await page.getByRole('button', { name: 'Controls', exact: true }).click()
    await page.getByRole('button', { name: 'Use Top story layout, 3 panels', exact: true }).click()
    assert.equal(await page.locator('.live-panel img').getAttribute('src'), photo)
    await page.screenshot({ path: `test-results/grid-photo-${engine.name()}.png` })
    await page.getByRole('button', { name: 'Done editing comic', exact: true }).click()
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    assert.equal(await page.locator('.live-strip').getAttribute('data-layout-id'), 'blank')
    assert.equal(await page.locator('.live-panel img').getAttribute('src'), photo)
    await page.getByRole('button', { name: 'Redo', exact: true }).click()
    assert.equal(await page.locator('.live-strip').getAttribute('data-layout-id'), 'top-story')
    if (engine === chromium) {
      await page.locator('.native-shell[data-autosave-state="saved"]').waitFor()
      await page.reload()
      await page.getByRole('button', { name: 'Continue editing', exact: true }).click()
      await page.locator('.live-strip[data-layout-id="top-story"]').waitFor()
      await page.locator('.live-panel img').waitFor()
      await page.getByRole('button', { name: 'Back to projects', exact: true }).click()
      await page.getByRole('button', { name: 'New comic', exact: true }).click()
      await page.getByRole('button', { name: 'Start new comic', exact: true }).click()
      await page.getByRole('dialog', { name: 'Grids', exact: true }).waitFor()
      assert.equal(await page.locator('.live-strip').getAttribute('data-layout-id'), 'blank')
      assert.equal(await page.locator('.live-panel img').count(), 0)
    }
    assert.deepEqual(errors, [])
    console.log(`${engine.name()}: blank start, ${ids.length} grid choices, visible canvas at five viewport sizes, photo preservation and undo/redo passed`)
  } finally { await browser.close() }
}
