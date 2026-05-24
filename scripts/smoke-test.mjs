import { mkdirSync, readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { chromium } from 'playwright'

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

await enableStandalone(page)

await page.goto(baseUrl, { waitUntil: 'networkidle' })
const formatOptionCount = await page.locator('.format-option').count()
const squareFormatOptionCount = await page.locator('.format-option', { hasText: '1:1' }).count()
const formatPickerCentered = await page.locator('.format-options').evaluate((picker) => {
  const pickerBox = picker.getBoundingClientRect()
  const optionBoxes = [...picker.querySelectorAll('.format-option')].map((option) => option.getBoundingClientRect())
  const first = optionBoxes[0]
  const last = optionBoxes.at(-1)
  return !!first && !!last && Math.abs((first.left - pickerBox.left) - (pickerBox.right - last.right)) < 1
})
await page.getByRole('button', { name: /9:16/ }).tap()
const selectedFormat = await page.locator('.format-option.active strong').textContent()
await page.getByRole('button', { name: 'Start' }).tap()
await page.locator('.start-screen').waitFor({ state: 'detached' })
await tapStrip(page, 0.75, 0.31)
await page.waitForFunction(() => document.querySelector('.live-panel.is-live')?.getAttribute('data-panel-id') === '2')
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
await page.getByRole('button', { name: 'Layout', exact: true }).tap()
await page.getByRole('button', { name: /Story/ }).tap()
const photosAfterSmallerTemplate = await page.locator('.live-panel img').count()
await page.getByRole('button', { name: /Shard/ }).tap()
const photosAfterRestoredTemplate = await page.locator('.live-panel img').count()
await closeDrawer(page)

await openDrawer(page)
const stickerTabCount = await page.getByRole('button', { name: 'Stickers' }).count()
const stickerElementCount = await page.locator('[data-sticker-id], .sticker').count()
await closeDrawer(page)
const drawerHidden = await page.locator('.motion-drawer').boundingBox().then((box) => box && box.y > 830)

const download = await Promise.all([
  page.waitForEvent('download'),
  page.getByRole('button', { name: 'Share' }).tap(),
]).then(([download]) => download)
const downloadPath = await download.path()
const exportedSize = pngSize(downloadPath)
const manifest = await (await page.request.get(new URL('/manifest.webmanifest', baseUrl).toString())).json()
const bodyOverflow = await page.evaluate(() => getComputedStyle(document.body).overflow)
await openDrawer(page)
await page.getByRole('button', { name: 'Create', exact: true }).tap()
await page.locator('.creator-fullscreen').waitFor()
await waitForDrawerHidden(page)
const creatorFullscreenVisible = await page.locator('.creator-fullscreen').count()
const drawerHiddenAfterCreate = await page.locator('.motion-drawer').boundingBox().then((box) => box && box.y > 830)
const creatorCanvasFormat = await page.locator('.creator-canvas').getAttribute('data-page-format')
const creatorCanvasAspect = await page.locator('.creator-canvas').boundingBox().then((box) => (box ? box.height / box.width : 0))
await page.getByPlaceholder('My manga layout').fill('Final Layout')
await page.getByPlaceholder('My manga layout').blur()
await page.getByLabel('Divider thickness').evaluate((input) => {
  const range = input
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  valueSetter?.call(range, '16')
  range.dispatchEvent(new Event('input', { bubbles: true }))
})
const creatorThickness = Number(await page.locator('.creator-stack').getAttribute('data-divider-thickness'))
const dividerVisualThickness = await page.locator('.creator-free-line').first().evaluate((line) => {
  return Number.parseFloat(getComputedStyle(line, '::before').height)
})
const creatorTextHasRay = (await page.locator('.creator-stack').innerText()).toLowerCase().includes('ray')
await dragCreatorHandleToPercent(page, '[data-divider-index="1"][data-handle="start"]', 0.5, 0.48)
await page.getByRole('button', { name: 'Save layout' }).tap()
await page.locator('.creator-fullscreen').waitFor({ state: 'detached' })
const creatorClosedAfterLayoutSave = await page.locator('.creator-fullscreen').count() === 0
await waitForDrawerHidden(page)
const drawerHiddenAfterLayoutSave = await page.locator('.motion-drawer').boundingBox().then((box) => box && box.y > 830)
const liveGutterAfterLayoutSave = await page.locator('.live-strip').evaluate((strip) => {
  return Number.parseFloat(getComputedStyle(strip).getPropertyValue('--gutter'))
})
const liveAspectAfterLayoutSave = await page.locator('.live-strip').boundingBox().then((box) => (box ? box.height / box.width : 0))
const storedLayoutInfo = await page.evaluate(() => {
  const layouts = JSON.parse(localStorage.getItem('instacomic.customLayouts.v1') ?? '[]')
  const activeLayoutId = localStorage.getItem('instacomic.activeLayout.v1')
  const latest = layouts.at(-1)
  return {
    count: layouts.length,
    name: latest?.name ?? '',
    activeLayoutId,
    dividerThickness: latest?.dividerThickness ?? null,
    dividers: latest?.dividers?.length ?? 0,
    hasPageFormatId: Object.prototype.hasOwnProperty.call(latest ?? {}, 'pageFormatId'),
    panels: latest?.panels?.length ?? 0,
    snapJunction: latest?.panels?.some((panel) =>
      panel.points?.some(([x, y]) => Math.abs(x - 50) < 0.5 && Math.abs(y - 48) < 0.5),
    ) ?? false,
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
await openDrawer(page)
await page.getByRole('button', { name: 'Save', exact: true }).tap()
await page
  .locator('.motion-drawer-style label')
  .filter({ hasText: 'Paper' })
  .locator('input[type="color"]')
  .evaluate((input) => {
    const color = input
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    valueSetter?.call(color, '#ffed5a')
    color.dispatchEvent(new Event('input', { bubbles: true }))
    color.dispatchEvent(new Event('change', { bubbles: true }))
  })
await closeDrawer(page)
const liveStripImage = decodePngBuffer(await page.locator('.live-strip').screenshot())
const liveCustomDividerRun = paperRunFromImage(liveStripImage, Math.round(liveStripImage.width * 0.5), Math.round(liveStripImage.height * 0.24), '#ffed5a')
const liveCustomBezelPixel = pixelAt(liveStripImage, Math.round(liveStripImage.width * 0.5), 0)
const customDownload = await Promise.all([
  page.waitForEvent('download'),
  page.getByRole('button', { name: 'Share' }).tap(),
]).then(([download]) => download)
const customDownloadPath = await customDownload.path()
const customExportedSize = pngSize(customDownloadPath)
const customExportedImage = decodePng(customDownloadPath)
const customDividerRun = paperRunFromImage(customExportedImage, Math.round(customExportedSize.width * 0.5), Math.round(customExportedSize.height * 0.24), '#ffed5a')
const customBezelPixel = pixelAt(customExportedImage, Math.round(customExportedSize.width * 0.5), 3)
await page.reload({ waitUntil: 'networkidle' })
const restoredLayoutName = await page.locator('.live-strip').getAttribute('data-layout-name')
const restoredLayoutAspect = await page.locator('.live-strip').boundingBox().then((box) => (box ? box.height / box.width : 0))
await page.getByRole('button', { name: 'Start' }).tap()
await openDrawer(page)
await page.getByRole('button', { name: 'Layout', exact: true }).tap()
const deleteLayoutButton = page.getByRole('button', { name: 'Delete Final Layout layout' })
await deleteLayoutButton.scrollIntoViewIfNeeded()
const deleteButtonVisible = await deleteLayoutButton.isVisible()
await deleteLayoutButton.tap()
await page.waitForFunction(() => {
  const layouts = JSON.parse(localStorage.getItem('instacomic.customLayouts.v1') ?? '[]')
  return layouts.length === 0 && localStorage.getItem('instacomic.activeLayout.v1') === 'shard'
})
const layoutAfterDeleteName = await page.locator('.live-strip').getAttribute('data-layout-name')
const deletedLayoutInfo = await page.evaluate(() => {
  const layouts = JSON.parse(localStorage.getItem('instacomic.customLayouts.v1') ?? '[]')
  return {
    count: layouts.length,
    activeLayoutId: localStorage.getItem('instacomic.activeLayout.v1'),
    deleteButtonCount: document.querySelectorAll('.layout-delete').length,
  }
})
await browser.close()

const result = {
  title,
  formatOptionCount,
  squareFormatOptionCount,
  formatPickerCentered,
  selectedFormat,
  selectedPanel,
  uploadedPhoto,
  photoMoved: Math.abs(photoAfterDrag.x - photoBefore.x) > 0.03 || Math.abs(photoAfterDrag.y - photoBefore.y) > 0.03,
  photoPinched: photoAfterPinch.scale > photoAfterDrag.scale + 0.08,
  photosAfterSmallerTemplate,
  photosAfterRestoredTemplate,
  stickerTabCount,
  stickerElementCount,
  drawerHidden,
  sharedFile: download.suggestedFilename(),
  exportedSize,
  manifestName: manifest.name,
  bodyOverflow,
  creatorFullscreenVisible,
  drawerHiddenAfterCreate,
  creatorCanvasFormat,
  creatorCanvasAspect,
  creatorThickness,
  dividerVisualThickness,
  creatorTextHasRay,
  creatorClosedAfterLayoutSave,
  drawerHiddenAfterLayoutSave,
  liveGutterAfterLayoutSave,
  liveAspectAfterLayoutSave,
  storedLayoutInfo,
  customSharedFile: customDownload.suggestedFilename(),
  customExportedSize,
  liveCustomDividerRun,
  liveCustomBezelPixel,
  customDividerRun,
  customBezelPixel,
  restoredLayoutName,
  restoredLayoutAspect,
  deleteButtonVisible,
  deletedLayoutInfo,
  layoutAfterDeleteName,
  errors,
}

console.log(JSON.stringify(result, null, 2))

const failures = [
  result.formatOptionCount === 3 ? null : 'start ratio selector does not expose three options',
  result.squareFormatOptionCount === 0 ? null : 'start ratio selector still exposes 1:1',
  result.formatPickerCentered ? null : 'start ratio selector options are not centered',
  result.selectedFormat === '9:16' ? null : 'start ratio selector did not select 9:16',
  result.selectedPanel === '2' ? null : 'panel selection did not land on panel 2',
  result.uploadedPhoto === 1 ? null : 'photo upload did not fill the active panel',
  result.photoMoved ? null : 'panel photo drag did not update the image offset',
  result.photoPinched ? null : 'panel photo pinch did not update the image scale',
  result.photosAfterSmallerTemplate === 2 ? null : 'template switch to fewer panels did not preserve visible photos',
  result.photosAfterRestoredTemplate === 2 ? null : 'template switch back to more panels did not restore cached photos',
  result.stickerTabCount === 0 ? null : 'sticker drawer tab is still visible',
  result.stickerElementCount === 0 ? null : 'sticker elements are still present',
  result.drawerHidden ? null : 'closed drawer is still visible',
  result.sharedFile === 'instacomic.png' ? null : 'share fallback did not produce instacomic.png',
  result.exportedSize.width === 1440 && result.exportedSize.height === 2560 ? null : '9:16 export dimensions are incorrect',
  result.manifestName === 'Instacomic' ? null : 'manifest did not load',
  result.bodyOverflow === 'hidden' ? null : 'body is scrollable',
  result.creatorFullscreenVisible === 1 ? null : 'custom layout creator did not open fullscreen',
  result.drawerHiddenAfterCreate ? null : 'drawer stayed visible behind the fullscreen creator',
  result.creatorCanvasFormat === '9:16' ? null : 'custom layout creator did not inherit the selected aspect ratio id',
  Math.abs(result.creatorCanvasAspect - 16 / 9) < 0.08 ? null : 'custom layout creator canvas did not render as 9:16',
  result.creatorThickness === 16 ? null : 'custom layout thickness control did not update state',
  result.dividerVisualThickness >= 15 ? null : 'custom layout thickness control did not update divider styling',
  result.creatorTextHasRay === false ? null : 'custom layout maker still exposes ray copy',
  result.creatorClosedAfterLayoutSave ? null : 'fullscreen creator did not close after saving a layout',
  result.storedLayoutInfo.count > 0 ? null : 'custom layout was not saved',
  result.storedLayoutInfo.name === 'Final Layout' ? null : 'custom layout name was not saved',
  result.storedLayoutInfo.activeLayoutId?.startsWith('custom-') ? null : 'active layout id was not persisted',
  result.storedLayoutInfo.dividerThickness === 16 ? null : 'custom layout did not persist divider thickness',
  result.storedLayoutInfo.dividers > 0 ? null : 'custom layout did not persist divider lines',
  result.storedLayoutInfo.hasPageFormatId === false ? null : 'custom layout still persists its own aspect ratio',
  result.liveGutterAfterLayoutSave === 16 ? null : 'saved custom layout did not apply divider thickness to the live layout',
  Math.abs(result.liveAspectAfterLayoutSave - 16 / 9) < 0.08 ? null : 'saved custom layout did not keep the live canvas at 9:16',
  result.customSharedFile === 'instacomic.png' ? null : 'custom layout share fallback did not produce instacomic.png',
  result.customExportedSize.width === 1440 && result.customExportedSize.height === 2560 ? null : 'custom 9:16 export dimensions are incorrect',
  result.liveCustomDividerRun.width >= 12 ? null : 'custom layout live preview did not render the selected gap',
  isDarkPixel(result.liveCustomBezelPixel) ? null : 'custom layout live preview did not render the outer bezel',
  result.customDividerRun.width >= 42 ? null : 'custom layout export did not render the selected divider thickness',
  isDarkPixel(result.customBezelPixel) ? null : 'custom layout export did not render the outer bezel',
  result.restoredLayoutName === 'Final Layout' ? null : 'last custom layout was not restored on reload',
  Math.abs(result.restoredLayoutAspect - 16 / 9) < 0.08 ? null : 'restored custom layout did not use the persisted selected aspect ratio',
  result.drawerHiddenAfterLayoutSave ? null : 'drawer did not close after saving a custom layout',
  result.storedLayoutInfo.panels === 3 ? null : 'custom snapped layout did not create three panels',
  result.storedLayoutInfo.snapJunction ? null : 'custom layout did not snap divider endpoint to another divider',
  result.storedLayoutInfo.hasDiagonal ? null : 'custom layout did not preserve connected non-rectangular panels',
  result.deleteButtonVisible ? null : 'custom layout delete button was not visible',
  result.deletedLayoutInfo.count === 0 ? null : 'custom layout was not deleted from storage',
  result.deletedLayoutInfo.activeLayoutId === 'shard' ? null : 'active layout did not fall back after deleting current custom layout',
  result.deletedLayoutInfo.deleteButtonCount === 0 ? null : 'deleted custom layout card stayed visible',
  result.layoutAfterDeleteName === 'Shard' ? null : 'current layout did not switch after deleting active custom layout',
  result.errors.length === 0 ? null : `page errors: ${result.errors.join('; ')}`,
].filter(Boolean)

if (failures.length > 0) {
  throw new Error(failures.join('\n'))
}

async function enableStandalone(page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', {
      configurable: true,
      get: () => true,
    })
  })
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

function paperRun(path, x, y, paperHex) {
  return paperRunFromImage(decodePng(path), x, y, paperHex)
}

function paperRunFromImage(image, x, y, paperHex) {
  const target = hexToRgb(paperHex)
  const targetX = clampNumber(x, 0, image.width - 1)
  const targetY = clampNumber(y, 0, image.height - 1)
  const centerPixel = pixelAt(image, targetX, targetY)
  let left = targetX
  let right = targetX

  while (left > 0 && colorMatches(pixelAt(image, left - 1, targetY), target)) {
    left -= 1
  }
  while (right < image.width - 1 && colorMatches(pixelAt(image, right + 1, targetY), target)) {
    right += 1
  }

  return {
    x: targetX,
    y: targetY,
    width: colorMatches(centerPixel, target) ? right - left + 1 : 0,
    centerPixel,
  }
}

function decodePng(path) {
  return decodePngBuffer(readFileSync(path))
}

function decodePngBuffer(buffer) {
  const signature = '89504e470d0a1a0a'
  if (buffer.subarray(0, 8).toString('hex') !== signature) {
    throw new Error('Downloaded file is not a PNG')
  }

  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  const idat = []

  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const dataStart = offset + 8
    const dataEnd = dataStart + length

    if (type === 'IHDR') {
      width = buffer.readUInt32BE(dataStart)
      height = buffer.readUInt32BE(dataStart + 4)
      bitDepth = buffer[dataStart + 8]
      colorType = buffer[dataStart + 9]
    } else if (type === 'IDAT') {
      idat.push(buffer.subarray(dataStart, dataEnd))
    } else if (type === 'IEND') {
      break
    }

    offset = dataEnd + 4
  }

  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0
  if (bitDepth !== 8 || channels === 0) {
    throw new Error(`Unsupported PNG format: bit depth ${bitDepth}, color type ${colorType}`)
  }

  const inflated = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const pixels = Buffer.alloc(height * stride)
  let sourceOffset = 0

  for (let row = 0; row < height; row += 1) {
    const filter = inflated[sourceOffset]
    sourceOffset += 1
    const rowOffset = row * stride
    const previousRowOffset = rowOffset - stride

    for (let column = 0; column < stride; column += 1) {
      const raw = inflated[sourceOffset]
      sourceOffset += 1
      const left = column >= channels ? pixels[rowOffset + column - channels] : 0
      const up = row > 0 ? pixels[previousRowOffset + column] : 0
      const upLeft = row > 0 && column >= channels ? pixels[previousRowOffset + column - channels] : 0
      pixels[rowOffset + column] = unfilterByte(filter, raw, left, up, upLeft)
    }
  }

  return { width, height, channels, pixels }
}

function unfilterByte(filter, raw, left, up, upLeft) {
  if (filter === 0) {
    return raw
  }
  if (filter === 1) {
    return (raw + left) & 0xff
  }
  if (filter === 2) {
    return (raw + up) & 0xff
  }
  if (filter === 3) {
    return (raw + Math.floor((left + up) / 2)) & 0xff
  }
  if (filter === 4) {
    return (raw + paeth(left, up, upLeft)) & 0xff
  }
  throw new Error(`Unsupported PNG filter ${filter}`)
}

function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft
  const leftDistance = Math.abs(estimate - left)
  const upDistance = Math.abs(estimate - up)
  const upLeftDistance = Math.abs(estimate - upLeft)
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) {
    return left
  }
  return upDistance <= upLeftDistance ? up : upLeft
}

function pixelAt(image, x, y) {
  const offset = (y * image.width + x) * image.channels
  return [
    image.pixels[offset],
    image.pixels[offset + 1],
    image.pixels[offset + 2],
    image.channels === 4 ? image.pixels[offset + 3] : 255,
  ]
}

function hexToRgb(hex) {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ]
}

function colorMatches(pixel, target) {
  return Math.abs(pixel[0] - target[0]) <= 8 && Math.abs(pixel[1] - target[1]) <= 8 && Math.abs(pixel[2] - target[2]) <= 8
}

function isDarkPixel(pixel) {
  return pixel[0] < 70 && pixel[1] < 70 && pixel[2] < 70 && pixel[3] > 180
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value))
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

async function dragCreatorHandleToPercent(page, selector, targetX, targetY) {
  const canvas = await page.locator('.creator-canvas').boundingBox()
  const box = await page.locator(selector).first().boundingBox()
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const end = { x: canvas.x + canvas.width * targetX, y: canvas.y + canvas.height * targetY }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 8 })
  await page.mouse.up()
}
