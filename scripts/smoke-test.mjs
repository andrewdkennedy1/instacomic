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
await page.getByRole('button', { name: /4:3/ }).tap()
const landscapeSelectedFormat = await page.locator('.format-option.active strong').textContent()
await page.getByRole('button', { name: 'Start' }).tap()
await page.locator('.start-screen').waitFor({ state: 'detached' })
const landscapeLiveFormat = await page.locator('.live-strip').getAttribute('data-page-format')
const landscapeLiveAspect = await page.locator('.live-strip').boundingBox().then((box) => (box ? box.height / box.width : 0))
const landscapeDownload = await Promise.all([
  page.waitForEvent('download'),
  page.getByRole('button', { name: 'Share' }).tap(),
]).then(([download]) => download)
const landscapeDownloadPath = await landscapeDownload.path()
const landscapeExportedSize = pngSize(landscapeDownloadPath)
await page.reload({ waitUntil: 'networkidle' })
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
await pinchRotatePanelPhoto(page, 0.75, 0.31)
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
const photoAfterRestoredTemplate = await photoTransform(page, '2')
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
await page.getByRole('button', { name: /New grid/ }).tap()
await page.locator('.creator-fullscreen').waitFor()
await waitForDrawerHidden(page)
const creatorFullscreenVisible = await page.locator('.creator-fullscreen').count()
const drawerHiddenAfterCreate = await page.locator('.motion-drawer').boundingBox().then((box) => box && box.y > 830)
const creatorCanvasFormat = await page.locator('.creator-canvas').getAttribute('data-page-format')
const creatorCanvasAspect = await page.locator('.creator-canvas').boundingBox().then((box) => (box ? box.height / box.width : 0))
const uniformControlBorders = await page.evaluate(() => {
  const standardSurfaces = document.querySelectorAll('.drawer-tabs, .layout-card, .layout-preview, .creator-topbar button, .creator-actions button, .field input')
  const expectedBorder = getComputedStyle(document.documentElement).getPropertyValue('--ui-border').trim()
  return standardSurfaces.length > 0 && Array.from(standardSurfaces).every((element) => getComputedStyle(element).borderTopWidth === expectedBorder)
})
const creatorHasHorizontalDivider = await page.getByRole('button', { name: 'Horizontal divider' }).count()
const creatorHasGestureHint = (await page.locator('.creator-gesture-hint').innerText()).includes('two fingers')
mkdirSync('test-results', { recursive: true })
await page.screenshot({ path: 'test-results/custom-grid-creator.png', fullPage: true })
await page.getByLabel('Grid name').fill('Final Layout')
await page.getByLabel('Grid name').blur()
await page.getByLabel('Border color').evaluate((input) => {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  valueSetter?.call(input, '#203040')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
})
await page.getByLabel('Border thickness').evaluate((input) => {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  valueSetter?.call(input, '5')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
})
await page.getByLabel('Divider thickness').evaluate((input) => {
  const range = input
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  valueSetter?.call(range, '16')
  range.dispatchEvent(new Event('input', { bubbles: true }))
})
const creatorThickness = Number(await page.locator('.creator-stack').getAttribute('data-divider-thickness'))
const creatorBorderColor = await page.locator('.creator-stack').getAttribute('data-border-color')
const creatorBorderThickness = Number(await page.locator('.creator-stack').getAttribute('data-border-thickness'))
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
await openDrawer(page)
const editGridButtonVisible = await page.getByRole('button', { name: 'Edit Final Layout grid' }).count()
await page.getByRole('button', { name: 'Edit Final Layout grid' }).tap()
await page.locator('.creator-fullscreen').waitFor()
const editBorderColor = await page.getByLabel('Border color').inputValue()
const editBorderThickness = Number(await page.getByLabel('Border thickness').inputValue())
await page.getByLabel('Border thickness').evaluate((input) => {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  valueSetter?.call(input, '6')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
})
await page.getByRole('button', { name: 'Update layout' }).tap()
await page.locator('.creator-fullscreen').waitFor({ state: 'detached' })
await waitForDrawerHidden(page)
const liveGutterAfterLayoutSave = await page.locator('.live-strip').evaluate((strip) => {
  return Number.parseFloat(getComputedStyle(strip).getPropertyValue('--gutter'))
})
const liveBorderAfterLayoutSave = await page.locator('.live-strip').evaluate((strip) => {
  const style = getComputedStyle(strip)
  return {
    color: style.getPropertyValue('--ink').trim(),
    thickness: Number.parseFloat(style.getPropertyValue('--border')),
  }
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
    borderColor: latest?.borderColor ?? null,
    borderThickness: latest?.borderThickness ?? null,
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
await page.getByRole('button', { name: 'Style', exact: true }).tap()
const draftRevisionBeforeFinalStyle = await readDraftRevision(page)
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
await waitForDraftRevision(page, draftRevisionBeforeFinalStyle + 1)
await page.locator('.native-shell[data-autosave-state="saved"]').waitFor()
await page.reload({ waitUntil: 'networkidle' })
const restoredLayoutName = await page.locator('.live-strip').getAttribute('data-layout-name')
const restoredLayoutAspect = await page.locator('.live-strip').boundingBox().then((box) => (box ? box.height / box.width : 0))
const draftRecoveryVisible = await page.getByRole('button', { name: 'Continue editing' }).count()
const draftRecoverySummary = await page.locator('.draft-recovery-card').innerText()
await page.getByRole('button', { name: 'Continue editing' }).tap()
await page.locator('.start-screen').waitFor({ state: 'detached' })
const continuedDraftPhotoCount = await page.locator('.live-panel img').count()
await openDrawer(page)
await page.getByRole('button', { name: 'Layout', exact: true }).tap()
const savedLayoutCard = page.locator(`[data-layout-option-id="${storedLayoutInfo.activeLayoutId}"]`)
await savedLayoutCard.waitFor()
const savedLayoutPreview = savedLayoutCard.locator('[data-layout-preview]')
const savedPreviewPanelCount = await savedLayoutPreview.locator('[data-preview-panel]').count()
const savedPreviewDividerCount = await savedLayoutPreview.locator('[data-preview-divider]').count()
const savedPreviewBox = await savedLayoutPreview.boundingBox()
const savedPreviewActive = await savedLayoutCard.getAttribute('aria-pressed')
const savedPreviewVisibleWithoutScroll = await page.locator('.drawer-content').evaluate((drawer, activeLayoutId) => {
  const card = drawer.querySelector(`[data-layout-option-id="${activeLayoutId}"]`)
  const drawerBox = drawer.getBoundingClientRect()
  const cardBox = card?.getBoundingClientRect()
  return !!cardBox && drawer.scrollTop === 0 && cardBox.top >= drawerBox.top && cardBox.bottom <= drawerBox.bottom
}, storedLayoutInfo.activeLayoutId)
const layoutSectionHeadings = await page.locator('.layout-section-heading strong').allTextContents()
const builtInPreviewCount = await page.locator('[data-custom-layout="false"] [data-layout-preview]').count()
const savedPreviewImage = decodePngBuffer(await savedLayoutPreview.screenshot())
const savedPreviewDividerRun = paperRunFromImage(
  savedPreviewImage,
  Math.round(savedPreviewImage.width * 0.5),
  Math.round(savedPreviewImage.height * 0.24),
  '#e5e5ea',
)
await page.screenshot({ path: 'test-results/custom-grid-gallery.png', fullPage: true })
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
  landscapeSelectedFormat,
  landscapeLiveFormat,
  landscapeLiveAspect,
  landscapeExportedSize,
  selectedFormat,
  selectedPanel,
  uploadedPhoto,
  photoMoved: Math.abs(photoAfterDrag.x - photoBefore.x) > 0.03 || Math.abs(photoAfterDrag.y - photoBefore.y) > 0.03,
  photoRotated: Math.abs(photoAfterPinch.rotation - photoAfterDrag.rotation) > 70,
  photoZoomed: photoAfterPinch.scale > photoAfterDrag.scale + 0.4,
  photoTransformPreserved:
    Math.abs(photoAfterRestoredTemplate.rotation - photoAfterPinch.rotation) < 0.01 &&
    Math.abs(photoAfterRestoredTemplate.scale - photoAfterPinch.scale) < 0.01,
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
  uniformControlBorders,
  creatorHasHorizontalDivider,
  creatorHasGestureHint,
  creatorThickness,
  creatorBorderColor,
  creatorBorderThickness,
  dividerVisualThickness,
  creatorTextHasRay,
  creatorClosedAfterLayoutSave,
  drawerHiddenAfterLayoutSave,
  editGridButtonVisible,
  editBorderColor,
  editBorderThickness,
  liveGutterAfterLayoutSave,
  liveBorderAfterLayoutSave,
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
  draftRecoveryVisible,
  draftRecoverySummary,
  continuedDraftPhotoCount,
  savedPreviewPanelCount,
  savedPreviewDividerCount,
  savedPreviewBox,
  savedPreviewActive,
  savedPreviewVisibleWithoutScroll,
  savedPreviewDividerRun,
  layoutSectionHeadings,
  builtInPreviewCount,
  deleteButtonVisible,
  deletedLayoutInfo,
  layoutAfterDeleteName,
  errors,
}

console.log(JSON.stringify(result, null, 2))

const failures = [
  result.formatOptionCount === 4 ? null : 'start ratio selector does not expose four options',
  result.squareFormatOptionCount === 0 ? null : 'start ratio selector still exposes 1:1',
  result.formatPickerCentered ? null : 'start ratio selector options are not centered',
  result.landscapeSelectedFormat === '4:3' ? null : 'start ratio selector did not select 4:3',
  result.landscapeLiveFormat === '4:3' ? null : 'live canvas did not use the selected 4:3 format',
  Math.abs(result.landscapeLiveAspect - 3 / 4) < 0.08 ? null : 'live canvas did not render as 4:3',
  result.landscapeExportedSize.width === 1440 && result.landscapeExportedSize.height === 1080 ? null : '4:3 export dimensions are incorrect',
  result.selectedFormat === '9:16' ? null : 'start ratio selector did not select 9:16',
  result.selectedPanel === '2' ? null : 'panel selection did not land on panel 2',
  result.uploadedPhoto === 1 ? null : 'photo upload did not fill the active panel',
  result.photoMoved ? null : 'panel photo drag did not update the image offset',
  result.photoRotated ? null : 'two-finger photo twist did not update the image rotation',
  result.photoZoomed ? null : 'two-finger photo pinch did not update the image scale',
  result.photoTransformPreserved ? null : 'photo zoom and rotation were not preserved across layout changes',
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
  result.uniformControlBorders ? null : 'standard editor controls do not use a uniform border width',
  result.creatorHasHorizontalDivider === 1 ? null : 'custom layout maker does not expose horizontal dividers',
  result.creatorHasGestureHint ? null : 'custom layout maker does not explain its two-finger line gesture',
  result.creatorThickness === 16 ? null : 'custom layout thickness control did not update state',
  result.creatorBorderColor === '#203040' ? null : 'custom grid border color control did not update state',
  result.creatorBorderThickness === 5 ? null : 'custom grid border thickness control did not update state',
  result.dividerVisualThickness >= 15 ? null : 'custom layout thickness control did not update divider styling',
  result.creatorTextHasRay === false ? null : 'custom layout maker still exposes ray copy',
  result.creatorClosedAfterLayoutSave ? null : 'fullscreen creator did not close after saving a layout',
  result.storedLayoutInfo.count > 0 ? null : 'custom layout was not saved',
  result.storedLayoutInfo.name === 'Final Layout' ? null : 'custom layout name was not saved',
  result.storedLayoutInfo.activeLayoutId?.startsWith('custom-') ? null : 'active layout id was not persisted',
  result.storedLayoutInfo.dividerThickness === 16 ? null : 'custom layout did not persist divider thickness',
  result.storedLayoutInfo.borderColor === '#203040' ? null : 'custom grid did not persist its border color',
  result.storedLayoutInfo.borderThickness === 6 ? null : 'edited custom grid did not persist its border thickness',
  result.storedLayoutInfo.dividers > 0 ? null : 'custom layout did not persist divider lines',
  result.storedLayoutInfo.hasPageFormatId === false ? null : 'custom layout still persists its own aspect ratio',
  result.liveGutterAfterLayoutSave === 16 ? null : 'saved custom layout did not apply divider thickness to the live layout',
  result.editGridButtonVisible === 1 ? null : 'saved custom grid does not expose an edit action',
  result.editBorderColor === '#203040' ? null : 'grid editor did not restore the saved border color',
  result.editBorderThickness === 5 ? null : 'grid editor did not restore the saved border thickness',
  result.liveBorderAfterLayoutSave.color === '#203040' && result.liveBorderAfterLayoutSave.thickness === 6
    ? null
    : 'edited custom grid border settings were not applied to the live layout',
  Math.abs(result.liveAspectAfterLayoutSave - 16 / 9) < 0.08 ? null : 'saved custom layout did not keep the live canvas at 9:16',
  result.customSharedFile === 'instacomic.png' ? null : 'custom layout share fallback did not produce instacomic.png',
  result.customExportedSize.width === 1440 && result.customExportedSize.height === 2560 ? null : 'custom 9:16 export dimensions are incorrect',
  result.liveCustomDividerRun.width >= 12 ? null : 'custom layout live preview did not render the selected gap',
  isDarkPixel(result.liveCustomBezelPixel) ? null : 'custom layout live preview did not render the outer bezel',
  result.customDividerRun.width >= 42 ? null : 'custom layout export did not render the selected divider thickness',
  isDarkPixel(result.customBezelPixel) ? null : 'custom layout export did not render the outer bezel',
  result.restoredLayoutName === 'Final Layout' ? null : 'last custom layout was not restored on reload',
  Math.abs(result.restoredLayoutAspect - 16 / 9) < 0.08 ? null : 'restored custom layout did not use the persisted selected aspect ratio',
  result.draftRecoveryVisible === 1 ? null : 'saved comic recovery was not offered after reload',
  result.draftRecoverySummary.includes('Final Layout') && result.draftRecoverySummary.includes('2 photos') ? null : 'saved comic recovery summary is incomplete',
  result.continuedDraftPhotoCount === 2 ? null : 'continuing a saved comic did not restore its photos',
  result.savedPreviewPanelCount === result.storedLayoutInfo.panels ? null : 'saved grid preview did not render its stored panels',
  result.savedPreviewDividerCount === result.storedLayoutInfo.dividers ? null : 'saved grid preview did not render its stored dividers',
  result.savedPreviewBox?.width >= 80 && result.savedPreviewBox?.height >= 80 ? null : 'saved grid preview is too small to scan',
  result.savedPreviewActive === 'true' ? null : 'saved grid preview does not expose its selected state',
  result.savedPreviewVisibleWithoutScroll ? null : 'saved grid preview is below the initial drawer fold',
  result.savedPreviewDividerRun.width >= 2 ? null : 'saved grid preview divider is not visibly rendered',
  result.layoutSectionHeadings.join('|') === 'Your grids|Templates' ? null : 'grid library sections are not ordered for saved-grid discovery',
  result.builtInPreviewCount === 8 ? null : 'template previews are missing from the grid library',
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
    rotation: Number(await image.getAttribute('data-shot-rotation')),
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

async function pinchRotatePanelPhoto(page, nx, ny) {
  const box = await page.locator('.live-strip').boundingBox()
  const client = await page.context().newCDPSession(page)
  const center = { x: box.x + box.width * nx, y: box.y + box.height * ny }
  const left = { x: center.x - 36, y: center.y }
  const right = { x: center.x + 36, y: center.y }
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
      { x: center.x, y: center.y - 54, id: 1 },
      { x: center.x, y: center.y + 54, id: 2 },
    ],
  })
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await page.waitForTimeout(80)
}

async function openDrawer(page) {
  const doneEditing = page.getByRole('button', { name: /Done editing panel/ })
  if ((await doneEditing.count()) > 0) {
    await doneEditing.evaluate((button) => button.click()).catch(() => undefined)
    await doneEditing.waitFor({ state: 'detached' }).catch(() => undefined)
  }
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

async function readDraftRevision(page) {
  return page.evaluate(() =>
    new Promise((resolve, reject) => {
      const request = indexedDB.open('instacomic', 1)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const database = request.result
        const transaction = database.transaction('drafts', 'readonly')
        const get = transaction.objectStore('drafts').get('current')
        get.onsuccess = () => resolve(get.result?.revision ?? 0)
        get.onerror = () => reject(get.error)
        transaction.oncomplete = () => database.close()
      }
    }),
  )
}

async function waitForDraftRevision(page, minimumRevision) {
  await page.waitForFunction(
    (minimum) =>
      new Promise((resolve) => {
        const request = indexedDB.open('instacomic', 1)
        request.onerror = () => resolve(false)
        request.onsuccess = () => {
          const database = request.result
          const transaction = database.transaction('drafts', 'readonly')
          const get = transaction.objectStore('drafts').get('current')
          get.onsuccess = () => resolve((get.result?.revision ?? 0) >= minimum)
          get.onerror = () => resolve(false)
          transaction.oncomplete = () => database.close()
        }
      }),
    minimumRevision,
    { timeout: 10000 },
  )
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
