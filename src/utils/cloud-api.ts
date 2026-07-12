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

export async function saveCloudState(data: Record<string, unknown>): Promise<boolean> {
  if (!getToken()) return false
  try {
    const res = await fetch(`${API_URL}/pm-tracker/state`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify(data),
    })
    if (res.status === 401) { clearToken(); return false }
    return res.ok
  } catch {
    return false
  }
}
