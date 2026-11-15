# Contributing to Slidewise

Slidewise is a browser-only app: no backend, no accounts, no telemetry. Please keep it that way.
Changes that add a server, a third-party API, remote fonts/scripts, or analytics will not be accepted.

## Setup

```bash
npm ci
npm run dev          # http://localhost:5173
npm test             # unit tests (Vitest, jsdom, fake-indexeddb)
npm run build        # production build into dist/
npm run test:e2e     # builds under /my-repo/, then real-Chrome end-to-end + performance checks
```

The E2E tests drive a real Chrome/Chromium through `puppeteer-core`. Set `CHROME_PATH` if it is not
at `/usr/bin/google-chrome`. `SKIP_BUILD=1 node e2e/run.mjs` reuses an existing `dist/` built with
`BASE_PATH=/my-repo/`.

## Layout

| Path | What lives there |
| --- | --- |
| `src/model` | Immutable deck model, ops, undo history, `validate.js` (the hostile-input sanitiser) |
| `src/render` | Canvas renderer used by editor, thumbnails, presenting and exports |
| `src/editor`, `src/components` | Editing UI, rich-text editor, inspector, menus |
| `src/present` | Presenter engine, fullscreen show, second-window presenter view |
| `src/storage`, `src/crypto` | IndexedDB (memory fallback), versions, backups, password lock |
| `src/export`, `src/import` | PDF / PNG / PPTX / HTML export; PPTX / image / JSON import |
| `e2e/` | Browser tests, axe checks, 200-slide performance check |

## Rules of the road

1. **Everything that enters the app is hostile.** Imports must go through `validateDeck`
   (allow-list rebuild, never "clean up in place"). Never use `innerHTML` with untrusted data,
   `eval`, `new Function`, or inline event handlers. The CSP forbids them and the E2E suite fails on CSP violations.
2. **Model changes are pure.** Ops take a deck and return a new deck. Add a unit test for each op.
3. **Every user-visible feature needs a test** (unit where possible, E2E where it needs a browser).
   Do not describe a feature as working in the README unless a test covers it.
4. **Accessibility:** keyboard operable, named controls, no new serious/critical axe violations.
5. **No new runtime dependencies** without a reason. `npm audit --omit=dev` must report zero vulnerabilities.
6. Keep the app working from a repository sub-path (`BASE_PATH`) and offline.

## Pull requests

Describe what changed and how you tested it. CI must be green (audit, unit tests, E2E).
