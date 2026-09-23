import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authFor, hasCredential, providerGet } from './credentials'
import { fetchOrgPRs, fetchUserPRs } from './github-api'
import { fetchGroupMRs, fetchUserMRs } from './gitlab-api'
import { useStore, reconcileVault } from '../store'

/*
 * Copy of the backend's proxy allow-list (progressor-backend pm-tracker.service.ts
 * GITHUB_PATHS / GITLAB_PATHS). The paths this app generates must pass it, or the server
 * refuses every sync -- so if either side changes, this test is where the drift shows.
 */
const GITHUB_PATHS = [
  /^\/repos(?:\/[\w.-]+){2}\/pul{2}s(\/\d+)?(\?[^#]*)?$/,
  /^\/(orgs|users)\/[\w.-]+\/repos(\?[^#]*)?$/,
  /^\/search\/issues(\?[^#]*)?$/,
]
const GITLAB_PATHS = [/^\/api\/v4\/(groups|projects|users)\/[\w%.-]+\/merge_requests(\?[^#]*)?$/]

const fetchMock = vi.fn()
const calls = () => fetchMock.mock.calls.map((c) => {
  const [url, init] = c as [string, RequestInit]
  return { url, body: init?.body ? JSON.parse(init.body as string) : undefined, method: init?.method }
})

// Every proxied call answers with an empty page, so the sync code runs its full path.
function proxyReturns(data: unknown, status = 200) {
  fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ status, data }), { status: 200 })))
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  localStorage.setItem('pm_tracker_token', 'session')
})

describe('authFor / hasCredential', () => {
  it('sends a local token while there is one, the connection id once vaulted', () => {
    expect(authFor({ id: 'c1', token: ' tok ' })).toEqual({ token: 'tok' })
    expect(authFor({ id: 'c1', token: '', tokenInVault: true })).toEqual({ connectionId: 'c1' })
  })

  it('counts a vaulted token as a credential', () => {
    expect(hasCredential({ id: 'c1', token: '', tokenInVault: true })).toBe(true)
    expect(hasCredential({ id: 'c1', token: '  ' })).toBe(false)
  })
})

describe('providerGet', () => {
  it("reports the provider's status, not the proxy's", async () => {
    proxyReturns({ message: 'Bad credentials' }, 401)
    const res = await providerGet('github', { connectionId: 'c1' }, '/search/issues?q=x')
    expect(res.ok).toBe(false)
    expect(res.status).toBe(401)
    expect(calls()[0]!.body).toEqual({ path: '/search/issues?q=x', connectionId: 'c1' })
  })
})

describe('generated provider paths pass the backend allow-list', () => {
  it('GitHub org scan and PR lists', async () => {
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      const { path } = JSON.parse(init.body as string) as { path: string }
      const data = path.includes('/repos?') ? [{ full_name: 'acme/web.app' }] : []
      return Promise.resolve(new Response(JSON.stringify({ status: 200, data }), { status: 200 }))
    })
    await fetchOrgPRs('https://github.com/acme', { connectionId: 'gh1' })
    const paths = calls().map((c) => c.body.path as string)
    expect(paths.length).toBeGreaterThan(1)
    for (const p of paths) expect(GITHUB_PATHS.some((re) => re.test(p)), p).toBe(true)
    // Nothing goes to GitHub directly any more.
    expect(calls().every((c) => c.url.includes('/pm-tracker/github'))).toBe(true)
  })

  it('GitHub per-developer search and PR enrichment', async () => {
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      const { path } = JSON.parse(init.body as string) as { path: string }
      const data = path.startsWith('/search/issues')
        ? { items: [{ id: 1, number: 7, title: 'COM-1 fix', html_url: 'https://github.com/acme/web/pull/7', created_at: '2026-09-01', state: 'open', user: { login: 'n' } }] }
        : { body: '', head: { ref: 'feature/COM-1' } }
      return Promise.resolve(new Response(JSON.stringify({ status: 200, data }), { status: 200 }))
    })
    await fetchUserPRs('narek.c', { connectionId: 'gh1' }, 'acme')
    for (const { body } of calls()) expect(GITHUB_PATHS.some((re) => re.test(body.path)), body.path).toBe(true)
  })

  it('GitLab group, subgroup and user MR lists', async () => {
    proxyReturns([])
    await fetchGroupMRs({ id: 'gl1', name: 'x', enabled: true, token: '', tokenInVault: true, groupPath: 'acme/sub-team', syncInterval: 0 })
    await fetchUserMRs(['narek.c'], { connectionId: 'gl1' })
    const paths = calls().map((c) => c.body.path as string)
    expect(paths.length).toBeGreaterThan(1)
    for (const p of paths) expect(GITLAB_PATHS.some((re) => re.test(p)), p).toBe(true)
  })
})

describe('moveTokensToVault', () => {
  const jira = (patch = {}) => ({ id: 'j1', name: 'J', enabled: true, baseUrl: 'https://x.atlassian.net', email: 'a@b.c', token: 'secret-1', projectKeys: [], syncInterval: 5, projectId: 'p1', ...patch })

  beforeEach(() => {
    useStore.setState({ jiraConnections: [jira()], githubConnections: [], gitlabConnections: [] })
  })

  function vault(available: boolean, putStatus = 204) {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('/pm-tracker/credentials') && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify({ available, items: [] }), { status: 200 }))
      }
      return Promise.resolve(new Response(null, { status: putStatus }))
    })
  }

  it('uploads the token, then clears it locally and marks it vaulted', async () => {
    vault(true)
    expect(await useStore.getState().moveTokensToVault()).toBe(1)
    const put = calls().find((c) => c.method === 'PUT')!
    expect(put.url).toContain('/pm-tracker/credentials/j1')
    expect(put.body).toEqual({ provider: 'jira', secret: 'secret-1' })
    expect(useStore.getState().jiraConnections[0]).toMatchObject({ token: '', tokenInVault: true })
  })

  it('changes nothing when the vault is not configured', async () => {
    vault(false)
    expect(await useStore.getState().moveTokensToVault()).toBe(0)
    expect(useStore.getState().jiraConnections[0]!.token).toBe('secret-1')
    expect(calls().some((c) => c.method === 'PUT')).toBe(false)
  })

  it('keeps the token when the upload fails', async () => {
    vault(true, 503)
    await useStore.getState().moveTokensToVault()
    expect(useStore.getState().jiraConnections[0]).toMatchObject({ token: 'secret-1' })
    expect(useStore.getState().jiraConnections[0]!.tokenInVault).toBeUndefined()
  })

  it('keeps a token that was edited while the upload was in flight', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (!init?.method) return Promise.resolve(new Response(JSON.stringify({ available: true, items: [] }), { status: 200 }))
      useStore.setState({ jiraConnections: [jira({ token: 'typed-meanwhile' })] })
      return Promise.resolve(new Response(null, { status: 204 }))
    })
    await useStore.getState().moveTokensToVault()
    expect(useStore.getState().jiraConnections[0]!.token).toBe('typed-meanwhile')
  })
})

describe('reconcileVault', () => {
  it("deletes a removed connection's vaulted token", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ available: false, items: [] }), { status: 200 }))
    reconcileVault(
      [{ id: 'keep', token: '', tokenInVault: true }, { id: 'gone', token: '', tokenInVault: true }],
      [{ id: 'keep', token: '', tokenInVault: true }],
    )
    await new Promise((r) => setTimeout(r, 0))
    const deletes = calls().filter((c) => c.method === 'DELETE').map((c) => c.url)
    expect(deletes).toHaveLength(1)
    expect(deletes[0]).toContain('/pm-tracker/credentials/gone')
  })
})
