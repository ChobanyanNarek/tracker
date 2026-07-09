import { useMemo, useState } from 'react'
import { useStore } from '../../store'
import { computeTeamPerformance } from '../../utils/performance'
import type { IssuePerf, Verdict, PerfRange } from '../../utils/performance'
import type { Developer } from '../../types'
import { fmtWorkHours, tzDateTimeLabel, resolveTrackerTz } from '../../utils/working-hours'
import { hexRgb, initials } from '../../utils/format'
import { STATUS_LABEL, STATUS_COLOR } from '../../constants'

type RangeKey = 'month' | '30d' | 'quarter' | 'all'

const RANGE_LABELS: Record<RangeKey, string> = {
  month: 'This month',
  '30d': 'Last 30 days',
  quarter: 'Last 90 days',
  all: 'All time',
}

const VERDICT_CONF: Record<Verdict, { label: string; color: string; dim: string }> = {
  good:        { label: 'Good',        color: '#16a34a', dim: 'rgba(22,163,74,.12)' },
  mixed:       { label: 'Mixed',       color: '#d97706', dim: 'rgba(217,119,6,.12)' },
  bad:         { label: 'Bad',         color: '#dc2626', dim: 'rgba(220,38,38,.12)' },
  ongoing:     { label: 'In progress', color: '#2563eb', dim: 'rgba(37,99,235,.12)' },
  overdue:     { label: 'Overdue',     color: '#dc2626', dim: 'rgba(220,38,38,.12)' },
  insufficient:{ label: 'No data',     color: '#9aa0b8', dim: 'rgba(154,160,184,.12)' },
}

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
  return p >= 75 ? '#16a34a' : p >= 50 ? '#d97706' : '#dc2626'
}

// ─── Issue detail popup ───────────────────────────────────────────────────────
function PerfIssueModal({ issue, dev, tz, onClose }: { issue: IssuePerf; dev: Developer; tz: string; onClose: () => void }) {
  const why = (() => {
    switch (issue.verdict) {
      case 'good':   return 'Delivered on time and within the effort budget.'
      case 'bad':    return 'Delivered late and over the effort budget.'
      case 'mixed':  return issue.onTime
        ? 'Delivered on time, but the actual effort exceeded the available budget.'
        : 'Over the deadline, but the actual effort stayed within budget.'
      case 'ongoing': return 'Still in progress — not yet delivered (no PR / review).'
      case 'overdue': return 'Past the deadline and not yet delivered.'
      default:        return "No In-Progress status history is recorded for this issue, so it can't be scored."
    }
  })()

  const row = (label: string, value: React.ReactNode) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '4px 0', fontSize: 12 }}>
      <span style={{ color: 'var(--text3)' }}>{label}</span>
      <span style={{ color: 'var(--text)', fontFamily: 'var(--mono)', textAlign: 'right' }}>{value}</span>
    </div>
  )

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
              {issue.confidence === 'partial' && <span style={chip('#9aa0b8', 'rgba(154,160,184,.12)')}>partial data</span>}
              {issue.suspect && <span style={chip('#d97706', 'rgba(217,119,6,.12)')}>⚠ Jira updated late</span>}
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
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 6 }}>Times ({tz})</div>
            {row('Started (first In Progress)', issue.startMs ? tzDateTimeLabel(issue.startMs, tz) : '—')}
            {row('Effort (In Progress)', fmtWorkHours(issue.effortH))}
            {issue.blockedH > 0 && row('Blocked (excluded)', fmtWorkHours(issue.blockedH))}
            {row('Deadline', <>{tzDateTimeLabel(issue.deadlineMs, tz)}{issue.deadlineAssumed && <span style={{ color: '#d97706' }}> ⚠ assumed</span>}</>)}
            {issue.effectiveDeadlineMs !== issue.deadlineMs && row('Effective deadline (+blocked)', tzDateTimeLabel(issue.effectiveDeadlineMs, tz))}
            {row('Delivery (PR / review)', issue.deliveryMs ? `${tzDateTimeLabel(issue.deliveryMs, tz)}${issue.deliverySource === 'status' ? ' (status)' : ''}` : 'not delivered')}
            {issue.budgetH != null && row('Available budget', fmtWorkHours(issue.budgetH))}
            {issue.cycleH != null && row('Cycle (start→delivery)', fmtWorkHours(issue.cycleH))}
            {issue.deliveryDeltaH != null && row('Delivery vs deadline', <span style={{ color: issue.deliveryDeltaH <= 0 ? '#16a34a' : '#dc2626' }}>{fmtDelta(issue.deliveryDeltaH)}</span>)}
          </div>

          {issue.intervals.length > 0 && (
            <div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 6 }}>Status timeline</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {issue.intervals.map((iv, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: STATUS_COLOR[iv.status], flexShrink: 0 }} />
                    <span style={{ width: 90, color: 'var(--text2)', flexShrink: 0 }}>{STATUS_LABEL[iv.status]}</span>
                    <span style={{ fontFamily: 'var(--mono)', color: 'var(--text3)', flex: 1, minWidth: 0 }}>{tzDateTimeLabel(iv.startMs, tz)} → {tzDateTimeLabel(iv.endMs, tz)}</span>
                    <span style={{ fontFamily: 'var(--mono)', color: iv.workH > 0 ? 'var(--text)' : 'var(--text3)', flexShrink: 0 }}>{iv.workH > 0 ? fmtWorkHours(iv.workH) : '0h'}</span>
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
        {issue.suspect && <span title="PR pushed before first In Progress" style={{ color: '#d97706' }}> ⚠</span>}
      </span>
      <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', flexShrink: 0 }}>
        {issue.verdict === 'insufficient' ? (
          <span style={{ color: 'var(--text3)', fontStyle: 'italic' }}>no status history</span>
        ) : (
          <>
            effort {fmtWorkHours(issue.effortH)}
            {issue.blockedH > 0 && ` · blkd ${fmtWorkHours(issue.blockedH)}`}
            {issue.deliveryDeltaH != null && (
              <span style={{ color: issue.deliveryDeltaH <= 0 ? '#16a34a' : '#dc2626' }}> · {fmtDelta(issue.deliveryDeltaH)}</span>
            )}
            {issue.verdict === 'overdue' && issue.deliveryDeltaH == null && (
              <span style={{ color: '#dc2626' }}> · past deadline</span>
            )}
          </>
        )}
      </span>
    </button>
  )
}

// ─── Main view ────────────────────────────────────────────────────────────────
export default function PerformanceView() {
  const state = useStore()
  const setTrackerTimezone = useStore((s) => s.setTrackerTimezone)
  const selectedDev = useStore((s) => s.selectedDev)
  const [rangeKey, setRangeKey] = useState<RangeKey>('month')
  const [selected, setSelected] = useState<{ issue: IssuePerf; dev: Developer } | null>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [noDataExpanded, setNoDataExpanded] = useState<Record<string, boolean>>({})

  const team = useMemo(() => computeTeamPerformance(state, rangeBounds(rangeKey)), [state, rangeKey])

  // Filter to selected developer when one is chosen in the sidebar
  const visibleDevs = useMemo(
    () => selectedDev === 'ALL' ? team.devs : team.devs.filter((d) => d.dev.id === selectedDev),
    [team.devs, selectedDev],
  )

  const summaryCard = (label: string, value: string, color?: string, sub?: string) => (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: '7px 11px', flexShrink: 0 }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.6px', whiteSpace: 'nowrap' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: color ?? 'var(--text)', lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color, marginTop: 1, whiteSpace: 'nowrap' }}>{sub}</div>}
    </div>
  )

  const inProgressTotal = team.ongoingCount + team.overdueCount

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
        <label style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', flexShrink: 0 }}>TZ</label>
        <input
          type="text"
          value={state.trackerTimezone ?? ''}
          placeholder={resolveTrackerTz()}
          onChange={(e) => setTrackerTimezone(e.target.value.trim() || undefined)}
          title="Tracker timezone (IANA). Empty = browser zone."
          style={{ width: 130, minWidth: 80, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 11, padding: '3px 7px', borderRadius: 6, outline: 'none', flexShrink: 0 }}
        />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
        {/* team summary — horizontal scroll strip */}
        <div style={{ display: 'flex', gap: 7, overflowX: 'auto', paddingBottom: 4, flexShrink: 0 }}>
          {summaryCard('Scored', String(team.scoredCount))}
          {summaryCard('Good', String(team.goodCount), '#16a34a')}
          {summaryCard('Mixed', String(team.mixedCount), '#d97706')}
          {summaryCard('Bad', String(team.badCount), '#dc2626')}
          {inProgressTotal > 0 && summaryCard(
            'In progress',
            String(inProgressTotal),
            team.overdueCount > 0 ? '#dc2626' : '#2563eb',
            team.overdueCount > 0 ? `${team.overdueCount} overdue` : undefined,
          )}
          {summaryCard('On-time', pct(team.onTimePct))}
          {summaryCard('On-budget', pct(team.onBudgetPct))}
        </div>

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
                    <div style={{ fontSize: 20, fontWeight: 800, color: scoreColor(d.scorePct), lineHeight: 1 }}>{pct(d.scorePct)}</div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text3)' }}>good rate</div>
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

                {/* stats — row 1: key rates + counts */}
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text2)', alignItems: 'center' }}>
                  <span>On-time <b style={{ color: 'var(--text)' }}>{d.onTimeCount}/{d.scoredCount}</b> <span style={{ color: 'var(--text3)' }}>({pct(d.onTimePct)})</span></span>
                  <span style={{ color: 'var(--border)' }}>·</span>
                  <span>On-budget <b style={{ color: 'var(--text)' }}>{d.onBudgetCount}/{d.scoredCount}</b> <span style={{ color: 'var(--text3)' }}>({pct(d.onBudgetPct)})</span></span>
                  <span style={{ color: 'var(--border)' }}>·</span>
                  <span style={{ color: 'var(--text3)' }}>{d.scoredCount} scored</span>
                  {inProgressDev > 0 && <>
                    <span style={{ color: 'var(--border)' }}>·</span>
                    <span style={{ color: d.overdueCount > 0 ? '#dc2626' : '#2563eb' }}>
                      {inProgressDev} in-progress{d.overdueCount > 0 ? ` (${d.overdueCount} overdue)` : ''}
                    </span>
                  </>}
                  {noDataIssues.length > 0 && <>
                    <span style={{ color: 'var(--border)' }}>·</span>
                    <span style={{ color: 'var(--text3)' }}>{noDataIssues.length} no-data</span>
                  </>}
                </div>
                {/* stats — row 2: averages (only when scored data exists) */}
                {d.scoredCount > 0 && (
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>
                    {d.avgEffortH != null && <span>effort <b style={{ color: 'var(--text2)' }}>{fmtWorkHours(d.avgEffortH)}</b></span>}
                    {d.avgDeliveryDeltaH != null && <span>delivery <b style={{ color: d.avgDeliveryDeltaH <= 0 ? '#16a34a' : '#dc2626' }}>{fmtDelta(d.avgDeliveryDeltaH)}</b></span>}
                    {d.avgCycleH != null && <span>cycle <b style={{ color: 'var(--text2)' }}>{fmtWorkHours(d.avgCycleH)}</b></span>}
                    {d.avgBlockedH != null && d.avgBlockedH > 0 && <span>blocked <b style={{ color: '#d97706' }}>{fmtWorkHours(d.avgBlockedH)}</b></span>}
                  </div>
                )}
              </div>

              {/* issue rows */}
              {!isCollapsed && d.issues.length > 0 && (
                <div>
                  {/* active (scored + in-progress) */}
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

      {selected && <PerfIssueModal issue={selected.issue} dev={selected.dev} tz={team.tz} onClose={() => setSelected(null)} />}
    </div>
  )
}
