import type { JiraConfig, JiraIssue, JiraStatusMapping, Priority, Status, StatusHistoryEntry } from '../types'
import { groupForJiraStatus, buildJqlFromMappings } from './status-groups'

export interface JiraIssueRaw {
  key: string
  fields: {
    summary: string
    status: { name: string; statusCategory: { key: string } }
    priority?: { name: string } | null
    duedate?: string | null
    assignee?: { emailAddress: string; displayName: string } | null
    created?: string | null
    timeoriginalestimate?: number | null
    timespent?: number | null
    customfield_10016?: number | null   // story points (most common)
    customfield_10028?: number | null   // story points (alt field)
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

// Fallback status guesser — only used when no mapping is configured
function mapStatus(categoryKey: string, statusName: string): Status {
  const cat = categoryKey.toLowerCase()
  const name = statusName.toLowerCase()
  if (cat === 'done') return 'done'
  if (name.includes('block') || name.includes('impediment')) return 'blocked'
  if (name.includes('review') || name.includes('testing') || name.includes('qa')) return 'review'
  if (cat === 'indeterminate' || name.includes('progress') || name.includes('develop')) return 'inprogress'
  return 'todo'
}

// Fallback for history entries when no mapping configured
function mapStatusName(name: string): Status {
  const n = name.toLowerCase()
  if (n === 'done' || n === 'closed' || n === 'resolved' || n === 'released') return 'done'
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

// Derive a legacy Status from groupId for internal logic (carry-over, done detection)
export function groupIdToStatus(groupId: string | undefined, _mappings: JiraStatusMapping[] | undefined, categoryKey: string, statusName: string): Status {
  if (!groupId) return mapStatus(categoryKey, statusName)
  if (groupId === 'done') return 'done'
  if (groupId === 'blocked') return 'blocked'
  if (groupId === 'review') return 'review'
  if (groupId === 'inprogress') return 'inprogress'
  // custom group — derive from category as best-effort for internal logic
  if (categoryKey === 'done') return 'done'
  return 'inprogress'
}

function buildStatusHistory(raw: JiraIssueRaw, mappings?: JiraStatusMapping[]): StatusHistoryEntry[] | undefined {
  const histories = raw.changelog?.histories
  if (!histories?.length) return undefined

  const transitions = histories
    .flatMap((h) =>
      h.items
        .filter((item) => item.field === 'status')
        .map((item) => ({ at: h.created, from: item.fromString, to: item.toString })),
    )
    .sort((a, b) => a.at.localeCompare(b.at))

  if (!transitions.length) return undefined

  const resolveStatus = (name: string): Status => {
    const gid = groupForJiraStatus(name, mappings)
    if (gid && gid !== 'hidden') return groupIdToStatus(gid, mappings, '', name)
    return mapStatusName(name)
  }

  const history: StatusHistoryEntry[] = []
  const createdAt = raw.fields.created ?? transitions[0]!.at
  history.push({ status: resolveStatus(transitions[0]!.from), at: createdAt })
  for (const t of transitions) {
    history.push({ status: resolveStatus(t.to), at: t.at })
  }
  return history
}

export function mergeStatusHistory(
  existing: StatusHistoryEntry[] | undefined,
  fresh: StatusHistoryEntry[] | undefined,
): StatusHistoryEntry[] | undefined {
  if (!fresh?.length) return existing
  if (!existing?.length) return fresh
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

export interface JiraBoardInfo {
  id: number
  name: string
  type: string  // 'scrum' | 'kanban' | 'simple'
}

export async function fetchJiraBoardIssues(config: JiraConfig, boardId: number, assigneeEmail: string): Promise<JiraIssueRaw[]> {
  const res = await fetch(`${API_URL}/pm-tracker/jira-board-issues`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      baseUrl: config.baseUrl.trim(),
      email: config.email.trim(),
      token: config.token.trim(),
      boardId,
      assigneeEmail,
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Jira ${res.status}: ${text.slice(0, 300) || res.statusText}`)
  }
  const data = (await res.json()) as { issues?: JiraIssueRaw[] }
  return data.issues ?? []
}

// Resolve which Jira project-key prefixes a board covers (e.g. ['COM']).
// Fetches the board's issues across the given assignee emails and collects distinct
// key prefixes. Returns [] if the board resolves but has no issues.
export async function fetchBoardProjectKeys(config: JiraConfig, boardId: number, assigneeEmails: string[]): Promise<string[]> {
  const emails = assigneeEmails.length ? assigneeEmails : ['']
  const results = await Promise.all(
    emails.map((email) => fetchJiraBoardIssues(config, boardId, email).catch(() => [] as JiraIssueRaw[])),
  )
  const prefixes = new Set<string>()
  for (const issues of results) {
    for (const issue of issues) {
      const prefix = issue.key?.split('-')[0]?.toUpperCase()
      if (prefix) prefixes.add(prefix)
    }
  }
  return [...prefixes]
}

// Resolve the EXACT Jira issue keys on a board (e.g. ['COM-826','COM-813']) across the
// given assignee emails. This is the accurate board-membership signal — a board holds a
// specific subset of issues, which project-key prefix alone cannot express.
export async function fetchBoardIssueKeys(config: JiraConfig, boardId: number, assigneeEmails: string[]): Promise<string[]> {
  const emails = assigneeEmails.length ? assigneeEmails : ['']
  const results = await Promise.all(
    emails.map((email) => fetchJiraBoardIssues(config, boardId, email).catch(() => [] as JiraIssueRaw[])),
  )
  const keys = new Set<string>()
  for (const issues of results) for (const issue of issues) if (issue.key) keys.add(issue.key.toUpperCase())
  return [...keys]
}

export async function fetchJiraBoards(config: JiraConfig): Promise<JiraBoardInfo[]> {
  const res = await fetch(`${API_URL}/pm-tracker/jira-boards`, {
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
  const data = (await res.json()) as Array<{ id: number; name: string; type: string }>
  return data.map((b) => ({ id: b.id, name: b.name, type: b.type }))
}

export interface JiraSprintInfo {
  id: number
  name: string
  state: string  // 'active' | 'future' | 'closed'
  startDate?: string
  endDate?: string
}

export async function fetchJiraSprints(config: JiraConfig, boardId: number): Promise<JiraSprintInfo[]> {
  const res = await fetch(`${API_URL}/pm-tracker/jira-sprints`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      baseUrl: config.baseUrl.trim(),
      email: config.email.trim(),
      token: config.token.trim(),
      boardId,
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Jira ${res.status}: ${text.slice(0, 300) || res.statusText}`)
  }
  const data = (await res.json()) as Array<{ id: number; name: string; state: string; startDate?: string; endDate?: string }>
  return data.map((s) => ({ id: s.id, name: s.name, state: s.state, startDate: s.startDate?.slice(0, 10), endDate: s.endDate?.slice(0, 10) }))
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

// Returns a JQL status clause, or '' to fetch ALL assigned issues regardless of status.
// The tracker mirrors Jira (including Done/closed); only 'hidden'-group statuses are excluded.
export function buildJqlStatusFilter(mappings: JiraStatusMapping[] | undefined): string {
  return buildJqlFromMappings(mappings) ?? ''
}

export function rawToJiraItem(issue: JiraIssueRaw, baseUrl: string, mappings?: JiraStatusMapping[], boardId?: number): JiraIssue {
  const jiraStatusName = issue.fields.status.name
  const categoryKey = issue.fields.status.statusCategory.key
  const groupId = groupForJiraStatus(jiraStatusName, mappings)
  const status = groupIdToStatus(groupId, mappings, categoryKey, jiraStatusName)

  return {
    url: `${baseUrl.replace(/\/$/, '')}/browse/${issue.key}`,
    issueId: issue.key,
    boardId,
    name: issue.fields.summary,
    status,
    groupId: groupId && groupId !== 'hidden' ? groupId : undefined,
    priority: mapPriority(issue.fields.priority?.name),
    deadline: issue.fields.duedate ?? '',
    deadlineTime: '',
    prs: [],
    comment: '',
    statusHistory: buildStatusHistory(issue, mappings),
    storyPoints: issue.fields.customfield_10016 ?? issue.fields.customfield_10028 ?? undefined,
    timeOriginalEstimate: issue.fields.timeoriginalestimate ?? undefined,
    timeSpent: issue.fields.timespent ?? undefined,
  }
}
