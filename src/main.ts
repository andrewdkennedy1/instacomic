import './style.css'

type PanelFit = 'cover' | 'contain'
type StickerKind = 'speech' | 'thought' | 'burst' | 'caption' | 'arrow' | 'star'

type Panel = {
  id: string
  x: number
  y: number
  w: number
  h: number
}

type Layout = {
  id: string
  name: string
  description: string
  panels: Panel[]
}

type Shot = {
  dataUrl: string
}

type Sticker = {
  id: string
  kind: StickerKind
  x: number
  y: number
  w: number
  h: number
  rotation: number
  text: string
  fill: string
  ink: string
  fontSize: number
}

type ExportSettings = {
  gutters: number
  radius: number
  border: number
  background: string
  borderColor: string
  caption: string
  captionColor: string
  captionSize: number
  captionBand: boolean
  fit: PanelFit
}

type DragMode = 'move' | 'resize'

type DragState = {
  stickerId: string
  mode: DragMode
  startClientX: number
  startClientY: number
  startX: number
  startY: number
  startW: number
  startH: number
  rect: DOMRect
}

const layouts: Layout[] = [
  {
    id: 'classic-3',
    name: 'Classic 3',
    description: 'Three clean story beats',
    panels: [
      { id: '1', x: 0, y: 0, w: 1, h: 1 / 3 },
      { id: '2', x: 0, y: 1 / 3, w: 1, h: 1 / 3 },
      { id: '3', x: 0, y: 2 / 3, w: 1, h: 1 / 3 },
    ],
  },
  {
    id: 'two-up',
    name: 'Two Up',
    description: 'Before and after',
    panels: [
      { id: '1', x: 0, y: 0, w: 1, h: 0.5 },
      { id: '2', x: 0, y: 0.5, w: 1, h: 0.5 },
    ],
  },
  {
    id: 'cover-story',
    name: 'Cover Story',
    description: 'Big opener plus reactions',
    panels: [
      { id: '1', x: 0, y: 0, w: 1, h: 0.58 },
      { id: '2', x: 0, y: 0.58, w: 0.5, h: 0.42 },
      { id: '3', x: 0.5, y: 0.58, w: 0.5, h: 0.42 },
    ],
  },
  {
    id: 'four-square',
    name: 'Four Square',
    description: 'A fast 2 x 2 grid',
    panels: [
      { id: '1', x: 0, y: 0, w: 0.5, h: 0.5 },
      { id: '2', x: 0.5, y: 0, w: 0.5, h: 0.5 },
      { id: '3', x: 0, y: 0.5, w: 0.5, h: 0.5 },
      { id: '4', x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
    ],
  },
  {
    id: 'punchline',
    name: 'Punchline',
    description: 'Setup, setup, payoff',
    panels: [
      { id: '1', x: 0, y: 0, w: 0.5, h: 0.45 },
      { id: '2', x: 0.5, y: 0, w: 0.5, h: 0.45 },
      { id: '3', x: 0, y: 0.45, w: 1, h: 0.55 },
    ],
  },
  {
    id: 'manga-page',
    name: 'Manga Page',
    description: 'Tall lead with stacked beats',
    panels: [
      { id: '1', x: 0, y: 0, w: 0.58, h: 1 },
      { id: '2', x: 0.58, y: 0, w: 0.42, h: 1 / 3 },
      { id: '3', x: 0.58, y: 1 / 3, w: 0.42, h: 1 / 3 },
      { id: '4', x: 0.58, y: 2 / 3, w: 0.42, h: 1 / 3 },
    ],
  },
]

const stickerDefaults: Record<StickerKind, Omit<Sticker, 'id' | 'kind' | 'x' | 'y'>> = {
  speech: {
    w: 0.34,
    h: 0.12,
    rotation: -2,
    text: 'say it',
    fill: '#ffffff',
    ink: '#111111',
    fontSize: 26,
  },
  thought: {
    w: 0.3,
    h: 0.12,
    rotation: 2,
    text: 'hmm...',
    fill: '#ffffff',
    ink: '#111111',
    fontSize: 24,
  },
  burst: {
    w: 0.3,
    h: 0.13,
    rotation: -5,
    text: 'WOW!',
    fill: '#ffd84d',
    ink: '#111111',
    fontSize: 30,
  },
  caption: {
    w: 0.42,
    h: 0.1,
    rotation: 0,
    text: 'meanwhile...',
    fill: '#fff0a8',
    ink: '#111111',
    fontSize: 22,
  },
  arrow: {
    w: 0.26,
    h: 0.1,
    rotation: -10,
    text: 'look',
    fill: '#ff6b55',
    ink: '#111111',
    fontSize: 20,
  },
  star: {
    w: 0.24,
    h: 0.12,
    rotation: 8,
    text: 'snap',
    fill: '#48d3c5',
    ink: '#111111',
    fontSize: 22,
  },
}

const state: {
  layout: Layout
  activePanelId: string
  activeStickerId: string | null
  shots: Map<string, Shot>
  stickers: Sticker[]
  settings: ExportSettings
  stream: MediaStream | null
  cameraFacing: 'environment' | 'user'
  exportedUrl: string | null
  drag: DragState | null
} = {
  layout: layouts[2],
  activePanelId: layouts[2].panels[0].id,
  activeStickerId: null,
  shots: new Map(),
  stickers: [],
  settings: {
    gutters: 14,
    radius: 8,
    border: 5,
    background: '#f7f0dc',
    borderColor: '#141414',
    caption: 'instacomic',
    captionColor: '#111111',
    captionSize: 48,
    captionBand: true,
    fit: 'cover',
  },
  stream: null,
  cameraFacing: 'environment',
  exportedUrl: null,
  drag: null,
}

const root = document.querySelector<HTMLDivElement>('#app')

if (!root) {
  throw new Error('Missing #app root')
}

const app = root

app.innerHTML = `
  <main class="app-shell">
    <section class="workspace" aria-label="Comic camera workspace">
      <header class="brand-bar">
        <div>
          <p class="eyebrow">Instacomic</p>
          <h1>Snap a comic strip panel by panel.</h1>
        </div>
        <button class="icon-button install-button is-hidden" type="button" title="Install app" aria-label="Install app">
          <span aria-hidden="true">+</span>
        </button>
      </header>

      <section class="camera-stage" aria-label="Camera">
        <video class="camera-feed" autoplay muted playsinline></video>
        <div class="camera-placeholder">
          <strong>Camera idle</strong>
          <span>Start camera, tap a panel, then shoot.</span>
        </div>
        <div class="camera-target" aria-live="polite">Next shot: Panel 1</div>
        <div class="camera-actions">
          <button class="tool-button start-camera" type="button">Start Camera</button>
          <button class="icon-button flip-camera" type="button" title="Flip camera" aria-label="Flip camera">↺</button>
        </div>
      </section>

      <section class="capture-controls" aria-label="Capture controls">
        <button class="shutter-button" type="button" aria-label="Take photo">
          <span></span>
        </button>
        <div>
          <p class="capture-title">Panel 1 selected</p>
          <p class="capture-detail">Start the camera, then press the shutter to fill this section.</p>
        </div>
      </section>

      <section class="strip-wrap" aria-label="Comic preview">
        <div class="comic-strip" role="group" aria-label="Tap a panel to choose where the next live photo goes"></div>
      </section>
    </section>

    <aside class="control-panel" aria-label="Comic settings">
      <section class="control-section">
        <div class="section-heading">
          <h2>Layout</h2>
          <span class="panel-count">3 panels</span>
        </div>
        <div class="layout-list"></div>
      </section>

      <section class="control-section">
        <div class="section-heading">
          <h2>Stickers</h2>
          <button class="mini-button delete-sticker" type="button" disabled>Delete</button>
        </div>
        <div class="sticker-list">
          <button class="sticker-option" type="button" data-sticker-kind="speech">Speech</button>
          <button class="sticker-option" type="button" data-sticker-kind="thought">Thought</button>
          <button class="sticker-option" type="button" data-sticker-kind="burst">Burst</button>
          <button class="sticker-option" type="button" data-sticker-kind="caption">Caption</button>
          <button class="sticker-option" type="button" data-sticker-kind="arrow">Arrow</button>
          <button class="sticker-option" type="button" data-sticker-kind="star">Star</button>
        </div>
        <label class="field">
          <span>Sticker text</span>
          <input class="sticker-text-input" type="text" maxlength="36" disabled placeholder="Select or add a sticker" />
        </label>
        <div class="color-row">
          <label class="field">
            <span>Bubble</span>
            <input class="sticker-fill-input" type="color" value="#ffffff" disabled />
          </label>
          <label class="field">
            <span>Ink</span>
            <input class="sticker-ink-input" type="color" value="#111111" disabled />
          </label>
        </div>
        <label class="slider-field">
          <span>Text size</span>
          <input class="sticker-size-input" type="range" min="14" max="42" value="24" disabled />
          <output>24</output>
        </label>
      </section>

      <section class="control-section">
        <div class="section-heading">
          <h2>Customize</h2>
        </div>
        <label class="field">
          <span>Caption</span>
          <input class="caption-input" type="text" maxlength="42" value="instacomic" />
        </label>
        <label class="field">
          <span>Photo fit</span>
          <select class="fit-select">
            <option value="cover">Fill panels</option>
            <option value="contain">Fit full photo</option>
          </select>
        </label>
        <div class="color-row">
          <label class="field">
            <span>Paper</span>
            <input class="background-input" type="color" value="#f7f0dc" />
          </label>
          <label class="field">
            <span>Ink</span>
            <input class="border-input" type="color" value="#141414" />
          </label>
          <label class="field">
            <span>Text</span>
            <input class="caption-color-input" type="color" value="#111111" />
          </label>
        </div>
        <label class="slider-field">
          <span>Gutter</span>
          <input class="gutter-input" type="range" min="0" max="34" value="14" />
          <output>14</output>
        </label>
        <label class="slider-field">
          <span>Corner</span>
          <input class="radius-input" type="range" min="0" max="36" value="8" />
          <output>8</output>
        </label>
        <label class="slider-field">
          <span>Border</span>
          <input class="border-width-input" type="range" min="0" max="12" value="5" />
          <output>5</output>
        </label>
        <label class="switch-field">
          <input class="caption-band-input" type="checkbox" checked />
          <span>Caption band</span>
        </label>
      </section>

      <section class="control-section export-section">
        <button class="primary-button export-button" type="button">Render Comic</button>
        <div class="save-actions">
          <a class="tool-button save-link is-disabled" download="instacomic.png" aria-disabled="true">Save PNG</a>
          <button class="tool-button share-button" type="button" disabled>Share</button>
        </div>
        <p class="status-line" aria-live="polite">No comic rendered yet.</p>
      </section>
    </aside>
  </main>
`

const elements = {
  video: app.querySelector<HTMLVideoElement>('.camera-feed')!,
  placeholder: app.querySelector<HTMLDivElement>('.camera-placeholder')!,
  cameraTarget: app.querySelector<HTMLDivElement>('.camera-target')!,
  startCamera: app.querySelector<HTMLButtonElement>('.start-camera')!,
  flipCamera: app.querySelector<HTMLButtonElement>('.flip-camera')!,
  shutter: app.querySelector<HTMLButtonElement>('.shutter-button')!,
  captureTitle: app.querySelector<HTMLParagraphElement>('.capture-title')!,
  captureDetail: app.querySelector<HTMLParagraphElement>('.capture-detail')!,
  strip: app.querySelector<HTMLDivElement>('.comic-strip')!,
  layoutList: app.querySelector<HTMLDivElement>('.layout-list')!,
  panelCount: app.querySelector<HTMLSpanElement>('.panel-count')!,
  captionInput: app.querySelector<HTMLInputElement>('.caption-input')!,
  fitSelect: app.querySelector<HTMLSelectElement>('.fit-select')!,
  backgroundInput: app.querySelector<HTMLInputElement>('.background-input')!,
  borderInput: app.querySelector<HTMLInputElement>('.border-input')!,
  captionColorInput: app.querySelector<HTMLInputElement>('.caption-color-input')!,
  gutterInput: app.querySelector<HTMLInputElement>('.gutter-input')!,
  radiusInput: app.querySelector<HTMLInputElement>('.radius-input')!,
  borderWidthInput: app.querySelector<HTMLInputElement>('.border-width-input')!,
  captionBandInput: app.querySelector<HTMLInputElement>('.caption-band-input')!,
  stickerTextInput: app.querySelector<HTMLInputElement>('.sticker-text-input')!,
  stickerFillInput: app.querySelector<HTMLInputElement>('.sticker-fill-input')!,
  stickerInkInput: app.querySelector<HTMLInputElement>('.sticker-ink-input')!,
  stickerSizeInput: app.querySelector<HTMLInputElement>('.sticker-size-input')!,
  deleteSticker: app.querySelector<HTMLButtonElement>('.delete-sticker')!,
  exportButton: app.querySelector<HTMLButtonElement>('.export-button')!,
  saveLink: app.querySelector<HTMLAnchorElement>('.save-link')!,
  shareButton: app.querySelector<HTMLButtonElement>('.share-button')!,
  statusLine: app.querySelector<HTMLParagraphElement>('.status-line')!,
  installButton: app.querySelector<HTMLButtonElement>('.install-button')!,
}

let deferredInstallPrompt: (Event & { prompt: () => Promise<void> }) | null = null

function renderLayoutButtons() {
  elements.layoutList.innerHTML = layouts
    .map(
      (layout) => `
        <button class="layout-option ${layout.id === state.layout.id ? 'is-selected' : ''}" type="button" data-layout-id="${layout.id}">
          <span class="layout-thumb" aria-hidden="true">
            ${layout.panels
              .map(
                (panel) =>
                  `<i style="left:${panel.x * 100}%;top:${panel.y * 100}%;width:${panel.w * 100}%;height:${panel.h * 100}%"></i>`,
              )
              .join('')}
          </span>
          <span>
            <strong>${layout.name}</strong>
            <small>${layout.description}</small>
          </span>
        </button>
      `,
    )
    .join('')
}

function renderComic() {
  const { settings } = state
  elements.panelCount.textContent = `${state.layout.panels.length} panels`
  elements.strip.style.setProperty('--paper', settings.background)
  elements.strip.style.setProperty('--ink', settings.borderColor)
  elements.strip.style.setProperty('--gutter', `${settings.gutters}px`)
  elements.strip.style.setProperty('--radius', `${settings.radius}px`)
  elements.strip.style.setProperty('--border', `${settings.border}px`)

  const caption = settings.caption.trim()
  elements.strip.innerHTML = `
    <div class="panel-layer">
      ${state.layout.panels
        .map((panel, index) => renderPanel(panel, index))
        .join('')}
      ${state.stickers.map((sticker) => renderSticker(sticker)).join('')}
    </div>
    ${
      caption
        ? `<div class="caption ${settings.captionBand ? 'has-band' : ''}" style="color:${settings.captionColor}">${escapeHtml(caption)}</div>`
        : ''
    }
  `

  updateCaptureCopy()
  renderLayoutButtons()
  syncStickerControls()
}

function renderPanel(panel: Panel, index: number) {
  const shot = state.shots.get(panel.id)
  const activeClass = panel.id === state.activePanelId ? 'is-active' : ''
  const filledClass = shot ? 'is-filled' : ''
  return `
    <button
      class="comic-panel ${activeClass} ${filledClass}"
      type="button"
      data-panel-id="${panel.id}"
      aria-label="Use panel ${index + 1} for the next live photo"
      style="left:${panel.x * 100}%;top:${panel.y * 100}%;width:${panel.w * 100}%;height:${panel.h * 100}%"
    >
      ${shot ? `<img src="${shot.dataUrl}" alt="Panel ${index + 1} photo" />` : ''}
      <span class="panel-label">${shot ? `Panel ${index + 1}` : `Tap panel ${index + 1}`}</span>
    </button>
  `
}

function renderSticker(sticker: Sticker) {
  const activeClass = sticker.id === state.activeStickerId ? 'is-active' : ''
  return `
    <div
      class="sticker sticker-${sticker.kind} ${activeClass}"
      data-sticker-id="${sticker.id}"
      role="button"
      tabindex="0"
      aria-label="Drag ${sticker.kind} sticker"
      style="${stickerStyle(sticker)}"
    >
      <span class="sticker-text">${escapeHtml(sticker.text)}</span>
      <span class="resize-handle" aria-hidden="true"></span>
    </div>
  `
}

function stickerStyle(sticker: Sticker) {
  return [
    `left:${sticker.x * 100}%`,
    `top:${sticker.y * 100}%`,
    `width:${sticker.w * 100}%`,
    `height:${sticker.h * 100}%`,
    `--sticker-fill:${sticker.fill}`,
    `--sticker-ink:${sticker.ink}`,
    `--sticker-size:${sticker.fontSize}px`,
    `transform:rotate(${sticker.rotation}deg)`,
  ].join(';')
}

function updateCaptureCopy() {
  const panelIndex = state.layout.panels.findIndex((panel) => panel.id === state.activePanelId)
  const label = `Panel ${panelIndex + 1}`
  elements.cameraTarget.textContent = `Next shot: ${label}`
  elements.captureTitle.textContent = `${label} selected`
  elements.captureDetail.textContent = state.stream
    ? `Press the shutter to place the live camera image into ${label}.`
    : 'Start the camera, then press the shutter to fill this section.'
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    elements.statusLine.textContent = 'This browser does not expose camera access.'
    return
  }

  stopCamera()

  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: state.cameraFacing },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    })
    elements.video.srcObject = state.stream
    elements.placeholder.classList.add('is-hidden')
    elements.startCamera.textContent = 'Camera On'
    elements.statusLine.textContent = 'Camera ready. Tap a panel to choose the next shot.'
    await elements.video.play()
  } catch (error) {
    state.stream = null
    elements.placeholder.classList.remove('is-hidden')
    elements.startCamera.textContent = 'Start Camera'
    elements.statusLine.textContent =
      error instanceof Error ? `Camera blocked: ${error.message}` : 'Camera blocked.'
  }

  updateCaptureCopy()
}

function stopCamera() {
  state.stream?.getTracks().forEach((track) => track.stop())
  state.stream = null
  elements.video.srcObject = null
}

async function flipCamera() {
  state.cameraFacing = state.cameraFacing === 'environment' ? 'user' : 'environment'
  await startCamera()
}

function captureActivePanel() {
  if (!state.stream || elements.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    elements.statusLine.textContent = 'Start the camera before taking a photo.'
    return
  }

  const canvas = document.createElement('canvas')
  const width = elements.video.videoWidth || 1280
  const height = elements.video.videoHeight || 720
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')

  if (!context) {
    elements.statusLine.textContent = 'Canvas is unavailable in this browser.'
    return
  }

  context.drawImage(elements.video, 0, 0, width, height)
  state.shots.set(state.activePanelId, {
    dataUrl: canvas.toDataURL('image/jpeg', 0.92),
  })

  const currentIndex = state.layout.panels.findIndex((panel) => panel.id === state.activePanelId)
  const nextEmpty = state.layout.panels.find((panel) => !state.shots.has(panel.id))
  const nextPanel = nextEmpty ?? state.layout.panels[(currentIndex + 1) % state.layout.panels.length]
  state.activePanelId = nextPanel.id

  revokeExport()
  renderComic()
  elements.statusLine.textContent = `Captured panel ${currentIndex + 1}.`
}

function selectPanel(panelId: string) {
  state.activePanelId = panelId
  renderComic()
  const index = state.layout.panels.findIndex((panel) => panel.id === panelId)
  elements.statusLine.textContent = `Panel ${index + 1} will get the next live photo.`
}

function selectLayout(layoutId: string) {
  const layout = layouts.find((item) => item.id === layoutId)

  if (!layout) {
    return
  }

  state.layout = layout
  state.activePanelId = layout.panels[0].id
  const allowedPanels = new Set(layout.panels.map((panel) => panel.id))

  for (const panelId of state.shots.keys()) {
    if (!allowedPanels.has(panelId)) {
      state.shots.delete(panelId)
    }
  }

  revokeExport()
  renderComic()
  elements.statusLine.textContent = `${layout.name} selected.`
}

function addSticker(kind: StickerKind) {
  const panel = state.layout.panels.find((item) => item.id === state.activePanelId) ?? state.layout.panels[0]
  const defaults = stickerDefaults[kind]
  const x = clamp(panel.x + panel.w / 2 - defaults.w / 2, 0.02, 0.98 - defaults.w)
  const y = clamp(panel.y + panel.h / 2 - defaults.h / 2, 0.02, 0.98 - defaults.h)
  const sticker: Sticker = {
    id: crypto.randomUUID(),
    kind,
    x,
    y,
    ...defaults,
  }

  state.stickers.push(sticker)
  state.activeStickerId = sticker.id
  revokeExport()
  renderComic()
  elements.statusLine.textContent = `${stickerLabel(kind)} sticker added. Drag it where you want it.`
}

function selectSticker(stickerId: string) {
  state.activeStickerId = stickerId
  syncStickerControls()
}

function getActiveSticker() {
  return state.stickers.find((sticker) => sticker.id === state.activeStickerId) ?? null
}

function deleteActiveSticker() {
  const activeId = state.activeStickerId

  if (!activeId) {
    return
  }

  state.stickers = state.stickers.filter((sticker) => sticker.id !== activeId)
  state.activeStickerId = null
  revokeExport()
  renderComic()
  elements.statusLine.textContent = 'Sticker deleted.'
}

function syncStickerControls() {
  const sticker = getActiveSticker()
  const disabled = !sticker
  elements.stickerTextInput.disabled = disabled
  elements.stickerFillInput.disabled = disabled
  elements.stickerInkInput.disabled = disabled
  elements.stickerSizeInput.disabled = disabled
  elements.deleteSticker.disabled = disabled

  if (!sticker) {
    elements.stickerTextInput.value = ''
    elements.stickerFillInput.value = '#ffffff'
    elements.stickerInkInput.value = '#111111'
    elements.stickerSizeInput.value = '24'
    setOutput(elements.stickerSizeInput, '24')
    return
  }

  elements.stickerTextInput.value = sticker.text
  elements.stickerFillInput.value = sticker.fill
  elements.stickerInkInput.value = sticker.ink
  elements.stickerSizeInput.value = String(sticker.fontSize)
  setOutput(elements.stickerSizeInput, String(sticker.fontSize))
}

function beginStickerDrag(event: PointerEvent, stickerId: string, mode: DragMode) {
  startStickerDrag(stickerId, mode, event.clientX, event.clientY)
  event.preventDefault()
  selectSticker(stickerId)
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function beginStickerTouch(event: TouchEvent, stickerId: string, mode: DragMode) {
  const touch = event.touches.item(0)

  if (!touch) {
    return
  }

  event.preventDefault()
  startStickerDrag(stickerId, mode, touch.clientX, touch.clientY)
  selectSticker(stickerId)
}

function startStickerDrag(stickerId: string, mode: DragMode, clientX: number, clientY: number) {
  const panelLayer = getPanelLayer()

  if (!panelLayer) {
    return
  }

  const sticker = state.stickers.find((item) => item.id === stickerId)

  if (!sticker) {
    return
  }

  state.drag = {
    stickerId,
    mode,
    startClientX: clientX,
    startClientY: clientY,
    startX: sticker.x,
    startY: sticker.y,
    startW: sticker.w,
    startH: sticker.h,
    rect: panelLayer.getBoundingClientRect(),
  }
}

function updateStickerDrag(event: PointerEvent) {
  moveStickerDrag(event.clientX, event.clientY)
}

function updateStickerTouch(event: TouchEvent) {
  const touch = event.touches.item(0)

  if (!touch) {
    return
  }

  event.preventDefault()
  moveStickerDrag(touch.clientX, touch.clientY)
}

function moveStickerDrag(clientX: number, clientY: number) {
  if (!state.drag) {
    return
  }

  const sticker = state.stickers.find((item) => item.id === state.drag?.stickerId)

  if (!sticker) {
    return
  }

  const dx = (clientX - state.drag.startClientX) / state.drag.rect.width
  const dy = (clientY - state.drag.startClientY) / state.drag.rect.height

  if (state.drag.mode === 'move') {
    sticker.x = clamp(state.drag.startX + dx, 0, 1 - sticker.w)
    sticker.y = clamp(state.drag.startY + dy, 0, 1 - sticker.h)
  } else {
    sticker.w = clamp(state.drag.startW + dx, 0.12, 0.85)
    sticker.h = clamp(state.drag.startH + dy, 0.06, 0.5)
    sticker.x = clamp(sticker.x, 0, 1 - sticker.w)
    sticker.y = clamp(sticker.y, 0, 1 - sticker.h)
  }

  const stickerElement = app.querySelector<HTMLElement>(`[data-sticker-id="${sticker.id}"]`)
  if (stickerElement) {
    stickerElement.setAttribute('style', stickerStyle(sticker))
  }
  revokeExport()
}

function endStickerDrag() {
  if (!state.drag) {
    return
  }

  state.drag = null
  renderComic()
}

async function exportComic() {
  elements.exportButton.disabled = true
  elements.statusLine.textContent = 'Rendering PNG...'

  try {
    const blob = await renderToPng()
    revokeExport()
    state.exportedUrl = URL.createObjectURL(blob)
    elements.saveLink.href = state.exportedUrl
    elements.saveLink.classList.remove('is-disabled')
    elements.saveLink.removeAttribute('aria-disabled')
    elements.shareButton.disabled = false
    elements.statusLine.textContent = 'Comic rendered. Save or share it to your phone.'
  } catch (error) {
    elements.statusLine.textContent = error instanceof Error ? error.message : 'Render failed.'
  } finally {
    elements.exportButton.disabled = false
  }
}

async function renderToPng(): Promise<Blob> {
  const canvas = document.createElement('canvas')
  const width = 1440
  const stripRatio = 1.45
  const caption = state.settings.caption.trim()
  const captionHeight = caption ? 150 : 0
  const height = Math.round(width * stripRatio + captionHeight)
  const panelHeight = height - captionHeight
  const context = canvas.getContext('2d')

  canvas.width = width
  canvas.height = height

  if (!context) {
    throw new Error('Canvas is unavailable in this browser.')
  }

  context.fillStyle = state.settings.background
  context.fillRect(0, 0, width, height)

  const gutter = state.settings.gutters * 3
  const outer = state.settings.border * 3
  const images = await Promise.all(
    state.layout.panels.map(async (panel) => ({
      panel,
      image: state.shots.has(panel.id) ? await loadImage(state.shots.get(panel.id)!.dataUrl) : null,
    })),
  )

  for (const { panel, image } of images) {
    const x = outer + panel.x * (width - outer * 2)
    const y = outer + panel.y * (panelHeight - outer * 2)
    const w = panel.w * (width - outer * 2)
    const h = panel.h * (panelHeight - outer * 2)
    const inset = gutter / 2
    const rect = {
      x: x + inset,
      y: y + inset,
      w: Math.max(1, w - gutter),
      h: Math.max(1, h - gutter),
    }

    drawPanel(context, image, rect.x, rect.y, rect.w, rect.h)
  }

  for (const sticker of state.stickers) {
    drawSticker(context, sticker, width, panelHeight)
  }

  if (caption) {
    drawCaption(context, caption, width, height, captionHeight, outer, gutter)
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))

  if (!blob) {
    throw new Error('The browser could not create the PNG.')
  }

  return blob
}

function drawPanel(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement | null,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  drawRoundedRect(context, x, y, w, h, state.settings.radius * 3)
  context.fillStyle = '#ffffff'
  context.fill()
  context.save()
  drawRoundedRect(context, x, y, w, h, state.settings.radius * 3)
  context.clip()

  if (image) {
    drawImageFit(context, image, x, y, w, h, state.settings.fit)
  } else {
    drawEmptyPanel(context, x, y, w, h)
  }

  context.restore()

  if (state.settings.border > 0) {
    context.lineWidth = state.settings.border * 3
    context.strokeStyle = state.settings.borderColor
    drawRoundedRect(context, x, y, w, h, state.settings.radius * 3)
    context.stroke()
  }
}

function drawCaption(
  context: CanvasRenderingContext2D,
  caption: string,
  width: number,
  height: number,
  captionHeight: number,
  outer: number,
  gutter: number,
) {
  const bandY = height - captionHeight
  if (state.settings.captionBand) {
    context.fillStyle = '#ffffff'
    context.fillRect(outer + gutter / 2, bandY + gutter / 2, width - outer * 2 - gutter, captionHeight - gutter)
    context.lineWidth = Math.max(2, state.settings.border * 2)
    context.strokeStyle = state.settings.borderColor
    context.strokeRect(
      outer + gutter / 2,
      bandY + gutter / 2,
      width - outer * 2 - gutter,
      captionHeight - gutter,
    )
  }

  context.fillStyle = state.settings.captionColor
  context.font = `800 ${state.settings.captionSize * 2}px ui-rounded, "Avenir Next", "Segoe UI", sans-serif`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(caption, width / 2, bandY + captionHeight / 2, width - 140)
}

function drawSticker(context: CanvasRenderingContext2D, sticker: Sticker, canvasWidth: number, panelHeight: number) {
  const x = sticker.x * canvasWidth
  const y = sticker.y * panelHeight
  const w = sticker.w * canvasWidth
  const h = sticker.h * panelHeight
  const cx = x + w / 2
  const cy = y + h / 2

  context.save()
  context.translate(cx, cy)
  context.rotate((sticker.rotation * Math.PI) / 180)
  context.translate(-w / 2, -h / 2)
  context.lineWidth = Math.max(5, Math.min(w, h) * 0.06)
  context.strokeStyle = sticker.ink
  context.fillStyle = sticker.fill

  if (sticker.kind === 'speech') {
    drawRoundedRect(context, 0, 0, w, h * 0.82, h * 0.28)
    context.fill()
    context.stroke()
    drawTail(context, w * 0.22, h * 0.72, w * 0.34, h * 0.72, w * 0.2, h)
  } else if (sticker.kind === 'thought') {
    drawOval(context, 0, 0, w, h * 0.78)
    context.fill()
    context.stroke()
    drawBubbleDot(context, w * 0.18, h * 0.82, h * 0.09)
    drawBubbleDot(context, w * 0.09, h * 0.94, h * 0.055)
  } else if (sticker.kind === 'burst') {
    drawBurst(context, w, h)
    context.fill()
    context.stroke()
  } else if (sticker.kind === 'arrow') {
    drawArrow(context, w, h)
  } else if (sticker.kind === 'star') {
    drawStar(context, w / 2, h / 2, Math.min(w, h) * 0.48, Math.min(w, h) * 0.23)
    context.fill()
    context.stroke()
  } else {
    drawRoundedRect(context, 0, 0, w, h, Math.min(18, h * 0.18))
    context.fill()
    context.stroke()
  }

  context.fillStyle = sticker.ink
  context.font = `900 ${sticker.fontSize * 3}px ui-rounded, "Avenir Next", "Segoe UI", sans-serif`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(sticker.text, w / 2, h * 0.43, w * 0.82)
  context.restore()
}

function drawTail(
  context: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
) {
  context.beginPath()
  context.moveTo(x1, y1)
  context.lineTo(x2, y2)
  context.lineTo(x3, y3)
  context.closePath()
  context.fill()
  context.stroke()
}

function drawBubbleDot(context: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  context.beginPath()
  context.arc(x, y, radius, 0, Math.PI * 2)
  context.fill()
  context.stroke()
}

function drawOval(context: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  context.beginPath()
  context.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
  context.closePath()
}

function drawBurst(context: CanvasRenderingContext2D, w: number, h: number) {
  const points = 18
  context.beginPath()
  for (let index = 0; index < points; index += 1) {
    const angle = (Math.PI * 2 * index) / points - Math.PI / 2
    const radius = index % 2 === 0 ? 0.52 : 0.36
    const x = w / 2 + Math.cos(angle) * w * radius
    const y = h / 2 + Math.sin(angle) * h * radius
    if (index === 0) {
      context.moveTo(x, y)
    } else {
      context.lineTo(x, y)
    }
  }
  context.closePath()
}

function drawArrow(context: CanvasRenderingContext2D, w: number, h: number) {
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.lineWidth = Math.max(12, h * 0.22)
  context.beginPath()
  context.moveTo(w * 0.08, h * 0.54)
  context.lineTo(w * 0.7, h * 0.54)
  context.stroke()
  context.beginPath()
  context.moveTo(w * 0.62, h * 0.2)
  context.lineTo(w * 0.92, h * 0.54)
  context.lineTo(w * 0.62, h * 0.88)
  context.stroke()
}

function drawStar(context: CanvasRenderingContext2D, cx: number, cy: number, outer: number, inner: number) {
  context.beginPath()
  for (let index = 0; index < 10; index += 1) {
    const radius = index % 2 === 0 ? outer : inner
    const angle = (Math.PI * index) / 5 - Math.PI / 2
    const x = cx + Math.cos(angle) * radius
    const y = cy + Math.sin(angle) * radius
    if (index === 0) {
      context.moveTo(x, y)
    } else {
      context.lineTo(x, y)
    }
  }
  context.closePath()
}

async function shareComic() {
  if (!state.exportedUrl) {
    return
  }

  const blob = await fetch(state.exportedUrl).then((response) => response.blob())
  const file = new File([blob], 'instacomic.png', { type: 'image/png' })
  const canShare = 'canShare' in navigator && navigator.canShare?.({ files: [file] })

  if (canShare) {
    await navigator.share({ files: [file], title: 'Instacomic' })
  } else {
    elements.statusLine.textContent = 'Sharing is not available here. Use Save PNG instead.'
  }
}

function revokeExport() {
  if (state.exportedUrl) {
    URL.revokeObjectURL(state.exportedUrl)
    state.exportedUrl = null
  }

  elements.saveLink.removeAttribute('href')
  elements.saveLink.classList.add('is-disabled')
  elements.saveLink.setAttribute('aria-disabled', 'true')
  elements.shareButton.disabled = true
}

function drawImageFit(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
  fit: PanelFit,
) {
  const imageRatio = image.width / image.height
  const rectRatio = w / h
  const cover = fit === 'cover'
  const useWidth = cover ? imageRatio < rectRatio : imageRatio > rectRatio
  const drawW = useWidth ? w : h * imageRatio
  const drawH = useWidth ? w / imageRatio : h
  const drawX = x + (w - drawW) / 2
  const drawY = y + (h - drawH) / 2
  context.drawImage(image, drawX, drawY, drawW, drawH)
}

function drawRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.min(radius, width / 2, height / 2)
  context.beginPath()
  context.moveTo(x + r, y)
  context.lineTo(x + width - r, y)
  context.quadraticCurveTo(x + width, y, x + width, y + r)
  context.lineTo(x + width, y + height - r)
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
  context.lineTo(x + r, y + height)
  context.quadraticCurveTo(x, y + height, x, y + height - r)
  context.lineTo(x, y + r)
  context.quadraticCurveTo(x, y, x + r, y)
  context.closePath()
}

function drawEmptyPanel(context: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  context.fillStyle = '#f4f4f4'
  context.fillRect(x, y, w, h)
  context.strokeStyle = '#d6d6d6'
  context.lineWidth = 6

  for (let offset = -h; offset < w; offset += 42) {
    context.beginPath()
    context.moveTo(x + offset, y + h)
    context.lineTo(x + offset + h, y)
    context.stroke()
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('A panel photo could not be loaded.'))
    image.src = src
  })
}

function getPanelLayer() {
  return elements.strip.querySelector<HTMLDivElement>('.panel-layer')
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    }
    return entities[char]
  })
}

function updateNumberSetting(input: HTMLInputElement, key: 'gutters' | 'radius' | 'border') {
  state.settings[key] = Number(input.value)
  setOutput(input, input.value)
  revokeExport()
  renderComic()
}

function setOutput(input: HTMLInputElement, value: string) {
  const output = input.nextElementSibling
  if (output instanceof HTMLOutputElement) {
    output.value = value
  }
}

function stickerLabel(kind: StickerKind) {
  return kind.charAt(0).toUpperCase() + kind.slice(1)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

elements.startCamera.addEventListener('click', () => void startCamera())
elements.flipCamera.addEventListener('click', () => void flipCamera())
elements.shutter.addEventListener('click', captureActivePanel)
elements.exportButton.addEventListener('click', () => void exportComic())
elements.shareButton.addEventListener('click', () => void shareComic())
elements.deleteSticker.addEventListener('click', deleteActiveSticker)

elements.strip.addEventListener('click', (event) => {
  const stickerElement = (event.target as HTMLElement).closest<HTMLElement>('[data-sticker-id]')
  if (stickerElement) {
    selectSticker(stickerElement.dataset.stickerId!)
    return
  }

  const panelButton = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-panel-id]')
  if (panelButton) {
    selectPanel(panelButton.dataset.panelId!)
  }
})

elements.strip.addEventListener('pointerdown', (event) => {
  const stickerElement = (event.target as HTMLElement).closest<HTMLElement>('[data-sticker-id]')

  if (!stickerElement) {
    return
  }

  const mode = (event.target as HTMLElement).classList.contains('resize-handle') ? 'resize' : 'move'
  beginStickerDrag(event, stickerElement.dataset.stickerId!, mode)
})

elements.strip.addEventListener('pointermove', updateStickerDrag)
elements.strip.addEventListener('pointerup', endStickerDrag)
elements.strip.addEventListener('pointercancel', endStickerDrag)
elements.strip.addEventListener(
  'touchstart',
  (event) => {
    const stickerElement = (event.target as HTMLElement).closest<HTMLElement>('[data-sticker-id]')

    if (!stickerElement) {
      return
    }

    const mode = (event.target as HTMLElement).classList.contains('resize-handle') ? 'resize' : 'move'
    beginStickerTouch(event, stickerElement.dataset.stickerId!, mode)
  },
  { passive: false },
)
elements.strip.addEventListener('touchmove', updateStickerTouch, { passive: false })
elements.strip.addEventListener('touchend', endStickerDrag)
elements.strip.addEventListener('touchcancel', endStickerDrag)

elements.layoutList.addEventListener('click', (event) => {
  const layoutButton = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-layout-id]')
  if (layoutButton) {
    selectLayout(layoutButton.dataset.layoutId!)
  }
})

app.querySelector('.sticker-list')?.addEventListener('click', (event) => {
  const stickerButton = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-sticker-kind]')
  if (stickerButton) {
    addSticker(stickerButton.dataset.stickerKind as StickerKind)
  }
})

elements.captionInput.addEventListener('input', () => {
  state.settings.caption = elements.captionInput.value
  revokeExport()
  renderComic()
})

elements.fitSelect.addEventListener('change', () => {
  state.settings.fit = elements.fitSelect.value as PanelFit
  revokeExport()
  renderComic()
})

elements.backgroundInput.addEventListener('input', () => {
  state.settings.background = elements.backgroundInput.value
  revokeExport()
  renderComic()
})

elements.borderInput.addEventListener('input', () => {
  state.settings.borderColor = elements.borderInput.value
  revokeExport()
  renderComic()
})

elements.captionColorInput.addEventListener('input', () => {
  state.settings.captionColor = elements.captionColorInput.value
  revokeExport()
  renderComic()
})

elements.stickerTextInput.addEventListener('input', () => {
  const sticker = getActiveSticker()
  if (sticker) {
    sticker.text = elements.stickerTextInput.value
    revokeExport()
    renderComic()
  }
})

elements.stickerFillInput.addEventListener('input', () => {
  const sticker = getActiveSticker()
  if (sticker) {
    sticker.fill = elements.stickerFillInput.value
    revokeExport()
    renderComic()
  }
})

elements.stickerInkInput.addEventListener('input', () => {
  const sticker = getActiveSticker()
  if (sticker) {
    sticker.ink = elements.stickerInkInput.value
    revokeExport()
    renderComic()
  }
})

elements.stickerSizeInput.addEventListener('input', () => {
  const sticker = getActiveSticker()
  if (sticker) {
    sticker.fontSize = Number(elements.stickerSizeInput.value)
    setOutput(elements.stickerSizeInput, elements.stickerSizeInput.value)
    revokeExport()
    renderComic()
  }
})

elements.gutterInput.addEventListener('input', () => updateNumberSetting(elements.gutterInput, 'gutters'))
elements.radiusInput.addEventListener('input', () => updateNumberSetting(elements.radiusInput, 'radius'))
elements.borderWidthInput.addEventListener('input', () => updateNumberSetting(elements.borderWidthInput, 'border'))

elements.captionBandInput.addEventListener('change', () => {
  state.settings.captionBand = elements.captionBandInput.checked
  revokeExport()
  renderComic()
})

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault()
  deferredInstallPrompt = event as Event & { prompt: () => Promise<void> }
  elements.installButton.classList.remove('is-hidden')
})

elements.installButton.addEventListener('click', async () => {
  if (!deferredInstallPrompt) {
    return
  }

  await deferredInstallPrompt.prompt()
  deferredInstallPrompt = null
  elements.installButton.classList.add('is-hidden')
})

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js')
  })
}

renderComic()
