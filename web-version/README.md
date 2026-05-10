# Creative Foraging — Web Version (developer README)

**Full project context** (research goals, architecture, session formats, Admin routes): [**repository root `README.md`**](../README.md).

**Privacy / IRB helpers:** [`PRIVACY.md`](../PRIVACY.md)

**Live site:** [GitHub Pages](https://renanbazinin.github.io/creative-foraging-game-local/)

This folder is the React + Vite SPA: local-first sessions (`sessions/<id>/session.json` + `session.csv`), optional MediaPipe bracelet detection, Admin/import tooling. Details below focus on **commands**, **configuration**, and **troubleshooting**.

**Python is not required.** The repository root also ships PsychoPy scripts and a standalone Python bracelet logger under `player_detector/`—those exist as **optional reference** from an **older project**. For the standard deployment and studies, **Node/npm and this folder are enough**.

## Browser support

| Feature | Chrome / Edge (desktop) | Firefox | Safari |
|--------|-------------------------|---------|--------|
| Game + canvas | Supported | Supported | Supported |
| File System Access (pick data folder) | Supported | Limited / unsupported | Limited / unsupported |
| Webcam + MediaPipe | Supported | Usually supported | Often supported |

**Recommendation:** use **Chrome or Edge on desktop** for studies that rely on saving to a chosen folder. Participants can use other browsers only if your protocol does not depend on that API.

## Quick Start

### Installation

```powershell
cd path\to\Creative-Foraging-Detection-Media-Pipe\web-version
npm ci
```

### Development server

```powershell
npm run dev
```

Open **`http://localhost:3000`**. Copy **`.env.example`** to **`.env`** if you need custom `VITE_*` variables.

### Production build

```powershell
npm run build
npm run preview
```

Deploy contents of `dist/`. Camera, MediaPipe, and File System Access need **HTTPS** or **localhost** (not `file://`).

## Fork and deploy (GitHub Pages or any static host)

1. Set the Vite **base URL** so asset paths match your hosting path:
   - For `https://<user>.github.io/<repo>/`, set in `.env`:

     `VITE_BASE_URL=/<repo>/`

   - For a custom domain at the site root, use `VITE_BASE_URL=/`.

2. Optionally set `VITE_PWA_MANIFEST_ID` to the same path if the PWA identity should match.

3. Run `npm run build` and upload `dist/` (or use `npm run deploy` for the `gh-pages` branch).

## Kiosk / lab mode

Set in `.env`:

`VITE_KIOSK_MODE=true`

This hides in-game shortcuts to Admin, Detector2, and the “open detector window” control during the run (hash routes still work if typed). Pair with `ENABLE_DETECTOR` / `DETECTOR_IN_NEW_WINDOW` in `src/App.jsx` as needed.

## Legacy export import (CSV / JSON)

Meaning: files from the **old server + Admin pipeline**, not arbitrary DB dumps. `_id` / `moveId` semantics match that legacy shape.

- **Column order** for `session.csv` and Admin CSV downloads: `LEGACY_EXPORT_CSV_COLUMNS` in [`src/utils/sessionCsv.js`](src/utils/sessionCsv.js). Full column list and normalization rules: [**root README**](../README.md).
- **Manual import:** Under `sessions/`, subfolders may contain paired `<stem>.json` + `<stem>.csv`. Prefer JSON; CSV fallback via parser in `sessionCsv.js`. Canonical layout after import: `sessions/<id>/session.json` + `session.csv`.

## Progressive Web App (PWA)

[`vite-plugin-pwa`](https://vite-pwa-org.netlify.app/) provides manifest + service worker. Secure context required. Large MediaPipe `.tflite` / `.wasm` assets are **not** fully precached (`vite.config.js` `globIgnores`); first run often needs network; offline is partial until runtime caches fill.

## Configuration

In [`src/App.jsx`](src/App.jsx):

```javascript
const ENABLE_DETECTOR = true;           // bracelet detector on/off
const DETECTOR_IN_NEW_WINDOW = false;   // inline vs popup (#/detector)
```

Environment variables (see `.env.example`): `VITE_BASE_URL`, `VITE_PWA_MANIFEST_ID`, `VITE_KIOSK_MODE`, `VITE_LOCALE`.

## How to Play (participant)

1. Start dialog: participant ID, condition, duration; connect data folder if prompted.
2. **Practice:** movable blocks appear **blue**, fixed **green** (see `gameLogic.js` `updateCanMove`).
3. **`p`:** end practice, start timed experiment (experiment phase: blocks **green**, still only `canMove` blocks drag).
4. **Gallery:** top-right frame saves figure (keyboard: focus gallery, Enter or Space).
5. **`q`:** end experiment early (during experiment).

## Participant-facing strings (locales)

Copy [`src/locales/en.json`](src/locales/en.json) to a new locale file, register it in [`src/locales/index.js`](src/locales/index.js), and set `VITE_LOCALE` if you add multiple catalogs.

## Bracelet Detector (tuning)

- Routes: `#/detector`, `#/detector2`, `#/calibrate`.
- Primary component: [`src/components/BraceletDetector.jsx`](src/components/BraceletDetector.jsx); helpers in `src/utils/colorDetector*.js`.
- Tune thresholds in source for your cameras.

## Game data — two CSV paths

| Mechanism | Where |
|-----------|--------|
| Browser download at end | [`csvLogger.js`](src/utils/csvLogger.js) — human-readable columns (`date`, `id`, `phase`, …) |
| Per-session `session.csv` | Written beside `session.json` via [`localSessionStore.js`](src/services/localSessionStore.js) — **legacy column order** for analysis pipelines |

## Technical stack

React 18, Vite 5, MediaPipe Hands, Canvas. Client-only: [`src/config/api.config.js`](src/config/api.config.js).

## Quality scripts

| Script | Purpose |
|--------|---------|
| `npm run test` | Vitest |
| `npm run lint` | ESLint |
| `npm run format` | Prettier |

## File structure (high level)

```
web-version/
├── vite.config.js          # base from VITE_BASE_URL; dev port 3000; PWA; Vitest
├── package.json
├── index.html
├── src/
│   ├── main.jsx
│   ├── App.jsx             # hash routes, ENABLE_DETECTOR, kiosk mode
│   ├── locales/            # participant-facing copy (extend for new languages)
│   ├── config/api.config.js
│   ├── services/localSessionStore.js
│   ├── components/
│   └── utils/
└── public/
```

## Deploy to GitHub Pages

From this folder:

```powershell
npm install
npm run deploy
```

(`predeploy` builds; `gh-pages` publishes `dist/`.) Ensure **`VITE_BASE_URL`** matches your Pages URL before building. Point GitHub **Settings → Pages** at the `gh-pages` branch (or your chosen flow).

## Troubleshooting

- **Webcam:** permissions, close other apps using camera, check console.
- **Detector accuracy:** lighting, distance, threshold edits in `BraceletDetector.jsx`.
- **Blocks won’t move:** only legally movable blocks (`canMove`); practice shows blue for movable.
- **CSV download blocked:** pop-ups / downloads settings in browser.
- **Folder access:** use Chromium desktop (Chrome/Edge) for File System Access API.

## Credits

Based on the original Creative Foraging Game by **Kristian Tylén (AU 2018)**. Web version created November 2025.
