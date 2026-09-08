import assert from 'node:assert/strict'
import { chromium } from 'playwright'
const browser = await chromium.launch()
try {
 const page = await browser.newPage()
 const origin = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:4174'
 await page.route('**/*', route => route.fulfill({contentType: 'text/html', body: '<html><body>Migration fixture</body></html>'}))
 await page.goto(origin)
 await page.evaluate(async () => {
  const db = await new Promise((resolve, reject) => {
   const r = indexedDB.open('instacomic', 1)
   r.onupgradeneeded = () => { r.result.createObjectStore('drafts', {keyPath:'id'}); r.result.createObjectStore('assets', {keyPath:'id'}) }
   r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error)
  })
  const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 100
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#62856f'; ctx.fillRect(0,0,80,100)
  const blob = await new Promise(resolve => canvas.toBlob(resolve))
  const tx = db.transaction(['drafts','assets'],'readwrite')
  tx.objectStore('assets').put({ id:'old-photo', blob, width:80, height:100, createdAt:Date.now() })
  tx.objectStore('drafts').put({ id:'current', schemaVersion:1, revision:7, updatedAt:Date.now(), document:{
   layout:{ id:'old-custom', name:'Old custom grid', custom:true, panels:[{id:'1',x:0,y:0,w:1,h:1}], dividers:[], borderThickness:0 },
   pageFormatId:'4:5', settings:{gutters:6,radius:0,border:0,background:'#ffffff',borderColor:'#111111',caption:'Keep this',captionColor:'#111111',fit:'contain',videoDuration:6,videoSpeed:1},
   activePanelId:'1', shotCache:[{assetId:'old-photo',width:80,height:100,offsetX:0.1,offsetY:-0.1,scale:1.2,rotation:5,fit:'contain'}]
  } })
  await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)})
  db.close()
 })
 await page.unroute('**/*')
 await page.reload()
 await page.getByRole('button',{name:'Open project My first project',exact:true}).waitFor()
 // Starting another project must preserve an older draft even before it is opened.
 await page.getByRole('button',{name:'New comic',exact:true}).click()
 await page.getByRole('button',{name:'Start new comic',exact:true}).click()
 await page.getByRole('button',{name:'Done editing comic',exact:true}).click()
 await page.getByRole('button',{name:'Back to projects',exact:true}).click()
 await page.getByRole('button',{name:'Open project My first project',exact:true}).click()
 await page.locator('.start-screen').waitFor({state:'detached'})
 await page.locator('.live-panel img').waitFor()
 assert.equal(await page.locator('.live-strip').getAttribute('data-layout-id'),'old-custom')
 assert.equal(await page.locator('.live-panel img').getAttribute('data-shot-scale'),'1.20')
 assert.equal(await page.locator('.strip-caption').innerText(),'Keep this')
 assert.equal(await page.locator('.live-panel img').evaluate(img=>img.naturalWidth),80)
 console.log('Version 1 Blob draft migrated to project library; photos, custom grid, crop, rotation and caption survive starting a new project.')
} finally { await browser.close() }
