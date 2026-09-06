import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))
await page.addInitScript(() => {
  navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Test camera unavailable', 'NotFoundError') }
})
mkdirSync('test-results', { recursive: true })

try {
  await page.goto(process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:4174')
  await page.getByRole('button', { name: 'Start creating', exact: true }).waitFor()
  await page.screenshot({ path: 'test-results/studio-home-desktop.png' })
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Setup overflows at ${width}px`)
  }
  await page.getByRole('button', { name: 'Start creating', exact: true }).click()
  await page.getByRole('button', { name: 'Try camera', exact: true }).waitFor()
  const navigation = page.getByRole('navigation', { name: 'Panel navigation' })
  await navigation.getByRole('button', { name: 'Go to panel 3', exact: true }).click()
  assert.equal(await page.locator('.live-panel.is-live').getAttribute('data-panel-id'), '3')
  const style = page.locator('.editor-tools').getByRole('button', { name: 'Style', exact: true })
  await style.click()
  assert.equal(await page.getByRole('tab', { name: 'Style', exact: true }).getAttribute('aria-selected'), 'true')
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !document.querySelector('.motion-drawer.is-open'))
  assert.equal(await style.evaluate(button => button === document.activeElement), true, 'Sheet did not restore keyboard focus')
  const layout = page.locator('.editor-tools').getByRole('button', { name: 'Layout', exact: true })
  await layout.click()
  assert.equal(await page.getByRole('tab', { name: 'Layout', exact: true }).getAttribute('aria-selected'), 'true')
  assert.equal(await page.locator('.motion-drawer.is-open .drawer-close').count(), 1)
  await page.getByRole('button', { name: 'Done editing comic', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('.motion-drawer.is-open'))
  await page.waitForFunction(() => document.querySelector('.motion-drawer').getBoundingClientRect().top > innerHeight)
  await page.screenshot({ path: 'test-results/studio-desktop.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await navigation.isVisible(), false)
  await page.getByRole('button', { name: 'Open appearance controls', exact: true }).click()
  assert.equal(await page.getByRole('tab', { name: 'Style', exact: true }).getAttribute('aria-selected'), 'true')
  await page.screenshot({ path: 'test-results/studio-appearance-mobile.png' })
  assert.deepEqual(errors, [])
  console.log('Setup responsiveness, desktop panel navigation, direct Style/Layout access, modal focus restoration, and mobile controls passed.')
} finally {
  await browser.close()
}
