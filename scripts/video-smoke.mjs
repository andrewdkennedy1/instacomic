import { statSync } from 'node:fs'
import { chromium } from 'playwright'

const baseUrl = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:4174'
const browser = await chromium.launch()
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  acceptDownloads: true,
})
const errors = []
page.on('pageerror', (error) => errors.push(error.message))

await page.addInitScript(() => {
  Object.defineProperty(navigator, 'standalone', {
    configurable: true,
    get: () => true,
  })
})

await page.goto(baseUrl, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: /9:16/ }).tap()
await page.getByRole('button', { name: 'Start' }).tap()
await page.locator('.start-screen').waitFor({ state: 'detached' })
await tapStrip(page, 0.75, 0.31)
await page.waitForFunction(() => document.querySelector('.live-panel.is-live')?.getAttribute('data-panel-id') === '2')
await page.setInputFiles('.photo-upload', {
  name: 'story-panel.png',
  mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAMAAAADCAIAAADZSiLoAAAAGklEQVR4nGP8z8DAwMDAxAADCBgYGD4DAwA8bQICbK8YJwAAAABJRU5ErkJggg==',
    'base64',
  ),
})
await page.waitForFunction(() => document.querySelector('[data-panel-id="2"] img'))

await openDrawer(page)
await page.getByRole('button', { name: 'Save', exact: true }).tap()
await page.getByText('Story video').waitFor({ state: 'visible' })
const videoConfigVisible = await page.getByText('Story video').isVisible()
await setRangeValue(page, 'Video duration', '3')
await setRangeValue(page, 'Video speed', '1.8')
await closeDrawer(page)

const captureBarFits = await page.locator('.capture-bar').evaluate((bar) => {
  const barBox = bar.getBoundingClientRect()
  const buttons = [...bar.querySelectorAll('button')].map((button) => button.getBoundingClientRect())
  return buttons.every((button) => button.left >= barBox.left - 1 && button.right <= barBox.right + 1)
})

const downloadPromise = page.waitForEvent('download', { timeout: 45000 })
await page.getByRole('button', { name: 'Export story video' }).tap()
await page.locator('.video-render-progress').waitFor({ state: 'visible', timeout: 5000 })
await page.waitForFunction(
  () => Number(document.querySelector('.video-render-progress')?.getAttribute('aria-valuenow') ?? '0') > 0,
  undefined,
  { timeout: 15000 },
)
const progressBarValue = Number(await page.locator('.video-render-progress').getAttribute('aria-valuenow'))
const progressText = await page.locator('.video-render-progress em').textContent()
const download = await downloadPromise
const downloadPath = await download.path()
const fileSize = downloadPath ? statSync(downloadPath).size : 0
const status = await page.locator('.sr-status').textContent()
const result = {
  suggestedFilename: download.suggestedFilename(),
  fileSize,
  videoConfigVisible,
  captureBarFits,
  progressBarValue,
  progressText,
  status,
  errors,
}

await browser.close()
console.log(JSON.stringify(result, null, 2))

const failures = [
  /\.(mp4|webm)$/.test(result.suggestedFilename) ? null : 'story video export did not produce an MP4/WebM file',
  result.fileSize > 2048 ? null : 'story video export produced an empty or tiny file',
  result.videoConfigVisible ? null : 'story video configuration is not visible in the save drawer',
  result.captureBarFits ? null : 'capture bar buttons do not fit after adding video export',
  Number.isFinite(result.progressBarValue) && result.progressBarValue > 0 && result.progressBarValue <= 100
    ? null
    : 'story video progress bar did not expose advancing render progress',
  /Rendering/i.test(result.progressText ?? '') ? null : 'story video progress bar did not show render text',
  /story video/i.test(result.status ?? '') ? null : 'story video status was not surfaced',
  result.errors.length === 0 ? null : `page errors: ${result.errors.join('; ')}`,
].filter(Boolean)

if (failures.length > 0) {
  throw new Error(failures.join('\n'))
}

async function tapStrip(page, nx, ny) {
  const box = await page.locator('.live-strip').boundingBox()
  await page.mouse.click(box.x + box.width * nx, box.y + box.height * ny)
}

async function setRangeValue(page, label, value) {
  await page.getByLabel(label).evaluate(
    (input, nextValue) => {
      input.value = nextValue
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    },
    value,
  )
}

async function openDrawer(page) {
  await page.locator('.capture-bar button[aria-label="Controls"]').tap()
  try {
    await page.locator('.motion-drawer.is-open').waitFor({ timeout: 1200 })
  } catch {
    await page.locator('.capture-bar button[aria-label="Controls"]').evaluate((button) => button.click())
    await page.locator('.motion-drawer.is-open').waitFor()
  }
}

async function closeDrawer(page) {
  const open = await page.locator('.motion-drawer.is-open').count()
  if (open > 0) {
    await page.locator('.motion-drawer.is-open .drawer-grabber').evaluate((button) => button.click())
  }
  await page.waitForFunction(() => {
    const box = document.querySelector('.motion-drawer')?.getBoundingClientRect()
    return !!box && box.top > window.innerHeight
  })
}
