import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { chromium, webkit } from 'playwright'
import { installNativeShare, sharePreparedPhotos } from './native-share-fixture.mjs'

mkdirSync('test-results', { recursive: true })
const baseUrl = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:4174'

async function uploadColor(page, color) {
  const png = await page.evaluate(color => {
    const canvas = document.createElement('canvas')
    canvas.width = 720; canvas.height = 900
    const context = canvas.getContext('2d')
    context.fillStyle = color; context.fillRect(0, 0, canvas.width, canvas.height)
    return canvas.toDataURL().split(',')[1]
  }, color)
  const existing = page.locator('.live-panel img').first()
  const previous = await existing.count() ? await existing.getAttribute('src') : null
  if (previous) await page.locator('.live-panel').first().click()
  await page.setInputFiles('.photo-upload', { name: `${color.slice(1)}.png`, mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
  await page.waitForFunction(previous => {
    const img = document.querySelector('.live-panel img')
    return img && img.src !== previous && img.complete && img.naturalWidth > 0
  }, previous)
}

async function openTab(page, name) {
  const photoDone = page.getByRole('button', { name: /Done editing panel/ })
  if (await photoDone.count()) await photoDone.click()
  if (!await page.getByRole('tab', { name, exact: true }).isVisible()) await page.getByRole('button', { name: 'Controls', exact: true }).click()
  await page.getByRole('tab', { name, exact: true }).click()
}

async function pixelColors(page, entries) {
  return page.evaluate(entries => Promise.all(entries.map(async entry => {
    const img = new Image(); img.src = `data:image/png;base64,${entry.png}`; await img.decode()
    const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1
    const context = canvas.getContext('2d')
    context.drawImage(img, img.width / 2, img.height / 2, 1, 1, 0, 0, 1, 1)
    return [...context.getImageData(0, 0, 1, 1).data]
  })), entries)
}

for (const engine of [chromium, webkit]) {
  const browser = await engine.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    await installNativeShare(page)
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(baseUrl)
    await page.getByRole('button', { name: 'Start creating', exact: true }).click()
    await page.getByRole('button', { name: 'Done editing comic', exact: true }).click()
    await uploadColor(page, '#ed7253')
    await openTab(page, 'Slides')
    await page.getByRole('button', { name: 'Add slide', exact: true }).click()
    await uploadColor(page, '#46a078')
    await page.getByRole('button', { name: 'Add slide', exact: true }).click()
    await uploadColor(page, '#4083b8')
    assert.equal(await page.getByRole('button', { name: 'Edit slide 3', exact: true }).getAttribute('aria-current'), 'true')
    await openTab(page, 'Export')
    const first = await sharePreparedPhotos(page, 3)
    assert.deepEqual(first.map(file => file.name), ['slide-01.png', 'slide-02.png', 'slide-03.png'])
    assert.deepEqual(await pixelColors(page, first), [[237, 114, 83, 255], [70, 160, 120, 255], [64, 131, 184, 255]], 'Sharing from the final slide must include the entire carousel in order')
    assert.equal(await page.getByRole('button', { name: /Download|ZIP|video|animation/i }).count(), 0)
    await page.screenshot({ path: `test-results/native-share-${engine.name()}.png` })

    // Cancel and an OS-level failure leave the prepared images available for retry.
    await page.evaluate(() => { window.__nativeShareMode = 'abort' })
    const cancelled = await sharePreparedPhotos(page, 3)
    assert.deepEqual(cancelled.map(file => file.png), first.map(file => file.png))
    await page.getByText('Sharing canceled. Your photos are ready whenever you are.', { exact: true }).waitFor()
    await page.evaluate(() => { window.__nativeShareMode = 'reject' })
    await sharePreparedPhotos(page, 3)
    await page.getByText('Sharing did not finish. Try again, or share the photos individually below.', { exact: true }).waitFor()
    assert.equal(await page.locator('.individual-share-photos img').count(), 3)
    await page.evaluate(() => { window.__nativeShareMode = 'resolve' })
    const retried = await sharePreparedPhotos(page, 3)
    assert.deepEqual(retried.map(file => file.png), first.map(file => file.png))
    await page.evaluate(() => { window.__nativeShareMode = 'pending' })
    await sharePreparedPhotos(page, 3)
    await page.getByRole('button', { name: 'Back from sharing', exact: true }).click()
    await page.evaluate(() => { window.__nativeShareMode = 'resolve' })
    await sharePreparedPhotos(page, 3)

    // Reopening export must rebuild from the latest active slide instead of
    // retaining files prepared before the photo changed.
    await page.getByRole('button', { name: 'Done editing comic', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.motion-drawer').getBoundingClientRect().top > innerHeight)
    await uploadColor(page, '#e9bb48')
    await openTab(page, 'Export')
    const fresh = await sharePreparedPhotos(page, 3)
    assert.deepEqual(await pixelColors(page, fresh), [[237, 114, 83, 255], [70, 160, 120, 255], [233, 187, 72, 255]])
    assert.deepEqual(errors, [])
    await page.close()

    // An unsupported browser still exposes every rendered photo without
    // creating ZIPs, triggering file downloads, or hiding all but the last slide.
    const unsupported = await browser.newPage({ viewport: { width: 390, height: 844 } })
    await installNativeShare(unsupported, { supported: false })
    await unsupported.goto(baseUrl)
    await unsupported.getByRole('button', { name: 'Start creating', exact: true }).click()
    await unsupported.getByRole('button', { name: 'Done editing comic', exact: true }).click()
    await uploadColor(unsupported, '#ed7253')
    await openTab(unsupported, 'Slides')
    await unsupported.getByRole('button', { name: 'Add slide', exact: true }).click()
    await uploadColor(unsupported, '#4083b8')
    await openTab(unsupported, 'Export')
    await unsupported.locator('.individual-share-photos img').nth(1).waitFor()
    assert.equal(await unsupported.locator('.individual-share-photos img').count(), 2)
    for (let index = 0; index < 2; index++) {
      const photo = unsupported.locator('.individual-share-photos img').nth(index)
      await photo.scrollIntoViewIfNeeded()
      await unsupported.waitForFunction(index => {
        const img = document.querySelectorAll('.individual-share-photos img')[index]
        return img.complete && img.naturalWidth > 0
      }, index)
    }
    await unsupported.locator('.drawer-content').evaluate(drawer => { drawer.scrollTop = 0 })
    assert.deepEqual(await unsupported.evaluate(() => window.__nativeDownloadAttempts), [])
    assert.equal(await unsupported.getByRole('button', { name: /Download|ZIP|video|animation/i }).count(), 0)
    await unsupported.screenshot({ path: `test-results/native-share-unsupported-${engine.name()}.png` })
    await unsupported.close()
    console.log(`${engine.name()}: all-slide native sharing, final-slide regression, ordered PNG pixels, direct activation, cancellation/failure retry, fresh export, unsupported photo previews passed`)
  } finally { await browser.close() }
}
