# Contributing

Thanks for helping improve this project.

## Where things live

- **Architecture and research context:** [`README.md`](README.md) at the repository root (this repo).
- **Web app (React + Vite):** [`web-version/`](web-version/)
- **PsychoPy / Python:** [`CreativeForaging_Source.py`](CreativeForaging_Source.py), [`ppc3.py`](ppc3.py)

## Repository URL

If you fork the project, update `repository.url` (and `homepage` if needed) in [`web-version/package.json`](web-version/package.json) so links match your GitHub remote.

## Web app — local development

```bash
cd web-version
npm ci
npm run dev
```

Open **http://localhost:3000**. Optional env vars: copy `web-version/.env.example` to `web-version/.env`.

Commands:

| Script | Purpose |
|--------|---------|
| `npm run dev` | Dev server |
| `npm run build` | Production bundle |
| `npm run test` | Vitest |
| `npm run lint` | ESLint |
| `npm run format` | Prettier |

## Pull requests

- Keep changes focused and consistent with existing style.
- Run `npm run test`, `npm run lint`, and `npm run build` in `web-version/` before submitting.
- Describe what changed and why (research labs benefit from clear rationale).

## Participant-facing text (locales)

Strings live under `web-version/src/locales/`. Default locale is `en`; add another JSON file and register it in `src/locales/index.js`, then set `VITE_LOCALE` if you introduce multiple catalogs.

## Ethics

This software is often used in human-participant studies. Contributors should avoid changes that unexpectedly exfiltrate data or weaken consent boundaries; see [`PRIVACY.md`](PRIVACY.md).
