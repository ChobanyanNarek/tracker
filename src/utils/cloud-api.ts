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

export async function saveCloudState(data: Record<string, unknown>): Promise<void> {
  if (!getToken()) return
  try {
    const res = await fetch(`${API_URL}/pm-tracker/state`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify(data),
    })
    if (res.status === 401) clearToken()
  } catch {
    // silent
  }
}
