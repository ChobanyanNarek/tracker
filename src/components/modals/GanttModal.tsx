import { useState, useMemo, useEffect } from 'react'
import { useStore } from '../../store'
import type { Status } from '../../types'
import { STATUS_COLOR, STATUS_LABEL } from '../../constants'
import { formatDateMs } from '../../utils/dates'

// ── constants ─────────────────────────────────────────────────────────────────
const LABEL_W   = 260
const ROW_H     = 34
const HDR_H     = 40
const DEV_HDR_H = 28
const BAR_H     = 18
const MR_COLOR  = '#818cf8'
const DL_COLOR  = '#f43f5e'
const STATUSES: Status[] = ['todo', 'inprogress', 'review', 'done', 'blocked']

// ── helpers ───────────────────────────────────────────────────────────────────
function dayMs(iso: string): number {
  const s = iso.includes('T') ? iso : `${iso}T12:00:00`
  return new Date(s).getTime()
}
function addDays(ms: number, n: number): number { return ms + n * 86_400_000 }
function toIso(ms: number): string { return new Date(ms).toISOString().split('T')[0] }
function fmtDay(ms: number, _totalDays: number): string {
  return formatDateMs(ms)
}
function fmtMonth(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`
}

// ── data types ────────────────────────────────────────────────────────────────
interface Seg  { from: number; to: number; status: Status }
interface IRow {
  key: string; name: string; url: string
  devId: string; devName: string; devColor: string
  status: Status
  segments: Seg[]
  mrTimestamps: number[]
  deadlineMs?: number
}
interface DevGroup { devId: string; devName: string; devColor: string; rows: IRow[] }

// ── component ─────────────────────────────────────────────────────────────────
interface Props { onClose: () => void }

export default function GanttModal({ onClose }: Props) {
  const { tasks, developers } = useStore()
  const todayMs = dayMs(toIso(Date.now()))

  // Default: 30 days back, 7 days ahead so ongoing bars have room past today
  const [fromMs, setFromMs] = useState(() => addDays(todayMs, -29))
  const [toMs,   setToMs]   = useState(() => addDays(todayMs, 7))
  const [devFilter, setDevFilter]       = useState('ALL')
  const [statusFilter, setStatusFilter] = useState<Status[]>(['inprogress', 'review', 'done', 'blocked'])

  const totalMs   = Math.max(toMs - fromMs, 86_400_000)
  const totalDays = Math.round(totalMs / 86_400_000)

  // active (non-archived) developers
  const activeDevelopers = useMemo(() => developers.filter(d => !d.archivedAt), [developers])

  // ── build rows ──────────────────────────────────────────────────────────────
  const rows: IRow[] = useMemo(() => {
    const map = new Map<string, IRow>()

    for (const task of tasks) {
      if (!task.jiras?.length) continue
      const dev = developers.find(d => d.id === task.devId)
      // skip archived or missing developers
      if (!dev || dev.archivedAt) continue
      if (devFilter !== 'ALL' && task.devId !== devFilter) continue

      const taskStartMs = dayMs(task.date)

      for (const issue of task.jiras) {
        if (issue.hidden) continue
        const key = issue.issueId ?? issue.url ?? issue.name
        if (!key) continue

        let segs: Seg[] = []
        const hist = issue.statusHistory ?? []
        if (hist.length) {
          for (let i = 0; i < hist.length; i++) {
            const from = new Date(hist[i]!.at).getTime()
            const to   = i + 1 < hist.length
              ? new Date(hist[i + 1]!.at).getTime()
              : issue.status === 'done' ? from + 86_400_000 : addDays(todayMs, 7)
            segs.push({ from, to, status: hist[i]!.status })
          }
        } else {
          const DAY = 86_400_000
          let from = taskStartMs
          let to: number
          if (issue.status === 'done') {
            from = taskStartMs - DAY * 3
            to   = taskStartMs + DAY
          } else if (issue.status === 'inprogress' || issue.status === 'review') {
            from = taskStartMs - DAY * 5
            to   = addDays(todayMs, 7)
          } else if (issue.status === 'blocked') {
            from = taskStartMs - DAY * 2
            to   = addDays(todayMs, 7)
          } else {
            to = taskStartMs + DAY
          }
          segs = [{ from, to, status: issue.status }]
        }

        const mrTs = (issue.prs ?? [])
          .filter(p => p.url && p.date)
          .map(p => dayMs(p.date))

        const dlMs = issue.deadline ? dayMs(issue.deadline) : undefined

        const existing = map.get(key)
        if (existing) {
          mrTs.forEach(t => { if (!existing.mrTimestamps.includes(t)) existing.mrTimestamps.push(t) })
          if (segs.length > existing.segments.length) existing.segments = segs
          if (!existing.deadlineMs && dlMs) existing.deadlineMs = dlMs
        } else {
          map.set(key, {
            key, name: issue.name || key, url: issue.url,
            devId: task.devId, devName: dev.name, devColor: dev.color,
            status: issue.status, segments: segs,
            mrTimestamps: mrTs, deadlineMs: dlMs,
          })
        }
      }
    }

    return Array.from(map.values())
      .filter(r => statusFilter.includes(r.status))
      .filter(r => {
        const lo = Math.min(...r.segments.map(s => s.from))
        const hi = Math.max(...r.segments.map(s => s.to))
        return hi >= fromMs && lo <= toMs
      })
      .sort((a, b) => {
        if (a.devName !== b.devName) return a.devName.localeCompare(b.devName)
        return Math.min(...a.segments.map(s => s.from)) - Math.min(...b.segments.map(s => s.from))
      })
  }, [tasks, developers, devFilter, statusFilter, fromMs, toMs, todayMs])

  const groups: DevGroup[] = useMemo(() => {
    const gs: DevGroup[] = []
    for (const r of rows) {
      const last = gs[gs.length - 1]
      if (last?.devId === r.devId) last.rows.push(r)
      else gs.push({ devId: r.devId, devName: r.devName, devColor: r.devColor, rows: [r] })
    }
    return gs
  }, [rows])

  const tickInterval = totalDays <= 14 ? 1 : totalDays <= 35 ? 7 : totalDays <= 90 ? 14 : 30
  const ticks: number[] = []
  for (let d = 0; d <= totalDays; d += tickInterval) ticks.push(addDays(fromMs, d))

  const pct  = (ms: number) =>
    `${Math.max(0, Math.min(100, (ms - fromMs) / totalMs * 100)).toFixed(3)}%`
  const wPct = (a: number, b: number) =>
    `${Math.max(0, Math.min(100, (Math.min(b, toMs + 86_400_000) - Math.max(a, fromMs)) / totalMs * 100)).toFixed(3)}%`

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const toggleStatus = (s: Status) =>
    setStatusFilter(f => f.includes(s) ? f.filter(x => x !== s) : [...f, s])

  // Presets always show 7 days past today so ongoing bars have breathing room
  const setRange = (n: number) => { setFromMs(addDays(todayMs, -n)); setToMs(addDays(todayMs, 7)) }

  const chartMinPx = Math.max(600, totalDays * 26)

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2000,
      background: 'var(--surface)',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* ── toolbar ── */}
      <div style={{
        background: 'var(--surface)', borderBottom: '1px solid var(--border)',
        padding: '9px 16px', display: 'flex', alignItems: 'center',
        gap: 10, flexWrap: 'wrap', flexShrink: 0,
      }}>
        <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="3" rx="1"/><rect x="3" y="10.5" width="12" height="3" rx="1"/><rect x="3" y="17" width="15" height="3" rx="1"/>
          </svg>
          Timeline
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <input type="date" value={toIso(fromMs)}
            onChange={e => e.target.value && setFromMs(dayMs(e.target.value))}
            style={inputStyle} />
          <span style={{ color: 'var(--text3)', fontSize: 11 }}>→</span>
          <input type="date" value={toIso(toMs)}
            onChange={e => e.target.value && setToMs(dayMs(e.target.value))}
            style={inputStyle} />
        </div>

        <div style={{ display: 'flex', gap: 3 }}>
          {([6, 29, 89] as const).map((n, i) => (
            <button key={n} onClick={() => setRange(n)} style={presetStyle(
              (i === 0 && totalDays === 7) || (i === 1 && totalDays === 30) || (i === 2 && totalDays === 90)
            )}>
              {['7d', '30d', '90d'][i]}
            </button>
          ))}
        </div>

        <div style={{ width: 1, height: 18, background: 'var(--border)' }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.5px', fontFamily: 'var(--mono)', whiteSpace: 'nowrap' }}>Dev</span>
          <select value={devFilter} onChange={e => setDevFilter(e.target.value)} style={selectStyle}>
            <option value="ALL">All developers</option>
            {activeDevelopers.map(d => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>

        <div style={{ width: 1, height: 18, background: 'var(--border)' }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.5px', fontFamily: 'var(--mono)', whiteSpace: 'nowrap' }}>Status</span>
          {STATUSES.map(s => {
            const on = statusFilter.includes(s)
            return (
              <button key={s} onClick={() => toggleStatus(s)} style={{
                padding: '3px 9px', borderRadius: 5, fontSize: 10, cursor: 'pointer',
                fontFamily: 'var(--mono)', border: `1px solid ${on ? STATUS_COLOR[s] : 'var(--border)'}`,
                background: on ? STATUS_COLOR[s] + '22' : 'var(--surface2)',
                color: on ? STATUS_COLOR[s] : 'var(--text3)',
                transition: 'all .12s',
              }}>
                {STATUS_LABEL[s]}
              </button>
            )
          })}
        </div>

        <button onClick={onClose} style={{
          marginLeft: 'auto', background: 'none', border: 'none',
          color: 'var(--text3)', fontSize: 18, cursor: 'pointer', lineHeight: 1,
          padding: '2px 6px', borderRadius: 4,
        }}>✕</button>
      </div>

      {/* ── body — single scroll container ── */}
      <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
        {rows.length === 0 ? (
          <div style={{
            height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexDirection: 'column', gap: 10, color: 'var(--text3)', fontSize: 13,
          }}>
            <span style={{ fontSize: 32 }}>📭</span>
            <span>No issues match the current filters</span>
          </div>
        ) : (
          /* inner div wider than viewport — causes horizontal scroll on the outer */
          <div style={{ minWidth: LABEL_W + chartMinPx, display: 'flex', flexDirection: 'column' }}>

            {/* ── date header ── sticky top ── */}
            <div style={{
              display: 'flex', height: HDR_H,
              position: 'sticky', top: 0, zIndex: 10,
              flexShrink: 0,
            }}>
              {/* top-left corner: sticky left + sticky top */}
              <div style={{
                width: LABEL_W, minWidth: LABEL_W,
                background: 'var(--surface2)',
                borderRight: '1px solid var(--border)',
                borderBottom: '2px solid var(--border)',
                position: 'sticky', left: 0, zIndex: 20,
                flexShrink: 0,
              }} />
              {/* date ticks */}
              <div style={{
                flex: 1, position: 'relative',
                background: 'var(--surface2)',
                borderBottom: '2px solid var(--border)',
              }}>
                {ticks.map((t, i) => (
                  <div key={i} style={{
                    position: 'absolute', left: pct(t), top: 0, bottom: 0,
                    display: 'flex', flexDirection: 'column',
                  }}>
                    <span style={{
                      fontSize: tickInterval <= 1 ? 9 : 10,
                      color: 'var(--text3)', whiteSpace: 'nowrap',
                      padding: '5px 4px 0',
                      fontFamily: 'var(--mono)',
                    }}>
                      {tickInterval >= 28 ? fmtMonth(t) : fmtDay(t, totalDays)}
                    </span>
                    <div style={{ width: 1, height: 5, background: 'var(--border)', marginTop: 'auto' }} />
                  </div>
                ))}
                {todayMs >= fromMs && todayMs <= toMs && (
                  <div style={{
                    position: 'absolute', left: pct(todayMs), top: 0, bottom: 0,
                    width: 2, background: 'var(--accent)', opacity: 0.65,
                  }} />
                )}
              </div>
            </div>

            {/* ── group rows ── */}
            {groups.map(g => (
              <div key={g.devId}>
                {/* developer header row */}
                <div style={{ display: 'flex', height: DEV_HDR_H, flexShrink: 0 }}>
                  {/* sticky label */}
                  <div style={{
                    width: LABEL_W, minWidth: LABEL_W, flexShrink: 0,
                    position: 'sticky', left: 0, zIndex: 5,
                    background: `color-mix(in srgb, ${g.devColor} 10%, var(--surface))`,
                    borderRight: '1px solid var(--border)',
                    borderBottom: '1px solid var(--border)',
                    display: 'flex', alignItems: 'center',
                    padding: '0 12px', gap: 7,
                  }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: g.devColor, flexShrink: 0 }} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {g.devName}
                    </span>
                  </div>
                  {/* chart cell */}
                  <div style={{
                    flex: 1, position: 'relative', overflow: 'hidden',
                    background: g.devColor + '0d',
                    borderBottom: '1px solid var(--border)',
                  }}>
                    {ticks.map((t, i) => (
                      <div key={i} style={{ position: 'absolute', left: pct(t), top: 0, bottom: 0, width: 1, background: 'var(--border)', opacity: 0.4 }} />
                    ))}
                  </div>
                </div>

                {/* issue rows */}
                {g.rows.map(r => (
                  <div key={r.key} style={{ display: 'flex', height: ROW_H, flexShrink: 0 }}>
                    {/* sticky label */}
                    <div style={{
                      width: LABEL_W, minWidth: LABEL_W, flexShrink: 0,
                      position: 'sticky', left: 0, zIndex: 5,
                      background: 'var(--surface)',
                      borderRight: '1px solid var(--border)',
                      borderBottom: '1px solid var(--border)',
                      display: 'flex', alignItems: 'center',
                      padding: '0 10px 0 20px', gap: 6,
                      overflow: 'hidden',
                    }}>
                      <div style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_COLOR[r.status], flexShrink: 0 }} />
                      {r.url ? (
                        <a href={r.url} target="_blank" rel="noreferrer" title={r.name} style={{
                          fontSize: 11, color: 'var(--text2)', textDecoration: 'none',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
                        }}>{r.name}</a>
                      ) : (
                        <span title={r.name} style={{ fontSize: 11, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{r.name}</span>
                      )}
                    </div>

                    {/* chart cell */}
                    <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
                      {/* grid lines */}
                      {ticks.map((t, i) => (
                        <div key={i} style={{ position: 'absolute', left: pct(t), top: 0, bottom: 0, width: 1, background: 'var(--border)', opacity: 0.4 }} />
                      ))}
                      {/* today line */}
                      {todayMs >= fromMs && todayMs <= toMs && (
                        <div style={{ position: 'absolute', left: pct(todayMs), top: 0, bottom: 0, width: 2, background: 'var(--accent)', opacity: 0.3, zIndex: 1 }} />
                      )}
                      {/* status segments */}
                      {r.segments.map((seg, si) => {
                        const lo = Math.max(seg.from, fromMs)
                        const hi = Math.min(seg.to, toMs + 86_400_000)
                        if (hi <= lo) return null
                        return (
                          <div key={si} title={`${STATUS_LABEL[seg.status]}: ${formatDateMs(seg.from)} – ${formatDateMs(seg.to)}`} style={{
                            position: 'absolute',
                            left: pct(lo),
                            width: wPct(lo, hi),
                            top: (ROW_H - BAR_H) / 2,
                            height: BAR_H,
                            background: STATUS_COLOR[seg.status],
                            opacity: seg.status === 'todo' ? 0.35 : 0.78,
                            borderRadius: 4,
                            minWidth: 3,
                            zIndex: 2,
                          }} />
                        )
                      })}
                      {/* MR markers */}
                      {r.mrTimestamps.map((t, mi) => {
                        if (t < fromMs || t > toMs) return null
                        return (
                          <div key={mi} title={`MR submitted ${formatDateMs(t)}`} style={{
                            position: 'absolute',
                            left: pct(t),
                            top: (ROW_H - BAR_H) / 2 - 2,
                            transform: 'translateX(-50%) rotate(45deg)',
                            width: 10, height: 10,
                            background: MR_COLOR,
                            borderRadius: 2,
                            zIndex: 4,
                            boxShadow: '0 0 0 2px var(--bg)',
                          }} />
                        )
                      })}
                      {/* deadline */}
                      {r.deadlineMs && r.deadlineMs >= fromMs && r.deadlineMs <= toMs + 86_400_000 && (
                        <div title={`Deadline: ${formatDateMs(r.deadlineMs)}`} style={{
                          position: 'absolute',
                          left: pct(r.deadlineMs),
                          top: 2, bottom: 2, width: 2,
                          background: DL_COLOR,
                          borderRadius: 1,
                          zIndex: 4,
                        }} />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── legend ── */}
      <div style={{
        background: 'var(--surface)', borderTop: '1px solid var(--border)',
        padding: '7px 16px', display: 'flex', alignItems: 'center', gap: 16,
        flexShrink: 0, flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.6px', fontFamily: 'var(--mono)' }}>Legend</span>
        {STATUSES.map(s => (
          <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 18, height: 8, background: STATUS_COLOR[s], borderRadius: 2, opacity: 0.78 }} />
            <span style={{ fontSize: 10, color: 'var(--text3)' }}>{STATUS_LABEL[s]}</span>
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 10, height: 10, background: MR_COLOR, borderRadius: 2, transform: 'rotate(45deg)' }} />
          <span style={{ fontSize: 10, color: 'var(--text3)' }}>MR</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 2, height: 12, background: DL_COLOR, borderRadius: 1 }} />
          <span style={{ fontSize: 10, color: 'var(--text3)' }}>Deadline</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 2, height: 12, background: 'var(--accent)', borderRadius: 1 }} />
          <span style={{ fontSize: 10, color: 'var(--text3)' }}>Today</span>
        </div>
        <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>
          {rows.length} issue{rows.length !== 1 ? 's' : ''} · {totalDays + 1} days
        </span>
      </div>
    </div>
  )
}

// ── micro-styles ──────────────────────────────────────────────────────────────
const inputStyle: React.CSSProperties = {
  background: 'var(--surface2)', border: '1px solid var(--border)',
  color: 'var(--text)', borderRadius: 5, padding: '4px 7px',
  fontFamily: 'var(--mono)', fontSize: 11, outline: 'none',
}
const selectStyle: React.CSSProperties = { ...inputStyle, cursor: 'pointer' }

function presetStyle(active: boolean): React.CSSProperties {
  return {
    padding: '3px 9px', borderRadius: 5, fontSize: 10, cursor: 'pointer',
    fontFamily: 'var(--mono)', border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
    background: active ? 'rgba(99,179,237,.12)' : 'var(--surface2)',
    color: active ? 'var(--accent)' : 'var(--text3)',
    transition: 'all .12s',
  }
}
