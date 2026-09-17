import type { StatusGroup, StatusGroupColor, JiraConfig, JiraStatusMapping } from '../types'

export const GROUP_COLOR_TOKENS: Record<StatusGroupColor, { bg: string; text: string; border: string }> = {
  gray:   { bg: 'var(--surface3)',   text: 'var(--text3)',   border: 'var(--border2)' },
  blue:   { bg: 'var(--accent-dim)', text: 'var(--accent)',  border: 'var(--accent-border)' },
  amber:  { bg: 'var(--amber-dim)',  text: 'var(--amber)',   border: 'var(--amber-border)' },
  red:    { bg: 'var(--red-dim)',    text: 'var(--red)',     border: 'var(--red-border)' },
  purple: { bg: 'var(--purple-dim)', text: 'var(--purple)',  border: 'var(--purple-border)' },
  green:  { bg: 'var(--green-dim)',  text: 'var(--green)',   border: 'var(--green-border)' },
  teal:   { bg: 'var(--teal-dim)',   text: 'var(--teal)',    border: 'var(--teal-border)' },
  pink:   { bg: 'var(--pink-dim)',   text: 'var(--pink)',    border: 'var(--pink-border)' },
  orange: { bg: 'var(--orange-dim)', text: 'var(--orange)',  border: 'var(--orange-border)' },
}

export const GROUP_COLOR_HEX: Record<StatusGroupColor, string> = {
  gray:   '#8892b8',
  blue:   '#3b5bdb',
  amber:  '#d97706',
  red:    '#dc2626',
  purple: '#7c3aed',
  green:  '#0f9f52',
  teal:   '#0891b2',
  pink:   '#db2777',
  orange: '#ea580c',
}

export const DEFAULT_STATUS_GROUPS: StatusGroup[] = [
  { id: 'todo',       label: 'To Do',       color: 'gray' },
  { id: 'inprogress', label: 'In Progress',  color: 'amber' },
  { id: 'blocked',    label: 'Blocked',      color: 'red' },
  { id: 'review',     label: 'Code Review',  color: 'purple' },
  { id: 'done',       label: 'Done',         color: 'green', isClosed: true },
]

export function resolveGroups(conn: JiraConfig | undefined): StatusGroup[] {
  return conn?.statusGroups?.length ? conn.statusGroups : DEFAULT_STATUS_GROUPS
}

export function resolveGroupForIssue(
  groupId: string | undefined,
  conn: JiraConfig | undefined,
): StatusGroup | undefined {
  if (!groupId) return undefined
  const groups = resolveGroups(conn)
  return groups.find((g) => g.id === groupId)
}

export function isClosedGroup(groupId: string | undefined, conn: JiraConfig | undefined): boolean {
  if (!groupId) return false
  if (groupId === 'hidden') return false
  const group = resolveGroupForIssue(groupId, conn)
  return group?.isClosed === true
}

export function groupForJiraStatus(
  jiraStatusName: string,
  mappings: JiraStatusMapping[] | undefined,
): string | undefined {
  if (!mappings?.length) return undefined
  // Resolve through the same dedupe the config UI displays. A raw .find() would return the
  // FIRST row for a name, which on a config with duplicates can be a stale 'hidden' while
  // the UI shows the visible one -- so a status looked mapped but behaved as hidden.
  const m = dedupeMappings(mappings).find((m) => m.jiraStatus.toLowerCase() === jiraStatusName.toLowerCase())
  return m?.groupId
}

// Build JQL status filter from mappings.
// Bounds the result so a developer's full closed-issue history doesn't blow past the
// API's 100-issue page cap: fetch everything not Done, PLUS Done issues updated recently
// (last 30 days). Statuses mapped to the 'hidden' group are always excluded.
// The tracker mirrors Jira; visibility (e.g. hiding done in Daily) is a display concern.
export function buildJqlFromMappings(mappings: JiraStatusMapping[] | undefined): string | null {
  const base = `(statusCategory != Done OR updated >= -30d)`
  const hidden = dedupeMappings(mappings)
    .filter((m) => m.groupId === 'hidden')
    .map((m) => `"${m.jiraStatus}"`)
  if (!hidden.length) return base
  return `${base} AND status not in (${hidden.join(', ')})`
}

// Jira's /status endpoint returns one row per workflow, so older saved configs accumulated
// several mappings for the same status name. Collapse to one per name; a name visible in
// any row stays visible, so a stale duplicate can't silently hide a status from the JQL.
export function dedupeMappings(mappings: JiraStatusMapping[] | undefined): JiraStatusMapping[] {
  const byName = new Map<string, JiraStatusMapping>()
  for (const m of mappings ?? []) {
    const key = m.jiraStatus.trim().toLowerCase()
    if (!key) continue
    const prev = byName.get(key)
    if (!prev || (prev.groupId === 'hidden' && m.groupId !== 'hidden')) byName.set(key, m)
  }
  return [...byName.values()]
}

// The group an issue belongs to RIGHT NOW, given the current mappings.
//
// An issue's groupId is stamped at sync time, so relying on it alone freezes whatever the
// mappings said when it was fetched -- changing the integration settings then appeared to
// do nothing until the next sync. Re-resolving from the issue's Jira status name applies a
// mapping change immediately; the stored value is the fallback for issues synced before
// jiraStatusName existed.
export function resolveLiveGroupId(
  issue: { groupId?: string; jiraStatusName?: string },
  conn: JiraConfig | undefined,
): string | undefined {
  if (issue.jiraStatusName && conn?.statusMappings?.length) {
    const gid = groupForJiraStatus(issue.jiraStatusName, conn.statusMappings)
    if (gid) return gid
  }
  return issue.groupId
}

// Legacy Status → groupId for backward compat (issues saved before groupId existed)
export function legacyStatusToGroupId(status: string): string {
  const map: Record<string, string> = {
    todo: 'todo', inprogress: 'inprogress', blocked: 'blocked', review: 'review', done: 'done',
  }
  return map[status] ?? 'todo'
}
