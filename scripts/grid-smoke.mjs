import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const baseUrl = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:4174'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
await page.addInitScript(() => {
  navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('No camera', 'NotFoundError') }
})
mkdirSync('test-results', { recursive: true })

try {
  await page.goto(baseUrl)
  await page.getByRole('button', { name: 'Start creating' }).click()
  await page.getByText('Camera unavailable. Use Photos to add your images.', { exact: true }).waitFor()
  await page.waitForTimeout(500)
  await page.screenshot({ path: 'test-results/studio-editor.png' })
  await page.getByRole('button', { name: 'Controls', exact: true }).click()
  await page.locator('.create-card').click()
  await page.locator('.creator-fullscreen').waitFor()
  await page.waitForTimeout(250)

  const creator = page.getByRole('dialog', { name: 'Create custom grid', exact: true })
  assert.equal(await creator.getByRole('button', { name: 'Undo grid edit' }).isDisabled(), true)
  const lineValues = () => page.locator('.creator-free-line').evaluateAll((lines) => lines.map((line) =>
    ['x1', 'y1', 'x2', 'y2'].map((key) => Number(line.getAttribute(`data-divider-${key}`))),
  ))
  const original = await lineValues()
  const canvasBefore = await page.locator('.creator-canvas').boundingBox()
  for (const tab of ['Borders', 'Details', 'Dividers']) {
    await creator.getByRole('tab', { name: tab, exact: true }).click()
    assert.deepEqual(await page.locator('.creator-canvas').boundingBox(), canvasBefore, 'switching tools moves the canvas')
  }

  await creator.getByRole('button', { name: 'Horizontal divider', exact: true }).click()
  assert.equal((await lineValues()).length, 3)
  assert.equal(await page.getByLabel('Selected divider').evaluate((input) => input.selectedOptions[0].textContent), 'Divider 3')
  await creator.getByRole('button', { name: 'Undo grid edit' }).click()
  assert.deepEqual(await lineValues(), original)
  await creator.getByRole('button', { name: 'Redo grid edit' }).click()
  await creator.getByRole('button', { name: 'Delete selected' }).click()
  assert.deepEqual(await lineValues(), original)
  await creator.getByRole('button', { name: 'Undo grid edit' }).click()
  assert.equal((await lineValues()).length, 3)
  await creator.getByRole('button', { name: 'Redo grid edit' }).click()

  // A complete drag is one reversible action, and a full-height line stays full-height.
  await page.getByRole('button', { name: 'Snap on', exact: true }).click()
  const line = page.getByRole('button', { name: 'Move divider 1', exact: true })
  const lineBox = await line.boundingBox()
  await page.mouse.move(lineBox.x + lineBox.width / 2, lineBox.y + lineBox.height * 0.3)
  await page.mouse.down()
  await page.mouse.move(lineBox.x + lineBox.width / 2 + 35, lineBox.y + lineBox.height * 0.3 + 30, { steps: 10 })
  await page.mouse.up()
  const moved = await lineValues()
  assert.ok(moved[0][0] > original[0][0] + 5, 'divider did not move')
  assert.equal(moved[0][1], 0, 'drag shortened the divider at the top')
  assert.equal(moved[0][3], 100, 'drag shortened the divider at the bottom')
  await creator.getByRole('button', { name: 'Undo grid edit' }).click()
  assert.deepEqual(await lineValues(), original, 'drag required multiple undo steps')
  await creator.getByRole('button', { name: 'Redo grid edit' }).click()
  assert.deepEqual(await lineValues(), moved)

  await creator.getByRole('button', { name: 'Preview', exact: true }).click()
  assert.equal(await page.locator('.creator-handle').first().isVisible(), false)
  await creator.getByRole('button', { name: 'Edit grid', exact: true }).click()
  assert.equal(await page.locator('.creator-handle').first().isVisible(), true)

  for (const viewport of [{ width: 280, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport)
    for (const tab of ['Dividers', 'Borders', 'Details']) {
      await creator.getByRole('tab', { name: tab, exact: true }).click()
      const geometry = await page.evaluate(() => {
        const box = (selector) => document.querySelector(selector).getBoundingClientRect()
        const canvas = box('.creator-canvas')
        const stage = box('.creator-stage')
        const topbar = box('.creator-topbar')
        const dock = box('.creator-side')
        return {
          contained: canvas.top >= stage.top && canvas.bottom <= stage.bottom && canvas.left >= stage.left && canvas.right <= stage.right,
          aspect: canvas.height / canvas.width,
          reachable: topbar.top >= 0 && dock.bottom <= innerHeight && dock.left >= 0 && dock.right <= innerWidth,
          shellScroll: document.querySelector('.native-shell').scrollTop,
          overflow: document.documentElement.scrollWidth > innerWidth,
        }
      })
      assert.ok(geometry.contained && geometry.reachable && !geometry.overflow && geometry.shellScroll === 0, `${JSON.stringify(viewport)} ${tab}: ${JSON.stringify(geometry)}`)
      assert.ok(Math.abs(geometry.aspect - 1.25) < 0.01)
    }
    await creator.getByRole('tab', { name: 'Dividers', exact: true }).click()
    await page.screenshot({ path: `test-results/grid-${viewport.width}.png` })
  }

  await page.setViewportSize({ width: 390, height: 844 })
  await creator.getByRole('tab', { name: 'Details', exact: true }).click()
  await page.getByLabel('Grid name').fill('My flow')
  await page.getByRole('button', { name: 'Close creator' }).click()
  const discard = page.getByRole('alertdialog')
  await discard.getByRole('button', { name: 'Discard changes' }).focus()
  await page.keyboard.press('Tab')
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Keep editing')
  await page.keyboard.press('Escape')
  await discard.waitFor({ state: 'detached' })
  await creator.getByRole('button', { name: 'Save layout', exact: true }).click()
  await creator.waitFor({ state: 'detached' })
  assert.equal(await page.locator('.live-strip').getAttribute('data-layout-name'), 'My flow')

  // Editing a saved grid must also be reversible from the main editor.
  await page.getByRole('button', { name: 'Controls', exact: true }).click()
  await page.getByRole('button', { name: 'Edit My flow grid' }).click()
  await page.getByRole('tab', { name: 'Borders', exact: true }).click()
  await page.getByRole('slider', { name: 'Border thickness' }).fill('7')
  await page.getByRole('button', { name: 'Update layout' }).click()
  await page.locator('.creator-fullscreen').waitFor({ state: 'detached' })
  assert.equal(await page.locator('.live-strip').evaluate((strip) => strip.style.getPropertyValue('--border')), '7px')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  assert.notEqual(await page.locator('.live-strip').evaluate((strip) => strip.style.getPropertyValue('--border')), '7px')
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  assert.equal(await page.locator('.live-strip').evaluate((strip) => strip.style.getPropertyValue('--border')), '7px')

  await page.getByRole('button', { name: 'Controls', exact: true }).click()
  await page.getByRole('tab', { name: 'Style', exact: true }).click()
  await page.getByRole('button', { name: 'Paper', exact: true }).click()
  assert.equal(await page.locator('.live-strip').evaluate((strip) => strip.style.getPropertyValue('--paper')), '#f3ede2')
  await page.screenshot({ path: 'test-results/studio-style.png' })

  // Legacy grids predate reading-order panels; a border edit must not swap photos.
  const legacyPanels = await page.evaluate(() => {
    const grids = JSON.parse(localStorage.getItem('instacomic.customLayouts.v1'))
    const grid = grids[0]
    delete grid.panelOrder
    grid.panels = [grid.panels[2], grid.panels[0], grid.panels[3], grid.panels[1]].map((panel, index) => ({ ...panel, id: String(index + 1) }))
    localStorage.setItem('instacomic.customLayouts.v1', JSON.stringify(grids))
    return grid.panels
  })
  await page.reload()
  await page.getByRole('button', { name: 'Start creating' }).click()
  await page.getByRole('button', { name: 'Controls', exact: true }).click()
  await page.getByRole('button', { name: 'Edit My flow grid' }).click()
  await page.getByRole('tab', { name: 'Borders', exact: true }).click()
  await page.getByRole('slider', { name: 'Border thickness' }).fill('3')
  await page.getByRole('button', { name: 'Update layout' }).click()
  await page.locator('.creator-fullscreen').waitFor({ state: 'detached' })
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('instacomic.customLayouts.v1'))[0].panels), legacyPanels)

  // Delayed camera permissions and fast flips cannot revive an obsolete stream.
  const camera = await browser.newPage()
  camera.on('pageerror', (error) => errors.push(error.message))
  await camera.addInitScript(() => {
    window.cameraRequests = []
    window.stoppedCameras = []
    navigator.mediaDevices.getUserMedia = () => new Promise((resolve) => {
      const id = window.cameraRequests.length
      window.cameraRequests.push(() => {
        const stream = new MediaStream()
        stream.getTracks = () => [{ stop: () => window.stoppedCameras.push(id) }]
        resolve(stream)
      })
    })
  })
  await camera.goto(baseUrl)
  await camera.getByRole('button', { name: 'Start creating' }).click()
  await camera.waitForFunction(() => window.cameraRequests.length === 1)
  await camera.getByRole('button', { name: 'Flip camera' }).click()
  await camera.waitForFunction(() => window.cameraRequests.length === 2)
  await camera.evaluate(() => { window.cameraRequests[1](); window.cameraRequests[0]() })
  await camera.waitForFunction(() => window.stoppedCameras.includes(0))
  await camera.locator('.live-frame').waitFor()
  assert.equal(await camera.locator('.live-frame').count(), 1)
  await camera.getByRole('button', { name: 'Flip camera' }).click()
  await camera.getByRole('button', { name: 'Back to projects' }).click()
  await camera.evaluate(() => window.cameraRequests[2]())
  await camera.waitForFunction(() => window.stoppedCameras.includes(2))
  assert.equal(await camera.locator('.live-frame').count(), 0)
  assert.equal(await camera.locator('.start-screen').isVisible(), true)
  await camera.close()
  assert.deepEqual(errors, [])
  console.log('Grid editing, undo/redo, responsive dock, preview, focus, legacy photo mapping, appearance presets, and camera races passed.')
} finally {
  await browser.close()
}
