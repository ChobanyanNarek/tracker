import { authHeaders, clearToken, getToken, refreshAccessToken } from './auth'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

// ── Per-record storage (backend ADR-0018) ──────────────────────────────────
// A user's data is a set of records -- one per task, one per settings section -- each with
// a revision. Saves send only changed records, each naming the revision it started from;
// the server refuses stale ones and returns its current copy as a conflict.

export interface DocRecord { key: string; data: unknown; revision: number }
export interface TaskRecord { id: string; data: Record<string, unknown>; revision: number }
export interface RecordsResponse {
  full: boolean
  cursor: number
  docs: DocRecord[]
  tasks: TaskRecord[]
  deleted: Array<{ id: string; revision: number }>
}

export interface CommitBody {
  docs: Array<{ key: string; data: unknown; baseRevision: number | null }>
  tasks: Array<{ id: string; data: unknown; baseRevision: number | null }>
  deletes: Array<{ id: string; baseRevision: number }>
}
export interface CommitResponse {
  applied: Array<{ kind: 'doc' | 'task' | 'delete'; id: string; revision: number }>
  conflicts: Array<{ kind: 'doc' | 'task' | 'delete'; id: string; data?: unknown; revision?: number }>
  rejected: Array<{ kind: 'doc' | 'task'; id: string; reason: string }>
}

/*
 * Everything (since omitted), or only records changed after a cursor. Null when signed
 * out. Throws when the server can't be reached or fails -- never an empty result that
 * could be mistaken for the user having no data. The first call for a user also moves
 * their old saved state into records, server-side.
 */
export async function loadRecords(since?: number): Promise<RecordsResponse | null> {
  if (!getToken()) return null
  const url = `${API_URL}/pm-tracker/records${since === undefined ? '' : `?since=${since}`}`
  const get = () => fetch(url, { headers: authHeaders() })
  let res = await get()
  // Reopening the app after the access token expired shouldn't dump the user back
  // to the login screen while a valid refresh token is sitting in storage.
  if (res.status === 401 && await refreshAccessToken()) {
    res = await get()
  }
  if (res.status === 401) { clearToken(); return null }
  if (!res.ok) throw new Error(`Loading records failed: HTTP ${res.status}`)
  return await res.json() as RecordsResponse
}

export interface AdminUser {
  id: string
  firstName: string
  lastName: string
  email: string
  phone?: string | null
  role: string
  status: string
  devCount: number
  projectCount: number
  jiraConnected: boolean
  gitlabConnected: boolean
  githubConnected: boolean
  subscriptionActive?: boolean
  subscriptionUntil?: string | null
  trialUntil?: string | null
}

export interface AdminPayment {
  id: string
  userId: string
  userEmail: string
  userName: string
  amount: number
  currency: string
  status: 'pending' | 'completed' | 'failed' | 'refunded'
  paymentId: string
  orderId: string | number
  cardNumber?: string
  createdAt: string
  completedAt?: string | null
  subscriptionUntil?: string | null
}

export async function adminGetUsers(): Promise<AdminUser[]> {
  try {
    const res = await fetch(`${API_URL}/admin/pm-tracker/users`, { headers: authHeaders() })
    if (!res.ok) return []
    const json = await res.json() as { users: AdminUser[] }
    return json.users
  } catch { return [] }
}

export async function adminDeleteUser(id: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/admin/pm-tracker/users/${id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    })
    return res.ok || res.status === 204
  } catch { return false }
}

export async function adminDeleteUserData(id: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/admin/pm-tracker/users/${id}/data`, {
      method: 'DELETE',
      headers: authHeaders(),
    })
    return res.ok || res.status === 204
  } catch { return false }
}

export async function adminChangePassword(id: string, password: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/admin/pm-tracker/users/${id}/password`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ password }),
    })
    return res.ok || res.status === 204
  } catch { return false }
}

export async function adminEditUser(id: string, data: { phone?: string | null; email?: string }): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/users/${id}`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify(data),
    })
    return res.ok
  } catch { return false }
}

export async function updateMyProfile(phone: string | null): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/users/me`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ phone }),
    })
    return res.ok || res.status === 204
  } catch { return false }
}

export async function changeMyPassword(currentPassword: string, password: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${API_URL}/users/me/password`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ currentPassword, password }),
    })
    if (res.ok || res.status === 204) return { ok: true }
    const body = await res.json().catch(() => ({})) as { message?: string }
    return { ok: false, error: body.message }
  } catch { return { ok: false } }
}

export async function adminGetPayments(): Promise<AdminPayment[]> {
  try {
    const res = await fetch(`${API_URL}/admin/pm-tracker/payments`, { headers: authHeaders() })
    if (!res.ok) return []
    const json = await res.json() as { payments: AdminPayment[] }
    return json.payments
  } catch { return [] }
}

export async function adminGrantSubscription(userId: string, months: number, days: number): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/admin/pm-tracker/users/${userId}/subscription`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ months: months || undefined, days: days || undefined }),
    })
    return res.ok
  } catch { return false }
}

export async function adminRevokeSubscription(userId: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/admin/pm-tracker/users/${userId}/subscription`, {
      method: 'DELETE',
      headers: authHeaders(),
    })
    return res.ok
  } catch { return false }
}

export async function adminRefundPayment(paymentId: string): Promise<{ ok: boolean; message?: string }> {
  const res = await fetch(`${API_URL}/payment/refund/${paymentId}`, {
    method: 'POST',
    headers: authHeaders(),
  })
  const body = await res.json().catch(() => ({})) as { ok?: boolean; message?: string }
  return { ok: res.ok && body.ok !== false, message: body.message }
}

// Gzip the JSON body before sending when the browser supports it (all current browsers do).
// A large save (a full sync touches many tasks) compresses to ~15% of its size, which
// shortens how long the upload is exposed to being aborted on a slow connection.
// express.json() on the backend decompresses a gzip Content-Encoding body.
async function gzipJson(data: Record<string, unknown>): Promise<{ body: BodyInit; headers: Record<string, string> }> {
  const json = JSON.stringify(data)
  if (typeof CompressionStream === 'undefined') return { body: json, headers: {} }
  try {
    const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))
    const compressed = await new Response(stream).blob()
    return { body: compressed, headers: { 'Content-Encoding': 'gzip' } }
  } catch {
    return { body: json, headers: {} }
  }
}

export type SaveFailReason = 'unauthorized' | 'network' | 'tooLarge' | 'server'

// Set on pagehide so the final save switches to a keepalive request, which the browser
// allows to outlive the document instead of killing it mid-flight.
let unloading = false
export function markUnloading(): void { unloading = true }

// A save that never settles would block the save queue forever (nothing else can
// flush while one is in flight), so give it a hard ceiling and let the retry take over.
const SAVE_TIMEOUT_MS = 45_000
// keepalive requests are capped at 64KB by the fetch spec — only usable for a payload
// that actually fits, which gzip usually achieves for all but the largest states.
const KEEPALIVE_MAX_BYTES = 60_000

export type CommitResult = { ok: true; result: CommitResponse } | { ok: false; reason: SaveFailReason }

export async function commitRecords(body: CommitBody): Promise<CommitResult> {
  if (!getToken()) return { ok: false, reason: 'unauthorized' }
  try {
    const { body: payload, headers } = await gzipJson(body as unknown as Record<string, unknown>)
    const size = payload instanceof Blob ? payload.size : new Blob([payload as string]).size
    const useKeepalive = unloading && size <= KEEPALIVE_MAX_BYTES

    const send = async (): Promise<Response> => {
      const controller = new AbortController()
      const timer = useKeepalive ? null : setTimeout(() => controller.abort(), SAVE_TIMEOUT_MS)
      try {
        return await fetch(`${API_URL}/pm-tracker/records/commit`, {
          method: 'POST',
          headers: { ...authHeaders(), ...headers },
          body: payload,
          ...(useKeepalive ? { keepalive: true } : { signal: controller.signal }),
        })
      } finally {
        if (timer) clearTimeout(timer)
      }
    }

    let res = await send()

    // Access token expired mid-session: renew it silently and replay the save once,
    // so a routine 24h expiry never surfaces as a failed save to the user.
    if (res.status === 401 && !unloading) {
      const renewed = await refreshAccessToken()
      if (!renewed) { clearToken(); return { ok: false, reason: 'unauthorized' } }
      res = await send()
    }

    if (res.status === 401) { clearToken(); return { ok: false, reason: 'unauthorized' } }
    if (res.ok) return { ok: true, result: await res.json() as CommitResponse }
    // Say what actually went wrong, so the banner is accurate and a request that can
    // never succeed is not hammered at the normal retry rate.
    if (res.status === 413) return { ok: false, reason: 'tooLarge' }
    if (res.status >= 500) return { ok: false, reason: 'server' }
    return { ok: false, reason: 'network' }
  } catch {
    return { ok: false, reason: 'network' }
  }
}

// ── Server-side task search & release-notes pagination ──────────────────────
// Mirrors the backend's PmTrackerTaskDto — a mirror row of a frontend Task,
// kept in sync server-side (see progressor-backend PR #1). jiras/rest carry
// the same shape as Task.jiras / everything else on Task respectively.
export interface RemoteTask {
  id: string
  createdAt: string
  updatedAt: string
  clientId: string
  devId: string
  projectId: string
  title: string
  status: string
  date: string
  comment: string | null
  jiras: Record<string, unknown>[]
  rest: Record<string, unknown>
}

export interface PageMeta {
  page: number
  take: number
  itemCount: number
  pageCount: number
  hasPreviousPage: boolean
  hasNextPage: boolean
}

export interface PagedResult<T> {
  data: T[]
  meta: PageMeta
}

async function fetchPaged<T>(path: string, params: Record<string, string | number | undefined>): Promise<PagedResult<T> | null> {
  if (!getToken()) return null
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') qs.set(k, String(v))
  }
  try {
    const res = await fetch(`${API_URL}${path}?${qs.toString()}`, { headers: authHeaders() })
    if (res.status === 401) { clearToken(); return null }
    if (!res.ok) return null
    return await res.json() as PagedResult<T>
  } catch {
    return null
  }
}

export function searchTasks(params: {
  q?: string
  projectId?: string
  status?: string
  page?: number
  take?: number
}): Promise<PagedResult<RemoteTask> | null> {
  return fetchPaged<RemoteTask>('/pm-tracker/tasks/search', params)
}

export function getReleaseNoteTasks(params: {
  projectId?: string
  dateFrom?: string
  dateTo?: string
  page?: number
  take?: number
}): Promise<PagedResult<RemoteTask> | null> {
  return fetchPaged<RemoteTask>('/pm-tracker/tasks/release-notes', params)
}

const MAX_TAKE = 50
// Backend release-note-status grouping/pagination all happens client-side
// (the backend only knows projectId/date-range, not status groups), so
// Release Notes needs every task in the range, not one server page — this
// loops through pages to build the complete set. Bounded to 40 pages
// (2000 tasks) as a hard safety cap against a runaway date range.
export async function getAllReleaseNoteTasks(params: {
  projectId?: string
  dateFrom?: string
  dateTo?: string
}): Promise<RemoteTask[] | null> {
  const all: RemoteTask[] = []
  let page = 1
  for (let i = 0; i < 40; i++) {
    const result = await getReleaseNoteTasks({ ...params, page, take: MAX_TAKE })
    if (!result) return all.length ? all : null
    all.push(...result.data)
    if (!result.meta.hasNextPage) break
    page++
  }
  return all
}

// ── Browser errors (built-in error tracking) ────────────────────────────────
export interface ClientErrorEntry {
  id: string
  timestamp: string
  message: string
  context?: {
    userId?: string
    kind?: string
    url?: string | null
    release?: string | null
    stack?: string | null
    userAgent?: string | null
  }
}

// Newest browser errors first. Admin-only on the server (SUPER_ADMIN passes every role check).
export async function adminGetClientErrors(page = 1): Promise<PagedResult<ClientErrorEntry> | null> {
  return fetchPaged<ClientErrorEntry>('/admin/logs', { source: 'web', order: 'DESC', take: 50, page })
}
