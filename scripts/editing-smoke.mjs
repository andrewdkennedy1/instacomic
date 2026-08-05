import { mkdirSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { chromium } from 'playwright'

const crcTable = createCrcTable()
const browser = await chromium.launch()
const baseUrl = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:4174'
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
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
const baselineUndoDisabled = await page.getByRole('button', { name: 'Undo' }).isDisabled()
const baselineRedoDisabled = await page.getByRole('button', { name: 'Redo' }).isDisabled()

await setLayout(page, 'Manga')
const layoutHistoryCount = await historyCount(page, 'undo')
await page.setInputFiles('.photo-upload', testImage('first.png'))
await page.waitForFunction(() => document.querySelector('[data-panel-id="1"] img'))
const beforeTrayActivationBox = await page.locator('.live-strip').boundingBox()
const activationPoint = {
  x: beforeTrayActivationBox.x + beforeTrayActivationBox.width * 0.28,
  y: beforeTrayActivationBox.y + beforeTrayActivationBox.height * 0.5,
}
await page.mouse.move(activationPoint.x, activationPoint.y)
await page.mouse.down()
await page.waitForTimeout(240)
const duringTrayActivationBox = await page.locator('.live-strip').boundingBox()
await page.mouse.up()

const tray = page.getByRole('toolbar', { name: 'Panel 1 photo controls' })
await tray.waitFor()
await page.waitForFunction(() => Number.parseFloat(getComputedStyle(document.querySelector('.capture-bar')).opacity) < 0.05)
const afterTrayActivationBox = await page.locator('.live-strip').boundingBox()
const trayButtons = tray.locator('.photo-action-buttons').getByRole('button')
const trayButtonCount = await trayButtons.count()
const trayButtonsMeetTarget = await trayButtons.evaluateAll((buttons) =>
  buttons.every((button) => {
    const box = button.getBoundingClientRect()
    return box.width >= 44 && box.height >= 44
  }),
)
const contextualTrayLayout = await page.evaluate(() => {
  const trayBox = document.querySelector('.photo-action-tray')?.getBoundingClientRect()
  const captureBox = document.querySelector('.capture-bar')?.getBoundingClientRect()
  const stripBox = document.querySelector('.live-strip')?.getBoundingClientRect()
  const captureStyle = document.querySelector('.capture-bar') ? getComputedStyle(document.querySelector('.capture-bar')) : null
  return {
    clearsCanvas: !!trayBox && !!stripBox && stripBox.bottom <= trayBox.top + 1,
    captureControlsYielded:
      !!trayBox &&
      !!captureBox &&
      !!captureStyle &&
      Number.parseFloat(captureStyle.opacity) < 0.05 &&
      captureStyle.pointerEvents === 'none',
  }
})
const uploadHistoryCount = await historyCount(page, 'undo')
const uploadCreatedOneHistoryStep = uploadHistoryCount === layoutHistoryCount + 1
const stageStableDuringActivation =
  Math.abs(beforeTrayActivationBox.y - duringTrayActivationBox.y) < 1 &&
  Math.abs(beforeTrayActivationBox.height - duringTrayActivationBox.height) < 1
const canvasStableWithTray =
  Math.abs(beforeTrayActivationBox.x - afterTrayActivationBox.x) < 1 &&
  Math.abs(beforeTrayActivationBox.y - afterTrayActivationBox.y) < 1 &&
  Math.abs(beforeTrayActivationBox.width - afterTrayActivationBox.width) < 1 &&
  Math.abs(beforeTrayActivationBox.height - afterTrayActivationBox.height) < 1
await page.getByRole('button', { name: 'Undo' }).tap()
await page.waitForFunction(() => !document.querySelector('[data-panel-id="1"] img'))
const uploadUndone = (await page.locator('[data-panel-id="1"] img').count()) === 0
await page.getByRole('button', { name: 'Redo' }).tap()
await page.waitForFunction(() => document.querySelector('[data-panel-id="1"] img'))

const beforeMoveToPinch = await photoTransform(page, '1')
const moveToPinchHistoryBefore = await historyCount(page, 'undo')
await moveThenAddSecondFinger(page, 0.28, 0.5, 28, -12)
const afterMoveToPinch = await photoTransform(page, '1')
const moveToPinchHistoryAfter = await historyCount(page, 'undo')
await page.getByRole('button', { name: 'Undo' }).tap()
await waitForTransform(page, '1', beforeMoveToPinch)
const moveToPinchUndoRestored = transformMatches(await photoTransform(page, '1'), beforeMoveToPinch)

const beforeDrag = await photoTransform(page, '1')
await dragPanelPhoto(page, 0.28, 0.5, 56, -24)
const afterDrag = await photoTransform(page, '1')
const dragHistoryCount = await historyCount(page, 'undo')
await page.getByRole('button', { name: 'Undo' }).tap()
await waitForTransform(page, '1', beforeDrag)
const afterUndoDrag = await photoTransform(page, '1')
await page.getByRole('button', { name: 'Redo' }).tap()
await waitForTransform(page, '1', afterDrag)
const afterRedoDrag = await photoTransform(page, '1')

const pinchResult = await pinchRotateNearSnap(page, 0.28, 0.5, 87)
const afterPinch = await photoTransform(page, '1')
const snapCueCleared = (await page.locator('.rotation-snap-cue').count()) === 0
const pinchHistoryCount = await historyCount(page, 'undo')
await page.getByRole('button', { name: 'Undo' }).tap()
await waitForTransform(page, '1', afterDrag)
const afterUndoPinch = await photoTransform(page, '1')
await page.getByRole('button', { name: 'Redo' }).tap()
await waitForTransform(page, '1', afterPinch)

await page.getByRole('button', { name: 'Reset panel 1 photo' }).tap()
await waitForTransform(page, '1', identityTransform())
const afterReset = await photoTransform(page, '1')
await page.getByRole('button', { name: 'Undo' }).tap()
await waitForTransform(page, '1', afterPinch)
const redoEnabledAfterUndo = !(await page.getByRole('button', { name: 'Redo' }).isDisabled())
await page.getByRole('button', { name: 'Fit whole photo in panel 1' }).tap()
const fitAfterToggle = await page.locator('[data-panel-id="1"] img').getAttribute('data-shot-fit')
const redoClearedByNewEdit = await page.getByRole('button', { name: 'Redo' }).isDisabled()

const transformBeforeRemove = await photoTransform(page, '1')
const removeHistoryBefore = await historyCount(page, 'undo')
await page.getByRole('button', { name: 'Remove panel 1 photo' }).tap()
const imageCountAfterRemove = await page.locator('[data-panel-id="1"] img').count()
const removeCreatedOneHistoryStep = (await historyCount(page, 'undo')) === removeHistoryBefore + 1
await setLayout(page, 'Story')
const removedAfterFirstLayoutUndoTarget = (await page.locator('.live-panel img').count()) === 0
await setLayout(page, 'Manga')
const removedPhotoStayedRemoved = (await page.locator('[data-panel-id="1"] img').count()) === 0
await page.getByRole('button', { name: 'Undo' }).tap()
const firstUndoLayout = await page.locator('.live-strip').getAttribute('data-layout-name')
const firstUndoStillRemoved = (await page.locator('.live-panel img').count()) === 0
await page.getByRole('button', { name: 'Undo' }).tap()
const secondUndoLayout = await page.locator('.live-strip').getAttribute('data-layout-name')
const secondUndoStillRemoved = (await page.locator('.live-panel img').count()) === 0
await page.getByRole('button', { name: 'Undo' }).tap()
await page.waitForFunction(() => document.querySelector('[data-panel-id="1"] img'))
const photoRestoredAfterUndoRemove = await page.locator('[data-panel-id="1"] img').count()
const restoredFitAfterUndoRemove = await page.locator('[data-panel-id="1"] img').getAttribute('data-shot-fit')
const restoredTransformAfterUndoRemove = await photoTransform(page, '1')
await selectPanel(page, '1')

const originalSource = await page.locator('[data-panel-id="1"] img').getAttribute('src')
const chooserPromise = page.waitForEvent('filechooser')
await page.getByRole('button', { name: 'Replace panel 1 photo' }).tap()
const chooser = await chooserPromise
await chooser.setFiles(testImage('replacement.png'))
await page.waitForFunction((source) => document.querySelector('[data-panel-id="1"] img')?.getAttribute('src') !== source, originalSource)
const replacedSource = await page.locator('[data-panel-id="1"] img').getAttribute('src')
const selectedAfterReplace = await page.locator('[data-panel-id="1"]').getAttribute('aria-pressed')
await page.getByRole('button', { name: 'Undo' }).tap()
await page.waitForFunction((source) => document.querySelector('[data-panel-id="1"] img')?.getAttribute('src') === source, originalSource)
const sourceAfterUndoReplace = await page.locator('[data-panel-id="1"] img').getAttribute('src')
await page.getByRole('button', { name: 'Redo' }).tap()
await page.waitForFunction((source) => document.querySelector('[data-panel-id="1"] img')?.getAttribute('src') === source, replacedSource)

await page.getByRole('button', { name: 'Fit whole photo in panel 1' }).tap()
const replacementFitBeforeSave = await page.locator('[data-panel-id="1"] img').getAttribute('data-shot-fit')
const draftBeforeBackground = await readDraft(page)
await dragPanelPhoto(page, 0.28, 0.5, 14, -8)
const backgroundTransform = await photoTransform(page, '1')
await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })))
const backgroundSavedDraft = await waitForDraftRevision(page, (draftBeforeBackground?.revision ?? 0) + 1)
const backgroundSavedShot = backgroundSavedDraft.document.shotCache.find(Boolean)
const backgroundFlushSaved =
  !!backgroundSavedShot &&
  Math.abs(backgroundSavedShot.offsetX - backgroundTransform.x) < 0.011 &&
  Math.abs(backgroundSavedShot.offsetY - backgroundTransform.y) < 0.011

await dragPanelPhoto(page, 0.28, 0.5, 32, 18)
const draftTransform = await photoTransform(page, '1')
await openDrawer(page)
await page.getByRole('button', { name: 'Style', exact: true }).tap()
await page
  .locator('.motion-drawer-style label')
  .filter({ hasText: 'Paper' })
  .locator('input[type="color"]')
  .evaluate((input) => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    valueSetter?.call(input, '#ffed5a')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
await closeDrawer(page)
const draftBeforeSave = await readDraft(page)
const savedDraftRecord = await waitForDraftRevision(page, (draftBeforeSave?.revision ?? 0) + 1)
await page.waitForFunction(() => document.querySelector('.native-shell')?.getAttribute('data-autosave-state') === 'saved')
const savedAssetCount = await readAssetCount(page)
const revisionBeforeIdle = savedDraftRecord.revision
await page.waitForTimeout(700)
const revisionAfterIdle = (await readDraft(page))?.revision ?? 0

mkdirSync('test-results', { recursive: true })
await page.screenshot({ path: 'test-results/direct-editing.png', fullPage: true })
await page.reload({ waitUntil: 'networkidle' })
const recoveryButtonVisible = await page.getByRole('button', { name: 'Continue editing' }).count()
const recoveryText = await page.locator('.draft-recovery-card').innerText()
await page.screenshot({ path: 'test-results/draft-recovery.png', fullPage: true })
await page.getByRole('button', { name: 'Continue editing' }).tap()
await page.locator('.start-screen').waitFor({ state: 'detached' })
await page.waitForFunction(() => document.querySelector('[data-panel-id="1"] img'))
const restoredTransform = await photoTransform(page, '1')
const restoredLayout = await page.locator('.live-strip').getAttribute('data-layout-name')
const restoredFormat = await page.locator('.live-strip').getAttribute('data-page-format')
const restoredFit = await page.locator('[data-panel-id="1"] img').getAttribute('data-shot-fit')
const restoredPaper = await page.locator('.live-strip').evaluate((strip) => getComputedStyle(strip).getPropertyValue('--paper').trim())
const restoredPhotoCount = await page.locator('.live-panel img').count()
await page.evaluate(() => document.exitFullscreen?.())
await page.setViewportSize({ width: 320, height: 568 })
await page.waitForTimeout(220)
const shortScreenGeometry = await page.evaluate(() => {
  const history = document.querySelector('.history-toolbar')?.getBoundingClientRect()
  const strip = document.querySelector('.live-strip')?.getBoundingClientRect()
  const tray = document.querySelector('.photo-action-tray')?.getBoundingClientRect()
  return {
    historyClearsCanvas: !!history && !!strip && history.bottom <= strip.top + 1,
    trayClearsCanvas: !!tray && !!strip && strip.bottom <= tray.top + 1,
  }
})
await page.setViewportSize({ width: 390, height: 844 })

await page.reload({ waitUntil: 'networkidle' })
const revisionBeforeNewChoice = (await readDraft(page))?.revision ?? 0
await page.getByRole('button', { name: 'New comic' }).tap()
const startNewVisible = await page.getByRole('button', { name: 'Start new' }).count()
const draftPreservedDuringChoice = (await readDraft(page))?.revision === revisionBeforeNewChoice
await page.getByRole('button', { name: /4:3/ }).tap()
await page.getByRole('button', { name: 'Start new' }).tap()
await page.locator('.start-screen').waitFor({ state: 'detached' })
const newComicPhotoCount = await page.locator('.live-panel img').count()
const newComicUndoCount = await historyCount(page, 'undo')
const newComicFormat = await page.locator('.live-strip').getAttribute('data-page-format')
const draftAfterNew = await readDraft(page)
const assetsAfterNew = await readAssetCount(page)

await browser.close()

const result = {
  baselineUndoDisabled,
  baselineRedoDisabled,
  trayButtonCount,
  trayButtonsMeetTarget,
  contextualTrayLayout,
  stageStableDuringActivation,
  canvasStableWithTray,
  uploadHistoryCount,
  uploadCreatedOneHistoryStep,
  uploadUndone,
  moveToPinchMoved: !transformMatches(afterMoveToPinch, beforeMoveToPinch),
  moveToPinchCreatedOneHistoryStep: moveToPinchHistoryAfter === moveToPinchHistoryBefore + 1,
  moveToPinchUndoRestored,
  photoMoved: Math.abs(afterDrag.x - beforeDrag.x) > 0.05 || Math.abs(afterDrag.y - beforeDrag.y) > 0.05,
  dragCreatedOneHistoryStep: dragHistoryCount === uploadHistoryCount + 1,
  undoDragRestored: transformMatches(afterUndoDrag, beforeDrag),
  redoDragRestored: transformMatches(afterRedoDrag, afterDrag),
  snapCueVisible: pinchResult.snapCueVisible,
  snapCueText: pinchResult.snapCueText,
  snapCueCleared,
  rotationSnapped: Math.abs(afterPinch.rotation - 90) < 0.01,
  pinchZoomed: afterPinch.scale > afterDrag.scale + 0.3,
  pinchCreatedOneHistoryStep: pinchHistoryCount === dragHistoryCount + 1,
  undoPinchRestored: transformMatches(afterUndoPinch, afterDrag),
  resetRestoredIdentity: transformMatches(afterReset, identityTransform()),
  redoEnabledAfterUndo,
  fitAfterToggle,
  redoClearedByNewEdit,
  imageCountAfterRemove,
  removeCreatedOneHistoryStep,
  removedAfterFirstLayoutUndoTarget,
  removedPhotoStayedRemoved,
  firstUndoLayout,
  firstUndoStillRemoved,
  secondUndoLayout,
  secondUndoStillRemoved,
  photoRestoredAfterUndoRemove,
  restoredFitAfterUndoRemove,
  restoredTransformAfterUndoRemove,
  transformBeforeRemove,
  selectedAfterReplace,
  replacementChangedSource: replacedSource !== originalSource,
  undoReplaceRestoredSource: sourceAfterUndoReplace === originalSource,
  replacementFitBeforeSave,
  backgroundFlushSaved,
  savedDraftPhotoCount: savedDraftRecord.document.shotCache.filter(Boolean).length,
  savedAssetCount,
  revisionStableWhenIdle: revisionAfterIdle === revisionBeforeIdle,
  recoveryButtonVisible,
  recoveryText,
  restoredTransform,
  draftTransform,
  restoredLayout,
  restoredFormat,
  restoredFit,
  restoredPaper,
  restoredPhotoCount,
  shortScreenGeometry,
  startNewVisible,
  draftPreservedDuringChoice,
  newComicPhotoCount,
  newComicUndoCount,
  newComicFormat,
  draftAfterNew,
  assetsAfterNew,
  errors,
}

console.log(JSON.stringify(result, null, 2))

const failures = [
  result.baselineUndoDisabled ? null : 'Undo is enabled before any edit',
  result.baselineRedoDisabled ? null : 'Redo is enabled before any edit',
  result.trayButtonCount === 4 ? null : 'contextual photo tray does not expose four focused actions',
  result.trayButtonsMeetTarget ? null : 'contextual photo controls are smaller than 44px',
  result.contextualTrayLayout.clearsCanvas ? null : 'contextual photo tray overlaps the editable canvas',
  result.contextualTrayLayout.captureControlsYielded ? null : 'capture controls did not yield to contextual photo editing',
  result.stageStableDuringActivation ? null : 'selecting a photo moves the canvas while the finger is down',
  result.canvasStableWithTray ? null : 'opening contextual photo controls changes the canvas geometry or aspect ratio',
  result.uploadCreatedOneHistoryStep ? null : 'upload did not create exactly one history step',
  result.uploadUndone ? null : 'Undo did not remove the uploaded photo',
  result.moveToPinchMoved ? null : 'one-finger move before pinch did not update the photo',
  result.moveToPinchCreatedOneHistoryStep ? null : 'move-to-pinch transition lost or split its history entry',
  result.moveToPinchUndoRestored ? null : 'Undo did not restore the move-to-pinch gesture baseline',
  result.photoMoved ? null : 'photo drag did not update the selected photo',
  result.dragCreatedOneHistoryStep ? null : 'one drag did not create exactly one history step',
  result.undoDragRestored ? null : 'Undo did not restore the pre-drag transform',
  result.redoDragRestored ? null : 'Redo did not restore the drag transform',
  result.snapCueVisible && result.snapCueText === '90°' ? null : 'near-90-degree rotation did not show snap feedback',
  result.snapCueCleared ? null : 'rotation snap feedback remained after the gesture',
  result.rotationSnapped ? null : 'near-90-degree rotation did not snap exactly to 90 degrees',
  result.pinchZoomed ? null : 'rotation snapping prevented simultaneous pinch zoom',
  result.pinchCreatedOneHistoryStep ? null : 'one pinch gesture did not create exactly one history step',
  result.undoPinchRestored ? null : 'Undo did not coalesce and restore the pinch gesture',
  result.resetRestoredIdentity ? null : 'Reset did not restore the identity transform',
  result.redoEnabledAfterUndo ? null : 'Redo did not become available after Undo',
  result.fitAfterToggle === 'contain' ? null : 'contextual Fit did not apply to the selected photo',
  result.redoClearedByNewEdit ? null : 'a new edit did not clear Redo',
  result.imageCountAfterRemove === 0 ? null : 'Remove did not clear the selected photo',
  result.removeCreatedOneHistoryStep ? null : 'Remove did not create exactly one history step',
  result.removedAfterFirstLayoutUndoTarget ? null : 'removed photo reappeared after the first layout switch',
  result.removedPhotoStayedRemoved ? null : 'removed photo was resurrected by layout switching',
  result.firstUndoLayout === 'Story' && result.firstUndoStillRemoved ? null : 'first Undo did not only reverse the latest layout switch',
  result.secondUndoLayout === 'Manga' && result.secondUndoStillRemoved ? null : 'second Undo did not only reverse the earlier layout switch',
  result.photoRestoredAfterUndoRemove === 1 ? null : 'Undo did not restore the removed photo',
  result.restoredFitAfterUndoRemove === 'contain' ? null : 'Undo remove did not restore the photo fit',
  transformMatches(result.restoredTransformAfterUndoRemove, result.transformBeforeRemove) ? null : 'Undo remove did not restore the photo transform',
  result.selectedAfterReplace === 'true' ? null : 'Replace did not keep the edited panel selected',
  result.replacementChangedSource ? null : 'Replace did not update the selected photo',
  result.undoReplaceRestoredSource ? null : 'Undo did not restore the replaced photo',
  result.replacementFitBeforeSave === 'contain' ? null : 'replacement photo fit was not set before save',
  result.backgroundFlushSaved ? null : 'pagehide did not flush the latest photo edit',
  result.savedDraftPhotoCount === 1 ? null : 'autosave did not persist the project photo slots',
  result.savedAssetCount === 1 ? null : 'autosave did not prune replaced or removed photo assets',
  result.revisionStableWhenIdle ? null : 'autosave rewrote an unchanged draft',
  result.recoveryButtonVisible === 1 ? null : 'Continue editing was not offered after reload',
  result.recoveryText.includes('Manga') && result.recoveryText.includes('1 photo') ? null : 'draft recovery summary is incomplete',
  transformMatches(result.restoredTransform, result.draftTransform) ? null : 'Continue did not restore the saved photo transform',
  result.restoredLayout === 'Manga' ? null : 'Continue did not restore the saved layout',
  result.restoredFormat === '9:16' ? null : 'Continue did not restore the saved canvas format',
  result.restoredFit === 'contain' ? null : 'Continue did not restore the per-photo fit',
  result.restoredPaper === '#ffed5a' ? null : 'Continue did not restore saved style settings',
  result.restoredPhotoCount === 1 ? null : 'Continue did not restore the saved photo',
  result.shortScreenGeometry.historyClearsCanvas && result.shortScreenGeometry.trayClearsCanvas ? null : 'short-screen controls overlap the editable canvas',
  result.startNewVisible === 1 ? null : 'New comic did not reveal the new-project setup',
  result.draftPreservedDuringChoice ? null : 'New comic erased the saved draft before confirmation',
  result.newComicPhotoCount === 0 ? null : 'Start new retained photos from the saved comic',
  result.newComicUndoCount === 0 ? null : 'Start new retained editing history',
  result.newComicFormat === '4:3' ? null : 'Start new did not use the newly selected canvas format',
  result.draftAfterNew === null ? null : 'Start new did not clear the saved draft',
  result.assetsAfterNew === 0 ? null : 'Start new did not clear saved photo assets',
  result.errors.length === 0 ? null : `page errors: ${result.errors.join('; ')}`,
].filter(Boolean)

if (failures.length > 0) {
  throw new Error(failures.join('\n'))
}

function testImage(name) {
  return {
    name,
    mimeType: 'image/png',
    buffer:
      name === 'replacement.png'
        ? solidPng(3, 3, [24, 183, 168, 255])
        : solidPng(3, 3, [255, 93, 77, 255]),
  }
}

function solidPng(width, height, color) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1)
    raw[row] = 0
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 4
      raw[offset] = color[0]
      raw[offset + 1] = color[1]
      raw[offset + 2] = color[2]
      raw[offset + 3] = color[3]
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4)
  const crc = Buffer.alloc(4)
  const typeBuffer = Buffer.from(type)
  length.writeUInt32BE(data.length, 0)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
  return Buffer.concat([length, typeBuffer, data, crc])
}

function crc32(buffer) {
  let value = 0xffffffff
  for (const byte of buffer) {
    value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8)
  }
  return (value ^ 0xffffffff) >>> 0
}

function createCrcTable() {
  const table = new Uint32Array(256)
  for (let index = 0; index < table.length; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
}

async function setLayout(page, name) {
  await openDrawer(page)
  await page.getByRole('button', { name: 'Layout', exact: true }).tap()
  await page.getByRole('button', { name: new RegExp(`^Use ${name} layout`) }).tap()
  await closeDrawer(page)
}

async function selectPanel(page, panelId) {
  await page.locator(`[data-panel-id="${panelId}"]`).evaluate((panel) => panel.click())
  await page.waitForFunction((id) => document.querySelector(`[data-panel-id="${id}"]`)?.getAttribute('aria-pressed') === 'true', panelId)
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
  if ((await page.locator('.motion-drawer.is-open').count()) > 0) {
    await page.locator('.motion-drawer.is-open .drawer-grabber').evaluate((button) => button.click())
  }
  await page.waitForFunction(() => {
    const box = document.querySelector('.motion-drawer')?.getBoundingClientRect()
    return !!box && box.top > window.innerHeight
  })
}

async function historyCount(page, kind) {
  return Number(await page.locator('.native-shell').getAttribute(`data-history-${kind}`))
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

function identityTransform() {
  return { x: 0, y: 0, scale: 1, rotation: 0 }
}

function transformMatches(first, second) {
  return (
    Math.abs(first.x - second.x) < 0.011 &&
    Math.abs(first.y - second.y) < 0.011 &&
    Math.abs(first.scale - second.scale) < 0.011 &&
    Math.abs(first.rotation - second.rotation) < 0.011
  )
}

async function waitForTransform(page, panelId, expected) {
  await page.waitForFunction(
    ({ id, transform }) => {
      const image = document.querySelector(`[data-panel-id="${id}"] img`)
      if (!image) return false
      return (
        Math.abs(Number(image.getAttribute('data-shot-x')) - transform.x) < 0.011 &&
        Math.abs(Number(image.getAttribute('data-shot-y')) - transform.y) < 0.011 &&
        Math.abs(Number(image.getAttribute('data-shot-scale')) - transform.scale) < 0.011 &&
        Math.abs(Number(image.getAttribute('data-shot-rotation')) - transform.rotation) < 0.011
      )
    },
    { id: panelId, transform: expected },
  )
}

async function dragPanelPhoto(page, nx, ny, dx, dy) {
  const box = await page.locator('.live-strip').boundingBox()
  const start = { x: box.x + box.width * nx, y: box.y + box.height * ny }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(100)
}

async function moveThenAddSecondFinger(page, nx, ny, dx, dy) {
  const box = await page.locator('.live-strip').boundingBox()
  const client = await page.context().newCDPSession(page)
  const start = { x: box.x + box.width * nx, y: box.y + box.height * ny }
  const moved = { x: start.x + dx, y: start.y + dy }
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ ...start, id: 11 }],
  })
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ ...moved, id: 11 }],
  })
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { ...moved, id: 11 },
      { x: moved.x + 42, y: moved.y, id: 12 },
    ],
  })
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await page.waitForTimeout(120)
}

async function pinchRotateNearSnap(page, nx, ny, angleDegrees) {
  const box = await page.locator('.live-strip').boundingBox()
  const client = await page.context().newCDPSession(page)
  const center = { x: box.x + box.width * nx, y: box.y + box.height * ny }
  const startRadius = 36
  const endRadius = 55
  const radians = (angleDegrees * Math.PI) / 180
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: center.x - startRadius, y: center.y, id: 1 },
      { x: center.x + startRadius, y: center.y, id: 2 },
    ],
  })
  for (const progress of [0.25, 0.5, 0.75, 1]) {
    const stepRadians = radians * progress
    const stepRadius = startRadius + (endRadius - startRadius) * progress
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: center.x - Math.cos(stepRadians) * stepRadius, y: center.y - Math.sin(stepRadians) * stepRadius, id: 1 },
        { x: center.x + Math.cos(stepRadians) * stepRadius, y: center.y + Math.sin(stepRadians) * stepRadius, id: 2 },
      ],
    })
  }
  await page.waitForFunction(() => document.querySelector('[data-panel-id="1"] img')?.getAttribute('data-shot-rotation') === '90.00')
  const snapCueVisible = await page.locator('.rotation-snap-cue').isVisible()
  const snapCueText = await page.locator('.rotation-snap-cue span').textContent()
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await page.waitForTimeout(100)
  return { snapCueVisible, snapCueText }
}

async function readDraft(page) {
  return page.evaluate(() =>
    new Promise((resolve, reject) => {
      const request = indexedDB.open('instacomic', 1)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const database = request.result
        const transaction = database.transaction('drafts', 'readonly')
        const get = transaction.objectStore('drafts').get('current')
        get.onsuccess = () => resolve(get.result ?? null)
        get.onerror = () => reject(get.error)
        transaction.oncomplete = () => database.close()
      }
    }),
  )
}

async function readAssetCount(page) {
  return page.evaluate(() =>
    new Promise((resolve, reject) => {
      const request = indexedDB.open('instacomic', 1)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const database = request.result
        const transaction = database.transaction('assets', 'readonly')
        const count = transaction.objectStore('assets').count()
        count.onsuccess = () => resolve(count.result)
        count.onerror = () => reject(count.error)
        transaction.oncomplete = () => database.close()
      }
    }),
  )
}

async function waitForDraftRevision(page, minimumRevision) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 10000) {
    const draft = await readDraft(page)
    if (draft?.revision >= minimumRevision) {
      return draft
    }
    await page.waitForTimeout(100)
  }
  throw new Error(`Draft revision ${minimumRevision} was not saved`)
}
