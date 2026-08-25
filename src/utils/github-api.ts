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

async function enrichPRs(prs: GitHubPR[], headers: HeadersInit): Promise<GitHubPR[]> {
  const toEnrich = prs.slice(0, 100)
  const enriched = await Promise.allSettled(
    toEnrich.map(async (pr) => {
      const match = pr.html_url.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/)
      if (!match) return pr
      const [, repoPath, num] = match
      const r = await fetch(`https://api.github.com/repos/${repoPath}/pulls/${num}`, { headers })
      if (!r.ok) return pr
      const detail = await r.json() as { body?: string | null; head?: { ref: string }; merged_at?: string | null }
      return { ...pr, body: detail.body ?? pr.body, head: detail.head, merged_at: detail.merged_at }
    })
  )
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
export async function fetchOrgPRs(orgOrUser: string, token: string): Promise<GitHubPR[]> {
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
      while (true) {
        const res = await fetch(`https://api.github.com/${scope}/${encodeURIComponent(owner)}/repos?type=all&per_page=100&page=${page}`, { headers })
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
  console.info(`[GitHub sync] found ${repos.length} repos in ${owner}`)

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const byId = new Map<number, GitHubPR>()

  // Use REST PRs API directly (more reliable + better rate limits than Search API)
  for (const repoSlug of repos) {
    for (const state of ['open', 'closed'] as const) {
      let page = 1
      while (page <= 5) {
        const res = await fetch(`https://api.github.com/repos/${repoSlug}/pulls?state=${state}&per_page=100&page=${page}&sort=updated&direction=desc`, { headers })
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
  }

  const all = [...byId.values()]
  console.info(`[GitHub sync] fetched ${all.length} PRs from ${singleRepo ?? owner}`)
  return all
}

export async function fetchUserPRs(username: string, token: string, orgOrUser?: string): Promise<GitHubPR[]> {
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
    const url = `https://api.github.com/search/issues?q=${q}&per_page=100`
    const res = await fetch(url, { headers })
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
  return enrichPRs(all, headers)
}
