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
  assert.equal(await page.locator('.creator-stack').getAttribute('data-border-thickness'), '0')
  assert.equal(await page.locator('.creator-free-line').first().evaluate((line) => getComputedStyle(line, '::before').content), 'none', 'divider still has a separate outline layer')
  assert.equal(await page.locator('.creator-free-line').first().evaluate((line) => getComputedStyle(line, '::after').height), '6px')
  assert.equal(await page.locator('.creator-free-line').first().evaluate((line) => getComputedStyle(line, '::after').borderRadius), '0px')
  const selectedHandle = await page.locator('.creator-handle.is-selected').first().evaluate(handle => {
    const target = handle.getBoundingClientRect()
    const cue = getComputedStyle(handle, '::after')
    return { width: target.width, height: target.height, cueWidth: parseFloat(cue.width), visible: cue.opacity === '1' }
  })
  assert.ok(selectedHandle.width >= 44 && selectedHandle.height >= 44, 'divider end handles must remain touch friendly')
  assert.ok(selectedHandle.visible && selectedHandle.cueWidth >= 6 && selectedHandle.cueWidth <= 14, 'selected endpoints need a small, visible editing cue')
  const canvasBefore = await page.locator('.creator-canvas').boundingBox()
  for (const tab of ['Adjust', 'Style', 'Border', 'Details', 'Dividers']) {
    await creator.getByRole('tab', { name: tab, exact: true }).click()
    assert.deepEqual(await page.locator('.creator-canvas').boundingBox(), canvasBefore, 'switching tools moves the canvas')
  }
  await creator.getByRole('tab', { name: 'Adjust', exact: true }).click()
  await page.getByRole('slider', { name: 'Angle', exact: true }).fill('0')
  await page.getByRole('slider', { name: 'Angle', exact: true }).blur()
  await page.getByRole('slider', { name: 'Position', exact: true }).fill('30')
  await page.getByRole('slider', { name: 'Position', exact: true }).blur()
  const adjusted = (await lineValues())[0]
  assert.deepEqual(adjusted, [0, 30, 100, 30], 'cut sliders must span the canvas at the requested position')
  await creator.getByRole('button', { name: 'Undo grid edit' }).click()
  await creator.getByRole('button', { name: 'Undo grid edit' }).click()
  assert.deepEqual(await lineValues(), original)
  await creator.getByRole('tab', { name: 'Dividers', exact: true }).click()

  await creator.getByRole('button', { name: 'Horizontal divider', exact: true }).click()
  assert.equal((await lineValues()).length, 3)
  await page.waitForFunction(() => document.querySelector('[aria-label="Selected divider"]').selectedOptions[0].textContent === 'Divider 3')
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

  const cdp = await page.context().newCDPSession(page)
  const box = await page.locator('.creator-canvas').boundingBox()
  const x = box.x + box.width * moved[0][0] / 100
  const y = box.y + box.height * 0.3
  const touch = (id, px, py) => ({ id, x: px, y: py })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch(1, x, y)] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch(1, x, y), touch(2, x + 50, y + 65)] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touch(1, x - 8, y + 10), touch(2, x + 35, y + 50)] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [touch(2, x + 35, y + 50)] })
  const afterPinch = await lineValues()
  assert.ok(Math.abs(afterPinch[0][2] - afterPinch[0][0]) > 1, 'two fingers did not rotate the cut')
  const onEdge = (x, y) => [0, 100].includes(x) || [0, 100].includes(y)
  assert.ok(onEdge(afterPinch[0][0], afterPinch[0][1]) && onEdge(afterPinch[0][2], afterPinch[0][3]), 'two fingers shortened the cut')
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touch(1, x - 30, y + 10)] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  assert.ok((await lineValues())[0][0] < afterPinch[0][0] - 2, `lifting one finger stopped the drag: ${JSON.stringify({afterPinch, afterDrag: await lineValues()})}`)
  await creator.getByRole('button', { name: 'Undo grid edit' }).click()
  assert.deepEqual(await lineValues(), moved, 'one-to-two-to-one gesture split undo history')

  await creator.getByRole('button', { name: 'Preview', exact: true }).click()
  assert.equal(await page.locator('.creator-handle').first().isVisible(), false)
  await creator.getByRole('button', { name: 'Edit grid', exact: true }).click()
  assert.equal(await page.locator('.creator-handle').first().isVisible(), true)

  for (const viewport of [{ width: 280, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport)
    for (const tab of ['Dividers', 'Adjust', 'Style', 'Border', 'Details']) {
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
  await page.getByRole('tab', { name: 'Border', exact: true }).click()
  assert.equal(await page.getByRole('switch', { name: 'Outside border' }).getAttribute('aria-checked'), 'false')
  assert.equal(await page.getByRole('slider', { name: 'Outside border width' }).count(), 0)
  await page.getByRole('switch', { name: 'Outside border' }).click()
  await page.getByRole('slider', { name: 'Outside border width' }).fill('7')
  await page.getByRole('switch', { name: 'Outside border' }).click()
  assert.equal(await page.locator('.creator-stack').getAttribute('data-border-thickness'), '0')
  await page.getByRole('switch', { name: 'Outside border' }).click()
  assert.equal(await page.getByRole('slider', { name: 'Outside border width' }).inputValue(), '7')
  await page.getByRole('button', { name: 'Update layout' }).click()
  await page.locator('.creator-fullscreen').waitFor({ state: 'detached' })
  assert.equal(await page.locator('.live-strip').evaluate((strip) => strip.style.getPropertyValue('--border')), '7px')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  assert.notEqual(await page.locator('.live-strip').evaluate((strip) => strip.style.getPropertyValue('--border')), '7px')
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  assert.equal(await page.locator('.live-strip').evaluate((strip) => strip.style.getPropertyValue('--border')), '7px')

  await page.getByRole('button', { name: 'Controls', exact: true }).click()
  await page.getByRole('button', { name: 'Edit My flow grid', exact: true }).click()
  await page.getByRole('tab', { name: 'Style', exact: true }).click()
  await page.getByRole('button', { name: 'Paper', exact: true }).click()
  await page.getByRole('button', { name: 'Update layout', exact: true }).click()
  await page.locator('.creator-fullscreen').waitFor({ state: 'detached' })
  assert.equal(await page.locator('.live-strip').evaluate((strip) => strip.style.getPropertyValue('--paper')), '#f3ede2')
  await page.screenshot({ path: 'test-results/studio-style.png' })

  // Legacy grids predate reading-order panels; a border edit must not swap photos.
  const legacyPanels = await page.evaluate(() => {
    const grids = JSON.parse(localStorage.getItem('instacomic.customLayouts.v1'))
    const grid = grids[0]
    delete grid.panelOrder
    grid.dividers.forEach(line => { delete line.extent })
    grid.panels = [grid.panels[2], grid.panels[0], grid.panels[3], grid.panels[1]].map((panel, index) => ({ ...panel, id: String(index + 1) }))
    localStorage.setItem('instacomic.customLayouts.v1', JSON.stringify(grids))
    return grid.panels
  })
  await page.reload()
  await page.getByRole('button', { name: 'Start creating' }).click()
  await page.getByRole('button', { name: 'Controls', exact: true }).click()
  await page.getByRole('button', { name: 'Edit My flow grid' }).click()
  await page.getByRole('tab', { name: 'Adjust', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: 'Extend divider to canvas edges' }).count(), 1)
  await page.getByRole('button', { name: 'Extend divider to canvas edges' }).click()
  assert.equal(await page.getByRole('slider', { name: 'Angle' }).count(), 1)
  await page.getByRole('button', { name: 'Undo grid edit' }).click()
  assert.equal(await page.getByRole('button', { name: 'Extend divider to canvas edges' }).count(), 1)
  await page.getByRole('tab', { name: 'Border', exact: true }).click()
  await page.getByRole('slider', { name: 'Outside border width' }).fill('3')
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
