/// <reference types="vitest/config" />
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'))

const DEFAULT_BASE = '/creative-foraging-game-local/'

/** Short git SHA of the current build; 'local' when git is unavailable. */
function resolveGitSha() {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return 'local'
  }
}

/** @param {string | undefined} raw */
function normalizeBase(raw) {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_BASE
  if (raw === '/') return '/'
  const withSlash = raw.startsWith('/') ? raw : `/${raw}`
  return withSlash.endsWith('/') ? withSlash : `${withSlash}/`
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const base = normalizeBase(env.VITE_BASE_URL)
  const manifestId = env.VITE_PWA_MANIFEST_ID || base

  return {
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __APP_GIT_SHA__: JSON.stringify(resolveGitSha()),
      __APP_BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
    },
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: 'auto',
        manifest: {
          id: manifestId.startsWith('/') ? manifestId : `/${manifestId}`,
          name: 'Creative Foraging – Bracelet Detector',
          short_name: 'Creative Foraging',
          description:
            'Creative Foraging web game with hand bracelet detector powered by MediaPipe. Runs fully in the browser.',
          theme_color: '#111827',
          background_color: '#111827',
          display: 'standalone',
          orientation: 'any',
          scope: '.',
          start_url: '.',
          icons: [
            {
              src: 'pwa-192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: 'pwa-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: 'pwa-512-maskable.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
          screenshots: [
            {
              src: 'pwa-screenshot-wide.png',
              type: 'image/png',
              sizes: '1280x720',
              form_factor: 'wide',
              label: 'Creative Foraging (desktop)',
            },
            {
              src: 'pwa-screenshot-narrow.png',
              type: 'image/png',
              sizes: '540x720',
              form_factor: 'narrow',
              label: 'Creative Foraging (mobile)',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
          globIgnores: ['**/*.{tflite,wasm}'],
          runtimeCaching: [
            {
              urlPattern: ({ request }) => request.mode === 'navigate',
              handler: 'NetworkFirst',
              options: {
                cacheName: 'pages',
                networkTimeoutSeconds: 3,
              },
            },
            {
              urlPattern: ({ url }) => url.pathname.includes('/assets/'),
              handler: 'NetworkFirst',
              options: {
                cacheName: 'assets-runtime',
                expiration: {
                  maxEntries: 80,
                  maxAgeSeconds: 60 * 60 * 24 * 30,
                },
              },
            },
          ],
        },
      }),
    ],
    base,
    server: {
      port: 3000,
    },
    test: {
      globals: true,
      environment: 'node',
      include: ['src/**/*.test.{js,ts}'],
    },
  }
})
