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

await page.goto(baseUrl, { waitUntil: 'networkidle' })
await page.waitForSelector('.installer-screen')

const bodyText = await page.locator('body').innerText()
const normalizedBodyText = bodyText.toLowerCase()
const result = {
  title: await page.title(),
  installerVisible: await page.locator('.installer-screen').count(),
  editorVisible: await page.locator('.comic-stage').count(),
  startButtonVisible: await page.getByRole('button', { name: 'Start' }).count(),
  mentionsWebShare: bodyText.includes('Open Share Sheet'),
  mentionsInstallerOnly: normalizedBodyText.includes('installer only'),
  mentionsAddToHome: normalizedBodyText.includes('add to home screen'),
  errors,
}

await browser.close()
console.log(JSON.stringify(result, null, 2))

const failures = [
  result.installerVisible === 1 ? null : 'installer screen did not render',
  result.editorVisible === 0 ? null : 'editor rendered in browser installer mode',
  result.startButtonVisible === 0 ? null : 'Start button rendered in browser installer mode',
  result.mentionsWebShare === false ? null : 'installer still offers the Web Share sheet',
  result.mentionsInstallerOnly === true ? null : 'installer-only message is missing',
  result.mentionsAddToHome === true ? null : 'Add to Home Screen instructions are missing',
  result.errors.length === 0 ? null : `page errors: ${result.errors.join('; ')}`,
].filter(Boolean)

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}
