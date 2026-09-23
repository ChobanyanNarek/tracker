import type { JiraIssue } from '../types'

export function makeId(prefix: string): string {
  return prefix + Date.now() + Math.random().toString(36).slice(2, 6)
}

function isIssueDone(j: JiraIssue): boolean {
  return j.status === 'done'
}

// Active issues first, then done, then hidden.
export function sortJiraIssues(jiras: JiraIssue[]): JiraIssue[] {
  const active = jiras.filter((j) => !j.hidden && !isIssueDone(j))
  const done = jiras.filter((j) => !j.hidden && isIssueDone(j))
  const hidden = jiras.filter((j) => j.hidden)
  return [...active, ...done, ...hidden]
}
