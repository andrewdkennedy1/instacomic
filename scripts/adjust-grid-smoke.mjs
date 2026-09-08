import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { chromium, webkit } from 'playwright'

mkdirSync('test-results', { recursive: true })
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(() => {
      window.hapticPulses = 0
      Object.defineProperty(navigator, 'vibrate', { configurable: true, value: () => { window.hapticPulses++; return true } })
    })
    await page.goto(process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:4174')
    await page.getByRole('button', { name: 'Start creating', exact: true }).click()
    assert.equal(await page.getByRole('button', { name: 'Adjust grid', exact: false }).count(), 0, 'blank canvas has no divider to adjust')
    await page.getByRole('button', { name: 'Use Top story layout, 3 panels', exact: true }).click()
    await page.getByRole('button', { name: 'Done editing comic', exact: true }).click()
    for (const [index, color] of ['#cd684b', '#809b77', '#caa67b'].entries()) {
      const png = await page.evaluate(color => {
        const c = document.createElement('canvas'); c.width = 600; c.height = 750
        const context = c.getContext('2d'); context.fillStyle = color; context.fillRect(0, 0, c.width, c.height)
        return c.toDataURL().split(',')[1]
      }, color)
      await page.setInputFiles('.photo-upload', { name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
      await page.locator('.live-panel img').nth(index).waitFor()
    }
    await page.waitForFunction(() => document.querySelectorAll('.live-panel img').length === 3)
    const photos = await page.locator('.live-panel img').evaluateAll(images => images.map(image => image.src))
    const openAdjust = async () => {
      await page.getByRole('button', { name: 'Controls', exact: true }).click()
      await page.getByRole('button', { name: 'Adjust grid', exact: false }).click()
      await page.getByRole('dialog', { name: 'Adjust grid', exact: true }).waitFor()
    }
    const position = axis => page.locator(`.adjust-divider-handle[data-divider-axis="${axis}"]`).first().evaluate((handle, axis) => parseFloat(handle.style[axis === 'x' ? 'left' : 'top']) / 100, axis)
    const dragTo = async (axis, target, release = true) => {
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      const handle = page.locator(`.adjust-divider-handle[data-divider-axis="${axis}"]`).first()
      const bounds = await handle.boundingBox()
      const canvas = await page.locator('.adjust-canvas').boundingBox()
      const current = await position(axis)
      const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2
      await page.mouse.move(x, y); await page.mouse.down()
      await page.mouse.move(x + (axis === 'x' ? (target - current) * canvas.width : 0), y + (axis === 'y' ? (target - current) * canvas.height : 0), { steps: 8 })
      // WebKit can return from mouse.move before React paints its batched pointer update.
      await page.waitForFunction(({ axis, target }) => {
        const handle = document.querySelector(`.adjust-divider-handle[data-divider-axis="${axis}"]`)
        return Math.abs(parseFloat(handle.style[axis === 'x' ? 'left' : 'top']) / 100 - target) < 0.02
      }, { axis, target })
      if (release) {
        await page.mouse.up()
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      }
    }
    await openAdjust()
    assert.equal(await page.locator('.adjust-divider-handle').count(), 2)
    assert.deepEqual(await page.locator('.adjust-canvas img').evaluateAll(images => images.map(image => image.src)), photos)
    for (const viewport of [{ width: 280, height: 568 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport)
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      const geometry = await page.evaluate(() => {
        const canvas = document.querySelector('.adjust-canvas').getBoundingClientRect()
        const dock = document.querySelector('.adjust-dock').getBoundingClientRect()
        return { visible: canvas.height > 140 && canvas.top >= 44, separate: canvas.bottom <= dock.top || canvas.right <= dock.left, dock: dock.height, overflow: document.documentElement.scrollWidth > innerWidth }
      })
      assert.ok(geometry.visible && geometry.separate && geometry.dock <= 150 && !geometry.overflow, `${engine.name()} ${viewport.width}: ${JSON.stringify(geometry)}`)
    }
    await page.setViewportSize({ width: 390, height: 844 })
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await dragTo('y', 0.65)
    assert.ok(Math.abs(await position('y') - 0.65) < 0.01)
    const panels = await page.locator('[data-adjust-panel]').evaluateAll(items => items.map(item => ({ top: item.style.top, height: item.style.height })))
    const percent = value => Number(value.match(/[\d.]+/)[0])
    assert.ok(Math.abs(percent(panels[0].height) - 65) < 0.2 && percent(panels[1].top) === percent(panels[0].height) && percent(panels[2].top) === percent(panels[0].height), `T junction separated: ${JSON.stringify(panels)}`)
    await dragTo('y', 0.508, false)
    assert.equal(await position('y'), 0.5)
    assert.equal(await page.locator('.grid-center-cue').count(), 1)
    assert.ok(await page.evaluate(() => window.hapticPulses) >= 1)
    await page.screenshot({ path: `test-results/adjust-center-${engine.name()}.png` })
    await page.mouse.up()
    await page.getByRole('button', { name: 'Undo grid adjustment', exact: true }).click()
    assert.ok(Math.abs(await position('y') - 0.65) < 0.01)
    await page.getByRole('button', { name: 'Reset', exact: true }).click()
    assert.equal(await position('y'), 0.5)
    await page.locator('.adjust-divider-handle[data-divider-axis="y"]').first().press('Shift+ArrowDown')
    assert.ok(Math.abs(await position('y') - 0.52) < 0.0001)
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await page.getByRole('dialog', { name: 'Adjust grid', exact: true }).waitFor({ state: 'hidden' })
    assert.deepEqual(await page.locator('.live-panel img').evaluateAll(images => images.map(image => image.src)), photos)
    assert.ok((await page.locator('.live-panel').first().getAttribute('style')).includes('52%'))
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    assert.ok((await page.locator('.live-panel').first().getAttribute('style')).includes('50%'))
    await page.getByRole('button', { name: 'Redo', exact: true }).click()
    await openAdjust()
    await dragTo('y', 0.7)
    await page.getByRole('button', { name: 'Close adjust grid', exact: true }).click()
    await page.getByRole('button', { name: 'Discard changes', exact: true }).click()
    assert.ok((await page.locator('.live-panel').first().getAttribute('style')).includes('52%'))
    await page.locator('.native-shell[data-autosave-state="saved"]').waitFor()
    await page.reload()
    await page.getByRole('button', { name: 'Continue editing', exact: true }).click()
    await page.waitForFunction(() => document.querySelectorAll('.live-panel img').length === 3)
    assert.ok((await page.locator('.live-panel').first().getAttribute('style')).includes('52%'), 'adjusted preset was lost after reload')
    for (const [id, count] of [['four', 2], ['nine-panels', 4]]) {
      await page.getByRole('button', { name: 'Controls', exact: true }).click()
      await page.locator(`[data-layout-option-id="${id}"]`).click()
      await page.getByRole('button', { name: 'Adjust grid', exact: false }).click()
      await page.setViewportSize({ width: 280, height: 568 })
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      assert.equal(await page.locator('.adjust-divider-handle').count(), count)
      const reachable = await page.locator('.adjust-divider-handle').evaluateAll(handles => handles.every(handle => {
        const bounds = handle.getBoundingClientRect()
        return bounds.width >= 44 && bounds.height >= 44 && document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)?.closest('.adjust-divider-handle') === handle
      }))
      assert.ok(reachable, `${id}: crossing dividers have overlapping handles`)
      await dragTo('x', 0.57)
      await page.getByRole('button', { name: 'Done', exact: true }).click()
      assert.equal(await page.locator('.live-panel img').count(), 3)
    }
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: 'Controls', exact: true }).click()
    await page.locator('.create-card').click()
    await page.getByRole('button', { name: 'Save layout', exact: true }).click()
    await page.getByRole('dialog', { name: 'Create custom grid', exact: true }).waitFor({ state: 'hidden' })
    await openAdjust()
    assert.equal(await page.locator('.adjust-divider-handle').count(), 2)
    await dragTo('x', 0.6)
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    assert.equal(await page.locator('.live-panel').count(), 4)
    assert.equal(await page.locator('.live-panel img').count(), 3)
    assert.deepEqual(errors, [])
    console.log(`${engine.name()}: fullscreen geometry at five sizes, T-junction resize, center snap/haptics, reset, undo/redo, discard, photo retention and project recovery passed`)
  } catch (error) {
    console.error(`${engine.name()}: ${error.message}`)
    throw error
  } finally { await browser.close() }
}
