# Instacomic

<p align="center">
  <img src="public/icons/icon-192.png" width="96" height="96" alt="Instacomic app icon">
</p>

<h3 align="center">A phone-first comic camera for fast strips, speech bubbles, stickers, and one-tap export.</h3>

<p align="center">
  <a href="https://instacomic.catcafe.space">Live app</a>
  · PWA
  · React
  · Cloudflare Workers
</p>

<p align="center">
  <img src="docs/instacomic-mobile.png" width="320" alt="Instacomic mobile editor screenshot">
</p>

## What it does

Instacomic turns a phone camera into a live comic strip editor. Pick a panel, shoot directly into the strip, layer speech bubbles and stickers over the page, then save the finished comic as a PNG.

## Highlights

- Live camera preview appears inside the selected comic panel.
- Capture advances forward through the layout and does not jump back to overwrite earlier shots.
- Speech bubble and sticker text edits happen directly on the comic.
- Stickers stay on top of the capture surface, drag naturally, and pinch-resize on touch screens.
- Custom layouts are built by dragging divider lines around the page.
- Style controls cover paper, ink, gutters, borders, corners, captions, and image fit.
- Save Image renders and downloads in one action; Share renders automatically when needed.
- Installable PWA shell with manifest icons and offline app caching.

## Local development

```bash
npm install
npm run dev
```

## Verification

```bash
npm run build
npm run smoke
npm run smoke:camera
```

The smoke checks exercise the mobile editor flow, inline sticker text, drag and pinch sizing, custom divider layouts, one-tap save, manifest loading, and fake-camera capture.

## Deploy

The Cloudflare Worker is configured for `instacomic.catcafe.space`.

```bash
npm run deploy
```
