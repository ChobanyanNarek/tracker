import { fetchViaBridge } from './bridge'
import type { GitLabConfig } from '../types'

export interface GitLabMR {
  id: number
  iid: number
  title: string
  source_branch: string
  web_url: string
  created_at: string
  author: { id: number; username: string; name: string }
  assignees: { id: number; username: string }[]
}

// Extract a Jira issue key (e.g. MONE-123) from branch name or MR title.
export function extractJiraKey(mr: GitLabMR): string | null {
  const RE = /([A-Z][A-Z0-9]+-\d+)/i
  const fromBranch = mr.source_branch.match(RE)
  if (fromBranch) return fromBranch[1].toUpperCase()
  const fromTitle = mr.title.match(RE)
  if (fromTitle) return fromTitle[1].toUpperCase()
  return null
}

export function normalizeGroupPath(raw: string): string {
  return raw.replace(/^https?:\/\/gitlab\.com\//i, '').replace(/\/$/, '').trim()
}

export async function fetchGroupMRs(config: GitLabConfig): Promise<GitLabMR[]> {
  const groupPath = normalizeGroupPath(config.groupPath)
  if (!groupPath) throw new Error('Group path is empty — enter just the path, e.g. mycompany or mycompany/subgroup')
  // GitLab requires the full path to be percent-encoded (slashes become %2F)
  const encoded = encodeURIComponent(groupPath)
  const url = `https://gitlab.com/api/v4/groups/${encoded}/merge_requests?state=opened&per_page=100&order_by=updated_at&sort=desc`
  const headers = { 'PRIVATE-TOKEN': config.token, Accept: 'application/json' }

  let res = await fetchViaBridge(url, headers)
  if (!res) res = await fetch(url, { headers })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`GitLab ${res.status}: ${text.slice(0, 200) || res.statusText}`)
  }
  return (await res.json()) as GitLabMR[]
}
