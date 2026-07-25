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

export const AM_HOLIDAYS: Record<string, string> = {
  '01-01': "New Year's Day",
  '01-02': 'New Year Holiday',
  '01-03': 'New Year Holiday',
  '01-04': 'New Year Holiday',
  '01-05': 'New Year Holiday',
  '01-06': 'Christmas Day',
  '01-07': 'Christmas Holiday',
  '01-13': 'Army Day',
  '02-21': 'Mother Language Day',
  '04-07': 'Motherhood & Beauty Day',
  '04-24': 'Genocide Remembrance Day',
  '05-01': 'Labour Day',
  '05-08': 'Yerkrapah Day',
  '05-09': 'Victory & Peace Day',
  '05-28': 'Republic Day',
  '07-05': 'Constitution Day',
  '09-21': 'Independence Day',
  '12-07': 'Earthquake Remembrance Day',
  '12-31': "New Year's Eve",
}
