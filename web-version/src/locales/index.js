/**
 * Participant-facing strings. Add `src/locales/<locale>.json`, import it below,
 * and set `VITE_LOCALE` (see `.env.example`).
 */
import en from './en.json'

const catalogs = { en }

export function getLocale() {
  return import.meta.env.VITE_LOCALE || 'en'
}

/**
 * @param {string} key dot.path into locale JSON
 * @param {Record<string, string | number>} [vars] replaces {{name}} in the string
 */
export function t(key, vars = {}) {
  const catalog = catalogs[getLocale()] || catalogs.en
  const parts = key.split('.')
  let cur = catalog
  for (const p of parts) {
    cur = cur?.[p]
  }
  if (typeof cur !== 'string') return key
  return cur.replace(/\{\{(\w+)\}\}/g, (_, k) =>
    vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : ''
  )
}
