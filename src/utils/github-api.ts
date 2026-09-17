import { keysFromText } from './format'

export interface GitHubPR {
  id: number
  number: number
  title: string
  body?: string | null
  html_url: string
  created_at: string
  updated_at?: string
  state: 'open' | 'closed'
  draft?: boolean
  user: { login: string }
  pull_request?: { merged_at: string | null }
  // head ref (branch name) — populated when fetching full PR details
  head?: { ref: string }
  merged_at?: string | null
  closed_at?: string | null
}

export function extractJiraKeys(pr: GitHubPR, projectKeys: string[] = []): string[] {
  // Only use title and branch name — body is unreliable on stacked/merged PRs
  // (it contains commit messages from base branches, producing false key matches)
  const texts = [pr.title, pr.head?.ref ?? ''].filter(Boolean).join(' ')
  return keysFromText(texts, projectKeys)
}

// ── Request plumbing ───────────────────────────────────────────
// GitHub sync used to hang forever: no fetch had a timeout, org discovery walked every
// repo serially, and the Search API (30 req/min) was hit in parallel for every developer
// identity, so GitHub answered with secondary rate limits that nothing handled.

export const GITHUB_SYNC_BUDGET_MS = 90_000

const REQUEST_TIMEOUT_MS = 20_000
const MAX_CONCURRENCY = 5
const MAX_REPOS = 60

export class GithubBudget {
  private readonly deadline = Date.now() + GITHUB_SYNC_BUDGET_MS
  expired(): boolean { return Date.now() > this.deadline }
  remaining(): number { return Math.max(0, this.deadline - Date.now()) }
}

// A fetch that always settles: it aborts on timeout, and retries once when GitHub answers
// with a rate limit that tells us how long to wait.
async function ghFetch(url: string, headers: HeadersInit, budget?: GithubBudget): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController()
    const cap = budget ? Math.min(REQUEST_TIMEOUT_MS, budget.remaining()) : REQUEST_TIMEOUT_MS
    if (cap <= 0) throw new Error('GitHub sync timed out — try again, or narrow the org/repo')
    const timer = setTimeout(() => controller.abort(), cap)
    let res: Response
    try {
      res = await fetch(url, { headers, signal: controller.signal })
    } catch (err) {
      clearTimeout(timer)
      if ((err as Error).name === 'AbortError') {
        throw new Error('GitHub request timed out after 20s — GitHub may be slow or the token may be throttled')
      }
      throw err
    }
    clearTimeout(timer)

    const rateLimited = res.status === 403 || res.status === 429
    const remaining = res.headers.get('x-ratelimit-remaining')
    if (rateLimited && remaining === '0' && attempt === 0) {
      const retryAfter = Number(res.headers.get('retry-after') ?? 0)
      const reset = Number(res.headers.get('x-ratelimit-reset') ?? 0)
      const waitMs = retryAfter > 0
        ? retryAfter * 1000
        : reset > 0 ? Math.max(0, reset * 1000 - Date.now()) : 2000
      // Only wait it out if that fits the budget; otherwise surface it as an error.
      if (waitMs <= 15_000 && (!budget || waitMs < budget.remaining())) {
        console.warn(`[GitHub sync] rate limited, waiting ${Math.round(waitMs / 1000)}s`)
        await new Promise((r) => setTimeout(r, waitMs))
        continue
      }
      throw new Error('GitHub rate limit reached — wait a minute and sync again')
    }
    return res
  }
  throw new Error('GitHub rate limit reached — wait a minute and sync again')
}

// Run tasks with bounded concurrency so one sync can't open hundreds of sockets at once.
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++
      try {
        results[i] = { status: 'fulfilled', value: await fn(items[i]) }
      } catch (reason) {
        results[i] = { status: 'rejected', reason }
      }
    }
  })
  await Promise.all(workers)
  return results
}

async function enrichPRs(prs: GitHubPR[], headers: HeadersInit, budget: GithubBudget): Promise<GitHubPR[]> {
  const toEnrich = prs.slice(0, 100)
  const enriched = await mapLimit(toEnrich, MAX_CONCURRENCY, async (pr) => {
    if (budget.expired()) return pr
    const match = pr.html_url.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/)
    if (!match) return pr
    const [, repoPath, num] = match
    const r = await ghFetch(`https://api.github.com/repos/${repoPath}/pulls/${num}`, headers, budget)
    if (!r.ok) return pr
    const detail = await r.json() as { body?: string | null; head?: { ref: string }; merged_at?: string | null }
    return { ...pr, body: detail.body ?? pr.body, head: detail.head, merged_at: detail.merged_at }
  })
  return [...enriched.map((r, i) => r.status === 'fulfilled' ? r.value : toEnrich[i]), ...prs.slice(100)]
}

// Normalize a GitHub URL or path into { owner, repo? }
// Accepts: https://github.com/myorg, https://github.com/myorg/myrepo, myorg, myorg/myrepo
export function normalizeGithubPath(raw: string): { owner: string; repo?: string } {
  const s = raw.replace(/^https?:\/\/github\.com\//i, '').replace(/\/$/, '').trim()
  const parts = s.split('/')
  return parts.length >= 2 ? { owner: parts[0], repo: parts.slice(0, 2).join('/') } : { owner: s }
}

// Fetch ALL PRs from all repos in a GitHub org/user, or a single repo (mirrors GitLab fetchGroupMRs)
export async function fetchOrgPRs(orgOrUser: string, token: string, budget: GithubBudget = new GithubBudget()): Promise<GitHubPR[]> {
  if (!orgOrUser.trim()) throw new Error('GitHub path is empty — paste a GitHub org or repo URL (e.g. https://github.com/mycompany)')
  if (!token.trim()) throw new Error('Personal Access Token is empty')

  const { owner, repo: singleRepo } = normalizeGithubPath(orgOrUser)

  const headers: HeadersInit = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }

  // If a specific repo was given, use it directly; otherwise discover all repos in the org/user
  const repos: string[] = []
  if (singleRepo) {
    repos.push(singleRepo)
  } else {
    let lastStatus = 0
    for (const scope of ['orgs', 'users'] as const) {
      let page = 1
      // Sorted by recent activity and capped: a huge org otherwise means hundreds of
      // sequential page fetches before a single PR is read.
      while (page <= 3 && repos.length < MAX_REPOS && !budget.expired()) {
        const res = await ghFetch(`https://api.github.com/${scope}/${encodeURIComponent(owner)}/repos?type=all&sort=pushed&per_page=100&page=${page}`, headers, budget)
        lastStatus = res.status
        if (!res.ok) {
          break
        }
        const batch = await res.json() as { full_name: string }[]
        for (const r of batch) repos.push(r.full_name)
        if (batch.length < 100) break
        page++
      }
      if (repos.length) break
    }
    if (!repos.length) {
      if (lastStatus === 401) throw new Error('GitHub 401: token invalid or expired — create a new PAT with repo scope')
      if (lastStatus === 403) throw new Error('GitHub 403: token does not have access to this org — check repo scope')
      // 200 + empty = org exists but token can only see 0 repos (private org, needs full `repo` scope)
      // Fall through with empty repos — per-developer username fallback will still run
      console.warn(`[GitHub sync] org "${owner}" returned 0 repos — token may need full "repo" scope for private repos`)
    }
  }
  if (repos.length > MAX_REPOS) {
    console.warn(`[GitHub sync] ${repos.length} repos in ${owner} — scanning the ${MAX_REPOS} most recently pushed`)
    repos.length = MAX_REPOS
  }
  console.info(`[GitHub sync] found ${repos.length} repos in ${owner}`)

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const byId = new Map<number, GitHubPR>()

  // Use REST PRs API directly (more reliable + better rate limits than Search API).
  // Repos are walked a few at a time instead of strictly one after another: the old serial
  // loop was up to repos x 2 states x 5 pages round trips before the sync could finish.
  await mapLimit(repos, MAX_CONCURRENCY, async (repoSlug) => {
    for (const state of ['open', 'closed'] as const) {
      let page = 1
      while (page <= 5 && !budget.expired()) {
        const res = await ghFetch(`https://api.github.com/repos/${repoSlug}/pulls?state=${state}&per_page=100&page=${page}&sort=updated&direction=desc`, headers, budget)
        if (!res.ok) break
        const batch = await res.json() as (GitHubPR & { merged_at?: string | null })[]
        let done = false
        for (const pr of batch) {
          // For closed PRs, skip unmerged and those older than 30 days
          if (state === 'closed') {
            if (!pr.merged_at) continue
            if (new Date(pr.merged_at) < thirtyDaysAgo) { done = true; break }
          }
          byId.set(pr.id, pr)
        }
        if (batch.length < 100 || done) break
        page++
      }
    }
  })
  if (budget.expired()) console.warn('[GitHub sync] time budget reached during org scan — results may be partial')

  const all = [...byId.values()]
  console.info(`[GitHub sync] fetched ${all.length} PRs from ${singleRepo ?? owner}`)
  return all
}

export async function fetchUserPRs(username: string, token: string, orgOrUser?: string, budget: GithubBudget = new GithubBudget()): Promise<GitHubPR[]> {
  const headers: HeadersInit = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const scope = orgOrUser?.trim() ? `+org:${orgOrUser.trim()}` : ''

  const queries = [
    `is:pr+author:${encodeURIComponent(username)}+state:open${scope}`,
    `is:pr+author:${encodeURIComponent(username)}+is:merged+merged:>${thirtyDaysAgo}${scope}`,
  ]

  const byId = new Map<number, GitHubPR>()

  for (const q of queries) {
    if (budget.expired()) break
    const url = `https://api.github.com/search/issues?q=${q}&per_page=100`
    const res = await ghFetch(url, headers, budget)
    if (!res.ok) {
      if (res.status === 422) continue
      const text = await res.text().catch(() => '')
      throw new Error(`GitHub ${res.status}: ${text.slice(0, 200) || res.statusText}`)
    }
    const data = (await res.json()) as { items: GitHubPR[] }
    for (const item of data.items) byId.set(item.id, item)
  }

  const all = [...byId.values()]
  console.info(`[GitHub sync] fetched ${all.length} PRs for ${username}, enriching details…`)
  return enrichPRs(all, headers, budget)
}
