import type { Status, Priority } from '../types'

export const DEFAULT_PRESETS = ['Code Review', 'Fix Comments', 'Bug Fix', 'Code Refactor']

// Built via BASE_URL (not a literal "/…" path) so it still resolves once deployed
// under the GitHub Pages subpath (vite.config.ts sets base: './').


// Project color palette — aligned to the CSS design tokens (index.css :root) so a
// color picked here renders identically to var(--accent)/var(--green)/etc.
export const PALETTE = [
  '#3b5bdb', '#0f9f52', '#d97706', '#7c3aed', '#dc2626',
  '#0891b2', '#db2777', '#65a30d', '#ea580c', '#6366f1',
]

export const STATUS_LABEL: Record<Status, string> = {
  todo: 'To Do',
  inprogress: 'In Progress',
  review: 'In Review',
  done: 'Done',
  blocked: 'Blocked',
}

// Status colors — must match the CSS tokens (--text3/--amber/--purple/--green/--red)
export const STATUS_COLOR: Record<Status, string> = {
  todo: '#8892b8',
  inprogress: '#d97706',
  review: '#7c3aed',
  done: '#0f9f52',
  blocked: '#dc2626',
}

export const STATUS_EMOJI: Record<Status, string> = {
  todo: '📋',
  inprogress: '🔄',
  review: '🔍',
  done: '✅',
  blocked: '🚫',
}

// Priority colors — aligned to CSS tokens (--red/--amber/--accent/--text3)
export const PRIORITY_CONF: Record<Priority, { color: string; label: string }> = {
  critical: { color: '#dc2626', label: 'Critical' },
  high:     { color: '#d97706', label: 'High' },
  medium:   { color: '#3b5bdb', label: 'Medium' },
  low:      { color: '#8892b8', label: 'Low' },
}

export { AM_HOLIDAYS } from '../sync-core/dates'
