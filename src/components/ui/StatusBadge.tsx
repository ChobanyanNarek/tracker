import type { JiraIssue, JiraConfig, Status } from '../../types'
import { resolveGroupForIssue, GROUP_COLOR_TOKENS, DEFAULT_STATUS_GROUPS, legacyStatusToGroupId, groupForJiraStatus } from '../../sync-core/status-groups'
import { STATUS_LABEL } from '../../constants'

// The group an issue belongs to now, not the one stamped when it synced.
function liveGroupId(issue: JiraIssue, conn?: JiraConfig): string | undefined {
  if (issue.jiraStatusName && conn?.statusMappings?.length) {
    const gid = groupForJiraStatus(issue.jiraStatusName, conn.statusMappings)
    if (gid) return gid
  }
  return issue.groupId
}

// Resolve display info for an issue: label + color tokens
export function resolveIssueDisplay(issue: JiraIssue, conn?: JiraConfig): { label: string; bg: string; text: string; border: string } {
  const groupId = liveGroupId(issue, conn) ?? legacyStatusToGroupId(issue.status)
  const group = resolveGroupForIssue(groupId, conn) ?? DEFAULT_STATUS_GROUPS.find((g) => g.id === 'todo')!
  const tokens = GROUP_COLOR_TOKENS[group.color]
  return { label: group.label, ...tokens }
}

// Label for a status — use group label if available, else fallback
export function statusLabel(status: Status): string {
  return STATUS_LABEL[status] ?? status
}
