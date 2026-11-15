# Slidewise

A presentation editor that runs **entirely in your browser**. No server, no account, no API keys, no telemetry.
Decks are stored on your device (IndexedDB) and never uploaded anywhere.

React 18 + Vite, plain JavaScript. Deploys as a static site (GitHub Pages) and installs as an offline PWA.

## Features

Everything in this list is exercised by the unit tests or the real-browser end-to-end suite (see [Testing](#testing)).

**Editing**
- 16:9, 4:3 or custom slide size; zoom and fit-to-window
- Slide sorter: thumbnails, drag-reorder, add, duplicate, delete, hide
- Objects: text, 7 shapes (rectangle, rounded rectangle, ellipse, triangle, arrow, line, star), images, tables, charts (bar, stacked bar, line, area line, pie, scatter, with data labels and axis titles, driven by an editable data table), merged table cells
- Select, multi-select, drag, resize, rotate, snapping with guides, align, distribute, group/ungroup, lock, z-order, copy/paste/duplicate, arrow-key nudge, undo/redo for all of it
- Rich text: font, size, bold/italic/underline/strike, colour, highlight, alignment, bullets/numbers, line spacing, links, vertical alignment, shrink-to-fit
- Fill (solid or two-colour gradient on shapes), border, shadow, opacity, corner radius; image crop and adjustments; alt text on objects
- Layouts (title, title + content, two column, section, blank, caption); 8 themes that act as the slide master; custom palette
- Slide master extras: a deck-wide footer and slide numbers (Theme tab), shown in the editor, presenting and every export (flattened into plain text boxes in PPTX). There is no full master-layout editor yet
- Speaker notes, slide transitions, entrance animations with per-object order, find and replace

**Presenting**
- Fullscreen with keyboard, click and touch navigation, progress bar, black/white screen, laser pointer, pen
- Rehearsal: set an optional target time per slide; the presenter view shows time on the current slide and turns red when you go over (targets are kept in the deck JSON/backup, not in PPTX)
- Presenter view in a second window (current slide, next slide, notes, timer, remote control) using `BroadcastChannel` on the same browser. No server involved.

**Documents**
- Home screen: templates, open, rename, duplicate, delete, search, sort, favourites, folders
- Autosave with a visible saved / saving / error state; version history with restore
- Backup: export and import all decks as one JSON file, with strict validation
- Optional per-deck password lock (see [Password lock](#password-lock-what-it-does-and-does-not-do))

**Import / export**
- Export: PDF (with selectable, searchable text), PNG (one file per slide, zipped), PPTX, self-contained HTML, deck JSON
- Import: PPTX (text, images, basic shapes, tables, notes), images, Slidewise JSON / backup

**UX / accessibility**
- Menu bar, toolbar, context menu, shortcuts dialog; full keyboard operation; ARIA roles and names
- Light and dark UI (follows `prefers-color-scheme`); reduced motion respected
- Works on phones and tablets for viewing and presenting (editing on a phone is cramped)

## Getting started

Requires Node 20+.

```bash
npm ci
npm run dev        # development server
npm test           # unit tests
npm run build      # production build in dist/
npm run preview    # serve dist/ locally
npm run test:e2e   # E2E + performance checks (needs Chrome/Chromium, see CONTRIBUTING.md)
npm run audit:prod # npm audit --omit=dev
```

## Deploy to GitHub Pages

The workflow in `.github/workflows/deploy.yml` runs the audit, unit tests and E2E tests, then builds and deploys.

1. Create a GitHub repository and push this project to the `main` branch.
2. In the repository go to **Settings → Pages**. Under **Build and deployment → Source** choose **GitHub Actions**.
3. Push to `main` (or run the workflow from the **Actions** tab with **Run workflow**).
4. Wait for the **test** job, then the **deploy** job, to turn green. The site appears at
   `https://<user>.github.io/<repo>/`.

The build uses the repository name as its base path (`BASE_PATH=/<repo>/`) and hash routing (`#/deck/<id>`),
so no server rewrite rules are needed. To build for a different location yourself:

```bash
BASE_PATH=/my-subpath/ npm run build     # or BASE_PATH=./ (default) for relative paths
```

If you use a custom domain at the site root, set `BASE_PATH=/`.

## Keyboard shortcuts

`Ctrl` is `⌘` on macOS. Press `?` or `Ctrl+/` in the editor to see this list in-app.

| Action | Keys |
| --- | --- |
| Undo / Redo | Ctrl+Z / Ctrl+Shift+Z or Ctrl+Y |
| Find and replace | Ctrl+F |
| Show shortcuts | Ctrl+/ or ? |
| Save a version now | Ctrl+S |
| Present from start / from current slide | Ctrl+F5 or Shift+F5 / F5 |
| Select all | Ctrl+A |
| Copy / Cut / Paste | Ctrl+C / X / V |
| Duplicate | Ctrl+D |
| Delete | Delete / Backspace |
| Nudge 1 px (10 px with Shift) | Arrow keys |
| Group / Ungroup | Ctrl+G / Ctrl+Shift+G |
| Bring to front / Send to back | Ctrl+Shift+] / Ctrl+Shift+[ |
| Bring forward / Send backward | Ctrl+] / Ctrl+[ |
| Edit text of selected object / Stop editing | Enter or F2 / Esc |
| Select next / previous object | Tab / Shift+Tab |
| Constrain drag, rotate in 15° steps | Shift |
| Disable snapping while dragging | Alt |
| Bold / Italic / Underline (editing text) | Ctrl+B / I / U |
| Link (editing text) | Ctrl+K |
| New slide / Duplicate slide | Ctrl+M / Ctrl+Shift+D |
| Next / previous slide | Page Down / Page Up |
| Move slide up / down (slide list) | Ctrl+↑ / ↓ |
| Delete slide (slide list) | Delete |
| Zoom in / out / fit | Ctrl++ / Ctrl+- / Ctrl+0 |
| **Presenting:** next | → ↓ Space Page Down Enter, click, swipe left |
| previous | ← ↑ Page Up Backspace, swipe right |
| first / last slide | Home / End |
| black / white screen | B / W |
| laser / pen / clear pen | L / P / E |
| progress bar | G |
| exit | Esc |

## PPTX: what survives a round trip

Slidewise writes PPTX itself (no server). Exported files were checked by opening them with python-pptx and
LibreOffice; they were **not** tested in Microsoft PowerPoint or Keynote.

| Survives (export → import, covered by tests) | Does **not** survive / changes |
| --- | --- |
| Text with runs, bold/italic/underline, colours, sizes, alignment, bullets/numbers, links | Theme colours and fonts are **flattened to concrete values** (the deck keeps its look but is no longer theme-driven) |
| Rectangles, rounded rectangles, ellipses, triangles, arrows, lines, stars; solid and two-stop linear gradient fills, border, rotation | Shadows, per-shape effects and image adjustments/crop may be simplified |
| Images (PNG, JPEG, GIF, WebP) | **Charts are exported as pictures**, so they are no longer editable charts |
| Tables (cell text, basic styling, merged cells), groups | **Entrance animations are not exported** (and not imported) |
| Speaker notes | Transitions are exported as fade / push / zoom only, and other PowerPoint transitions are ignored on import |
| Slide size, slide order | Fonts that are not installed on the viewing machine are substituted by that machine; no fonts are embedded |

Importing a PowerPoint file made elsewhere is best-effort: text, images, basic preset shapes, tables and notes
are read. SmartArt, native charts, embedded video/audio, OLE objects, custom geometry, master/layout graphics,
and animations are dropped. SVG and other non-raster media are rejected on purpose.

## Reliability

- A crash-recovery screen replaces a blank page if a screen fails to render (including a stale lazy-loaded chunk after an update).
- When a new version is deployed, open tabs show a "new version available" prompt (service-worker update flow is tested end to end).
- Closing the tab while a save is in flight or has failed shows the browser's "unsaved changes" warning.
- Full, blocked or closing browser storage produces an actionable message instead of a raw error; if IndexedDB is unavailable the app keeps working in memory and says so.
- Dependabot is configured for npm and GitHub Actions. See [SECURITY.md](SECURITY.md) to report a vulnerability and [CHANGELOG.md](CHANGELOG.md) for releases.

## Security model

Imported files are treated as hostile:
- Every import is rebuilt from scratch by an allow-list validator (`src/model/validate.js`): unknown fields are dropped, numbers/colours/links are range- and pattern-checked, `javascript:` links are removed, prototype-pollution keys are refused, counts and sizes are capped.
- Images are accepted only if their **bytes** match PNG, JPEG, GIF or WebP; SVG is refused. Pasted HTML is sanitised with DOMPurify.
- PPTX import caps entries, uncompressed size and path names (zip-bomb / traversal), rejects DOCTYPE/ENTITY declarations, and nothing is ever evaluated.
- Strict Content-Security-Policy (no remote scripts, fonts or styles, no inline scripts). The self-contained HTML export carries its own hash-based CSP.
- `npm audit --omit=dev` is part of CI.

## Password lock: what it does and does not do

You can lock a deck with a password. The deck (and its version history) is then stored **encrypted** in IndexedDB with
AES-GCM using a key derived from your password with PBKDF2-SHA-256 (600,000 iterations, random salt). The key is kept in memory only while the deck is unlocked.

What it protects: someone who copies your browser profile or IndexedDB data, or finds your device unlocked **at rest**, cannot read the stored deck without the password.

What it does **not** protect:
- There is **no password recovery**. Forget it and the deck is gone.
- While a deck is open and unlocked, its content is in memory and on screen; malware, a malicious browser extension, or someone at your keyboard can see it.
- Exports (PDF, PNG, PPTX, HTML, JSON) are **not** encrypted.
- The deck's name and slide count stay visible on the home screen. Weak passwords can be guessed offline.
- It is client-side only and has not had an independent security audit.

## Privacy

Slidewise has no backend, no analytics, no cookies and makes no network requests with your content. The only storage used is
IndexedDB (your decks, versions, folders) and `localStorage` (small preferences). The service worker only caches the
app's own files for offline use. Clearing site data in your browser deletes your decks, so use **Back up all** regularly.

## Testing

- **Unit tests (Vitest):** data model and ops, undo/redo, validation and hostile input, storage and locking, text layout, rich text, transforms, presenter engine, PPTX export/import (including hostile zips).
- **End-to-end (real Chrome, production build served under the sub-path `/my-repo/`):** 41 checks covering creating a deck, adding every object type, reorder, presenting, presenter view, every export format, reload persistence, backup and hostile-import rejection, PPTX/image import, password lock, offline load via the service worker, phone viewport, dark mode and reduced motion, with no console errors or CSP violations allowed.
- **Accessibility:** axe-core (WCAG 2 A/AA + best practice) on home, editor, shortcuts dialog, presenter view, unlock dialog and dark home; serious/critical violations fail the run. 
- **Service-worker update:** `e2e/sw-update.mjs` serves version A, deploys a changed version B, and checks the new worker takes over, the old cache is removed, the update prompt appears and the app still loads offline.
- **Performance:** a 200-slide deck is imported, opened, navigated and presented in a real browser with time budgets (`e2e/perf.mjs`).

## Known limits

- Not tested in Safari or Firefox (Firefox/WebKit could not be installed where this was built); automated runs use Chromium only. Presenter view needs a browser with `BroadcastChannel` and both windows in the same browser profile.
- PDF pages are images with an invisible text layer on top: text is selectable and searchable, but only for top-level, un-rotated text boxes and shapes (not text in groups, tables or charts) and only Latin-1 characters. PNG and HTML exports are images; only PPTX keeps text as real, editable text.
- PPTX limitations are listed above. Animations are not exported to PPTX/HTML.
- Fonts are the system/web-safe set; no custom font upload and no remote fonts.
- No real-time collaboration, comments, or cloud sync. Each browser holds its own decks.
- Browsers may evict IndexedDB under storage pressure (the app asks the browser for persistent storage, but browsers may decline); keep backups with **Back up all**.
- Editing on phones is possible but cramped; the UI is designed for viewing and presenting there.
- Locking is not a substitute for disk encryption (see above).

## License

MIT, see [LICENSE](LICENSE). Contributions: see [CONTRIBUTING.md](CONTRIBUTING.md).
