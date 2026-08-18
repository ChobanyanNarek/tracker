import { useState, useMemo, useRef } from 'react'
import { useStore, getBoardScope, taskPassesBoardFilter, jiraOnBoard, getVisibleDevIds } from '../../store'
import { jiraDedupeKey, initials, hexRgb } from '../../utils/format'
import { todayStr, formatDate } from '../../utils/dates'
import type { Developer, Project, JiraIssue } from '../../types'

// ── helpers ────────────────────────────────────────────────────────────────────

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

function diffDays(a: string, b: string): number {
  return Math.round(
    (new Date(b + 'T12:00:00').getTime() - new Date(a + 'T12:00:00').getTime()) / 86_400_000,
  )
}

function startOfWeek(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() - d.getDay() + 1) // Monday
  return d.toISOString().slice(0, 10)
}

function monthLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleString('default', { month: 'short', year: '2-digit' })
}

function dayLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  return String(d.getDate())
}

function weekLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  const end = new Date(d)
  end.setDate(end.getDate() + 6)
  const s = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`
  const e = `${String(end.getDate()).padStart(2, '0')}.${String(end.getMonth() + 1).padStart(2, '0')}`
  return `${s}–${e}`
}

// ── types ──────────────────────────────────────────────────────────────────────

interface BarItem {
  dedupeKey: string
  devId: string
  issue: JiraIssue
  start: string   // YYYY-MM-DD
  end: string     // YYYY-MM-DD (= deadline)
}

interface Tooltip {
  x: number
  y: number
  item: BarItem
  dev: Developer | undefined
  project: Project | undefined
}

// ── component ──────────────────────────────────────────────────────────────────

const LABEL_W = 160
const ROW_H = 44

export default function TimelineView() {
  const state = useStore()
  const { tasks, developers, projects, selectedDev, selectedProject } = state
  const boardScope = getBoardScope(state)

  const today = todayStr()

  // ── toolbar state ──────────────────────────────────────────────────────────
  const [groupBy, setGroupBy] = useState<'dev' | 'project'>('dev')
  const [zoom, setZoom] = useState<'week' | 'month'>('week')
  const [navOffset, setNavOffset] = useState(0)          // in units of zoom
  const [showAll, setShowAll] = useState(false)           // include issues without deadline
  const [tooltip, setTooltip] = useState<Tooltip | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)

  // ── window ─────────────────────────────────────────────────────────────────
  const totalDays = zoom === 'week' ? 42 : 90  // 6 weeks or ~3 months
  const windowStart = useMemo(() => {
    const pivot = zoom === 'week'
      ? addDays(today, navOffset * 42)
      : addDays(today, navOffset * 90)
    // center on today
    const offset = zoom === 'week' ? 14 : 30
    return addDays(pivot, -offset)
  }, [zoom, navOffset, today])
  const windowEnd = addDays(windowStart, totalDays - 1)

  // ── visible devIds ─────────────────────────────────────────────────────────
  const visibleDevIds = useMemo(() => {
    return getVisibleDevIds(state as Parameters<typeof getVisibleDevIds>[0])
  }, [state])

  // ── build bar items ────────────────────────────────────────────────────────
  const bars = useMemo<BarItem[]>(() => {
    const map = new Map<string, BarItem>()

    for (const task of tasks) {
      if (selectedDev !== 'ALL' && task.devId !== selectedDev) continue
      if (selectedProject !== 'ALL' && task.projectId !== selectedProject) continue
      if (!visibleDevIds.includes(task.devId)) continue
      if (!taskPassesBoardFilter(task, boardScope)) continue

      for (const j of task.jiras ?? []) {
        if (!jiraOnBoard(j, boardScope)) continue
        if (!showAll && !j.deadline) continue

        const dk = jiraDedupeKey(j.url, j.name) + ':' + task.devId
        const existing = map.get(dk)
        const taskStart = task.date

        if (!existing) {
          map.set(dk, {
            dedupeKey: dk,
            devId: task.devId,
            issue: j,
            start: taskStart,
            end: j.deadline || taskStart,
          })
        } else {
          // take min start
          if (taskStart < existing.start) existing.start = taskStart
          // keep deadline from the issue (same either way)
          if (j.deadline && (!existing.end || j.deadline > existing.end)) existing.end = j.deadline
        }
      }
    }

    return Array.from(map.values())
  }, [tasks, selectedDev, selectedProject, visibleDevIds, boardScope, showAll])

  // ── group rows ─────────────────────────────────────────────────────────────
  type RowKey = string
  interface Row {
    key: RowKey
    label: string
    color: string
    sublabel?: string
    bars: BarItem[]
  }

  const rows = useMemo<Row[]>(() => {
    if (groupBy === 'dev') {
      return visibleDevIds
        .map((devId) => {
          const dev = developers.find((d) => d.id === devId)
          if (!dev) return null
          return {
            key: devId,
            label: dev.name,
            color: dev.color,
            bars: bars.filter((b) => b.devId === devId),
          }
        })
        .filter(Boolean) as Row[]
    } else {
      const projectSet = selectedProject !== 'ALL'
        ? [projects.find((p) => p.id === selectedProject)].filter(Boolean) as Project[]
        : projects.filter((p) => p.members.some((m) => visibleDevIds.includes(m)))

      return projectSet.map((proj) => {
        const projDevIds = proj.members.filter((m) => visibleDevIds.includes(m))
        return {
          key: proj.id,
          label: proj.name,
          color: proj.color,
          bars: bars.filter((b) => projDevIds.includes(b.devId)),
        }
      })
    }
  }, [groupBy, visibleDevIds, developers, projects, selectedProject, bars])

  // ── header columns ─────────────────────────────────────────────────────────
  const columns = useMemo<{ date: string; label: string; isMonth?: boolean }[]>(() => {
    if (zoom === 'week') {
      // day columns
      return Array.from({ length: totalDays }, (_, i) => {
        const d = addDays(windowStart, i)
        return { date: d, label: dayLabel(d) }
      })
    } else {
      // week columns (Mondays)
      const cols: { date: string; label: string }[] = []
      let cursor = startOfWeek(windowStart)
      while (cursor <= windowEnd) {
        cols.push({ date: cursor, label: weekLabel(cursor) })
        cursor = addDays(cursor, 7)
      }
      return cols
    }
  }, [zoom, windowStart, windowEnd, totalDays])

  // ── today line position ────────────────────────────────────────────────────
  const todayPct = useMemo(() => {
    if (today < windowStart || today > windowEnd) return null
    return (diffDays(windowStart, today) / totalDays) * 100
  }, [today, windowStart, windowEnd, totalDays])

  // ── bar geometry ───────────────────────────────────────────────────────────
  function barGeometry(item: BarItem): { left: number; width: number } | null {
    const s = item.start < windowStart ? windowStart : item.start
    const e = item.end > windowEnd ? windowEnd : item.end
    if (s > windowEnd || e < windowStart) return null
    const left = (diffDays(windowStart, s) / totalDays) * 100
    const width = ((diffDays(s, e) + 1) / totalDays) * 100
    return { left: Math.max(0, left), width: Math.min(width, 100 - Math.max(0, left)) }
  }

  function colPct(date: string): number {
    return (diffDays(windowStart, date) / totalDays) * 100
  }

  function colWidth(): number {
    return zoom === 'week'
      ? (1 / totalDays) * 100
      : (7 / totalDays) * 100
  }

  const isEmpty = bars.length === 0

  // ── month markers for week zoom ────────────────────────────────────────────
  const monthMarkers = useMemo(() => {
    if (zoom !== 'week') return []
    const markers: { date: string; label: string }[] = []
    let lastMonth = ''
    for (let i = 0; i < totalDays; i++) {
      const d = addDays(windowStart, i)
      const m = d.slice(0, 7)
      if (m !== lastMonth) {
        markers.push({ date: d, label: monthLabel(d) })
        lastMonth = m
      }
    }
    return markers
  }, [zoom, windowStart, totalDays])

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: 'var(--mono)', fontSize: 12 }}>

      {/* toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0, flexWrap: 'wrap' }}>
        {/* group-by toggle */}
        <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
          {(['dev', 'project'] as const).map((g) => (
            <button
              key={g}
              onClick={() => setGroupBy(g)}
              style={{
                padding: '4px 10px',
                fontSize: 11,
                fontFamily: 'var(--mono)',
                background: groupBy === g ? 'var(--accent)' : 'transparent',
                color: groupBy === g ? '#fff' : 'var(--text)',
                border: 'none',
                cursor: 'pointer',
                fontWeight: groupBy === g ? 600 : 400,
              }}
            >
              By {g === 'dev' ? 'Dev' : 'Project'}
            </button>
          ))}
        </div>

        {/* zoom toggle */}
        <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
          {(['week', 'month'] as const).map((z) => (
            <button
              key={z}
              onClick={() => { setZoom(z); setNavOffset(0) }}
              style={{
                padding: '4px 10px',
                fontSize: 11,
                fontFamily: 'var(--mono)',
                background: zoom === z ? 'var(--accent)' : 'transparent',
                color: zoom === z ? '#fff' : 'var(--text)',
                border: 'none',
                cursor: 'pointer',
                fontWeight: zoom === z ? 600 : 400,
              }}
            >
              {z === 'week' ? 'Week' : 'Month'}
            </button>
          ))}
        </div>

        {/* nav */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button onClick={() => setNavOffset((n) => n - 1)} style={navBtnStyle}>‹</button>
          <button onClick={() => setNavOffset(0)} style={{ ...navBtnStyle, fontSize: 10, padding: '4px 8px' }}>Today</button>
          <button onClick={() => setNavOffset((n) => n + 1)} style={navBtnStyle}>›</button>
        </div>

        {/* date range label */}
        <span style={{ color: 'var(--text3)', fontSize: 11 }}>
          {formatDate(windowStart)} – {formatDate(windowEnd)}
        </span>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', color: 'var(--text3)', fontSize: 11 }}>
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} style={{ accentColor: 'var(--accent)' }} />
            Show all issues
          </label>
        </div>
      </div>

      {/* grid area */}
      <div style={{ flex: 1, overflow: 'auto', position: 'relative' }} ref={containerRef}>
        {isEmpty ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 8, color: 'var(--text3)' }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity={0.4}>
              <rect x="3" y="4" width="18" height="18" rx="2"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
            </svg>
            <span style={{ fontSize: 13 }}>No issues with deadlines in this window</span>
            <span style={{ fontSize: 11, opacity: 0.7 }}>Toggle "Show all issues" or navigate to a different period</span>
          </div>
        ) : (
          <div style={{ minWidth: `${LABEL_W + 800}px` }}>

            {/* sticky header */}
            <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
              {/* month labels (week zoom only) */}
              {zoom === 'week' && (
                <div style={{ display: 'flex', marginLeft: LABEL_W, position: 'relative', height: 18, borderBottom: '1px solid var(--border)' }}>
                  {monthMarkers.map((m) => (
                    <div
                      key={m.date}
                      style={{
                        position: 'absolute',
                        left: `${colPct(m.date)}%`,
                        top: 0,
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        paddingLeft: 4,
                        color: 'var(--text3)',
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: '0.05em',
                        textTransform: 'uppercase',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {m.label}
                    </div>
                  ))}
                </div>
              )}

              {/* day/week column headers */}
              <div style={{ display: 'flex', height: 28, position: 'relative', marginLeft: LABEL_W }}>
                {columns.map((col) => {
                  const isToday = col.date === today
                  const isWeekend = zoom === 'week' ? (() => {
                    const dow = new Date(col.date + 'T12:00:00').getDay()
                    return dow === 0 || dow === 6
                  })() : false
                  return (
                    <div
                      key={col.date}
                      style={{
                        position: 'absolute',
                        left: `${colPct(col.date)}%`,
                        width: `${colWidth()}%`,
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 10,
                        color: isToday ? 'var(--accent)' : isWeekend ? 'var(--text3)' : 'var(--text2)',
                        fontWeight: isToday ? 700 : 400,
                        borderLeft: '1px solid var(--border)',
                        background: isWeekend ? 'rgba(0,0,0,0.03)' : 'transparent',
                        overflow: 'hidden',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {col.label}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* rows */}
            {rows.map((row) => (
              <div
                key={row.key}
                style={{
                  display: 'flex',
                  borderBottom: '1px solid var(--border)',
                  minHeight: ROW_H,
                  position: 'relative',
                }}
              >
                {/* left label */}
                <div
                  style={{
                    width: LABEL_W,
                    minWidth: LABEL_W,
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 7,
                    padding: '6px 10px',
                    borderRight: '1px solid var(--border)',
                    position: 'sticky',
                    left: 0,
                    background: 'var(--surface)',
                    zIndex: 2,
                  }}
                >
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      background: `rgba(${hexRgb(row.color)},0.18)`,
                      border: `2px solid ${row.color}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 10,
                      fontWeight: 700,
                      color: row.color,
                      flexShrink: 0,
                      letterSpacing: '0.04em',
                    }}
                  >
                    {initials(row.label)}
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {row.label}
                  </span>
                </div>

                {/* bar area */}
                <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                  {/* weekend / column shading */}
                  {zoom === 'week' && columns.map((col) => {
                    const dow = new Date(col.date + 'T12:00:00').getDay()
                    if (dow !== 0 && dow !== 6) return null
                    return (
                      <div
                        key={col.date}
                        style={{
                          position: 'absolute',
                          left: `${colPct(col.date)}%`,
                          width: `${colWidth()}%`,
                          top: 0,
                          bottom: 0,
                          background: 'rgba(0,0,0,0.04)',
                          pointerEvents: 'none',
                        }}
                      />
                    )
                  })}

                  {/* today line */}
                  {todayPct !== null && (
                    <div
                      style={{
                        position: 'absolute',
                        left: `${todayPct}%`,
                        top: 0,
                        bottom: 0,
                        width: 2,
                        background: 'var(--red, #ef4444)',
                        opacity: 0.7,
                        zIndex: 3,
                        pointerEvents: 'none',
                      }}
                    />
                  )}

                  {/* bars */}
                  {row.bars.map((item, idx) => {
                    const geo = barGeometry(item)
                    if (!geo) return null
                    const dev = developers.find((d) => d.id === item.devId)
                    const proj = projects.find((p) =>
                      tasks.find((t) => t.devId === item.devId && (t.jiras ?? []).some((j) => jiraDedupeKey(j.url, j.name) === item.dedupeKey.split(':')[0]))?.projectId === p.id
                    )
                    const color = groupBy === 'dev' ? (dev?.color ?? row.color) : row.color
                    const rgb = hexRgb(color)
                    const issueName = item.issue.name || item.issue.url || 'Issue'
                    const topOffset = 6 + idx * (ROW_H - 12) / Math.max(row.bars.length, 1)

                    return (
                      <div
                        key={item.dedupeKey}
                        style={{
                          position: 'absolute',
                          left: `${geo.left}%`,
                          width: `${geo.width}%`,
                          top: topOffset,
                          height: ROW_H - 14,
                          minHeight: 22,
                          borderRadius: 4,
                          background: `rgba(${rgb},0.15)`,
                          borderLeft: `3px solid ${color}`,
                          border: `1px solid rgba(${rgb},0.35)`,
                          borderLeftWidth: 3,
                          display: 'flex',
                          alignItems: 'center',
                          paddingLeft: 6,
                          paddingRight: 4,
                          overflow: 'hidden',
                          cursor: 'default',
                          zIndex: 2,
                          boxSizing: 'border-box',
                        }}
                        onMouseEnter={(e) => {
                          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                          const container = containerRef.current?.getBoundingClientRect()
                          setTooltip({
                            x: rect.left - (container?.left ?? 0) + rect.width / 2,
                            y: rect.top - (container?.top ?? 0) - 8,
                            item,
                            dev,
                            project: proj,
                          })
                        }}
                        onMouseLeave={() => setTooltip(null)}
                      >
                        <span style={{
                          fontSize: 10,
                          color: color,
                          fontWeight: 600,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          userSelect: 'none',
                        }}>
                          {issueName}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* tooltip */}
        {tooltip && (
          <div
            style={{
              position: 'absolute',
              left: tooltip.x,
              top: tooltip.y,
              transform: 'translate(-50%, -100%)',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '8px 12px',
              boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
              zIndex: 100,
              pointerEvents: 'none',
              minWidth: 180,
              maxWidth: 280,
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--text)', marginBottom: 4, wordBreak: 'break-word' }}>
              {tooltip.item.issue.name || tooltip.item.issue.url || 'Issue'}
            </div>
            {tooltip.dev && (
              <div style={{ color: tooltip.dev.color, fontSize: 11, marginBottom: 2 }}>
                {tooltip.dev.name}
              </div>
            )}
            {tooltip.item.issue.deadline && (
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                Deadline: {formatDate(tooltip.item.issue.deadline)}
                {tooltip.item.issue.deadlineTime ? ` at ${tooltip.item.issue.deadlineTime}` : ''}
              </div>
            )}
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
              Start: {formatDate(tooltip.item.start)}
            </div>
            {tooltip.item.issue.status && (
              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2, textTransform: 'capitalize' }}>
                Status: {tooltip.item.issue.groupId ?? tooltip.item.issue.status}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const navBtnStyle: React.CSSProperties = {
  padding: '4px 8px',
  fontSize: 13,
  fontFamily: 'var(--mono)',
  background: 'transparent',
  color: 'var(--text)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  cursor: 'pointer',
  lineHeight: 1,
}
