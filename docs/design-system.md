# Instacomic studio design

The studio uses an editorial type hierarchy, warm ivory controls, a charcoal artwork stage, and one terracotta accent. The comic remains the dominant surface. Selection uses outlines and text weight; accent color identifies the primary action, active photo, or meaningful editing control.

## Product structure

- **Setup:** a blank-page specimen and format choice, then Start creating with the bottom grid picker open. Returning users see their project library. A recovered draft replaces the setup form with Continue and a clearly explained new-comic action. Installation stays optional.
- **Studio:** desktop offers direct Layout and Style access plus a panel navigator. Mobile uses a five-action capture dock. Selecting a photo replaces that dock with its editing tools without resizing the artwork.
- **Controls:** one modal sheet for Layout, Slides and Export. Layout offers 27 choices in four columns; Layout and Slides reserve space below the canvas in a compact bottom drawer. Built-in templates also have a Style tab; custom grids open their Style controls inside the grid editor. Desktop anchors it beside the artwork; mobile uses a bottom sheet. Sections use spacing and separators instead of nested cards. Done, Escape, the backdrop, and dragging the title area dismiss the sheet.
- **Grid creator:** a full canvas and seven compact tool pages. Phone, tablet and desktop reserve the same 224px bottom drawer with swipe navigation; short landscape places that compact drawer beside the artwork. Each page fits without vertical scrolling and switching tools leaves the preview fixed. Small endpoint cues retain 44px hit targets and disappear in Preview.
- **Export:** completeness information precedes the image actions. Story-video settings and progress follow as a separate section. Existing explicit download and share behavior remains intact.

## Source ownership

| File | Responsibility |
| --- | --- |
| `src/tokens.css` | Semantic color, type, spacing, radius, shadow, motion, control and width tokens |
| `src/ui.tsx` | Shared 24px line icons, brand, setting sections, range and color fields |
| `src/studio.css` | Product shell, controls, workflow layouts, responsive and accessibility rules |
| `src/canvas.css` | Artwork geometry, live photo layers, divider handles and layout previews |
| `scripts/generate-icons.py` | Reproducible PWA brand icons, using Pillow |

Keep document appearance separate from interface tokens. Paper, gutters, strokes, image placement, and export dimensions are user content settings; changing the studio palette must not change exported comics. IndexedDB, export rendering, grid geometry, and the Worker retain their established architecture.

## Foundations and interaction

Use the platform sans-serif for controls and the system editorial serif for prominent headings. Base control text is 15px; 12–13px is reserved for compact labels and metadata. Use the 4px spacing scale and 44px minimum interactive targets. Standard actions use 8px corners, compact choices use 4px corners, and sheets use 20px top corners on mobile.

Layout changes at 760px and 1100px; 360px and short-landscape rules handle constrained devices. Canvas containers preserve the selected aspect ratio at every size. Safe-area insets and actual viewport height reserve space for toolbars.

Primary actions have a solid terracotta fill. Secondary actions use neutral outlines or surfaces. Tertiary actions use text or line icons. Destructive actions use red, with existing recovery and confirmation behavior. Hover, press, focus, disabled and processing states are shared. Motion is brief (140–200ms); Framer Motion and CSS both honor reduced motion. Dialogs trap and restore focus, tabs support arrow keys, and offscreen or covered controls are inert.

Photo drags capture the pointer so releasing outside the canvas or browser still ends the gesture. This prevents a later toolbar tap from finishing a previous drag and activating a newly revealed photo action.

## Validation

Run the existing camera, photo, save/recovery, editing, grid, geometry, video, install and responsive smoke scripts. `scripts/studio-smoke.mjs` adds desktop panel navigation, direct Style/Layout access, modal focus restoration, mobile controls and setup breakpoints. Visual review covers setup, populated capture, contextual photo tools, layout library, appearance, export and custom-grid editing at mobile and desktop sizes.

When extending the UI, reuse the semantic tokens and shared fields, preserve the canvas geometry tests, and review a rendered narrow and wide viewport before shipping. Do not add another global CSS override layer.

## Canvas appearance

Custom grids store their paper, corner, caption and fit settings with the saved grid. The editor stages these settings with geometry, supports Undo/Redo, and commits them together on Save or Update. Dividers are a single solid stroke in the shared line color; the outside border has an independent toggle and width. Its switch does not add internal strokes or alter divider width. Existing border-width fields continue to load as the outside-frame width.

## Local projects and carousels

IndexedDB version 2 adds a project library alongside the current-draft pointer. Project saves and their photo references commit atomically. Photos use immutable IDs and are written once as ArrayBuffers; older Blob assets still load. Cleanup retains the union of photos referenced by the library and current draft. Existing drafts migrate before a new project can replace the current pointer.

Each project stores an ordered collection of up to 20 slides. Slides preserve their layout, photos and transforms, caption, and colors; the format applies to the whole carousel. The same snapshot history supports slide creation, duplication, ordering, removal and panorama creation. The panorama tool appends 2–5 cropped slides after the source without deleting it. ZIP exports contain numbered PNGs in visible slide order.

`scripts/blank-grid-smoke.mjs` checks blank startup, the grid catalog, and preview visibility across five viewport sizes. `scripts/carousel-smoke.mjs` checks the library, durable photos in Chromium and WebKit, slide operations, panorama export pixels, ZIP ordering and independent project deletion. `scripts/project-migration-smoke.mjs` verifies version 1 Blob drafts survive migration and starting another project.
