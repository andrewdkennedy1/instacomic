import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  acceptDownloads: true,
})
const baseUrl = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:4174'
const errors = []
page.on('pageerror', (error) => errors.push(error.message))

await page.goto(baseUrl, { waitUntil: 'networkidle' })
await tapStrip(page, 0.75, 0.31)
const selectedPanel = await page.locator('.live-panel.is-live').getAttribute('data-panel-id')

await page.getByRole('button', { name: 'Open drawer' }).tap()
await page.getByRole('button', { name: 'Stickers' }).tap()
await page.getByRole('button', { name: 'speech' }).tap()
const stickerCount = await page.locator('[data-sticker-id]').count()
await page.locator('.sticker-text').tap()
await page.getByLabel('Edit sticker text').fill('hello!')
await page.getByLabel('Edit sticker text').press('Enter')
const stickerText = await page.locator('.sticker-text').textContent()
await page.locator('[data-sticker-id]').scrollIntoViewIfNeeded()
const before = await page.locator('[data-sticker-id]').boundingBox()
if (before) {
  const client = await page.context().newCDPSession(page)
  const start = { x: before.x + before.width / 2, y: before.y + before.height * 0.88 }
  const end = { x: start.x + 70, y: start.y + 80 }
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ ...start, id: 1 }],
  })
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: start.x + 35, y: start.y + 40, id: 1 }],
  })
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ ...end, id: 1 }],
  })
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}
const after = await page.locator('[data-sticker-id]').boundingBox()
const pinchBefore = await page.locator('[data-sticker-id]').boundingBox()
if (pinchBefore) {
  const client = await page.context().newCDPSession(page)
  const y = pinchBefore.y + pinchBefore.height / 2
  const left = { x: pinchBefore.x + pinchBefore.width * 0.25, y }
  const right = { x: pinchBefore.x + pinchBefore.width * 0.75, y }
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { ...left, id: 1 },
      { ...right, id: 2 },
    ],
  })
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { x: left.x - 32, y, id: 1 },
      { x: right.x + 32, y, id: 2 },
    ],
  })
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}
const pinchAfter = await page.locator('[data-sticker-id]').boundingBox()

await page.getByRole('button', { name: 'Save' }).tap()
const download = await Promise.all([
  page.waitForEvent('download'),
  page.getByRole('button', { name: 'Save Image' }).tap(),
]).then(([download]) => download)
const manifest = await (await page.request.get(new URL('/manifest.webmanifest', baseUrl).toString())).json()
const bodyOverflow = await page.evaluate(() => getComputedStyle(document.body).overflow)
await page.getByRole('button', { name: 'Create' }).tap()
await dragCreatorLine(page, '.creator-line-vertical', 44, 0)
await page.getByRole('button', { name: 'Save layout' }).tap()
const storedLayouts = await page.evaluate(() => JSON.parse(localStorage.getItem('instacomic.customLayouts.v1') ?? '[]').length)
const title = await page.title()

mkdirSync('test-results', { recursive: true })
mkdirSync('docs', { recursive: true })
try {
  await page.getByRole('button', { name: 'Close controls' }).tap({ timeout: 1000 })
} catch {
  // The sheet may already be collapsed after the save flow.
}
await page.screenshot({ path: 'test-results/instacomic-mobile.png', fullPage: true })
await page.screenshot({ path: 'docs/instacomic-mobile.png', fullPage: true })
await browser.close()

const result = {
  title,
  selectedPanel,
  stickerCount,
  stickerText,
  moved: !!before && !!after && Math.abs(before.x - after.x) > 5,
  pinched: !!pinchBefore && !!pinchAfter && pinchAfter.width > pinchBefore.width + 8,
  savedFile: download.suggestedFilename(),
  manifestName: manifest.name,
  bodyOverflow,
  storedLayouts,
  errors,
}

console.log(JSON.stringify(result, null, 2))

const failures = [
  result.selectedPanel === '2' ? null : 'panel selection did not land on panel 2',
  result.stickerCount === 1 ? null : 'speech sticker was not added',
  result.stickerText?.trim().toLowerCase() === 'hello!' ? null : 'inline sticker text edit failed',
  result.moved ? null : 'sticker drag failed',
  result.pinched ? null : 'sticker pinch resize failed',
  result.savedFile === 'instacomic.png' ? null : 'one-tap save did not download instacomic.png',
  result.manifestName === 'Instacomic' ? null : 'manifest did not load',
  result.bodyOverflow === 'hidden' ? null : 'body is scrollable',
  result.storedLayouts > 0 ? null : 'custom divider layout was not saved',
  result.errors.length === 0 ? null : `page errors: ${result.errors.join('; ')}`,
].filter(Boolean)

if (failures.length > 0) {
  throw new Error(failures.join('\n'))
}

async function tapStrip(page, nx, ny) {
  const box = await page.locator('.live-strip').boundingBox()
  await page.mouse.click(box.x + box.width * nx, box.y + box.height * ny)
}

async function dragCreatorLine(page, selector, dx, dy) {
  const box = await page.locator(selector).first().boundingBox()
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 8 })
  await page.mouse.up()
}
