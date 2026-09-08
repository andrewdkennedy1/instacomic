import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { chromium, webkit } from 'playwright'
import { installNativeShare, sharePreparedPhotos } from './native-share-fixture.mjs'

const baseUrl = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:4174'
mkdirSync('test-results', { recursive: true })

for (const engine of [chromium, webkit]) {
  const browser = await engine.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await installNativeShare(page)
    await page.goto(baseUrl)
    await page.getByRole('button', { name: 'Start creating', exact: true }).click()
    await closeDrawer(page)
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = 600; canvas.height = 750
      const context = canvas.getContext('2d')
      const gradient = context.createLinearGradient(0, 0, 600, 750)
      gradient.addColorStop(0, '#ab3928'); gradient.addColorStop(0.5, '#83b798'); gradient.addColorStop(1, '#3947ce')
      context.fillStyle = gradient; context.fillRect(0, 0, 600, 750)
      context.fillStyle = '#fff'; context.fillRect(294, 369, 12, 12)
      return canvas.toDataURL().split(',')[1]
    })
    await page.setInputFiles('.photo-upload', { name: 'center-test.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
    await page.locator('.live-panel img').waitFor()
    await paint(page)
    const initialPng = await exportPng(page)

    // Establish a non-centered crop, then approach the center within one drag.
    await startDrag(page)
    await moveToOffset(page, 42, 36)
    await page.mouse.up()
    await paint(page)
    const moved = await transform(page)
    assert.ok(moved.x > 0.08 && moved.y > 0.05, `${engine.name()}: setup drag did not move the photo`)
    const historyBefore = await historyCount(page)

    await startDrag(page)
    await moveToOffset(page, 3, 3)
    await expectAxes(page, true, true)
    assertCentered(await transform(page), 'near-center drag')
    await moveToOffset(page, 7, 7)
    await expectAxes(page, true, true)
    assertCentered(await transform(page), 'hysteresis should hold through a small wobble')
    await moveToOffset(page, 12, 7)
    await expectAxes(page, false, true)
    const escaped = await transform(page)
    assert.ok(escaped.x > 0.02, 'horizontal snap must be easy to leave')
    assert.equal(escaped.y, 0, 'leaving horizontal center must retain vertical centering')
    await moveToOffset(page, 4, 4)
    await expectAxes(page, true, true)
    assertCentered(await transform(page), 'both axes can reacquire center')
    await page.screenshot({ path: `test-results/photo-center-${engine.name()}.png` })
    await page.mouse.up()
    await page.locator('.photo-center-guide').waitFor({ state: 'detached' })
    await paint(page)
    assert.equal(await historyCount(page), historyBefore + 1, 'all center-snap movements must create one Undo entry')
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await paint(page)
    assertTransformsEqual(await transform(page), moved, 'Undo restores the original offset')
    await page.getByRole('button', { name: 'Redo', exact: true }).click()
    await paint(page)
    assertCentered(await transform(page), 'Redo restores exact center')
    assert.equal(await exportPng(page), initialPng, 'shared PNG must use the exact centered transform and exclude alignment guides')

    // A cancelled pointer must never leave a guide above the finished photo.
    await startDrag(page)
    await moveToOffset(page, 3, 3)
    await expectAxes(page, true, true)
    await page.locator('.live-strip').dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse', bubbles: true })
    await page.locator('.photo-center-guide').waitFor({ state: 'detached' })
    await page.mouse.up()

    // Transitioning from a centered drag into pinch hides the translation cue,
    // while preserving the existing simultaneous zoom and rotation snapping.
    const pinchHistoryBefore = await historyCount(page)
    await startDrag(page)
    await moveToOffset(page, 3, 3)
    await expectAxes(page, true, true)
    await touchPair(page, 'touchstart', 36, 0)
    await page.locator('.photo-center-guide').waitFor({ state: 'detached' })
    await touchPair(page, 'touchmove', 54, 87)
    await page.waitForFunction(() => {
      const image = document.querySelector('.live-panel img')
      return Number(image?.getAttribute('data-shot-scale')) > 1.4 && image?.getAttribute('data-shot-rotation') === '90.00'
    })
    await touchPair(page, 'touchend', 0, 0)
    await page.mouse.up()
    await paint(page)
    assert.equal(await historyCount(page), pinchHistoryBefore + 1, 'move-to-pinch remains one Undo entry')
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await paint(page)
    assertCentered(await transform(page), 'Undo pinch restores center')
    assert.equal((await transform(page)).scale, 1)
    assert.equal((await transform(page)).rotation, 0)

    const persisted = await waitForCenteredDraft(page)
    assert.equal(persisted.offsetX, 0, 'stored horizontal offset is exactly zero')
    assert.equal(persisted.offsetY, 0, 'stored vertical offset is exactly zero')
    await page.reload()
    await page.getByRole('button', { name: 'Continue editing', exact: true }).click()
    await page.locator('.live-panel img').waitFor()
    await paint(page)
    assertCentered(await transform(page), 'reloaded project remains centered')
    assert.equal(await page.locator('.photo-center-guide').count(), 0)
    assert.deepEqual(errors, [])
    console.log(`${engine.name()}: tiny center snap, independent axes, hysteresis, guide cleanup, Undo/Redo, pinch/rotation, centered PNG and saved project recovery passed`)
  } finally {
    await browser.close()
  }
}

async function paint(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}

async function transform(page) {
  return page.locator('.live-panel img').first().evaluate(image => {
    const clean = value => Math.abs(value) < 1e-8 ? 0 : value
    return {
    // Blank canvas is a full rectangle. Recover offsets from CSS percentages
    // rather than the two-decimal diagnostic attributes.
    x: clean(parseFloat(image.style.left) / 100 + parseFloat(image.style.width) / 200 - 0.5),
    y: clean(parseFloat(image.style.top) / 100 + parseFloat(image.style.height) / 200 - 0.5),
    scale: Number(image.getAttribute('data-shot-scale')),
    rotation: Number(image.getAttribute('data-shot-rotation')),
    }
  })
}

function assertCentered(value, message) {
  assert.equal(value.x, 0, `${message}: X`)
  assert.equal(value.y, 0, `${message}: Y`)
}

function assertTransformsEqual(actual, expected, message) {
  for (const key of Object.keys(expected)) assert.ok(Math.abs(actual[key] - expected[key]) < 1e-6, `${message}: ${key}`)
}

async function historyCount(page) {
  return Number(await page.locator('.native-shell').getAttribute('data-history-undo'))
}

async function startDrag(page) {
  await paint(page)
  const box = await page.locator('.live-strip').boundingBox()
  const current = await transform(page)
  const gesture = { x: box.x + box.width / 2, y: box.y + box.height / 2, width: box.width, height: box.height, offsetX: current.x, offsetY: current.y }
  page.__photoDrag = gesture
  await page.mouse.move(gesture.x, gesture.y)
  await page.mouse.down()
  await paint(page)
}

async function moveToOffset(page, x, y) {
  const gesture = page.__photoDrag
  await page.mouse.move(gesture.x + x - gesture.offsetX * gesture.width, gesture.y + y - gesture.offsetY * gesture.height, { steps: 3 })
  await paint(page)
}

async function expectAxes(page, x, y) {
  await page.waitForFunction(({ x, y }) => {
    const guide = document.querySelector('.photo-center-guide')
    return !!guide && (guide.getAttribute('data-snap-x') === 'true') === x && (guide.getAttribute('data-snap-y') === 'true') === y
  }, { x, y })
}

async function closeDrawer(page) {
  const close = page.getByRole('button', { name: 'Done editing comic', exact: true })
  if (await close.isVisible()) await close.click()
  await page.waitForFunction(() => {
    const box = document.querySelector('.motion-drawer')?.getBoundingClientRect()
    return !!box && box.top > innerHeight
  })
  await paint(page)
}

async function exportPng(page) {
  const done = page.getByRole('button', { name: /Done editing panel/ })
  if (await done.count()) await done.evaluate(button => button.click())
  await page.getByRole('button', { name: 'Open export controls', exact: true }).click()
  const [file] = await sharePreparedPhotos(page)
  await closeDrawer(page)
  return file.png
}

async function touchPair(page, type, radius, angle) {
  await page.locator('.live-strip').evaluate((surface, { type, radius, angle }) => {
    const bounds = surface.getBoundingClientRect()
    const radians = angle * Math.PI / 180
    const touches = type === 'touchend' ? [] : [-1, 1].map((side, index) => ({
      identifier: index + 11, target: surface,
      clientX: bounds.x + bounds.width / 2 + side * Math.cos(radians) * radius,
      clientY: bounds.y + bounds.height / 2 + side * Math.sin(radians) * radius,
    }))
    // WebKit does not expose a constructible Touch in its desktop test runner.
    // Its React gesture handler consumes the same coordinates from TouchLists.
    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperties(event, {
      touches: { value: touches }, targetTouches: { value: touches }, changedTouches: { value: touches },
    })
    surface.dispatchEvent(event)
  }, { type, radius, angle })
  await paint(page)
}

async function waitForCenteredDraft(page) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const shot = await page.evaluate(() => new Promise((resolve, reject) => {
      const open = indexedDB.open('instacomic')
      open.onerror = () => reject(open.error)
      open.onsuccess = () => {
        const database = open.result
        const transaction = database.transaction('drafts', 'readonly')
        const get = transaction.objectStore('drafts').get('current')
        get.onsuccess = () => resolve(get.result?.document?.shotCache?.find(Boolean) ?? null)
        get.onerror = () => reject(get.error)
        transaction.oncomplete = () => database.close()
      }
    }))
    if (shot?.offsetX === 0 && shot?.offsetY === 0 && shot?.scale === 1 && shot?.rotation === 0) return shot
    await page.waitForTimeout(100)
  }
  throw new Error('Centered project transform was not saved')
}
