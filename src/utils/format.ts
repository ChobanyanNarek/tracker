import type { JiraIssue, Task } from '../types'

export function hexRgb(hex: string): string {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return r
    ? `${parseInt(r[1], 16)},${parseInt(r[2], 16)},${parseInt(r[3], 16)}`
    : '37,99,235'
}

export function initials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function prLabel(url: string): string | null {
  if (!url) return null
  if (url.includes('pull/')) return 'PR #' + url.split('/').pop()
  if (url.includes('merge')) return 'MR #' + url.split('/').pop()
  return 'PR/MR'
}

export function jiraLabel(url: string): string | null {
  if (!url) return null
  const m = url.match(/([A-Z][A-Z0-9]+-\d+)/)
  return m ? m[1] : null
}

export function jiraPresetLabel(url: string): string {
  if (!url) return ''
  const ticket = url.match(/([A-Z][A-Z0-9]+-\d+)/)
  if (ticket) return ticket[1]
  try {
    const parsed = new URL(url)
    const parts = parsed.pathname
      .replace(/\/+$/, '')
      .split('/')
      .filter(Boolean)
    const last = parts[parts.length - 1] ?? ''
    return (
      parsed.hostname.replace('www.', '').split('.')[0] + (last ? '/' + last : '')
    ).slice(0, 28)
  } catch {
    return url.replace(/^https?:\/\//, '').slice(0, 28)
  }
}

// Returns a stable dedup key for a jira issue.
// Extracts the Jira ticket ID (e.g. "MONE-781") from the URL or name when
// possible so that the same issue entered with slightly different URL formats
// (https://…/browse/MONE-781, https://…/MONE-781, bare "MONE-781") always
// maps to a single card in the Deadlines dashboard.
export function jiraDedupeKey(url: string, name: string): string {
  const u = (url ?? '').trim()
  if (u) {
    const ticket = u.match(/([A-Z][A-Z0-9]+-\d+)/)
    if (ticket) return ticket[1]
    return u.replace(/\/+$/, '')
  }
  const n = (name ?? '').trim()
  if (n) {
    const ticket = n.match(/([A-Z][A-Z0-9]+-\d+)/)
    if (ticket) return ticket[1]
    return `name:${n}`
  }
  return 'name:'
}

export function getJiras(task: Task): JiraIssue[] {
  if (Array.isArray(task.jiras) && task.jiras.length) return task.jiras
  if (task.jira)
    return [
      {
        url: task.jira,
        name: '',
        status: 'todo',
        priority: 'low',
        deadline: '',
        deadlineTime: '',
        prs: [],
        comment: '',
        _srcIdx: 0,
      },
    ]
  return []
}

export function hasPending(task: Task): boolean {
  const j = getJiras(task)
  return j.length ? j.some((x) => x.status !== 'done') : task.status !== 'done'
}

let _presets: string[] = ['Code Review', 'Fix Comments', 'Bug Fix', 'Code Refactor']
let _jiraPresets: string[] = []

export function loadPresets(): string[] { return _presets }
export function savePresets(arr: string[]): void { _presets = arr }
export function loadJiraPresets(): string[] { return _jiraPresets }
export function saveJiraPresets(arr: string[]): void { _jiraPresets = arr }
