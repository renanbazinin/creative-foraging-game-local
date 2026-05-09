### Goal

Move **`Creative-Foraging-Detection-Media-Pipe/web-version`** toward TypeScript in **small, reviewable slices**, keeping the app buildable and shippable after each step. Prefer **`allowJs: true`** until most of `src/` is `.ts`/`.tsx`, then consider tightening.

### Why incremental

- Avoid a giant PR that mixes toolchain + every component + MediaPipe typings.
- Each slice should pass **`npm run test`**, **`npm run build`**, and **`npm run lint`** in `web-version/`.

### Done (slice 1)

- [x] Toolchain: `typescript`, `@types/node`, `typescript-eslint`, root `tsconfig.json` (`strict`, `noEmit`, `allowJs`, `moduleResolution: bundler`, …).
- [x] First pure module: `src/utils/gameLogic.ts` + `gameLogic.test.ts` (extensionless imports from React code unchanged).
- [x] Vitest picks up `*.test.ts`; ESLint applies TS rules only to `**/*.{ts,tsx}`.

### Proposed order (slices 2+)

| Slice | Scope | Notes |
|--------|--------|--------|
| 2 | `sessionCsv.js` + tests | Small, data-focused |
| 3 | `sessionNormalize.js` (+ tests if any) | Same |
| 4 | Shared `src/utils/*.js` without heavy DOM | e.g. small helpers |
| 5 | `src/services/**` | Boundaries / fetch logic |
| 6 | Components | Start with leaf components; defer huge files (e.g. detectors) or split types-only `.ts` sidecars |
| 7 | Entry | `main.jsx` → `main.tsx`, then optional `vite.config.ts` + `tsconfig.node.json` |

### Out of scope (until late)

- Typing every MediaPipe / `window.*` global perfectly (stubs or gradual `declare` as needed).
- `allowJs: false` repo-wide until TS coverage is high.

### Acceptance criteria (each PR)

1. `npm run test` / `npm run build` / `npm run lint` pass from `web-version/`.
2. No unnecessary import churn (keep extensionless imports where Vite already resolves them).
3. New `.ts`/`.tsx` files respect `strict`; don’t expand scope to “fix all legacy lint” unless agreed.

### Help wanted

Smaller PRs per slice are welcome; link them to this epic.
