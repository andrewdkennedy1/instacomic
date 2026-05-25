import { AnimatePresence, motion, useDragControls } from 'framer-motion'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent, TouchEvent } from 'react'
import { createRoot } from 'react-dom/client'
import './style.css'

type PanelFit = 'cover' | 'contain'
type DrawerTab = 'layout' | 'create' | 'style'
type CustomLinePreset = 'diagonal' | 'vertical' | 'horizontal'
type PageFormatId = '4:5' | '3:4' | '9:16'

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
  dividerThickness?: number
  dividers?: CustomLine[]
}

type Shot = {
  dataUrl: string
  width?: number
  height?: number
  offsetX: number
  offsetY: number
  scale: number
}

type CapturedPhoto = {
  dataUrl: string
  width: number
  height: number
}

type LoadedPanelFrame = {
  panel: Panel
  shot: Shot | null
  image: HTMLImageElement | null
}

type StoryVideoFormat = {
  mimeType: string
  extension: 'mp4' | 'webm'
}

type StoryVideoRenderPhase = 'rendering' | 'finalizing'

type ReadyStoryVideo = {
  blob: Blob
  url: string
  fileName: string
  mimeType: string
  extension: StoryVideoFormat['extension']
  width: number
  height: number
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
  videoDuration: number
  videoSpeed: number
}

type PageFormat = {
  id: PageFormatId
  label: string
  detail: string
  width: number
  height: number
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

type PhotoDragState = {
  panelId: string
  mode: 'move' | 'pinch'
  startX: number
  startY: number
  offsetX: number
  offsetY: number
  scale: number
  frameWidth: number
  frameHeight: number
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

type CustomPoint = {
  x: number
  y: number
}

function createShot(dataUrl: string, width?: number, height?: number): Shot {
  return {
    dataUrl,
    width,
    height,
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

function mergeLayoutShotsIntoCache(layout: Layout, shots: Record<string, Shot>, cache: Shot[]) {
  const next = [...cache]
  layout.panels.forEach((panel, index) => {
    const shot = shots[panel.id]
    if (shot) {
      next[index] = shot
    }
  })
  return next
}

function putShotInCache(layout: Layout, shots: Record<string, Shot>, cache: Shot[], panelId: string, shot: Shot) {
  const next = mergeLayoutShotsIntoCache(layout, shots, cache)
  const index = layout.panels.findIndex((panel) => panel.id === panelId)
  if (index >= 0) {
    next[index] = shot
  }
  return next
}

function shotsForLayout(layout: Layout, cache: Shot[]) {
  return Object.fromEntries(
    layout.panels
      .map((panel, index) => {
        const shot = cache[index]
        return shot ? ([panel.id, shot] as const) : null
      })
      .filter((entry): entry is readonly [string, Shot] => entry !== null),
  )
}

function nextOpenPanelId(layout: Layout, shots: Record<string, Shot>) {
  return layout.panels.find((panel) => !shots[panel.id])?.id ?? null
}

const CREATOR_SNAP_DISTANCE = 4.5

const pageFormats: PageFormat[] = [
  { id: '4:5', label: 'Post', detail: 'Instagram portrait', width: 4, height: 5 },
  { id: '3:4', label: 'Tall', detail: 'Classic portrait', width: 3, height: 4 },
  { id: '9:16', label: 'Story', detail: 'Stories/Reels', width: 9, height: 16 },
]

const defaultPageFormat = pageFormats[0]

function getPageFormat(id: string | null) {
  return pageFormats.find((format) => format.id === id) ?? defaultPageFormat
}

function pageFormatCanvasAspect(format: PageFormat) {
  return format.height / format.width
}

function layoutDividerThickness(layout: Layout) {
  if (typeof layout.dividerThickness !== 'number' || Number.isNaN(layout.dividerThickness)) {
    return null
  }

  return clamp(Math.round(layout.dividerThickness), 0, 24)
}

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

const defaultSettings: Settings = {
  gutters: 4,
  radius: 0,
  border: 0,
  background: '#ffffff',
  borderColor: '#ffffff',
  caption: '',
  captionColor: '#111111',
  fit: 'cover',
  videoDuration: 6,
  videoSpeed: 1,
}

const CUSTOM_LAYOUT_KEY = 'instacomic.customLayouts.v1'
const ACTIVE_LAYOUT_KEY = 'instacomic.activeLayout.v1'
const PAGE_FORMAT_KEY = 'instacomic.pageFormat.v1'

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

type StandaloneNavigator = Navigator & {
  standalone?: boolean
}

type AppContext = {
  browserName: string
  isInstalled: boolean
  isIos: boolean
}

type LockableScreenOrientation = ScreenOrientation & {
  lock?: (orientation: 'portrait' | 'portrait-primary') => Promise<void> | void
}

type LockableScreen = Screen & {
  orientation?: LockableScreenOrientation
}

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

function isDisplayModeApp() {
  const nav = navigator as StandaloneNavigator
  return (
    nav.standalone === true ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches
  )
}

function isIosDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function getBrowserName() {
  const userAgent = navigator.userAgent

  if (/EdgiOS|EdgA|Edg\//i.test(userAgent)) {
    return 'Edge'
  }

  if (/FxiOS|Firefox/i.test(userAgent)) {
    return 'Firefox'
  }

  if (/CriOS|Chrome|Chromium/i.test(userAgent)) {
    return 'Chrome'
  }

  if (/Safari/i.test(userAgent)) {
    return 'Safari'
  }

  return 'Browser'
}

function getAppContext(): AppContext {
  return {
    browserName: getBrowserName(),
    isInstalled: isDisplayModeApp(),
    isIos: isIosDevice(),
  }
}

function App() {
  const [started, setStarted] = useState(false)
  const [layout, setLayout] = useState(layouts[0])
  const [activePanelId, setActivePanelId] = useState<string | null>(layouts[0].panels[0].id)
  const [shots, setShots] = useState<Record<string, Shot>>({})
  const [settings, setSettings] = useState(defaultSettings)
  const [pageFormat, setPageFormat] = useState<PageFormat>(defaultPageFormat)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [facing, setFacing] = useState<'environment' | 'user'>('environment')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('layout')
  const [status, setStatus] = useState('Tap a panel. Shoot. Repeat.')
  const [exportUrl, setExportUrl] = useState<string | null>(null)
  const [videoRendering, setVideoRendering] = useState(false)
  const [videoProgress, setVideoProgress] = useState(0)
  const [videoProgressPhase, setVideoProgressPhase] = useState<StoryVideoRenderPhase>('rendering')
  const [readyVideo, setReadyVideo] = useState<ReadyStoryVideo | null>(null)
  const [photoDragState, setPhotoDragState] = useState<PhotoDragState | null>(null)
  const [customLayouts, setCustomLayouts] = useState<Layout[]>([])
  const [draftLines, setDraftLines] = useState<CustomLine[]>(() => createDefaultDraftLines())
  const [draftName, setDraftName] = useState('')
  const [draftThickness, setDraftThickness] = useState(9)
  const [creatorOpen, setCreatorOpen] = useState(false)
  const [appContext, setAppContext] = useState<AppContext>(() => getAppContext())
  const [storageReady, setStorageReady] = useState(false)
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const shellRef = useRef<HTMLElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const shotCacheRef = useRef<Shot[]>([])
  const readyVideoUrlRef = useRef<string | null>(null)
  const startRequestedRef = useRef(false)
  const dragControls = useDragControls()

  const allLayouts = useMemo(() => [...layouts, ...customLayouts], [customLayouts])
  const activePanelIndex = activePanelId ? layout.panels.findIndex((panel) => panel.id === activePanelId) : -1
  const capturedCount = layout.panels.filter((panel) => shots[panel.id]).length
  const pageStyle = {
    '--page-width': pageFormat.width,
    '--page-height': pageFormat.height,
  } as React.CSSProperties
  const creatorCanvasAspect = pageFormatCanvasAspect(pageFormat)

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      setDeferredPrompt(event as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    }
  }, [])

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        void navigator.serviceWorker.register('/sw.js')
      })
    }

    try {
      const stored = localStorage.getItem(CUSTOM_LAYOUT_KEY)
      const storedActiveLayoutId = localStorage.getItem(ACTIVE_LAYOUT_KEY)
      const storedPageFormat = getPageFormat(localStorage.getItem(PAGE_FORMAT_KEY))
      let restoredLayout: Layout | undefined
      if (stored) {
        const parsed = JSON.parse(stored) as Layout[]
        const validLayouts = parsed.filter((item) => Array.isArray(item.panels) && item.panels.length > 0)
        restoredLayout = [...layouts, ...validLayouts].find((item) => item.id === storedActiveLayoutId)
        setCustomLayouts(validLayouts)

        if (restoredLayout) {
          setLayout(restoredLayout)
          setActivePanelId(restoredLayout.panels[0]?.id ?? null)
          setStatus(`${restoredLayout.name} layout restored.`)
        }
      } else {
        restoredLayout = layouts.find((item) => item.id === storedActiveLayoutId)
        if (restoredLayout) {
          setLayout(restoredLayout)
          setActivePanelId(restoredLayout.panels[0]?.id ?? null)
          setStatus(`${restoredLayout.name} layout restored.`)
        }
      }

      setPageFormat(storedPageFormat)
      const restoredDividerThickness = restoredLayout ? layoutDividerThickness(restoredLayout) : null
      if (restoredDividerThickness !== null) {
        setSettings((current) => ({ ...current, gutters: restoredDividerThickness }))
      }
    } catch {
      localStorage.removeItem(CUSTOM_LAYOUT_KEY)
      localStorage.removeItem(ACTIVE_LAYOUT_KEY)
      localStorage.removeItem(PAGE_FORMAT_KEY)
    } finally {
      setStorageReady(true)
    }
  }, [])

  useEffect(() => {
    const fullscreenMode = window.matchMedia('(display-mode: fullscreen)')
    const standaloneMode = window.matchMedia('(display-mode: standalone)')
    const minimalMode = window.matchMedia('(display-mode: minimal-ui)')
    const refreshAppContext = () => setAppContext(getAppContext())

    fullscreenMode.addEventListener('change', refreshAppContext)
    standaloneMode.addEventListener('change', refreshAppContext)
    minimalMode.addEventListener('change', refreshAppContext)
    window.addEventListener('visibilitychange', refreshAppContext)
    window.addEventListener('focus', refreshAppContext)

    return () => {
      fullscreenMode.removeEventListener('change', refreshAppContext)
      standaloneMode.removeEventListener('change', refreshAppContext)
      minimalMode.removeEventListener('change', refreshAppContext)
      window.removeEventListener('visibilitychange', refreshAppContext)
      window.removeEventListener('focus', refreshAppContext)
    }
  }, [])

  useEffect(() => {
    const syncViewportHeight = () => {
      const height = window.visualViewport?.height ?? window.innerHeight
      document.documentElement.style.setProperty('--app-height', `${height}px`)
    }

    syncViewportHeight()
    window.addEventListener('resize', syncViewportHeight)
    window.visualViewport?.addEventListener('resize', syncViewportHeight)
    window.visualViewport?.addEventListener('scroll', syncViewportHeight)

    return () => {
      window.removeEventListener('resize', syncViewportHeight)
      window.visualViewport?.removeEventListener('resize', syncViewportHeight)
      window.visualViewport?.removeEventListener('scroll', syncViewportHeight)
    }
  }, [])

  useEffect(() => {
    if (!storageReady) {
      return
    }

    localStorage.setItem(CUSTOM_LAYOUT_KEY, JSON.stringify(customLayouts))
  }, [customLayouts, storageReady])

  useEffect(() => {
    if (!storageReady) {
      return
    }

    localStorage.setItem(ACTIVE_LAYOUT_KEY, layout.id)
  }, [layout.id, storageReady])

  useEffect(() => {
    if (!storageReady) {
      return
    }

    localStorage.setItem(PAGE_FORMAT_KEY, pageFormat.id)
  }, [pageFormat.id, storageReady])

  useEffect(() => {
    const video = videoRef.current
    if (video && stream) {
      video.srcObject = stream
      video.play().catch(() => {
        // The browser can interrupt play when React swaps preview nodes during capture.
      })
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

  useEffect(() => {
    return () => {
      if (readyVideoUrlRef.current) {
        URL.revokeObjectURL(readyVideoUrlRef.current)
      }
    }
  }, [])

  function clearReadyVideo() {
    if (readyVideoUrlRef.current) {
      URL.revokeObjectURL(readyVideoUrlRef.current)
      readyVideoUrlRef.current = null
    }
    setReadyVideo(null)
  }

  function clearExport() {
    if (exportUrl) {
      URL.revokeObjectURL(exportUrl)
      setExportUrl(null)
    }
    clearReadyVideo()
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

  async function lockPortraitOrientation() {
    const orientation = (screen as LockableScreen).orientation

    if (!orientation?.lock) {
      return
    }

    try {
      await orientation.lock('portrait-primary')
    } catch {
      try {
        await orientation.lock('portrait')
      } catch {
        // iOS browser tabs commonly ignore orientation locking; CSS keeps the app portrait-shaped.
      }
    }
  }

  async function enterApp() {
    await requestAppFullscreen()
    await lockPortraitOrientation()

    setStarted(true)
  }

  function selectPageFormat(format: PageFormat) {
    setPageFormat(format)
    clearExport()
    setStatus(`${format.id} ${format.label} canvas selected.`)
  }

  function startFromGesture() {
    if (startRequestedRef.current) {
      return
    }

    startRequestedRef.current = true
    void enterApp()
  }

  async function triggerNativeInstall() {
    if (!deferredPrompt) {
      return
    }
    try {
      await deferredPrompt.prompt()
      const { outcome } = await deferredPrompt.userChoice
      if (outcome === 'accepted') {
        setStatus('Installing Instacomic...')
      }
    } catch (error) {
      console.error('Install prompt failed:', error)
    } finally {
      setDeferredPrompt(null)
    }
  }

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
          resizeMode: { ideal: 'none' },
        } as MediaTrackConstraints & { resizeMode: { ideal: string } },
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

  async function capturePanel() {
    const video = videoRef.current
    const targetPanelId = activePanelId
    if (!targetPanelId) {
      setStatus('Tap a panel to retake it, or share the comic.')
      return
    }

    if (!stream || !video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      void startCamera()
      setStatus('Starting camera...')
      return
    }

    setStatus('Capturing full photo...')
    let photo: CapturedPhoto
    try {
      photo = await captureFullPhoto(stream, video)
    } catch (error) {
      setStatus(error instanceof Error ? `Photo capture failed: ${error.message}` : 'Photo capture failed.')
      return
    }

    const nextShot = createShot(photo.dataUrl, photo.width, photo.height)
    const nextCache = putShotInCache(layout, shots, shotCacheRef.current, targetPanelId, nextShot)
    shotCacheRef.current = nextCache
    const nextShots = shotsForLayout(layout, nextCache)
    setShots(nextShots)

    const currentIndex = layout.panels.findIndex((panel) => panel.id === targetPanelId)
    const nextPanel = layout.panels.slice(currentIndex + 1).find((panel) => !nextShots[panel.id])
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
    let image: HTMLImageElement
    try {
      image = await loadImage(dataUrl)
    } catch {
      setStatus('Photo upload failed.')
      return
    }
    const nextShot = createShot(dataUrl, image.naturalWidth || image.width, image.naturalHeight || image.height)
    const nextCache = putShotInCache(layout, shots, shotCacheRef.current, targetPanelId, nextShot)
    shotCacheRef.current = nextCache
    const nextShots = shotsForLayout(layout, nextCache)
    setShots(nextShots)

    const currentIndex = layout.panels.findIndex((panel) => panel.id === targetPanelId)
    const nextPanel = layout.panels.slice(currentIndex + 1).find((panel) => !nextShots[panel.id])
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
    const nextCache = mergeLayoutShotsIntoCache(layout, shots, shotCacheRef.current)
    shotCacheRef.current = nextCache
    const nextShots = shotsForLayout(nextLayout, nextCache)
    const restoredCount = Object.keys(nextShots).length
    const nextDividerThickness = layoutDividerThickness(nextLayout)
    setLayout(nextLayout)
    if (nextDividerThickness !== null) {
      setSettings((current) => ({ ...current, gutters: nextDividerThickness }))
    }
    setActivePanelId(nextOpenPanelId(nextLayout, nextShots))
    setShots(nextShots)
    setStatus(
      restoredCount > 0
        ? `${nextLayout.name} layout. Restored ${restoredCount} photo${restoredCount === 1 ? '' : 's'}.`
        : `${nextLayout.name} layout. Panel 1 is live.`,
    )
    clearExport()
  }

  function deleteCustomLayout(layoutId: string) {
    const targetLayout = customLayouts.find((item) => item.id === layoutId)
    if (!targetLayout) {
      return
    }

    setCustomLayouts((current) => current.filter((item) => item.id !== layoutId))
    if (layout.id === layoutId) {
      const fallbackLayout = layouts[0]
      changeLayout(fallbackLayout)
      setStatus(`${targetLayout.name} layout deleted. ${fallbackLayout.name} layout is active.`)
    } else {
      setStatus(`${targetLayout.name} layout deleted.`)
      clearExport()
    }
  }

  function addDraftLine(preset: CustomLinePreset) {
    setDraftLines((current) => [...current, createDraftLine(preset, current.length)])
  }

  function updateDraftLine(lineId: string, update: Partial<CustomLine>) {
    setDraftLines((current) =>
      current.map((line) => (line.id === lineId ? snapCustomLine(clampCustomLine({ ...line, ...update }), current, lineId, creatorCanvasAspect) : line)),
    )
  }

  function resetDraftLayout() {
    setDraftLines(createDefaultDraftLines())
    setStatus('Creator reset.')
  }

  function openCreator() {
    setCreatorOpen(true)
    setDrawerOpen(false)
    setDrawerTab('layout')
  }

  function closeCreator() {
    setCreatorOpen(false)
    setDrawerTab('layout')
  }

  function saveDraftLayout() {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }

    const panels = panelsFromLines(draftLines)

    if (panels.length === 0) {
      setStatus('Move a divider before saving.')
      return
    }

    const customLayout: Layout = {
      id: `custom-${Date.now()}`,
      name: draftName.trim() || `Custom ${customLayouts.length + 1}`,
      custom: true,
      dividerThickness: draftThickness,
      dividers: draftLines.map((line) => ({ ...line })),
      panels,
    }
    setCustomLayouts((current) => [...current, customLayout])
    changeLayout(customLayout)
    setDraftName('')
    setDraftLines(createDefaultDraftLines())
    setCreatorOpen(false)
    setDrawerTab('layout')
    setDrawerOpen(false)
    setStatus('Custom layout saved on this phone.')
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
    setPhotoDragState({
      panelId: panel.id,
      mode: 'move',
      startX: event.clientX,
      startY: event.clientY,
      offsetX: shot.offsetX,
      offsetY: shot.offsetY,
      scale: shot.scale,
      ...panelPhotoFrameSize(panel, rect),
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
    setPhotoDragState({
      panelId: firstPanel.id,
      mode: 'pinch',
      startX: 0,
      startY: 0,
      offsetX: shot.offsetX,
      offsetY: shot.offsetY,
      scale: shot.scale,
      ...panelPhotoFrameSize(firstPanel, rect),
      startDistance: touchDistance(event.touches),
    })
  }

  function movePhoto(clientX: number, clientY: number) {
    if (!photoDragState || photoDragState.mode !== 'move') {
      return
    }

    const dx = (clientX - photoDragState.startX) / photoDragState.frameWidth
    const dy = (clientY - photoDragState.startY) / photoDragState.frameHeight
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

      const nextShot = normalizeShot({ ...shot, ...update })
      const next = {
        ...current,
        [panelId]: nextShot,
      }
      shotCacheRef.current = putShotInCache(layout, next, shotCacheRef.current, panelId, nextShot)
      return next
    })
    clearExport()
  }

  function finishGestures() {
    setPhotoDragState(null)
  }

  function openDrawer(tab?: DrawerTab) {
    setDrawerTab(tab ?? drawerTab)
    setDrawerOpen(true)
  }

  async function renderComicBlob() {
    setStatus('Rendering...')
    const blob = await renderToPng(layout, shots, settings, pageFormat)
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

  async function exportStoryVideo() {
    if (videoRendering) {
      return
    }

    clearReadyVideo()
    setVideoRendering(true)
    setVideoProgress(0)
    setVideoProgressPhase('rendering')
    try {
      setStatus('Rendering story video...')
      const video = await renderStoryVideo(layout, shots, settings, pageFormat, (progress, phase) => {
        setVideoProgress(progress)
        setVideoProgressPhase(phase)
        setStatus(
          phase === 'finalizing'
            ? `Finalizing story video ${Math.round(progress * 100)}%...`
            : `Rendering story video ${Math.round(progress * 100)}%...`,
        )
      })
      const fileName = `instacomic-story.${video.extension}`
      const ready = setReadyStoryVideo(video, fileName)
      downloadReadyVideo(ready)
      setStatus(`Video ready. If it did not download, tap Download video.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Story video export failed.')
    } finally {
      setVideoRendering(false)
      setVideoProgress(0)
      setVideoProgressPhase('rendering')
    }
  }

  function setReadyStoryVideo(
    video: Awaited<ReturnType<typeof renderStoryVideo>>,
    fileName: string,
  ) {
    clearReadyVideo()
    const url = URL.createObjectURL(video.blob)
    const ready: ReadyStoryVideo = {
      blob: video.blob,
      url,
      fileName,
      mimeType: video.mimeType,
      extension: video.extension,
      width: video.width,
      height: video.height,
    }
    readyVideoUrlRef.current = url
    setReadyVideo(ready)
    return ready
  }

  function downloadReadyVideo(video: ReadyStoryVideo) {
    const link = document.createElement('a')
    link.href = video.url
    link.download = video.fileName
    document.body.append(link)
    link.click()
    link.remove()
  }

  async function shareReadyVideo(video: ReadyStoryVideo) {
    const file = new File([video.blob], video.fileName, { type: video.mimeType })
    try {
      if ('canShare' in navigator && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Instacomic story video' })
        setStatus(`Shared ${video.width}x${video.height} story video.`)
        return
      }

      downloadReadyVideo(video)
      setStatus(`Sharing is unavailable here, so the ${video.extension.toUpperCase()} downloaded.`)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setStatus('Video ready.')
        return
      }

      setStatus(error instanceof Error ? error.message : 'Story video share failed.')
    }
  }

  return (
    <main
      ref={shellRef}
      className={`native-shell ${appContext.isInstalled ? 'is-app' : 'is-installer'}`}
      style={pageStyle}
      onPointerMove={(event) => {
        movePhoto(event.clientX, event.clientY)
      }}
      onPointerUp={() => finishGestures()}
      onPointerCancel={() => finishGestures()}
      onTouchMove={(event) => {
        if (photoDragState?.mode === 'pinch') {
          movePhotoPinch(event.touches)
        } else if (event.touches[0]) {
          movePhoto(event.touches[0].clientX, event.touches[0].clientY)
        }
      }}
      onTouchEnd={() => finishGestures()}
      onTouchCancel={() => finishGestures()}
    >
      {!appContext.isInstalled ? (
        <InstallerScreen
          appContext={appContext}
          deferredPrompt={deferredPrompt}
          onTriggerNativeInstall={triggerNativeInstall}
        />
      ) : (
        <>
      {!started && (
        <section className="start-screen" aria-label="Start Instacomic">
          <div className="start-mark">Instacomic</div>
          <div className="format-picker" aria-label="Canvas ratio">
            <span>Choose canvas</span>
            <div className="format-options" role="group" aria-label="Canvas ratio">
              {pageFormats.map((format) => (
                <button
                  key={format.id}
                  className={`format-option ${pageFormat.id === format.id ? 'active' : ''}`}
                  type="button"
                  aria-pressed={pageFormat.id === format.id}
                  onClick={() => selectPageFormat(format)}
                >
                  <strong>{format.id}</strong>
                  <em>{format.label}</em>
                </button>
              ))}
            </div>
          </div>
          <div className="start-actions">
            <button
              className="start-button"
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
          </div>
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
          className={`live-strip layout-${layout.id} ${layout.custom ? 'is-custom' : ''} ${layout.panels.some((panel) => panel.points) ? 'is-manga' : ''}`}
          data-layout-id={layout.id}
          data-layout-name={layout.name}
          onPointerDown={(event) => {
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
                  style={shotImageStyle(panel, shots[panel.id], settings.fit, pageFormat)}
                  data-shot-scale={shots[panel.id].scale.toFixed(2)}
                  data-shot-x={shots[panel.id].offsetX.toFixed(2)}
                  data-shot-y={shots[panel.id].offsetY.toFixed(2)}
                />
              )}
              {panel.id === activePanelId && stream && !shots[panel.id] && (
                <LiveVideo stream={stream} panel={panel} fit={settings.fit} />
              )}
              {panel.id === activePanelId && !shots[panel.id] && <span className="panel-chip">LIVE</span>}
            </button>
          ))}

          {layout.dividers?.map((divider, index) => (
            <span
              key={`${divider.id}-${index}`}
              className="live-divider-gap"
              style={lineSegmentStyle(divider, creatorCanvasAspect)}
              aria-hidden="true"
            />
          ))}

          {settings.caption.trim() && <div className="strip-caption">{settings.caption}</div>}
        </div>
      </section>

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
        <button className="round-action" type="button" onClick={() => openDrawer()} aria-label="Controls">
          ⋯
        </button>
        <button
          className={`round-action video-action ${videoRendering ? 'is-rendering' : ''}`}
          type="button"
          onClick={() => void exportStoryVideo()}
          aria-label="Export story video"
          disabled={videoRendering}
        >
          ▶
        </button>
        <button className="round-action share-action" type="button" onClick={() => void shareComic()} aria-label="Share">
          ⇪
        </button>
      </nav>

      {videoRendering && (
        <div
          className="video-render-progress"
          role="progressbar"
          aria-label="Rendering story video"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(videoProgress * 100)}
          aria-valuetext={`${videoProgressPhase === 'finalizing' ? 'Finalizing' : 'Rendering'} ${Math.round(videoProgress * 100)}%`}
        >
          <span style={{ width: `${Math.round(videoProgress * 100)}%` }} />
          <em>{`${videoProgressPhase === 'finalizing' ? 'Finalizing' : 'Rendering'} ${Math.round(videoProgress * 100)}%`}</em>
        </div>
      )}

      {readyVideo && !videoRendering && (
        <div className="video-ready-card" role="status" aria-live="polite">
          <div>
            <strong>Story video ready</strong>
            <em>{`${readyVideo.width}x${readyVideo.height} ${readyVideo.extension.toUpperCase()}`}</em>
          </div>
          <div className="video-ready-actions">
            <button type="button" onClick={() => downloadReadyVideo(readyVideo)}>
              Download video
            </button>
            <button type="button" onClick={() => void shareReadyVideo(readyVideo)}>
              Share
            </button>
            <button type="button" aria-label="Dismiss video ready" onClick={clearReadyVideo}>
              ×
            </button>
          </div>
        </div>
      )}

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
        onTab={(tab) => {
          if (tab === 'create') {
            openCreator()
          } else {
            setDrawerTab(tab)
          }
        }}
      >
        {drawerTab === 'layout' && (
          <LayoutPanel
            layout={layout}
            layouts={allLayouts}
            onLayout={changeLayout}
            onCreate={openCreator}
            onDeleteCustomLayout={deleteCustomLayout}
          />
        )}
        {drawerTab === 'style' && (
          <StylePanel
            settings={settings}
            onSettings={(next) => {
              setSettings((current) => ({ ...current, ...next }))
              clearExport()
            }}
          />
        )}
      </Drawer>
      <AnimatePresence>
        {creatorOpen && (
          <motion.section
            className="creator-fullscreen"
            aria-label="Create custom layout"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.18 }}
          >
            <CreatorPanel
              draftName={draftName}
              draftLines={draftLines}
              dividerThickness={draftThickness}
              pageFormat={pageFormat}
              onName={setDraftName}
              onAddLine={addDraftLine}
              onMoveLine={updateDraftLine}
              onThickness={setDraftThickness}
              onReset={resetDraftLayout}
              onSave={saveDraftLayout}
              onCancel={closeCreator}
            />
          </motion.section>
        )}
      </AnimatePresence>
        </>
      )}
    </main>
  )
}

function LiveVideo({ stream, panel, fit }: { stream: MediaStream; panel: Panel; fit: PanelFit }) {
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (ref.current) {
      ref.current.srcObject = stream
      ref.current.play().catch(() => {
        // The live preview may unmount while the hidden capture video keeps the stream.
      })
    }
  }, [stream])

  return <video ref={ref} className="live-frame" style={photoFrameStyle(panel, fit)} autoPlay muted playsInline aria-hidden="true" />
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
  onDeleteCustomLayout,
}: {
  layout: Layout
  layouts: Layout[]
  onLayout: (layout: Layout) => void
  onCreate: () => void
  onDeleteCustomLayout: (layoutId: string) => void
}) {
  return (
    <div className="drawer-grid">
      {layouts.map((option) => (
        <div key={option.id} className="layout-card-shell">
          <button
            className={`layout-card ${layout.id === option.id ? 'active' : ''} ${option.custom ? 'has-delete' : ''}`}
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
          {option.custom && (
            <button
              className="layout-delete"
              type="button"
              aria-label={`Delete ${option.name} layout`}
              onClick={() => onDeleteCustomLayout(option.id)}
            >
              ⌫
            </button>
          )}
        </div>
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
  dividerThickness,
  pageFormat,
  onName,
  onAddLine,
  onMoveLine,
  onThickness,
  onReset,
  onSave,
  onCancel,
}: {
  draftName: string
  draftLines: CustomLine[]
  dividerThickness: number
  pageFormat: PageFormat
  onName: (name: string) => void
  onAddLine: (preset: CustomLinePreset) => void
  onMoveLine: (lineId: string, update: Partial<CustomLine>) => void
  onThickness: (thickness: number) => void
  onReset: () => void
  onSave: () => void
  onCancel: () => void
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
  const canvasAspect = pageFormatCanvasAspect(pageFormat)
  const creatorStyle = {
    '--creator-divider-thickness': `${dividerThickness}px`,
    '--creator-handle-size': `${Math.max(40, dividerThickness * 4)}px`,
    '--creator-page-width': pageFormat.width,
    '--creator-page-height': pageFormat.height,
  } as React.CSSProperties

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
    const line = nearestLineToPoint(draftLines, center.x, center.y, canvasAspect)
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
      transformLineByTouch(activeTouch.line, activeTouch.startCenterX, activeTouch.startCenterY, center.x, center.y, scale, rotation, canvasAspect),
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

  function submitLayout(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
    onSave()
  }

  return (
    <form
      className="creator-stack"
      style={creatorStyle}
      data-divider-thickness={dividerThickness}
      data-page-format={pageFormat.id}
      onSubmit={submitLayout}
    >
      <div className="creator-topbar">
        <button type="button" onClick={onCancel} aria-label="Close creator">
          Close
        </button>
        <strong>Create Layout</strong>
        <button type="submit" className="primary">
          Save
        </button>
      </div>
      <div className="creator-workbench">
        <div
          ref={canvasRef}
          className="creator-canvas"
          aria-label="Drag layout divider handles"
          data-page-format={pageFormat.id}
          onTouchStart={beginLineTouch}
          onTouchMove={moveLineFromTouch}
          onTouchEnd={(event) => {
            if (event.touches.length < 2) {
              clearLineTouch()
            }
          }}
          onTouchCancel={clearLineTouch}
        >
          {previewPanels.map((panel) => (
            <div key={panel.id} className="creator-panel" style={panelStyle(panel)} />
          ))}
          {draftLines.map((line, index) => (
            <React.Fragment key={line.id}>
              <span
                className={`creator-free-line ${lineDrag?.id === line.id || lineTouch?.id === line.id ? 'is-active' : ''}`}
                style={lineSegmentStyle(line, canvasAspect)}
                aria-hidden="true"
                data-divider-id={line.id}
                data-divider-index={index}
                data-divider-x1={line.x1.toFixed(2)}
                data-divider-y1={line.y1.toFixed(2)}
                data-divider-x2={line.x2.toFixed(2)}
                data-divider-y2={line.y2.toFixed(2)}
              />
              <button
                className={`creator-handle creator-handle-start ${lineDrag?.id === line.id || lineTouch?.id === line.id ? 'is-active' : ''}`}
                style={lineHandleStyle(line.x1, line.y1)}
                type="button"
                aria-label={`Move divider ${index + 1} start`}
                data-divider-id={line.id}
                data-divider-index={index}
                data-handle="start"
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
                aria-label={`Move divider ${index + 1} end`}
                data-divider-id={line.id}
                data-divider-index={index}
                data-handle="end"
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
        <div className="creator-side">
          <label className="field">
            <span>Name</span>
            <input
              value={draftName}
              placeholder="My manga layout"
              autoComplete="off"
              enterKeyHint="done"
              onChange={(event) => onName(event.target.value)}
            />
          </label>
          <label className="field creator-thickness">
            <span>Section gap</span>
            <input
              type="range"
              min="6"
              max="20"
              value={dividerThickness}
              aria-label="Divider thickness"
              onChange={(event) => onThickness(Number(event.target.value))}
            />
            <output>{dividerThickness}px</output>
          </label>
          <div className="creator-actions">
            <button type="button" onClick={() => onAddLine('diagonal')}>
              Add diagonal divider
            </button>
            <button type="button" onClick={() => onAddLine('vertical')}>
              Add straight divider
            </button>
            <button type="button" onClick={onReset}>
              Reset
            </button>
            <button type="submit" className="primary">
              Save layout
            </button>
          </div>
        </div>
      </div>
    </form>
  )
}

function StylePanel({
  settings,
  onSettings,
}: {
  settings: Settings
  onSettings: (settings: Partial<Settings>) => void
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
      <div className="video-settings">
        <div>
          <strong>Story video</strong>
          <em>Sliding panel reveal, exported for vertical reels when using 9:16.</em>
        </div>
        <label className="field">
          <span>{`Duration ${settings.videoDuration}s`}</span>
          <input
            aria-label="Video duration"
            type="range"
            min="3"
            max="10"
            step="1"
            value={settings.videoDuration}
            onChange={(event) => onSettings({ videoDuration: Number(event.target.value) })}
          />
        </label>
        <label className="field">
          <span>{`Speed ${settings.videoSpeed.toFixed(1)}x`}</span>
          <input
            aria-label="Video speed"
            type="range"
            min="0.6"
            max="1.8"
            step="0.1"
            value={settings.videoSpeed}
            onChange={(event) => onSettings({ videoSpeed: Number(event.target.value) })}
          />
        </label>
      </div>
    </div>
  )
}

function InstallerScreen({
  appContext,
  deferredPrompt,
  onTriggerNativeInstall,
}: {
  appContext: AppContext
  deferredPrompt: BeforeInstallPromptEvent | null
  onTriggerNativeInstall: () => void | Promise<void>
}) {
  const browserName = appContext.browserName === 'Browser' ? 'your browser' : appContext.browserName
  const isSafari = appContext.browserName === 'Safari'

  return (
    <section className="installer-screen" aria-label="Install Instacomic">
      <div className="installer-panel">
        <div className="installer-kicker">Installer only</div>
        <h1>Install Instacomic</h1>
        <p className="installer-copy">The browser page only installs the app. Create comics from the Home Screen app after install.</p>

        {deferredPrompt ? (
          <button className="installer-primary" type="button" onClick={() => void onTriggerNativeInstall()}>
            Add to Home Screen
          </button>
        ) : (
          <a className="installer-primary" href="#installer-steps">
            Add to Home Screen
          </a>
        )}

        {!deferredPrompt && (
          <div className="installer-note" role="status">
            Use {browserName}'s own menu to finish adding Instacomic to your Home Screen.
          </div>
        )}

        <div id="installer-steps" className="installer-steps">
          <h2>{deferredPrompt ? 'If the install prompt does not appear' : 'Add it to your Home Screen'}</h2>
          {appContext.isIos ? (
            <ol>
              {!isSafari && <li>Open this page from {browserName}'s browser menu or in Safari.</li>}
              <li>Tap the browser toolbar Share button or menu button.</li>
              <li>Choose Add to Home Screen from the browser action list.</li>
              <li>Launch Instacomic from the new Home Screen icon.</li>
            </ol>
          ) : (
            <ol>
              <li>Open the browser menu for this page.</li>
              <li>Choose Install app or Add to Home screen.</li>
              <li>Launch Instacomic from the installed app icon.</li>
            </ol>
          )}
        </div>
      </div>
    </section>
  )
}

async function renderToPng(
  layout: Layout,
  shots: Record<string, Shot>,
  settings: Settings,
  pageFormat: PageFormat,
) {
  const canvas = document.createElement('canvas')
  const width = 1440
  const panelHeight = Math.round((width * pageFormat.height) / pageFormat.width)
  canvas.width = width
  canvas.height = panelHeight
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
    drawPanel(context, panel, image, shot, width, panelHeight, outer, gutter, settings, 3)
  }

  for (const divider of layout.dividers ?? []) {
    drawDividerGap(context, divider, width, panelHeight, outer, gutter, settings.background)
  }

  if (settings.caption.trim()) {
    const captionHeight = Math.min(130, panelHeight * 0.22)
    const captionY = panelHeight - captionHeight - outer - gutter / 2
    context.fillStyle = '#ffffff'
    context.fillRect(outer + gutter / 2, captionY, width - outer * 2 - gutter, captionHeight - gutter)
    context.strokeStyle = settings.borderColor
    context.lineWidth = Math.max(3, settings.border * 2)
    context.strokeRect(outer + gutter / 2, captionY, width - outer * 2 - gutter, captionHeight - gutter)
    context.fillStyle = settings.captionColor
    context.font = '900 74px ui-rounded, "Avenir Next", "Segoe UI", sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(settings.caption, width / 2, captionY + captionHeight / 2, width - 130)
  }

  drawOuterBezel(context, width, panelHeight, outer, settings, !!layout.custom)

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) {
    throw new Error('PNG render failed.')
  }
  return blob
}

async function renderStoryVideo(
  layout: Layout,
  shots: Record<string, Shot>,
  settings: Settings,
  pageFormat: PageFormat,
  onProgress?: (progress: number, phase: StoryVideoRenderPhase) => void,
) {
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('Story video export is unavailable in this browser.')
  }

  const captureCanvas = document.createElement('canvas') as HTMLCanvasElement & {
    captureStream?: (frameRate?: number) => MediaStream
  }
  if (!captureCanvas.captureStream) {
    throw new Error('Story video export is unavailable in this browser.')
  }

  const videoFormat = bestStoryVideoFormat()
  const width = 1080
  const panelHeight = Math.round((width * pageFormat.height) / pageFormat.width)
  const fps = 24
  const duration = clamp(settings.videoDuration, 3, 10)
  const totalFrames = Math.max(1, Math.round(duration * fps))
  captureCanvas.width = width
  captureCanvas.height = panelHeight
  const context = captureCanvas.getContext('2d')
  if (!context) {
    throw new Error('Canvas is unavailable.')
  }

  const images = await loadPanelFrames(layout, shots)
  const stream = captureCanvas.captureStream(fps)
  const chunks: Blob[] = []
  const recorder = new MediaRecorder(stream, { mimeType: videoFormat.mimeType, videoBitsPerSecond: 6_000_000 })
  const done = new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data)
      }
    }
    recorder.onerror = () => reject(new Error('Story video recording failed.'))
    recorder.onstop = () => resolve(new Blob(chunks, { type: videoFormat.mimeType }))
  })

  let blob: Blob
  try {
    recorder.start(250)
    for (let frame = 0; frame < totalFrames; frame += 1) {
      const progress = totalFrames <= 1 ? 1 : frame / (totalFrames - 1)
      drawStoryVideoFrame(context, layout, images, settings, width, panelHeight, progress)
      if (frame % 6 === 0 || frame === totalFrames - 1) {
        onProgress?.(clamp(((frame + 1) / totalFrames) * 0.94, 0, 0.94), 'rendering')
      }
      await wait(1000 / fps)
    }

    onProgress?.(0.97, 'finalizing')
    await wait(120)
    if (recorder.state !== 'inactive') {
      try {
        recorder.requestData()
      } catch {
        // Some browsers do not allow an explicit final data request; stop still flushes.
      }
      recorder.stop()
    }
    blob = await withTimeout(done, 10000, 'Story video recording did not finish. Try a shorter video or another browser.')
  } finally {
    if (recorder.state !== 'inactive') {
      try {
        recorder.stop()
      } catch {
        // The recorder may already be stopping after an error or timeout.
      }
    }
    stream.getTracks().forEach((track) => track.stop())
  }

  if (blob.size <= 0) {
    throw new Error('Story video export produced an empty file.')
  }
  onProgress?.(1, 'finalizing')

  return {
    blob,
    width,
    height: panelHeight,
    mimeType: videoFormat.mimeType,
    extension: videoFormat.extension,
  }
}

async function loadPanelFrames(layout: Layout, shots: Record<string, Shot>): Promise<LoadedPanelFrame[]> {
  return Promise.all(
    layout.panels.map(async (panel) => ({
      panel,
      shot: shots[panel.id] ?? null,
      image: shots[panel.id] ? await loadImage(shots[panel.id].dataUrl) : null,
    })),
  )
}

function drawStoryVideoFrame(
  context: CanvasRenderingContext2D,
  layout: Layout,
  images: LoadedPanelFrame[],
  settings: Settings,
  width: number,
  panelHeight: number,
  progress: number,
) {
  context.clearRect(0, 0, width, panelHeight)
  context.fillStyle = settings.background
  context.fillRect(0, 0, width, panelHeight)
  const styleScale = width / 480
  const gutter = settings.gutters * styleScale
  const outer = settings.border * styleScale

  images.forEach(({ panel, image, shot }, index) => {
    const motion = panelRevealMotion(panel, index, images.length, progress, settings.videoSpeed, width, panelHeight)
    context.save()
    context.globalAlpha = motion.alpha
    context.translate(motion.x, motion.y)
    drawPanel(context, panel, image, shot, width, panelHeight, outer, gutter, settings, styleScale)
    context.restore()
  })

  const decorationAlpha = easeOutCubic(clamp((progress - 0.56) / 0.24, 0, 1))
  if (decorationAlpha > 0) {
    context.save()
    context.globalAlpha = decorationAlpha
    for (const divider of layout.dividers ?? []) {
      drawDividerGap(context, divider, width, panelHeight, outer, gutter, settings.background)
    }
    context.restore()
  }

  if (settings.caption.trim()) {
    const captionAlpha = easeOutCubic(clamp((progress - 0.74) / 0.2, 0, 1))
    const captionHeight = Math.min(96, panelHeight * 0.18)
    const captionY = panelHeight - captionHeight - outer - gutter / 2 + (1 - captionAlpha) * 42
    context.save()
    context.globalAlpha = captionAlpha
    context.fillStyle = '#ffffff'
    context.fillRect(outer + gutter / 2, captionY, width - outer * 2 - gutter, captionHeight - gutter)
    context.strokeStyle = bezelInk(settings)
    context.lineWidth = Math.max(2, settings.border * styleScale)
    context.strokeRect(outer + gutter / 2, captionY, width - outer * 2 - gutter, captionHeight - gutter)
    context.fillStyle = settings.captionColor
    context.font = `900 ${Math.round(54 * (width / 1080))}px ui-rounded, "Avenir Next", "Segoe UI", sans-serif`
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(settings.caption, width / 2, captionY + captionHeight / 2, width - 96)
    context.restore()
  }

  drawOuterBezel(context, width, panelHeight, outer, settings, !!layout.custom)
}

function panelRevealMotion(
  panel: Panel,
  index: number,
  count: number,
  progress: number,
  speed: number,
  width: number,
  panelHeight: number,
) {
  const start = count <= 1 ? 0 : (index / Math.max(1, count - 1)) * 0.36
  const span = clamp(0.54 / clamp(speed, 0.6, 1.8), 0.3, 0.8)
  const local = easeOutBack(clamp((progress - start) / span, 0, 1))
  const center = panelCentroid(panel)
  const xDirection = center.x < 0.45 ? -1 : center.x > 0.55 ? 1 : index % 2 === 0 ? -1 : 1
  const yDirection = center.y < 0.42 ? -1 : center.y > 0.58 ? 1 : index % 2 === 0 ? -1 : 1
  return {
    x: (1 - local) * xDirection * width * 0.72,
    y: (1 - local) * yDirection * panelHeight * 0.12,
    alpha: clamp(local * 1.15, 0, 1),
  }
}

function bestStoryVideoFormat(): StoryVideoFormat {
  const formats: StoryVideoFormat[] = [
    { mimeType: 'video/mp4;codecs=h264', extension: 'mp4' },
    { mimeType: 'video/webm;codecs=vp9', extension: 'webm' },
    { mimeType: 'video/webm;codecs=vp8', extension: 'webm' },
    { mimeType: 'video/webm', extension: 'webm' },
  ]
  const supported = formats.find((format) => MediaRecorder.isTypeSupported(format.mimeType))
  if (supported) {
    return supported
  }

  return { mimeType: 'video/webm', extension: 'webm' }
}

function drawOuterBezel(
  context: CanvasRenderingContext2D,
  width: number,
  panelHeight: number,
  outer: number,
  settings: Settings,
  force: boolean,
) {
  const lineWidth = force ? Math.max(6, settings.border * 3) : settings.border > 0 ? Math.max(2, settings.border * 2) : 0
  if (lineWidth <= 0) {
    return
  }

  const inset = Math.max(lineWidth / 2, outer + lineWidth / 2)
  context.save()
  context.lineWidth = lineWidth
  context.strokeStyle = force ? bezelInk(settings) : settings.borderColor
  drawRoundedRect(context, inset, inset, width - inset * 2, panelHeight - inset * 2, Math.max(10, settings.radius * 3))
  context.stroke()
  context.restore()
}

function bezelInk(settings: Settings) {
  return settings.borderColor.toLowerCase() === '#ffffff' ? '#111111' : settings.borderColor
}

function easeOutCubic(value: number) {
  return 1 - Math.pow(1 - value, 3)
}

function easeOutBack(value: number) {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(value - 1, 3) + c1 * Math.pow(value - 1, 2)
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string) {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (value) => {
        window.clearTimeout(timeoutId)
        resolve(value)
      },
      (error) => {
        window.clearTimeout(timeoutId)
        reject(error)
      },
    )
  })
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
  styleScale = 3,
) {
  const bounds = panelBounds(panel)
  const x = outer + bounds.x * (width - outer * 2) + gutter / 2
  const y = outer + bounds.y * (panelHeight - outer * 2) + gutter / 2
  const w = bounds.w * (width - outer * 2) - gutter
  const h = bounds.h * (panelHeight - outer * 2) - gutter

  context.save()
  if (panel.points) {
    drawPanelPolygon(context, panel, width, panelHeight, outer)
  } else {
    drawRoundedRect(context, x, y, w, h, settings.radius * styleScale)
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
      drawPanelPolygon(context, panel, width, panelHeight, outer)
    } else {
      drawRoundedRect(context, x, y, w, h, settings.radius * styleScale)
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
) {
  const points = panel.points ?? []
  const canvasPoints = points.map(([px, py]) => [
    outer + (px / 100) * (width - outer * 2),
    outer + (py / 100) * (panelHeight - outer * 2),
  ] as [number, number])
  context.beginPath()
  canvasPoints.forEach(([x, y], index) => {
    index === 0 ? context.moveTo(x, y) : context.lineTo(x, y)
  })
  context.closePath()
}

function drawDividerGap(
  context: CanvasRenderingContext2D,
  line: CustomLine,
  width: number,
  panelHeight: number,
  outer: number,
  gutter: number,
  color: string,
) {
  const innerWidth = width - outer * 2
  const innerHeight = panelHeight - outer * 2
  const x1 = outer + (line.x1 / 100) * innerWidth
  const y1 = outer + (line.y1 / 100) * innerHeight
  const x2 = outer + (line.x2 / 100) * innerWidth
  const y2 = outer + (line.y2 / 100) * innerHeight

  context.save()
  context.strokeStyle = color
  context.lineWidth = gutter
  context.lineCap = 'round'
  context.beginPath()
  context.moveTo(x1, y1)
  context.lineTo(x2, y2)
  context.stroke()
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

function shotImageStyle(panel: Panel, shot: Shot, fit: PanelFit, pageFormat: PageFormat) {
  const bounds = panelPhotoFrameBounds(panel)
  const imageRatio = shot.width && shot.height ? shot.width / shot.height : bounds.w / bounds.h
  const size = imageFitSize(imageRatio, bounds.w, bounds.h, fit, panelCssAspectScale(panel, pageFormat))

  return {
    left: `${(bounds.x + (bounds.w - size.width * shot.scale) / 2 + shot.offsetX * bounds.w) * 100}%`,
    top: `${(bounds.y + (bounds.h - size.height * shot.scale) / 2 + shot.offsetY * bounds.h) * 100}%`,
    width: `${size.width * shot.scale * 100}%`,
    height: `${size.height * shot.scale * 100}%`,
    objectFit: 'fill',
  } as React.CSSProperties
}

function panelCssAspectScale(panel: Panel, pageFormat: PageFormat) {
  const pageAspect = pageFormatCanvasAspect(pageFormat)
  return panel.w > 0 ? (panel.h * pageAspect) / panel.w : pageAspect
}

function photoFrameStyle(panel: Panel, fit: PanelFit) {
  const bounds = panelPhotoFrameBounds(panel)
  return {
    left: `${bounds.x * 100}%`,
    top: `${bounds.y * 100}%`,
    width: `${bounds.w * 100}%`,
    height: `${bounds.h * 100}%`,
    objectFit: fit,
  } as React.CSSProperties
}

function panelPhotoFrameBounds(panel: Panel) {
  return panel.points ? panelBounds(panel) : { x: 0, y: 0, w: 1, h: 1 }
}

function panelPhotoFrameSize(panel: Panel, stripRect: DOMRect) {
  const bounds = panelBounds(panel)
  return {
    frameWidth: Math.max(1, bounds.w * stripRect.width),
    frameHeight: Math.max(1, bounds.h * stripRect.height),
  }
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
  const size = imageFitSize(imageRatio, w, h, fit)
  const drawW = size.width * shot.scale
  const drawH = size.height * shot.scale
  const offsetX = shot.offsetX * w
  const offsetY = shot.offsetY * h
  context.drawImage(image, x + (w - drawW) / 2 + offsetX, y + (h - drawH) / 2 + offsetY, drawW, drawH)
}

function imageFitSize(imageRatio: number, w: number, h: number, fit: PanelFit, yScale = 1) {
  const rectRatio = w / (h * yScale)
  const cover = fit === 'cover'
  const useWidth = cover ? imageRatio < rectRatio : imageRatio > rectRatio
  return {
    width: useWidth ? w : h * yScale * imageRatio,
    height: useWidth ? w / imageRatio / yScale : h,
  }
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

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('A photo could not be loaded.'))
    image.src = src
  })
}

async function captureFullPhoto(stream: MediaStream, video: HTMLVideoElement): Promise<CapturedPhoto> {
  const stillPhoto = await takePhotoFromTrack(stream).catch(() => null)
  return stillPhoto ?? captureVideoFrame(video)
}

async function takePhotoFromTrack(stream: MediaStream): Promise<CapturedPhoto | null> {
  const track = stream.getVideoTracks()[0]
  const ImageCaptureConstructor = (window as typeof window & {
    ImageCapture?: new (track: MediaStreamTrack) => { takePhoto: () => Promise<Blob> }
  }).ImageCapture
  if (!track || !ImageCaptureConstructor) {
    return null
  }

  const blob = await new ImageCaptureConstructor(track).takePhoto()
  const dataUrl = await readBlobAsDataUrl(blob, 'Photo capture failed.')
  const image = await loadImage(dataUrl)
  return {
    dataUrl,
    width: image.naturalWidth || image.width,
    height: image.naturalHeight || image.height,
  }
}

function captureVideoFrame(video: HTMLVideoElement): CapturedPhoto {
  const width = video.videoWidth
  const height = video.videoHeight
  if (width <= 0 || height <= 0) {
    throw new Error('Camera frame is not ready.')
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Canvas is unavailable.')
  }

  context.drawImage(video, 0, 0, width, height)
  return {
    dataUrl: canvas.toDataURL('image/jpeg', 0.92),
    width,
    height,
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return readBlobAsDataUrl(file, 'Photo upload failed.')
}

function readBlobAsDataUrl(blob: Blob, failureMessage: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new Error(failureMessage))
      }
    }
    reader.onerror = () => reject(new Error(failureMessage))
    reader.readAsDataURL(blob)
  })
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
    const x = clamp(50 + offset / 2, 14, 86)
    return { ...base, x1: x, y1: 0, x2: x, y2: 100 }
  }

  if (preset === 'horizontal') {
    const y = clamp(48 + offset / 2, 14, 86)
    return { ...base, x1: 0, y1: y, x2: 100, y2: y }
  }

  return {
    ...base,
    x1: 0,
    y1: clamp(24 + offset, 10, 84),
    x2: 100,
    y2: clamp(74 - offset / 2, 16, 90),
  }
}

function createDefaultDraftLines() {
  return [createDraftLine('vertical', 0), createDraftLine('horizontal', 0)]
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

function snapCustomLine(line: CustomLine, lines: CustomLine[], activeLineId: string, canvasAspect: number): CustomLine {
  const start = snapCustomPoint({ x: line.x1, y: line.y1 }, lines, activeLineId, canvasAspect)
  const end = snapCustomPoint({ x: line.x2, y: line.y2 }, lines, activeLineId, canvasAspect)
  return clampCustomLine({ ...line, x1: start.x, y1: start.y, x2: end.x, y2: end.y })
}

function snapCustomPoint(point: CustomPoint, lines: CustomLine[], activeLineId: string, canvasAspect: number): CustomPoint {
  const target = { x: clamp(point.x, 0, 100), y: clamp(point.y, 0, 100) }
  let snapped = target
  let nearestDistance = CREATOR_SNAP_DISTANCE

  function consider(candidate: CustomPoint) {
    const distance = customPointDistance(target, candidate, canvasAspect)
    if (distance <= nearestDistance) {
      nearestDistance = distance
      snapped = {
        x: clamp(Number(candidate.x.toFixed(2)), 0, 100),
        y: clamp(Number(candidate.y.toFixed(2)), 0, 100),
      }
    }
  }

  consider({ x: 0, y: target.y })
  consider({ x: 100, y: target.y })
  consider({ x: target.x, y: 0 })
  consider({ x: target.x, y: 100 })

  for (const line of lines) {
    if (line.id === activeLineId) {
      continue
    }

    consider({ x: line.x1, y: line.y1 })
    consider({ x: line.x2, y: line.y2 })
    consider(projectPointToLineSegment(target, line, canvasAspect))
  }

  return snapped
}

function projectPointToLineSegment(point: CustomPoint, line: CustomLine, canvasAspect: number): CustomPoint {
  const startX = line.x1
  const startY = line.y1 * canvasAspect
  const endX = line.x2
  const endY = line.y2 * canvasAspect
  const pointX = point.x
  const pointY = point.y * canvasAspect
  const dx = endX - startX
  const dy = endY - startY
  const lengthSquared = dx * dx + dy * dy || 1
  const t = clamp(((pointX - startX) * dx + (pointY - startY) * dy) / lengthSquared, 0, 1)
  return {
    x: startX + dx * t,
    y: (startY + dy * t) / canvasAspect,
  }
}

function customPointDistance(first: CustomPoint, second: CustomPoint, canvasAspect: number) {
  return Math.hypot(first.x - second.x, (first.y - second.y) * canvasAspect)
}

function lineSegmentStyle(line: CustomLine, canvasAspect: number) {
  const dx = line.x2 - line.x1
  const dy = (line.y2 - line.y1) * canvasAspect
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

function nearestLineToPoint(lines: CustomLine[], x: number, y: number, canvasAspect: number) {
  let nearest: CustomLine | null = null
  let nearestDistance = Number.POSITIVE_INFINITY

  for (const line of lines) {
    const distance = lineDistanceToPoint(line, x, y, canvasAspect)
    if (distance < nearestDistance) {
      nearest = line
      nearestDistance = distance
    }
  }

  return nearest
}

function lineDistanceToPoint(line: CustomLine, x: number, y: number, canvasAspect: number) {
  const pointX = x
  const pointY = y * canvasAspect
  const startX = line.x1
  const startY = line.y1 * canvasAspect
  const endX = line.x2
  const endY = line.y2 * canvasAspect
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
  canvasAspect: number,
) {
  const centerX = (line.x1 + line.x2) / 2
  const centerY = ((line.y1 + line.y2) / 2) * canvasAspect
  const moveX = currentCenterX - startCenterX
  const moveY = (currentCenterY - startCenterY) * canvasAspect
  const radians = (rotationDegrees * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)

  function point(x: number, y: number) {
    const dx = x - centerX
    const dy = y * canvasAspect - centerY
    return {
      x: centerX + (dx * cos - dy * sin) * scale + moveX,
      y: (centerY + (dx * sin + dy * cos) * scale + moveY) / canvasAspect,
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
      if (!lineSegmentSplitsPolygon(polygon, line)) {
        nextPolygons.push(polygon)
        continue
      }

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

function lineSegmentSplitsPolygon(polygon: Array<[number, number]>, line: CustomLine) {
  const boundaryPoints = segmentPolygonBoundaryPoints(polygon, line).sort(
    (first, second) => lineSegmentPosition(first, line) - lineSegmentPosition(second, line),
  )
  if (boundaryPoints.length < 2) {
    return false
  }

  for (let index = 1; index < boundaryPoints.length; index += 1) {
    const first = boundaryPoints[index - 1]
    const second = boundaryPoints[index]
    if (Math.hypot(first[0] - second[0], first[1] - second[1]) < 0.5) {
      continue
    }

    const midpoint: [number, number] = [(first[0] + second[0]) / 2, (first[1] + second[1]) / 2]
    if (pointInPolygon(midpoint, polygon)) {
      return true
    }
  }

  return false
}

function segmentPolygonBoundaryPoints(polygon: Array<[number, number]>, line: CustomLine) {
  const points: Array<[number, number]> = []
  const start: [number, number] = [line.x1, line.y1]
  const end: [number, number] = [line.x2, line.y2]

  if (pointOnPolygonBoundary(start, polygon)) {
    points.push(start)
  }
  if (pointOnPolygonBoundary(end, polygon)) {
    points.push(end)
  }

  for (let index = 0; index < polygon.length; index += 1) {
    const edgeStart = polygon[index]
    const edgeEnd = polygon[(index + 1) % polygon.length]
    const intersection = segmentIntersectionPoint(start, end, edgeStart, edgeEnd)
    if (intersection) {
      points.push(intersection)
    }
  }

  return uniquePoints(points)
}

function segmentIntersectionPoint(
  firstStart: [number, number],
  firstEnd: [number, number],
  secondStart: [number, number],
  secondEnd: [number, number],
): [number, number] | null {
  const firstDx = firstEnd[0] - firstStart[0]
  const firstDy = firstEnd[1] - firstStart[1]
  const secondDx = secondEnd[0] - secondStart[0]
  const secondDy = secondEnd[1] - secondStart[1]
  const denominator = firstDx * secondDy - firstDy * secondDx
  const epsilon = 0.0001

  if (Math.abs(denominator) < epsilon) {
    const candidates = [firstStart, firstEnd, secondStart, secondEnd].filter(
      (point) => pointOnSegment(point, firstStart, firstEnd) && pointOnSegment(point, secondStart, secondEnd),
    )
    return candidates[0] ?? null
  }

  const deltaX = secondStart[0] - firstStart[0]
  const deltaY = secondStart[1] - firstStart[1]
  const firstPosition = (deltaX * secondDy - deltaY * secondDx) / denominator
  const secondPosition = (deltaX * firstDy - deltaY * firstDx) / denominator
  if (firstPosition < -epsilon || firstPosition > 1 + epsilon || secondPosition < -epsilon || secondPosition > 1 + epsilon) {
    return null
  }

  return [firstStart[0] + firstDx * firstPosition, firstStart[1] + firstDy * firstPosition]
}

function pointOnPolygonBoundary(point: [number, number], polygon: Array<[number, number]>) {
  return polygon.some((start, index) => pointOnSegment(point, start, polygon[(index + 1) % polygon.length]))
}

function pointOnSegment(point: [number, number], start: [number, number], end: [number, number]) {
  const distance = Math.hypot(end[0] - start[0], end[1] - start[1]) || 1
  const cross = Math.abs((point[1] - start[1]) * (end[0] - start[0]) - (point[0] - start[0]) * (end[1] - start[1]))
  const dot = (point[0] - start[0]) * (end[0] - start[0]) + (point[1] - start[1]) * (end[1] - start[1])
  return cross / distance < 0.08 && dot >= -0.08 && dot <= distance * distance + 0.08
}

function lineSegmentPosition(point: [number, number], line: CustomLine) {
  const dx = line.x2 - line.x1
  const dy = line.y2 - line.y1
  const lengthSquared = dx * dx + dy * dy || 1
  return ((point[0] - line.x1) * dx + (point[1] - line.y1) * dy) / lengthSquared
}

function pointInPolygon(point: [number, number], polygon: Array<[number, number]>) {
  if (pointOnPolygonBoundary(point, polygon)) {
    return true
  }

  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const [xi, yi] = polygon[index]
    const [xj, yj] = polygon[previous]
    const crosses = yi > point[1] !== yj > point[1] && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi
    if (crosses) {
      inside = !inside
    }
  }

  return inside
}

function uniquePoints(points: Array<[number, number]>) {
  const unique: Array<[number, number]> = []
  for (const point of points) {
    if (!unique.some((item) => Math.hypot(item[0] - point[0], item[1] - point[1]) < 0.1)) {
      unique.push(point)
    }
  }
  return unique
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
