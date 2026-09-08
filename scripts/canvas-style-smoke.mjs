import assert from 'node:assert/strict'
import { chromium, webkit } from 'playwright'

for (const engine of [chromium, webkit]) {
  const browser = await engine.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(() => {
      if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('No camera', 'NotFoundError') }
    })
    await page.goto(process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:4174')
    await page.getByRole('button', { name: 'Start creating', exact: true }).click()
    await page.getByRole('button', { name: 'Done editing comic', exact: true }).click()
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = 300; canvas.height = 400
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#c4bd90'; ctx.fillRect(0, 0, 300, 400)
      return canvas.toDataURL().split(',')[1]
    })
    await page.setInputFiles('.photo-upload', { name: 'test.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
    await page.locator('.live-panel img').waitFor()

    await page.getByRole('button', { name: 'Controls', exact: true }).click()
    await page.getByRole('button', { name: 'New grid Create and save', exact: true }).click()
    await page.getByRole('tab', { name: 'Style', exact: true }).click()
    const setColor = async (label, value) => page.getByLabel(label, { exact: true }).evaluate((input, color) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, color)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }, value)
    await setColor('Line color', '#8c243d')
    await setColor('Paper', '#d4e3ca')
    await page.getByRole('slider', { name: 'Divider thickness', exact: true }).fill('18')
    await page.getByRole('tab', { name: 'Caption', exact: true }).click()
    await page.getByLabel('Caption text', { exact: true }).fill('A day to remember')
    await page.getByRole('tab', { name: 'Border', exact: true }).click()
    const dividerPaint = () => page.locator('.creator-free-line').first().evaluate(line => {
      const paint = getComputedStyle(line, '::after')
      return { width: paint.height, color: paint.backgroundColor, outline: getComputedStyle(line, '::before').content }
    })
    const beforeBorder = await dividerPaint()
    assert.deepEqual(beforeBorder, { width: '18px', color: 'rgb(140, 36, 61)', outline: 'none' })
    await page.getByRole('switch', { name: 'Outside border', exact: true }).click()
    await page.getByRole('slider', { name: 'Outside border width', exact: true }).fill('6')
    assert.deepEqual(await dividerPaint(), beforeBorder, 'Outside border changed the internal divider')
    assert.equal(await page.locator('.creator-canvas').evaluate(e => getComputedStyle(e).borderTopColor), beforeBorder.color)
    await page.getByRole('switch', { name: 'Outside border', exact: true }).click()
    assert.deepEqual(await dividerPaint(), beforeBorder)
    assert.equal(await page.locator('.creator-canvas').evaluate(e => getComputedStyle(e).borderTopWidth), '0px')
    await page.getByRole('button', { name: 'Save layout', exact: true }).click()
    await page.locator('.creator-fullscreen').waitFor({ state: 'detached' })
    assert.equal(await page.locator('.strip-caption').innerText(), 'A day to remember')
    await page.getByRole('button', { name: 'Controls', exact: true }).click()
    assert.equal(await page.getByRole('tab', { name: 'Style', exact: true }).count(), 0, 'Duplicate custom Style menu remains')
    await page.getByRole('button', { name: 'Done editing comic', exact: true }).click()
    await page.getByRole('button', { name: 'Open appearance controls', exact: true }).click()
    await page.getByRole('tab', { name: 'Style', exact: true }).waitFor()
    assert.equal(await page.getByRole('tab', { name: 'Style', exact: true }).getAttribute('aria-selected'), 'true')
    assert.equal(await page.getByLabel('Paper', { exact: true }).inputValue(), '#d4e3ca')
    await setColor('Paper', '#ff0000')
    await page.getByRole('button', { name: 'Undo grid edit', exact: true }).click()
    assert.equal(await page.getByLabel('Paper', { exact: true }).inputValue(), '#d4e3ca')
    await setColor('Paper', '#0000ff')
    await page.getByRole('button', { name: 'Close creator', exact: true }).click()
    await page.getByRole('button', { name: 'Discard changes', exact: true }).click()
    assert.equal(await page.locator('.live-strip').evaluate(e => e.style.getPropertyValue('--paper')), '#d4e3ca')
    const savedAppearance = await page.evaluate(() => JSON.parse(localStorage.getItem('instacomic.customLayouts.v1'))[0].appearance)
    assert.equal(savedAppearance.background, '#d4e3ca')
    assert.equal(savedAppearance.caption, 'A day to remember')
    if (engine === chromium) {
      await page.locator('.native-shell[data-autosave-state="saved"]').waitFor()
      await page.reload()
      await page.getByRole('button', { name: 'Continue editing', exact: true }).click()
    }
    // Windows Playwright WebKit cannot persist IndexedDB Blob assets, including
    // on the baseline app. Verify photo draft recovery in Chromium; both engines
    // verify the actual saved grid record, editing, and cancellation above.
    await page.getByRole('button', { name: 'Open appearance controls', exact: true }).click()
    assert.equal(await page.getByLabel('Line color', { exact: true }).inputValue(), '#8c243d')
    await page.getByRole('tab', { name: 'Caption', exact: true }).click()
    assert.equal(await page.getByLabel('Caption text', { exact: true }).inputValue(), 'A day to remember')
    assert.equal(await page.locator('.creator-fullscreen').evaluate(e => Math.round(e.getBoundingClientRect().top)), 0, 'Focus scrolled the workbench out of view')
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.creator-fullscreen')).opacity === '1')
    await page.screenshot({ path: `test-results/canvas-style-${engine.name()}.png` })
    assert.deepEqual(errors, [])
    console.log(`${engine.name()}: unified line color, independent outside border, in-editor styling, undo, cancel and saved-grid settings passed${engine === chromium ? '; photo draft recovery passed' : ''}`)
  } finally {
    await browser.close()
  }
}
