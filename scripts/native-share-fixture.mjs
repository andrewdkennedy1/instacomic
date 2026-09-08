import assert from 'node:assert/strict'

// Capture the actual File objects passed to the native sheet. Reading them after
// the call keeps the activation assertion independent of asynchronous encoding.
export async function installNativeShare(page, { supported = true } = {}) {
  await page.addInitScript(({ supported }) => {
    window.__nativeShares = []
    window.__nativeShareMode = 'resolve'
    window.__nativeDownloadAttempts = []
    const click = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) window.__nativeDownloadAttempts.push(this.download)
      return click.call(this)
    }
    Object.defineProperty(navigator, 'canShare', {
      configurable: true,
      value: ({ files } = {}) => supported && Array.isArray(files) && files.length > 0 && files.every(file => file instanceof File && file.type === 'image/png'),
    })
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: supported ? (data) => {
        window.__nativeShares.push({ files: [...(data.files ?? [])], active: navigator.userActivation?.isActive, keys: Object.keys(data), mode: window.__nativeShareMode })
        if (window.__nativeShareMode === 'abort') return Promise.reject(new DOMException('Cancelled', 'AbortError'))
        if (window.__nativeShareMode === 'reject') return Promise.reject(new DOMException('Share failed', 'NotAllowedError'))
        if (window.__nativeShareMode === 'pending') return new Promise(() => {})
        return Promise.resolve()
      } : undefined,
    })
  }, { supported })
}

export async function capturedPhotos(page, index = -1) {
  return page.evaluate(async (index) => {
    const call = window.__nativeShares.at(index)
    if (!call) return null
    return {
      active: call.active,
      mode: call.mode,
      keys: call.keys,
      files: await Promise.all(call.files.map(async file => ({
        name: file.name,
        type: file.type,
        size: file.size,
        png: await new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result.split(',')[1])
          reader.onerror = () => reject(reader.error)
          reader.readAsDataURL(file)
        }),
      }))),
    }
  }, index)
}

export async function sharePreparedPhotos(page, expectedCount = 1) {
  const before = await page.evaluate(() => window.__nativeShares.length)
  const share = page.getByRole('button', { name: /^Share (?:\d+ )?photos?$/ })
  await share.waitFor({ state: 'visible' })
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => /^Share (?:\d+ )?photos?$/.test(button.textContent.trim()) && !button.disabled))
  await share.click()
  await page.waitForFunction(before => window.__nativeShares.length > before, before)
  const captured = await capturedPhotos(page)
  assert.equal(captured.files.length, expectedCount, 'The share sheet must receive every slide together')
  assert.deepEqual(captured.keys, ['files'], 'Native sharing must present images without extra text attachments')
  assert.equal(captured.active, true, 'Native sharing must start during the direct user gesture')
  for (const file of captured.files) {
    assert.equal(file.type, 'image/png')
    assert.ok(file.size > 100, 'Shared photo is empty')
  }
  assert.deepEqual(await page.evaluate(() => window.__nativeDownloadAttempts), [], 'Sharing must never fall back to a file download')
  return captured.files
}
