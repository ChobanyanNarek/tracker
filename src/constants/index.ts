import type { Status, Priority } from '../types'

export const LS_KEY = 'pmtracker_v4'
export const PRESETS_KEY = 'pmtracker_presets'
export const JIRA_PRESETS_KEY = 'pmtracker_jira_presets'
export const DEFAULT_PRESETS = ['Code Review', 'Fix Comments', 'Bug Fix', 'Code Refactor']

// Built via BASE_URL (not a literal "/…" path) so it still resolves once deployed
// under the GitHub Pages subpath (vite.config.ts sets base: './').
export const NOTIFICATION_ICON = `${import.meta.env.BASE_URL}icon-v3.png`

export const PALETTE = [
  '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#dc2626',
  '#0891b2', '#db2777', '#65a30d', '#ea580c', '#6366f1',
]

export const STATUS_LABEL: Record<Status, string> = {
  todo: 'To Do',
  inprogress: 'In Progress',
  review: 'In Review',
  done: 'Done',
  blocked: 'Blocked',
}

export const STATUS_COLOR: Record<Status, string> = {
  todo: '#9aa0b8',
  inprogress: '#d97706',
  review: '#7c3aed',
  done: '#16a34a',
  blocked: '#dc2626',
}

export const STATUS_EMOJI: Record<Status, string> = {
  todo: '📋',
  inprogress: '🔄',
  review: '🔍',
  done: '✅',
  blocked: '🚫',
}

export const PRIORITY_CONF: Record<Priority, { color: string; label: string }> = {
  critical: { color: '#dc2626', label: '🔴 Critical' },
  high:     { color: '#f59e0b', label: '🟠 High' },
  medium:   { color: '#3b82f6', label: '🔵 Medium' },
  low:      { color: '#9ca3af', label: '⚪ Low' },
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
