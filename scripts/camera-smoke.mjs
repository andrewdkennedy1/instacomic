import { chromium } from 'playwright'

const baseUrl = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:4174'
const origin = new URL(baseUrl).origin
const browser = await chromium.launch({
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
})
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
})
await context.grantPermissions(['camera'], { origin })
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))

await page.goto(baseUrl, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: 'Start' }).tap()
await tapStrip(page, 0.75, 0.31)
await page.waitForFunction(() => document.querySelector('.live-frame'))
const liveFrameBefore = await page.locator('[data-panel-id="2"] .live-frame').count()
await page.locator('.shutter').tap()
await page.waitForFunction(() => document.querySelector('[data-panel-id="2"] img'))
await page.locator('.shutter').tap()
await page.waitForFunction(() => document.querySelector('[data-panel-id="3"] img'))
await page.locator('.shutter').tap()
await page.waitForFunction(() => document.querySelector('[data-panel-id="4"] img'))
await page.locator('.shutter').tap()
await page.waitForFunction(() => document.querySelector('[data-panel-id="5"] img'))

const result = {
  title: await page.title(),
  liveFrameBefore,
  panel2HasImage: await page.locator('[data-panel-id="2"] img').count(),
  panel5HasImage: await page.locator('[data-panel-id="5"] img').count(),
  activePanelAfterFinalCapture: await page.locator('.live-panel.is-live').count(),
  liveFrameAfterFinalCapture: await page.locator('.live-frame').count(),
  errors,
}

await browser.close()
console.log(JSON.stringify(result, null, 2))

const failures = [
  result.liveFrameBefore === 1 ? null : 'panel 2 did not become live before capture',
  result.panel2HasImage === 1 ? null : 'panel 2 did not keep the captured image',
  result.panel5HasImage === 1 ? null : 'last panel did not keep the captured image',
  result.activePanelAfterFinalCapture === 0 ? null : 'a panel stayed live after the final forward capture',
  result.liveFrameAfterFinalCapture === 0 ? null : 'live preview still covered the final captured photo',
  result.errors.length === 0 ? null : `page errors: ${result.errors.join('; ')}`,
].filter(Boolean)

if (failures.length > 0) {
  throw new Error(failures.join('\n'))
}

async function tapStrip(page, nx, ny) {
  const box = await page.locator('.live-strip').boundingBox()
  await page.mouse.click(box.x + box.width * nx, box.y + box.height * ny)
}
