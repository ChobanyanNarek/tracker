export interface GitHubPR {
  id: number
  number: number
  title: string
  body: string | null
  html_url: string
  created_at: string
  state: 'open' | 'closed'
  user: { login: string }
  pull_request?: { merged_at: string | null; head?: { ref: string } }
}

function keysFromText(text: string, projectKeys: string[]): string[] {
  const found = new Set<string>()
  const configured = projectKeys.map((k) => k.trim()).filter(Boolean)
  if (configured.length) {
    const esc = configured.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    for (const m of text.matchAll(new RegExp(`(?:${esc.join('|')})-\\d+`, 'ig'))) found.add(m[0].toUpperCase())
  }
  for (const m of text.matchAll(/[A-Z][A-Z0-9]+-\d+/g)) found.add(m[0])
  return [...found]
}

export function extractJiraKeys(pr: GitHubPR, projectKeys: string[] = []): string[] {
  const texts = [pr.title, pr.body ?? '', pr.pull_request?.head?.ref ?? '']
  const combined = texts.join(' ')
  return keysFromText(combined, projectKeys)
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
    console.info(`[GitHub sync] query: ${url}`)
    const res = await fetch(url, { headers })
    if (!res.ok) {
      if (res.status === 422) continue
      const text = await res.text().catch(() => '')
      throw new Error(`GitHub ${res.status}: ${text.slice(0, 200) || res.statusText}`)
    }
    const data = (await res.json()) as { items: GitHubPR[] }
    console.info(`[GitHub sync] query returned ${data.items.length} items`)
    for (const item of data.items) byId.set(item.id, item)
  }

  const all = [...byId.values()]
  console.info(`[GitHub sync] fetched ${all.length} PRs for ${username}`)
  return all
}
