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
  const m = mappings.find((m) => m.jiraStatus.toLowerCase() === jiraStatusName.toLowerCase())
  return m?.groupId
}

// Build JQL status filter from mappings — exclude only statuses explicitly mapped to 'hidden'
export function buildJqlFromMappings(mappings: JiraStatusMapping[] | undefined): string | null {
  if (!mappings?.length) return null
  const hidden = mappings.filter((m) => m.groupId === 'hidden').map((m) => `"${m.jiraStatus}"`)
  if (!hidden.length) return `statusCategory != Done`
  return `statusCategory != Done AND status not in (${hidden.join(', ')})`
}

// Legacy Status → groupId for backward compat (issues saved before groupId existed)
export function legacyStatusToGroupId(status: string): string {
  const map: Record<string, string> = {
    todo: 'todo', inprogress: 'inprogress', blocked: 'blocked', review: 'review', done: 'done',
  }
  return map[status] ?? 'todo'
}
