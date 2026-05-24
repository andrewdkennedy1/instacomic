# Instacomic

<p align="center">
  <img src="public/icons/icon-192.png" width="96" height="96" alt="Instacomic app icon">
</p>

<h3 align="center">A phone-first comic camera for fast strips, custom layouts, story video, and one-tap export.</h3>

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

Instacomic turns a phone camera into a live comic strip editor. Pick a panel, shoot or upload photos directly into the strip, style the page, then save a PNG or export a vertical story video.

## Highlights

- Live camera preview appears inside the selected comic panel.
- A Start button enters the editor and requests fullscreen when the browser allows it.
- Capture advances forward through the layout, then freezes the final photo instead of covering it with the live preview.
- Upload an existing image into the active panel when the camera is not the right source.
- Filled panels support direct photo repositioning: drag to pan and pinch to resize.
- Custom layouts open in a full-screen maker with divider handles, endpoint snapping, and thickness controls.
- Style controls cover paper, ink, gutters, borders, corners, captions, and image fit.
- Story video export renders a sliding panel reveal with duration and speed controls, downloading MP4 when supported or WebM as a fallback.
- Share renders automatically and falls back to downloading the PNG when native share is unavailable.
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
npm run smoke:photos
npm run smoke:camera
npm run smoke:video
```

The smoke checks exercise the mobile editor flow, centered start aspect choices, uploaded photo positioning, full-screen snapping custom layouts with thickness controls, custom layout deletion, share fallback, manifest loading, fake-camera capture through the final panel, story video configuration, and story video render progress.

## Deploy

The Cloudflare Worker is configured for `instacomic.catcafe.space`.

```bash
npm run deploy
```
