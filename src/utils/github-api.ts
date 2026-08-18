export interface GitHubPR {
  id: number
  number: number
  title: string
  body?: string | null
  html_url: string
  created_at: string
  updated_at?: string
  state: 'open' | 'closed'
  user: { login: string }
  pull_request?: { merged_at: string | null }
  // head ref (branch name) — populated when fetching full PR details
  head?: { ref: string }
  merged_at?: string | null
}

function keysFromText(text: string, projectKeys: string[]): string[] {
  const found = new Set<string>()
  const configured = projectKeys.map((k) => k.trim()).filter(Boolean)
  if (configured.length) {
    const esc = configured.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    // match both PROJ-123 style and proj-123 (branch-name) style
    for (const m of text.matchAll(new RegExp(`(?:${esc.join('|')})-\\d+`, 'ig'))) found.add(m[0].toUpperCase())
  }
  // also match bare uppercase Jira keys in title/body
  for (const m of text.matchAll(/[A-Z][A-Z0-9]+-\d+/g)) found.add(m[0])
  return [...found]
}

export function extractJiraKeys(pr: GitHubPR, projectKeys: string[] = []): string[] {
  // search title, body, and branch name (head ref) for Jira keys
  const texts = [pr.title, pr.body ?? '', pr.head?.ref ?? ''].filter(Boolean).join(' ')
  return keysFromText(texts, projectKeys)
}

async function enrichPRs(prs: GitHubPR[], headers: HeadersInit): Promise<GitHubPR[]> {
  const toEnrich = prs.slice(0, 20)
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
  return [...enriched.map((r, i) => r.status === 'fulfilled' ? r.value : toEnrich[i]), ...prs.slice(20)]
}

// Fetch ALL PRs from all repos in a GitHub org or user account (mirrors GitLab fetchGroupMRs)
export async function fetchOrgPRs(orgOrUser: string, token: string): Promise<GitHubPR[]> {
  const org = orgOrUser.trim()
  if (!org) throw new Error('Org / User path is empty — enter an org or user name (e.g. mycompany)')
  if (!token.trim()) throw new Error('Personal Access Token is empty')

  const headers: HeadersInit = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }

  // Discover all repos in the org (try org first, then user)
  const repos: string[] = []
  for (const scope of ['orgs', 'users'] as const) {
    let page = 1
    while (true) {
      const res = await fetch(`https://api.github.com/${scope}/${encodeURIComponent(org)}/repos?per_page=100&page=${page}`, { headers })
      if (!res.ok) break
      const batch = await res.json() as { full_name: string }[]
      for (const r of batch) repos.push(r.full_name)
      if (batch.length < 100) break
      page++
    }
    if (repos.length) break
  }

  if (!repos.length) throw new Error(`GitHub: "${org}" is neither a readable org nor user — check the name and token`)
  console.info(`[GitHub sync] found ${repos.length} repos in ${org}`)

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const byId = new Map<number, GitHubPR>()

  for (const repoSlug of repos) {
    const queries = [
      `is:pr+repo:${repoSlug}+state:open`,
      `is:pr+repo:${repoSlug}+is:merged+merged:>${thirtyDaysAgo}`,
    ]
    for (const q of queries) {
      const res = await fetch(`https://api.github.com/search/issues?q=${q}&per_page=100`, { headers })
      if (!res.ok) continue
      const data = await res.json() as { items: GitHubPR[] }
      for (const item of data.items) byId.set(item.id, item)
    }
  }

  const all = [...byId.values()]
  console.info(`[GitHub sync] fetched ${all.length} PRs from org ${org}, enriching details…`)
  return enrichPRs(all, headers)
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
