# Instacomic

Instacomic is a full-screen, phone-first PWA for snapping live camera photos into comic strip layouts, decorating them with stickers and text, then saving the finished comic as a PNG.

## Features

- Tap any comic panel to choose where the next live camera photo lands.
- The selected panel becomes the live camera view directly inside the comic.
- Use front or rear camera, with iPhone-friendly `playsinline` capture.
- Choose from multiple comic strip layouts.
- Draw custom manga panel layouts by tapping panel corners; saved layouts stay in browser storage on the phone.
- Customize paper, ink, gutters, border width, corners, caption, and photo fit.
- Add draggable and resizable speech bubbles, thought bubbles, bursts, captions, arrows, and star stickers.
- Edit sticker text, colors, and text size.
- Render the finished strip to a PNG and save or share it from the phone.
- Install as a PWA with manifest icons and offline shell caching.

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Deploy

The Cloudflare Worker is configured for `instacomic.catcafe.space`.

```bash
npm run deploy
```
