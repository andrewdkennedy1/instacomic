import { chromium } from 'playwright'

const browser = await chromium.launch()
const baseUrl = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:4174'
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
})
const errors = []
page.on('pageerror', (error) => errors.push(error.message))

const formats = [
  { id: '4:5', aspect: 5 / 4 },
  { id: '3:4', aspect: 4 / 3 },
  { id: '4:3', aspect: 3 / 4 },
  { id: '9:16', aspect: 16 / 9 },
]
const viewports = [
  { name: 'small-phone', width: 280, height: 568 },
  { name: 'phone', width: 320, height: 568 },
  { name: 'large-phone', width: 430, height: 932 },
  { name: 'landscape', width: 844, height: 390 },
  { name: 'tablet', width: 1024, height: 768 },
]

await page.goto(baseUrl, { waitUntil: 'networkidle' })
await page.setViewportSize({ width: 280, height: 568 })
const setupGeometry = await page.evaluate(() => {
  const screen = document.querySelector('.start-screen')
  return {
    horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
    scrollableWhenNeeded: !!screen && screen.scrollHeight > screen.clientHeight && getComputedStyle(screen).overflowY === 'auto',
    formatCount: document.querySelectorAll('.format-option').length,
    gridCount: document.querySelectorAll('.setup-grid-options button').length,
  }
})

await page.setViewportSize({ width: 390, height: 844 })
await page.getByRole('button', { name: 'Start creating' }).tap()
await page.getByRole('button', { name: 'Done editing comic', exact: true }).click()
await page.locator('.start-screen').waitFor({ state: 'detached' })

const measurements = []
for (const format of formats) {
  await setCanvasFormat(page, format.id)
  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.waitForTimeout(90)
    measurements.push(
      await page.evaluate(
        ({ formatId, expectedAspect, viewportName }) => {
          const strip = document.querySelector('.live-strip')?.getBoundingClientRect()
          const stage = document.querySelector('.comic-stage')?.getBoundingClientRect()
          const visibleCoreControls = [
            ...document.querySelectorAll('.editor-header button:not(:disabled), .capture-actions button:not(:disabled)'),
          ].filter((control) => {
            const style = getComputedStyle(control)
            const box = control.getBoundingClientRect()
            return style.visibility !== 'hidden' && Number(style.opacity) > 0.05 && box.width > 0 && box.height > 0
          })
          return {
            formatId,
            viewportName,
            expectedAspect,
            aspect: strip ? strip.height / strip.width : 0,
            contained:
              !!strip &&
              !!stage &&
              strip.left >= stage.left - 1 &&
              strip.right <= stage.right + 1 &&
              strip.top >= stage.top - 1 &&
              strip.bottom <= stage.bottom + 1,
            targetsMeet44: visibleCoreControls.every((control) => {
              const box = control.getBoundingClientRect()
              return box.width >= 44 && box.height >= 44
            }),
            horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
            shellTransform: getComputedStyle(document.querySelector('.native-shell')).transform,
          }
        },
        { formatId: format.id, expectedAspect: format.aspect, viewportName: viewport.name },
      ),
    )
  }
  await page.setViewportSize({ width: 390, height: 844 })
}

await page.emulateMedia({ reducedMotion: 'reduce' })
const reducedMotionDuration = await page.locator('.capture-bar').evaluate((element) =>
  Math.max(...getComputedStyle(element).transitionDuration.split(',').map((duration) => Number.parseFloat(duration) || 0)),
)

await browser.close()

const result = {
  setupGeometry,
  measurements,
  reducedMotionDuration,
  errors,
}
console.log(JSON.stringify(result, null, 2))

const failures = [
  setupGeometry.horizontalOverflow ? 'small-phone setup scrolls horizontally' : null,
  setupGeometry.scrollableWhenNeeded ? null : 'small-phone setup cannot scroll vertically when its content exceeds the viewport',
  setupGeometry.formatCount === 4 ? null : 'setup does not expose all canvas formats',
  setupGeometry.gridCount === 0 ? null : 'new projects should start blank without a preset grid',
  ...measurements.flatMap((measurement) => [
    Math.abs(measurement.aspect - measurement.expectedAspect) < 0.01
      ? null
      : `${measurement.formatId} canvas is distorted in ${measurement.viewportName}`,
    measurement.contained ? null : `${measurement.formatId} canvas escapes its stage in ${measurement.viewportName}`,
    measurement.targetsMeet44 ? null : `core controls are smaller than 44px in ${measurement.viewportName}`,
    measurement.horizontalOverflow ? `${measurement.viewportName} editor scrolls horizontally` : null,
    measurement.shellTransform === 'none' ? null : `${measurement.viewportName} rotates or transforms the app shell`,
  ]),
  reducedMotionDuration <= 0.01 ? null : 'reduced-motion mode still uses visible transition durations',
  errors.length === 0 ? null : `page errors: ${errors.join('; ')}`,
].filter(Boolean)

if (failures.length > 0) {
  throw new Error(failures.join('\n'))
}

async function setCanvasFormat(page, formatId) {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Controls', exact: true }).tap()
  await page.locator('.motion-drawer.is-open').waitFor()
  await page.getByRole('tab', { name: 'Layout', exact: true }).tap()
  await page
    .locator('.drawer-format-grid button')
    .filter({ has: page.locator('strong', { hasText: formatId }) })
    .tap()
  await page.getByRole('button', { name: 'Done editing comic' }).tap()
  await page.waitForFunction(() => document.querySelector('.motion-drawer')?.hasAttribute('inert'))
}
