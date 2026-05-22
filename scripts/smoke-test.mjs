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
await page.locator('[data-panel-id="2"]').tap()
const target = await page.locator('.camera-target').textContent()

await page.locator('[data-sticker-kind="speech"]').tap()
const stickerCount = await page.locator('[data-sticker-id]').count()
await page.locator('.sticker-text-input').fill('hello!')
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

await page.locator('.export-button').tap()
await page.waitForFunction(() => document.querySelector('.save-link')?.getAttribute('href')?.startsWith('blob:'))
const saveHref = await page.locator('.save-link').getAttribute('href')
const manifest = await (await page.request.get(new URL('/manifest.webmanifest', baseUrl).toString())).json()
const title = await page.title()

mkdirSync('test-results', { recursive: true })
await page.screenshot({ path: 'test-results/instacomic-mobile.png', fullPage: true })
await browser.close()

console.log(
  JSON.stringify(
    {
      title,
      target,
      stickerCount,
      moved: !!before && !!after && Math.abs(before.x - after.x) > 5,
      saveHref: saveHref?.startsWith('blob:') ?? false,
      manifestName: manifest.name,
      errors,
    },
    null,
    2,
  ),
)
