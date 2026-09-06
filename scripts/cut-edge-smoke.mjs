import assert from 'node:assert/strict'
import { mkdirSync, readFileSync } from 'node:fs'
import { chromium, webkit } from 'playwright'

const baseUrl = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:4174'
mkdirSync('test-results', { recursive: true })

// Inspect actual raster pixels inside the cut, along all four canvas edges.
// Magenta lines against neutral panels makes a missing triangular wedge obvious.
async function checkEdges(page, png, line, gap, label, outer = 0) {
  const result = await page.evaluate(async ({ png, line, gap, outer }) => {
    const image = new Image()
    image.src = `data:image/png;base64,${png}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(image, 0, 0)
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const width = canvas.width - outer * 2
    const height = canvas.height - outer * 2
    const x1 = outer + line[0] / 100 * width
    const y1 = outer + line[1] / 100 * height
    const dx = (line[2] - line[0]) / 100 * width
    const dy = (line[3] - line[1]) / 100 * height
    const length = Math.hypot(dx, dy)
    let checked = 0
    const failures = []
    // Element screenshots can include a fractional outside pixel on their perimeter.
    for (let y = outer + 1; y < canvas.height - outer - 1; y++) for (let x = outer + 1; x < canvas.width - outer - 1; x++) {
      if (x > outer + 2 && y > outer + 2 && x < canvas.width - outer - 3 && y < canvas.height - outer - 3) continue
      const distance = Math.abs((x + 0.5 - x1) * dy - (y + 0.5 - y1) * dx) / length
      if (distance > gap / 2 - 3) continue // Exclude only the antialias fringe.
      checked++
      const i = (y * canvas.width + x) * 4
      if (data[i] < 240 || data[i + 1] > 15 || data[i + 2] < 240) {
        if (failures.length < 6) failures.push({ x, y, rgb: Array.from(data.slice(i, i + 3)) })
      }
    }
    return { checked, failures }
  }, { png: png.toString('base64'), line, gap, outer })
  assert.ok(result.checked > 20, `${label}: no meaningful edge samples`)
  assert.deepEqual(result.failures, [], `${label}: missing pixels at cut/canvas intersection`)
}

for (const engine of [chromium, webkit]) {
  const browser = await engine.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('No camera', 'NotFoundError') }
    })
    await page.goto(baseUrl)
    await page.getByRole('button', { name: 'Start creating' }).click()
    await page.getByRole('button', { name: 'Controls', exact: true }).click()
    await page.getByRole('tab', { name: 'Style', exact: true }).click()
    await page.locator('.motion-drawer-style label').filter({ hasText: 'Line color' }).locator('input[type="color"]').evaluate(input => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '#ff00ff')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await page.getByRole('tab', { name: 'Layout', exact: true }).click()
    await page.locator('.create-card').click()
    await page.getByRole('button', { name: 'Delete selected' }).click()
    await page.getByRole('tab', { name: 'Style', exact: true }).click()
    await page.getByRole('slider', { name: 'Divider thickness' }).fill('24')
    await page.getByRole('tab', { name: 'Adjust', exact: true }).click()
    let line
    for (const angle of [-70, -45, -12, 12, 45, 70]) {
      await page.getByRole('slider', { name: 'Angle', exact: true }).fill(String(angle))
      line = await page.locator('.creator-free-line').evaluate(el => ['x1', 'y1', 'x2', 'y2'].map(k => Number(el.getAttribute(`data-divider-${k}`))))
      await page.getByRole('button', { name: 'Preview', exact: true }).click()
      const png = await page.locator('.creator-canvas').screenshot({ path: `test-results/edge-${engine.name()}-${angle}.png` })
      await checkEdges(page, png, line, 24, `${engine.name()} editor ${angle}°`)
      await page.getByRole('button', { name: 'Edit grid', exact: true }).click()
    }
    await page.getByRole('button', { name: 'Save layout', exact: true }).click()
    await page.locator('.creator-fullscreen').waitFor({ state: 'detached' })
    await checkEdges(page, await page.locator('.live-strip').screenshot(), line, 24, `${engine.name()} live canvas`)
    await page.getByRole('button', { name: 'Controls', exact: true }).click()
    await page.getByRole('tab', { name: 'Export', exact: true }).click()
    const pending = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download PNG', exact: true }).click()
    const download = await pending
    await checkEdges(page, readFileSync(await download.path()), line, 72, `${engine.name()} PNG export`)
    await page.getByRole('tab', { name: 'Layout', exact: true }).click()
    await page.getByRole('button', { name: 'Edit Custom 1 grid', exact: true }).click()
    await page.getByRole('tab', { name: 'Border', exact: true }).click()
    await page.getByRole('switch', { name: 'Outside border' }).click()
    await page.getByRole('slider', { name: 'Outside border width' }).fill('6')
    await page.getByRole('button', { name: 'Preview', exact: true }).click()
    await checkEdges(page, await page.locator('.creator-cut-clip').screenshot(), line, 24, `${engine.name()} outlined editor`)
    await page.getByRole('button', { name: 'Update layout', exact: true }).click()
    await page.locator('.creator-fullscreen').waitFor({ state: 'detached' })
    await checkEdges(page, await page.locator('.live-strip').screenshot(), line, 24, `${engine.name()} outlined live canvas`, 6)
    await page.getByRole('button', { name: 'Controls', exact: true }).click()
    await page.getByRole('tab', { name: 'Export', exact: true }).click()
    const outlinedDownload = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download PNG', exact: true }).click()
    await checkEdges(page, readFileSync(await (await outlinedDownload).path()), line, 72, `${engine.name()} outlined PNG export`, 18)
    console.log(`${engine.name()}: six diagonal angles, outlined editor, and PNG exports with/without outlines passed`)
  } finally {
    await browser.close()
  }
}
