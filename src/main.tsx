import { AnimatePresence, MotionConfig, motion, useDragControls } from 'framer-motion'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent, TouchEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { useContentAspect, useDialogFocus, useDraftHistory } from './editor-hooks'
import { cutAt, cutControls, cutPaintSpan, extendCut } from './grid-geometry'
import {
  clearDraftData,
  loadDraftAssets,
  loadDraftRecord,
  saveDraftRecord,
  type DraftAssetRecord,
  type DraftRecord,
} from './draft-store'
import './studio.css'
import { ActionIcon, ToolIcon, Brand, SettingsSection, RangeField, ColorField } from './ui'

type PanelFit = 'cover' | 'contain'
type DrawerTab = 'layout' | 'style' | 'export'
type CustomLinePreset = 'diagonal' | 'vertical' | 'horizontal'
type PageFormatId = '4:5' | '3:4' | '4:3' | '9:16'

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
  borderColor?: string
  borderThickness?: number
  dividers?: CustomLine[]
  panelOrder?: 'reading'
}

type Shot = {
  assetId: string
  dataUrl: string
  width?: number
  height?: number
  offsetX: number
  offsetY: number
  scale: number
  rotation: number
  fit?: PanelFit
}

type CapturedPhoto = {
  blob: Blob
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
  extension: 'mp4'
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
  extent?: 'canvas'
  x1: number
  y1: number
  x2: number
  y2: number
}

type GridDraft = {
  name: string
  lines: CustomLine[]
  thickness: number
  borderColor: string
  borderThickness: number
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
  rotation: number
  frameWidth: number
  frameHeight: number
  startDistance?: number
  startAngle?: number
}

type ProjectSnapshot = {
  layout: Layout
  pageFormatId: PageFormatId
  settings: Settings
  shotCache: Array<Shot | null>
  activePanelId: string | null
}

type StoredShot = Omit<Shot, 'dataUrl'>

type StoredProjectDocument = Omit<ProjectSnapshot, 'shotCache'> & {
  shotCache: Array<StoredShot | null>
}

type StoredProjectDraft = DraftRecord<StoredProjectDocument>

type HistoryEntry = {
  label: string
  snapshot: ProjectSnapshot
}

type DraftPhase = 'checking' | 'available' | 'none' | 'saving' | 'saved' | 'error'

type RotationSnap = {
  panelId: string
  angle: number
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

function createShot(assetId: string, dataUrl: string, width?: number, height?: number): Shot {
  return {
    assetId,
    dataUrl,
    width,
    height,
    offsetX: 0,
    offsetY: 0,
    scale: 1,
    rotation: 0,
  }
}

function normalizeShot(shot: Shot): Shot {
  const scale = clamp(shot.scale, 0.65, 4)
  return {
    ...shot,
    scale,
    rotation: normalizeAngle(shot.rotation),
    offsetX: clamp(shot.offsetX, -0.65 * scale, 0.65 * scale),
    offsetY: clamp(shot.offsetY, -0.65 * scale, 0.65 * scale),
  }
}

function cloneShot(shot: Shot): Shot {
  return { ...shot }
}

function cloneLayout(layout: Layout): Layout {
  return {
    ...layout,
    panels: layout.panels.map((panel) => ({
      ...panel,
      points: panel.points?.map(([x, y]) => [x, y] as [number, number]),
    })),
    dividers: layout.dividers?.map((divider) => ({ ...divider })),
  }
}

function cloneProjectSnapshot(snapshot: ProjectSnapshot): ProjectSnapshot {
  return {
    layout: cloneLayout(snapshot.layout),
    pageFormatId: snapshot.pageFormatId,
    settings: { ...snapshot.settings },
    shotCache: snapshot.shotCache.map((shot) => (shot ? cloneShot(shot) : null)),
    activePanelId: snapshot.activePanelId,
  }
}

function mergeLayoutShotsIntoCache(layout: Layout, shots: Record<string, Shot>, cache: Array<Shot | undefined>) {
  const next = [...cache]
  layout.panels.forEach((panel, index) => {
    const shot = shots[panel.id]
    if (shot) {
      next[index] = shot
    }
  })
  return next
}

function putShotInCache(layout: Layout, shots: Record<string, Shot>, cache: Array<Shot | undefined>, panelId: string, shot: Shot) {
  const next = mergeLayoutShotsIntoCache(layout, shots, cache)
  const index = layout.panels.findIndex((panel) => panel.id === panelId)
  if (index >= 0) {
    next[index] = shot
  }
  return next
}

function shotsForLayout(layout: Layout, cache: Array<Shot | undefined>) {
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
const DEFAULT_CUSTOM_GRID_BORDER_COLOR = '#111111'
const DEFAULT_CUSTOM_GRID_BORDER_THICKNESS = 2

const pageFormats: PageFormat[] = [
  { id: '4:5', label: 'Post', detail: 'Instagram portrait', width: 4, height: 5 },
  { id: '3:4', label: 'Tall', detail: 'Classic portrait', width: 3, height: 4 },
  { id: '4:3', label: 'Wide', detail: 'Landscape canvas', width: 4, height: 3 },
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

function layoutBorderThickness(layout: Layout) {
  if (typeof layout.borderThickness === 'number' && Number.isFinite(layout.borderThickness)) {
    return clamp(Math.round(layout.borderThickness), 0, 10)
  }

  return layout.custom ? DEFAULT_CUSTOM_GRID_BORDER_THICKNESS : null
}

function layoutBorderColor(layout: Layout) {
  if (typeof layout.borderColor === 'string' && /^#[0-9a-f]{6}$/i.test(layout.borderColor)) {
    return layout.borderColor
  }

  return layout.custom ? DEFAULT_CUSTOM_GRID_BORDER_COLOR : null
}

function layoutStyleSettings(layout: Layout): Partial<Settings> {
  const gutters = layoutDividerThickness(layout)
  const border = layoutBorderThickness(layout)
  const borderColor = layoutBorderColor(layout)
  return {
    ...(gutters !== null ? { gutters } : {}),
    ...(border !== null ? { border } : {}),
    ...(borderColor !== null ? { borderColor } : {}),
  }
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
  gutters: 6,
  radius: 0,
  border: 2,
  background: '#ffffff',
  borderColor: '#1c1c1e',
  caption: '',
  captionColor: '#111111',
  fit: 'cover',
  videoDuration: 6,
  videoSpeed: 1,
}

const CUSTOM_LAYOUT_KEY = 'instacomic.customLayouts.v1'
const ACTIVE_LAYOUT_KEY = 'instacomic.activeLayout.v1'
const PAGE_FORMAT_KEY = 'instacomic.pageFormat.v1'
const HISTORY_LIMIT = 24
const AUTOSAVE_DELAY_MS = 420
const ROTATION_SNAP_ENTER_DEGREES = 4
const ROTATION_SNAP_RELEASE_DEGREES = 8

function isValidStoredProjectDraft(value: DraftRecord<StoredProjectDocument>): value is StoredProjectDraft {
  const document = value?.document
  const validNumber = (candidate: unknown) => typeof candidate === 'number' && Number.isFinite(candidate)
  const validPoint = (candidate: unknown) =>
    Array.isArray(candidate) && candidate.length === 2 && candidate.every((coordinate) => validNumber(coordinate))
  const validLine = (candidate: unknown) => {
    const line = candidate as Partial<CustomLine> | null
    return (
      !!line &&
      typeof line.id === 'string' &&
      line.id.length > 0 &&
      validNumber(line.x1) &&
      validNumber(line.y1) &&
      validNumber(line.x2) &&
      validNumber(line.y2)
    )
  }
  const validPanel = (candidate: unknown) => {
    const panel = candidate as Partial<Panel> | null
    return (
      !!panel &&
      typeof panel.id === 'string' &&
      panel.id.length > 0 &&
      validNumber(panel.x) &&
      validNumber(panel.y) &&
      validNumber(panel.w) &&
      validNumber(panel.h) &&
      Number(panel.w) > 0 &&
      Number(panel.h) > 0 &&
      (panel.points === undefined || (Array.isArray(panel.points) && panel.points.length >= 3 && panel.points.every(validPoint)))
    )
  }
  const validShot = (candidate: unknown) => {
    if (candidate === null) {
      return true
    }
    const shot = candidate as Partial<StoredShot> | null
    return (
      !!shot &&
      typeof shot.assetId === 'string' &&
      shot.assetId.length > 0 &&
      (shot.width === undefined || (validNumber(shot.width) && Number(shot.width) > 0)) &&
      (shot.height === undefined || (validNumber(shot.height) && Number(shot.height) > 0)) &&
      validNumber(shot.offsetX) &&
      validNumber(shot.offsetY) &&
      validNumber(shot.scale) &&
      Number(shot.scale) > 0 &&
      validNumber(shot.rotation) &&
      (shot.fit === undefined || shot.fit === 'cover' || shot.fit === 'contain')
    )
  }
  const settings = document?.settings as Partial<Settings> | undefined
  const panelIds = Array.isArray(document?.layout?.panels)
    ? document.layout.panels.map((panel) => panel?.id)
    : []
  return (
    value.schemaVersion === 1 &&
    Number.isFinite(value.revision) &&
    Number.isFinite(value.updatedAt) &&
    !!document &&
    typeof document.layout?.id === 'string' &&
    document.layout.id.length > 0 &&
    typeof document.layout?.name === 'string' &&
    document.layout.name.length > 0 &&
    Array.isArray(document.layout?.panels) &&
    document.layout.panels.length > 0 &&
    document.layout.panels.every(validPanel) &&
    new Set(panelIds).size === panelIds.length &&
    (document.layout.dividerThickness === undefined || validNumber(document.layout.dividerThickness)) &&
    (document.layout.borderThickness === undefined || validNumber(document.layout.borderThickness)) &&
    (document.layout.borderColor === undefined || typeof document.layout.borderColor === 'string') &&
    (document.layout.dividers === undefined || (Array.isArray(document.layout.dividers) && document.layout.dividers.every(validLine))) &&
    Array.isArray(document.shotCache) &&
    document.shotCache.every(validShot) &&
    !!settings &&
    validNumber(settings.gutters) &&
    validNumber(settings.radius) &&
    validNumber(settings.border) &&
    typeof settings.background === 'string' &&
    typeof settings.borderColor === 'string' &&
    typeof settings.caption === 'string' &&
    typeof settings.captionColor === 'string' &&
    (settings.fit === 'cover' || settings.fit === 'contain') &&
    validNumber(settings.videoDuration) &&
    validNumber(settings.videoSpeed) &&
    (document.activePanelId === null || typeof document.activePanelId === 'string') &&
    pageFormats.some((format) => format.id === document.pageFormatId)
  )
}

function createAssetId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `asset-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

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
  const [imageExporting, setImageExporting] = useState(false)
  const [photoProcessing, setPhotoProcessing] = useState(false)
  const [videoRendering, setVideoRendering] = useState(false)
  const [videoProgress, setVideoProgress] = useState(0)
  const [videoProgressPhase, setVideoProgressPhase] = useState<StoryVideoRenderPhase>('rendering')
  const [readyVideo, setReadyVideo] = useState<ReadyStoryVideo | null>(null)
  const [photoDragState, setPhotoDragState] = useState<PhotoDragState | null>(null)
  const [customLayouts, setCustomLayouts] = useState<Layout[]>([])
  const [draftLines, setDraftLines] = useState<CustomLine[]>(() => createDefaultDraftLines())
  const [draftName, setDraftName] = useState('')
  const [draftThickness, setDraftThickness] = useState(0)
  const [draftBorderColor, setDraftBorderColor] = useState(DEFAULT_CUSTOM_GRID_BORDER_COLOR)
  const [draftBorderThickness, setDraftBorderThickness] = useState(DEFAULT_CUSTOM_GRID_BORDER_THICKNESS)
  const [editingLayoutId, setEditingLayoutId] = useState<string | null>(null)
  const [creatorOpen, setCreatorOpen] = useState(false)
  const [creatorDirty, setCreatorDirty] = useState(false)
  const [creatorDiscardConfirmOpen, setCreatorDiscardConfirmOpen] = useState(false)
  const [appContext, setAppContext] = useState<AppContext>(() => getAppContext())
  const [storageReady, setStorageReady] = useState(false)
  const [savedDraft, setSavedDraft] = useState<StoredProjectDraft | null>(null)
  const [draftPhase, setDraftPhase] = useState<DraftPhase>('checking')
  const [newProjectRequested, setNewProjectRequested] = useState(() => new URLSearchParams(window.location.search).has('new'))
  const [historyCounts, setHistoryCounts] = useState({ undo: 0, redo: 0 })
  const [rotationSnap, setRotationSnap] = useState<RotationSnap | null>(null)
  const [photoActionsDeferred, setPhotoActionsDeferred] = useState(false)
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const shellRef = useRef<HTMLElement>(null)
  const creatorRef = useRef<HTMLElement>(null)
  const discardRef = useRef<HTMLElement>(null)
  const cameraRequestRef = useRef(0)
  const videoRef = useRef<HTMLVideoElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const shotCacheRef = useRef<Array<Shot | undefined>>([])
  const assetBlobsRef = useRef<Map<string, DraftAssetRecord>>(new Map())
  const assetUrlsRef = useRef<Map<string, string>>(new Map())
  const assetPruneScheduledRef = useRef(false)
  const undoStackRef = useRef<HistoryEntry[]>([])
  const redoStackRef = useRef<HistoryEntry[]>([])
  const gestureHistoryRef = useRef<HistoryEntry | null>(null)
  const pendingSettingsHistoryRef = useRef<HistoryEntry | null>(null)
  const settingsHistoryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const draftSaveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const draftRevisionRef = useRef(0)
  const draftEpochRef = useRef(0)
  const draftSessionReadyRef = useRef(false)
  const emptyDraftClearedRef = useRef(false)
  const lastSavedDocumentSignatureRef = useRef<string | null>(null)
  const editorVersionRef = useRef(0)
  const replacePanelIdRef = useRef<string | null>(null)
  const lastSnapAngleRef = useRef<number | null>(null)
  const readyVideoUrlRef = useRef<string | null>(null)
  const startRequestedRef = useRef(false)
  const photoOperationCountRef = useRef(0)
  const imageExportingRef = useRef(false)
  const dragControls = useDragControls()

  const allLayouts = useMemo(() => [...layouts, ...customLayouts], [customLayouts])
  const activePanelIndex = activePanelId ? layout.panels.findIndex((panel) => panel.id === activePanelId) : -1
  const capturedCount = layout.panels.filter((panel) => shots[panel.id]).length
  const selectedShot = activePanelId ? shots[activePanelId] ?? null : null
  const selectedShotFit = selectedShot?.fit ?? settings.fit
  const showPhotoActions = !!selectedShot && !photoActionsDeferred && !drawerOpen && !creatorOpen && !videoRendering && !readyVideo
  const savedDraftPhotoCount = savedDraft?.document.shotCache.filter(Boolean).length ?? 0
  const pageStyle = {
    '--page-width': pageFormat.width,
    '--page-height': pageFormat.height,
  } as React.CSSProperties
  const creatorCanvasAspect = pageFormatCanvasAspect(pageFormat)
  const liveCanvasAspect = useContentAspect(stripRef, creatorCanvasAspect)
  useDialogFocus(creatorRef, creatorOpen, '[aria-label="Controls"]')
  useDialogFocus(discardRef, creatorDiscardConfirmOpen, '[aria-label="Close creator"]')

  useEffect(() => {
    function dismissOverlay(event: KeyboardEvent) {
      if (event.key !== 'Escape') {
        return
      }
      if (creatorDiscardConfirmOpen) {
        setCreatorDiscardConfirmOpen(false)
      } else if (creatorOpen) {
        closeCreator()
      } else if (drawerOpen) {
        setDrawerOpen(false)
      } else if (showPhotoActions) {
        setPhotoActionsDeferred(true)
      }
    }

    window.addEventListener('keydown', dismissOverlay)
    return () => window.removeEventListener('keydown', dismissOverlay)
  }, [creatorDiscardConfirmOpen, creatorOpen, drawerOpen, showPhotoActions])

  useEffect(() => {
    editorVersionRef.current += 1
  }, [activePanelId, layout, pageFormat.id, settings, shots])

  function captureProjectSnapshot(): ProjectSnapshot {
    return {
      layout: cloneLayout(layout),
      pageFormatId: pageFormat.id,
      settings: { ...settings },
      shotCache: shotCacheRef.current.map((shot) => (shot ? cloneShot(shot) : null)),
      activePanelId,
    }
  }

  function syncHistoryCounts() {
    setHistoryCounts({
      undo: undoStackRef.current.length,
      redo: redoStackRef.current.length,
    })
  }

  function commitHistoryEntry(entry: HistoryEntry | null) {
    if (!entry) {
      return
    }

    undoStackRef.current = [...undoStackRef.current.slice(-(HISTORY_LIMIT - 1)), entry]
    redoStackRef.current = []
    syncHistoryCounts()
    scheduleRuntimeAssetPrune()
  }

  function beginHistoryEntry(label: string) {
    return {
      label,
      snapshot: captureProjectSnapshot(),
    }
  }

  function flushPendingSettingsHistory() {
    if (settingsHistoryTimerRef.current) {
      clearTimeout(settingsHistoryTimerRef.current)
      settingsHistoryTimerRef.current = null
    }
    if (pendingSettingsHistoryRef.current) {
      commitHistoryEntry(pendingSettingsHistoryRef.current)
      pendingSettingsHistoryRef.current = null
    }
  }

  function resetHistory() {
    undoStackRef.current = []
    redoStackRef.current = []
    gestureHistoryRef.current = null
    pendingSettingsHistoryRef.current = null
    if (settingsHistoryTimerRef.current) {
      clearTimeout(settingsHistoryTimerRef.current)
      settingsHistoryTimerRef.current = null
    }
    syncHistoryCounts()
    scheduleRuntimeAssetPrune()
  }

  function restoreProjectSnapshot(snapshot: ProjectSnapshot) {
    const nextSnapshot = cloneProjectSnapshot(snapshot)
    const nextCache = nextSnapshot.shotCache.map((shot) => shot ?? undefined)
    shotCacheRef.current = nextCache
    setLayout(nextSnapshot.layout)
    setPageFormat(getPageFormat(nextSnapshot.pageFormatId))
    setSettings(nextSnapshot.settings)
    setShots(shotsForLayout(nextSnapshot.layout, nextCache))
    setActivePanelId(
      nextSnapshot.activePanelId && nextSnapshot.layout.panels.some((panel) => panel.id === nextSnapshot.activePanelId)
        ? nextSnapshot.activePanelId
        : nextOpenPanelId(nextSnapshot.layout, shotsForLayout(nextSnapshot.layout, nextCache)),
    )
    clearExport()
  }

  function undoEditorAction() {
    flushPendingSettingsHistory()
    const entry = undoStackRef.current.at(-1)
    if (!entry) {
      return
    }

    undoStackRef.current = undoStackRef.current.slice(0, -1)
    redoStackRef.current = [
      ...redoStackRef.current.slice(-(HISTORY_LIMIT - 1)),
      { label: entry.label, snapshot: captureProjectSnapshot() },
    ]
    restoreProjectSnapshot(entry.snapshot)
    setStatus(`Undid ${entry.label.toLowerCase()}.`)
    syncHistoryCounts()
    scheduleRuntimeAssetPrune()
  }

  function redoEditorAction() {
    flushPendingSettingsHistory()
    const entry = redoStackRef.current.at(-1)
    if (!entry) {
      return
    }

    redoStackRef.current = redoStackRef.current.slice(0, -1)
    undoStackRef.current = [
      ...undoStackRef.current.slice(-(HISTORY_LIMIT - 1)),
      { label: entry.label, snapshot: captureProjectSnapshot() },
    ]
    restoreProjectSnapshot(entry.snapshot)
    setStatus(`Redid ${entry.label.toLowerCase()}.`)
    syncHistoryCounts()
    scheduleRuntimeAssetPrune()
  }

  function registerDraftAsset(asset: DraftAssetRecord) {
    const existingUrl = assetUrlsRef.current.get(asset.id)
    if (existingUrl) {
      URL.revokeObjectURL(existingUrl)
    }
    const dataUrl = URL.createObjectURL(asset.blob)
    assetBlobsRef.current.set(asset.id, asset)
    assetUrlsRef.current.set(asset.id, dataUrl)
    return dataUrl
  }

  function createAssetShot(blob: Blob, width: number, height: number) {
    const asset: DraftAssetRecord = {
      id: createAssetId(),
      blob,
      width,
      height,
      createdAt: Date.now(),
    }
    return createShot(asset.id, registerDraftAsset(asset), width, height)
  }

  function referencedRuntimeAssetIds() {
    const assetIds = new Set(
      shotCacheRef.current.flatMap((shot) => (shot ? [shot.assetId] : [])),
    )
    const historyEntries = [
      ...undoStackRef.current,
      ...redoStackRef.current,
      ...(gestureHistoryRef.current ? [gestureHistoryRef.current] : []),
      ...(pendingSettingsHistoryRef.current ? [pendingSettingsHistoryRef.current] : []),
    ]
    historyEntries.forEach((entry) => {
      entry.snapshot.shotCache.forEach((shot) => {
        if (shot) {
          assetIds.add(shot.assetId)
        }
      })
    })
    return assetIds
  }

  function pruneRuntimeAssets() {
    const referencedAssetIds = referencedRuntimeAssetIds()
    assetBlobsRef.current.forEach((_asset, assetId) => {
      if (referencedAssetIds.has(assetId)) {
        return
      }
      const dataUrl = assetUrlsRef.current.get(assetId)
      if (dataUrl) {
        URL.revokeObjectURL(dataUrl)
      }
      assetUrlsRef.current.delete(assetId)
      assetBlobsRef.current.delete(assetId)
    })
  }

  function scheduleRuntimeAssetPrune() {
    if (assetPruneScheduledRef.current) {
      return
    }
    assetPruneScheduledRef.current = true
    queueMicrotask(() => {
      assetPruneScheduledRef.current = false
      pruneRuntimeAssets()
    })
  }

  function serializeProjectSnapshot(snapshot: ProjectSnapshot): StoredProjectDocument {
    return {
      layout: cloneLayout(snapshot.layout),
      pageFormatId: snapshot.pageFormatId,
      settings: { ...snapshot.settings },
      activePanelId: snapshot.activePanelId,
      shotCache: snapshot.shotCache.map((shot) => {
        if (!shot) {
          return null
        }
        const { dataUrl: _dataUrl, ...storedShot } = shot
        return storedShot
      }),
    }
  }

  async function hydrateStoredDraft(draft: StoredProjectDraft) {
    const assetIds = draft.document.shotCache.flatMap((shot) => (shot ? [shot.assetId] : []))
    const assets = await loadDraftAssets(assetIds)
    const missingAsset = assetIds.find((assetId) => !assets.has(assetId))
    if (missingAsset) {
      throw new Error('A saved draft photo is unavailable.')
    }

    assets.forEach((asset) => {
      registerDraftAsset(asset)
    })

    const snapshot: ProjectSnapshot = {
      layout: cloneLayout(draft.document.layout),
      pageFormatId: draft.document.pageFormatId,
      settings: { ...draft.document.settings },
      activePanelId: draft.document.activePanelId,
      shotCache: draft.document.shotCache.map((shot) => {
        if (!shot) {
          return null
        }
        const dataUrl = assetUrlsRef.current.get(shot.assetId)
        return dataUrl ? { ...shot, dataUrl } : null
      }),
    }
    return snapshot
  }

  function queueDraftSave(snapshot: ProjectSnapshot) {
    const epoch = draftEpochRef.current
    const document = serializeProjectSnapshot(snapshot)
    const documentSignature = JSON.stringify(document)
    if (documentSignature === lastSavedDocumentSignatureRef.current) {
      return
    }
    const revision = draftRevisionRef.current + 1
    draftRevisionRef.current = revision
    const record: StoredProjectDraft = {
      id: 'current',
      schemaVersion: 1,
      revision,
      updatedAt: Date.now(),
      document,
    }
    const assetIds = new Set(record.document.shotCache.flatMap((shot) => (shot ? [shot.assetId] : [])))
    const assets = [...assetIds]
      .map((assetId) => assetBlobsRef.current.get(assetId))
      .filter((asset): asset is DraftAssetRecord => !!asset)

    if (assets.length !== assetIds.size) {
      setDraftPhase('error')
      setStatus('Draft not saved because a photo is unavailable. Editing still works on this device.')
      return
    }

    setDraftPhase('saving')
    draftSaveQueueRef.current = draftSaveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        if (epoch !== draftEpochRef.current || revision < draftRevisionRef.current) {
          return
        }
        await saveDraftRecord(record, assets)
        if (epoch !== draftEpochRef.current || revision < draftRevisionRef.current) {
          return
        }
        setSavedDraft(record)
        lastSavedDocumentSignatureRef.current = documentSignature
        setDraftPhase('saved')
      })
      .catch((error) => {
        console.error('Draft autosave failed:', error)
        setDraftPhase('error')
        setStatus('Draft not saved. Editing still works on this device.')
      })
  }

  function queueDraftClear(options: { onlyIfProjectEmpty?: boolean } = {}) {
    const epoch = draftEpochRef.current + 1
    draftEpochRef.current = epoch
    draftRevisionRef.current += 1
    const requestedEditorVersion = editorVersionRef.current
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = null
    }

    const clearJob = draftSaveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        if (epoch !== draftEpochRef.current) {
          return false
        }
        if (
          options.onlyIfProjectEmpty &&
          (editorVersionRef.current !== requestedEditorVersion || shotCacheRef.current.some(Boolean))
        ) {
          return false
        }
        await clearDraftData()
        if (epoch !== draftEpochRef.current) {
          return false
        }
        setSavedDraft(null)
        lastSavedDocumentSignatureRef.current = null
        setDraftPhase('none')
        return true
      })
    draftSaveQueueRef.current = clearJob.then(() => undefined)
    return clearJob
  }

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
      if (restoredLayout) {
        setSettings((current) => ({ ...current, ...layoutStyleSettings(restoredLayout) }))
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
    let active = true

    void loadDraftRecord<StoredProjectDocument>()
      .then(async (draft) => {
        if (!active) {
          return
        }
        if (draft && isValidStoredProjectDraft(draft) && draft.document.shotCache.some(Boolean)) {
          draftRevisionRef.current = draft.revision
          lastSavedDocumentSignatureRef.current = JSON.stringify(draft.document)
          setSavedDraft(draft)
          setDraftPhase('available')
          return
        }

        if (draft) {
          await clearDraftData()
          if (!active) {
            return
          }
        }

        draftSessionReadyRef.current = true
        setDraftPhase('none')
      })
      .catch((error) => {
        console.error('Draft recovery check failed:', error)
        if (active) {
          draftSessionReadyRef.current = true
          setDraftPhase('error')
        }
      })

    return () => {
      active = false
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
    if (!started || !draftSessionReadyRef.current || draftPhase === 'checking' || draftPhase === 'available') {
      return
    }

    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current)
    }

    const snapshot = captureProjectSnapshot()
    if (!snapshot.shotCache.some(Boolean)) {
      if (emptyDraftClearedRef.current) {
        return
      }
      emptyDraftClearedRef.current = true
      void queueDraftClear({ onlyIfProjectEmpty: true }).catch((error) => {
        console.error('Draft clear failed:', error)
        emptyDraftClearedRef.current = false
        setDraftPhase('error')
        setStatus('Draft could not be cleared. Your previous saved work is still available.')
      })
      return
    }
    emptyDraftClearedRef.current = false

    autosaveTimerRef.current = setTimeout(() => {
      queueDraftSave(snapshot)
    }, AUTOSAVE_DELAY_MS)

    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current)
        autosaveTimerRef.current = null
      }
    }
  }, [activePanelId, draftPhase, layout, pageFormat.id, settings, shots, started])

  useEffect(() => {
    if (!started) {
      return
    }

    const flushPendingDraft = () => {
      if (!draftSessionReadyRef.current) {
        return
      }
      const snapshot = captureProjectSnapshot()
      if (!snapshot.shotCache.some(Boolean)) {
        return
      }
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current)
        autosaveTimerRef.current = null
      }
      queueDraftSave(snapshot)
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushPendingDraft()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('pagehide', flushPendingDraft)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('pagehide', flushPendingDraft)
    }
  }, [activePanelId, layout, pageFormat.id, settings, shots, started])

  useEffect(() => {
    const handleHistoryShortcut = (event: KeyboardEvent) => {
      if (!started || creatorOpen || (!event.ctrlKey && !event.metaKey)) {
        return
      }
      const target = event.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return
      }

      const key = event.key.toLowerCase()
      if (key === 'z' && event.shiftKey) {
        event.preventDefault()
        redoEditorAction()
      } else if (key === 'z') {
        event.preventDefault()
        undoEditorAction()
      } else if (key === 'y') {
        event.preventDefault()
        redoEditorAction()
      }
    }

    window.addEventListener('keydown', handleHistoryShortcut)
    return () => window.removeEventListener('keydown', handleHistoryShortcut)
  }, [creatorOpen, historyCounts, started])

  useEffect(() => {
    return () => {
      if (settingsHistoryTimerRef.current) {
        clearTimeout(settingsHistoryTimerRef.current)
      }
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current)
      }
      assetUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
      assetUrlsRef.current.clear()
    }
  }, [])

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

  async function prepareAppSurface() {
    if (!appContext.isInstalled) {
      return
    }
    await requestAppFullscreen()
    await lockPortraitOrientation()
  }

  async function enterApp() {
    await prepareAppSurface()
    setStarted(true)
    setStatus('Starting camera…')
    void startCamera()
  }

  function returnHome() {
    cameraRequestRef.current += 1
    flushPendingSettingsHistory()
    const snapshot = captureProjectSnapshot()
    if (draftSessionReadyRef.current && snapshot.shotCache.some(Boolean)) {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current)
        autosaveTimerRef.current = null
      }
      queueDraftSave(snapshot)
    }
    stream?.getTracks().forEach((track) => track.stop())
    setStream(null)
    setDrawerOpen(false)
    setCreatorOpen(false)
    setPhotoActionsDeferred(true)
    setNewProjectRequested(false)
    setStarted(false)
    startRequestedRef.current = false
  }

  function selectPageFormat(format: PageFormat) {
    if (format.id === pageFormat.id) {
      return
    }
    if (started) {
      flushPendingSettingsHistory()
      commitHistoryEntry(beginHistoryEntry('Change canvas format'))
    }
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

  function continueDraftFromGesture() {
    if (startRequestedRef.current || !savedDraft) {
      return
    }

    startRequestedRef.current = true
    void (async () => {
      await prepareAppSurface()
      setDraftPhase('checking')
      try {
        const snapshot = await hydrateStoredDraft(savedDraft)
        restoreProjectSnapshot(snapshot)
        resetHistory()
        draftSessionReadyRef.current = true
        setDraftPhase('saved')
        setStarted(true)
        setStatus(`Continued ${snapshot.layout.name} with ${snapshot.shotCache.filter(Boolean).length} saved photo${snapshot.shotCache.filter(Boolean).length === 1 ? '' : 's'}.`)
        const resumedPanelIndex = snapshot.layout.panels.findIndex((panel) => panel.id === snapshot.activePanelId)
        if (resumedPanelIndex >= 0 && !snapshot.shotCache[resumedPanelIndex]) {
          void startCamera()
        }
      } catch (error) {
        console.error('Draft recovery failed:', error)
        setDraftPhase('error')
        setStatus(error instanceof Error ? error.message : 'Draft recovery failed.')
        startRequestedRef.current = false
      }
    })()
  }

  function startNewProjectFromGesture() {
    if (startRequestedRef.current) {
      return
    }

    startRequestedRef.current = true
    void (async () => {
      await prepareAppSurface()
      try {
        const cleared = await queueDraftClear()
        if (!cleared) {
          throw new Error('A newer draft operation interrupted the reset.')
        }
      } catch (error) {
        console.error('Draft reset failed:', error)
        setDraftPhase('error')
        setStatus('Could not discard the saved comic. Try Start new again so no work is lost.')
        startRequestedRef.current = false
        return
      }

      assetBlobsRef.current.clear()
      assetUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
      assetUrlsRef.current.clear()
      shotCacheRef.current = []
      setShots({})
      setSettings({
        ...defaultSettings,
        ...layoutStyleSettings(layout),
      })
      setActivePanelId(layout.panels[0]?.id ?? null)
      setSavedDraft(null)
      setDraftPhase('none')
      draftSessionReadyRef.current = true
      emptyDraftClearedRef.current = true
      resetHistory()
      clearExport()
      setStarted(true)
      setStatus(`${layout.name} layout. Panel 1 is live.`)
      void startCamera()
    })()
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
    const request = ++cameraRequestRef.current
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('Camera unavailable. Use Photos to add your images.')
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
      if (request !== cameraRequestRef.current) {
        nextStream.getTracks().forEach((track) => track.stop())
        return
      }
      setStream(nextStream)
      setStatus(activePanelIndex >= 0 ? `Live in panel ${activePanelIndex + 1}.` : 'Camera ready. Tap a panel to retake it.')
    } catch (error) {
      if (request !== cameraRequestRef.current) return
      setStream(null)
      setStatus(error instanceof DOMException && error.name === 'NotAllowedError'
        ? 'Camera access is blocked. Allow it in your browser, or use Photos.'
        : 'Camera unavailable. Use Photos to add your images.')
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
      setPhotoActionsDeferred(false)
      setStatus(`Panel ${layout.panels.findIndex((panel) => panel.id === panelId) + 1} photo selected. Drag to move, pinch to zoom, or twist to rotate.`)
      return
    }

    setPhotoActionsDeferred(true)
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

  function beginPhotoOperation() {
    photoOperationCountRef.current += 1
    setPhotoProcessing(true)
  }

  function finishPhotoOperation() {
    photoOperationCountRef.current = Math.max(0, photoOperationCountRef.current - 1)
    setPhotoProcessing(photoOperationCountRef.current > 0)
  }

  async function capturePanel() {
    const video = videoRef.current
    const targetPanelId = activePanelId
    const editorVersion = editorVersionRef.current
    if (!targetPanelId) {
      setStatus('Tap a panel to retake it, or share the comic.')
      return
    }

    if (!stream || !video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      void startCamera()
      setStatus('Starting camera...')
      return
    }

    beginPhotoOperation()
    try {
      setStatus('Capturing full photo...')
      let photo: CapturedPhoto
      try {
        photo = await captureFullPhoto(stream, video)
      } catch (error) {
        setStatus(error instanceof Error ? `Photo capture failed: ${error.message}` : 'Photo capture failed.')
        return
      }

      if (editorVersion !== editorVersionRef.current) {
        setStatus('The comic changed while capturing. Tap the shutter again for this panel.')
        return
      }

      const nextShot = createAssetShot(photo.blob, photo.width, photo.height)
      commitHistoryEntry(beginHistoryEntry(shots[targetPanelId] ? 'Replace photo' : 'Capture photo'))
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
    } finally {
      finishPhotoOperation()
    }
  }

  async function uploadPhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) {
      replacePanelIdRef.current = null
      return
    }

    if (!file.type.startsWith('image/')) {
      replacePanelIdRef.current = null
      setStatus('Choose an image file.')
      return
    }

    const targetPanelId = activePanelId ?? layout.panels.find((panel) => !shots[panel.id])?.id
    const editorVersion = editorVersionRef.current
    if (!targetPanelId) {
      setStatus('Tap a panel before replacing a finished photo.')
      return
    }

    beginPhotoOperation()
    try {
      let dimensions: { width: number; height: number }
      try {
        dimensions = await loadBlobDimensions(file)
      } catch {
        replacePanelIdRef.current = null
        setStatus('Photo upload failed.')
        return
      }
      if (editorVersion !== editorVersionRef.current) {
        replacePanelIdRef.current = null
        setStatus('The comic changed while loading that photo. Choose it again for the current panel.')
        return
      }
      const replacing = !!shots[targetPanelId] || replacePanelIdRef.current === targetPanelId
      const nextShot = createAssetShot(file, dimensions.width, dimensions.height)
      commitHistoryEntry(beginHistoryEntry(replacing ? 'Replace photo' : 'Add photo'))
      const nextCache = putShotInCache(layout, shots, shotCacheRef.current, targetPanelId, nextShot)
      shotCacheRef.current = nextCache
      const nextShots = shotsForLayout(layout, nextCache)
      setShots(nextShots)

      const currentIndex = layout.panels.findIndex((panel) => panel.id === targetPanelId)
      if (replacing) {
        replacePanelIdRef.current = null
        setActivePanelId(targetPanelId)
        setStatus(`Replaced panel ${currentIndex + 1} photo.`)
        clearExport()
        return
      }

      const nextPanel = layout.panels.slice(currentIndex + 1).find((panel) => !nextShots[panel.id])
      if (nextPanel) {
        setActivePanelId(nextPanel.id)
        setStatus(`Photo added to panel ${currentIndex + 1}. Panel ${layout.panels.findIndex((panel) => panel.id === nextPanel.id) + 1} is live.`)
      } else {
        setActivePanelId(null)
        setStatus(`Photo added to panel ${currentIndex + 1}. Tap another panel to replace it, or share.`)
      }
      clearExport()
    } finally {
      finishPhotoOperation()
    }
  }

  function changeLayout(nextLayout: Layout, recordHistory = true) {
    if (nextLayout === layout) {
      return { applied: false, hiddenPhotoCount: 0 }
    }
    if (recordHistory) {
      flushPendingSettingsHistory()
    }
    const historyEntry = recordHistory ? beginHistoryEntry('Change layout') : null
    const nextCache = mergeLayoutShotsIntoCache(layout, shots, shotCacheRef.current)
    shotCacheRef.current = nextCache
    const hiddenPhotoCount = nextCache.slice(nextLayout.panels.length).filter(Boolean).length
    if (hiddenPhotoCount > 0) {
      const photoLabel = hiddenPhotoCount === 1 ? 'photo' : 'photos'
      setStatus(
        `${nextLayout.name} was not applied because it would hide ${hiddenPhotoCount} ${photoLabel}. ${layout.name} was kept so every photo stays visible.`,
      )
      return { applied: false, hiddenPhotoCount }
    }
    commitHistoryEntry(historyEntry)
    const nextShots = shotsForLayout(nextLayout, nextCache)
    const restoredCount = Object.keys(nextShots).length
    setLayout(nextLayout)
    setSettings((current) => ({ ...current, ...layoutStyleSettings(nextLayout) }))
    setActivePanelId(nextOpenPanelId(nextLayout, nextShots))
    setShots(nextShots)
    setStatus(
      restoredCount > 0
        ? `${nextLayout.name} layout. Restored ${restoredCount} photo${restoredCount === 1 ? '' : 's'}.`
        : `${nextLayout.name} layout. Panel 1 is live.`,
    )
    clearExport()
    return { applied: true, hiddenPhotoCount: 0 }
  }

  function deleteCustomLayout(layoutId: string) {
    const targetLayout = customLayouts.find((item) => item.id === layoutId)
    if (!targetLayout) {
      return
    }

    if (layout.id === layoutId) {
      const fallbackLayout = layouts[0]
      const result = changeLayout(fallbackLayout, false)
      if (!result.applied) {
        setStatus(`${targetLayout.name} was not deleted because changing grids would hide photos.`)
        return
      }
      setCustomLayouts((current) => current.filter((item) => item.id !== layoutId))
      setStatus(`${targetLayout.name} layout deleted. ${fallbackLayout.name} layout is active.`)
    } else {
      setCustomLayouts((current) => current.filter((item) => item.id !== layoutId))
      setStatus(`${targetLayout.name} layout deleted.`)
      clearExport()
    }
  }

  function addDraftLine(preset: CustomLinePreset) {
    setCreatorDirty(true)
    setDraftLines((current) => [...current, createDraftLine(preset, current.length)])
  }

  function removeDraftLine(lineId: string) {
    setCreatorDirty(true)
    setDraftLines((current) => current.filter((line) => line.id !== lineId))
    setStatus('Divider removed.')
  }

  function updateDraftLine(lineId: string, update: Partial<CustomLine>, shouldSnap = true) {
    setCreatorDirty(true)
    setDraftLines((current) =>
      current.map((line) => {
        if (line.id !== lineId) {
          return line
        }
        const candidate = { ...line, ...update }
        if (candidate.extent === 'canvas') {
          return { ...candidate, ...extendCut(candidate, creatorCanvasAspect, shouldSnap) }
        }
        const nextLine = clampCustomLine(candidate)
        return shouldSnap ? snapCustomLine(nextLine, current, lineId, creatorCanvasAspect) : nextLine
      }),
    )
  }

  function resetDraftLayout() {
    setCreatorDirty(true)
    setDraftLines(createDefaultDraftLines())
    setStatus('Creator reset.')
  }

  function resetAppearance() {
    updateProjectSettings({
      gutters: defaultSettings.gutters,
      radius: defaultSettings.radius,
      border: defaultSettings.border,
      background: defaultSettings.background,
      borderColor: defaultSettings.borderColor,
      fit: defaultSettings.fit,
    })
    setStatus('Appearance reset to defaults.')
  }

  function openCreator() {
    const currentBorderColor = layoutBorderColor(layout) ?? settings.borderColor
    setEditingLayoutId(null)
    setDraftName('')
    setDraftLines(createDefaultDraftLines())
    setDraftThickness(6)
    setDraftBorderColor(currentBorderColor.toLowerCase() === '#ffffff' ? DEFAULT_CUSTOM_GRID_BORDER_COLOR : currentBorderColor)
    setDraftBorderThickness(0)
    setCreatorDirty(false)
    setCreatorDiscardConfirmOpen(false)
    setCreatorOpen(true)
    setDrawerOpen(false)
    setDrawerTab('layout')
  }

  function editCustomLayout(layoutId: string) {
    const targetLayout = customLayouts.find((item) => item.id === layoutId)
    if (!targetLayout) {
      return
    }

    setEditingLayoutId(targetLayout.id)
    setDraftName(targetLayout.name)
    setDraftLines(targetLayout.dividers?.map((divider) => ({ ...divider })) ?? createDefaultDraftLines())
    setDraftThickness(layoutDividerThickness(targetLayout) ?? 9)
    setDraftBorderColor(layoutBorderColor(targetLayout) ?? DEFAULT_CUSTOM_GRID_BORDER_COLOR)
    setDraftBorderThickness(layoutBorderThickness(targetLayout) ?? DEFAULT_CUSTOM_GRID_BORDER_THICKNESS)
    setCreatorDirty(false)
    setCreatorDiscardConfirmOpen(false)
    setCreatorOpen(true)
    setDrawerOpen(false)
    setDrawerTab('layout')
  }

  function closeCreator() {
    if (creatorDirty) {
      setCreatorDiscardConfirmOpen(true)
      return
    }
    discardCreator()
  }

  function discardCreator() {
    setCreatorDirty(false)
    setCreatorDiscardConfirmOpen(false)
    setCreatorOpen(false)
    setEditingLayoutId(null)
    setDrawerTab('layout')
  }

  function saveDraftLayout() {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }

    const originalLayout = customLayouts.find((item) => item.id === editingLayoutId)
    const readingOrder = !editingLayoutId || originalLayout?.panelOrder === 'reading'
    const panels = panelsFromLines(draftLines, readingOrder)

    if (panels.length === 0) {
      setStatus('Move a divider before saving.')
      return
    }

    const customLayout: Layout = {
      id: editingLayoutId ?? `custom-${Date.now()}`,
      name: draftName.trim() || `Custom ${customLayouts.length + 1}`,
      custom: true,
      panelOrder: readingOrder ? 'reading' : undefined,
      dividerThickness: draftThickness,
      borderColor: draftBorderColor,
      borderThickness: draftBorderThickness,
      dividers: draftLines.map((line) => ({ ...line })),
      panels,
    }
    setCustomLayouts((current) =>
      editingLayoutId
        ? current.map((item) => (item.id === editingLayoutId ? customLayout : item))
        : [...current, customLayout],
    )
    const layoutChange = changeLayout(customLayout)
    setDraftName('')
    setDraftLines(createDefaultDraftLines())
    setCreatorDirty(false)
    setCreatorDiscardConfirmOpen(false)
    setCreatorOpen(false)
    setEditingLayoutId(null)
    setDrawerTab('layout')
    setDrawerOpen(false)
    if (layoutChange.hiddenPhotoCount > 0) {
      const photoCount = shotCacheRef.current.filter(Boolean).length
      setStatus(
        `${customLayout.name} saved to Your grids; kept ${layout.name} active so all ${photoCount} photos stay visible.`,
      )
    } else {
      setStatus(editingLayoutId ? 'Custom grid updated on this device.' : 'Custom grid saved on this device.')
    }
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
    // Keep the release on this surface even when a photo is dragged beyond
    // the canvas or window. Otherwise the next toolbar tap ends the gesture.
    event.currentTarget.setPointerCapture(event.pointerId)
    if (!showPhotoActions) {
      setPhotoActionsDeferred(true)
    }
    if (!gestureHistoryRef.current) {
      gestureHistoryRef.current = beginHistoryEntry('Move photo')
    }
    lastSnapAngleRef.current = null
    setRotationSnap(null)
    setActivePanelId(panel.id)
    setPhotoDragState({
      panelId: panel.id,
      mode: 'move',
      startX: event.clientX,
      startY: event.clientY,
      offsetX: shot.offsetX,
      offsetY: shot.offsetY,
      scale: shot.scale,
      rotation: shot.rotation,
      ...panelPhotoFrameSize(panel, rect),
    })
    setStatus(`Panel ${layout.panels.findIndex((item) => item.id === panel.id) + 1} photo selected. Drag to move, pinch to zoom, or twist to rotate.`)
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
    if (!showPhotoActions) {
      setPhotoActionsDeferred(true)
    }
    if (!gestureHistoryRef.current) {
      gestureHistoryRef.current = beginHistoryEntry('Transform photo')
    } else if (gestureHistoryRef.current.label === 'Move photo') {
      gestureHistoryRef.current = { ...gestureHistoryRef.current, label: 'Transform photo' }
    }
    lastSnapAngleRef.current = null
    setRotationSnap(null)
    setActivePanelId(firstPanel.id)
    setPhotoDragState({
      panelId: firstPanel.id,
      mode: 'pinch',
      startX: 0,
      startY: 0,
      offsetX: shot.offsetX,
      offsetY: shot.offsetY,
      scale: shot.scale,
      rotation: shot.rotation,
      ...panelPhotoFrameSize(firstPanel, rect),
      startDistance: touchDistance(event.touches),
      startAngle: touchAngle(event.touches),
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
    if (
      !photoDragState ||
      photoDragState.mode !== 'pinch' ||
      touches.length < 2 ||
      !photoDragState.startDistance ||
      photoDragState.startAngle === undefined
    ) {
      return
    }

    const scale = photoDragState.scale * clamp(touchDistance(touches) / photoDragState.startDistance, 0.35, 3)
    const rawRotation = photoDragState.rotation + angleDelta(photoDragState.startAngle, touchAngle(touches))
    const snappedRotation = snapPhotoRotation(rawRotation, lastSnapAngleRef.current)
    if (snappedRotation.snappedAngle !== lastSnapAngleRef.current) {
      lastSnapAngleRef.current = snappedRotation.snappedAngle
      setRotationSnap(
        snappedRotation.snappedAngle === null
          ? null
          : { panelId: photoDragState.panelId, angle: snappedRotation.snappedAngle },
      )
      if (snappedRotation.snappedAngle !== null) {
        navigator.vibrate?.(10)
      }
    }
    updateShotTransform(photoDragState.panelId, { scale, rotation: snappedRotation.rotation })
  }

  function updateShotTransform(panelId: string, update: Partial<Pick<Shot, 'offsetX' | 'offsetY' | 'scale' | 'rotation'>>) {
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

  function adjustPhotoFromKeyboard(event: React.KeyboardEvent<HTMLButtonElement>, panelId: string) {
    const shot = shots[panelId]
    if (!shot) {
      return
    }
    const step = event.shiftKey ? 0.12 : 0.03
    let update: Partial<Pick<Shot, 'offsetX' | 'offsetY' | 'scale' | 'rotation'>> | null = null
    if (event.key === 'ArrowLeft') update = { offsetX: shot.offsetX - step }
    if (event.key === 'ArrowRight') update = { offsetX: shot.offsetX + step }
    if (event.key === 'ArrowUp') update = { offsetY: shot.offsetY - step }
    if (event.key === 'ArrowDown') update = { offsetY: shot.offsetY + step }
    if (event.key === '+' || event.key === '=') update = { scale: clamp(shot.scale + 0.05, 0.35, 3) }
    if (event.key === '-') update = { scale: clamp(shot.scale - 0.05, 0.35, 3) }
    if (event.key === '[') update = { rotation: normalizeAngle(shot.rotation - 2) }
    if (event.key === ']') update = { rotation: normalizeAngle(shot.rotation + 2) }
    if (!update) {
      return
    }
    event.preventDefault()
    flushPendingSettingsHistory()
    commitHistoryEntry(beginHistoryEntry('Adjust photo'))
    updateShotTransform(panelId, update)
    setPhotoActionsDeferred(false)
    setStatus(`Adjusted panel ${layout.panels.findIndex((panel) => panel.id === panelId) + 1}.`)
  }

  function replaceSelectedPhoto() {
    if (!activePanelId || !shots[activePanelId]) {
      return
    }
    replacePanelIdRef.current = activePanelId
    fileInputRef.current?.click()
  }

  function toggleSelectedPhotoFit() {
    if (!activePanelId || !shots[activePanelId]) {
      return
    }
    flushPendingSettingsHistory()
    commitHistoryEntry(beginHistoryEntry('Change photo fit'))
    const nextFit: PanelFit = (shots[activePanelId].fit ?? settings.fit) === 'cover' ? 'contain' : 'cover'
    setShots((current) => {
      const shot = current[activePanelId]
      if (!shot) {
        return current
      }
      const nextShot = { ...shot, fit: nextFit }
      const next = { ...current, [activePanelId]: nextShot }
      shotCacheRef.current = putShotInCache(layout, next, shotCacheRef.current, activePanelId, nextShot)
      return next
    })
    setStatus(`Panel ${activePanelIndex + 1} now uses ${nextFit === 'cover' ? 'Fill frame' : 'Fit whole photo'}.`)
    clearExport()
  }

  function resetSelectedPhoto() {
    if (!activePanelId || !shots[activePanelId]) {
      return
    }
    const currentShot = shots[activePanelId]
    if (
      Math.abs(currentShot.offsetX) < 0.001 &&
      Math.abs(currentShot.offsetY) < 0.001 &&
      Math.abs(currentShot.scale - 1) < 0.001 &&
      Math.abs(currentShot.rotation) < 0.001
    ) {
      return
    }
    flushPendingSettingsHistory()
    commitHistoryEntry(beginHistoryEntry('Reset photo'))
    setShots((current) => {
      const shot = current[activePanelId]
      if (!shot) {
        return current
      }
      const nextShot = normalizeShot({ ...shot, offsetX: 0, offsetY: 0, scale: 1, rotation: 0 })
      const next = { ...current, [activePanelId]: nextShot }
      shotCacheRef.current = putShotInCache(layout, next, shotCacheRef.current, activePanelId, nextShot)
      return next
    })
    setStatus(`Reset panel ${activePanelIndex + 1} photo.`)
    clearExport()
  }

  function removeSelectedPhoto() {
    if (!activePanelId || !shots[activePanelId]) {
      return
    }
    flushPendingSettingsHistory()
    commitHistoryEntry(beginHistoryEntry('Remove photo'))
    const panelId = activePanelId
    const panelIndex = layout.panels.findIndex((panel) => panel.id === panelId)
    const nextCache = [...shotCacheRef.current]
    if (panelIndex >= 0) {
      nextCache[panelIndex] = undefined
    }
    shotCacheRef.current = nextCache
    setShots(shotsForLayout(layout, nextCache))
    setActivePanelId(panelId)
    setStatus(`Removed panel ${panelIndex + 1} photo. Capture or replace it when ready.`)
    clearExport()
    requestAnimationFrame(() => {
      stripRef.current?.querySelector<HTMLButtonElement>(`[data-panel-id="${panelId}"]`)?.focus()
    })
    if (!stream) {
      void startCamera()
    }
  }

  function updateProjectSettings(next: Partial<Settings>) {
    if (!pendingSettingsHistoryRef.current) {
      pendingSettingsHistoryRef.current = beginHistoryEntry('Change style')
    }
    if (settingsHistoryTimerRef.current) {
      clearTimeout(settingsHistoryTimerRef.current)
    }
    setSettings((current) => ({ ...current, ...next }))
    settingsHistoryTimerRef.current = setTimeout(() => {
      commitHistoryEntry(pendingSettingsHistoryRef.current)
      pendingSettingsHistoryRef.current = null
      settingsHistoryTimerRef.current = null
    }, 360)
    clearExport()
  }

  function finishGestures() {
    const finishedPhotoGesture = !!photoDragState
    if (photoDragState && gestureHistoryRef.current) {
      const baselineIndex = gestureHistoryRef.current.snapshot.layout.panels.findIndex(
        (panel) => panel.id === photoDragState.panelId,
      )
      const currentIndex = layout.panels.findIndex((panel) => panel.id === photoDragState.panelId)
      const baselineShot = baselineIndex >= 0 ? gestureHistoryRef.current.snapshot.shotCache[baselineIndex] : null
      const shot = currentIndex >= 0 ? shotCacheRef.current[currentIndex] : undefined
      const changed =
        !!shot &&
        !!baselineShot &&
        (Math.abs(shot.offsetX - baselineShot.offsetX) > 0.001 ||
          Math.abs(shot.offsetY - baselineShot.offsetY) > 0.001 ||
          Math.abs(shot.scale - baselineShot.scale) > 0.001 ||
          Math.abs(normalizeAngle(shot.rotation - baselineShot.rotation)) > 0.001)
      if (changed) {
        commitHistoryEntry(gestureHistoryRef.current)
      }
    }

    if (rotationSnap) {
      setStatus(`Rotation snapped to ${formatRotation(rotationSnap.angle)}.`)
    }
    gestureHistoryRef.current = null
    lastSnapAngleRef.current = null
    setRotationSnap(null)
    setPhotoDragState(null)
    if (finishedPhotoGesture) {
      setPhotoActionsDeferred(false)
    }
  }

  function openDrawer(tab?: DrawerTab) {
    setDrawerTab(tab ?? drawerTab)
    setDrawerOpen(true)
  }

  async function renderComicBlob() {
    if (photoOperationCountRef.current > 0) {
      throw new Error('The latest photo is still being prepared. Try saving again in a moment.')
    }
    if (imageExportingRef.current) {
      throw new Error('The PNG is already being prepared.')
    }

    imageExportingRef.current = true
    setImageExporting(true)
    setStatus('Preparing the latest comic...')
    const snapshot = captureProjectSnapshot()
    const snapshotCache = snapshot.shotCache.map((shot) => shot ?? undefined)
    const snapshotShots = shotsForLayout(snapshot.layout, snapshotCache)
    clearReadyVideo()
    try {
      return await renderToPng(
        snapshot.layout,
        snapshotShots,
        snapshot.settings,
        getPageFormat(snapshot.pageFormatId),
      )
    } finally {
      imageExportingRef.current = false
      setImageExporting(false)
    }
  }

  function downloadComicBlob(blob: Blob) {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'instacomic.png'
    document.body.append(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }

  async function downloadComic() {
    try {
      downloadComicBlob(await renderComicBlob())
      setStatus('PNG downloaded with the latest photos.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'PNG download failed.')
    }
  }

  async function shareComic() {
    try {
      const blob = await renderComicBlob()
      const file = new File([blob], 'instacomic.png', { type: 'image/png' })
      if ('canShare' in navigator && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Instacomic' })
        setStatus('Shared.')
      } else {
        downloadComicBlob(blob)
        setStatus('Sharing is unavailable here, so the PNG downloaded.')
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setStatus('Share canceled. Your comic is unchanged.')
      } else {
        setStatus(error instanceof Error ? error.message : 'Share failed.')
      }
    }
  }

  async function exportStoryVideo() {
    if (videoRendering) {
      return
    }
    if (photoOperationCountRef.current > 0) {
      setStatus('The latest photo is still being prepared. Try exporting again in a moment.')
      return
    }

    clearReadyVideo()
    const snapshot = captureProjectSnapshot()
    const snapshotCache = snapshot.shotCache.map((shot) => shot ?? undefined)
    const snapshotShots = shotsForLayout(snapshot.layout, snapshotCache)
    setVideoRendering(true)
    setVideoProgress(0)
    setVideoProgressPhase('rendering')
    try {
      setStatus('Rendering story video...')
      const video = await renderStoryVideo(
        snapshot.layout,
        snapshotShots,
        snapshot.settings,
        getPageFormat(snapshot.pageFormatId),
        (progress, phase) => {
        setVideoProgress(progress)
        setVideoProgressPhase(phase)
        setStatus(
          phase === 'finalizing'
            ? `Finalizing story video ${Math.round(progress * 100)}%...`
            : `Rendering story video ${Math.round(progress * 100)}%...`,
        )
        },
      )
      const fileName = `instacomic-story.${video.extension}`
      setReadyStoryVideo(video, fileName)
      setStatus('Story video ready. Choose Download or Share.')
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
    setDrawerTab('export')
    setDrawerOpen(true)
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
      className={`native-shell ${appContext.isInstalled ? 'is-app' : 'is-installer'} ${showPhotoActions ? 'has-photo-actions' : ''} ${started ? 'is-editing' : 'is-home'}`}
      data-history-undo={historyCounts.undo}
      data-history-redo={historyCounts.redo}
      data-autosave-state={draftPhase}
      data-photo-processing={photoProcessing || undefined}
      data-image-exporting={imageExporting || undefined}
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
      <>
      {!started && (
        <section className="start-screen" aria-label="Start Instacomic" data-draft-phase={draftPhase}>
          <div className="start-shell">
            <header className="start-topbar">
              <Brand />
              <span className="start-edition">The everyday comic studio</span>
            </header>
            <div className="start-intro">
              <p className="eyebrow">A new way to keep a moment</p>
              <h1>Life happens. <em>Make it a comic.</em></h1>
              <p>A few photos. Your point of view. Something worth keeping.</p>
            </div>
            <div className="start-workspace">
              <figure className="start-preview">
                <div className="start-preview-stage">
                  <span className="preview-registration top-left" aria-hidden="true" />
                  <span className="preview-registration bottom-right" aria-hidden="true" />
                  <div className="start-preview-page" style={{ aspectRatio: `${pageFormat.width} / ${pageFormat.height}` }}>
                    <LayoutPreview layout={layout} specimen />
                  </div>
                </div>
                <figcaption>
                  <div><span className="eyebrow">Your canvas</span><strong>{layout.name}<i> / </i>{pageFormat.id}</strong></div>
                  <span>{layout.panels.length} moments,<br />one story.</span>
                </figcaption>
              </figure>
            <div className="start-panel">
              {draftPhase === 'checking' ? (
                <div className="draft-checking" role="status">
                  <span className="loading-ring" aria-hidden="true" />
                  Checking saved work…
                </div>
              ) : savedDraft && ['available', 'saved', 'saving', 'error'].includes(draftPhase) && !newProjectRequested ? (
                <>
                  <div className="start-section-heading">
                    <div>
                      <span className="eyebrow">Welcome back</span>
                      <h2>Your story is waiting.</h2>
                    </div>
                    <span className="saved-indicator">Saved on this device</span>
                  </div>
                  <section className="draft-recovery-card" aria-label="Saved comic draft">
                    <LayoutPreview layout={savedDraft.document.layout} />
                    <div className="draft-recovery-copy">
                      <span>Saved comic</span>
                      <strong>{savedDraft.document.layout.name}</strong>
                      <em>{`${savedDraftPhotoCount} photo${savedDraftPhotoCount === 1 ? '' : 's'} · ${savedDraft.document.pageFormatId} · ${formatSavedTime(savedDraft.updatedAt)}`}</em>
                    </div>
                  </section>
                  {draftPhase === 'error' && <div className="draft-recovery-error" role="alert">{status}</div>}
                  <div className="start-actions recovery-actions">
                    <button className="start-button" type="button" disabled={draftPhase === 'saving'} onClick={continueDraftFromGesture}>
                      {draftPhase === 'saving' ? 'Saving changes…' : draftPhase === 'error' ? 'Retry recovery' : 'Continue editing'}
                    </button>
                    <button className="start-secondary" type="button" disabled={draftPhase === 'saving'} onClick={() => setNewProjectRequested(true)}>
                      New comic
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="start-section-heading">
                    <div>
                      <span className="eyebrow">New comic</span>
                      <h2>Set the scene.</h2>
                      <p>Choose a format and a starting layout.</p>
                    </div>
                  </div>
                  <div className="format-picker" aria-label="Canvas ratio">
                    <div className="setup-grid-heading"><span><b>01</b> Canvas format</span><em>{pageFormat.detail}</em></div>
                    <div className="format-options" role="group" aria-label="Canvas ratio">
                      {pageFormats.map((format) => (
                        <button
                          key={format.id}
                          className={`format-option ${pageFormat.id === format.id ? 'active' : ''}`}
                          type="button"
                          aria-pressed={pageFormat.id === format.id}
                          onClick={() => selectPageFormat(format)}
                        >
                          <span
                            className="format-shape"
                            style={{ aspectRatio: `${format.width} / ${format.height}` }}
                            aria-hidden="true"
                          />
                          <span className="format-option-copy">
                            <strong>{format.id}</strong>
                            <em>{format.label}</em>
                          </span>
                          <i aria-hidden="true"><ActionIcon name="check" /></i>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="setup-grid-picker">
                    <div className="setup-grid-heading">
                      <span><b>02</b> Starting grid</span>
                      <em>{`${layout.name} · ${layout.panels.length} panels`}</em>
                    </div>
                    <div className="setup-grid-options" role="group" aria-label="Starting grid">
                      {layouts
                        .filter((option) => ['story', 'four', 'shard', 'manga'].includes(option.id))
                        .map((option) => (
                          <button
                            key={option.id}
                            type="button"
                            className={layout.id === option.id ? 'active' : ''}
                            aria-label={`Use ${option.name} starting grid, ${option.panels.length} panels`}
                            aria-pressed={layout.id === option.id}
                            onClick={() => changeLayout(option, false)}
                          >
                            <LayoutPreview layout={option} />
                            <span>{option.name}</span>
                          </button>
                        ))}
                    </div>
                  </div>
                  {newProjectRequested && savedDraft && <p className="new-comic-warning">Starting a new comic replaces your saved draft. Export it first if you want to keep it.</p>}
                  <div className="start-actions">
                    <button
                      className="start-button"
                      type="button"
                      onClick={() => (newProjectRequested ? startNewProjectFromGesture() : startFromGesture())}
                    >
                      <span>{newProjectRequested ? 'Start new comic' : 'Start creating'}</span><ActionIcon name="arrow" />
                    </button>
                    {newProjectRequested && savedDraft && (
                      <button className="start-secondary" type="button" onClick={() => setNewProjectRequested(false)}>
                        Back to saved comic
                      </button>
                    )}
                  </div>
                </>
              )}
              <p className="setup-reassurance">Shoot with your camera or add photos. Everything stays on your device.</p>
            </div>
            </div>
            <footer className="start-footer">
              <p>Small moments. <span>Great stories.</span></p>
            {!appContext.isInstalled && (
              <InstallNudge
                appContext={appContext}
                deferredPrompt={deferredPrompt}
                onTriggerNativeInstall={triggerNativeInstall}
              />
            )}
            </footer>
          </div>
        </section>
      )}
      <video ref={videoRef} className="live-camera" autoPlay muted playsInline aria-hidden="true" />
      <input ref={fileInputRef} className="photo-upload" type="file" accept="image/*" tabIndex={-1} aria-hidden="true" disabled={photoProcessing} onChange={(event) => void uploadPhoto(event)} />
      <p className="sr-status" id="photo-gesture-help">Drag to move. Pinch to zoom. Twist to rotate.</p>

      {started && (
        <header className="editor-header" aria-hidden={drawerOpen || creatorOpen} inert={drawerOpen || creatorOpen || undefined}>
          <button className="editor-home" type="button" aria-label="Back to projects" title="Back to projects" onClick={returnHome}>
            <Brand compact />
          </button>
          <div className="editor-context">
            <span>{layout.name} <i> / </i> {pageFormat.id}</span>
            <strong>{activePanelIndex >= 0 ? `Panel ${activePanelIndex + 1} of ${layout.panels.length}` : capturedCount === layout.panels.length ? 'Comic ready' : `${capturedCount} of ${layout.panels.length} photos`}</strong>
          </div>
          <div className="history-toolbar" role="group" aria-label="Editing history">
            <button
              type="button"
              aria-label="Undo"
              aria-keyshortcuts="Control+Z Meta+Z"
              disabled={historyCounts.undo === 0}
              onClick={undoEditorAction}
            >
              <ToolIcon name="undo" />
            </button>
            <button
              type="button"
              aria-label="Redo"
              aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y"
              disabled={historyCounts.redo === 0}
              onClick={redoEditorAction}
            >
              <ToolIcon name="redo" />
            </button>
            <span className={`autosave-chip is-${draftPhase}`} aria-label={draftPhase === 'error' ? 'Draft not saved' : `Draft ${draftPhase === 'none' ? 'ready' : draftPhase}`}>
              <i aria-hidden="true" />
              {draftPhase === 'saving' ? 'Saving' : draftPhase === 'error' ? 'Not saved' : draftPhase === 'none' ? 'Ready' : 'Saved'}
            </span>
          </div>
          <nav className="editor-tools" aria-label="Studio tools">
            <button type="button" onClick={() => openDrawer('layout')}><ActionIcon name="layout" />Layout</button>
            <button type="button" onClick={() => openDrawer('style')}><ActionIcon name="style" />Style</button>
          </nav>
          <button className="header-export" type="button" aria-label="Open export controls" onClick={() => openDrawer('export')}>
            <ActionIcon name="export" />
            <span>Export</span>
          </button>
        </header>
      )}

      {started && (
        <div className="workspace-heading" aria-hidden={drawerOpen || creatorOpen} inert={drawerOpen || creatorOpen || undefined}>
          <div><span className="eyebrow">The studio</span><h1>{settings.caption.trim() || 'Your story, in the making.'}</h1></div>
          <span className="workspace-format">{pageFormat.label} <b>{pageFormat.id}</b></span>
        </div>
      )}

      {started && (
        <div
          id="app-status"
          inert={drawerOpen || creatorOpen || undefined}
          className={`editor-notice ${/(failed|not saved|could not)/i.test(status) ? 'is-error' : ''}`}
          role={/(failed|not saved|could not)/i.test(status) ? 'alert' : 'status'}
          aria-live={/(failed|not saved|could not)/i.test(status) ? 'assertive' : 'polite'}
        >
          <i aria-hidden="true" />
          <span>{status}</span>
          {/camera.+(unavailable|blocked)/i.test(status) && !stream && <button type="button" onClick={() => void startCamera()}>Try camera</button>}
        </div>
      )}

      <section
        ref={stageRef}
        className="comic-stage"
        aria-label="Instacomic capture surface"
        aria-hidden={!started}
        inert={!started || drawerOpen || creatorOpen || undefined}
      >
        <div
          ref={stripRef}
          className={`live-strip layout-${layout.id} ${layout.custom ? 'is-custom' : ''} ${layout.panels.some((panel) => panel.points) ? 'is-manga' : ''}`}
          data-page-format={pageFormat.id}
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
              onKeyDown={(event) => adjustPhotoFromKeyboard(event, panel.id)}
              aria-label={shots[panel.id] ? `Select panel ${index + 1}, photo added` : `Select empty panel ${index + 1}`}
              aria-pressed={panel.id === activePanelId}
              aria-keyshortcuts={shots[panel.id] ? 'ArrowLeft ArrowRight ArrowUp ArrowDown + - [ ]' : undefined}
              aria-describedby={panel.id === activePanelId && shots[panel.id] ? 'photo-gesture-help' : undefined}
            >
              {!shots[panel.id] && !(panel.id === activePanelId && stream) && (
                <span className="panel-placeholder" aria-hidden="true">
                  <b>{index + 1}</b>
                  <em>{panel.id === activePanelId ? 'Ready for a photo' : 'Add photo'}</em>
                </span>
              )}
              {shots[panel.id] && (
                <img
                  src={shots[panel.id].dataUrl}
                  alt={`Panel ${index + 1}`}
                  style={shotImageStyle(panel, shots[panel.id], shots[panel.id].fit ?? settings.fit, pageFormat)}
                  data-shot-scale={shots[panel.id].scale.toFixed(2)}
                  data-shot-x={shots[panel.id].offsetX.toFixed(2)}
                  data-shot-y={shots[panel.id].offsetY.toFixed(2)}
                  data-shot-rotation={shots[panel.id].rotation.toFixed(2)}
                  data-shot-fit={shots[panel.id].fit ?? settings.fit}
                />
              )}
              {panel.id === activePanelId && stream && !shots[panel.id] && (
                <LiveVideo stream={stream} panel={panel} fit={settings.fit} />
              )}
              {panel.id === activePanelId && stream && !shots[panel.id] && <span className="panel-chip">Camera</span>}
            </button>
          ))}

          {layout.dividers?.map((divider, index) => (
            <div key={`${divider.id}-${index}`} className="live-divider-clip" aria-hidden="true"><span
              className={`live-divider-gap ${settings.border === 0 ? 'is-unoutlined' : ''}`}
              style={lineSegmentStyle(divider, liveCanvasAspect, true)}
              aria-hidden="true"
            /></div>
          ))}

          {rotationSnap && layout.panels.find((panel) => panel.id === rotationSnap.panelId) && (
            <div
              className="rotation-snap-cue"
              data-snap-angle={rotationSnap.angle}
              style={panelCenterStyle(layout.panels.find((panel) => panel.id === rotationSnap.panelId)!)}
              aria-hidden="true"
            >
              <span>{formatRotation(rotationSnap.angle)}</span>
              <i />
            </div>
          )}

          {settings.caption.trim() && <div className="strip-caption" style={{ color: settings.captionColor }}>{settings.caption}</div>}
        </div>
      </section>

      {started && (
        <aside className="studio-inspector" aria-label="Your comic panels" inert={drawerOpen || creatorOpen || undefined}>
          <div className="inspector-heading"><span className="eyebrow">Your comic</span><h2>One moment<br /><em>at a time.</em></h2></div>
          <div className="inspector-progress"><span>Panels</span><span>{capturedCount} / {layout.panels.length}</span></div>
          <nav className="panel-list" aria-label="Panel navigation">
            {layout.panels.map((panel, index) => <button key={panel.id} type="button" aria-label={`Go to panel ${index + 1}`} aria-pressed={activePanelId === panel.id} onClick={() => selectPanel(panel.id)}>
              <span className="panel-list-number">{String(index + 1).padStart(2, '0')}</span>
              <span className="panel-list-thumb">{shots[panel.id] ? <img src={shots[panel.id].dataUrl} alt="" /> : <ActionIcon name="plus" />}</span>
              <span className="panel-list-copy"><strong>Panel {index + 1}</strong><span>{shots[panel.id] ? 'Photo added' : activePanelId === panel.id ? 'Ready for a photo' : 'An open possibility'}</span></span>
              {shots[panel.id] && <ActionIcon name="check" />}
            </button>)}
          </nav>
          <div className="inspector-note">
            <ActionIcon name={capturedCount === layout.panels.length ? 'check' : 'camera'} />
            <div><strong>{capturedCount === layout.panels.length ? 'A story worth sharing.' : 'Start with what’s in front of you.'}</strong><p>{capturedCount === layout.panels.length ? 'Fine-tune your photos, add a caption, or export your comic.' : 'Select a panel, then take a photo or add one from your library.'}</p></div>
          </div>
          <button className="inspector-style" type="button" onClick={() => openDrawer('style')}>Give it your signature style <ActionIcon name="arrow" /></button>
        </aside>
      )}

      <AnimatePresence>
        {showPhotoActions && selectedShot && activePanelId && (
          <PhotoActionTray
            panelNumber={activePanelIndex + 1}
            shot={selectedShot}
            fit={selectedShotFit}
            onReplace={replaceSelectedPhoto}
            onToggleFit={toggleSelectedPhotoFit}
            onReset={resetSelectedPhoto}
            onRemove={removeSelectedPhoto}
            onOpenControls={() => openDrawer('layout')}
            onDone={() => setPhotoActionsDeferred(true)}
          />
        )}
      </AnimatePresence>

      <nav
        className="capture-bar"
        aria-label="Capture controls"
        aria-hidden={!started || showPhotoActions}
        inert={!started || showPhotoActions || drawerOpen || creatorOpen || undefined}
      >
        <div className="capture-progress">
          <span>{`${capturedCount} of ${layout.panels.length} panels`}</span>
          <div
            className="progress-pills"
            role="progressbar"
            aria-label="Panels captured"
            aria-valuemin={0}
            aria-valuemax={layout.panels.length}
            aria-valuenow={capturedCount}
            aria-valuetext={`${capturedCount} of ${layout.panels.length} panels captured`}
          >
            {layout.panels.map((panel) => (
              <span key={panel.id} className={shots[panel.id] ? 'done' : panel.id === activePanelId ? 'live' : ''} />
            ))}
          </div>
        </div>
        <div className="capture-actions">
          <button className="round-action capture-tool" type="button" onClick={() => void flipCamera()} aria-label="Flip camera">
            <ActionIcon name="flip" />
            <span>Flip</span>
          </button>
          <button className="round-action capture-tool" type="button" disabled={photoProcessing} onClick={() => fileInputRef.current?.click()} aria-label="Upload photo">
            <ActionIcon name="photo" />
            <span>Photos</span>
          </button>
          <button
            className="shutter"
            type="button"
            disabled={!activePanelId || photoProcessing}
            onClick={capturePanel}
            aria-label={activePanelIndex >= 0 ? `Capture panel ${activePanelIndex + 1}` : 'All panels captured'}
          >
            <span>{photoProcessing && <i className="loading-ring" />}</span>
          </button>
          <button className="round-action capture-tool" type="button" onClick={() => openDrawer('layout')} aria-label="Controls" title="Layout and canvas">
            <ActionIcon name="layout" />
            <span>Layout</span>
          </button>
          <button className="round-action capture-tool" type="button" onClick={() => openDrawer('style')} aria-label="Open appearance controls">
            <ActionIcon name="style" />
            <span>Style</span>
          </button>
        </div>
      </nav>

      <Drawer
        open={drawerOpen}
        tab={drawerTab}
        dragControls={dragControls}
        onOpen={() => setDrawerOpen(true)}
        onClose={() => setDrawerOpen(false)}
        onTab={setDrawerTab}
        status={status}
      >
        {drawerTab === 'layout' && (
          <LayoutPanel
            layout={layout}
            layouts={allLayouts}
            pageFormat={pageFormat}
            formats={pageFormats}
            onLayout={changeLayout}
            onFormat={selectPageFormat}
            onCreate={openCreator}
            onEditCustomLayout={editCustomLayout}
            onDeleteCustomLayout={deleteCustomLayout}
          />
        )}
        {drawerTab === 'style' && (
          <StylePanel settings={settings} onSettings={updateProjectSettings} onReset={resetAppearance} />
        )}
        {drawerTab === 'export' && (
          <ExportPanel
            settings={settings}
            capturedCount={capturedCount}
            panelCount={layout.panels.length}
            pageFormat={pageFormat}
            imageExporting={imageExporting}
            photoProcessing={photoProcessing}
            videoRendering={videoRendering}
            videoProgress={videoProgress}
            videoProgressPhase={videoProgressPhase}
            readyVideo={readyVideo}
            onSettings={updateProjectSettings}
            onDownloadImage={downloadComic}
            onShareImage={shareComic}
            onExportVideo={exportStoryVideo}
            onDownloadVideo={downloadReadyVideo}
            onShareVideo={shareReadyVideo}
            onDismissVideo={clearReadyVideo}
          />
        )}
      </Drawer>
      <AnimatePresence>
        {creatorOpen && (
          <motion.section
            ref={creatorRef}
            className="creator-fullscreen"
            role="dialog"
            aria-modal="true"
            aria-label={editingLayoutId ? 'Edit custom grid' : 'Create custom grid'}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <div className="creator-panel-host" inert={creatorDiscardConfirmOpen || undefined}>
              <CreatorPanel
                draftName={draftName}
                draftLines={draftLines}
                dividerThickness={draftThickness}
                borderColor={draftBorderColor}
                borderThickness={draftBorderThickness}
                editing={editingLayoutId !== null}
                pageFormat={pageFormat}
                paperColor={settings.background}
                photoCache={mergeLayoutShotsIntoCache(layout, shots, shotCacheRef.current)}
                photoFit={settings.fit}
                readingOrder={!editingLayoutId || customLayouts.find((item) => item.id === editingLayoutId)?.panelOrder === 'reading'}
                onName={(value) => {
                  setCreatorDirty(true)
                  setDraftName(value)
                }}
                onAddLine={addDraftLine}
                onRemoveLine={removeDraftLine}
                onMoveLine={updateDraftLine}
                onThickness={(value) => {
                  setCreatorDirty(true)
                  setDraftThickness(value)
                }}
                onBorderColor={(value) => {
                  setCreatorDirty(true)
                  setDraftBorderColor(value)
                }}
                onBorderThickness={(value) => {
                  setCreatorDirty(true)
                  setDraftBorderThickness(value)
                }}
                onReset={resetDraftLayout}
                onSave={saveDraftLayout}
                onCancel={closeCreator}
                onDirty={setCreatorDirty}
                onRestore={(draft) => {
                  setDraftName(draft.name)
                  setDraftLines(draft.lines)
                  setDraftThickness(draft.thickness)
                  setDraftBorderColor(draft.borderColor)
                  setDraftBorderThickness(draft.borderThickness)
                }}
              />
            </div>
            {creatorDiscardConfirmOpen && (
              <div className="creator-discard-backdrop">
                <section ref={discardRef} className="creator-discard-dialog" role="alertdialog" aria-modal="true" aria-labelledby="discard-grid-heading" aria-describedby="discard-grid-copy">
                  <span>Unsaved grid</span>
                  <strong id="discard-grid-heading">Discard your changes?</strong>
                  <p id="discard-grid-copy">The grid has changes that have not been saved.</p>
                  <div>
                    <button type="button" onClick={() => setCreatorDiscardConfirmOpen(false)}>Keep editing</button>
                    <button className="is-danger" type="button" onClick={discardCreator}>Discard changes</button>
                  </div>
                </section>
              </div>
            )}
          </motion.section>
        )}
      </AnimatePresence>
      </>
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

function PhotoActionTray({
  panelNumber,
  shot,
  fit,
  onReplace,
  onToggleFit,
  onReset,
  onRemove,
  onOpenControls,
  onDone,
}: {
  panelNumber: number
  shot: Shot
  fit: PanelFit
  onReplace: () => void
  onToggleFit: () => void
  onReset: () => void
  onRemove: () => void
  onOpenControls: () => void
  onDone: () => void
}) {
  const transformIsDefault =
    Math.abs(shot.offsetX) < 0.001 &&
    Math.abs(shot.offsetY) < 0.001 &&
    Math.abs(shot.scale - 1) < 0.001 &&
    Math.abs(shot.rotation) < 0.001
  return (
    <motion.section
      className="photo-action-tray"
      role="group"
      aria-label={`Panel ${panelNumber} photo controls`}
      data-panel-number={panelNumber}
      initial={{ opacity: 0, y: 18, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 14, scale: 0.98 }}
      transition={{ duration: 0.16, ease: 'easeOut' }}
    >
      <div className="photo-action-summary">
        <div>
          <strong>{`Panel ${panelNumber}`}</strong>
          <span>{`${Math.round(shot.scale * 100)}% · ${formatRotation(shot.rotation)}`}</span>
          <em>Drag · pinch · rotate</em>
        </div>
        <span className="photo-action-summary-actions">
          <button type="button" className="photo-action-controls" aria-label="Open comic controls" onClick={onOpenControls}>
            <ActionIcon name="controls" />
          </button>
          <button type="button" className="photo-action-done" aria-label={`Done editing panel ${panelNumber}`} onClick={onDone}>
            Done
          </button>
        </span>
      </div>
      <div className="photo-action-buttons">
        <button type="button" aria-label={`Replace panel ${panelNumber} photo`} onClick={onReplace}>
          <ToolIcon name="replace" />
          <span>Replace</span>
        </button>
        <button
          type="button"
          aria-label={`Fit whole photo in panel ${panelNumber}`}
          aria-pressed={fit === 'contain'}
          onClick={onToggleFit}
        >
          <ToolIcon name="fit" />
          <span>{fit === 'contain' ? 'Fill' : 'Fit'}</span>
        </button>
        <button type="button" aria-label={`Reset panel ${panelNumber} photo`} disabled={transformIsDefault} onClick={onReset}>
          <ToolIcon name="reset" />
          <span>Reset</span>
        </button>
        <button className="is-danger" type="button" aria-label={`Remove panel ${panelNumber} photo`} onClick={onRemove}>
          <ToolIcon name="remove" />
          <span>Remove</span>
        </button>
      </div>
    </motion.section>
  )
}

function Drawer({
  open,
  tab,
  dragControls,
  children,
  onOpen,
  onClose,
  onTab,
  status,
}: {
  open: boolean
  tab: DrawerTab
  dragControls: ReturnType<typeof useDragControls>
  children: React.ReactNode
  onOpen: () => void
  onClose: () => void
  onTab: (tab: DrawerTab) => void
  status: string
}) {
  const tabTitle = tab === 'layout' ? 'Layout & canvas' : tab === 'style' ? 'Appearance' : 'Export comic'
  const drawerRef = useRef<HTMLElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const drawerTabs: Array<{ id: DrawerTab; label: string }> = [
    { id: 'layout', label: 'Layout' },
    { id: 'style', label: 'Style' },
    { id: 'export', label: 'Export' },
  ]

  function moveTabFocus(event: React.KeyboardEvent<HTMLButtonElement>, currentTab: DrawerTab) {
    const currentIndex = drawerTabs.findIndex((item) => item.id === currentTab)
    let nextIndex = currentIndex
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % drawerTabs.length
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + drawerTabs.length) % drawerTabs.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = drawerTabs.length - 1
    if (nextIndex === currentIndex && !['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) {
      return
    }
    event.preventDefault()
    const nextTab = drawerTabs[nextIndex].id
    onTab(nextTab)
    requestAnimationFrame(() => drawerRef.current?.querySelector<HTMLButtonElement>(`#drawer-tab-${nextTab}`)?.focus())
  }

  useEffect(() => {
    if (!open) {
      return
    }
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const drawer = drawerRef.current
    const focusableSelector = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'
    const focusFrame = requestAnimationFrame(() => drawer?.querySelector<HTMLElement>('.drawer-close')?.focus({ preventScroll: true }))

    function keepFocusInside(event: KeyboardEvent) {
      if (event.key !== 'Tab' || !drawer) {
        return
      }
      const focusable = Array.from(drawer.querySelectorAll<HTMLElement>(focusableSelector)).filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0 && !element.closest('[inert]'))
      const first = focusable[0]
      const last = focusable.at(-1)
      if (!first || !last) {
        return
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', keepFocusInside)
    return () => {
      document.removeEventListener('keydown', keepFocusInside)
      cancelAnimationFrame(focusFrame)
      previousFocusRef.current?.focus({ preventScroll: true })
    }
  }, [open])

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.button
            className="drawer-backdrop"
            type="button"
            tabIndex={-1}
            aria-label="Close controls"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
          />
        )}
      </AnimatePresence>
      <motion.aside
        ref={drawerRef}
        initial={false}
        className={`motion-drawer motion-drawer-${tab} ${open ? 'is-open' : ''}`}
        role="dialog"
        aria-modal={open || undefined}
        aria-label={tabTitle}
        aria-hidden={!open}
        inert={!open || undefined}
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
        <div className="drawer-heading">
          <div onPointerDown={(event) => dragControls.start(event)}>
            <span className="eyebrow">Make it yours</span>
            <h2>{tabTitle}</h2>
          </div>
          <button className="drawer-close" type="button" aria-label="Done editing comic" onClick={onClose}>
            Done
          </button>
        </div>
        <div className="drawer-tabs" role="tablist" aria-label="Comic controls">
          {drawerTabs.map((item) => (
            <button
              key={item.id}
              id={`drawer-tab-${item.id}`}
              className={tab === item.id ? 'active' : ''}
              role="tab"
              aria-controls={`drawer-panel-${item.id}`}
              aria-selected={tab === item.id}
              tabIndex={tab === item.id ? 0 : -1}
              type="button"
              onKeyDown={(event) => moveTabFocus(event, item.id)}
              onClick={() => onTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        {/* Keep one active tab panel in the DOM during navigation. */}
          <motion.div
            key={tab}
            id={`drawer-panel-${tab}`}
            className="drawer-content"
            role="tabpanel"
            aria-labelledby={`drawer-tab-${tab}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.16 }}
          >
            {children}
          </motion.div>
        {open && !/camera|panel.+live/i.test(status) && <p className={`drawer-feedback ${/(failed|not saved|could not|not applied|not deleted)/i.test(status) ? 'is-error' : ''}`} role="status">{status}</p>}
      </motion.aside>
    </>
  )
}

function LayoutPanel({
  layout,
  layouts,
  pageFormat,
  formats,
  onLayout,
  onFormat,
  onCreate,
  onEditCustomLayout,
  onDeleteCustomLayout,
}: {
  layout: Layout
  layouts: Layout[]
  pageFormat: PageFormat
  formats: PageFormat[]
  onLayout: (layout: Layout) => void
  onFormat: (format: PageFormat) => void
  onCreate: () => void
  onEditCustomLayout: (layoutId: string) => void
  onDeleteCustomLayout: (layoutId: string) => void
}) {
  const builtInLayouts = layouts.filter((option) => !option.custom)
  const savedLayouts = layouts.filter((option) => option.custom)

  return (
    <div className="layout-library">
      <section className="canvas-format-section" aria-labelledby="canvas-format-heading">
        <div className="canvas-format-heading">
          <div>
            <strong id="canvas-format-heading">Canvas format</strong>
            <span>The shape of your finished comic</span>
          </div>
          <em>{`${pageFormat.id} · ${pageFormat.label}`}</em>
        </div>
        <div className="drawer-format-grid" role="group" aria-label="Canvas format">
          {formats.map((format) => (
            <button
              key={format.id}
              type="button"
              className={pageFormat.id === format.id ? 'active' : ''}
              aria-pressed={pageFormat.id === format.id}
              onClick={() => onFormat(format)}
            >
              <span style={{ aspectRatio: `${format.width} / ${format.height}` }} aria-hidden="true" />
              <strong>{format.id}</strong>
              <em>{format.label}</em>
            </button>
          ))}
        </div>
      </section>

      <section className="layout-section" aria-labelledby="saved-grid-heading">
        <div className="layout-section-heading">
          <strong id="saved-grid-heading">Your grids</strong>
          <span>{savedLayouts.length > 0 ? `${savedLayouts.length} saved` : 'Saved locally'}</span>
        </div>
        <div className="layout-gallery saved-layout-gallery">
          <button className="layout-card create-card" type="button" onClick={onCreate}>
            <span className="layout-preview create-preview" aria-hidden="true">
              <ActionIcon name="plus" />
            </span>
            <span className="layout-card-copy">
              <strong>New grid</strong>
              <em>Create and save</em>
            </span>
          </button>
          {savedLayouts.map((option) => (
            <LayoutCard
              key={option.id}
              option={option}
              active={layout.id === option.id}
              onSelect={onLayout}
              onEdit={onEditCustomLayout}
              onDelete={onDeleteCustomLayout}
            />
          ))}
        </div>
      </section>

      <section className="layout-section" aria-labelledby="built-in-grid-heading">
        <div className="layout-section-heading">
          <strong id="built-in-grid-heading">Templates</strong>
          <span>{builtInLayouts.length} included</span>
        </div>
        <div className="layout-gallery">
          {builtInLayouts.map((option) => (
            <LayoutCard key={option.id} option={option} active={layout.id === option.id} onSelect={onLayout} />
          ))}
        </div>
      </section>
    </div>
  )
}

function LayoutCard({
  option,
  active,
  onSelect,
  onEdit,
  onDelete,
}: {
  option: Layout
  active: boolean
  onSelect: (layout: Layout) => void
  onEdit?: (layoutId: string) => void
  onDelete?: (layoutId: string) => void
}) {
  const panelLabel = `${option.panels.length} panel${option.panels.length === 1 ? '' : 's'}`
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  return (
    <div className={`layout-card-shell ${option.custom ? 'is-saved' : ''}`}>
      <button
        className={`layout-card ${active ? 'active' : ''} ${option.custom ? 'has-actions' : ''}`}
        type="button"
        aria-label={`Use ${option.name} layout, ${panelLabel}`}
        aria-pressed={active}
        data-layout-option-id={option.id}
        data-custom-layout={option.custom ? 'true' : 'false'}
        data-panel-count={option.panels.length}
        onClick={() => onSelect(option)}
      >
        <LayoutPreview layout={option} />
        <span className="layout-card-copy">
          <strong title={option.name}>{option.name}</strong>
          <em>{panelLabel}</em>
        </span>
      </button>
      {option.custom && onEdit && !confirmingDelete && (
        <button
          className="layout-card-action layout-edit"
          type="button"
          aria-label={`Edit ${option.name} grid`}
          onClick={() => onEdit(option.id)}
        >
          <span aria-hidden="true">Edit</span>
        </button>
      )}
      {option.custom && onDelete && !confirmingDelete && (
        <button
          className="layout-card-action layout-delete"
          type="button"
          aria-label={`Delete ${option.name} layout`}
          onClick={() => setConfirmingDelete(true)}
        >
          <ToolIcon name="remove" />
        </button>
      )}
      {option.custom && onDelete && confirmingDelete && (
        <div className="layout-delete-confirm" role="group" aria-label={`Delete ${option.name} layout?`}>
          <button type="button" onClick={() => setConfirmingDelete(false)}>Cancel</button>
          <button
            className="is-danger"
            type="button"
            autoFocus
            aria-label={`Confirm delete ${option.name} layout`}
            onClick={() => onDelete(option.id)}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  )
}

function LayoutPreview({ layout, specimen = false }: { layout: Layout; specimen?: boolean }) {
  const dividerWidth = layout.custom ? (layout.dividerThickness ?? 9) / 4 : 2.25
  const borderWidth = layoutBorderThickness(layout) ?? 0.8
  const borderColor = layoutBorderColor(layout) ?? '#939787'
  const panelStrokeWidth = layout.custom ? borderWidth : 0.8
  const previewStyle = {
    '--layout-preview-border': borderColor,
  } as React.CSSProperties

  return (
    <span className={`layout-preview ${specimen ? 'is-specimen' : ''}`} aria-hidden="true" data-layout-preview={layout.id} style={previewStyle}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" focusable="false">
        <rect className="layout-preview-paper" x="0" y="0" width="100" height="100" />
        {layout.panels.map((panel) =>
          panel.points ? (
            <polygon
              key={panel.id}
              className="layout-preview-panel"
              data-preview-panel={panel.id}
              points={panel.points.map(([x, y]) => `${x},${y}`).join(' ')}
              strokeWidth={panelStrokeWidth}
              vectorEffect="non-scaling-stroke"
            />
          ) : (
            <rect
              key={panel.id}
              className="layout-preview-panel"
              data-preview-panel={panel.id}
              x={panel.x * 100}
              y={panel.y * 100}
              width={panel.w * 100}
              height={panel.h * 100}
              strokeWidth={panelStrokeWidth}
              vectorEffect="non-scaling-stroke"
            />
          ),
        )}
        {specimen && layout.panels.map((panel, index) => {
          const center = panelCentroid(panel)
          return <text key={`number-${panel.id}`} className="specimen-number" x={center.x * 100} y={center.y * 100} textAnchor="middle" dominantBaseline="middle">{String(index + 1).padStart(2, '0')}</text>
        })}
        {layout.dividers?.map((divider, index) => {
          const paint = cutPaintSpan(divider, 1, divider.extent === 'canvas')
          return (
          <React.Fragment key={`${divider.id}-${index}`}>
            {borderWidth > 0 && (
              <line
                className="layout-preview-divider-border"
                x1={paint.x1}
                y1={paint.y1}
                x2={paint.x2}
                y2={paint.y2}
                strokeWidth={dividerWidth + borderWidth * 2}
                vectorEffect="non-scaling-stroke"
              />
            )}
            <line
              className="layout-preview-divider"
              data-preview-divider={divider.id}
              x1={paint.x1}
              y1={paint.y1}
              x2={paint.x2}
              y2={paint.y2}
              strokeWidth={dividerWidth}
              vectorEffect="non-scaling-stroke"
            />
          </React.Fragment>
          )
        })}
        {borderWidth > 0 && (
          <rect
            className="layout-preview-outline"
            x={borderWidth / 2}
            y={borderWidth / 2}
            width={100 - borderWidth}
            height={100 - borderWidth}
            rx="4"
            fill="none"
            strokeWidth={borderWidth}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
    </span>
  )
}

function CreatorPanel({
  draftName,
  draftLines,
  dividerThickness,
  borderColor,
  borderThickness,
  editing,
  pageFormat,
  paperColor,
  photoCache,
  photoFit,
  readingOrder,
  onName,
  onAddLine,
  onRemoveLine,
  onMoveLine,
  onThickness,
  onBorderColor,
  onBorderThickness,
  onReset,
  onSave,
  onCancel,
  onDirty,
  onRestore,
}: {
  draftName: string
  draftLines: CustomLine[]
  dividerThickness: number
  borderColor: string
  borderThickness: number
  editing: boolean
  pageFormat: PageFormat
  paperColor: string
  photoCache: Array<Shot | undefined>
  photoFit: PanelFit
  readingOrder: boolean
  onName: (name: string) => void
  onAddLine: (preset: CustomLinePreset) => void
  onRemoveLine: (lineId: string) => void
  onMoveLine: (lineId: string, update: Partial<CustomLine>, shouldSnap?: boolean) => void
  onThickness: (thickness: number) => void
  onBorderColor: (color: string) => void
  onBorderThickness: (thickness: number) => void
  onReset: () => void
  onSave: () => void
  onCancel: () => void
  onDirty: (dirty: boolean) => void
  onRestore: (draft: GridDraft) => void
}) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const [lineDrag, setLineDragState] = useState<{
    id: string
    mode: 'line' | 'start' | 'end'
    startX: number
    startY: number
    line: CustomLine
  } | null>(null)
  const lineDragRef = useRef<typeof lineDrag>(null)
  function setLineDrag(next: typeof lineDrag) {
    lineDragRef.current = next
    setLineDragState(next)
  }
  const [lineTouch, setLineTouch] = useState<LineTouchState | null>(null)
  const lineTouchRef = useRef<LineTouchState | null>(null)
  const linePointersRef = useRef<Map<number, { clientX: number; clientY: number }>>(new Map())
  const [selectedLineId, setSelectedLineId] = useState<string | null>(draftLines[0]?.id ?? null)
  const previousLineIds = useRef(draftLines.map((line) => line.id))
  const gridTools = ['dividers', 'adjust', 'borders', 'outlines', 'details'] as const
  type GridTool = (typeof gridTools)[number]
  const [toolTab, setToolTab] = useState<GridTool>('dividers')
  const toolPagerRef = useRef<HTMLDivElement>(null)
  const pagerSettleRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pagerTouchRef = useRef(false)
  const activeToolRef = useRef<GridTool>('dividers')
  function selectTool(tab: GridTool) {
    if (pagerSettleRef.current) clearTimeout(pagerSettleRef.current)
    activeToolRef.current = tab
    setToolTab(tab)
    const pager = toolPagerRef.current
    if (pager) pager.scrollTo({ left: gridTools.indexOf(tab) * pager.clientWidth, behavior: 'instant' })
  }
  function settleTools() {
    if (pagerSettleRef.current) clearTimeout(pagerSettleRef.current)
    pagerSettleRef.current = setTimeout(() => {
      const pager = toolPagerRef.current
      if (!pager || pagerTouchRef.current) return
      const index = Math.round(pager.scrollLeft / Math.max(1, pager.clientWidth))
      const next = gridTools[index]
      if (!next) return
      if (Math.abs(pager.scrollLeft - index * pager.clientWidth) > 1) {
        pager.scrollTo({
          left: index * pager.clientWidth,
          behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
        })
        return
      }
      if (next !== activeToolRef.current) {
        activeToolRef.current = next
        setToolTab(next)
        history.endGroup()
      }
    }, 120)
  }
  useEffect(() => {
    const pager = toolPagerRef.current
    if (!pager) return
    const observer = new ResizeObserver(() => {
      pager.scrollTo({ left: gridTools.indexOf(activeToolRef.current) * pager.clientWidth, behavior: 'instant' })
    })
    observer.observe(pager)
    return () => {
      observer.disconnect()
      if (pagerSettleRef.current) clearTimeout(pagerSettleRef.current)
    }
  }, [])
  const previousOutline = useRef(borderThickness || 1)
  const [previewing, setPreviewing] = useState(false)
  const [snapEnabled, setSnapEnabled] = useState(true)
  const history = useDraftHistory<GridDraft>(
    { name: draftName, lines: draftLines, thickness: dividerThickness, borderColor, borderThickness },
    onRestore,
  )
  useEffect(() => onDirty(history.dirty), [history.dirty, onDirty])
  const previewPanels = useMemo(() => panelsFromLines(draftLines, readingOrder), [draftLines, readingOrder])
  const canvasAspect = useContentAspect(canvasRef, pageFormatCanvasAspect(pageFormat))
  const creatorStyle = {
    '--creator-divider-thickness': `${dividerThickness}px`,
    '--creator-border-color': borderColor,
    '--creator-border-thickness': `${borderThickness}px`,
    '--creator-paper': paperColor,
    '--creator-handle-size': '44px',
    '--creator-page-width': pageFormat.width,
    '--creator-page-height': pageFormat.height,
  } as React.CSSProperties

  useEffect(() => {
    const added = draftLines.find((line) => !previousLineIds.current.includes(line.id))
    previousLineIds.current = draftLines.map((line) => line.id)
    if (added) {
      setSelectedLineId(added.id)
      setPreviewing(false)
      return
    }
    if (selectedLineId && draftLines.some((line) => line.id === selectedLineId)) {
      return
    }
    setSelectedLineId(draftLines[0]?.id ?? null)
  }, [draftLines, selectedLineId])

  function moveLine(lineId: string, update: Partial<CustomLine>, shouldSnap = true) {
    history.change(() => onMoveLine(lineId, update, shouldSnap && snapEnabled), 'move')
  }

  function deleteSelected() {
    if (selectedLineId) history.change(() => onRemoveLine(selectedLineId))
  }

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
    if (event.button !== 0) return
    if (linePointersRef.current.size === 0) history.endGroup()
    setSelectedLineId(line.id)
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
      const activeLine = draftLines.find((item) => item.id === selectedLineId) ?? line
      startLineTouch(activeLine, touches, rect)
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
    const lineDrag = lineDragRef.current
    if (!rect || !lineDrag) {
      return
    }

    const dx = ((event.clientX - lineDrag.startX) / rect.width) * 100
    const dy = ((event.clientY - lineDrag.startY) / rect.height) * 100

    if (lineDrag.mode === 'line') {
      if (lineDrag.line.extent === 'canvas') {
        moveLine(lineDrag.id, {
          x1: lineDrag.line.x1 + dx,
          y1: lineDrag.line.y1 + dy,
          x2: lineDrag.line.x2 + dx,
          y2: lineDrag.line.y2 + dy,
        })
        return
      }
      // Constrain the translation as a whole so a line cannot shrink at an edge.
      const moveX = clamp(
        dx,
        -Math.min(lineDrag.line.x1, lineDrag.line.x2),
        100 - Math.max(lineDrag.line.x1, lineDrag.line.x2),
      )
      const moveY = clamp(
        dy,
        -Math.min(lineDrag.line.y1, lineDrag.line.y2),
        100 - Math.max(lineDrag.line.y1, lineDrag.line.y2),
      )
      moveLine(lineDrag.id, {
        x1: lineDrag.line.x1 + moveX,
        y1: lineDrag.line.y1 + moveY,
        x2: lineDrag.line.x2 + moveX,
        y2: lineDrag.line.y2 + moveY,
      })
      return
    }

    if (lineDrag.mode === 'start') {
      moveLine(lineDrag.id, {
        x1: lineDrag.line.x1 + dx,
        y1: lineDrag.line.y1 + dy,
      })
      return
    }

    moveLine(lineDrag.id, {
      x2: lineDrag.line.x2 + dx,
      y2: lineDrag.line.y2 + dy,
    })
  }

  function nudgeLine(event: React.KeyboardEvent<HTMLButtonElement>, line: CustomLine, mode: 'line' | 'start' | 'end') {
    const directions: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }
    const direction = directions[event.key]
    if (!direction) {
      return
    }
    event.preventDefault()
    setSelectedLineId(line.id)
    const step = event.shiftKey ? 2 : 0.5
    const dx = direction[0] * step
    const dy = direction[1] * step
    if (mode === 'line') {
      if (line.extent === 'canvas') {
        moveLine(line.id, { x1: line.x1 + dx, y1: line.y1 + dy, x2: line.x2 + dx, y2: line.y2 + dy }, false)
        return
      }
      const moveX = clamp(dx, -Math.min(line.x1, line.x2), 100 - Math.max(line.x1, line.x2))
      const moveY = clamp(dy, -Math.min(line.y1, line.y2), 100 - Math.max(line.y1, line.y2))
      moveLine(line.id, { x1: line.x1 + moveX, y1: line.y1 + moveY, x2: line.x2 + moveX, y2: line.y2 + moveY }, false)
    } else if (mode === 'start') {
      moveLine(line.id, { x1: line.x1 + dx, y1: line.y1 + dy }, false)
    } else {
      moveLine(line.id, { x2: line.x2 + dx, y2: line.y2 + dy }, false)
    }
  }

  function moveLinePointer(event: PointerEvent<HTMLElement>) {
    if (event.pointerType === 'touch') {
      if (!linePointersRef.current.has(event.pointerId)) return
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
      history.endGroup()
      return
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    linePointersRef.current.delete(event.pointerId)
    const activeLine = draftLines.find((line) => line.id === (lineTouchRef.current?.id ?? lineDrag?.id))
    lineTouchRef.current = null
    setLineTouch(null)
    const remaining = Array.from(linePointersRef.current.values())[0]
    if (remaining && activeLine) {
      setLineDrag({
        id: activeLine.id,
        mode: 'line',
        startX: remaining.clientX,
        startY: remaining.clientY,
        line: activeLine,
      })
    }
    if (linePointersRef.current.size === 0) {
      setLineDrag(null)
      history.endGroup()
    }
  }

  function beginCanvasPointer(event: PointerEvent<HTMLElement>) {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = ((event.clientX - rect.left) / rect.width) * 100
    const y = ((event.clientY - rect.top) / rect.height) * 100
    const continuing = linePointersRef.current.size === 1
    const line = continuing
      ? draftLines.find((item) => item.id === selectedLineId)
      : nearestLineToPoint(draftLines, x, y, canvasAspect)
    if (line && !continuing && (lineDistanceToPoint(line, x, y, canvasAspect) * rect.width) / 100 > 22) return
    if (line) beginLinePointer(event, line, 'line')
  }

  const selectedLine = draftLines.find((line) => line.id === selectedLineId)
  const { angle: selectedAngle, position: selectedPosition } = selectedLine
    ? cutControls(selectedLine, canvasAspect)
    : { angle: 0, position: 50 }

  function reshapeSelected(angle: number, position: number) {
    if (!selectedLine) return
    moveLine(selectedLine.id, { ...cutAt(angle, position, canvasAspect), extent: 'canvas' }, false)
  }

  function startLineTouch(line: CustomLine, touches: TouchPoints, rect: DOMRect) {
    const center = touchCenterPercent(touches, rect)
    setSelectedLineId(line.id)
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

  function updateLineTouch(touches: TouchPoints) {
    const activeTouch = lineTouchRef.current
    if (!activeTouch || touches.length < 2) {
      return
    }

    const center = touchCenterPercent(touches, activeTouch.rect)
    const scale =
      activeTouch.line.extent === 'canvas' ? 1 : clamp(touchDistance(touches) / activeTouch.startDistance, 0.35, 3)
    const rotation = angleDelta(activeTouch.startAngle, touchAngle(touches))
    moveLine(
      activeTouch.id,
      transformLineByTouch(
        activeTouch.line,
        activeTouch.startCenterX,
        activeTouch.startCenterY,
        center.x,
        center.y,
        scale,
        rotation,
        canvasAspect,
      ),
    )
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
    event.stopPropagation()
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
      data-border-color={borderColor}
      data-border-thickness={borderThickness}
      data-page-format={pageFormat.id}
      onSubmit={submitLayout}
      onPointerUpCapture={(event) => {
        if (!canvasRef.current?.contains(event.target as Node)) history.endGroup()
      }}
      onPointerCancelCapture={(event) => {
        if (!canvasRef.current?.contains(event.target as Node)) history.endGroup()
      }}
      onBlurCapture={history.endGroup}
      onKeyUpCapture={(event) => {
        if (event.key.startsWith('Arrow')) history.endGroup()
      }}
      onKeyDown={(event) => {
        if ((event.target as HTMLElement).matches('input, select, textarea')) return
        if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
          event.preventDefault()
          event.stopPropagation()
          if (event.shiftKey || event.key.toLowerCase() === 'y') history.redo()
          else history.undo()
        } else if ((event.key === 'Delete' || event.key === 'Backspace') && !previewing) {
          event.preventDefault()
          deleteSelected()
        }
      }}
    >
      <div className="creator-topbar">
        <button type="button" onClick={onCancel} aria-label="Close creator">
          <ActionIcon name="close" /><span>Close</span>
        </button>
        <div className="creator-title">
          <strong>{editing ? 'Edit grid' : 'Create grid'}</strong>
          <span>
            {pageFormat.id} canvas · {history.dirty ? 'Unsaved changes' : 'Make it yours'}
          </span>
        </div>
        <button
          type="submit"
          className="primary"
          aria-label={editing ? 'Update layout' : 'Save layout'}
          onClick={(event) => event.stopPropagation()}
          onTouchEnd={(event) => event.stopPropagation()}
        >
          {editing ? 'Update' : 'Save'}
        </button>
      </div>
      <div className="creator-workbench">
        <div className="creator-stage">
          <div className="creator-stage-toolbar">
            <span>{previewPanels.length} panels</span>
            <div role="group" aria-label="Grid editing history">
              <button type="button" aria-label="Undo grid edit" disabled={!history.canUndo} onClick={history.undo}>
                <ToolIcon name="undo" />
              </button>
              <button type="button" aria-label="Redo grid edit" disabled={!history.canRedo} onClick={history.redo}>
                <ToolIcon name="redo" />
              </button>
            </div>
            <button
              type="button"
              className="creator-preview-toggle"
              aria-pressed={previewing}
              onClick={() => setPreviewing(!previewing)}
            >
              {previewing ? 'Edit grid' : 'Preview'}
            </button>
          </div>
          <div className="creator-canvas-zone">
            <div
              ref={canvasRef}
              className={`creator-canvas ${previewing ? 'is-previewing' : ''}`}
              aria-label="Drag layout divider handles"
              data-page-format={pageFormat.id}
              inert={previewing || undefined}
              onPointerDown={beginCanvasPointer}
              onPointerMove={(event) => {
                if (event.target === event.currentTarget) moveLinePointer(event)
              }}
              onPointerUp={(event) => {
                if (event.target === event.currentTarget) endLinePointer(event)
              }}
              onPointerCancel={(event) => {
                if (event.target === event.currentTarget) endLinePointer(event)
              }}
            >
              {previewPanels.map((panel, index) => (
                <div key={panel.id} className="creator-panel" style={panelStyle(panel)}>
                  {photoCache[index] && (
                    <img
                      src={photoCache[index].dataUrl}
                      alt=""
                      draggable={false}
                      data-preview-asset={photoCache[index].assetId}
                      style={shotImageStyle(panel, photoCache[index], photoCache[index].fit ?? photoFit, pageFormat)}
                    />
                  )}
                </div>
              ))}
              {previewPanels.map((panel, index) => (
                <span
                  key={`number-${panel.id}`}
                  className="creator-panel-number"
                  style={panelCenterStyle(panel)}
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
              ))}
              {draftLines.map((line, index) => (
                <React.Fragment key={line.id}>
                  <button
                    className={`creator-line-hit ${selectedLineId === line.id ? 'is-selected' : ''}`}
                    style={lineSegmentStyle(line, canvasAspect)}
                    type="button"
                    aria-label={`Move divider ${index + 1}`}
                    data-divider-id={line.id}
                    aria-pressed={selectedLineId === line.id}
                    onFocus={() => setSelectedLineId(line.id)}
                    onPointerDown={(event) => beginLinePointer(event, line, 'line')}
                    onPointerMove={moveLinePointer}
                    onPointerUp={endLinePointer}
                    onPointerCancel={endLinePointer}
                    onKeyDown={(event) => nudgeLine(event, line, 'line')}
                  />
                  <div className="creator-cut-clip" aria-hidden="true">
                    <span
                      className={`creator-free-line ${selectedLineId === line.id ? 'is-selected' : ''} ${lineDrag?.id === line.id || lineTouch?.id === line.id ? 'is-active' : ''}`}
                      style={lineSegmentStyle(line, canvasAspect, true)}
                      aria-hidden="true"
                      data-divider-id={line.id}
                      data-divider-index={index}
                      data-divider-x1={line.x1.toFixed(2)}
                      data-divider-y1={line.y1.toFixed(2)}
                      data-divider-x2={line.x2.toFixed(2)}
                      data-divider-y2={line.y2.toFixed(2)}
                    >
                      <i className="creator-cut-guide" />
                    </span>
                  </div>
                  <button
                    className={`creator-handle creator-handle-start ${selectedLineId === line.id ? 'is-selected' : ''} ${lineDrag?.id === line.id || lineTouch?.id === line.id ? 'is-active' : ''}`}
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
                    onKeyDown={(event) => nudgeLine(event, line, 'start')}
                  />
                  <button
                    className={`creator-handle creator-handle-end ${selectedLineId === line.id ? 'is-selected' : ''} ${lineDrag?.id === line.id || lineTouch?.id === line.id ? 'is-active' : ''}`}
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
                    onKeyDown={(event) => nudgeLine(event, line, 'end')}
                  />
                </React.Fragment>
              ))}
            </div>
          </div>
          <p className="creator-gesture-hint">
            {previewing
              ? 'Your finished grid. Tap Edit grid to keep shaping it.'
              : 'Drag to position · Two fingers to rotate'}
          </p>
        </div>
        <div className="creator-side">
          <div className="creator-tool-tabs" role="tablist" aria-label="Grid tools">
            {gridTools.map((tab, index, tabs) => (
              <button
                key={tab}
                id={`grid-tab-${tab}`}
                type="button"
                role="tab"
                aria-selected={toolTab === tab}
                aria-controls={`grid-tools-${tab}`}
                tabIndex={toolTab === tab ? 0 : -1}
                onClick={() => selectTool(tab)}
                onKeyDown={(event) => {
                  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                  event.preventDefault()
                  const next =
                    event.key === 'Home'
                      ? tabs[0]
                      : event.key === 'End'
                        ? tabs[tabs.length - 1]
                        : tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]
                  selectTool(next)
                  document.getElementById(`grid-tab-${next}`)?.focus()
                }}
              >
                {tab === 'dividers'
                  ? 'Dividers'
                  : tab === 'adjust'
                    ? 'Adjust'
                    : tab === 'borders'
                      ? 'Style'
                      : tab === 'outlines'
                        ? 'Outline'
                        : 'Details'}
              </button>
            ))}
          </div>
          <div
            className="creator-tool-content"
            ref={toolPagerRef}
            onScroll={settleTools}
            onTouchStartCapture={() => {
              pagerTouchRef.current = true
            }}
            onTouchEndCapture={(event) => {
              pagerTouchRef.current = event.touches.length > 0
              settleTools()
            }}
            onTouchCancelCapture={() => {
              pagerTouchRef.current = false
              settleTools()
            }}
          >
            <section
              className="creator-control-section"
              id="grid-tools-dividers"
              role="tabpanel"
              aria-labelledby="grid-tab-dividers"
              inert={toolTab !== 'dividers' || undefined}
              aria-hidden={toolTab !== 'dividers'}
            >
              <div className="creator-control-heading">
                <strong>Divide the canvas</strong>
                <span>Edge to edge. Always connected.</span>
              </div>
              <div className="creator-divider-tools">
                {(['vertical', 'horizontal', 'diagonal'] as const).map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    aria-label={`${preset[0].toUpperCase()}${preset.slice(1)} divider`}
                    onClick={() => history.change(() => onAddLine(preset))}
                  >
                    <span className={`divider-tool-icon is-${preset}`} aria-hidden="true">
                      <i />
                    </span>
                    {preset[0].toUpperCase()}
                    {preset.slice(1)}
                  </button>
                ))}
              </div>
              <div className="creator-selection-row">
                <label>
                  <span className="sr-status">Selected divider</span>
                  <select
                    aria-label="Selected divider"
                    value={selectedLineId ?? ''}
                    disabled={!draftLines.length}
                    onChange={(event) => {
                      setSelectedLineId(event.target.value)
                      setPreviewing(false)
                    }}
                  >
                    {!draftLines.length && <option value="">No dividers</option>}
                    {draftLines.map((line, index) => (
                      <option key={line.id} value={line.id}>
                        Divider {index + 1}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="creator-snap-toggle"
                  type="button"
                  aria-pressed={snapEnabled}
                  onClick={() => setSnapEnabled(!snapEnabled)}
                >
                  Snap {snapEnabled ? 'on' : 'off'}
                </button>
                <button
                  className="is-danger"
                  type="button"
                  aria-label="Delete selected"
                  disabled={!selectedLineId}
                  onClick={deleteSelected}
                >
                  <ToolIcon name="remove" />
                </button>
              </div>
            </section>
            <section
              className="creator-control-section"
              id="grid-tools-adjust"
              role="tabpanel"
              aria-labelledby="grid-tab-adjust"
              inert={toolTab !== 'adjust' || undefined}
              aria-hidden={toolTab !== 'adjust'}
            >
              <span className="creator-page-caption">
                {selectedLine
                  ? `Divider ${draftLines.indexOf(selectedLine) + 1} · Drag on the canvas to select`
                  : 'Add a divider to start shaping your grid'}
              </span>
              {selectedLine && (
                <div className="creator-precision-group">
                  {selectedLine.extent !== 'canvas' ? (
                    <button
                      className="creator-extend"
                      type="button"
                      onClick={() => {
                        history.endGroup()
                        reshapeSelected(selectedAngle, selectedPosition)
                        history.endGroup()
                      }}
                    >
                      Extend divider to canvas edges
                    </button>
                  ) : (
                    <>
                      <RangeField
                        label="Angle"
                        value={Math.round(selectedAngle)}
                        min={-90}
                        max={90}
                        unit="°"
                        onChange={(angle) => reshapeSelected(angle, selectedPosition)}
                      />
                      <RangeField
                        label="Position"
                        value={Math.round(selectedPosition)}
                        min={5}
                        max={95}
                        unit="%"
                        onChange={(position) => reshapeSelected(selectedAngle, position)}
                      />
                    </>
                  )}
                </div>
              )}
            </section>

            <section
              className="creator-control-section"
              id="grid-tools-borders"
              role="tabpanel"
              aria-labelledby="grid-tab-borders"
              inert={toolTab !== 'borders' || undefined}
              aria-hidden={toolTab !== 'borders'}
            >
              <div className="creator-control-heading">
                <strong id="grid-appearance-heading">Give each moment room</strong>
                <span>Adjust the space between your panels.</span>
              </div>
              <div className="creator-precision-group">
                <RangeField
                  label="Spacing"
                  ariaLabel="Divider thickness"
                  value={dividerThickness}
                  min={0}
                  max={24}
                  unit="px"
                  onChange={(value) => history.change(() => onThickness(value), 'gap')}
                />
              </div>
            </section>
            <section
              className="creator-control-section"
              id="grid-tools-outlines"
              role="tabpanel"
              aria-labelledby="grid-tab-outlines"
              inert={toolTab !== 'outlines' || undefined}
              aria-hidden={toolTab !== 'outlines'}
            >
              <div className="creator-outline-group">
                <button
                  className="creator-switch-row"
                  type="button"
                  role="switch"
                  aria-label="Panel outlines"
                  aria-checked={borderThickness > 0}
                  onClick={() => {
                    if (borderThickness > 0) previousOutline.current = borderThickness
                    history.change(() => {
                      onBorderThickness(borderThickness > 0 ? 0 : previousOutline.current)
                    })
                  }}
                >
                  <span>
                    <strong>Panel outlines</strong>
                    <small>Add an edge around your panels</small>
                  </span>
                  <span className="creator-switch" aria-hidden="true" />
                </button>
                {borderThickness > 0 && (
                  <div className="creator-outline-options">
                    <RangeField
                      label="Outline width"
                      value={borderThickness}
                      min={1}
                      max={10}
                      unit="px"
                      onChange={(value) => history.change(() => onBorderThickness(value), 'border')}
                    />
                    <ColorField
                      label="Outline color"
                      value={borderColor}
                      onChange={(value) => history.change(() => onBorderColor(value), 'color')}
                    />
                  </div>
                )}
              </div>
            </section>

            <section
              className="creator-control-section"
              id="grid-tools-details"
              role="tabpanel"
              aria-labelledby="grid-tab-details"
              inert={toolTab !== 'details' || undefined}
              aria-hidden={toolTab !== 'details'}
            >
              <div className="creator-control-heading">
                <strong id="grid-details-heading">Details</strong>
                <span>Name this grid for your library</span>
              </div>
              <label className="field text-field">
                <span>Grid name</span>
                <input
                  value={draftName}
                  placeholder="My grid"
                  aria-label="Grid name"
                  autoComplete="off"
                  enterKeyHint="done"
                  maxLength={48}
                  onChange={(event) => history.change(() => onName(event.target.value), 'name')}
                />
              </label>
              <div className="creator-actions">
                <button type="button" onClick={() => history.change(onReset)}>
                  Reset grid
                </button>
              </div>
            </section>
          </div>
          <div className="creator-page-indicator" aria-hidden="true">
            {gridTools.map((tab) => (
              <i key={tab} className={toolTab === tab ? 'is-current' : ''} />
            ))}
            <span>Swipe for more tools</span>
          </div>
        </div>
      </div>
    </form>
  )
}

function StylePanel({
  settings,
  onSettings,
  onReset,
}: {
  settings: Settings
  onSettings: (settings: Partial<Settings>) => void
  onReset: () => void
}) {
  const presets = [
    { name: 'Clean', background: '#ffffff', borderColor: '#111111', border: 0, gutters: 8, radius: 0 },
    { name: 'Paper', background: '#f3ede2', borderColor: '#51483e', border: 1, gutters: 12, radius: 4 },
    { name: 'Bold', background: '#111111', borderColor: '#111111', border: 3, gutters: 6, radius: 0 },
  ]
  return (
    <div className="drawer-stack style-stack">
      <SettingsSection title="Start with a look" description="One tap to set the mood. Fine-tune anything below.">
        <div className="style-presets" role="group" aria-label="Appearance presets">
          {presets.map(({ name, ...preset }) => (
            <button
              key={name}
              type="button"
              aria-pressed={Object.entries(preset).every(([key, value]) => settings[key as keyof Settings] === value)}
              onClick={() => onSettings(preset)}
            >
              <span
                className="style-preset-preview"
                style={{ background: preset.background, color: preset.borderColor }}
                aria-hidden="true"
              >
                <i />
                <i />
              </span>
              {name}
            </button>
          ))}
        </div>
      </SettingsSection>
      <SettingsSection title="Caption" description="Add an optional title to the finished comic.">
        <label className="field text-field">
          <span>Caption text</span>
          <input
            value={settings.caption}
            placeholder="Add a title…"
            onChange={(event) => onSettings({ caption: event.target.value })}
          />
        </label>
        <ColorField
          label="Caption color"
          value={settings.captionColor}
          onChange={(captionColor) => onSettings({ captionColor })}
        />
      </SettingsSection>

      <SettingsSection title="Canvas" description="Set the page and line colors.">
        <div className="color-field-grid">
          <ColorField label="Paper" value={settings.background} onChange={(background) => onSettings({ background })} />
          <ColorField
            label="Panel stroke"
            value={settings.borderColor}
            onChange={(borderColor) => onSettings({ borderColor })}
          />
        </div>
      </SettingsSection>

      <SettingsSection title="Panels" description="Tune spacing and edge treatment across the whole grid.">
        <div className="fit-segmented" role="group" aria-label="Default photo fit">
          <button
            type="button"
            className={settings.fit === 'cover' ? 'active' : ''}
            aria-pressed={settings.fit === 'cover'}
            onClick={() => onSettings({ fit: 'cover' })}
          >
            <strong>Fill</strong>
            <span>Crop to frame</span>
          </button>
          <button
            type="button"
            className={settings.fit === 'contain' ? 'active' : ''}
            aria-pressed={settings.fit === 'contain'}
            onClick={() => onSettings({ fit: 'contain' })}
          >
            <strong>Fit</strong>
            <span>Show whole photo</span>
          </button>
        </div>
        <RangeField
          label="Panel gap"
          value={settings.gutters}
          min={0}
          max={24}
          unit="px"
          onChange={(gutters) => onSettings({ gutters })}
        />
        <RangeField
          label="Corner radius"
          value={settings.radius}
          min={0}
          max={24}
          unit="px"
          onChange={(radius) => onSettings({ radius })}
        />
        <RangeField
          label="Stroke width"
          value={settings.border}
          min={0}
          max={10}
          unit="px"
          onChange={(border) => onSettings({ border })}
        />
      </SettingsSection>

      <button className="settings-reset" type="button" onClick={onReset}>
        Reset appearance
      </button>
    </div>
  )
}

function ExportPanel({
  settings,
  capturedCount,
  panelCount,
  pageFormat,
  imageExporting,
  photoProcessing,
  videoRendering,
  videoProgress,
  videoProgressPhase,
  readyVideo,
  onSettings,
  onDownloadImage,
  onShareImage,
  onExportVideo,
  onDownloadVideo,
  onShareVideo,
  onDismissVideo,
}: {
  settings: Settings
  capturedCount: number
  panelCount: number
  pageFormat: PageFormat
  imageExporting: boolean
  photoProcessing: boolean
  videoRendering: boolean
  videoProgress: number
  videoProgressPhase: StoryVideoRenderPhase
  readyVideo: ReadyStoryVideo | null
  onSettings: (settings: Partial<Settings>) => void
  onDownloadImage: () => Promise<void>
  onShareImage: () => Promise<void>
  onExportVideo: () => Promise<void>
  onDownloadVideo: (video: ReadyStoryVideo) => void
  onShareVideo: (video: ReadyStoryVideo) => Promise<void>
  onDismissVideo: () => void
}) {
  const exportWidth = 1440
  const exportHeight = Math.round((exportWidth * pageFormat.height) / pageFormat.width)
  const isIncomplete = capturedCount < panelCount
  const imageBusy = imageExporting || photoProcessing
  return (
    <div className="export-stack">
      <section className="export-card export-image-card">
        <div className="export-card-heading">
          <span className="export-card-icon" aria-hidden="true"><ActionIcon name="image" /></span>
          <div>
            <strong>The finished comic</strong>
            <span>{`${exportWidth} × ${exportHeight} PNG`}</span>
          </div>
        </div>
        <p className="export-intro">Made by you. Ready for the world.</p>
        {isIncomplete && (
          <div className="export-warning" role="status">
            <strong>{`${panelCount - capturedCount} panel${panelCount - capturedCount === 1 ? '' : 's'} still empty`}</strong>
            <span>You can export now, but empty panels will remain blank.</span>
          </div>
        )}
        {photoProcessing && (
          <div className="export-warning" role="status">
            <strong>Finishing the latest photo</strong>
            <span>Download and share will unlock as soon as it is safely in the comic.</span>
          </div>
        )}
        <div className="export-image-actions">
          <button className="primary export-primary" type="button" disabled={imageBusy} onClick={() => void onDownloadImage()}>
            <ActionIcon name="image" />
            {imageExporting ? 'Preparing…' : 'Download PNG'}
          </button>
          <button className="export-secondary" type="button" disabled={imageBusy} onClick={() => void onShareImage()}>
            <ActionIcon name="share" />
            Share PNG
          </button>
        </div>
        <p>Full resolution. No watermark. Yours to keep.</p>
      </section>

      <section className="export-card video-settings">
        <div className="export-card-heading">
          <span className="export-card-icon" aria-hidden="true"><ActionIcon name="video" /></span>
          <div>
            <strong>Story video</strong>
            <span>Animated panel reveal for stories and reels</span>
          </div>
        </div>
        <RangeField label="Duration" ariaLabel="Video duration" value={settings.videoDuration} min={3} max={10} unit="s" onChange={(videoDuration) => onSettings({ videoDuration })} />
        <RangeField label="Reveal speed" ariaLabel="Video speed" value={settings.videoSpeed} min={0.6} max={1.8} step={0.1} unit="×" onChange={(videoSpeed) => onSettings({ videoSpeed })} />

        {videoRendering ? (
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
        ) : readyVideo ? (
          <div className="video-ready-card" role="region" aria-label="Video ready actions">
            <span className="sr-status" role="status" aria-live="polite">Story video ready.</span>
            <div>
              <strong>Video ready</strong>
              <em>{`${readyVideo.width} × ${readyVideo.height} ${readyVideo.extension.toUpperCase()}`}</em>
            </div>
            <div className="video-ready-actions">
              <button type="button" onClick={() => onDownloadVideo(readyVideo)}>Download video</button>
              <button type="button" onClick={() => void onShareVideo(readyVideo)}>Share video</button>
              <button type="button" aria-label="Dismiss video ready" onClick={onDismissVideo}><ActionIcon name="close" /></button>
            </div>
          </div>
        ) : (
          <button className="primary export-primary" type="button" disabled={photoProcessing || imageExporting} onClick={() => void onExportVideo()}>
            <ActionIcon name="video" />
            Export story video
          </button>
        )}
      </section>
    </div>
  )
}

function InstallNudge({
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
    <details className="install-nudge">
      <summary>
        <span className="install-nudge-icon" aria-hidden="true"><ActionIcon name="install" /></span>
        <span>
          <strong>Install for faster access</strong>
          <em>Optional · the browser editor works too</em>
        </span>
        <i aria-hidden="true"><ActionIcon name="arrow" /></i>
      </summary>
      <div className="install-nudge-body">
        <p>Keep Instacomic on your Home Screen for a full-screen, app-like editor.</p>
        {deferredPrompt ? (
          <button className="installer-primary" type="button" onClick={() => void onTriggerNativeInstall()}>
            Add to Home Screen
          </button>
        ) : (
          <div className="installer-note" role="status">
            Use {browserName}'s menu and choose <strong>Add to Home Screen</strong> or <strong>Install app</strong>.
          </div>
        )}
        <ol className="installer-steps">
          {appContext.isIos ? (
            <>
              {!isSafari && <li>Open this page in Safari.</li>}
              <li>Tap Share in the browser toolbar.</li>
              <li>Choose Add to Home Screen.</li>
            </>
          ) : (
            <>
              <li>Open the browser menu.</li>
              <li>Choose Install app or Add to Home screen.</li>
            </>
          )}
        </ol>
      </div>
    </details>
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
    drawDividerGap(context, divider, width, panelHeight, outer, gutter, settings.background, settings.border * 3, settings.borderColor)
  }

  if (settings.caption.trim()) {
    const captionHeight = Math.min(130, panelHeight * 0.22)
    const captionY = panelHeight - captionHeight - outer - gutter / 2
    context.fillStyle = '#ffffff'
    context.fillRect(outer + gutter / 2, captionY, width - outer * 2 - gutter, captionHeight - gutter)
    context.strokeStyle = settings.borderColor
    context.lineWidth = settings.border > 0 ? Math.max(3, settings.border * 3) : 0
    context.strokeRect(outer + gutter / 2, captionY, width - outer * 2 - gutter, captionHeight - gutter)
    context.fillStyle = settings.captionColor
    context.font = '700 68px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(settings.caption, width / 2, captionY + captionHeight / 2, width - 130)
  }

  drawOuterBezel(context, width, panelHeight, outer, settings)

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
      drawDividerGap(
        context,
        divider,
        width,
        panelHeight,
        outer,
        gutter,
        settings.background,
        settings.border * styleScale,
        settings.borderColor,
      )
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
    context.strokeStyle = settings.borderColor
    context.lineWidth = Math.max(2, settings.border * styleScale)
    context.strokeRect(outer + gutter / 2, captionY, width - outer * 2 - gutter, captionHeight - gutter)
    context.fillStyle = settings.captionColor
    context.font = `700 ${Math.round(50 * (width / 1080))}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(settings.caption, width / 2, captionY + captionHeight / 2, width - 96)
    context.restore()
  }

  drawOuterBezel(context, width, panelHeight, outer, settings)
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
    { mimeType: 'video/mp4;codecs=avc1.42E01E', extension: 'mp4' },
    { mimeType: 'video/mp4;codecs=avc1.4D401E', extension: 'mp4' },
    { mimeType: 'video/mp4;codecs=avc1.640028', extension: 'mp4' },
    { mimeType: 'video/mp4;codecs=h264', extension: 'mp4' },
    { mimeType: 'video/mp4', extension: 'mp4' },
  ]
  const supported = formats.find((format) => MediaRecorder.isTypeSupported(format.mimeType))
  if (supported) {
    return supported
  }

  throw new Error('MP4 story video export is unavailable in this browser.')
}

function drawOuterBezel(
  context: CanvasRenderingContext2D,
  width: number,
  panelHeight: number,
  outer: number,
  settings: Settings,
) {
  const lineWidth = outer > 0 ? Math.max(2, outer) : 0
  if (lineWidth <= 0) {
    return
  }

  const inset = lineWidth / 2
  context.save()
  context.lineWidth = lineWidth
  context.strokeStyle = settings.borderColor
  drawRoundedRect(context, inset, inset, width - inset * 2, panelHeight - inset * 2, Math.max(10, settings.radius * 3))
  context.stroke()
  context.restore()
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
    drawImageFit(context, image, x, y, w, h, shot?.fit ?? settings.fit, shot ?? createShot('', ''))
  } else {
    drawEmptyPanel(context, x, y, w, h)
  }
  context.restore()

  if (settings.border > 0) {
    context.lineWidth = Math.max(2, settings.border * styleScale)
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
  borderWidth: number,
  borderColor: string,
) {
  const innerWidth = width - outer * 2
  const innerHeight = panelHeight - outer * 2
  const paint = cutPaintSpan(line, innerHeight / innerWidth, line.extent === 'canvas')
  const x1 = outer + (paint.x1 / 100) * innerWidth
  const y1 = outer + (paint.y1 / 100) * innerHeight
  const x2 = outer + (paint.x2 / 100) * innerWidth
  const y2 = outer + (paint.y2 / 100) * innerHeight

  context.save()
  context.beginPath()
  context.rect(outer, outer, innerWidth, innerHeight)
  context.clip()
  context.lineCap = 'butt'
  if (borderWidth > 0) {
    context.strokeStyle = borderColor
    context.lineWidth = gutter + borderWidth * 2
    context.beginPath()
    context.moveTo(x1, y1)
    context.lineTo(x2, y2)
    context.stroke()
  }
  if (gutter > 0) {
    context.strokeStyle = color
    context.lineWidth = gutter
    context.beginPath()
    context.moveTo(x1, y1)
    context.lineTo(x2, y2)
    context.stroke()
  }
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
    '--chip-x': `${((center.x - panel.x) / panel.w) * 100}%`,
    '--chip-y': `${((center.y - panel.y) / panel.h) * 100}%`,
  }
}

function panelCenterStyle(panel: Panel) {
  const center = panelCentroid(panel)
  return {
    left: `${center.x * 100}%`,
    top: `${center.y * 100}%`,
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
    transform: `rotate(${shot.rotation}deg)`,
    transformOrigin: 'center',
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
  const centerX = x + w / 2 + offsetX
  const centerY = y + h / 2 + offsetY
  context.save()
  context.translate(centerX, centerY)
  context.rotate((shot.rotation * Math.PI) / 180)
  context.drawImage(image, -drawW / 2, -drawH / 2, drawW, drawH)
  context.restore()
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
  context.fillStyle = '#f2f2f7'
  context.fillRect(x, y, w, h)
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
  return stillPhoto ?? (await captureVideoFrame(video))
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
  const dimensions = await loadBlobDimensions(blob)
  return {
    blob,
    width: dimensions.width,
    height: dimensions.height,
  }
}

async function captureVideoFrame(video: HTMLVideoElement): Promise<CapturedPhoto> {
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
  const blob = await canvasToBlob(canvas, 'image/jpeg', 0.92)
  return {
    blob,
    width,
    height,
  }
}

async function loadBlobDimensions(blob: Blob) {
  const url = URL.createObjectURL(blob)
  try {
    const image = await loadImage(url)
    return {
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob)
      } else {
        reject(new Error('Photo capture failed.'))
      }
    }, type, quality)
  })
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function createDraftLine(preset: CustomLinePreset, index = 0): CustomLine {
  const offset = (index % 4) * 8
  const base = {
    id: `${preset}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    extent: 'canvas' as const,
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

function lineSegmentStyle(source: CustomLine, canvasAspect: number, painting = false) {
  const line = painting ? cutPaintSpan(source, canvasAspect, source.extent === 'canvas') : source
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

function panelsFromLines(lines: CustomLine[], readingOrder = true) {
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
    .sort((first, second) => {
      // Existing grids keep their panel-to-photo mapping when edited.
      if (!readingOrder) return 0
      const a = panelCentroid(first)
      const b = panelCentroid(second)
      return Math.round(a.y * 10) - Math.round(b.y * 10) || a.x - b.x
    })
    .map((panel, index) => ({ ...panel, id: String(index + 1) }))
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

function normalizeAngle(angle: number) {
  if (!Number.isFinite(angle)) {
    return 0
  }

  let normalized = angle % 360
  if (normalized > 180) {
    normalized -= 360
  }
  if (normalized <= -180) {
    normalized += 360
  }
  return normalized
}

function angularDistance(first: number, second: number) {
  return Math.abs(normalizeAngle(first - second))
}

function snapPhotoRotation(rawRotation: number, activeSnap: number | null) {
  const rotation = normalizeAngle(rawRotation)
  if (activeSnap !== null && angularDistance(rotation, activeSnap) <= ROTATION_SNAP_RELEASE_DEGREES) {
    return { rotation: normalizeAngle(activeSnap), snappedAngle: activeSnap }
  }

  const nearestSnap = normalizeAngle(Math.round(rotation / 90) * 90)
  if (angularDistance(rotation, nearestSnap) <= ROTATION_SNAP_ENTER_DEGREES) {
    return { rotation: nearestSnap, snappedAngle: nearestSnap }
  }
  return { rotation, snappedAngle: null }
}

function formatRotation(rotation: number) {
  const normalized = normalizeAngle(rotation)
  return `${normalized === -0 ? 0 : Math.round(normalized)}°`
}

function formatSavedTime(timestamp: number) {
  if (!Number.isFinite(timestamp)) {
    return 'Saved recently'
  }
  const elapsedMinutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000))
  if (elapsedMinutes < 1) {
    return 'Saved just now'
  }
  if (elapsedMinutes < 60) {
    return `Saved ${elapsedMinutes}m ago`
  }
  const elapsedHours = Math.round(elapsedMinutes / 60)
  if (elapsedHours < 24) {
    return `Saved ${elapsedHours}h ago`
  }
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(timestamp))
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

createRoot(root).render(
  <MotionConfig reducedMotion="user">
    <App />
  </MotionConfig>,
)
