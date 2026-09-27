import { keysFromText } from './keys'
import type { ProviderAuth } from './credentials'
import { providerGet } from './providers'
import type { Transport } from './transport'

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

/*
 * Only the fields the sync reads. A GitHub pull request arrives with both repositories'
 * full details and dozens of links (~25 KB); keeping all of that for hundreds of PRs is
 * what made a sync's memory balloon.
 */
function slimPR(pr: GitHubPR): GitHubPR {
  return {
    id: pr.id,
    number: pr.number,
    title: pr.title,
    body: pr.body,
    html_url: pr.html_url,
    created_at: pr.created_at,
    updated_at: pr.updated_at,
    state: pr.state,
    draft: pr.draft,
    user: { login: pr.user?.login },
    pull_request: pr.pull_request ? { merged_at: pr.pull_request.merged_at } : undefined,
    head: pr.head ? { ref: pr.head.ref } : undefined,
    merged_at: pr.merged_at,
    closed_at: pr.closed_at,
  }
}

export function extractJiraKeys(pr: GitHubPR, projectKeys: string[] = []): string[] {
  // Only use title and branch name — body is unreliable on stacked/merged PRs
  // (it contains commit messages from base branches, producing false key matches)
  const texts = [pr.title, pr.head?.ref ?? ''].filter(Boolean).join(' ')
  return keysFromText(texts, projectKeys)
}

async function enrichPRs(t: Transport, prs: GitHubPR[], auth: ProviderAuth): Promise<GitHubPR[]> {
  const toEnrich = prs.slice(0, 100)
  const enriched = await Promise.allSettled(
    toEnrich.map(async (pr) => {
      const match = pr.html_url.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/)
      if (!match) return pr
      const [, repoPath, num] = match
      const r = await providerGet(t, 'github', auth, `/repos/${repoPath}/pulls/${num}`)
      if (!r.ok) return pr
      const detail = await r.json() as { body?: string | null; head?: { ref: string }; merged_at?: string | null }
      return { ...pr, body: detail.body ?? pr.body, head: detail.head ? { ref: detail.head.ref } : undefined, merged_at: detail.merged_at }
    })
  )
  return [...enriched.map((r, i) => r.status === 'fulfilled' ? r.value : toEnrich[i]!), ...prs.slice(100)]
}

// Normalize a GitHub URL or path into { owner, repo? }
// Accepts: https://github.com/myorg, https://github.com/myorg/myrepo, myorg, myorg/myrepo
export function normalizeGithubPath(raw: string): { owner: string; repo?: string } {
  const s = raw.replace(/^https?:\/\/github\.com\//i, '').replace(/\/$/, '').trim()
  const parts = s.split('/')
  return parts.length >= 2 ? { owner: parts[0]!, repo: parts.slice(0, 2).join('/') } : { owner: s }
}

// Fetch ALL PRs from all repos in a GitHub org/user, or a single repo (mirrors GitLab fetchGroupMRs)
export async function fetchOrgPRs(t: Transport, orgOrUser: string, auth: ProviderAuth): Promise<GitHubPR[]> {
  if (!orgOrUser.trim()) throw new Error('GitHub path is empty — paste a GitHub org or repo URL (e.g. https://github.com/mycompany)')
  if ('token' in auth && !auth.token.trim()) throw new Error('Personal Access Token is empty')

  const { owner, repo: singleRepo } = normalizeGithubPath(orgOrUser)
  const dormantBefore = Date.now() - 90 * 24 * 60 * 60 * 1000

  // If a specific repo was given, use it directly; otherwise discover all repos in the org/user
  const repos: string[] = []
  if (singleRepo) {
    repos.push(singleRepo)
  } else {
    let lastStatus = 0
    let lastRateLimited = false
    for (const scope of ['orgs', 'users'] as const) {
      let page = 1
      while (true) {
        // Newest activity first, so the dormant ones fall at the end and the loop can stop.
        const res = await providerGet(t, 'github', auth, `/${scope}/${encodeURIComponent(owner)}/repos?type=all&sort=pushed&direction=desc&per_page=100&page=${page}`)
        lastStatus = res.status
        if (!res.ok) {
          // GitHub says which kind of 403 this is in the body.
          const body = (await res.json().catch(() => null)) as { message?: string } | null
          if (/rate limit|abuse|secondary/i.test(body?.message ?? '')) lastRateLimited = true
          break
        }
        const batch = await res.json() as { full_name: string; pushed_at?: string | null; archived?: boolean }[]
        for (const r of batch) {
          /*
           * Every repo costs up to ten requests a sync (two PR states, five pages each),
           * so an org full of dormant repos burns the token's hourly budget on repos that
           * cannot have anything new. A repo nobody has pushed to in three months has no
           * PR this sync needs — the closed ones are already discarded after thirty days —
           * and an archived one never will again.
           */
          if (r.archived) continue
          if (r.pushed_at && new Date(r.pushed_at).getTime() < dormantBefore) continue
          repos.push(r.full_name)
        }
        if (batch.length < 100) break
        // Sorted by activity: once a whole page is dormant, so is everything after it.
        if (batch.every((r) => r.pushed_at && new Date(r.pushed_at).getTime() < dormantBefore)) break
        page++
      }
      if (repos.length) break
    }
    if (!repos.length) {
      // Not "create a new one": regenerating revokes whatever is still in the app and can
      // turn a recoverable problem into a broken integration. Say what GitHub said.
      if (lastStatus === 401) throw new Error('GitHub 401: this token is rejected — it was revoked, expired, or replaced. Paste the current token in GitHub settings.')
      /*
       * 403 is both "no access" and "you have asked too often". They need different
       * answers: one is a token to fix, the other is a wait. Blaming the scope for a rate
       * limit sent people to regenerate a token that was working perfectly well.
       */
      if (lastStatus === 429 || (lastStatus === 403 && lastRateLimited)) {
        throw new Error('GitHub is rate-limiting this token — nothing is wrong with it. Syncs resume once the hourly budget refills; lengthen the auto-sync interval if it keeps happening.')
      }
      if (lastStatus === 403) throw new Error('GitHub 403: token does not have access to this org — check repo scope')
      // 200 + empty = org exists but token can only see 0 repos (private org, needs full `repo` scope)
      // Fall through with empty repos — per-developer username fallback will still run
      console.warn(`[GitHub sync] org "${owner}" returned 0 repos — token may need full "repo" scope for private repos`)
    }
  }
  console.info(`[GitHub sync] ${repos.length} active repos in ${owner} (dormant and archived ones skipped)`)

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const byId = new Map<number, GitHubPR>()

  // Use REST PRs API directly (more reliable + better rate limits than Search API)
  for (const repoSlug of repos) {
    for (const state of ['open', 'closed'] as const) {
      let page = 1
      while (page <= 5) {
        const res = await providerGet(t, 'github', auth, `/repos/${repoSlug}/pulls?state=${state}&per_page=100&page=${page}&sort=updated&direction=desc`)
        if (!res.ok) break
        const batch = await res.json() as (GitHubPR & { merged_at?: string | null })[]
        let done = false
        for (const pr of batch) {
          // For closed PRs, skip unmerged and those older than 30 days
          if (state === 'closed') {
            if (!pr.merged_at) continue
            if (new Date(pr.merged_at) < thirtyDaysAgo) { done = true; break }
          }
          byId.set(pr.id, slimPR(pr))
        }
        if (batch.length < 100 || done) break
        page++
      }
    }
  }

  const all = [...byId.values()]
  console.info(`[GitHub sync] fetched ${all.length} PRs from ${singleRepo ?? owner}`)
  return all
}

export async function fetchUserPRs(t: Transport, username: string, auth: ProviderAuth, orgOrUser?: string): Promise<GitHubPR[]> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const scope = orgOrUser?.trim() ? `+org:${orgOrUser.trim()}` : ''

  const queries = [
    `is:pr+author:${encodeURIComponent(username)}+state:open${scope}`,
    `is:pr+author:${encodeURIComponent(username)}+is:merged+merged:>${thirtyDaysAgo}${scope}`,
  ]

  const byId = new Map<number, GitHubPR>()

  for (const q of queries) {
    const res = await providerGet(t, 'github', auth, `/search/issues?q=${q}&per_page=100`)
    if (!res.ok) {
      if (res.status === 422) continue
      const body = (await res.json().catch(() => null)) as { message?: string } | null
      throw new Error(`GitHub ${res.status}: ${body?.message ?? 'request failed'}`)
    }
    const data = (await res.json()) as { items: GitHubPR[] }
    for (const item of data.items) byId.set(item.id, slimPR(item))
  }

  const all = [...byId.values()]
  console.info(`[GitHub sync] fetched ${all.length} PRs for ${username}, enriching details…`)
  return enrichPRs(t, all, auth)
}
