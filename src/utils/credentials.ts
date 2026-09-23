import { authHeaders } from './auth'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

/*
 * Integration tokens move from the browser into an encrypted server-side vault. While a
 * connection's token is still local (typed in but not yet uploaded, or the vault is not
 * configured) it is sent as before; once vaulted, the connection id is sent instead and
 * the server supplies the token.
 */
export interface Credentialed {
  id: string
  token: string
  tokenInVault?: boolean
}

export type ProviderAuth = { token: string } | { connectionId: string }

export function hasCredential(c: Credentialed): boolean {
  return !!c.token?.trim() || !!c.tokenInVault
}

// A local token wins: it is either newer than the vaulted one or the vault is off.
export function authFor(c: Credentialed): ProviderAuth {
  const token = c.token?.trim()
  return token ? { token } : { connectionId: c.id }
}

export interface ProxyResponse {
  ok: boolean
  status: number
  json: () => Promise<unknown>
}

/*
 * GitHub and GitLab reads go through the backend so their tokens can stay in the vault.
 * Returns a minimal Response-like object so callers keep their existing `ok`/`status`/`json`
 * handling. `path` is relative to the provider's API host, e.g. /repos/acme/web/pulls.
 */
export async function providerGet(provider: 'github' | 'gitlab', auth: ProviderAuth, path: string): Promise<ProxyResponse> {
  const res = await fetch(`${API_URL}/pm-tracker/${provider}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ path, ...auth }),
  })
  if (!res.ok) {
    // The proxy itself refused (bad path, missing credential, vault off): surface its status.
    return { ok: false, status: res.status, json: () => res.json().catch(() => null) }
  }
  const body = (await res.json()) as { status: number; data: unknown }
  return {
    ok: body.status >= 200 && body.status < 300,
    status: body.status,
    json: () => Promise.resolve(body.data),
  }
}

// ── Vault management ────────────────────────────────────────────────────────
export interface VaultListing {
  available: boolean
  items: Array<{ connectionId: string; provider: string }>
}

export async function listVault(): Promise<VaultListing | null> {
  try {
    const res = await fetch(`${API_URL}/pm-tracker/credentials`, { headers: authHeaders() })
    return res.ok ? (await res.json()) as VaultListing : null
  } catch {
    return null
  }
}

export async function storeInVault(connectionId: string, provider: 'jira' | 'github' | 'gitlab', secret: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/pm-tracker/credentials/${encodeURIComponent(connectionId)}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ provider, secret }),
    })
    return res.status === 204
  } catch {
    return false
  }
}

export async function removeFromVault(connectionId: string): Promise<void> {
  try {
    await fetch(`${API_URL}/pm-tracker/credentials/${encodeURIComponent(connectionId)}`, {
      method: 'DELETE',
      headers: authHeaders(),
    })
  } catch { /* best effort: an orphaned encrypted row is harmless */ }
}
