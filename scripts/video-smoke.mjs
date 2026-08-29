import { readFileSync, statSync } from 'node:fs'
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
await page.getByRole('button', { name: 'Start creating' }).tap()
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

const headerExport = page.getByRole('button', { name: 'Open export controls' })
await headerExport.tap()
const exportDrawer = page.getByRole('dialog', { name: 'Export comic' })
await exportDrawer.waitFor({ state: 'visible' })
const exportTab = exportDrawer.getByRole('tab', { name: 'Export', exact: true })
const exportTabSelected = (await exportTab.getAttribute('aria-selected')) === 'true'
const storyVideoCard = exportDrawer.locator('.export-card.video-settings')
await storyVideoCard.getByText('Story video', { exact: true }).waitFor({ state: 'visible' })
const videoConfigVisible = await storyVideoCard.isVisible()
await setRangeValue(page, 'Video duration', '3')
await setRangeValue(page, 'Video speed', '1.8')
const configuredDuration = await page.getByLabel('Video duration').inputValue()
const configuredSpeed = await page.getByLabel('Video speed').inputValue()

const captureBarFits = await page.locator('.capture-bar').evaluate((bar) => {
  const barBox = bar.getBoundingClientRect()
  const buttons = [...bar.querySelectorAll('button')].map((button) => button.getBoundingClientRect())
  return buttons.every((button) => button.left >= barBox.left - 1 && button.right <= barBox.right + 1)
})

const observedDownloads = []
page.on('download', (download) => observedDownloads.push(download))
await storyVideoCard.getByRole('button', { name: 'Export story video' }).tap()
await page.locator('.video-render-progress').waitFor({ state: 'visible', timeout: 5000 })
await page.evaluate(() => {
  window.__instacomicVideoProgressSamples = []
  window.__instacomicVideoProgressTimer = window.setInterval(() => {
    const progress = document.querySelector('.video-render-progress')
    if (!progress) {
      return
    }

    window.__instacomicVideoProgressSamples.push({
      value: Number(progress.getAttribute('aria-valuenow') ?? '0'),
      text: progress.textContent ?? '',
    })
  }, 50)
})
await page.waitForFunction(
  () => Number(document.querySelector('.video-render-progress')?.getAttribute('aria-valuenow') ?? '0') > 0,
  undefined,
  { timeout: 15000 },
)
const progressBarValue = Number(await page.locator('.video-render-progress').getAttribute('aria-valuenow'))
const progressText = await page.locator('.video-render-progress em').textContent()
await page.locator('.video-ready-card').waitFor({ state: 'visible', timeout: 45000 })
await page.waitForTimeout(200)
const autoDownloadCount = observedDownloads.length
const readyCardVisible = await page.locator('.video-ready-card').isVisible()
const readyActionCount = await page.locator('.video-ready-actions button').count()
const manualDownloadPromise = page.waitForEvent('download', { timeout: 15000 })
await page.getByRole('button', { name: 'Download video' }).tap()
const manualDownload = await manualDownloadPromise
const manualDownloadPath = await manualDownload.path()
const manualFileSize = manualDownloadPath ? statSync(manualDownloadPath).size : 0
const manualFileIsMp4 = manualDownloadPath ? isMp4File(manualDownloadPath) : false
const explicitDownloadCount = observedDownloads.length
const progressSamples = await page.evaluate(() => {
  window.clearInterval(window.__instacomicVideoProgressTimer)
  return window.__instacomicVideoProgressSamples
})
const status = await page.locator('#app-status').textContent()
const result = {
  suggestedFilename: manualDownload.suggestedFilename(),
  fileSize: manualFileSize,
  fileIsMp4: manualFileIsMp4,
  manualSuggestedFilename: manualDownload.suggestedFilename(),
  manualFileSize,
  manualFileIsMp4,
  exportTabSelected,
  videoConfigVisible,
  configuredDuration,
  configuredSpeed,
  captureBarFits,
  autoDownloadCount,
  explicitDownloadCount,
  progressBarValue,
  progressText,
  sawFinalizing: progressSamples.some((sample) => /Finalizing/i.test(sample.text)),
  maxProgress: Math.max(...progressSamples.map((sample) => sample.value)),
  readyCardVisible,
  readyActionCount,
  status,
  errors,
}

await browser.close()
console.log(JSON.stringify(result, null, 2))

const failures = [
  /\.mp4$/.test(result.suggestedFilename) ? null : 'story video export did not produce an MP4 file',
  result.fileSize > 2048 ? null : 'story video export produced an empty or tiny file',
  result.fileIsMp4 ? null : 'story video export did not produce MP4 bytes',
  result.manualFileSize > 2048 ? null : 'manual video download fallback produced an empty or tiny file',
  result.manualFileIsMp4 ? null : 'manual video download fallback did not produce MP4 bytes',
  result.exportTabSelected ? null : 'header Export control did not open the Export tab',
  result.videoConfigVisible ? null : 'story video configuration is not visible in the Export drawer',
  result.configuredDuration === '3' && result.configuredSpeed === '1.8' ? null : 'story video settings did not update in the Export drawer',
  result.captureBarFits ? null : 'capture bar buttons do not fit after adding video export',
  result.autoDownloadCount === 0 ? null : 'story video downloaded automatically before the explicit Download action',
  result.explicitDownloadCount === 1 ? null : 'explicit Download action did not produce exactly one download',
  Number.isFinite(result.progressBarValue) && result.progressBarValue > 0 && result.progressBarValue <= 100
    ? null
    : 'story video progress bar did not expose advancing render progress',
  /Rendering/i.test(result.progressText ?? '') ? null : 'story video progress bar did not show render text',
  result.sawFinalizing ? null : 'story video progress never entered a finalizing state',
  result.maxProgress < 100 ? null : 'story video progress reached 100 before the ready state',
  result.readyCardVisible ? null : 'story video ready fallback did not appear',
  result.readyActionCount >= 2 ? null : 'story video ready fallback is missing actions',
  /video ready/i.test(result.status ?? '') ? null : 'story video ready status was not surfaced',
  result.errors.length === 0 ? null : `page errors: ${result.errors.join('; ')}`,
].filter(Boolean)

if (failures.length > 0) {
  throw new Error(failures.join('\n'))
}

function isMp4File(path) {
  const buffer = readFileSync(path)
  return buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp'
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
