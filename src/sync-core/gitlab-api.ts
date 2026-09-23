import { authFor, hasCredential, type ProviderAuth } from './credentials'
import { providerGet } from './providers'
import type { Transport } from './transport'
import type { GitLabConfig } from '../types'
import { keysFromText } from './keys'

export interface GitLabMR {
  id: number
  iid: number
  title: string
  source_branch: string
  web_url: string
  created_at: string
  merged_at?: string | null
  closed_at?: string | null
  state: 'opened' | 'merged' | 'closed'
  draft?: boolean
  work_in_progress?: boolean
  author: { id: number; username: string; name: string }
  assignees: { id: number; username: string }[]
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

export async function fetchGroupMRs(t: Transport, config: GitLabConfig): Promise<GitLabMR[]> {
  const path = normalizeGroupPath(config.groupPath)
  if (!path) throw new Error('Path is empty — enter a group (e.g. mycompany) or a project (e.g. mycompany/sub/repo)')
  if (!hasCredential(config)) throw new Error('Personal Access Token is empty — paste your token in GitLab settings')
  const auth = authFor(config)
  // GitLab requires the full path to be percent-encoded (slashes become %2F)
  const encoded = encodeURIComponent(path)

  const byId = new Map<number, GitLabMR>()
  let anyOk = false
  let lastErr: Error | null = null

  // Harvest from one scope. 'groups' recurses into subgroups; 'projects' targets
  // a single project. We try BOTH so it works whether the configured path is a
  // group OR a project (and a 404 just means "wrong scope for this path").
  const harvest = async (scope: 'groups' | 'projects'): Promise<void> => {
    for (const state of ['opened', 'merged'] as const) {
      for (let page = 1; page <= MAX_PAGES; page++) {
        const res = await providerGet(t, 'gitlab', auth, `/api/v4/${scope}/${encoded}/merge_requests?state=${state}&per_page=100&page=${page}&order_by=updated_at&sort=desc`)
        if (!res.ok) {
          if (res.status !== 404) {
            const body = (await res.json().catch(() => null)) as { message?: string } | null
            lastErr = new Error(`GitLab ${res.status}: ${body?.message ?? 'request failed'}`)
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
export async function fetchUserMRs(t: Transport, usernames: string[], auth: ProviderAuth): Promise<GitLabMR[]> {
  const byId = new Map<number, GitLabMR>()
  let okCount = 0

  for (const raw of usernames) {
    const username = raw.trim()
    if (!username) continue
    const encoded = encodeURIComponent(username)
    for (const state of ['opened', 'merged'] as const) {
      for (let page = 1; page <= MAX_PAGES; page++) {
        const res = await providerGet(t, 'gitlab', auth, `/api/v4/users/${encoded}/merge_requests?state=${state}&per_page=100&page=${page}&order_by=updated_at&sort=desc`)
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
