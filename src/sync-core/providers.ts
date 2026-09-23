import type { ProviderAuth } from './credentials'
import type { Transport } from './transport'

export interface ProxyResponse {
  ok: boolean
  status: number
  json: () => Promise<unknown>
}

/*
 * GitHub and GitLab reads go through the backend's allow-listed proxy so their tokens can
 * stay in the vault. Returns the provider's status and body, not the proxy's. `path` is
 * relative to the provider's API host, e.g. /repos/acme/web/pulls.
 */
export async function providerGet(t: Transport, provider: 'github' | 'gitlab', auth: ProviderAuth, path: string): Promise<ProxyResponse> {
  const res = await t.post(`/pm-tracker/${provider}`, { path, ...auth })
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
