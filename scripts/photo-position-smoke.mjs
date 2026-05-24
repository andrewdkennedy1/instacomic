import { deflateSync } from 'node:zlib'
import { chromium } from 'playwright'

const crcTable = createCrcTable()
const baseUrl = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:4174'
const browser = await chromium.launch()
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  acceptDownloads: true,
})
const errors = []
page.on('pageerror', (error) => errors.push(error.message))

await page.addInitScript(() => {
  Object.defineProperty(navigator, 'standalone', {
    configurable: true,
    get: () => true,
  })

  window.__instacomicDownloads = []
  const originalClick = HTMLAnchorElement.prototype.click
  HTMLAnchorElement.prototype.click = function click() {
    if (this.download) {
      window.__instacomicDownloads.push(this.href)
    }
    return originalClick.call(this)
  }
})

await page.goto(baseUrl, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: 'Start' }).tap()
await tapStrip(page, 0.75, 0.31)

const selectedPanel = await page.locator('.live-panel.is-live').getAttribute('data-panel-id')
await page.setInputFiles('.photo-upload', {
  name: 'landscape-gradient.png',
  mimeType: 'image/png',
  buffer: landscapeGradientPng(),
})
await page.waitForFunction(() => document.querySelector('[data-panel-id="2"] img'))

const frame = await page.locator('[data-panel-id="2"] img').evaluate((image) => {
  const panel = image.closest('.live-panel')?.getBoundingClientRect()
  const box = image.getBoundingClientRect()
  return {
    w: panel ? box.width / panel.width : 0,
    h: panel ? box.height / panel.height : 0,
    sourceRatio: image instanceof HTMLImageElement ? image.naturalWidth / image.naturalHeight : 0,
  }
})

const beforeTransform = await photoTransform(page, '2')
const beforePixel = await sharedPngPixel(page, { x: Math.round(1440 * 0.725), y: Math.round(1800 * 0.25) })
await dragPanelPhoto(page, 0.75, 0.31, 120, 0)
await page.waitForTimeout(120)
const afterTransform = await photoTransform(page, '2')
const afterPixel = await sharedPngPixel(page, { x: Math.round(1440 * 0.725), y: Math.round(1800 * 0.25) })

const result = {
  selectedPanel,
  frame,
  beforeTransform,
  afterTransform,
  beforePixel,
  afterPixel,
  exportedMovedRedDelta: beforePixel.r - afterPixel.r,
  exportedMovedBlueDelta: afterPixel.b - beforePixel.b,
  errors,
}

await browser.close()
console.log(JSON.stringify(result, null, 2))

const failures = [
  result.selectedPanel === '2' ? null : 'panel selection did not land on polygon panel 2',
  result.frame.sourceRatio > 2.95 && result.frame.sourceRatio < 3.05 ? null : 'uploaded landscape source dimensions were not preserved',
  result.frame.w > 1.45 && result.frame.w < 1.55 ? null : 'uploaded landscape photo is still cropped to the panel width',
  result.frame.h > 0.45 && result.frame.h < 0.55 ? null : 'uploaded landscape photo is not fitted to the polygon panel height',
  result.afterTransform.x > result.beforeTransform.x + 0.2 ? null : 'manual photo drag did not update the shot offset',
  result.beforePixel.width === 1440 && result.beforePixel.height === 1800 ? null : 'default 4:5 export dimensions are incorrect',
  result.exportedMovedRedDelta > 25 && result.exportedMovedBlueDelta > 25
    ? null
    : 'exported PNG did not reflect the manual landscape photo position',
  result.errors.length === 0 ? null : `page errors: ${result.errors.join('; ')}`,
].filter(Boolean)

if (failures.length > 0) {
  throw new Error(failures.join('\n'))
}

async function tapStrip(page, nx, ny) {
  const box = await page.locator('.live-strip').boundingBox()
  await page.mouse.click(box.x + box.width * nx, box.y + box.height * ny)
}

async function dragPanelPhoto(page, nx, ny, dx, dy) {
  const box = await page.locator('.live-strip').boundingBox()
  const start = { x: box.x + box.width * nx, y: box.y + box.height * ny }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 8 })
  await page.mouse.up()
}

async function photoTransform(page, panelId) {
  const image = page.locator(`[data-panel-id="${panelId}"] img`)
  return {
    x: Number(await image.getAttribute('data-shot-x')),
    y: Number(await image.getAttribute('data-shot-y')),
    scale: Number(await image.getAttribute('data-shot-scale')),
  }
}

async function sharedPngPixel(page, point) {
  const downloadIndex = await page.evaluate(() => window.__instacomicDownloads.length)
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Share' }).tap(),
  ])
  await page.waitForFunction((count) => window.__instacomicDownloads.length > count, downloadIndex)
  const pixel = await page.evaluate(
    async ({ downloadIndex, point }) => {
      const href = window.__instacomicDownloads[downloadIndex]
      const blob = await fetch(href).then((response) => response.blob())
      const bitmap = await createImageBitmap(blob)
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const context = canvas.getContext('2d')
      if (!context) {
        throw new Error('Canvas is unavailable.')
      }
      context.drawImage(bitmap, 0, 0)
      const data = context.getImageData(point.x, point.y, 1, 1).data
      bitmap.close()
      return {
        r: data[0],
        g: data[1],
        b: data[2],
        a: data[3],
        width: canvas.width,
        height: canvas.height,
      }
    },
    { downloadIndex, point },
  )
  await download.delete().catch(() => {})
  return pixel
}

function landscapeGradientPng(width = 900, height = 300) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1)
    raw[row] = 0
    for (let x = 0; x < width; x += 1) {
      const red = Math.round((255 * x) / (width - 1))
      const offset = row + 1 + x * 4
      raw[offset] = red
      raw[offset + 1] = 64
      raw[offset + 2] = 255 - red
      raw[offset + 3] = 255
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

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
