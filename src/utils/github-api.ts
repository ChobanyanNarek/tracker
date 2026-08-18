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

// Fetch all open + recently merged PRs from a specific repo slug (e.g. "owner/repo")
export async function fetchRepoPRs(repoSlug: string, token: string): Promise<GitHubPR[]> {
  const headers: HeadersInit = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const queries = [
    `is:pr+repo:${encodeURIComponent(repoSlug)}+state:open`,
    `is:pr+repo:${encodeURIComponent(repoSlug)}+is:merged+merged:>${thirtyDaysAgo}`,
  ]
  const byId = new Map<number, GitHubPR>()
  for (const q of queries) {
    const res = await fetch(`https://api.github.com/search/issues?q=${q}&per_page=100`, { headers })
    if (!res.ok) { if (res.status === 422) continue; continue }
    const data = await res.json() as { items: GitHubPR[] }
    for (const item of data.items) byId.set(item.id, item)
  }
  const all = [...byId.values()]
  console.info(`[GitHub sync] fetched ${all.length} PRs from repo ${repoSlug}, enriching details…`)
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
