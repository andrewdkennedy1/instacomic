import { mkdirSync, readFileSync } from 'node:fs'
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
const formatOptionCount = await page.locator('.format-option').count()
await page.getByRole('button', { name: /9:16/ }).tap()
const selectedFormat = await page.locator('.format-option.active strong').textContent()
await page.getByRole('button', { name: 'Start' }).tap()
await tapStrip(page, 0.75, 0.31)
const selectedPanel = await page.locator('.live-panel.is-live').getAttribute('data-panel-id')
await page.setInputFiles('.photo-upload', {
  name: 'panel.png',
  mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAMAAAADCAIAAADZSiLoAAAAGklEQVR4nGP8z8DAwMDAxAADCBgYGD4DAwA8bQICbK8YJwAAAABJRU5ErkJggg==',
    'base64',
  ),
})
await page.waitForFunction(() => document.querySelector('[data-panel-id="2"] img'))
const uploadedPhoto = await page.locator('[data-panel-id="2"] img').count()
const photoBefore = await photoTransform(page, '2')
await dragPanelPhoto(page, 0.75, 0.31, 42, -28)
const photoAfterDrag = await photoTransform(page, '2')
await pinchPanelPhoto(page, 0.75, 0.31)
const photoAfterPinch = await photoTransform(page, '2')
await page.locator('[data-panel-id="3"]').evaluate((button) => button.click())
await page.setInputFiles('.photo-upload', {
  name: 'panel-2.png',
  mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAMAAAADCAIAAADZSiLoAAAAGklEQVR4nGP8z8DAwMDAxAADCBgYGD4DAwA8bQICbK8YJwAAAABJRU5ErkJggg==',
    'base64',
  ),
})
await page.waitForFunction(() => document.querySelector('[data-panel-id="3"] img'))
await openDrawer(page)
await page.getByRole('button', { name: 'Layout' }).tap()
await page.getByRole('button', { name: /Story/ }).tap()
const photosAfterSmallerTemplate = await page.locator('.live-panel img').count()
await page.getByRole('button', { name: /Shard/ }).tap()
const photosAfterRestoredTemplate = await page.locator('.live-panel img').count()
await closeDrawer(page)

await openDrawer(page)
await page.getByRole('button', { name: 'Stickers' }).tap()
await page.getByRole('button', { name: 'speech' }).tap()
const stickerCount = await page.locator('[data-sticker-id]').count()
await page.waitForFunction(() => {
  const box = document.querySelector('.motion-drawer')?.getBoundingClientRect()
  return !!box && box.top > window.innerHeight
})
const drawerHidden = await page.locator('.motion-drawer').boundingBox().then((box) => box && box.y > 830)
await page.locator('.sticker-text').tap()
await page.getByLabel('Edit sticker text').fill('hello from inside this bubble')
await page.getByLabel('Edit sticker text').press('Enter')
await tapStrip(page, 0.12, 0.9)
await page.locator('.sticker-text').tap()
await page.getByLabel('Edit sticker text').fill('again with wrapped story text')
await page.getByLabel('Edit sticker text').press('Enter')
const stickerText = await page.locator('.sticker-text').textContent()
const stickerTextLines = await page.locator('.sticker-text-fit > span').count()
await page.locator('[data-sticker-id]').scrollIntoViewIfNeeded()
const before = await page.locator('[data-sticker-id]').boundingBox()
if (before) {
  const client = await page.context().newCDPSession(page)
  const start = { x: before.x + Math.max(8, before.width * 0.08), y: before.y + before.height / 2 }
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
  await page.waitForTimeout(80)
}
const after = await page.locator('[data-sticker-id]').boundingBox()
const pinchBefore = await page.locator('[data-sticker-id]').boundingBox()
const rotationBefore = Number(await page.locator('[data-sticker-id]').getAttribute('data-rotation'))
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
      { x: left.x - 32, y: y + 30, id: 1 },
      { x: right.x + 32, y: y - 30, id: 2 },
    ],
  })
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await page.waitForTimeout(80)
}
const pinchAfter = await page.locator('[data-sticker-id]').boundingBox()
const rotationAfter = Number(await page.locator('[data-sticker-id]').getAttribute('data-rotation'))
const beforeTrashCount = await page.locator('[data-sticker-id]').count()
await page.locator('[data-sticker-id]').first().tap()
await page.locator('.sticker.active').waitFor()
await page.getByLabel('Delete sticker').evaluate((button) => button.click())
const afterTrashCount = await page.locator('[data-sticker-id]').count()

const download = await Promise.all([
  page.waitForEvent('download'),
  page.getByRole('button', { name: 'Share' }).tap(),
]).then(([download]) => download)
const downloadPath = await download.path()
const exportedSize = pngSize(downloadPath)
const manifest = await (await page.request.get(new URL('/manifest.webmanifest', baseUrl).toString())).json()
const bodyOverflow = await page.evaluate(() => getComputedStyle(document.body).overflow)
await openDrawer(page)
await page.getByRole('button', { name: 'Create' }).tap()
await page.getByPlaceholder('My manga layout').fill('Final Layout')
await page.getByPlaceholder('My manga layout').blur()
await dragCreatorLine(page, '.creator-free-line', 38, -18)
await dragCreatorLine(page, '.creator-handle-end', -18, 44)
await page.getByRole('button', { name: 'Save layout' }).tap()
await waitForDrawerHidden(page)
const drawerHiddenAfterLayoutSave = await page.locator('.motion-drawer').boundingBox().then((box) => box && box.y > 830)
const storedLayoutInfo = await page.evaluate(() => {
  const layouts = JSON.parse(localStorage.getItem('instacomic.customLayouts.v1') ?? '[]')
  const activeLayoutId = localStorage.getItem('instacomic.activeLayout.v1')
  const latest = layouts.at(-1)
  return {
    count: layouts.length,
    name: latest?.name ?? '',
    activeLayoutId,
    panels: latest?.panels?.length ?? 0,
    hasDiagonal: latest?.panels?.some((panel) =>
      panel.points?.some(([x, y]) => ![0, 100].includes(Math.round(x)) && ![0, 100].includes(Math.round(y))),
    ) ?? false,
  }
})
const title = await page.title()
mkdirSync('test-results', { recursive: true })
mkdirSync('docs', { recursive: true })
await closeDrawer(page)
await page.screenshot({ path: 'test-results/instacomic-mobile.png', fullPage: true })
await page.screenshot({ path: 'docs/instacomic-mobile.png', fullPage: true })
await page.reload({ waitUntil: 'networkidle' })
const restoredLayoutName = await page.locator('.live-strip').getAttribute('data-layout-name')
await browser.close()

const result = {
  title,
  formatOptionCount,
  selectedFormat,
  selectedPanel,
  uploadedPhoto,
  photoMoved: Math.abs(photoAfterDrag.x - photoBefore.x) > 0.03 || Math.abs(photoAfterDrag.y - photoBefore.y) > 0.03,
  photoPinched: photoAfterPinch.scale > photoAfterDrag.scale + 0.08,
  photosAfterSmallerTemplate,
  photosAfterRestoredTemplate,
  stickerCount,
  drawerHidden,
  stickerText,
  stickerTextLines,
  moved: !!before && !!after && Math.abs(before.x - after.x) > 5,
  pinched: !!pinchBefore && !!pinchAfter && pinchAfter.width > pinchBefore.width + 8,
  rotated: Math.abs(rotationAfter - rotationBefore) > 5,
  trashed: beforeTrashCount === 1 && afterTrashCount === 0,
  sharedFile: download.suggestedFilename(),
  exportedSize,
  manifestName: manifest.name,
  bodyOverflow,
  drawerHiddenAfterLayoutSave,
  storedLayoutInfo,
  restoredLayoutName,
  errors,
}

console.log(JSON.stringify(result, null, 2))

const failures = [
  result.formatOptionCount === 4 ? null : 'start ratio selector does not expose four options',
  result.selectedFormat === '9:16' ? null : 'start ratio selector did not select 9:16',
  result.selectedPanel === '2' ? null : 'panel selection did not land on panel 2',
  result.uploadedPhoto === 1 ? null : 'photo upload did not fill the active panel',
  result.photoMoved ? null : 'panel photo drag did not update the image offset',
  result.photoPinched ? null : 'panel photo pinch did not update the image scale',
  result.photosAfterSmallerTemplate === 2 ? null : 'template switch to fewer panels did not preserve visible photos',
  result.photosAfterRestoredTemplate === 2 ? null : 'template switch back to more panels did not restore cached photos',
  result.stickerCount === 1 ? null : 'speech sticker was not added',
  result.drawerHidden ? null : 'closed drawer is still visible',
  result.stickerText?.replace(/\s+/g, '').toLowerCase() === 'againwithwrappedstorytext' ? null : 'inline sticker text re-edit failed',
  result.stickerTextLines > 1 ? null : 'sticker text did not wrap into fitted lines',
  result.moved ? null : 'sticker drag failed',
  result.pinched ? null : 'sticker pinch resize failed',
  result.rotated ? null : 'two-finger sticker rotation failed',
  result.trashed ? null : 'drag-to-trash failed',
  result.sharedFile === 'instacomic.png' ? null : 'share fallback did not produce instacomic.png',
  result.exportedSize.width === 1440 && result.exportedSize.height === 2560 ? null : '9:16 export dimensions are incorrect',
  result.manifestName === 'Instacomic' ? null : 'manifest did not load',
  result.bodyOverflow === 'hidden' ? null : 'body is scrollable',
  result.storedLayoutInfo.count > 0 ? null : 'custom ray layout was not saved',
  result.storedLayoutInfo.name === 'Final Layout' ? null : 'custom layout name was not saved',
  result.storedLayoutInfo.activeLayoutId?.startsWith('custom-') ? null : 'active layout id was not persisted',
  result.restoredLayoutName === 'Final Layout' ? null : 'last custom layout was not restored on reload',
  result.drawerHiddenAfterLayoutSave ? null : 'drawer did not close after saving a custom layout',
  result.storedLayoutInfo.hasDiagonal ? null : 'custom layout did not preserve diagonal panels',
  result.errors.length === 0 ? null : `page errors: ${result.errors.join('; ')}`,
].filter(Boolean)

if (failures.length > 0) {
  throw new Error(failures.join('\n'))
}

async function tapStrip(page, nx, ny) {
  const box = await page.locator('.live-strip').boundingBox()
  await page.mouse.click(box.x + box.width * nx, box.y + box.height * ny)
}

async function photoTransform(page, panelId) {
  const image = page.locator(`[data-panel-id="${panelId}"] img`)
  return {
    x: Number(await image.getAttribute('data-shot-x')),
    y: Number(await image.getAttribute('data-shot-y')),
    scale: Number(await image.getAttribute('data-shot-scale')),
  }
}

async function dragPanelPhoto(page, nx, ny, dx, dy) {
  const box = await page.locator('.live-strip').boundingBox()
  const start = { x: box.x + box.width * nx, y: box.y + box.height * ny }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 8 })
  await page.mouse.up()
}

function pngSize(path) {
  const buffer = readFileSync(path)
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  }
}

async function pinchPanelPhoto(page, nx, ny) {
  const box = await page.locator('.live-strip').boundingBox()
  const client = await page.context().newCDPSession(page)
  const center = { x: box.x + box.width * nx, y: box.y + box.height * ny }
  const left = { x: center.x - 18, y: center.y }
  const right = { x: center.x + 18, y: center.y }
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
      { x: left.x - 34, y: center.y, id: 1 },
      { x: right.x + 34, y: center.y, id: 2 },
    ],
  })
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await page.waitForTimeout(80)
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
  await waitForDrawerHidden(page)
}

async function waitForDrawerHidden(page) {
  await page.waitForFunction(() => {
    const box = document.querySelector('.motion-drawer')?.getBoundingClientRect()
    return !!box && box.top > window.innerHeight
  })
}

async function dragCreatorLine(page, selector, dx, dy) {
  const box = await page.locator(selector).first().boundingBox()
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 8 })
  await page.mouse.up()
}
