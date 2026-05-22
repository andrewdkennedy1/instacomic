import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
})
const baseUrl = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:4174'
const errors = []
page.on('pageerror', (error) => errors.push(error.message))

await page.goto(baseUrl, { waitUntil: 'networkidle' })
await tapStrip(page, 0.75, 0.31)
const hint = await page.locator('.top-hint span').textContent()

await page.locator('.top-hint button').tap()
await page.getByRole('button', { name: 'Stickers' }).tap()
await page.getByRole('button', { name: 'speech' }).tap()
const stickerCount = await page.locator('[data-sticker-id]').count()
await page.locator('.top-hint button').tap()
await page.getByRole('button', { name: 'Stickers' }).tap()
await page.locator('input[placeholder="Add or tap a sticker"]').fill('hello!')
await page.getByRole('button', { name: 'Close controls' }).tap()
await page.locator('[data-sticker-id]').scrollIntoViewIfNeeded()
const before = await page.locator('[data-sticker-id]').boundingBox()
if (before) {
  const client = await page.context().newCDPSession(page)
  const start = { x: before.x + before.width / 2, y: before.y + before.height / 2 }
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

await page.getByRole('button', { name: 'Save' }).tap()
await page.getByRole('button', { name: 'Render' }).tap()
await page.waitForFunction(() => document.querySelector('a[download="instacomic.png"]')?.getAttribute('href')?.startsWith('blob:'))
const saveHref = await page.locator('a[download="instacomic.png"]').getAttribute('href')
const manifest = await (await page.request.get(new URL('/manifest.webmanifest', baseUrl).toString())).json()
const bodyOverflow = await page.evaluate(() => getComputedStyle(document.body).overflow)
await page.getByRole('button', { name: 'Create' }).tap()
await tapCreator(page, 0.08, 0.08)
await tapCreator(page, 0.92, 0.12)
await tapCreator(page, 0.48, 0.46)
await page.getByRole('button', { name: 'Save layout' }).tap()
const storedLayouts = await page.evaluate(() => JSON.parse(localStorage.getItem('instacomic.customLayouts.v1') ?? '[]').length)
const title = await page.title()

mkdirSync('test-results', { recursive: true })
await page.screenshot({ path: 'test-results/instacomic-mobile.png', fullPage: true })
await browser.close()

console.log(
  JSON.stringify(
    {
      title,
      hint,
      stickerCount,
      moved: !!before && !!after && Math.abs(before.x - after.x) > 5,
      saveHref: saveHref?.startsWith('blob:') ?? false,
      manifestName: manifest.name,
      bodyOverflow,
      storedLayouts,
      errors,
    },
    null,
    2,
  ),
)

async function tapStrip(page, nx, ny) {
  const box = await page.locator('.live-strip').boundingBox()
  await page.mouse.click(box.x + box.width * nx, box.y + box.height * ny)
}

async function tapCreator(page, nx, ny) {
  const box = await page.locator('.creator-canvas').boundingBox()
  await page.locator('.creator-canvas').tap({ position: { x: box.width * nx, y: box.height * ny } })
}
