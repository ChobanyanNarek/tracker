const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'
const WORKSPACE = 'default'

export async function loadCloudState(): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${API_URL}/pm-tracker/state?workspace=${WORKSPACE}`)
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json() as { data: Record<string, unknown> }
    return json.data
  } catch {
    return null
  }
}

export async function saveCloudState(data: Record<string, unknown>): Promise<void> {
  try {
    await fetch(`${API_URL}/pm-tracker/state?workspace=${WORKSPACE}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
  } catch {
    // silent — localStorage is still the fallback
  }
}
