# Privacy and data handling

This document summarizes how the **web application** (under [`web-version/`](web-version/)) processes data in the browser. It is intended to help researchers draft consent forms and IRB materials. **This is not legal advice.**

## No cloud backend

The deployed app runs entirely in the participant’s browser. There is **no** project-hosted API receiving session data. Configuration is documented in [`web-version/src/config/api.config.js`](web-version/src/config/api.config.js) (client-only).

## Camera and microphone

If you enable the bracelet / hand pipeline, the browser may access the **webcam**. Video is processed locally (e.g. MediaPipe). Whether frames or derived features are stored depends on build-time and runtime settings:

- Optional **video frame snapshots** can be embedded in logs when `SAVE_CAMERA_FRAMES` is set to `true` in [`GameCanvas.jsx`](web-version/src/components/GameCanvas.jsx). That increases **storage size** and **identifiability** of recordings. Keep it `false` unless your protocol explicitly requires it and consent covers it.

## Local disk (File System Access API)

When the experimenter chooses a data folder, the app can write:

- `sessions/<session-id>/session.json` and `session.csv`
- Optional `CFG_DATA_README.txt` at the data root

Data stays on the machine where the folder resides unless you copy it elsewhere.

## Browser storage

The app may use **IndexedDB** to remember the chosen directory handle (see [`localSessionStore.js`](web-version/src/services/localSessionStore.js)) and **localStorage** for bracelet detector logs and calibration, depending on features used.

## Your responsibilities

Deployers are responsible for:

- Appropriate **consent**, **data retention**, and **security** for their jurisdiction and institution.
- Securing copied exports (CSV/JSON) and any screen or camera recordings made outside this software.

For software licensing, see [`LICENSE`](LICENSE).
