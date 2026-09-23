/*
 * Integration tokens live in an encrypted server-side vault. While a connection's token is
 * still local (typed in but not yet uploaded, or the vault is not configured) it is sent as
 * before; once vaulted, the connection id is sent instead and the server supplies the token.
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
