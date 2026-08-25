import { useState, useMemo, useRef, useCallback } from 'react'
import { useStore, getBoardScope, taskPassesBoardFilter, jiraOnBoard, getVisibleDevIds } from '../../store'
import { jiraDedupeKey, initials, hexRgb } from '../../utils/format'
import { todayStr, formatDate } from '../../utils/dates'
import type { Developer, Project, JiraIssue } from '../../types'
import DatePicker from '../ui/DatePicker'
import { resolveGroups } from '../../utils/status-groups'
import Icon from '../ui/Icon'

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
  flip?: boolean
  item: BarItem
  dev: Developer | undefined
  project: Project | undefined
}

// ── component ──────────────────────────────────────────────────────────────────

const LABEL_W = 160
const ROW_H = 44

export default function TimelineView() {
  const state = useStore()
  const { tasks, developers, projects, selectedDev, selectedProject, setView, setSelectedDate, jiraConnections } = state
  const boardScope = getBoardScope(state)
  const conn = jiraConnections?.[0]

  const today = todayStr()

  // ── toolbar state ──────────────────────────────────────────────────────────
  const [groupBy, setGroupBy] = useState<'dev' | 'project'>('dev')
  const zoom = 'week'
  const [showAll, setShowAll] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string[]>([])
  const [tooltip, setTooltip] = useState<Tooltip | null>(null)

  const defaultStart = addDays(today, -14)
  const defaultEnd   = addDays(today, 27)
  const [windowStart, setWindowStart] = useState(defaultStart)
  const [windowEnd,   setWindowEnd]   = useState(defaultEnd)

  const containerRef = useRef<HTMLDivElement>(null)

  const resetRange = useCallback(() => {
    setWindowStart(defaultStart)
    setWindowEnd(defaultEnd)
  }, [defaultStart, defaultEnd])

  // ── window ─────────────────────────────────────────────────────────────────
  const totalDays = Math.max(1, diffDays(windowStart, windowEnd) + 1)

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
          // update to latest task copy so tooltip shows current status/deadline
          if (taskStart >= existing.start) existing.issue = j
          // keep the latest deadline for bar end
          if (j.deadline && (!existing.end || j.deadline > existing.end)) existing.end = j.deadline
        }
      }
    }

    let result = Array.from(map.values())
    if (statusFilter.length > 0) {
      result = result.filter((b) => {
        const gid = b.issue.groupId ?? b.issue.status ?? 'todo'
        return statusFilter.includes(gid)
      })
    }
    return result
  }, [tasks, selectedDev, selectedProject, visibleDevIds, boardScope, showAll, statusFilter])

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

        {/* date range pickers */}
        <span style={{ color: 'var(--text3)', fontSize: 11 }}>From:</span>
        <DatePicker value={windowStart} onChange={(d) => { setWindowStart(d); if (d > windowEnd) setWindowEnd(d) }} maxDate={windowEnd} />
        <span style={{ color: 'var(--text3)', fontSize: 11 }}>To:</span>
        <DatePicker value={windowEnd} onChange={(d) => { setWindowEnd(d); if (d < windowStart) setWindowStart(d) }} minDate={windowStart} />
        <button
          onClick={resetRange}
          style={{ padding: '4px 10px', fontSize: 11, fontFamily: 'var(--mono)', background: 'transparent', color: 'var(--text3)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer' }}
        >
          Reset
        </button>

        {/* status filter chips */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          {resolveGroups(conn).map((g) => {
            const active = statusFilter.includes(g.id)
            return (
              <button
                key={g.id}
                onClick={() => setStatusFilter((prev) => active ? prev.filter((s) => s !== g.id) : [...prev, g.id])}
                style={{
                  padding: '3px 9px',
                  fontSize: 10,
                  fontFamily: 'var(--mono)',
                  fontWeight: 600,
                  borderRadius: 20,
                  border: `1px solid ${active ? 'var(--border2)' : 'var(--border)'}`,
                  background: active ? `var(--${g.color}-dim, var(--surface2))` : 'transparent',
                  color: active ? `var(--${g.color}, var(--text))` : 'var(--text3)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                {active && <span style={{ width: 5, height: 5, borderRadius: '50%', background: `var(--${g.color}, currentColor)`, flexShrink: 0 }} />}
                {g.label}
              </button>
            )
          })}
        </div>

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
            <Icon name="calendar" size={32} strokeWidth={1.5} style={{ opacity: 0.4 }} />
            <span style={{ fontSize: 13 }}>No issues with deadlines in this window</span>
            <span style={{ fontSize: 11, opacity: 0.7 }}>Toggle "Show all issues" or navigate to a different period</span>
          </div>
        ) : (
          <div style={{ minWidth: `${LABEL_W + 800}px` }}>

            {/* sticky header */}
            <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
              {/* month labels (week zoom only) */}
              {zoom === 'week' && (
                <div style={{ display: 'flex', height: 18, borderBottom: '1px solid var(--border)' }}>
                  <div style={{ width: LABEL_W, minWidth: LABEL_W, flexShrink: 0, borderRight: '1px solid var(--border)' }} />
                  <div style={{ flex: 1, position: 'relative' }}>
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
                </div>
              )}

              {/* day/week column headers */}
              <div style={{ display: 'flex', height: 28 }}>
                <div style={{ width: LABEL_W, minWidth: LABEL_W, flexShrink: 0, borderRight: '1px solid var(--border)' }} />
                <div style={{ flex: 1, position: 'relative' }}>
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
            </div>

            {/* rows — height expands to give each bar its own lane */}
            {rows.map((row) => {
              const visibleBars = row.bars.filter((b) => barGeometry(b) !== null)
              const totalRowH = Math.max(visibleBars.length, 1) * ROW_H
              return (
              <div
                key={row.key}
                style={{
                  display: 'flex',
                  borderBottom: '2px solid var(--border)',
                  height: totalRowH,
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

                  {/* sub-row dividers */}
                  {visibleBars.map((_, idx) => idx > 0 && (
                    <div key={idx} style={{ position: 'absolute', left: 0, right: 0, top: idx * ROW_H, height: 1, background: 'var(--border)', opacity: 0.5, pointerEvents: 'none' }} />
                  ))}

                  {/* bars — each in its own lane */}
                  {visibleBars.map((item, idx) => {
                    const geo = barGeometry(item)!
                    const dev = developers.find((d) => d.id === item.devId)
                    const proj = projects.find((p) =>
                      tasks.find((t) => t.devId === item.devId && (t.jiras ?? []).some((j) => jiraDedupeKey(j.url, j.name) === item.dedupeKey.split(':')[0]))?.projectId === p.id
                    )
                    const color = groupBy === 'dev' ? (dev?.color ?? row.color) : row.color
                    const rgb = hexRgb(color)
                    const issueName = item.issue.name || item.issue.url || 'Issue'
                    const BAR_H = ROW_H - 14
                    const topOffset = idx * ROW_H + (ROW_H - BAR_H) / 2

                    return (
                      <div
                        key={item.dedupeKey}
                        style={{
                          position: 'absolute',
                          left: `${geo.left}%`,
                          width: `${geo.width}%`,
                          top: topOffset,
                          height: BAR_H,
                          minHeight: 22,
                          borderRadius: 4,
                          background: `rgba(${rgb},0.15)`,
                          border: `1px solid rgba(${rgb},0.35)`,
                          borderLeftWidth: 3,
                          borderLeftColor: color,
                          display: 'flex',
                          alignItems: 'center',
                          paddingLeft: 6,
                          paddingRight: 4,
                          overflow: 'hidden',
                          cursor: 'pointer',
                          zIndex: 2,
                          boxSizing: 'border-box',
                        }}
                        onClick={() => {
                          setSelectedDate(item.start)
                          setView('daily')
                        }}
                        onMouseEnter={(e) => {
                          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                          const container = containerRef.current?.getBoundingClientRect()
                          const relTop = rect.top - (container?.top ?? 0)
                          const relBottom = rect.bottom - (container?.top ?? 0)
                          // show below bar; if near top of container show above instead
                          const y = relTop < 160 ? relBottom + 6 : relTop - 8
                          const flip = relTop < 160
                          setTooltip({ x: rect.left - (container?.left ?? 0) + rect.width / 2, y, item, dev, project: proj, flip })
                        }}
                        onMouseLeave={() => setTooltip(null)}
                      >
                        <span style={{ fontSize: 10, color, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', userSelect: 'none' }}>
                          {issueName}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
              )
            })}
          </div>
        )}

        {/* tooltip */}
        {tooltip && (
          <div
            style={{
              position: 'absolute',
              left: tooltip.x,
              top: tooltip.y,
              transform: tooltip.flip ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
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
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
              Start date: {formatDate(tooltip.item.start)}
            </div>
            {tooltip.item.issue.deadline && (
              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
                Due date: {formatDate(tooltip.item.issue.deadline)}
                {tooltip.item.issue.deadlineTime ? ` at ${tooltip.item.issue.deadlineTime}` : ''}
              </div>
            )}
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

