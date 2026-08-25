import React from 'react'
import type { JiraIssue, Task } from '../../../types'

// ── shared button styles ──────────────────────────────────────────────────────

export const btnBase: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 500,
  padding: '5px 12px', borderRadius: 7, cursor: 'pointer', transition: 'var(--t)',
}

export type IssueRow = { j: JiraIssue; task: Task; devId: string }

export function fmtSeconds(s: number | undefined, hoursPerDay = 8): string {
  if (!s) return '—'
  const totalMin = Math.round(s / 60)
  const minPerDay = hoursPerDay * 60
  const d = Math.floor(totalMin / minPerDay)
  const rem = totalMin % minPerDay
  const h = Math.floor(rem / 60)
  const m = rem % 60
  const parts: string[] = []
  if (d > 0) parts.push(`${d}d`)
  if (h > 0) parts.push(`${h}h`)
  if (m > 0) parts.push(`${m}m`)
  return parts.length ? parts.join(' ') : '—'
}

export function genColId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

export const inputStyle: React.CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)',
  fontFamily: 'var(--mono)', fontSize: 11, padding: '3px 7px', borderRadius: 5, outline: 'none', width: '100%', boxSizing: 'border-box',
}
