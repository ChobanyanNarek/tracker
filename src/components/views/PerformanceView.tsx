import { useMemo, useState } from 'react'
import { useStore } from '../../store'
import { computeTeamPerformance } from '../../utils/performance'
import type { IssuePerf, DevPerf, Verdict, PerfRange } from '../../utils/performance'
import type { Developer } from '../../types'
import { fmtWorkHours, tzDateTimeLabel } from '../../utils/working-hours'
import { hexRgb, initials } from '../../utils/format'
import { STATUS_LABEL, STATUS_COLOR } from '../../constants'

type RangeKey = 'month' | '30d' | 'quarter' | 'all'

const RANGE_LABELS: Record<RangeKey, string> = {
  month: 'This month',
  '30d': 'Last 30 days',
  quarter: 'Last 90 days',
  all: 'All time',
}

const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone

const VERDICT_CONF: Record<Verdict, { label: string; color: string; dim: string }> = {
  great:        { label: 'Great',             color: '#16a34a', dim: 'rgba(22,163,74,.12)' },
  onTimeBlocky: { label: 'On time · blocked', color: '#0891b2', dim: 'rgba(8,145,178,.12)' },
  lateSolid:    { label: 'Late · solid work', color: '#d97706', dim: 'rgba(217,119,6,.12)' },
  lateBlocky:   { label: 'Late · blocked',    color: '#dc2626', dim: 'rgba(220,38,38,.12)' },
  ongoing:      { label: 'In progress',       color: '#2563eb', dim: 'rgba(37,99,235,.12)' },
  overdue:      { label: 'Overdue',           color: '#dc2626', dim: 'rgba(220,38,38,.12)' },
  insufficient: { label: 'No data',           color: '#9aa0b8', dim: 'rgba(154,160,184,.12)' },
}

const GREEN = '#16a34a'
const AMBER = '#d97706'
const RED = '#dc2626'
const BLUE = '#2563eb'

function pad2(n: number): string { return String(n).padStart(2, '0') }
function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}
function rangeBounds(key: RangeKey): PerfRange {
  const now = new Date()
  const to = localDateStr(now)
  if (key === 'all') return {}
  if (key === 'month') return { from: `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-01`, to }
  const from = new Date(now)
  from.setDate(from.getDate() - (key === '30d' ? 30 : 90))
  return { from: localDateStr(from), to }
}

function fmtDelta(h: number | null): string {
  if (h == null) return '—'
  if (Math.abs(h) < 0.1) return 'on time'
  return `${fmtWorkHours(Math.abs(h))} ${h < 0 ? 'early' : 'late'}`
}
function pct(n: number | null): string { return n == null ? '—' : `${Math.round(n)}%` }

const chip = (color: string, dim: string): React.CSSProperties => ({
  fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700, padding: '1px 7px',
  borderRadius: 5, background: dim, color, border: `1px solid ${color}`, whiteSpace: 'nowrap',
  display: 'inline-block',
})

function VerdictChip({ verdict }: { verdict: Verdict }) {
  const c = VERDICT_CONF[verdict]
  return <span style={chip(c.color, c.dim)}>{c.label}</span>
}

function scoreColor(p: number | null): string {
  if (p == null) return 'var(--text3)'
  return p >= 75 ? GREEN : p >= 50 ? AMBER : RED
}

// ─── Chart primitives ─────────────────────────────────────────────────────────

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rl)', padding: '11px 13px', minWidth: 0 }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 9 }}>{title}</div>
      {children}
    </div>
  )
}

interface BarRowDatum { key: string; label: string; value: number; display: string; color?: string; title?: string }

/** Horizontal bar list — thin bars, rounded data-end, value at the tip. */
function HBars({ rows, color, labelWidth = 84 }: { rows: BarRowDatum[]; color: string; labelWidth?: number }) {
  const max = Math.max(...rows.map((r) => r.value), 1e-9)
  if (!rows.length) return <div style={{ fontSize: 11, color: 'var(--text3)', fontStyle: 'italic' }}>No data</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {rows.map((r) => (
        <div key={r.key} title={r.title ?? `${r.label}: ${r.display}`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: labelWidth, flexShrink: 0, fontSize: 11, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: `${Math.max((r.value / max) * 100, 1)}%`, maxWidth: 'calc(100% - 44px)', height: 13, background: r.color ?? color, borderRadius: '0 4px 4px 0', flexShrink: 0 }} />
            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text2)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{r.display}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

/** Stacked productive-vs-blocked bar per row, with a shared legend. */
function FlowBars({ rows, labelWidth = 84 }: { rows: Array<{ key: string; label: string; effortH: number; blockedH: number }>; labelWidth?: number }) {
  const visible = rows.filter((r) => r.effortH + r.blockedH > 1e-9)
  if (!visible.length) return <div style={{ fontSize: 11, color: 'var(--text3)', fontStyle: 'italic' }}>No tracked time</div>
  const max = Math.max(...visible.map((r) => r.effortH + r.blockedH))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {visible.map((r) => {
        const total = r.effortH + r.blockedH
        const effPct = (r.effortH / total) * 100
        return (
          <div key={r.key} title={`${r.label}: productive ${fmtWorkHours(r.effortH)}, blocked ${fmtWorkHours(r.blockedH)} (${Math.round(effPct)}% productive)`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: labelWidth, flexShrink: 0, fontSize: 11, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: `${(total / max) * 100}%`, maxWidth: 'calc(100% - 44px)', height: 13, display: 'flex', gap: 2, flexShrink: 0 }}>
                {r.effortH > 0 && <div style={{ width: `${effPct}%`, background: GREEN, borderRadius: r.blockedH > 0 ? 0 : '0 4px 4px 0' }} />}
                {r.blockedH > 0 && <div style={{ flex: 1, background: AMBER, borderRadius: '0 4px 4px 0' }} />}
              </div>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text2)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{Math.round(effPct)}%</span>
            </div>
          </div>
        )
      })}
      <div style={{ display: 'flex', gap: 12, marginTop: 2 }}>
        {[[GREEN, 'Productive'], [AMBER, 'Blocked']].map(([c, l]) => (
          <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--text3)' }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: c }} />{l}
          </span>
        ))}
      </div>
    </div>
  )
}

/** Diverging columns: above the baseline = late (red), below = early (green). */
function DeltaChart({ issues }: { issues: IssuePerf[] }) {
  const pts = issues
    .filter((i) => i.deliveryDeltaH != null && i.deliveryMs != null)
    .sort((a, b) => a.deliveryMs! - b.deliveryMs!)
    .slice(-20)
  if (!pts.length) return <div style={{ fontSize: 11, color: 'var(--text3)', fontStyle: 'italic' }}>No delivered issues yet</div>
  const maxAbs = Math.max(...pts.map((p) => Math.abs(p.deliveryDeltaH!)), 0.5)
  const H = 108
  const half = H / 2 - 6
  return (
    <div>
      <div style={{ position: 'relative', height: H, display: 'flex', alignItems: 'stretch', gap: 3 }}>
        <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', height: 1, background: 'var(--border)' }} />
        {pts.map((p) => {
          const d = p.deliveryDeltaH!
          const h = Math.max((Math.abs(d) / maxAbs) * half, 2)
          const late = d > 0.05
          const early = d < -0.05
          return (
            <div key={`${p.taskId}-${p.issueId ?? p.url}-${p.name}`} title={`${p.name} — ${fmtDelta(d)}`} style={{ flex: 1, maxWidth: 22, position: 'relative', minWidth: 4 }}>
              {late && <div style={{ position: 'absolute', bottom: '50%', left: 0, right: 0, height: h, background: RED, borderRadius: '4px 4px 0 0' }} />}
              {early && <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: h, background: GREEN, borderRadius: '0 0 4px 4px' }} />}
              {!late && !early && <div style={{ position: 'absolute', top: 'calc(50% - 2px)', left: 0, right: 0, height: 4, background: 'var(--text3)', borderRadius: 2 }} />}
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5 }}>
        <span style={{ fontSize: 10, color: 'var(--text3)' }}>↑ late&ensp;·&ensp;↓ early&ensp;·&ensp;oldest → newest</span>
        {issues.filter((i) => i.deliveryDeltaH != null).length > 20 && (
          <span style={{ fontSize: 10, color: 'var(--text3)' }}>last 20 shown</span>
        )}
      </div>
    </div>
  )
}

// ─── Issue detail popup ───────────────────────────────────────────────────────
function PerfIssueModal({ issue, dev, onClose }: { issue: IssuePerf; dev: Developer; onClose: () => void }) {
  const why = (() => {
    switch (issue.verdict) {
      case 'great':        return 'Delivered on time with mostly productive working time.'
      case 'onTimeBlocky': return 'Delivered on time, but a large share of the tracked time was spent blocked.'
      case 'lateSolid':    return 'Delivered after the deadline, but the working time itself was productive — the deadline may have been unrealistic.'
      case 'lateBlocky':   return 'Delivered after the deadline with a large share of blocked time.'
      case 'ongoing':      return 'Still in progress — no MR push or review yet.'
      case 'overdue':      return 'Past the deadline with no delivery signal (no MR push, no review).'
      default:             return "Never marked In Progress, so effort can't be measured."
    }
  })()

  const row = (label: string, value: React.ReactNode) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '4px 0', fontSize: 12 }}>
      <span style={{ color: 'var(--text3)' }}>{label}</span>
      <span style={{ color: 'var(--text)', fontFamily: 'var(--mono)', textAlign: 'right' }}>{value}</span>
    </div>
  )

  const trackedH = issue.effortH + issue.blockedH

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rl)', width: '100%', maxWidth: 560, maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '14px 18px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>{issue.name}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <VerdictChip verdict={issue.verdict} />
              <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>{dev.name}</span>
              {issue.reworkCount > 0 && <span style={chip(AMBER, 'rgba(217,119,6,.12)')}>🔁 rework ×{issue.reworkCount}</span>}
              {issue.suspect && <span style={chip(AMBER, 'rgba(217,119,6,.12)')}>⚠ MR before In Progress</span>}
            </div>
          </div>
          <button onClick={onClose} className="icon-btn" style={{ fontSize: 16 }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {issue.url && <a className="elink jira" href={issue.url} target="_blank" rel="noreferrer" style={{ fontSize: 11 }}>🔗 Jira issue</a>}
            {issue.prUrls.map((u, i) => (
              <a key={u} className="elink" href={u} target="_blank" rel="noreferrer" style={{ fontSize: 11 }}>🦊 PR/MR{issue.prUrls.length > 1 ? ` #${i + 1}` : ''}</a>
            ))}
            {!issue.url && !issue.prUrls.length && <span style={{ fontSize: 11, color: 'var(--text3)', fontStyle: 'italic' }}>No external links</span>}
          </div>

          <div style={{ fontSize: 12, color: 'var(--text2)', background: VERDICT_CONF[issue.verdict].dim, border: `1px solid ${VERDICT_CONF[issue.verdict].color}`, borderRadius: 8, padding: '8px 11px' }}>{why}</div>

          <div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 6 }}>Timing (local time)</div>
            {row('Started (first In Progress)', issue.startMs ? tzDateTimeLabel(issue.startMs, LOCAL_TZ) : '—')}
            {row('Deadline', <>{tzDateTimeLabel(issue.deadlineMs, LOCAL_TZ)}{issue.deadlineAssumed && <span style={{ color: AMBER }}> ⚠ end of day assumed</span>}</>)}
            {row('Delivery (last MR push)', issue.deliveryMs ? `${tzDateTimeLabel(issue.deliveryMs, LOCAL_TZ)}${issue.deliverySource === 'status' ? ' (from status)' : ''}` : 'not delivered')}
            {issue.deliveryDeltaH != null && row('Delivery vs deadline', <span style={{ color: issue.deliveryDeltaH <= 0 ? GREEN : RED }}>{fmtDelta(issue.deliveryDeltaH)}</span>)}
          </div>

          <div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 6 }}>Work</div>
            {row('Actual work (In Progress)', fmtWorkHours(issue.effortH))}
            {row('Blocked (excluded from work)', trackedH > 1e-9
              ? `${fmtWorkHours(issue.blockedH)} (${Math.round((issue.blockedH / trackedH) * 100)}% of tracked)`
              : fmtWorkHours(issue.blockedH))}
            {issue.flowEffPct != null && row('Productive share', <span style={{ color: issue.flowEffPct >= 70 ? GREEN : AMBER }}>{pct(issue.flowEffPct)}</span>)}
            {issue.cycleH != null && row('Cycle (start → delivery)', fmtWorkHours(issue.cycleH))}
            {issue.reworkCount > 0 && row('Rework rounds', String(issue.reworkCount))}
          </div>

          {issue.intervals.length > 0 && (
            <div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 6 }}>Status timeline</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {issue.intervals.map((iv, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: STATUS_COLOR[iv.status], flexShrink: 0 }} />
                    <span style={{ width: 90, color: 'var(--text2)', flexShrink: 0 }}>{STATUS_LABEL[iv.status]}</span>
                    <span style={{ fontFamily: 'var(--mono)', color: 'var(--text3)', flex: 1, minWidth: 0 }}>{tzDateTimeLabel(iv.startMs, LOCAL_TZ)} → {tzDateTimeLabel(iv.endMs, LOCAL_TZ)}</span>
                    <span style={{ fontFamily: 'var(--mono)', color: iv.workH > 0 ? 'var(--text)' : 'var(--text3)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{iv.workH > 0 ? fmtWorkHours(iv.workH) : '0h'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Issue row ────────────────────────────────────────────────────────────────
function IssueRow({ issue, onClick, dim }: { issue: IssuePerf; onClick: () => void; dim?: boolean }) {
  const isOverdue = issue.verdict === 'overdue'
  const trackedH = issue.effortH + issue.blockedH
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 9,
        padding: '7px 14px', background: isOverdue ? 'rgba(220,38,38,.04)' : 'none',
        border: 'none', borderTop: '1px solid var(--border)',
        cursor: 'pointer', transition: 'background .12s', opacity: dim ? 0.6 : 1,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = isOverdue ? 'rgba(220,38,38,.08)' : 'var(--surface2)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = isOverdue ? 'rgba(220,38,38,.04)' : 'none' }}
    >
      <VerdictChip verdict={issue.verdict} />
      <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {issue.name}
        {issue.reworkCount > 0 && <span title={`Went back to In Progress ${issue.reworkCount}× after review`} style={{ color: AMBER }}> 🔁{issue.reworkCount}</span>}
        {issue.suspect && <span title="MR pushed before first In Progress — status history may be incomplete" style={{ color: AMBER }}> ⚠</span>}
      </span>
      <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', flexShrink: 0 }}>
        {issue.verdict === 'insufficient' ? (
          <span style={{ color: 'var(--text3)', fontStyle: 'italic' }}>no status history</span>
        ) : (
          <>
            work {fmtWorkHours(issue.effortH)}
            {issue.blockedH > 0.05 && trackedH > 1e-9 && ` · blkd ${fmtWorkHours(issue.blockedH)} (${Math.round((issue.blockedH / trackedH) * 100)}%)`}
            {issue.deliveryDeltaH != null && (
              <span style={{ color: issue.deliveryDeltaH <= 0 ? GREEN : RED }}> · {fmtDelta(issue.deliveryDeltaH)}</span>
            )}
            {issue.verdict === 'overdue' && (
              <span style={{ color: RED }}> · past deadline</span>
            )}
            {issue.verdict === 'ongoing' && (
              <span style={{ color: BLUE }}> · not delivered yet</span>
            )}
          </>
        )}
      </span>
    </button>
  )
}

// ─── Per-developer charts (collapsed by default) ──────────────────────────────
function DevCharts({ d }: { d: DevPerf }) {
  const delivered = d.issues.filter((i) => i.deliveryDeltaH != null)
  const recentCycle = d.issues
    .filter((i) => i.cycleH != null && i.deliveryMs != null)
    .sort((a, b) => b.deliveryMs! - a.deliveryMs!)
    .slice(0, 12)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10, padding: '10px 14px', borderTop: '1px solid var(--border)', background: 'var(--surface2)' }}>
      <ChartCard title="Delivery vs deadline">
        <DeltaChart issues={delivered} />
      </ChartCard>
      <ChartCard title={`Cycle time per issue${recentCycle.length === 12 ? ' (last 12)' : ''}`}>
        <HBars
          color={BLUE}
          labelWidth={110}
          rows={recentCycle.map((i) => ({
            key: `${i.taskId}-${i.issueId ?? i.url}-${i.name}`,
            label: i.name,
            value: i.cycleH!,
            display: fmtWorkHours(i.cycleH!),
            color: VERDICT_CONF[i.verdict].color,
            title: `${i.name}: cycle ${fmtWorkHours(i.cycleH!)}, work ${fmtWorkHours(i.effortH)} — ${VERDICT_CONF[i.verdict].label}`,
          }))}
        />
      </ChartCard>
      <ChartCard title="Productive vs blocked">
        <FlowBars rows={[{ key: d.dev.id, label: 'Total', effortH: d.effortTotalH, blockedH: d.blockedTotalH }]} labelWidth={40} />
      </ChartCard>
    </div>
  )
}

// ─── Main view ────────────────────────────────────────────────────────────────
export default function PerformanceView() {
  const allDevelopers = useStore((s) => s.developers)
  const allTasks = useStore((s) => s.tasks)
  const schedule = useStore((s) => s.schedule)
  const scheduleHours = useStore((s) => s.scheduleHours)
  const selectedDev = useStore((s) => s.selectedDev)
  const selectedProject = useStore((s) => s.selectedProject)
  const projects = useStore((s) => s.projects)

  const proj = selectedProject !== 'ALL' ? projects.find((p) => p.id === selectedProject) : null
  const developers = proj ? allDevelopers.filter((d) => proj.members.includes(d.id)) : allDevelopers
  const tasks = proj ? allTasks.filter((t) => t.projectId === selectedProject) : allTasks

  const [rangeKey, setRangeKey] = useState<RangeKey>('month')
  const [selected, setSelected] = useState<{ issue: IssuePerf; dev: Developer } | null>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [chartsOpen, setChartsOpen] = useState<Record<string, boolean>>({})
  const [noDataExpanded, setNoDataExpanded] = useState<Record<string, boolean>>({})

  const team = useMemo(
    () => computeTeamPerformance({ developers, tasks, schedule, scheduleHours }, rangeBounds(rangeKey)),
    [developers, tasks, schedule, scheduleHours, rangeKey],
  )

  const visibleDevs = useMemo(
    () => selectedDev === 'ALL' ? team.devs : team.devs.filter((d) => d.dev.id === selectedDev),
    [team.devs, selectedDev],
  )

  const summaryCard = (label: string, value: string, color?: string, sub?: string) => (
    <div key={label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: '7px 11px', flexShrink: 0 }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.6px', whiteSpace: 'nowrap' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: color ?? 'var(--text)', lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color, marginTop: 1, whiteSpace: 'nowrap' }}>{sub}</div>}
    </div>
  )

  const inProgressTotal = team.ongoingCount + team.overdueCount
  const chartDevs = team.devs.filter((d) => d.issues.length > 0)

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', background: 'var(--surface)', borderBottom: '1px solid var(--border)', flexShrink: 0, overflowX: 'auto' }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.7px', flexShrink: 0 }}>Range</span>
        {(Object.keys(RANGE_LABELS) as RangeKey[]).map((k) => (
          <button
            key={k}
            onClick={() => setRangeKey(k)}
            style={{ fontFamily: 'var(--mono)', fontSize: 11, padding: '3px 10px', borderRadius: 12, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, border: `1px solid ${rangeKey === k ? 'var(--accent)' : 'var(--border)'}`, background: rangeKey === k ? 'var(--accent-dim)' : 'var(--surface2)', color: rangeKey === k ? 'var(--accent)' : 'var(--text2)', fontWeight: rangeKey === k ? 600 : 400 }}
          >
            {RANGE_LABELS[k]}
          </button>
        ))}
        <div style={{ flex: 1, minWidth: 12 }} />
        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', flexShrink: 0 }}>{LOCAL_TZ}</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
        {/* team summary strip */}
        <div style={{ display: 'flex', gap: 7, overflowX: 'auto', paddingBottom: 4, flexShrink: 0 }}>
          {summaryCard('Delivered', String(team.deliveredCount))}
          {summaryCard('On-time', pct(team.onTimePct), scoreColor(team.onTimePct))}
          {summaryCard('Productive share', pct(team.flowEffPct), team.flowEffPct != null && team.flowEffPct < 70 ? AMBER : GREEN)}
          {summaryCard('Avg cycle', team.avgCycleH != null ? fmtWorkHours(team.avgCycleH) : '—')}
          {summaryCard('Throughput', team.throughputWk != null ? `${(Math.round(team.throughputWk * 10) / 10)}/wk` : '—')}
          {summaryCard('Rework', pct(team.reworkRatePct), team.reworkRatePct != null && team.reworkRatePct > 25 ? AMBER : undefined)}
          {inProgressTotal > 0 && summaryCard(
            'In progress',
            String(inProgressTotal),
            team.overdueCount > 0 ? RED : BLUE,
            team.overdueCount > 0 ? `${team.overdueCount} overdue` : undefined,
          )}
        </div>

        {/* team comparison charts */}
        {selectedDev === 'ALL' && chartDevs.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10, flexShrink: 0 }}>
            <ChartCard title="Throughput — issues/week">
              <HBars
                color={BLUE}
                rows={chartDevs.filter((d) => d.throughputWk != null).map((d) => ({
                  key: d.dev.id, label: d.dev.name, value: d.throughputWk!,
                  display: `${Math.round(d.throughputWk! * 10) / 10}`,
                }))}
              />
            </ChartCard>
            <ChartCard title="Avg cycle time">
              <HBars
                color={BLUE}
                rows={chartDevs.filter((d) => d.avgCycleH != null).map((d) => ({
                  key: d.dev.id, label: d.dev.name, value: d.avgCycleH!,
                  display: fmtWorkHours(d.avgCycleH!),
                }))}
              />
            </ChartCard>
            <ChartCard title="Productive vs blocked time">
              <FlowBars rows={chartDevs.map((d) => ({ key: d.dev.id, label: d.dev.name, effortH: d.effortTotalH, blockedH: d.blockedTotalH }))} />
            </ChartCard>
            <ChartCard title="Rework rate">
              <HBars
                color={AMBER}
                rows={chartDevs.filter((d) => d.reworkRatePct != null).map((d) => ({
                  key: d.dev.id, label: d.dev.name, value: d.reworkRatePct!,
                  display: `${Math.round(d.reworkRatePct!)}%`,
                }))}
              />
            </ChartCard>
          </div>
        )}

        {team.devs.length === 0 && (
          <div style={{ textAlign: 'center', padding: '50px 20px', color: 'var(--text3)' }}>
            <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.35 }}>📊</div>
            <div style={{ fontSize: 14, color: 'var(--text2)' }}>No developers</div>
          </div>
        )}

        {/* per-developer blocks */}
        {visibleDevs.map((d) => {
          const rgb = hexRgb(d.dev.color)
          const isCollapsed = collapsed[d.dev.id]
          const showCharts = chartsOpen[d.dev.id] ?? false
          const activeIssues = d.issues.filter((i) => i.verdict !== 'insufficient')
          const noDataIssues = d.issues.filter((i) => i.verdict === 'insufficient')
          const ndExpanded = noDataExpanded[d.dev.id] ?? false
          const inProgressDev = d.ongoingCount + d.overdueCount

          return (
            <div key={d.dev.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rl)', overflow: 'hidden', flexShrink: 0 }}>
              {/* header */}
              <div style={{ padding: '11px 14px', borderBottom: d.issues.length && !isCollapsed ? '1px solid var(--border)' : undefined }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <div className="av" style={{ background: `rgba(${rgb},.15)`, color: d.dev.color, width: 28, height: 28, fontSize: 11, flexShrink: 0 }}>{initials(d.dev.name)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                      {d.dev.name} <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 400 }}>· {d.dev.role}</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text3)', fontStyle: 'italic' }}>{d.profile}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 20, fontWeight: 800, color: scoreColor(d.onTimePct), lineHeight: 1 }}>{pct(d.onTimePct)}</div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text3)' }}>on-time rate</div>
                  </div>
                  {d.issues.length > 0 && (
                    <button
                      onClick={() => setCollapsed((c) => ({ ...c, [d.dev.id]: !c[d.dev.id] }))}
                      className="icon-btn"
                      style={{ fontSize: 13 }}
                      title={isCollapsed ? 'Expand' : 'Collapse'}
                    >
                      {isCollapsed ? '▸' : '▾'}
                    </button>
                  )}
                </div>

                {/* stats — row 1: rates + counts */}
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text2)', alignItems: 'center' }}>
                  <span>Delivered <b style={{ color: 'var(--text)' }}>{d.deliveredCount}</b></span>
                  <span style={{ color: 'var(--border)' }}>·</span>
                  <span>On-time <b style={{ color: 'var(--text)' }}>{d.onTimeCount}/{d.deliveredCount}</b> <span style={{ color: 'var(--text3)' }}>({pct(d.onTimePct)})</span></span>
                  <span style={{ color: 'var(--border)' }}>·</span>
                  <span>Productive <b style={{ color: d.flowEffPct != null && d.flowEffPct < 70 ? AMBER : 'var(--text)' }}>{pct(d.flowEffPct)}</b></span>
                  {d.throughputWk != null && <>
                    <span style={{ color: 'var(--border)' }}>·</span>
                    <span>{Math.round(d.throughputWk * 10) / 10}/wk</span>
                  </>}
                  {d.reworkRatePct != null && d.reworkRatePct > 0 && <>
                    <span style={{ color: 'var(--border)' }}>·</span>
                    <span style={{ color: AMBER }}>rework {pct(d.reworkRatePct)}</span>
                  </>}
                  {inProgressDev > 0 && <>
                    <span style={{ color: 'var(--border)' }}>·</span>
                    <span style={{ color: d.overdueCount > 0 ? RED : BLUE }}>
                      {inProgressDev} in-progress{d.overdueCount > 0 ? ` (${d.overdueCount} overdue)` : ''}
                    </span>
                  </>}
                  {noDataIssues.length > 0 && <>
                    <span style={{ color: 'var(--border)' }}>·</span>
                    <span style={{ color: 'var(--text3)' }}>{noDataIssues.length} no-data</span>
                  </>}
                </div>
                {/* stats — row 2: averages (only when delivered data exists) */}
                {d.deliveredCount > 0 && (
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>
                    {d.avgEffortH != null && <span>avg work <b style={{ color: 'var(--text2)' }}>{fmtWorkHours(d.avgEffortH)}</b></span>}
                    {d.avgDeliveryDeltaH != null && <span>avg delivery <b style={{ color: d.avgDeliveryDeltaH <= 0 ? GREEN : RED }}>{fmtDelta(d.avgDeliveryDeltaH)}</b></span>}
                    {d.avgCycleH != null && <span>avg cycle <b style={{ color: 'var(--text2)' }}>{fmtWorkHours(d.avgCycleH)}</b></span>}
                    {d.avgBlockedH != null && d.avgBlockedH > 0.05 && <span>avg blocked <b style={{ color: AMBER }}>{fmtWorkHours(d.avgBlockedH)}</b></span>}
                  </div>
                )}
              </div>

              {/* charts toggle + issue rows */}
              {!isCollapsed && d.issues.length > 0 && (
                <div>
                  <button
                    onClick={() => setChartsOpen((s) => ({ ...s, [d.dev.id]: !showCharts }))}
                    style={{
                      width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8,
                      padding: '5px 14px', background: 'none', border: 'none', cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface2)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'none' }}
                  >
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--accent)' }}>
                      {showCharts ? '▾' : '▸'} Charts
                    </span>
                  </button>
                  {showCharts && <DevCharts d={d} />}

                  {/* measured issues */}
                  {activeIssues.map((issue) => (
                    <IssueRow
                      key={`${issue.taskId}-${issue.issueId ?? issue.url}-${issue.name}`}
                      issue={issue}
                      onClick={() => setSelected({ issue, dev: d.dev })}
                    />
                  ))}

                  {/* no-data section — collapsible */}
                  {noDataIssues.length > 0 && (
                    <>
                      <button
                        onClick={() => setNoDataExpanded((s) => ({ ...s, [d.dev.id]: !ndExpanded }))}
                        style={{
                          width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8,
                          padding: '5px 14px', background: 'none', border: 'none',
                          borderTop: '1px solid var(--border)', cursor: 'pointer',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface2)' }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'none' }}
                      >
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>
                          {ndExpanded ? '▾' : '▸'} {noDataIssues.length} issue{noDataIssues.length !== 1 ? 's' : ''} with no status history
                        </span>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text3)', marginLeft: 4 }}>
                          (click to {ndExpanded ? 'hide' : 'show'})
                        </span>
                      </button>
                      {ndExpanded && noDataIssues.map((issue) => (
                        <IssueRow
                          key={`${issue.taskId}-${issue.issueId ?? issue.url}-${issue.name}`}
                          issue={issue}
                          onClick={() => setSelected({ issue, dev: d.dev })}
                          dim
                        />
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {selected && <PerfIssueModal issue={selected.issue} dev={selected.dev} onClose={() => setSelected(null)} />}
    </div>
  )
}
