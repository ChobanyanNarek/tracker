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
  // The user's saved set is the whole truth. Appending the defaults to fill missing ids
  // listed a group twice whenever a saved group carried the same LABEL as a default under
  // a different generated id -- the status dropdown then showed "Code Review" twice, one
  // of them unselectable. Ids the saved set does not define are handled where they are
  // resolved, not by padding the list the user sees.
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

  const saved = conn?.statusGroups ?? []
  const own = saved.find((g) => g.id === groupId)
  if (own) return own.isClosed === true

  // Not a group this connection defines -- not closed. Mappings are kept pointing at real
  // groups (see repointOrphanMappings / remapAfterGroupChange), so no guessing happens here.
  return false
}

export function groupForJiraStatus(
  jiraStatusName: string,
  mappings: JiraStatusMapping[] | undefined,
): string | undefined {
  if (!mappings?.length) return undefined
  const m = mappings.find((m) => m.jiraStatus.toLowerCase() === jiraStatusName.toLowerCase())
  return m?.groupId
}

// Build JQL status filter from mappings.
// Bounds the result so a developer's full closed-issue history doesn't blow past the
// API's 100-issue page cap: fetch everything not Done, PLUS Done issues updated recently
// (last 30 days). Statuses mapped to the 'hidden' group are always excluded.
// The tracker mirrors Jira; visibility (e.g. hiding done in Daily) is a display concern.
export function buildJqlFromMappings(mappings: JiraStatusMapping[] | undefined): string | null {
  const base = `(statusCategory != Done OR updated >= -30d)`
  // Jira returns one status row per workflow, so a name can be saved several times. Decide
  // once per NAME, matching what the settings list shows (first row wins): filtering the
  // raw rows meant a single stale 'hidden' duplicate excluded a status from the query even
  // though the UI displayed it as visible, so those issues were never fetched at all.
  const groupByName = new Map<string, string>()
  for (const m of mappings ?? []) {
    const key = m.jiraStatus.trim().toLowerCase()
    if (!key || groupByName.has(key)) continue
    groupByName.set(key, m.groupId)
  }
  const nameFor = new Map<string, string>()
  for (const m of mappings ?? []) {
    const key = m.jiraStatus.trim().toLowerCase()
    if (key && !nameFor.has(key)) nameFor.set(key, m.jiraStatus)
  }
  const hidden = [...groupByName.entries()]
    .filter(([, gid]) => gid === 'hidden')
    .map(([key]) => `"${nameFor.get(key)}"`)
  if (!hidden.length) return base
  return `${base} AND status not in (${hidden.join(', ')})`
}

// Legacy Status → groupId for backward compat (issues saved before groupId existed)
export function legacyStatusToGroupId(status: string): string {
  const map: Record<string, string> = {
    todo: 'todo', inprogress: 'inprogress', blocked: 'blocked', review: 'review', done: 'done',
  }
  return map[status] ?? 'todo'
}

// ── Keeping mappings pointed at groups that exist ─────────────────
// A mapping whose groupId matches no group in the connection resolves to nothing: its
// closed flag can't be read and its badge falls back to a stock label. These helpers keep
// that from happening, so no lookup ever needs to guess.

// Default group for a newly seen Jira status, chosen only from the groups this connection
// actually has. Done-category statuses go to a closed group rather than 'hidden': hidden
// statuses are excluded from the Jira query, so those issues would never be fetched.
export function defaultGroupForCategory(categoryKey: string, groups: StatusGroup[]): string {
  const has = (id: string) => groups.some((g) => g.id === id)
  const firstOpen = groups.find((g) => !g.isClosed)?.id
  if (categoryKey === 'done') return groups.find((g) => g.isClosed)?.id ?? 'hidden'
  if (categoryKey === 'indeterminate') return has('inprogress') ? 'inprogress' : firstOpen ?? groups[0]?.id ?? 'hidden'
  return has('todo') ? 'todo' : firstOpen ?? groups[0]?.id ?? 'hidden'
}

// One-time repair for configs saved before this was enforced: a mapping pointing at a stock
// id the user's groups no longer contain (e.g. 'review', after recreating the group as
// "Code Review" with a generated id) is re-pointed at the saved group carrying that stock
// group's label. Deterministic, and it only uses the user's own naming; anything that
// cannot be matched is left as is.
export function repointOrphanMappings(conn: JiraConfig): JiraConfig {
  const groups = conn.statusGroups ?? []
  const mappings = conn.statusMappings ?? []
  if (!groups.length || !mappings.length) return conn
  const ids = new Set(groups.map((g) => g.id))
  let changed = false
  const next = mappings.map((m) => {
    if (m.groupId === 'hidden' || ids.has(m.groupId)) return m
    const stockLabel = DEFAULT_STATUS_GROUPS.find((g) => g.id === m.groupId)?.label.trim().toLowerCase()
    const target = stockLabel ? groups.find((g) => g.label.trim().toLowerCase() === stockLabel) : undefined
    if (!target) return m
    changed = true
    return { ...m, groupId: target.id }
  })
  return changed ? { ...conn, statusMappings: next } : conn
}

// When a group is removed, move the mappings that pointed at it to a remaining open group,
// so those statuses keep resolving instead of silently becoming unknown.
export function remapAfterGroupChange(conn: JiraConfig, nextGroups: StatusGroup[]): JiraConfig {
  const before = new Set((conn.statusGroups ?? DEFAULT_STATUS_GROUPS).map((g) => g.id))
  const after = new Set(nextGroups.map((g) => g.id))
  const fallback = nextGroups.find((g) => !g.isClosed)?.id ?? nextGroups[0]?.id ?? 'hidden'
  const mappings = (conn.statusMappings ?? []).map((m) =>
    before.has(m.groupId) && !after.has(m.groupId) ? { ...m, groupId: fallback } : m,
  )
  return { ...conn, statusGroups: nextGroups, statusMappings: mappings }
}
