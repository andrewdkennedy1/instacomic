import { AnimatePresence, motion, useDragControls } from 'framer-motion'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent, TouchEvent } from 'react'
import { createRoot } from 'react-dom/client'
import './style.css'

type PanelFit = 'cover' | 'contain'
type StickerKind = 'speech' | 'thought' | 'burst' | 'caption' | 'arrow' | 'star'
type DrawerTab = 'layout' | 'create' | 'stickers' | 'style'
type CustomLinePreset = 'diagonal' | 'vertical' | 'horizontal'

type Panel = {
  id: string
  x: number
  y: number
  w: number
  h: number
  points?: Array<[number, number]>
}

type Layout = {
  id: string
  name: string
  panels: Panel[]
  custom?: boolean
}

type Shot = {
  dataUrl: string
  offsetX: number
  offsetY: number
  scale: number
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

type StickerTextMetrics = {
  fontSize: number
  lineHeight: number
  lines: string[]
}

type Settings = {
  gutters: number
  radius: number
  border: number
  background: string
  borderColor: string
  caption: string
  captionColor: string
  fit: PanelFit
}

type CustomLine = {
  id: string
  x1: number
  y1: number
  x2: number
  y2: number
}

type TouchPoints = {
  readonly length: number
  readonly [index: number]: {
    readonly clientX: number
    readonly clientY: number
  }
}

type DragState = {
  id: string
  mode: 'move' | 'resize' | 'pinch'
  startX: number
  startY: number
  stickerX: number
  stickerY: number
  stickerW: number
  stickerH: number
  stickerRotation: number
  rect: DOMRect
  startDistance?: number
  startAngle?: number
  centerX?: number
  centerY?: number
}

type PhotoDragState = {
  panelId: string
  mode: 'move' | 'pinch'
  startX: number
  startY: number
  offsetX: number
  offsetY: number
  scale: number
  rect: DOMRect
  startDistance?: number
}

type LineTouchState = {
  id: string
  line: CustomLine
  startCenterX: number
  startCenterY: number
  startDistance: number
  startAngle: number
  rect: DOMRect
}

function createShot(dataUrl: string): Shot {
  return {
    dataUrl,
    offsetX: 0,
    offsetY: 0,
    scale: 1,
  }
}

function normalizeShot(shot: Shot): Shot {
  const scale = clamp(shot.scale, 0.65, 4)
  return {
    ...shot,
    scale,
    offsetX: clamp(shot.offsetX, -0.65 * scale, 0.65 * scale),
    offsetY: clamp(shot.offsetY, -0.65 * scale, 0.65 * scale),
  }
}

const CREATOR_CANVAS_ASPECT = 1.45

const layouts: Layout[] = [
  {
    id: 'shard',
    name: 'Shard',
    panels: [
      { id: '1', x: 0, y: 0, w: 1, h: 1, points: [[0, 0], [100, 0], [43, 32], [0, 16]] },
      { id: '2', x: 0, y: 0, w: 1, h: 1, points: [[100, 0], [100, 50], [55, 39], [45, 33]] },
      { id: '3', x: 0, y: 0, w: 1, h: 1, points: [[0, 20], [40, 36], [24, 52], [0, 71]] },
      { id: '4', x: 0, y: 0, w: 1, h: 1, points: [[44, 37], [100, 55], [100, 100], [34, 58]] },
      { id: '5', x: 0, y: 0, w: 1, h: 1, points: [[0, 75], [27, 56], [92, 100], [0, 100]] },
    ],
  },
  {
    id: 'slash',
    name: 'Slash',
    panels: [
      { id: '1', x: 0, y: 0, w: 1, h: 1, points: [[0, 0], [31, 0], [65, 48], [0, 100]] },
      { id: '2', x: 0, y: 0, w: 1, h: 1, points: [[36, 0], [100, 0], [100, 23], [69, 45]] },
      { id: '3', x: 0, y: 0, w: 1, h: 1, points: [[70, 49], [100, 28], [100, 100], [43, 100]] },
    ],
  },
  {
    id: 'crystal',
    name: 'Crystal',
    panels: [
      { id: '1', x: 0, y: 0, w: 1, h: 1, points: [[0, 0], [100, 0], [60, 35], [0, 75]] },
      { id: '2', x: 0, y: 0, w: 1, h: 1, points: [[62, 37], [100, 2], [100, 52], [78, 70]] },
      { id: '3', x: 0, y: 0, w: 1, h: 1, points: [[0, 79], [60, 39], [76, 72], [44, 100], [0, 100]] },
      { id: '4', x: 0, y: 0, w: 1, h: 1, points: [[79, 74], [100, 56], [100, 100], [48, 100]] },
    ],
  },
  {
    id: 'story',
    name: 'Story',
    panels: [
      { id: '1', x: 0, y: 0, w: 1, h: 0.56 },
      { id: '2', x: 0, y: 0.56, w: 0.5, h: 0.44 },
      { id: '3', x: 0.5, y: 0.56, w: 0.5, h: 0.44 },
    ],
  },
  {
    id: 'three',
    name: '3 Strip',
    panels: [
      { id: '1', x: 0, y: 0, w: 1, h: 1 / 3 },
      { id: '2', x: 0, y: 1 / 3, w: 1, h: 1 / 3 },
      { id: '3', x: 0, y: 2 / 3, w: 1, h: 1 / 3 },
    ],
  },
  {
    id: 'four',
    name: 'Grid',
    panels: [
      { id: '1', x: 0, y: 0, w: 0.5, h: 0.5 },
      { id: '2', x: 0.5, y: 0, w: 0.5, h: 0.5 },
      { id: '3', x: 0, y: 0.5, w: 0.5, h: 0.5 },
      { id: '4', x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
    ],
  },
  {
    id: 'punch',
    name: 'Punch',
    panels: [
      { id: '1', x: 0, y: 0, w: 0.5, h: 0.43 },
      { id: '2', x: 0.5, y: 0, w: 0.5, h: 0.43 },
      { id: '3', x: 0, y: 0.43, w: 1, h: 0.57 },
    ],
  },
  {
    id: 'manga',
    name: 'Manga',
    panels: [
      { id: '1', x: 0, y: 0, w: 0.58, h: 1 },
      { id: '2', x: 0.58, y: 0, w: 0.42, h: 1 / 3 },
      { id: '3', x: 0.58, y: 1 / 3, w: 0.42, h: 1 / 3 },
      { id: '4', x: 0.58, y: 2 / 3, w: 0.42, h: 1 / 3 },
    ],
  },
]

const stickerDefaults: Record<StickerKind, Omit<Sticker, 'id' | 'kind' | 'x' | 'y'>> = {
  speech: { w: 0.36, h: 0.12, rotation: -2, text: 'say it', fill: '#ffffff', ink: '#111111', fontSize: 22 },
  thought: { w: 0.32, h: 0.12, rotation: 2, text: 'hmm', fill: '#ffffff', ink: '#111111', fontSize: 22 },
  burst: { w: 0.32, h: 0.14, rotation: -5, text: 'WOW', fill: '#ffd84d', ink: '#111111', fontSize: 25 },
  caption: { w: 0.44, h: 0.1, rotation: 0, text: 'meanwhile', fill: '#fff0a8', ink: '#111111', fontSize: 19 },
  arrow: { w: 0.28, h: 0.1, rotation: -9, text: 'look', fill: '#ff6b55', ink: '#111111', fontSize: 18 },
  star: { w: 0.25, h: 0.12, rotation: 8, text: 'snap', fill: '#48d3c5', ink: '#111111', fontSize: 19 },
}

const defaultSettings: Settings = {
  gutters: 4,
  radius: 0,
  border: 0,
  background: '#ffffff',
  borderColor: '#ffffff',
  caption: '',
  captionColor: '#111111',
  fit: 'cover',
}

const CUSTOM_LAYOUT_KEY = 'instacomic.customLayouts.v1'

type FullscreenHost = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void
  webkitRequestFullScreen?: () => Promise<void> | void
  msRequestFullscreen?: () => Promise<void> | void
}

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null
  webkitFullScreenElement?: Element | null
  msFullscreenElement?: Element | null
}

function App() {
  const [started, setStarted] = useState(false)
  const [layout, setLayout] = useState(layouts[0])
  const [activePanelId, setActivePanelId] = useState<string | null>(layouts[0].panels[0].id)
  const [shots, setShots] = useState<Record<string, Shot>>({})
  const [stickers, setStickers] = useState<Sticker[]>([])
  const [activeStickerId, setActiveStickerId] = useState<string | null>(null)
  const [editingStickerId, setEditingStickerId] = useState<string | null>(null)
  const [settings, setSettings] = useState(defaultSettings)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [facing, setFacing] = useState<'environment' | 'user'>('environment')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('stickers')
  const [status, setStatus] = useState('Tap a panel. Shoot. Repeat.')
  const [exportUrl, setExportUrl] = useState<string | null>(null)
  const [dragState, setDragState] = useState<DragState | null>(null)
  const [photoDragState, setPhotoDragState] = useState<PhotoDragState | null>(null)
  const [customLayouts, setCustomLayouts] = useState<Layout[]>([])
  const [draftLines, setDraftLines] = useState<CustomLine[]>(() => createDefaultDraftLines())
  const [draftName, setDraftName] = useState('')
  const shellRef = useRef<HTMLElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const trashRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const lastDragPointRef = useRef<{ x: number; y: number } | null>(null)
  const dragStateRef = useRef<DragState | null>(null)
  const startRequestedRef = useRef(false)
  const dragControls = useDragControls()
  const [trashArmed, setTrashArmed] = useState(false)

  const activeSticker = useMemo(
    () => stickers.find((sticker) => sticker.id === activeStickerId) ?? null,
    [activeStickerId, stickers],
  )
  const allLayouts = useMemo(() => [...layouts, ...customLayouts], [customLayouts])
  const activePanelIndex = activePanelId ? layout.panels.findIndex((panel) => panel.id === activePanelId) : -1
  const capturedCount = layout.panels.filter((panel) => shots[panel.id]).length

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        void navigator.serviceWorker.register('/sw.js')
      })
    }

    try {
      const stored = localStorage.getItem(CUSTOM_LAYOUT_KEY)
      if (stored) {
        const parsed = JSON.parse(stored) as Layout[]
        setCustomLayouts(parsed.filter((item) => Array.isArray(item.panels) && item.panels.length > 0))
      }
    } catch {
      localStorage.removeItem(CUSTOM_LAYOUT_KEY)
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(CUSTOM_LAYOUT_KEY, JSON.stringify(customLayouts))
  }, [customLayouts])

  useEffect(() => {
    const video = videoRef.current
    if (video && stream) {
      video.srcObject = stream
      void video.play()
    }
  }, [stream])

  useEffect(() => {
    return () => {
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [stream])

  useEffect(() => {
    return () => {
      if (exportUrl) {
        URL.revokeObjectURL(exportUrl)
      }
    }
  }, [exportUrl])

  function clearExport() {
    if (exportUrl) {
      URL.revokeObjectURL(exportUrl)
      setExportUrl(null)
    }
  }

  function setActiveDragState(next: DragState | null) {
    dragStateRef.current = next
    setDragState(next)
  }

  async function requestAppFullscreen() {
    const fullscreenDocument = document as FullscreenDocument
    const existingFullscreenElement =
      document.fullscreenElement ??
      fullscreenDocument.webkitFullscreenElement ??
      fullscreenDocument.webkitFullScreenElement ??
      fullscreenDocument.msFullscreenElement

    if (existingFullscreenElement) {
      return
    }

    try {
      const element = (shellRef.current ?? document.documentElement) as FullscreenHost

      if (element.requestFullscreen) {
        await element.requestFullscreen({ navigationUI: 'hide' })
      } else if (element.webkitRequestFullscreen) {
        await element.webkitRequestFullscreen()
      } else if (element.webkitRequestFullScreen) {
        await element.webkitRequestFullScreen()
      } else if (element.msRequestFullscreen) {
        await element.msRequestFullscreen()
      } else {
        return
      }
    } catch {
      // Fullscreen can be blocked by browser policy; the app still starts.
    }
  }

  async function enterApp() {
    await requestAppFullscreen()

    setStarted(true)
  }

  function startFromGesture() {
    if (startRequestedRef.current) {
      return
    }

    startRequestedRef.current = true
    void enterApp()
  }

  useEffect(() => {
    if (!dragState) {
      return
    }

    const finish = () => finishStickerDrag()
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    window.addEventListener('touchend', finish)
    window.addEventListener('touchcancel', finish)
    return () => {
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      window.removeEventListener('touchend', finish)
      window.removeEventListener('touchcancel', finish)
    }
  }, [dragState])

  async function startCamera(nextFacing = facing) {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('Camera is not available in this browser.')
      return
    }

    stream?.getTracks().forEach((track) => track.stop())

    try {
      const nextStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: nextFacing },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      })
      setStream(nextStream)
      setStatus(activePanelIndex >= 0 ? `Live in panel ${activePanelIndex + 1}.` : 'Camera ready. Tap a panel to retake it.')
    } catch (error) {
      setStream(null)
      setStatus(error instanceof Error ? `Camera blocked: ${error.message}` : 'Camera blocked.')
    }
  }

  async function flipCamera() {
    const nextFacing = facing === 'environment' ? 'user' : 'environment'
    setFacing(nextFacing)
    await startCamera(nextFacing)
  }

  function selectPanel(panelId: string) {
    setActivePanelId(panelId)
    setActiveStickerId(null)
    setEditingStickerId(null)
    if (shots[panelId]) {
      setStatus(`Panel ${layout.panels.findIndex((panel) => panel.id === panelId) + 1} photo selected. Drag or pinch to adjust.`)
      return
    }

    setStatus(`Panel ${layout.panels.findIndex((panel) => panel.id === panelId) + 1} is live.`)
    if (!stream) {
      void startCamera()
    }
  }

  function panelFromPoint(clientX: number, clientY: number) {
    const rect = stripRef.current?.getBoundingClientRect()

    if (!rect) {
      return null
    }

    const x = clamp((clientX - rect.left) / rect.width, 0, 1)
    const y = clamp((clientY - rect.top) / rect.height, 0, 1)
    return [...layout.panels].reverse().find((item) => pointInPanel(item, x, y)) ?? null
  }

  function selectPanelFromPoint(clientX: number, clientY: number) {
    const panel = panelFromPoint(clientX, clientY)

    if (panel) {
      selectPanel(panel.id)
    }
  }

  function capturePanel() {
    const video = videoRef.current
    if (!activePanelId) {
      setStatus('Tap a panel to retake it, or share the comic.')
      return
    }

    if (!stream || !video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      void startCamera()
      setStatus('Starting camera...')
      return
    }

    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth || 1280
    canvas.height = video.videoHeight || 720
    const context = canvas.getContext('2d')
    if (!context) {
      setStatus('Canvas is unavailable.')
      return
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    setShots((current) => ({
      ...current,
      [activePanelId]: createShot(canvas.toDataURL('image/jpeg', 0.92)),
    }))

    const currentIndex = layout.panels.findIndex((panel) => panel.id === activePanelId)
    const nextPanel = layout.panels.slice(currentIndex + 1).find((panel) => !shots[panel.id])
    if (nextPanel) {
      setActivePanelId(nextPanel.id)
      setStatus(`Saved panel ${currentIndex + 1}. Panel ${layout.panels.findIndex((panel) => panel.id === nextPanel.id) + 1} is live.`)
    } else {
      setActivePanelId(null)
      setStatus(`Saved panel ${currentIndex + 1}. Tap another panel to retake it, or share.`)
    }
    clearExport()
  }

  async function uploadPhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) {
      return
    }

    if (!file.type.startsWith('image/')) {
      setStatus('Choose an image file.')
      return
    }

    const targetPanelId = activePanelId ?? layout.panels.find((panel) => !shots[panel.id])?.id
    if (!targetPanelId) {
      setStatus('Tap a panel before replacing a finished photo.')
      return
    }

    const dataUrl = await readFileAsDataUrl(file)
    setShots((current) => ({
      ...current,
      [targetPanelId]: createShot(dataUrl),
    }))

    const currentIndex = layout.panels.findIndex((panel) => panel.id === targetPanelId)
    const nextPanel = layout.panels.slice(currentIndex + 1).find((panel) => !shots[panel.id])
    if (nextPanel) {
      setActivePanelId(nextPanel.id)
      setStatus(`Photo added to panel ${currentIndex + 1}. Panel ${layout.panels.findIndex((panel) => panel.id === nextPanel.id) + 1} is live.`)
    } else {
      setActivePanelId(null)
      setStatus(`Photo added to panel ${currentIndex + 1}. Tap another panel to replace it, or share.`)
    }
    clearExport()
  }

  function changeLayout(nextLayout: Layout) {
    const allowed = new Set(nextLayout.panels.map((panel) => panel.id))
    setLayout(nextLayout)
    setActivePanelId(nextLayout.panels[0].id)
    setShots((current) => Object.fromEntries(Object.entries(current).filter(([panelId]) => allowed.has(panelId))))
    setStatus(`${nextLayout.name} layout. Panel 1 is live.`)
    clearExport()
  }

  function addSticker(kind: StickerKind) {
    const panel = layout.panels.find((item) => item.id === activePanelId) ?? layout.panels[0]
    const bounds = panelBounds(panel)
    const defaults = stickerDefaults[kind]
    const sticker: Sticker = {
      id: crypto.randomUUID(),
      kind,
      x: clamp(bounds.x + bounds.w / 2 - defaults.w / 2, 0.02, 0.98 - defaults.w),
      y: clamp(bounds.y + bounds.h / 2 - defaults.h / 2, 0.02, 0.98 - defaults.h),
      ...defaults,
    }
    setStickers((current) => [...current, sticker])
    setActiveStickerId(sticker.id)
    setDrawerTab('stickers')
    setDrawerOpen(false)
    setStatus('Sticker added. Drag it, or open Controls to edit text.')
    clearExport()
  }

  function updateSticker(update: Partial<Sticker>) {
    if (!activeStickerId) {
      return
    }

    updateStickerById(activeStickerId, update)
  }

  function updateStickerById(stickerId: string, update: Partial<Sticker>) {
    setStickers((current) =>
      current.map((sticker) => (sticker.id === stickerId ? { ...sticker, ...update } : sticker)),
    )
    clearExport()
  }

  function deleteSticker() {
    if (!activeStickerId) {
      return
    }

    removeSticker(activeStickerId)
  }

  function removeSticker(stickerId: string) {
    setStickers((current) => current.filter((sticker) => sticker.id !== stickerId))
    setEditingStickerId((current) => (current === stickerId ? null : current))
    setActiveStickerId((current) => (current === stickerId ? null : current))
    if (dragStateRef.current?.id === stickerId) {
      setActiveDragState(null)
    }
    setTrashArmed(false)
    lastDragPointRef.current = null
    clearExport()
  }

  function addDraftLine(preset: CustomLinePreset) {
    setDraftLines((current) => [...current, createDraftLine(preset, current.length)])
  }

  function updateDraftLine(lineId: string, update: Partial<CustomLine>) {
    setDraftLines((current) =>
      current.map((line) => (line.id === lineId ? clampCustomLine({ ...line, ...update }) : line)),
    )
  }

  function resetDraftLayout() {
    setDraftLines(createDefaultDraftLines())
    setStatus('Creator reset.')
  }

  function saveDraftLayout() {
    const panels = panelsFromLines(draftLines)

    if (panels.length === 0) {
      setStatus('Move a ray before saving.')
      return
    }

    const customLayout: Layout = {
      id: `custom-${Date.now()}`,
      name: draftName.trim() || `Custom ${customLayouts.length + 1}`,
      custom: true,
      panels,
    }
    setCustomLayouts((current) => [...current, customLayout])
    changeLayout(customLayout)
    setDraftName('')
    setDraftLines(createDefaultDraftLines())
    setDrawerTab('layout')
    setStatus('Custom layout saved on this phone.')
  }

  function beginStickerDrag(event: PointerEvent<HTMLElement> | TouchEvent<HTMLElement>, sticker: Sticker, mode: 'move' | 'resize') {
    const rect = stripRef.current?.getBoundingClientRect()
    const point = 'touches' in event ? event.touches[0] : event
    if (!rect || !point) {
      return
    }

    event.preventDefault()
    setActiveStickerId(sticker.id)
    setActiveDragState({
      id: sticker.id,
      mode,
      startX: point.clientX,
      startY: point.clientY,
      stickerX: sticker.x,
      stickerY: sticker.y,
      stickerW: sticker.w,
      stickerH: sticker.h,
      stickerRotation: sticker.rotation,
      rect,
    })
    if (mode === 'move') {
      lastDragPointRef.current = { x: point.clientX, y: point.clientY }
      setTrashArmed(pointInTrash(point.clientX, point.clientY))
    }
  }

  function beginStickerPinch(event: TouchEvent<HTMLElement>, sticker: Sticker) {
    const rect = stripRef.current?.getBoundingClientRect()
    if (!rect || event.touches.length < 2) {
      return
    }

    event.preventDefault()
    setActiveStickerId(sticker.id)
    setEditingStickerId(null)
    setActiveDragState({
      id: sticker.id,
      mode: 'pinch',
      startX: 0,
      startY: 0,
      stickerX: sticker.x,
      stickerY: sticker.y,
      stickerW: sticker.w,
      stickerH: sticker.h,
      stickerRotation: sticker.rotation,
      rect,
      startDistance: touchDistance(event.touches),
      startAngle: touchAngle(event.touches),
      centerX: sticker.x + sticker.w / 2,
      centerY: sticker.y + sticker.h / 2,
    })
  }

  function moveSticker(clientX: number, clientY: number) {
    const activeDrag = dragStateRef.current
    if (!activeDrag || activeDrag.mode === 'pinch') {
      return
    }

    const dx = (clientX - activeDrag.startX) / activeDrag.rect.width
    const dy = (clientY - activeDrag.startY) / activeDrag.rect.height
    lastDragPointRef.current = { x: clientX, y: clientY }
    if (activeDrag.mode === 'move') {
      const overTrash = pointInTrash(clientX, clientY)
      setTrashArmed(overTrash)
      if (overTrash) {
        removeSticker(activeDrag.id)
        return
      }
    }
    setStickers((current) =>
      current.map((sticker) => {
        if (sticker.id !== activeDrag.id) {
          return sticker
        }
        if (activeDrag.mode === 'resize') {
          const w = clamp(activeDrag.stickerW + dx, 0.14, 0.85)
          const h = clamp(activeDrag.stickerH + dy, 0.07, 0.5)
          return {
            ...sticker,
            w,
            h,
            x: clamp(sticker.x, 0, 1 - w),
            y: clamp(sticker.y, 0, 1 - h),
          }
        }
        return {
          ...sticker,
          x: clamp(activeDrag.stickerX + dx, 0, 1 - sticker.w),
          y: clamp(activeDrag.stickerY + dy, 0, 1 - sticker.h),
        }
      }),
    )
    clearExport()
  }

  function moveStickerPinch(touches: TouchPoints) {
    const activeDrag = dragStateRef.current
    if (!activeDrag || activeDrag.mode !== 'pinch' || touches.length < 2 || !activeDrag.startDistance) {
      return
    }

    const scale = clamp(touchDistance(touches) / activeDrag.startDistance, 0.45, 2.4)
    const rotation = activeDrag.stickerRotation + angleDelta(activeDrag.startAngle ?? touchAngle(touches), touchAngle(touches))
    const centerX = activeDrag.centerX ?? activeDrag.stickerX + activeDrag.stickerW / 2
    const centerY = activeDrag.centerY ?? activeDrag.stickerY + activeDrag.stickerH / 2

    setStickers((current) =>
      current.map((sticker) => {
        if (sticker.id !== activeDrag.id) {
          return sticker
        }

        const w = clamp(activeDrag.stickerW * scale, 0.14, 0.85)
        const h = clamp(activeDrag.stickerH * scale, 0.07, 0.5)
        return {
          ...sticker,
          w,
          h,
          rotation,
          x: clamp(centerX - w / 2, 0, 1 - w),
          y: clamp(centerY - h / 2, 0, 1 - h),
        }
      }),
    )
    clearExport()
  }

  function beginPhotoMove(event: PointerEvent<HTMLElement>) {
    const rect = stripRef.current?.getBoundingClientRect()
    const panel = panelFromPoint(event.clientX, event.clientY)
    const shot = panel ? shots[panel.id] : null
    if (!rect || !panel || !shot) {
      selectPanelFromPoint(event.clientX, event.clientY)
      return
    }

    event.preventDefault()
    setActivePanelId(panel.id)
    setActiveStickerId(null)
    setEditingStickerId(null)
    setPhotoDragState({
      panelId: panel.id,
      mode: 'move',
      startX: event.clientX,
      startY: event.clientY,
      offsetX: shot.offsetX,
      offsetY: shot.offsetY,
      scale: shot.scale,
      rect,
    })
    setStatus(`Panel ${layout.panels.findIndex((item) => item.id === panel.id) + 1} photo selected. Drag or pinch to adjust.`)
  }

  function beginPhotoPinch(event: TouchEvent<HTMLElement>) {
    if (event.touches.length < 2) {
      return
    }

    const firstPanel = panelFromPoint(event.touches[0].clientX, event.touches[0].clientY)
    const secondPanel = panelFromPoint(event.touches[1].clientX, event.touches[1].clientY)
    const rect = stripRef.current?.getBoundingClientRect()
    if (!rect || !firstPanel || !secondPanel || firstPanel.id !== secondPanel.id || !shots[firstPanel.id]) {
      return
    }

    event.preventDefault()
    const shot = shots[firstPanel.id]
    setActivePanelId(firstPanel.id)
    setActiveStickerId(null)
    setEditingStickerId(null)
    setPhotoDragState({
      panelId: firstPanel.id,
      mode: 'pinch',
      startX: 0,
      startY: 0,
      offsetX: shot.offsetX,
      offsetY: shot.offsetY,
      scale: shot.scale,
      rect,
      startDistance: touchDistance(event.touches),
    })
  }

  function movePhoto(clientX: number, clientY: number) {
    if (!photoDragState || photoDragState.mode !== 'move') {
      return
    }

    const dx = (clientX - photoDragState.startX) / photoDragState.rect.width
    const dy = (clientY - photoDragState.startY) / photoDragState.rect.height
    updateShotTransform(photoDragState.panelId, {
      offsetX: photoDragState.offsetX + dx,
      offsetY: photoDragState.offsetY + dy,
    })
  }

  function movePhotoPinch(touches: TouchPoints) {
    if (!photoDragState || photoDragState.mode !== 'pinch' || touches.length < 2 || !photoDragState.startDistance) {
      return
    }

    const scale = photoDragState.scale * clamp(touchDistance(touches) / photoDragState.startDistance, 0.35, 3)
    updateShotTransform(photoDragState.panelId, { scale })
  }

  function updateShotTransform(panelId: string, update: Partial<Pick<Shot, 'offsetX' | 'offsetY' | 'scale'>>) {
    setShots((current) => {
      const shot = current[panelId]
      if (!shot) {
        return current
      }

      return {
        ...current,
        [panelId]: normalizeShot({ ...shot, ...update }),
      }
    })
    clearExport()
  }

  function pointInTrash(clientX: number, clientY: number) {
    const rect = trashRef.current?.getBoundingClientRect()
    return !!rect && clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
  }

  function finishStickerDrag(clientX?: number, clientY?: number) {
    const activeDrag = dragStateRef.current
    if (activeDrag?.mode === 'move') {
      const point = clientX === undefined || clientY === undefined ? lastDragPointRef.current : { x: clientX, y: clientY }
      if (point && pointInTrash(point.x, point.y)) {
        removeSticker(activeDrag.id)
        return
      }
    }

    setActiveDragState(null)
    setTrashArmed(false)
    lastDragPointRef.current = null
  }

  function finishGestures(clientX?: number, clientY?: number) {
    finishStickerDrag(clientX, clientY)
    setPhotoDragState(null)
  }

  function openDrawer(tab?: DrawerTab) {
    setDrawerTab(tab ?? (activeStickerId ? 'stickers' : drawerTab))
    setDrawerOpen(true)
  }

  async function renderComicBlob() {
    setStatus('Rendering...')
    const blob = await renderToPng(layout, shots, stickers, settings)
    clearExport()
    const url = URL.createObjectURL(blob)
    setExportUrl(url)
    return { blob, url }
  }

  async function shareComic() {
    try {
      const blob = exportUrl ? await fetch(exportUrl).then((response) => response.blob()) : (await renderComicBlob()).blob
      const file = new File([blob], 'instacomic.png', { type: 'image/png' })
      if ('canShare' in navigator && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Instacomic' })
        setStatus('Shared.')
      } else {
        const fallbackUrl = exportUrl ?? URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = fallbackUrl
        link.download = 'instacomic.png'
        document.body.append(link)
        link.click()
        link.remove()
        setStatus('Sharing is unavailable here, so the PNG downloaded.')
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Share failed.')
    }
  }

  return (
    <main
      ref={shellRef}
      className="native-shell"
      onPointerMove={(event) => {
        moveSticker(event.clientX, event.clientY)
        movePhoto(event.clientX, event.clientY)
      }}
      onPointerUp={(event) => finishGestures(event.clientX, event.clientY)}
      onPointerCancel={() => finishGestures()}
      onTouchMove={(event) => {
        if (dragStateRef.current?.mode === 'pinch') {
          moveStickerPinch(event.touches)
        } else if (photoDragState?.mode === 'pinch') {
          movePhotoPinch(event.touches)
        } else if (event.touches[0]) {
          moveSticker(event.touches[0].clientX, event.touches[0].clientY)
          movePhoto(event.touches[0].clientX, event.touches[0].clientY)
        }
      }}
      onTouchEnd={() => finishGestures()}
      onTouchCancel={() => finishGestures()}
    >
      {!started && (
        <section className="start-screen" aria-label="Start Instacomic">
          <div className="start-mark">Instacomic</div>
          <button
            type="button"
            onPointerDown={(event) => {
              if (event.isPrimary && event.button === 0) {
                startFromGesture()
              }
            }}
            onClick={() => startFromGesture()}
          >
            Start
          </button>
        </section>
      )}
      <video ref={videoRef} className="live-camera" autoPlay muted playsInline />
      <input ref={fileInputRef} className="photo-upload" type="file" accept="image/*" onChange={(event) => void uploadPhoto(event)} />
      <div className="sr-status" aria-live="polite">
        {status}
      </div>

      <section ref={stageRef} className="comic-stage" aria-label="Instacomic capture surface">
        <div
          ref={stripRef}
          className={`live-strip layout-${layout.id} ${layout.panels.some((panel) => panel.points) ? 'is-manga' : ''}`}
          onPointerDown={(event) => {
            if ((event.target as HTMLElement).closest('[data-sticker-id]')) {
              return
            }
            beginPhotoMove(event)
          }}
          onTouchStart={(event) => {
            if (event.touches.length > 1) {
              beginPhotoPinch(event)
            }
          }}
          style={
            {
              '--paper': settings.background,
              '--ink': settings.borderColor,
              '--gutter': `${settings.gutters}px`,
              '--radius': `${settings.radius}px`,
              '--border': `${settings.border}px`,
            } as React.CSSProperties
          }
        >
          {layout.panels.map((panel, index) => (
            <button
              key={panel.id}
              className={`live-panel ${panel.id === activePanelId ? 'is-live' : ''} ${shots[panel.id] ? 'is-shot' : ''}`}
              style={panelStyle(panel)}
              type="button"
              data-panel-id={panel.id}
              onClick={() => selectPanel(panel.id)}
              aria-label={`Make panel ${index + 1} live`}
            >
              {shots[panel.id] && (
                <img
                  src={shots[panel.id].dataUrl}
                  alt={`Panel ${index + 1}`}
                  style={shotImageStyle(shots[panel.id])}
                  data-shot-scale={shots[panel.id].scale.toFixed(2)}
                  data-shot-x={shots[panel.id].offsetX.toFixed(2)}
                  data-shot-y={shots[panel.id].offsetY.toFixed(2)}
                />
              )}
              {panel.id === activePanelId && stream && !shots[panel.id] && <LiveVideo stream={stream} />}
              {panel.id === activePanelId && !shots[panel.id] && <span className="panel-chip">LIVE</span>}
            </button>
          ))}

          {stickers.map((sticker) => (
            <StickerView
              key={sticker.id}
              sticker={sticker}
              active={sticker.id === activeStickerId}
              editing={sticker.id === editingStickerId}
              onSelect={() => setActiveStickerId(sticker.id)}
              onEditStart={() => {
                setActiveStickerId(sticker.id)
                setEditingStickerId(sticker.id)
              }}
              onEditEnd={() => setEditingStickerId((current) => (current === sticker.id ? null : current))}
              onText={(text) => updateStickerById(sticker.id, { text })}
              onDelete={() => removeSticker(sticker.id)}
              onDragStart={(event, mode) => beginStickerDrag(event, sticker, mode)}
              onPinchStart={(event) => beginStickerPinch(event, sticker)}
            />
          ))}

          {settings.caption.trim() && <div className="strip-caption">{settings.caption}</div>}
        </div>
      </section>

      <div
        ref={trashRef}
        className={`sticker-trash ${dragState?.mode === 'move' ? 'is-visible' : ''} ${trashArmed ? 'is-armed' : ''}`}
        aria-hidden={dragState?.mode !== 'move'}
      >
        <span>⌫</span>
      </div>

      <nav className="capture-bar" aria-label="Capture controls">
        <button className="round-action" type="button" onClick={() => void flipCamera()} aria-label="Flip camera">
          ↺
        </button>
        <button className="round-action" type="button" onClick={() => fileInputRef.current?.click()} aria-label="Upload photo">
          ▧
        </button>
        <button className="shutter" type="button" onClick={capturePanel} aria-label="Capture active panel">
          <span />
        </button>
        <button className="round-action" type="button" onClick={() => openDrawer()} aria-label="Open drawer">
          ⋯
        </button>
      </nav>

      <div className="progress-pills" aria-label={`${capturedCount} of ${layout.panels.length} panels captured`}>
        {layout.panels.map((panel) => (
          <span key={panel.id} className={shots[panel.id] ? 'done' : panel.id === activePanelId ? 'live' : ''} />
        ))}
      </div>

      <Drawer
        open={drawerOpen}
        tab={drawerTab}
        dragControls={dragControls}
        onOpen={() => setDrawerOpen(true)}
        onClose={() => setDrawerOpen(false)}
        onTab={setDrawerTab}
      >
        {drawerTab === 'layout' && (
          <LayoutPanel layout={layout} layouts={allLayouts} onLayout={changeLayout} onCreate={() => setDrawerTab('create')} />
        )}
        {drawerTab === 'create' && (
          <CreatorPanel
            draftName={draftName}
            draftLines={draftLines}
            onName={setDraftName}
            onAddLine={addDraftLine}
            onMoveLine={updateDraftLine}
            onReset={resetDraftLayout}
            onSave={saveDraftLayout}
          />
        )}
        {drawerTab === 'stickers' && (
          <StickerPanel
            activeSticker={activeSticker}
            onAdd={addSticker}
            onUpdate={updateSticker}
            onDelete={deleteSticker}
          />
        )}
        {drawerTab === 'style' && (
          <StylePanel
            settings={settings}
            onSettings={(next) => {
              setSettings((current) => ({ ...current, ...next }))
              clearExport()
            }}
            onShare={() => void shareComic()}
          />
        )}
      </Drawer>
    </main>
  )
}

function LiveVideo({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (ref.current) {
      ref.current.srcObject = stream
      void ref.current.play()
    }
  }, [stream])

  return <video ref={ref} className="live-frame" autoPlay muted playsInline aria-hidden="true" />
}

function Drawer({
  open,
  tab,
  dragControls,
  children,
  onOpen,
  onClose,
  onTab,
}: {
  open: boolean
  tab: DrawerTab
  dragControls: ReturnType<typeof useDragControls>
  children: React.ReactNode
  onOpen: () => void
  onClose: () => void
  onTab: (tab: DrawerTab) => void
}) {
  return (
    <motion.aside
      className={`motion-drawer motion-drawer-${tab} ${open ? 'is-open' : ''}`}
      aria-hidden={!open}
      drag="y"
      dragControls={dragControls}
      dragListener={false}
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={0.08}
      animate={{ y: open ? 0 : '112%' }}
      transition={{ type: 'spring', stiffness: 430, damping: 38 }}
      onDragEnd={(_, info) => {
        if (info.offset.y > 50 || info.velocity.y > 400) {
          onClose()
        } else {
          onOpen()
        }
      }}
    >
      <button
        className="drawer-grabber"
        type="button"
        onPointerDown={(event) => dragControls.start(event)}
        onClick={() => (open ? onClose() : onOpen())}
        aria-label={open ? 'Close controls' : 'Open controls'}
      >
        <span />
        <strong>Controls</strong>
      </button>
      <div className="drawer-tabs" role="tablist">
        <button className={tab === 'stickers' ? 'active' : ''} type="button" onClick={() => onTab('stickers')}>
          Stickers
        </button>
        <button className={tab === 'layout' ? 'active' : ''} type="button" onClick={() => onTab('layout')}>
          Layout
        </button>
        <button className={tab === 'create' ? 'active' : ''} type="button" onClick={() => onTab('create')}>
          Create
        </button>
        <button className={tab === 'style' ? 'active' : ''} type="button" onClick={() => onTab('style')}>
          Save
        </button>
      </div>
      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          className="drawer-content"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.16 }}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </motion.aside>
  )
}

function LayoutPanel({
  layout,
  layouts,
  onLayout,
  onCreate,
}: {
  layout: Layout
  layouts: Layout[]
  onLayout: (layout: Layout) => void
  onCreate: () => void
}) {
  return (
    <div className="drawer-grid">
      {layouts.map((option) => (
        <button
          key={option.id}
          className={`layout-card ${layout.id === option.id ? 'active' : ''}`}
          type="button"
          onClick={() => onLayout(option)}
        >
          <span className="layout-mini">
            {option.panels.map((panel) => (
              <i key={panel.id} style={panelStyle(panel)} />
            ))}
          </span>
          <strong>{option.name}</strong>
          {option.custom && <em>saved</em>}
        </button>
      ))}
      <button className="layout-card create-card" type="button" onClick={onCreate}>
        <span className="layout-mini creator-mini">
          <i />
          <i />
          <i />
        </span>
        <strong>Create your own</strong>
        <em>saved on this phone</em>
      </button>
    </div>
  )
}

function CreatorPanel({
  draftName,
  draftLines,
  onName,
  onAddLine,
  onMoveLine,
  onReset,
  onSave,
}: {
  draftName: string
  draftLines: CustomLine[]
  onName: (name: string) => void
  onAddLine: (preset: CustomLinePreset) => void
  onMoveLine: (lineId: string, update: Partial<CustomLine>) => void
  onReset: () => void
  onSave: () => void
}) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const [lineDrag, setLineDrag] = useState<{
    id: string
    mode: 'line' | 'start' | 'end'
    startX: number
    startY: number
    line: CustomLine
  } | null>(null)
  const [lineTouch, setLineTouch] = useState<LineTouchState | null>(null)
  const lineTouchRef = useRef<LineTouchState | null>(null)
  const linePointersRef = useRef<Map<number, { clientX: number; clientY: number }>>(new Map())
  const previewPanels = useMemo(() => panelsFromLines(draftLines), [draftLines])

  function beginLineDrag(event: PointerEvent<HTMLElement>, line: CustomLine, mode: 'line' | 'start' | 'end') {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setLineDrag({
      id: line.id,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      line,
    })
  }

  function beginLinePointer(event: PointerEvent<HTMLElement>, line: CustomLine, mode: 'line' | 'start' | 'end') {
    if (event.pointerType !== 'touch') {
      beginLineDrag(event, line, mode)
      return
    }

    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    linePointersRef.current.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY })

    const rect = canvasRef.current?.getBoundingClientRect()
    const touches = linePointerTouches()
    if (rect && touches) {
      setLineDrag(null)
      startLineTouch(line, touches, rect)
      return
    }

    setLineDrag({
      id: line.id,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      line,
    })
  }

  function moveLineFromPointer(event: PointerEvent<HTMLElement>) {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect || !lineDrag) {
      return
    }

    const dx = ((event.clientX - lineDrag.startX) / rect.width) * 100
    const dy = ((event.clientY - lineDrag.startY) / rect.height) * 100

    if (lineDrag.mode === 'line') {
      onMoveLine(lineDrag.id, {
        x1: lineDrag.line.x1 + dx,
        y1: lineDrag.line.y1 + dy,
        x2: lineDrag.line.x2 + dx,
        y2: lineDrag.line.y2 + dy,
      })
      return
    }

    if (lineDrag.mode === 'start') {
      onMoveLine(lineDrag.id, {
        x1: lineDrag.line.x1 + dx,
        y1: lineDrag.line.y1 + dy,
      })
      return
    }

    onMoveLine(lineDrag.id, {
      x2: lineDrag.line.x2 + dx,
      y2: lineDrag.line.y2 + dy,
    })
  }

  function moveLinePointer(event: PointerEvent<HTMLElement>) {
    if (event.pointerType === 'touch') {
      linePointersRef.current.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY })
      const touches = linePointerTouches()
      if (touches && lineTouchRef.current) {
        updateLineTouch(touches)
        return
      }
    }

    moveLineFromPointer(event)
  }

  function endLineDrag(event: PointerEvent<HTMLElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setLineDrag(null)
  }

  function endLinePointer(event: PointerEvent<HTMLElement>) {
    if (event.pointerType !== 'touch') {
      endLineDrag(event)
      return
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    linePointersRef.current.delete(event.pointerId)
    if (linePointersRef.current.size < 2) {
      clearLineTouch()
    }
    if (linePointersRef.current.size === 0) {
      setLineDrag(null)
    }
  }

  function beginLineTouch(event: TouchEvent<HTMLElement>) {
    if (event.touches.length < 2 || draftLines.length === 0) {
      return
    }

    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) {
      return
    }

    const center = touchCenterPercent(event.touches, rect)
    const line = nearestLineToPoint(draftLines, center.x, center.y)
    if (!line) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    startLineTouch(line, event.touches, rect)
  }

  function startLineTouch(line: CustomLine, touches: TouchPoints, rect: DOMRect) {
    const center = touchCenterPercent(touches, rect)
    setLineDrag(null)
    const nextTouch = {
      id: line.id,
      line,
      startCenterX: center.x,
      startCenterY: center.y,
      startDistance: Math.max(1, touchDistance(touches)),
      startAngle: touchAngle(touches),
      rect,
    }
    lineTouchRef.current = nextTouch
    setLineTouch(nextTouch)
  }

  function moveLineFromTouch(event: TouchEvent<HTMLElement>) {
    if (!lineTouchRef.current || event.touches.length < 2) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    updateLineTouch(event.touches)
  }

  function updateLineTouch(touches: TouchPoints) {
    const activeTouch = lineTouchRef.current
    if (!activeTouch || touches.length < 2) {
      return
    }

    const center = touchCenterPercent(touches, activeTouch.rect)
    const scale = clamp(touchDistance(touches) / activeTouch.startDistance, 0.35, 3)
    const rotation = angleDelta(activeTouch.startAngle, touchAngle(touches))
    onMoveLine(
      activeTouch.id,
      transformLineByTouch(activeTouch.line, activeTouch.startCenterX, activeTouch.startCenterY, center.x, center.y, scale, rotation),
    )
  }

  function clearLineTouch() {
    lineTouchRef.current = null
    linePointersRef.current.clear()
    setLineTouch(null)
  }

  function linePointerTouches(): TouchPoints | null {
    const points = Array.from(linePointersRef.current.values()).slice(0, 2)
    if (points.length < 2) {
      return null
    }

    return {
      length: 2,
      0: points[0],
      1: points[1],
    }
  }

  function nudgeLine(line: CustomLine, key: string, shift: boolean) {
    const step = shift ? 5 : 2
    if (key === 'ArrowLeft') {
      onMoveLine(line.id, { x1: line.x1 - step, x2: line.x2 - step })
    }
    if (key === 'ArrowRight') {
      onMoveLine(line.id, { x1: line.x1 + step, x2: line.x2 + step })
    }
    if (key === 'ArrowUp') {
      onMoveLine(line.id, { y1: line.y1 - step, y2: line.y2 - step })
    }
    if (key === 'ArrowDown') {
      onMoveLine(line.id, { y1: line.y1 + step, y2: line.y2 + step })
    }
  }

  return (
    <div className="creator-stack">
      <div
        ref={canvasRef}
        className="creator-canvas"
        aria-label="Drag layout rays"
        onTouchStart={beginLineTouch}
        onTouchMove={moveLineFromTouch}
        onTouchEnd={(event) => {
          if (event.touches.length < 2) {
            clearLineTouch()
          }
        }}
        onTouchCancel={clearLineTouch}
      >
        <span className="creator-ray-chip" aria-hidden="true">
          RAYS
        </span>
        {previewPanels.map((panel) => (
          <div key={panel.id} className="creator-panel" style={panelStyle(panel)} />
        ))}
        {draftLines.map((line) => (
          <React.Fragment key={line.id}>
            <button
              className={`creator-free-line ${lineDrag?.id === line.id || lineTouch?.id === line.id ? 'is-active' : ''}`}
              style={lineSegmentStyle(line)}
              type="button"
              aria-label="Move ray"
              data-ray-id={line.id}
              data-ray-x1={line.x1.toFixed(2)}
              data-ray-y1={line.y1.toFixed(2)}
              data-ray-x2={line.x2.toFixed(2)}
              data-ray-y2={line.y2.toFixed(2)}
              onPointerDown={(event) => beginLinePointer(event, line, 'line')}
              onPointerMove={moveLinePointer}
              onPointerUp={endLinePointer}
              onPointerCancel={endLinePointer}
              onTouchStart={(event) => {
                if (event.touches.length > 1) {
                  beginLineTouch(event)
                }
              }}
              onTouchMove={moveLineFromTouch}
              onTouchEnd={(event) => {
                if (event.touches.length < 2) {
                  clearLineTouch()
                }
              }}
              onTouchCancel={clearLineTouch}
              onKeyDown={(event) => {
                if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
                  event.preventDefault()
                  nudgeLine(line, event.key, event.shiftKey)
                }
              }}
            >
              <span aria-hidden="true">RAY</span>
            </button>
            <button
              className={`creator-handle creator-handle-start ${lineDrag?.id === line.id || lineTouch?.id === line.id ? 'is-active' : ''}`}
              style={lineHandleStyle(line.x1, line.y1)}
              type="button"
              aria-label="Move ray start"
              onPointerDown={(event) => beginLinePointer(event, line, 'start')}
              onPointerMove={moveLinePointer}
              onPointerUp={endLinePointer}
              onPointerCancel={endLinePointer}
              onTouchStart={(event) => {
                if (event.touches.length > 1) {
                  beginLineTouch(event)
                }
              }}
              onTouchMove={moveLineFromTouch}
              onTouchEnd={(event) => {
                if (event.touches.length < 2) {
                  clearLineTouch()
                }
              }}
              onTouchCancel={clearLineTouch}
            />
            <button
              className={`creator-handle creator-handle-end ${lineDrag?.id === line.id || lineTouch?.id === line.id ? 'is-active' : ''}`}
              style={lineHandleStyle(line.x2, line.y2)}
              type="button"
              aria-label="Move ray end"
              onPointerDown={(event) => beginLinePointer(event, line, 'end')}
              onPointerMove={moveLinePointer}
              onPointerUp={endLinePointer}
              onPointerCancel={endLinePointer}
              onTouchStart={(event) => {
                if (event.touches.length > 1) {
                  beginLineTouch(event)
                }
              }}
              onTouchMove={moveLineFromTouch}
              onTouchEnd={(event) => {
                if (event.touches.length < 2) {
                  clearLineTouch()
                }
              }}
              onTouchCancel={clearLineTouch}
            />
          </React.Fragment>
        ))}
      </div>
      <label className="field">
        <span>Name</span>
        <input value={draftName} placeholder="My manga layout" onChange={(event) => onName(event.target.value)} />
      </label>
      <div className="creator-actions">
        <button type="button" onClick={() => onAddLine('diagonal')}>
          Add diagonal ray
        </button>
        <button type="button" onClick={() => onAddLine('vertical')}>
          Add straight ray
        </button>
        <button type="button" onClick={onReset}>
          Reset rays
        </button>
        <button type="button" className="primary" onClick={onSave}>
          Save layout
        </button>
      </div>
    </div>
  )
}

function StickerPanel({
  activeSticker,
  onAdd,
  onUpdate,
  onDelete,
}: {
  activeSticker: Sticker | null
  onAdd: (kind: StickerKind) => void
  onUpdate: (update: Partial<Sticker>) => void
  onDelete: () => void
}) {
  return (
    <div className="drawer-stack">
      <div className="sticker-actions">
        {(['speech', 'thought', 'burst', 'caption', 'arrow', 'star'] as StickerKind[]).map((kind) => (
          <button key={kind} type="button" onClick={() => onAdd(kind)}>
            {kind}
          </button>
        ))}
      </div>
      <div className="triple-fields">
        <label className="field">
          <span>Bubble</span>
          <input
            type="color"
            value={activeSticker?.fill ?? '#ffffff'}
            disabled={!activeSticker}
            onChange={(event) => onUpdate({ fill: event.target.value })}
          />
        </label>
        <label className="field">
          <span>Ink</span>
          <input
            type="color"
            value={activeSticker?.ink ?? '#111111'}
            disabled={!activeSticker}
            onChange={(event) => onUpdate({ ink: event.target.value })}
          />
        </label>
        <label className="field">
          <span>Size</span>
          <input
            type="range"
            min="14"
            max="42"
            value={activeSticker?.fontSize ?? 22}
            disabled={!activeSticker}
            onChange={(event) => onUpdate({ fontSize: Number(event.target.value) })}
          />
        </label>
      </div>
      <button className="subtle-danger" type="button" disabled={!activeSticker} onClick={onDelete}>
        Delete selected sticker
      </button>
    </div>
  )
}

function StylePanel({
  settings,
  onSettings,
  onShare,
}: {
  settings: Settings
  onSettings: (settings: Partial<Settings>) => void
  onShare: () => void
}) {
  return (
    <div className="drawer-stack">
      <label className="field">
        <span>Caption</span>
        <input value={settings.caption} placeholder="Optional title" onChange={(event) => onSettings({ caption: event.target.value })} />
      </label>
      <div className="triple-fields">
        <label className="field">
          <span>Paper</span>
          <input type="color" value={settings.background} onChange={(event) => onSettings({ background: event.target.value })} />
        </label>
        <label className="field">
          <span>Ink</span>
          <input type="color" value={settings.borderColor} onChange={(event) => onSettings({ borderColor: event.target.value })} />
        </label>
        <label className="field">
          <span>Fit</span>
          <select value={settings.fit} onChange={(event) => onSettings({ fit: event.target.value as PanelFit })}>
            <option value="cover">Fill</option>
            <option value="contain">Fit</option>
          </select>
        </label>
      </div>
      <div className="triple-fields">
        <label className="field">
          <span>Gap</span>
          <input type="range" min="0" max="24" value={settings.gutters} onChange={(event) => onSettings({ gutters: Number(event.target.value) })} />
        </label>
        <label className="field">
          <span>Corner</span>
          <input type="range" min="0" max="24" value={settings.radius} onChange={(event) => onSettings({ radius: Number(event.target.value) })} />
        </label>
        <label className="field">
          <span>Border</span>
          <input type="range" min="0" max="10" value={settings.border} onChange={(event) => onSettings({ border: Number(event.target.value) })} />
        </label>
      </div>
      <div className="share-row">
        <button className="primary secondary" type="button" onClick={onShare}>
          Share
        </button>
      </div>
    </div>
  )
}

function StickerView({
  sticker,
  active,
  editing,
  onSelect,
  onEditStart,
  onEditEnd,
  onText,
  onDelete,
  onDragStart,
  onPinchStart,
}: {
  sticker: Sticker
  active: boolean
  editing: boolean
  onSelect: () => void
  onEditStart: () => void
  onEditEnd: () => void
  onText: (text: string) => void
  onDelete: () => void
  onDragStart: (event: PointerEvent<HTMLElement> | TouchEvent<HTMLElement>, mode: 'move' | 'resize') => void
  onPinchStart: (event: TouchEvent<HTMLElement>) => void
}) {
  const textStartRef = useRef<{ x: number; y: number } | null>(null)
  const suppressTextClickRef = useRef(false)
  const style = {
    left: `${sticker.x * 100}%`,
    top: `${sticker.y * 100}%`,
    width: `${sticker.w * 100}%`,
    height: `${sticker.h * 100}%`,
    '--sticker-fill': sticker.fill,
    '--sticker-ink': sticker.ink,
    '--sticker-size': `${sticker.fontSize}px`,
    transform: `rotate(${sticker.rotation}deg)`,
  } as React.CSSProperties

  function rememberTextPointer(event: PointerEvent<HTMLButtonElement>) {
    textStartRef.current = { x: event.clientX, y: event.clientY }
  }

  function finishTextPointer(event: PointerEvent<HTMLButtonElement>) {
    const start = textStartRef.current
    textStartRef.current = null
    if (!start) {
      return
    }

    const isTap = Math.hypot(event.clientX - start.x, event.clientY - start.y) < 8
    suppressTextClickRef.current = !isTap
    if (isTap) {
      onEditStart()
    }
  }

  function rememberTextTouch(event: TouchEvent<HTMLButtonElement>) {
    const point = event.touches[0]
    textStartRef.current = point ? { x: point.clientX, y: point.clientY } : null
  }

  function finishTextTouch(event: TouchEvent<HTMLButtonElement>) {
    const point = event.changedTouches[0]
    const start = textStartRef.current
    textStartRef.current = null
    if (!point || !start) {
      return
    }

    const isTap = Math.hypot(point.clientX - start.x, point.clientY - start.y) < 8
    suppressTextClickRef.current = !isTap
    if (isTap) {
      onEditStart()
    }
  }

  return (
    <div
      className={`sticker sticker-${sticker.kind} ${active ? 'active' : ''}`}
      style={style}
      data-sticker-id={sticker.id}
      data-rotation={Math.round(sticker.rotation)}
      role="button"
      tabIndex={0}
      onClick={(event) => {
        event.stopPropagation()
        onSelect()
      }}
      onPointerDown={(event) => onDragStart(event, 'move')}
      onTouchStart={(event) => {
        if (event.touches.length > 1) {
          onPinchStart(event)
        } else {
          onDragStart(event, 'move')
        }
      }}
    >
      {editing ? (
        <textarea
          className="sticker-text-input"
          value={sticker.text}
          aria-label="Edit sticker text"
          autoFocus
          onFocus={(event) => event.currentTarget.select()}
          onPointerDown={(event) => event.stopPropagation()}
          onTouchStart={(event) => {
            if (event.touches.length < 2) {
              event.stopPropagation()
            }
          }}
          onChange={(event) => onText(event.target.value)}
          onBlur={onEditEnd}
          onKeyDown={(event) => {
            if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Escape') {
              event.preventDefault()
              event.currentTarget.blur()
            }
          }}
        />
      ) : (
        <button
            className="sticker-text"
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              if (suppressTextClickRef.current) {
                suppressTextClickRef.current = false
                return
              }
              onEditStart()
            }}
            onPointerDown={rememberTextPointer}
            onPointerUp={finishTextPointer}
            onTouchStart={rememberTextTouch}
            onTouchEnd={finishTextTouch}
          >
          <StickerText sticker={sticker} />
        </button>
      )}
      <i
        aria-hidden="true"
        onPointerDown={(event) => {
          event.stopPropagation()
          onDragStart(event, 'resize')
        }}
        onTouchStart={(event) => {
          event.stopPropagation()
          if (event.touches.length > 1) {
            onPinchStart(event)
          } else {
            onDragStart(event, 'resize')
          }
        }}
      />
      <button
        className="sticker-delete"
        type="button"
        aria-label="Delete sticker"
        onClick={(event) => {
          event.stopPropagation()
          onDelete()
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onTouchStart={(event) => event.stopPropagation()}
      >
        ⌫
      </button>
    </div>
  )
}

function StickerText({ sticker }: { sticker: Sticker }) {
  const metrics = fitStickerText(sticker.text, sticker)
  return (
    <span
      className="sticker-text-fit"
      style={{ fontSize: `${metrics.fontSize}px`, lineHeight: metrics.lineHeight }}
    >
      {metrics.lines.map((line, index) => (
        <span key={`${line}-${index}`}>{line}</span>
      ))}
    </span>
  )
}

async function renderToPng(layout: Layout, shots: Record<string, Shot>, stickers: Sticker[], settings: Settings) {
  const canvas = document.createElement('canvas')
  const width = 1440
  const captionHeight = settings.caption.trim() ? 130 : 0
  const panelHeight = Math.round(width * 1.45)
  canvas.width = width
  canvas.height = panelHeight + captionHeight
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Canvas is unavailable.')
  }

  context.fillStyle = settings.background
  context.fillRect(0, 0, canvas.width, canvas.height)
  const gutter = settings.gutters * 3
  const outer = settings.border * 3

  const images = await Promise.all(
    layout.panels.map(async (panel) => ({
      panel,
      shot: shots[panel.id] ?? null,
      image: shots[panel.id] ? await loadImage(shots[panel.id].dataUrl) : null,
    })),
  )

  for (const { panel, image, shot } of images) {
    drawPanel(context, panel, image, shot, width, panelHeight, outer, gutter, settings)
  }

  for (const sticker of stickers) {
    drawSticker(context, sticker, width, panelHeight)
  }

  if (settings.caption.trim()) {
    context.fillStyle = '#ffffff'
    context.fillRect(outer + gutter / 2, panelHeight + gutter / 2, width - outer * 2 - gutter, captionHeight - gutter)
    context.strokeStyle = settings.borderColor
    context.lineWidth = Math.max(3, settings.border * 2)
    context.strokeRect(outer + gutter / 2, panelHeight + gutter / 2, width - outer * 2 - gutter, captionHeight - gutter)
    context.fillStyle = settings.captionColor
    context.font = '900 74px ui-rounded, "Avenir Next", "Segoe UI", sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(settings.caption, width / 2, panelHeight + captionHeight / 2, width - 130)
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) {
    throw new Error('PNG render failed.')
  }
  return blob
}

function drawPanel(
  context: CanvasRenderingContext2D,
  panel: Panel,
  image: HTMLImageElement | null,
  shot: Shot | null,
  width: number,
  panelHeight: number,
  outer: number,
  gutter: number,
  settings: Settings,
) {
  const bounds = panelBounds(panel)
  const x = outer + bounds.x * (width - outer * 2) + gutter / 2
  const y = outer + bounds.y * (panelHeight - outer * 2) + gutter / 2
  const w = bounds.w * (width - outer * 2) - gutter
  const h = bounds.h * (panelHeight - outer * 2) - gutter

  context.save()
  if (panel.points) {
    drawPanelPolygon(context, panel, width, panelHeight, outer, gutter)
  } else {
    drawRoundedRect(context, x, y, w, h, settings.radius * 3)
  }
  context.fillStyle = '#ffffff'
  context.fill()
  context.clip()
  if (image) {
    drawImageFit(context, image, x, y, w, h, settings.fit, shot ?? createShot(''))
  } else {
    drawEmptyPanel(context, x, y, w, h)
  }
  context.restore()

  if (settings.border > 0) {
    context.lineWidth = Math.max(2, settings.border * 2)
    context.strokeStyle = settings.borderColor
    if (panel.points) {
      drawPanelPolygon(context, panel, width, panelHeight, outer, gutter)
    } else {
      drawRoundedRect(context, x, y, w, h, settings.radius * 3)
    }
    context.stroke()
  }
}

function drawPanelPolygon(
  context: CanvasRenderingContext2D,
  panel: Panel,
  width: number,
  panelHeight: number,
  outer: number,
  gutter: number,
) {
  const points = panel.points ?? []
  const center = panelCentroid(panel)
  context.beginPath()
  points.forEach(([px, py], index) => {
    const nx = px / 100
    const ny = py / 100
    const insetX = (center.x - nx) * gutter
    const insetY = (center.y - ny) * gutter
    const x = outer + nx * (width - outer * 2) + insetX
    const y = outer + ny * (panelHeight - outer * 2) + insetY
    index === 0 ? context.moveTo(x, y) : context.lineTo(x, y)
  })
  context.closePath()
}

function drawSticker(context: CanvasRenderingContext2D, sticker: Sticker, width: number, panelHeight: number) {
  const x = sticker.x * width
  const y = sticker.y * panelHeight
  const w = sticker.w * width
  const h = sticker.h * panelHeight
  context.save()
  context.translate(x + w / 2, y + h / 2)
  context.rotate((sticker.rotation * Math.PI) / 180)
  context.translate(-w / 2, -h / 2)
  context.fillStyle = sticker.fill
  context.strokeStyle = sticker.ink
  context.lineWidth = Math.max(6, Math.min(w, h) * 0.06)
  if (sticker.kind === 'burst') {
    drawBurst(context, w, h)
  } else if (sticker.kind === 'thought') {
    drawOval(context, 0, 0, w, h)
  } else if (sticker.kind === 'star') {
    drawStar(context, w / 2, h / 2, Math.min(w, h) * 0.48, Math.min(w, h) * 0.23)
  } else if (sticker.kind === 'arrow') {
    drawArrow(context, w, h)
  } else {
    drawRoundedRect(context, 0, 0, w, h * 0.86, sticker.kind === 'caption' ? 12 : h * 0.25)
  }
  if (sticker.kind !== 'arrow') {
    context.fill()
    context.stroke()
  }
  const textMetrics = fitStickerText(sticker.text, sticker)
  context.fillStyle = sticker.ink
  context.font = `900 ${textMetrics.fontSize * 3}px ui-rounded, "Avenir Next", "Segoe UI", sans-serif`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  textMetrics.lines.forEach((line, index) => {
    const y = h * 0.43 + (index - (textMetrics.lines.length - 1) / 2) * textMetrics.fontSize * textMetrics.lineHeight * 3
    context.fillText(line, w / 2, y, w * 0.84)
  })
  context.restore()
}

function panelStyle(panel: Panel) {
  const center = panelCentroid(panel)
  return {
    left: `${panel.x * 100}%`,
    top: `${panel.y * 100}%`,
    width: `${panel.w * 100}%`,
    height: `${panel.h * 100}%`,
    clipPath: panel.points ? pointsToClipPath(panel.points) : undefined,
    '--chip-x': `${center.x * 100}%`,
    '--chip-y': `${center.y * 100}%`,
  }
}

function shotImageStyle(shot: Shot) {
  return {
    transform: `translate(${shot.offsetX * 100}%, ${shot.offsetY * 100}%) scale(${shot.scale})`,
  } as React.CSSProperties
}

function pointsToClipPath(points: Array<[number, number]>) {
  return `polygon(${points.map(([x, y]) => `${x}% ${y}%`).join(', ')})`
}

function panelBounds(panel: Panel) {
  if (!panel.points) {
    return { x: panel.x, y: panel.y, w: panel.w, h: panel.h }
  }

  const xs = panel.points.map(([x]) => x / 100)
  const ys = panel.points.map(([, y]) => y / 100)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const maxX = Math.max(...xs)
  const maxY = Math.max(...ys)
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

function panelCentroid(panel: Panel) {
  if (!panel.points) {
    return { x: panel.x + panel.w / 2, y: panel.y + panel.h / 2 }
  }

  const total = panel.points.reduce(
    (acc, [x, y]) => ({
      x: acc.x + x / 100,
      y: acc.y + y / 100,
    }),
    { x: 0, y: 0 },
  )
  return {
    x: total.x / panel.points.length,
    y: total.y / panel.points.length,
  }
}

function drawImageFit(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource & { width?: number; height?: number; videoWidth?: number; videoHeight?: number },
  x: number,
  y: number,
  w: number,
  h: number,
  fit: PanelFit,
  shot: Shot,
) {
  const imageWidth = image.videoWidth || image.width || w
  const imageHeight = image.videoHeight || image.height || h
  const imageRatio = imageWidth / imageHeight
  const rectRatio = w / h
  const cover = fit === 'cover'
  const useWidth = cover ? imageRatio < rectRatio : imageRatio > rectRatio
  const drawW = (useWidth ? w : h * imageRatio) * shot.scale
  const drawH = (useWidth ? w / imageRatio : h) * shot.scale
  const offsetX = shot.offsetX * w
  const offsetY = shot.offsetY * h
  context.drawImage(image, x + (w - drawW) / 2 + offsetX, y + (h - drawH) / 2 + offsetY, drawW, drawH)
}

function drawRoundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
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
  context.fillStyle = '#f4f0e6'
  context.fillRect(x, y, w, h)
  context.strokeStyle = '#ded5c4'
  context.lineWidth = 6
  for (let offset = -h; offset < w; offset += 46) {
    context.beginPath()
    context.moveTo(x + offset, y + h)
    context.lineTo(x + offset + h, y)
    context.stroke()
  }
}

function drawOval(context: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  context.beginPath()
  context.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
  context.closePath()
}

function drawBurst(context: CanvasRenderingContext2D, w: number, h: number) {
  context.beginPath()
  for (let index = 0; index < 18; index += 1) {
    const angle = (Math.PI * 2 * index) / 18 - Math.PI / 2
    const radius = index % 2 === 0 ? 0.52 : 0.36
    const x = w / 2 + Math.cos(angle) * w * radius
    const y = h / 2 + Math.sin(angle) * h * radius
    index === 0 ? context.moveTo(x, y) : context.lineTo(x, y)
  }
  context.closePath()
}

function drawStar(context: CanvasRenderingContext2D, cx: number, cy: number, outer: number, inner: number) {
  context.beginPath()
  for (let index = 0; index < 10; index += 1) {
    const radius = index % 2 === 0 ? outer : inner
    const angle = (Math.PI * index) / 5 - Math.PI / 2
    const x = cx + Math.cos(angle) * radius
    const y = cy + Math.sin(angle) * radius
    index === 0 ? context.moveTo(x, y) : context.lineTo(x, y)
  }
  context.closePath()
}

function drawArrow(context: CanvasRenderingContext2D, w: number, h: number) {
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.lineWidth = Math.max(14, h * 0.24)
  context.beginPath()
  context.moveTo(w * 0.08, h * 0.55)
  context.lineTo(w * 0.72, h * 0.55)
  context.stroke()
  context.beginPath()
  context.moveTo(w * 0.64, h * 0.22)
  context.lineTo(w * 0.93, h * 0.55)
  context.lineTo(w * 0.64, h * 0.88)
  context.stroke()
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('A photo could not be loaded.'))
    image.src = src
  })
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new Error('Photo upload failed.'))
      }
    }
    reader.onerror = () => reject(new Error('Photo upload failed.'))
    reader.readAsDataURL(file)
  })
}

function fitStickerText(text: string, sticker: Sticker): StickerTextMetrics {
  const raw = (text.trim() || 'TEXT').toUpperCase()
  const maxChars = Math.max(4, Math.round(sticker.w * 42))
  const lines = wrapText(raw, maxChars).slice(0, 4)
  const longest = Math.max(...lines.map((line) => line.length), 1)
  const widthFactor = (sticker.w * 120) / longest
  const heightFactor = (sticker.h * 120) / Math.max(lines.length, 1)
  const fontSize = clamp(Math.min(sticker.fontSize, widthFactor, heightFactor), 11, sticker.fontSize)
  return {
    fontSize,
    lineHeight: lines.length > 2 ? 0.9 : 0.96,
    lines,
  }
}

function wrapText(text: string, maxChars: number) {
  const explicitLines = text.split(/\n+/)
  const lines: string[] = []

  for (const explicitLine of explicitLines) {
    const words = explicitLine.split(/\s+/).filter(Boolean)
    let line = ''
    for (const word of words) {
      if (!line) {
        line = word
      } else if (`${line} ${word}`.length <= maxChars) {
        line = `${line} ${word}`
      } else {
        lines.push(line)
        line = word
      }

      while (line.length > maxChars) {
        lines.push(line.slice(0, maxChars))
        line = line.slice(maxChars)
      }
    }

    if (line) {
      lines.push(line)
    }
  }

  return lines.length > 0 ? lines : ['TEXT']
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function createDraftLine(preset: CustomLinePreset, index = 0): CustomLine {
  const offset = (index % 4) * 8
  const base = {
    id: `${preset}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  }

  if (preset === 'vertical') {
    const x = clamp(42 + offset, 14, 86)
    return { ...base, x1: x, y1: 4, x2: x, y2: 96 }
  }

  if (preset === 'horizontal') {
    const y = clamp(36 + offset, 14, 86)
    return { ...base, x1: 4, y1: y, x2: 96, y2: y }
  }

  return {
    ...base,
    x1: 6,
    y1: clamp(26 + offset, 10, 84),
    x2: 94,
    y2: clamp(72 - offset / 2, 16, 90),
  }
}

function createDefaultDraftLines() {
  return [createDraftLine('diagonal', 0), createDraftLine('vertical', 1)]
}

function clampCustomLine(line: CustomLine): CustomLine {
  const next = {
    ...line,
    x1: clamp(Number(line.x1.toFixed(2)), 0, 100),
    y1: clamp(Number(line.y1.toFixed(2)), 0, 100),
    x2: clamp(Number(line.x2.toFixed(2)), 0, 100),
    y2: clamp(Number(line.y2.toFixed(2)), 0, 100),
  }
  const length = Math.hypot(next.x2 - next.x1, next.y2 - next.y1)
  if (length >= 8) {
    return next
  }

  if (next.x1 < 50) {
    next.x2 = clamp(next.x1 + 14, 0, 100)
  } else {
    next.x2 = clamp(next.x1 - 14, 0, 100)
  }
  return next
}

function lineSegmentStyle(line: CustomLine) {
  const dx = line.x2 - line.x1
  const dy = (line.y2 - line.y1) * CREATOR_CANVAS_ASPECT
  return {
    left: `${line.x1}%`,
    top: `${line.y1}%`,
    width: `${Math.hypot(dx, dy)}%`,
    transform: `translateY(-50%) rotate(${Math.atan2(dy, dx)}rad)`,
  } as React.CSSProperties
}

function lineHandleStyle(x: number, y: number) {
  return {
    left: `${x}%`,
    top: `${y}%`,
  } as React.CSSProperties
}

function touchCenterPercent(touches: TouchPoints, rect: DOMRect) {
  return {
    x: ((((touches[0].clientX + touches[1].clientX) / 2) - rect.left) / rect.width) * 100,
    y: ((((touches[0].clientY + touches[1].clientY) / 2) - rect.top) / rect.height) * 100,
  }
}

function nearestLineToPoint(lines: CustomLine[], x: number, y: number) {
  let nearest: CustomLine | null = null
  let nearestDistance = Number.POSITIVE_INFINITY

  for (const line of lines) {
    const distance = lineDistanceToPoint(line, x, y)
    if (distance < nearestDistance) {
      nearest = line
      nearestDistance = distance
    }
  }

  return nearest
}

function lineDistanceToPoint(line: CustomLine, x: number, y: number) {
  const pointX = x
  const pointY = y * CREATOR_CANVAS_ASPECT
  const startX = line.x1
  const startY = line.y1 * CREATOR_CANVAS_ASPECT
  const endX = line.x2
  const endY = line.y2 * CREATOR_CANVAS_ASPECT
  const dx = endX - startX
  const dy = endY - startY
  const lengthSquared = dx * dx + dy * dy || 1
  const position = clamp(((pointX - startX) * dx + (pointY - startY) * dy) / lengthSquared, 0, 1)
  const targetX = startX + dx * position
  const targetY = startY + dy * position

  return Math.hypot(pointX - targetX, pointY - targetY)
}

function transformLineByTouch(
  line: CustomLine,
  startCenterX: number,
  startCenterY: number,
  currentCenterX: number,
  currentCenterY: number,
  scale: number,
  rotationDegrees: number,
) {
  const centerX = (line.x1 + line.x2) / 2
  const centerY = ((line.y1 + line.y2) / 2) * CREATOR_CANVAS_ASPECT
  const moveX = currentCenterX - startCenterX
  const moveY = (currentCenterY - startCenterY) * CREATOR_CANVAS_ASPECT
  const radians = (rotationDegrees * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)

  function point(x: number, y: number) {
    const dx = x - centerX
    const dy = y * CREATOR_CANVAS_ASPECT - centerY
    return {
      x: centerX + (dx * cos - dy * sin) * scale + moveX,
      y: (centerY + (dx * sin + dy * cos) * scale + moveY) / CREATOR_CANVAS_ASPECT,
    }
  }

  const start = point(line.x1, line.y1)
  const end = point(line.x2, line.y2)
  return { x1: start.x, y1: start.y, x2: end.x, y2: end.y }
}

function panelsFromLines(lines: CustomLine[]) {
  let polygons: Array<Array<[number, number]>> = [
    [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ],
  ]

  for (const line of lines) {
    const nextPolygons: Array<Array<[number, number]>> = []
    for (const polygon of polygons) {
      const positive = clipPolygonByLine(polygon, line, true)
      const negative = clipPolygonByLine(polygon, line, false)
      const positiveArea = Math.abs(polygonArea(positive))
      const negativeArea = Math.abs(polygonArea(negative))

      if (positiveArea > 30 && negativeArea > 30) {
        nextPolygons.push(positive, negative)
      } else {
        nextPolygons.push(polygon)
      }
    }
    polygons = nextPolygons
  }

  return polygons
    .filter((polygon) => Math.abs(polygonArea(polygon)) > 30)
    .map((points, index) => ({
      id: String(index + 1),
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      points: simplifyPolygon(points).map(([x, y]) => [Number(x.toFixed(2)), Number(y.toFixed(2))] as [number, number]),
    }))
}

function clipPolygonByLine(polygon: Array<[number, number]>, line: CustomLine, keepPositive: boolean) {
  if (polygon.length === 0) {
    return []
  }

  const output: Array<[number, number]> = []
  const epsilon = 0.0001
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index]
    const previous = polygon[(index + polygon.length - 1) % polygon.length]
    const currentSide = lineSide(current, line)
    const previousSide = lineSide(previous, line)
    const currentInside = keepPositive ? currentSide >= -epsilon : currentSide <= epsilon
    const previousInside = keepPositive ? previousSide >= -epsilon : previousSide <= epsilon

    if (currentInside) {
      if (!previousInside) {
        output.push(lineIntersection(previous, current, previousSide, currentSide))
      }
      output.push(current)
    } else if (previousInside) {
      output.push(lineIntersection(previous, current, previousSide, currentSide))
    }
  }

  return simplifyPolygon(output)
}

function lineSide(point: [number, number], line: CustomLine) {
  return (line.x2 - line.x1) * (point[1] - line.y1) - (line.y2 - line.y1) * (point[0] - line.x1)
}

function lineIntersection(
  start: [number, number],
  end: [number, number],
  startSide: number,
  endSide: number,
): [number, number] {
  const ratio = startSide / (startSide - endSide || 1)
  return [start[0] + (end[0] - start[0]) * ratio, start[1] + (end[1] - start[1]) * ratio]
}

function polygonArea(points: Array<[number, number]>) {
  let area = 0
  for (let index = 0; index < points.length; index += 1) {
    const [x1, y1] = points[index]
    const [x2, y2] = points[(index + 1) % points.length]
    area += x1 * y2 - x2 * y1
  }
  return area / 2
}

function simplifyPolygon(points: Array<[number, number]>) {
  return points.filter((point, index) => {
    const previous = points[(index + points.length - 1) % points.length]
    return Math.hypot(point[0] - previous[0], point[1] - previous[1]) > 0.05
  })
}

function touchDistance(touches: TouchPoints) {
  const first = touches[0]
  const second = touches[1]
  return Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY)
}

function touchAngle(touches: TouchPoints) {
  const first = touches[0]
  const second = touches[1]
  return (Math.atan2(second.clientY - first.clientY, second.clientX - first.clientX) * 180) / Math.PI
}

function angleDelta(start: number, current: number) {
  let delta = current - start
  while (delta > 180) {
    delta -= 360
  }
  while (delta < -180) {
    delta += 360
  }
  return delta
}

function pointInPanel(panel: Panel, x: number, y: number) {
  if (!panel.points) {
    return x >= panel.x && x <= panel.x + panel.w && y >= panel.y && y <= panel.y + panel.h
  }

  let inside = false
  const points = panel.points.map(([px, py]) => [px / 100, py / 100])

  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    const [xi, yi] = points[index]
    const [xj, yj] = points[previous]
    const crosses = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (crosses) {
      inside = !inside
    }
  }

  return inside
}

const root = document.querySelector<HTMLDivElement>('#app')

if (!root) {
  throw new Error('Missing app root')
}

createRoot(root).render(<App />)
