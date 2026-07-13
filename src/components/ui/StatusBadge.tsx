import type { JiraIssue, JiraConfig, Status } from '../../types'
import { resolveGroupForIssue, GROUP_COLOR_TOKENS, DEFAULT_STATUS_GROUPS, legacyStatusToGroupId } from '../../utils/status-groups'
import { STATUS_LABEL } from '../../constants'

interface Props {
  issue: JiraIssue
  conn?: JiraConfig
  style?: React.CSSProperties
}

// Resolve display info for an issue: label + color tokens
export function resolveIssueDisplay(issue: JiraIssue, conn?: JiraConfig): { label: string; bg: string; text: string; border: string } {
  const groupId = issue.groupId ?? legacyStatusToGroupId(issue.status)
  const group = resolveGroupForIssue(groupId, conn) ?? DEFAULT_STATUS_GROUPS.find((g) => g.id === 'todo')!
  const tokens = GROUP_COLOR_TOKENS[group.color]
  return { label: group.label, ...tokens }
}

// Resolve display color hex for charts/dots
export function resolveIssueColor(issue: JiraIssue, conn?: JiraConfig): string {
  const groupId = issue.groupId ?? legacyStatusToGroupId(issue.status)
  const group = resolveGroupForIssue(groupId, conn) ?? DEFAULT_STATUS_GROUPS.find((g) => g.id === 'todo')!
  const tokens = GROUP_COLOR_TOKENS[group.color]
  return tokens.text.startsWith('var(') ? tokens.text : tokens.text
}

// Resolve for a plain Status (non-Jira tasks)
export function resolveStatusDisplay(status: Status): { label: string; bg: string; text: string; border: string } {
  const group = DEFAULT_STATUS_GROUPS.find((g) => g.id === status) ?? DEFAULT_STATUS_GROUPS[0]!
  return { label: group.label, ...GROUP_COLOR_TOKENS[group.color] }
}

export default function StatusBadge({ issue, conn, style }: Props) {
  const { label, bg, text, border } = resolveIssueDisplay(issue, conn)
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 600,
      padding: '2px 8px', borderRadius: 20,
      background: bg, color: text, border: `1px solid ${border}`,
      ...style,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: text, flexShrink: 0 }} />
      {label}
    </span>
  )
}

// For the StatusSelect dropdown — shows all groups from a connection
export function groupSelectStyle(groupId: string, conn?: JiraConfig): React.CSSProperties {
  const group = resolveGroupForIssue(groupId, conn) ?? DEFAULT_STATUS_GROUPS.find((g) => g.id === 'todo')!
  const tokens = GROUP_COLOR_TOKENS[group.color]
  return { background: tokens.bg, color: tokens.text, borderColor: tokens.border }
}

// Legacy: resolve display for a raw Status string (for non-Jira tasks)
export function statusClassName(status: Status): string {
  return `spill s-${status}`
}

// Label for a status — use group label if available, else fallback
export function statusLabel(status: Status): string {
  return STATUS_LABEL[status] ?? status
}
