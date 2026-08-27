import { authHeaders, clearToken, getToken } from './auth'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

export async function loadCloudState(): Promise<Record<string, unknown> | null> {
  if (!getToken()) return null
  try {
    const res = await fetch(`${API_URL}/pm-tracker/state`, {
      headers: authHeaders(),
    })
    if (res.status === 404) return null
    if (res.status === 401) { clearToken(); return null }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json() as { data: Record<string, unknown> }
    return json.data
  } catch {
    return null
  }
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

export async function adminEditUser(id: string, data: { phone?: string | null }): Promise<boolean> {
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
// The full state blob can run several MB — compressing it typically cuts that to ~15% of the
// original size, which meaningfully reduces how long the upload is exposed to being aborted
// mid-transfer on a slow or unstable connection. express.json() on the backend already
// auto-decompresses a gzip Content-Encoding body, so no server-side change is needed.
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

export async function saveCloudState(data: Record<string, unknown>): Promise<boolean> {
  if (!getToken()) return false
  try {
    const { body, headers } = await gzipJson(data)
    const res = await fetch(`${API_URL}/pm-tracker/state`, {
      method: 'PUT',
      headers: { ...authHeaders(), ...headers },
      body,
    })
    if (res.status === 401) { clearToken(); return false }
    return res.ok
  } catch {
    return false
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
