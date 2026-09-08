import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { chromium, webkit } from 'playwright'

// Exercise the production geometry functions without requiring a test-only
// export or exposing editor state in the browser bundle.
const source = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile('main.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const declarations = ast.statements.filter(ts.isFunctionDeclaration).map(node => node.getText(ast)).join('\n')
const geometry = vm.createContext({})
vm.runInContext(ts.transpileModule(declarations, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React },
}).outputText, geometry)

const horizontal = { id: 'horizontal', extent: 'canvas', x1: 0, y1: 50, x2: 100, y2: 50 }
const diagonal = { id: 'diagonal', extent: 'canvas', x1: 59.5, y1: 0, x2: 99.5, y2: 100 }
const originalLines = [horizontal, diagonal]
const original = { id: 'custom-regression', name: 'Photo order regression', custom: true, panelOrder: 'reading', dividerThickness: 6, borderThickness: 0, borderColor: '#ffffff', dividers: originalLines, panels: geometry.panelsFromLines(originalLines, true) }
const movedDiagonal = { ...diagonal, x1: 60, x2: 100 }
const movedLines = [horizontal, movedDiagonal]

assert.equal(original.panels.length, 4)
const unstable = geometry.panelsFromLines(movedLines, true)
assert.ok(geometry.panelCentroid(original.panels[2]).x < 0.7)
assert.ok(geometry.panelCentroid(unstable[2]).x > 0.7, 'Fixture must reproduce the previous bottom-photo swap')
const stable = geometry.adjustedPanelsKeepingPhotos(original, movedLines)
assert.ok(stable)
assert.equal(stable.map(panel => panel.id).join(','), original.panels.map(panel => panel.id).join(','))
assert.ok(geometry.panelCentroid(stable[2]).x < 0.7, 'Bottom-left photo must remain on the left')
assert.ok(geometry.panelCentroid(stable[3]).x > 0.7, 'Bottom-right photo must remain on the right')

// Endpoint direction normalization must not swap the positive/negative cells.
const reversed = { ...movedDiagonal, x1: movedDiagonal.x2, y1: movedDiagonal.y2, x2: movedDiagonal.x1, y2: movedDiagonal.y1 }
const reversedPanels = geometry.adjustedPanelsKeepingPhotos(original, [horizontal, reversed])
assert.ok(reversedPanels)
assert.ok(geometry.panelCentroid(reversedPanels[2]).x < 0.7)

// A large pointer step can jump over another parallel divider while keeping the
// same panel count. Reject it because the middle photo's region would disappear.
const parallelLines = [30, 70].map((x, index) => ({ id: `vertical-${index}`, extent: 'canvas', x1: x, y1: 0, x2: x, y2: 100 }))
const parallel = { ...original, dividers: parallelLines, panels: geometry.panelsFromLines(parallelLines, true) }
const crossed = [{ ...parallelLines[0], x1: 80, x2: 80 }, parallelLines[1]]
assert.equal(geometry.panelsFromLines(crossed, true).length, parallel.panels.length)
assert.equal(geometry.adjustedPanelsKeepingPhotos(parallel, crossed), null)

// A finite T-junction leaves one panel straddling its supporting line. Moving
// the segment must preserve that panel and both photos below it.
const segment = { id: 'segment', x1: 50, y1: 50, x2: 50, y2: 100 }
const finiteLines = [horizontal, segment]
const finite = { ...original, dividers: finiteLines, panels: geometry.panelsFromLines(finiteLines, true) }
const finiteMoved = geometry.adjustedPanelsKeepingPhotos(finite, [horizontal, { ...segment, x1: 65, x2: 65 }])
assert.ok(finiteMoved)
assert.equal(finiteMoved.length, 3)
assert.equal(finiteMoved.map(panel => panel.id).join(','), finite.panels.map(panel => panel.id).join(','))

console.log('Custom Adjust: photo-region IDs survive reading-order changes, reversed endpoints and finite segments; crossed topology is rejected')

for (const engine of [chromium, webkit]) {
  const browser = await engine.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(layout => localStorage.setItem('instacomic.customLayouts.v1', JSON.stringify([layout])), JSON.parse(JSON.stringify(original)))
    await page.goto(process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:4174')
    await page.getByRole('button', { name: 'Start creating', exact: true }).click()
    await page.getByRole('button', { name: 'Use Photo order regression layout, 4 panels', exact: true }).click()
    await page.getByRole('button', { name: 'Done editing comic', exact: true }).click()
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    for (const [index, color] of ['#dd6544', '#5588aa', '#66aa66', '#ccaa44'].entries()) {
      const png = await page.evaluate(color => {
        const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 200
        const context = canvas.getContext('2d'); context.fillStyle = color; context.fillRect(0, 0, 160, 200)
        return canvas.toDataURL().split(',')[1]
      }, color)
      await page.setInputFiles('.photo-upload', { name: `photo-${index}.png`, mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
      await page.locator('.live-panel img').nth(index).waitFor()
      // Let the editor-version effect settle before starting another async file
      // decode; otherwise this synthetic upload burst races WebKit's paint.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    }
    const readPanels = selector => page.locator(selector).evaluateAll(panels => panels.map(panel => ({
      clip: panel.style.clipPath, photo: panel.querySelector('img')?.src,
    })))
    const before = await readPanels('.live-panel')
    await page.getByRole('button', { name: 'Controls', exact: true }).click()
    await page.getByRole('button', { name: 'Adjust grid', exact: true }).click()
    await page.getByRole('button', { name: 'Adjust divider 2', exact: true }).press('ArrowRight')
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await page.getByRole('dialog', { name: 'Adjust grid', exact: true }).waitFor({ state: 'hidden' })
    const adjusted = await readPanels('.live-panel')
    assert.notDeepEqual(adjusted, before, 'Divider nudge must change the fixture geometry')
    assert.deepEqual(adjusted.map(panel => panel.photo), before.map(panel => panel.photo))
    const lowerLeftX = adjusted[2].clip.match(/[\d.]+/g).filter((_, index) => index % 2 === 0).map(Number)
    assert.ok(lowerLeftX.reduce((sum, x) => sum + x, 0) / lowerLeftX.length < 70, 'Adjust must keep the third photo in the left region')

    const saveNewPaper = async (expected, color) => {
      await page.getByRole('button', { name: 'Open appearance controls', exact: true }).click()
      await page.getByRole('tab', { name: 'Style', exact: true }).waitFor()
      assert.deepEqual(await readPanels('.creator-canvas .creator-panel'), expected, 'Opening Canvas Style must preserve adjusted photo regions')
      await page.getByLabel('Paper', { exact: true }).evaluate((input, color) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, color)
        input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }))
      }, color)
      await page.getByRole('button', { name: 'Update layout', exact: true }).click()
      await page.locator('.creator-fullscreen').waitFor({ state: 'detached' })
      assert.deepEqual(await readPanels('.live-panel'), expected, 'Saving color must retain every photo region')
    }
    await saveNewPaper(adjusted, '#d8dfc9')
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    assert.deepEqual(await readPanels('.live-panel'), before, 'Undo must restore the earlier grid geometry')
    await saveNewPaper(before, '#d4c9df')
    assert.deepEqual(errors, [])
    console.log(`${engine.name()}: custom photo order survives Adjust, Canvas Style preview/save, and reopening an undone grid`)
  } finally { await browser.close() }
}
