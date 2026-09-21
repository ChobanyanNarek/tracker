import type { JiraIssue, Task } from '../types'

// Extract Jira issue keys (e.g. MONE-123) from arbitrary PR/MR text (title, branch name).
// Matching is anchored to the configured Jira project keys when available — this avoids
// false positives like a branch "feature/add-login-2" being read as the key "LOGIN-2".
// With no configured keys we fall back to a generic *uppercase* pattern (lowercase branch
// words must not be mistaken for a key). Shared between gitlab-api.ts and github-api.ts,
// which otherwise duplicated this exact regex logic.
export function keysFromText(text: string, projectKeys: string[]): string[] {
  const found = new Set<string>()
  const configured = projectKeys.map((k) => k.trim()).filter(Boolean)
  if (configured.length) {
    const esc = configured.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    for (const m of text.matchAll(new RegExp(`(?:${esc.join('|')})-\\d+`, 'ig'))) found.add(m[0].toUpperCase())
    // Stop here. The generic pattern below used to run as well, so a branch or title
    // mentioning ANY key matched -- which let a PR from one project link to another
    // project's issue even though that key was never configured here.
    return [...found]
  }
  // No keys configured for this project: fall back to the generic uppercase pattern.
  for (const m of text.matchAll(/[A-Z][A-Z0-9]+-\d+/g)) found.add(m[0])
  return [...found]
}

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

const PRESETS_KEY = 'pm_tracker_task_presets'
const JIRA_PRESETS_KEY = 'pm_tracker_jira_presets'
const DEFAULT_PRESETS = ['Code Review', 'Fix Comments', 'Bug Fix', 'Code Refactor']

function readLocalArray(key: string, fallback: string[]): string[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}
function writeLocalArray(key: string, arr: string[]): void {
  try { localStorage.setItem(key, JSON.stringify(arr)) } catch { /* storage unavailable — preset just won't persist */ }
}

let _presets: string[] = readLocalArray(PRESETS_KEY, DEFAULT_PRESETS)
let _jiraPresets: string[] = readLocalArray(JIRA_PRESETS_KEY, [])
const _presetListeners = new Set<() => void>()

// Tiny external-store pub-sub so every JiraRow instance stays in sync when a
// preset is added/removed from any one of them (previously each row held its
// own local copy that only refreshed on remount).
export function loadPresets(): string[] { return _presets }
export function savePresets(arr: string[]): void {
  _presets = arr
  writeLocalArray(PRESETS_KEY, arr)
  _presetListeners.forEach((fn) => fn())
}
export function loadJiraPresets(): string[] { return _jiraPresets }
export function saveJiraPresets(arr: string[]): void {
  _jiraPresets = arr
  writeLocalArray(JIRA_PRESETS_KEY, arr)
  _presetListeners.forEach((fn) => fn())
}
export function subscribePresets(fn: () => void): () => void {
  _presetListeners.add(fn)
  return () => _presetListeners.delete(fn)
}

/*
 * Integration identities (Jira emails, GitLab/GitHub usernames) are stored either as a
 * single string (the original shape, still present in saved data) or as a list. This is
 * the ONLY place that difference is handled — everything else should call this and work
 * with a clean array of non-empty, trimmed values.
 */
export function identityList(value: string | string[] | undefined): string[] {
  if (!value) return []
  const arr = Array.isArray(value) ? value : [value]
  const seen = new Set<string>()
  return arr
    .map((v) => (v ?? '').trim())
    .filter((v) => {
      if (!v || seen.has(v)) return false
      seen.add(v)
      return true
    })
}

/*
 * Resolve a developer's identities for one connection: the connection's own override
 * wins when it has any usable value, otherwise the developer's global default. An
 * override that exists but is blank must NOT beat the default — that silently synced
 * nothing before.
 */
export function resolveIdentities(
  override: string | string[] | undefined,
  fallback: string | string[] | undefined,
): string[] {
  const o = identityList(override)
  return o.length ? o : identityList(fallback)
}

// ── Parent / subtask nesting ───────────────────────────────────
// Arrange a flat issue list so each subtask sits directly under its parent, at depth 1.
// Ordering within the list is otherwise preserved, so the caller's own sort (active, then
// done, then hidden) still governs the top level.
//
// A subtask whose parent is NOT in this list is treated as a root: it must stay visible
// rather than disappear because the parent sits on another day, another developer's task,
// or was never synced.
export interface NestedIssue<T> { issue: T; depth: number; childCount: number }

export function nestByParent<T extends { issueId?: string; parentKey?: string }>(
  issues: T[],
): NestedIssue<T>[] {
  const byKey = new Map<string, T>()
  for (const i of issues) if (i.issueId) byKey.set(i.issueId.toUpperCase(), i)

  const childrenOf = new Map<string, T[]>()
  const roots: T[] = []
  for (const i of issues) {
    const pk = i.parentKey?.trim().toUpperCase()
    // Guard against an issue claiming itself as parent, which would recurse forever.
    if (pk && pk !== i.issueId?.toUpperCase() && byKey.has(pk)) {
      const arr = childrenOf.get(pk) ?? []
      arr.push(i)
      childrenOf.set(pk, arr)
    } else {
      roots.push(i)
    }
  }

  const out: NestedIssue<T>[] = []
  const emitted = new Set<T>()
  const walk = (node: T, depth: number): void => {
    // A cycle (A parents B, B parents A) would otherwise loop forever.
    if (emitted.has(node)) return
    emitted.add(node)
    const kids = node.issueId ? (childrenOf.get(node.issueId.toUpperCase()) ?? []) : []
    out.push({ issue: node, depth, childCount: kids.length })
    for (const k of kids) walk(k, depth + 1)
  }
  for (const r of roots) walk(r, 0)
  // Anything unreachable (part of a cycle) still gets rendered, flat.
  for (const i of issues) if (!emitted.has(i)) out.push({ issue: i, depth: 0, childCount: 0 })
  return out
}
