import { authFor, hasCredential, type Credentialed, type ProviderAuth } from '../sync-core/credentials'
import { providerGet as coreProviderGet, type ProxyResponse } from '../sync-core/providers'
import { authHeaders } from './auth'
import { browserTransport } from './browser-transport'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

export { authFor, hasCredential }
export type { Credentialed, ProviderAuth, ProxyResponse }

/*
 * GitHub and GitLab reads go through the backend so their tokens can stay in the vault.
 * `path` is relative to the provider's API host, e.g. /repos/acme/web/pulls.
 */
export function providerGet(provider: 'github' | 'gitlab', auth: ProviderAuth, path: string): Promise<ProxyResponse> {
  return coreProviderGet(browserTransport, provider, auth, path)
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
