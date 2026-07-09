import { fetchViaBridge } from './bridge'
import type { GitLabConfig } from '../types'

export interface GitLabMR {
  id: number
  iid: number
  title: string
  source_branch: string
  web_url: string
  created_at: string
  state: 'opened' | 'merged' | 'closed'
  author: { id: number; username: string; name: string }
  assignees: { id: number; username: string }[]
}

// Extract a Jira issue key (e.g. MONE-123) from the MR title or branch.
//
// The title is checked first because it usually carries the canonical key, and
// matching is anchored to the configured Jira project keys when available — this
// avoids false positives like a branch "feature/add-login-2" being read as the
// key "LOGIN-2". With no configured keys we fall back to a generic *uppercase*
// pattern (lowercase branch words must not be mistaken for a key).
// All Jira keys referenced anywhere in the MR title or branch, title first.
// Branches are often named after a *different* issue than the title (stacked
// branches), so we return every candidate and let the caller link to whichever
// issues are actually tracked — a superset that can't miss a real reference.
function keysFromText(text: string, projectKeys: string[]): string[] {
  const found = new Set<string>()
  const configured = projectKeys.map((k) => k.trim()).filter(Boolean)
  if (configured.length) {
    const esc = configured.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    for (const m of text.matchAll(new RegExp(`(?:${esc.join('|')})-\\d+`, 'ig'))) found.add(m[0].toUpperCase())
  }
  // Generic uppercase-only pattern as fallback.
  for (const m of text.matchAll(/[A-Z][A-Z0-9]+-\d+/g)) found.add(m[0])
  return [...found]
}

// Keys from the MR title only.
export function extractTitleJiraKeys(mr: GitLabMR, projectKeys: string[] = []): string[] {
  return keysFromText(mr.title, projectKeys)
}

// Branch-first key extraction: the source branch is the primary signal because
// developers reliably name branches after the ticket (e.g. feature/MONE-123-login).
// MR titles are checked as a fallback for repos that embed keys there instead.
export function extractJiraKeys(mr: GitLabMR, projectKeys: string[] = []): string[] {
  const branchKeys = keysFromText(mr.source_branch, projectKeys)
  if (branchKeys.length) return branchKeys
  return keysFromText(mr.title, projectKeys)
}

export function extractJiraKey(mr: GitLabMR, projectKeys: string[] = []): string | null {
  return extractJiraKeys(mr, projectKeys)[0] ?? null
}

export function normalizeGroupPath(raw: string): string {
  return raw.replace(/^https?:\/\/gitlab\.com\//i, '').replace(/\/$/, '').trim()
}

const MAX_PAGES = 15 // 15 × 100 per state = up to 1500 MRs per state

export async function fetchGroupMRs(config: GitLabConfig): Promise<GitLabMR[]> {
  const path = normalizeGroupPath(config.groupPath)
  if (!path) throw new Error('Path is empty — enter a group (e.g. mycompany) or a project (e.g. mycompany/sub/repo)')
  const token = config.token.trim()
  if (!token) throw new Error('Personal Access Token is empty — paste your token in GitLab settings')
  // GitLab requires the full path to be percent-encoded (slashes become %2F)
  const encoded = encodeURIComponent(path)
  const headers = { 'PRIVATE-TOKEN': token, Accept: 'application/json' }

  const byId = new Map<number, GitLabMR>()
  let anyOk = false
  let lastErr: Error | null = null

  // Harvest from one scope. 'groups' recurses into subgroups; 'projects' targets
  // a single project. We try BOTH so it works whether the configured path is a
  // group OR a project (and a 404 just means "wrong scope for this path").
  const harvest = async (scope: 'groups' | 'projects'): Promise<void> => {
    for (const state of ['opened', 'merged'] as const) {
      for (let page = 1; page <= MAX_PAGES; page++) {
        const url = `https://gitlab.com/api/v4/${scope}/${encoded}/merge_requests?state=${state}&per_page=100&page=${page}&order_by=updated_at&sort=desc`
        let res = await fetchViaBridge(url, headers)
        if (!res) res = await fetch(url, { headers })
        if (!res.ok) {
          if (res.status !== 404) {
            const text = await res.text().catch(() => '')
            lastErr = new Error(`GitLab ${res.status}: ${text.slice(0, 200) || res.statusText}`)
          }
          return // 404 = path isn't this scope; other error recorded in lastErr
        }
        anyOk = true
        const batch = (await res.json()) as GitLabMR[]
        for (const m of batch) byId.set(m.id, m)
        if (batch.length < 100) break
        if (page === MAX_PAGES) console.warn(`[GitLab sync] hit ${MAX_PAGES}-page cap for ${scope} state=${state}; older MRs may be skipped`)
      }
    }
  }

  await harvest('groups')
  await harvest('projects')

  if (!anyOk) {
    throw lastErr ?? new Error(`GitLab: "${path}" is neither a readable group nor project — check the path and token`)
  }

  const all = [...byId.values()]
  console.info(`[GitLab sync] fetched ${all.length} merge requests (opened + merged) from ${path}`)
  return all
}

// Fallback for Planner/Guest roles that cannot list group MRs.
// Uses GET /users/:username/merge_requests which is accessible at any membership level.
export async function fetchUserMRs(usernames: string[], token: string): Promise<GitLabMR[]> {
  const headers = { 'PRIVATE-TOKEN': token.trim(), Accept: 'application/json' }
  const byId = new Map<number, GitLabMR>()
  let okCount = 0

  for (const raw of usernames) {
    const username = raw.trim()
    if (!username) continue
    const encoded = encodeURIComponent(username)
    for (const state of ['opened', 'merged'] as const) {
      for (let page = 1; page <= MAX_PAGES; page++) {
        const url = `https://gitlab.com/api/v4/users/${encoded}/merge_requests?state=${state}&per_page=100&page=${page}&order_by=updated_at&sort=desc`
        let res = await fetchViaBridge(url, headers)
        if (!res) res = await fetch(url, { headers })
        if (!res.ok) break // 404 = username wrong; 403 = skip; move to next
        okCount++
        const batch = (await res.json()) as GitLabMR[]
        for (const m of batch) byId.set(m.id, m)
        if (batch.length < 100) break
        if (page === MAX_PAGES) console.warn(`[GitLab sync] hit page cap for user ${username} state=${state}`)
      }
    }
  }

  const all = [...byId.values()]
  const validUsernames = usernames.filter((u) => u.trim())
  console.info(
    `[GitLab sync] per-developer fallback: ${all.length} MRs from ${validUsernames.length} configured developer(s)` +
    (okCount === 0 ? ' — WARNING: no successful responses, check GitLab usernames' : ''),
  )
  return all
}
