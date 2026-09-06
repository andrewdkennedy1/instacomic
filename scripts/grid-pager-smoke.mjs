import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { chromium, webkit } from 'playwright'

const baseUrl = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:4174'
mkdirSync('test-results', { recursive: true })
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(() => {
      if (!navigator.mediaDevices) return
      navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('No camera', 'NotFoundError') }
    })
    await page.goto(baseUrl)
    await page.getByRole('button', { name: 'Start creating' }).click()
    await page.getByRole('button', { name: 'Controls', exact: true }).click()
    await page.locator('.create-card').click()
    await page.getByRole('button', { name: 'Save layout', exact: true }).click()
    await page.locator('.creator-fullscreen').waitFor({ state: 'detached' })
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = 300; canvas.height = 400
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#ffb86c'; ctx.fillRect(0, 0, 150, 400)
      ctx.fillStyle = '#6366f1'; ctx.fillRect(150, 0, 150, 400)
      ctx.fillStyle = '#fff'; ctx.font = '50px sans-serif'; ctx.fillText('PHOTO', 45, 220)
      return canvas.toDataURL().split(',')[1]
    })
    await page.setInputFiles('.photo-upload', { name: 'composition.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
    await page.locator('.live-panel img').waitFor()
    const originalPhoto = await page.locator('.live-panel img').first().evaluate(img => ({ src: img.src, style: img.getAttribute('style') }))
    await page.getByRole('button', { name: 'Controls', exact: true }).click()
    await page.getByRole('button', { name: 'Edit Custom 1 grid', exact: true }).click()
    const preview = page.locator('.creator-panel img')
    await preview.waitFor()
    assert.deepEqual(await preview.evaluate(img => ({ src: img.src, style: img.getAttribute('style') })), originalPhoto, 'Grid preview changed the saved photo crop')
    const canvas = await page.locator('.creator-canvas').boundingBox()
    assert.ok((await page.locator('.creator-side').boundingBox()).height <= 225)
    assert.ok(canvas.height > 380, 'Compact dock did not release canvas space')
    for (const name of ['Adjust', 'Style', 'Border', 'Details', 'Dividers']) {
      await page.getByRole('tab', { name, exact: true }).click()
      assert.deepEqual(await page.locator('.creator-canvas').boundingBox(), canvas, 'Paging shifted the canvas')
      assert.equal(await page.getByRole('tabpanel').count(), 1, 'Offscreen controls are accessible')
    }
    if (engine === chromium) {
      const cdp = await page.context().newCDPSession(page)
      const box = await page.locator('.creator-tool-content').boundingBox()
      const y = box.y + box.height - 8
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: box.x + box.width - 25, y }] })
      for (let i = 1; i <= 8; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: box.x + box.width - 25 - i * 30, y }] })
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await page.waitForFunction(() => document.querySelector('#grid-tab-adjust').getAttribute('aria-selected') === 'true')
      await page.waitForFunction(() => {
        const pager = document.querySelector('.creator-tool-content')
        return Math.abs(pager.scrollLeft - pager.clientWidth) < 1
      })
      const slider = await page.getByRole('slider', { name: 'Angle', exact: true }).boundingBox()
      const sy = slider.y + slider.height / 2
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 2, x: slider.x + slider.width - 14, y: sy }] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 2, x: slider.x + slider.width / 2, y: sy }] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      assert.equal(await page.locator('#grid-tab-adjust').getAttribute('aria-selected'), 'true', 'A slider gesture paged the dock')
      assert.notEqual(await page.getByRole('slider', { name: 'Angle', exact: true }).inputValue(), '90')
    } else {
      await page.locator('.creator-tool-content').evaluate(pager => pager.scrollBy({ left: pager.clientWidth, behavior: 'smooth' }))
      await page.waitForFunction(() => document.querySelector('#grid-tab-adjust').getAttribute('aria-selected') === 'true')
    }
    await page.getByRole('slider', { name: 'Angle', exact: true }).fill('45')
    await page.getByRole('slider', { name: 'Position', exact: true }).fill('60')
    assert.equal(await preview.getAttribute('src'), originalPhoto.src)
    await page.screenshot({ path: `test-results/grid-photos-${engine.name()}.png` })
    await page.getByRole('button', { name: 'Close creator', exact: true }).click()
    await page.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await page.locator('.creator-fullscreen').waitFor({ state: 'detached' })
    assert.deepEqual(await page.locator('.live-panel img').first().evaluate(img => ({ src: img.src, style: img.getAttribute('style') })), originalPhoto, 'Cancel changed the stored photo')
    await page.getByRole('button', { name: 'Controls', exact: true }).click()
    await page.getByRole('button', { name: 'Edit Custom 1 grid', exact: true }).click()
    await page.getByRole('tab', { name: 'Adjust', exact: true }).click()
    await page.getByRole('slider', { name: 'Angle', exact: true }).fill('35')
    const finalPreview = await preview.evaluate(img => ({ src: img.src, style: img.getAttribute('style') }))
    await page.getByRole('button', { name: 'Update layout', exact: true }).click()
    await page.locator('.creator-fullscreen').waitFor({ state: 'detached' })
    assert.deepEqual(await page.locator('.live-panel img').first().evaluate(img => ({ src: img.src, style: img.getAttribute('style') })), finalPreview, 'Saved photo composition differs from grid preview')
    assert.deepEqual(errors, [])
    console.log(`${engine.name()}: compact pagination, ${engine === chromium ? 'touch swipes' : 'scroll snapping'}, photo preview, cancel and save parity passed`)
  } finally {
    await browser.close()
  }
}
