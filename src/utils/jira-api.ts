import type { JiraConfig, JiraIssue, JiraStatusMapping, Priority, Status, StatusHistoryEntry } from '../types'

export interface JiraIssueRaw {
  key: string
  fields: {
    summary: string
    status: { name: string; statusCategory: { key: string } }
    priority?: { name: string } | null
    duedate?: string | null
    assignee?: { emailAddress: string; displayName: string } | null
    created?: string | null
  }
  changelog?: {
    histories: Array<{
      created: string
      items: Array<{
        field: string
        fromString: string
        toString: string
      }>
    }>
  }
}

function mapStatus(categoryKey: string, statusName: string): Status {
  const cat = categoryKey.toLowerCase()
  const name = statusName.toLowerCase()
  if (cat === 'done') return 'done'
  if (name.includes('code review') || name === 'code_review') return 'done'
  if (name.includes('block') || name.includes('impediment')) return 'blocked'
  if (name.includes('review') || name.includes('testing') || name.includes('qa')) return 'review'
  if (cat === 'indeterminate' || name.includes('progress') || name.includes('develop')) return 'inprogress'
  return 'todo'
}

function mapStatusName(name: string): Status {
  const n = name.toLowerCase()
  if (n === 'done' || n === 'closed' || n === 'resolved' || n === 'released') return 'done'
  if (n.includes('code review') || n === 'code_review') return 'done'
  if (n.includes('block') || n.includes('impediment')) return 'blocked'
  if (n.includes('review') || n.includes('testing') || n.includes('qa')) return 'review'
  if (n.includes('progress') || n.includes('develop') || n.includes('active')) return 'inprogress'
  return 'todo'
}

function mapPriority(name?: string | null): Priority {
  if (!name) return 'medium'
  const n = name.toLowerCase()
  if (n === 'critical' || n === 'blocker') return 'critical'
  if (n === 'high' || n === 'major') return 'high'
  if (n === 'low' || n === 'minor' || n === 'trivial') return 'low'
  return 'medium'
}

function buildStatusHistory(raw: JiraIssueRaw): StatusHistoryEntry[] | undefined {
  const histories = raw.changelog?.histories
  if (!histories?.length) return undefined

  // Collect all status-field transitions, sorted chronologically (oldest first)
  const transitions = histories
    .flatMap((h) =>
      h.items
        .filter((item) => item.field === 'status')
        .map((item) => ({ at: h.created, from: item.fromString, to: item.toString })),
    )
    .sort((a, b) => a.at.localeCompare(b.at))

  if (!transitions.length) return undefined

  const history: StatusHistoryEntry[] = []
  // Seed with the initial status (before the first transition)
  // using issue creation date as the "entered at" time
  const createdAt = raw.fields.created ?? transitions[0]!.at
  history.push({ status: mapStatusName(transitions[0]!.from), at: createdAt })
  // Each transition marks when the issue entered the new status
  for (const t of transitions) {
    history.push({ status: mapStatusName(t.to), at: t.at })
  }
  return history
}

/**
 * Merge Jira changelog history (fresh) with locally tracked history (existing).
 * Fresh is authoritative for the past; any local entries recorded after the
 * last fresh entry are appended so manual changes aren't lost.
 */
export function mergeStatusHistory(
  existing: StatusHistoryEntry[] | undefined,
  fresh: StatusHistoryEntry[] | undefined,
): StatusHistoryEntry[] | undefined {
  if (!fresh?.length) return existing
  if (!existing?.length) return fresh
  // Compare chronologically, not lexicographically: Jira changelog timestamps
  // may carry numeric offsets (+0300) while local entries are always UTC (…Z),
  // so a raw string `>` can mis-order genuinely newer local entries.
  const lastFreshMs = new Date(fresh[fresh.length - 1]!.at).getTime()
  const localTail = existing.filter((e) => new Date(e.at).getTime() > lastFreshMs)
  return localTail.length ? [...fresh, ...localTail] : fresh
}

import { authHeaders } from './auth'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

export interface JiraStatusInfo {
  name: string
  categoryKey: string  // 'new' | 'indeterminate' | 'done'
}

export async function fetchJiraStatuses(config: JiraConfig): Promise<JiraStatusInfo[]> {
  const res = await fetch(`${API_URL}/pm-tracker/jira-statuses`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      baseUrl: config.baseUrl.trim(),
      email: config.email.trim(),
      token: config.token.trim(),
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Jira ${res.status}: ${text.slice(0, 300) || res.statusText}`)
  }
  const data = (await res.json()) as Array<{ name: string; statusCategory: { key: string } }>
  const seen = new Set<string>()
  return data
    .filter((s) => { if (seen.has(s.name)) return false; seen.add(s.name); return true })
    .map((s) => ({ name: s.name, categoryKey: s.statusCategory?.key ?? 'new' }))
}

export async function fetchJiraIssues(config: JiraConfig, jql: string): Promise<JiraIssueRaw[]> {
  const res = await fetch(`${API_URL}/pm-tracker/jira-search`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      baseUrl: config.baseUrl.trim(),
      email: config.email.trim(),
      token: config.token.trim(),
      jql,
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Jira ${res.status}: ${text.slice(0, 300) || res.statusText}`)
  }

  const data = (await res.json()) as { issues?: JiraIssueRaw[] }
  return data.issues ?? []
}

export function buildJqlStatusFilter(mappings: JiraStatusMapping[] | undefined): string {
  if (!mappings?.length) {
    return `(status in ("To Do", "In Progress", "Code Review", "Blocked", "Backlog") OR (status = "Closed" AND updated >= -7d))`
  }
  const visible = mappings.filter((m) => m.displayBucket !== 'hidden').map((m) => `"${m.jiraStatus}"`)
  if (!visible.length) return 'status = "To Do"'
  return `status in (${visible.join(', ')})`
}

export function applyStatusMapping(
  categoryKey: string,
  statusName: string,
  mappings: JiraStatusMapping[] | undefined,
): { status: Status; displayLabel?: string } {
  if (mappings?.length) {
    const match = mappings.find((m) => m.jiraStatus.toLowerCase() === statusName.toLowerCase())
    if (match && match.displayBucket !== 'hidden') {
      return { status: match.displayBucket as Status, displayLabel: match.displayLabel || undefined }
    }
  }
  return { status: mapStatus(categoryKey, statusName) }
}

export function rawToJiraItem(issue: JiraIssueRaw, baseUrl: string, mappings?: JiraStatusMapping[]): JiraIssue {
  const { status, displayLabel } = applyStatusMapping(
    issue.fields.status.statusCategory.key,
    issue.fields.status.name,
    mappings,
  )
  return {
    url: `${baseUrl.replace(/\/$/, '')}/browse/${issue.key}`,
    name: issue.fields.summary,
    status,
    displayLabel,
    priority: mapPriority(issue.fields.priority?.name),
    deadline: issue.fields.duedate ?? '',
    deadlineTime: '',
    prs: [],
    comment: '',
    statusHistory: buildStatusHistory(issue),
  }
}
