import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
})
const baseUrl = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:4174'
const errors = []
page.on('pageerror', (error) => errors.push(error.message))

await page.addInitScript(() => {
  window.__instacomicFullscreenRequests = 0

  const recordFullscreenRequest = () => {
    window.__instacomicFullscreenRequests += 1
    return Promise.resolve()
  }

  for (const method of ['requestFullscreen', 'webkitRequestFullscreen', 'webkitRequestFullScreen', 'msRequestFullscreen']) {
    Object.defineProperty(Element.prototype, method, {
      configurable: true,
      writable: true,
      value: recordFullscreenRequest,
    })
  }
})

await page.goto(baseUrl, { waitUntil: 'networkidle' })
await page.locator('.start-screen').waitFor()

const startButton = page.locator('.start-screen .start-button')
const installNudge = page.locator('.install-nudge')
const installSummary = installNudge.locator('summary')
const browserMode = await page.evaluate(
  () =>
    !window.matchMedia('(display-mode: standalone)').matches &&
    !window.matchMedia('(display-mode: fullscreen)').matches &&
    navigator.standalone !== true,
)
const fullscreenRequestsBeforeStart = await page.evaluate(() => window.__instacomicFullscreenRequests)

await installSummary.click()
await page.waitForFunction(() => document.querySelector('.install-nudge')?.hasAttribute('open'))

const setupText = await page.locator('.start-screen').innerText()
const normalizedSetupText = setupText.toLowerCase()
const setupResult = {
  title: await page.title(),
  browserMode,
  startScreenVisible: await page.locator('.start-screen').isVisible(),
  startButtonVisible: await startButton.isVisible(),
  startButtonText: (await startButton.innerText()).trim(),
  formatOptionCount: await page.locator('.format-option').count(),
  activeFormatCount: await page.locator('.format-option[aria-pressed="true"]').count(),
  installNudgeVisible: await installNudge.isVisible(),
  installNudgeOpen: await installNudge.evaluate((details) => details.open),
  optionalInstallCopy: normalizedSetupText.includes('optional') && normalizedSetupText.includes('browser editor works too'),
  installInstructionsVisible:
    (await installNudge.getByRole('button', { name: 'Add to Home Screen' }).count()) +
      (await installNudge.locator('.installer-note').count()) >
    0,
  mentionsAddToHome: normalizedSetupText.includes('add to home screen') || normalizedSetupText.includes('install app'),
  hardInstallerVisible: await page.locator('.installer-screen').count(),
  mentionsInstallerOnly: normalizedSetupText.includes('installer only'),
  fullscreenRequestsBeforeStart,
}

await installSummary.click()
await page.waitForFunction(() => !document.querySelector('.install-nudge')?.hasAttribute('open'))
await startButton.tap()
await page.locator('.start-screen').waitFor({ state: 'detached' })
await page.locator('.editor-header').waitFor()

const result = {
  ...setupResult,
  editorStarted: await page.locator('.editor-header').isVisible(),
  canvasVisible: await page.locator('.comic-stage').isVisible(),
  fullscreenRequestsAfterStart: await page.evaluate(() => window.__instacomicFullscreenRequests),
  fullscreenElementAfterStart: await page.evaluate(() => document.fullscreenElement !== null),
  errors,
}

await browser.close()
console.log(JSON.stringify(result, null, 2))

const failures = [
  result.browserMode ? null : 'test did not run in normal browser mode',
  result.startScreenVisible ? null : 'browser-first setup screen did not render',
  result.startButtonVisible ? null : 'browser-first Start creating action is unavailable',
  result.startButtonText === 'Start creating' ? null : 'browser setup does not expose the expected Start creating action',
  result.formatOptionCount === 4 ? null : 'browser setup does not expose all four canvas formats',
  result.activeFormatCount === 1 ? null : 'browser setup does not expose one selected canvas format',
  result.installNudgeVisible ? null : 'optional install nudge is missing',
  result.installNudgeOpen ? null : 'optional install details did not open',
  result.optionalInstallCopy ? null : 'install nudge does not explain that browser editing is available',
  result.installInstructionsVisible ? null : 'install nudge has no install action or browser instructions',
  result.mentionsAddToHome ? null : 'optional install details do not explain Home Screen installation',
  result.hardInstallerVisible === 0 ? null : 'hard installer-only screen still renders in browser mode',
  result.mentionsInstallerOnly === false ? null : 'installer-only copy still renders in browser mode',
  result.editorStarted ? null : 'browser editor did not start from setup',
  result.canvasVisible ? null : 'browser editor canvas is not visible after starting',
  result.fullscreenRequestsBeforeStart === 0 ? null : 'page requested fullscreen before the browser editor started',
  result.fullscreenRequestsAfterStart === 0 ? null : 'starting the browser editor requested fullscreen',
  result.fullscreenElementAfterStart === false ? null : 'browser editor entered fullscreen after starting',
  result.errors.length === 0 ? null : `page errors: ${result.errors.join('; ')}`,
].filter(Boolean)

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}
