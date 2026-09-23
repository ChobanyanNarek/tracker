import { authHeaders, getToken } from './auth'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

// Guards that keep a broken page from flooding the admin log. The server throttles too.
const MAX_REPORTS_PER_SESSION = 20
const MAX_MESSAGE = 500
const MAX_STACK = 8000

export type ErrorKind = 'error' | 'unhandledrejection' | 'render' | 'save'

export interface ErrorReport {
  message: string
  stack?: string
  kind: ErrorKind
}

const sent = new Set<string>()
let sentCount = 0

// Errors that are not the app's fault and carry nothing actionable.
function isNoise(message: string, stack?: string): boolean {
  if (/ResizeObserver loop/i.test(message)) return true
  // A cross-origin script failed and the browser withheld the details.
  if (message === 'Script error.' || message === 'Script error') return true
  // Browser extensions injecting into the page.
  if (stack && /(chrome|moz|safari)-extension:\/\//.test(stack)) return true
  return false
}

/*
 * Send a browser error to the backend's admin log. Never throws and never awaits in the
 * caller's path: reporting a failure must not become a second failure. Duplicates are sent
 * once per session and the total is capped, so an error loop costs at most a few requests.
 */
export function reportError(report: ErrorReport): void {
  try {
    if (!getToken()) return
    const message = (report.message || 'Unknown error').slice(0, MAX_MESSAGE)
    if (isNoise(message, report.stack)) return

    const key = `${report.kind}|${message}|${(report.stack ?? '').slice(0, 300)}`
    if (sent.has(key) || sentCount >= MAX_REPORTS_PER_SESSION) return
    sent.add(key)
    sentCount++

    void fetch(`${API_URL}/pm-tracker/client-errors`, {
      method: 'POST',
      headers: authHeaders(),
      // Only fields the endpoint declares: the server rejects unknown ones. The URL is
      // origin + path only, so no query string (and nothing sensitive in it) is recorded.
      body: JSON.stringify({
        message,
        kind: report.kind,
        ...(report.stack ? { stack: report.stack.slice(0, MAX_STACK) } : {}),
        url: `${location.origin}${location.pathname}`,
        release: __COMMIT__,
      }),
      keepalive: true,
    }).catch(() => { /* offline or backend down — nothing sensible to do */ })
  } catch {
    // Reporting must never break the page.
  }
}

function describe(value: unknown): { message: string; stack?: string } {
  if (value instanceof Error) return { message: `${value.name}: ${value.message}`, stack: value.stack }
  if (typeof value === 'string') return { message: value }
  try { return { message: JSON.stringify(value).slice(0, MAX_MESSAGE) } } catch { return { message: String(value) } }
}

let installed = false

// Catch everything that escapes the app: uncaught errors and unhandled promise rejections.
export function installErrorReporting(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('error', (e) => {
    const d = e.error ? describe(e.error) : { message: e.message }
    reportError({ ...d, kind: 'error' })
  })
  window.addEventListener('unhandledrejection', (e) => {
    reportError({ ...describe(e.reason), kind: 'unhandledrejection' })
  })
}

// Test hook: reset the per-session de-duplication state.
export function __resetErrorReporterForTests(): void {
  sent.clear()
  sentCount = 0
}
