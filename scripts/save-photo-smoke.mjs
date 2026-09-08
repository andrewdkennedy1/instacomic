import { chromium } from 'playwright'
import { installNativeShare, sharePreparedPhotos } from './native-share-fixture.mjs'

const browser = await chromium.launch()
const baseUrl = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:4174'
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  acceptDownloads: true,
})
const errors = []
page.on('pageerror', (error) => errors.push(error.message))

try {
  await installNativeShare(page)
  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Start creating' }).tap()
  await page.getByRole('button', { name: 'Use Shard layout, 5 panels', exact: true }).click()
  await page.getByRole('button', { name: 'Done editing comic', exact: true }).click()
  await page.locator('.start-screen').waitFor({ state: 'detached' })

  const exportChecks = []
  for (let panelNumber = 1; panelNumber <= 5; panelNumber += 1) {
    await page.setInputFiles('.photo-upload', testImage(`panel-${panelNumber}.png`))
    await page.locator(`[data-panel-id="${panelNumber}"] img`).waitFor()
    if (panelNumber >= 3) {
      await waitForSavedPhotoCount(page, panelNumber)
      exportChecks.push(await sharePng(page, panelNumber))
    }
  }

  const photosBeforeSave = await page.locator('.live-panel img').count()
  await waitForSavedPhotoCount(page, 5)
  await openLayoutDrawer(page)
  await page.getByRole('button', { name: /New grid/ }).tap()
  await page.locator('.creator-fullscreen').waitFor()
  const newGridPanelCount = await page.locator('.creator-panel').count()
  await page.getByRole('tab', { name: 'Details', exact: true }).tap()
  await page.getByLabel('Grid name').fill('Four Panel Grid')
  await page.getByRole('button', { name: 'Save layout' }).tap()
  await page.locator('.creator-fullscreen').waitFor({ state: 'detached' })

  const photosAfterSave = await page.locator('.live-panel img').count()
  const layoutAfterSave = await page.locator('.live-strip').getAttribute('data-layout-name')
  const saveStatus = await page.locator('#app-status').innerText()
  const storedGrid = await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('instacomic.customLayouts.v1') ?? '[]')
    return stored.find((layout) => layout.name === 'Four Panel Grid') ?? null
  })

  await waitForSavedPhotoCount(page, 5)
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Continue editing' }).tap()
  await page.locator('.start-screen').waitFor({ state: 'detached' })
  const photosAfterReload = await page.locator('.live-panel img').count()
  const layoutAfterReload = await page.locator('.live-strip').getAttribute('data-layout-name')

  const result = {
    photosBeforeSave,
    exportChecks,
    newGridPanelCount,
    photosAfterSave,
    layoutAfterSave,
    saveStatus,
    storedGridPanelCount: storedGrid?.panels?.length ?? 0,
    photosAfterReload,
    layoutAfterReload,
    errors,
  }
  console.log(JSON.stringify(result, null, 2))

  const failures = [
    photosBeforeSave === 5 ? null : 'setup did not fill all five panels',
    exportChecks.every((check, index) => check.expectedPhotos === index + 3 && check.visiblePhotos === index + 3)
      ? null
      : 'saving at three, four, or five photos changed the visible photo count',
    exportChecks.every((check) => check.sharedBytes > 1000)
      ? null
      : 'one of the three-, four-, or five-photo PNG shares was empty',
    exportChecks.every((check) => check.downloadActionCount === 0 && check.shareActionCount === 1)
      ? null
      : 'export must provide one Share action and no Download action',
    exportChecks.every((check) => check.compactActionsFit)
      ? null
      : 'share action overflows on a compact phone',
    newGridPanelCount === 4 ? null : 'regression setup no longer creates a four-panel grid',
    photosAfterSave === 5 ? null : 'saving a smaller grid removed the latest visible photo',
    layoutAfterSave === 'Shard' ? null : 'the incompatible saved grid replaced the active comic layout',
    storedGrid?.panels?.length === 4 ? null : 'the smaller grid was not saved to the grid library',
    saveStatus.includes('kept') && saveStatus.includes('5 photos') ? null : 'save did not explain why the current grid was kept',
    photosAfterReload === 5 ? null : 'the latest photo was missing after save and reload',
    layoutAfterReload === 'Shard' ? null : 'reload did not restore the photo-safe active layout',
    errors.length === 0 ? null : `page errors: ${errors.join('; ')}`,
  ].filter(Boolean)

  if (failures.length > 0) {
    throw new Error(failures.join('\n'))
  }
} finally {
  await browser.close()
}

function testImage(name) {
  return {
    name,
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAMAAAADCAIAAADZSiLoAAAAGklEQVR4nGP8z8DAwMDAxAADCBgYGD4DAwA8bQICbK8YJwAAAABJRU5ErkJggg==',
      'base64',
    ),
  }
}

async function openLayoutDrawer(page) {
  await page.getByRole('button', { name: 'Controls', exact: true }).tap()
  await page.locator('.motion-drawer.is-open').waitFor()
  await page.getByRole('tab', { name: 'Layout', exact: true }).tap()
}

async function sharePng(page, expectedPhotos) {
  await page.getByRole('button', { name: 'Open export controls' }).tap()
  await page.locator('.motion-drawer.is-open').waitFor()
  await page.getByRole('tab', { name: 'Export', exact: true }).tap()
  const shareAction = page.getByRole('button', { name: 'Share 1 photo', exact: true })
  await shareAction.waitFor({ state: 'visible' })
  const downloadActionCount = await page.getByRole('button', { name: /Download|Export PNG|ZIP/ }).count()
  const shareActionCount = await shareAction.count()
  let compactActionsFit = true
  if (expectedPhotos === 5) {
    const { mkdirSync } = await import('node:fs')
    mkdirSync('test-results', { recursive: true })
    await page.screenshot({ path: 'test-results/export-save.png', fullPage: true })
    await page.setViewportSize({ width: 280, height: 568 })
    await page.waitForTimeout(100)
    compactActionsFit = await page.locator('.photo-share-card').evaluate((actions) => {
      const container = actions.getBoundingClientRect()
      return (
        document.documentElement.scrollWidth <= innerWidth + 1 &&
        [...actions.querySelectorAll('button')].every((button) => {
          const box = button.getBoundingClientRect()
          return box.left >= container.left - 1 && box.right <= container.right + 1 && box.height >= 44
        })
      )
    })
    await page.screenshot({ path: 'test-results/export-save-small.png', fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
  }
  const [shared] = await sharePreparedPhotos(page)
  const sharedBytes = shared.size
  const visiblePhotos = await page.locator('.live-panel img').count()
  await page.getByRole('button', { name: 'Done editing comic', exact: true }).tap()
  await page.locator('.motion-drawer.is-open').waitFor({ state: 'detached' })
  return { expectedPhotos, visiblePhotos, sharedBytes, downloadActionCount, shareActionCount, compactActionsFit }
}

async function readDraft(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('instacomic')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const database = request.result
          const transaction = database.transaction('drafts', 'readonly')
          const get = transaction.objectStore('drafts').get('current')
          get.onerror = () => reject(get.error)
          get.onsuccess = () => resolve(get.result ?? null)
          transaction.oncomplete = () => database.close()
        }
      }),
  )
}

async function waitForSavedPhotoCount(page, expectedCount) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const record = await readDraft(page)
    if (record?.document?.shotCache?.filter(Boolean).length === expectedCount) return record
    await page.waitForTimeout(100)
  }
  throw new Error(`Expected ${expectedCount} saved photos`)
}
