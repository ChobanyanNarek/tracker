import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { fetchAndStoreUserInfo, getUserInfo, setToken, clearToken } from './auth'

/*
 * Signing in at /admin with the right password put you straight back on the login form
 * with nothing on screen. The password was never the problem: /auth/me had failed, the
 * role was never stored, and the admin check read the missing role as "not an admin".
 * A failure has to come back as a failure, or the caller cannot say so.
 */
describe('loading the signed-in account', () => {
  beforeEach(() => {
    localStorage.clear()
    setToken('an-access-token')
  })
  afterEach(() => { vi.unstubAllGlobals() })

  const respond = (init: ResponseInit, body: unknown = {}) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), init)))
  }

  it('stores the account and reports no error', async () => {
    respond({ status: 200 }, { id: 'u1', role: 'SUPER_ADMIN', email: 'a@b.c' })

    const me = await fetchAndStoreUserInfo()

    expect(me.error).toBeUndefined()
    expect(me.user?.role).toBe('SUPER_ADMIN')
    expect(getUserInfo()?.role).toBe('SUPER_ADMIN')
  })

  it('names the status when the server refuses, and stores nothing', async () => {
    respond({ status: 403 })

    const me = await fetchAndStoreUserInfo()

    expect(me.user).toBeNull()
    expect(me.error).toBe('HTTP 403')
    expect(getUserInfo()).toBeNull()
  })

  it('names a network failure rather than passing for an empty account', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))

    const me = await fetchAndStoreUserInfo()

    expect(me.user).toBeNull()
    expect(me.error).toBe('network')
  })

  it('leaves no account behind once the session is dropped', async () => {
    respond({ status: 200 }, { id: 'u1', role: 'CREATOR', email: 'a@b.c' })
    await fetchAndStoreUserInfo()

    clearToken()

    expect(getUserInfo()).toBeNull()
  })
})
