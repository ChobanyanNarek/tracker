import { useState } from 'react'
import { useStore } from '../../store'
import { hexRgb, initials, getJiras } from '../../utils/format'

type SortKey = 'newest' | 'oldest' | 'most-late' | 'most-early' | 'most-tasks' | 'name'

const WORK_HOURS = 9 // 10:00–19:00 window

// Convert calendar hours to working hours (strip nights/weekends with simple approximation)
function calToWorkHours(calHours: number): number {
  if (calHours === 0) return 0
  const sign = calHours < 0 ? -1 : 1
  const remaining = Math.abs(calHours)
  const fullDays = Math.floor(remaining / 24)
  const leftover = remaining % 24
  return sign * (fullDays * WORK_HOURS + Math.min(leftover, WORK_HOURS))
}

function fmtDelta(wh: number): string {
  const abs = Math.abs(wh)
  if (abs < 1) return Math.round(abs * 60) + 'm'
  if (abs < WORK_HOURS) return Math.round(abs) + 'h'
  return (abs / WORK_HOURS).toFixed(1) + ' work days'
}

export default function PerformanceView() {
  const [sortKey, setSortKey] = useState<SortKey>('newest')

  const { developers: allDevelopers, tasks, projects, selectedDev, selectedProject } = useStore()
  const developers = allDevelopers.filter((d) => !d.archivedAt)

  interface TaskPerf {
    title: string
    date: string
    reviewDate: string
    reviewTime: string
    deadline: string
    deadlineTime: string
    projectId: string
    delta: number // working hours: positive = late, negative = early
  }

  interface DevPerf {
    dev: (typeof developers)[0]
    taskPerfs: TaskPerf[]
    avgDelta: number
    earlyCount: number
    lateCount: number
    earlyPct: number
    latePct: number
  }

  const allPerfData: DevPerf[] = developers.map((dev) => {
    const devTasks = tasks.filter(
      (t) => t.devId === dev.id && (selectedProject === 'ALL' || t.projectId === selectedProject),
    )
    const taskPerfs: TaskPerf[] = []
    const seen = new Set<string>()

    devTasks.forEach((t) => {
      const jiras = getJiras(t)
      const reviewItems: { reviewDate: string; reviewTime: string; deadline: string; deadlineTime: string; title: string; projectId: string; date: string; issueKey: string }[] =
        jiras.length
          ? jiras.flatMap((j) =>
              j.prs?.length
                ? j.prs.map((p) => ({
                    reviewDate: p.date,
                    reviewTime: p.time,
                    deadline: j.deadline,
                    deadlineTime: j.deadlineTime,
                    title: j.name || 'Issue',
                    projectId: t.projectId,
                    date: t.date,
                    issueKey: j.url || `name:${j.name}`,
                  }))
                : [],
            )
          : t.reviewDate && t.deadline
            ? [{ reviewDate: t.reviewDate, reviewTime: t.reviewTime, deadline: t.deadline, deadlineTime: t.deadlineTime, title: t.title, projectId: t.projectId, date: t.date, issueKey: `task:${t.title}` }]
            : []

      reviewItems.forEach((r) => {
        if (!r.reviewDate || !r.deadline) return
        // Dedup by (unique issue key + PR date) to avoid counting carry-over copies
        const dedupeKey = `${r.issueKey}|${r.reviewDate}|${r.reviewTime}`
        if (seen.has(dedupeKey)) return
        seen.add(dedupeKey)
        const rdMs = new Date(r.reviewDate + 'T' + (r.reviewTime || '12:00')).getTime()
        const dlMs = new Date(r.deadline + 'T' + (r.deadlineTime || '23:59')).getTime()
        const delta = calToWorkHours((rdMs - dlMs) / 3600000) // positive = late, negative = early
        taskPerfs.push({ title: r.title, date: r.date, reviewDate: r.reviewDate, reviewTime: r.reviewTime, deadline: r.deadline, deadlineTime: r.deadlineTime, projectId: r.projectId, delta })
      })
    })

    taskPerfs.sort((a, b) => b.delta - a.delta) // worst late first

    const earlyCount = taskPerfs.filter((p) => p.delta <= 0).length
    const lateCount = taskPerfs.filter((p) => p.delta > 0).length
    const total = taskPerfs.length
    const avgDelta = total ? taskPerfs.reduce((s, p) => s + p.delta, 0) / total : 0

    return {
      dev,
      taskPerfs,
      avgDelta,
      earlyCount,
      lateCount,
      earlyPct: total ? Math.round((earlyCount / total) * 100) : 0,
      latePct: total ? Math.round((lateCount / total) * 100) : 0,
    }
  })

  const withData = allPerfData.filter((dp) => dp.taskPerfs.length > 0)
  const filteredPerfData = selectedDev === 'ALL' ? withData : withData.filter((dp) => dp.dev.id === selectedDev)

  const sorted = [...filteredPerfData]
  if (sortKey === 'newest') {
    sorted.sort((a, b) =>
      b.taskPerfs.reduce((m, p) => (p.reviewDate > m ? p.reviewDate : m), '').localeCompare(
        a.taskPerfs.reduce((m, p) => (p.reviewDate > m ? p.reviewDate : m), ''),
      ),
    )
  } else if (sortKey === 'oldest') {
    sorted.sort((a, b) =>
      a.taskPerfs.reduce((m, p) => (p.date < m ? p.date : m), '9999').localeCompare(
        b.taskPerfs.reduce((m, p) => (p.date < m ? p.date : m), '9999'),
      ),
    )
  } else if (sortKey === 'most-late') {
    sorted.sort((a, b) => b.avgDelta - a.avgDelta)
  } else if (sortKey === 'most-early') {
    sorted.sort((a, b) => a.avgDelta - b.avgDelta)
  } else if (sortKey === 'most-tasks') {
    sorted.sort((a, b) => b.taskPerfs.length - a.taskPerfs.length)
  } else if (sortKey === 'name') {
    sorted.sort((a, b) => a.dev.name.localeCompare(b.dev.name))
  }

  // Team-level summary
  const scopedPerfs = filteredPerfData.flatMap((dp) => dp.taskPerfs)
  const totalTasks = scopedPerfs.length
  const avgDeltaAll = totalTasks ? scopedPerfs.reduce((s, p) => s + p.delta, 0) / totalTasks : 0
  const earlyAll = scopedPerfs.filter((p) => p.delta <= 0).length
  const lateAll = totalTasks - earlyAll
  const earlyPctAll = totalTasks ? Math.round((earlyAll / totalTasks) * 100) : 0

  const sortOptions: [SortKey, string][] = [
    ['newest', 'Newest first'],
    ['oldest', 'Oldest first'],
    ['most-late', 'Most late'],
    ['most-early', 'Most early'],
    ['most-tasks', 'Most tasks'],
    ['name', 'Name A–Z'],
  ]

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* sort bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '10px 24px', background: 'var(--surface)', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', flexShrink: 0 }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.7px' }}>Sort:</span>
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', fontFamily: 'var(--mono)', fontSize: 11, padding: '4px 9px', borderRadius: 8, outline: 'none', cursor: 'pointer' }}
        >
          {sortOptions.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16, minHeight: 0 }}>
        {totalTasks === 0 ? (
          <div style={{ textAlign: 'center', padding: '50px 20px', color: 'var(--text3)' }}>
            <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.35 }}>📊</div>
            <div style={{ fontSize: 14, color: 'var(--text2)' }}>No performance data yet</div>
            <div style={{ fontSize: 12, fontFamily: 'var(--mono)', marginTop: 4 }}>Add PR/MR links with deadlines to see early/late stats</div>
          </div>
        ) : (
          <>
            {/* Summary section */}
            <div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.7px', marginBottom: 10 }}>
                {selectedDev === 'ALL' ? 'Team overview' : (developers.find((d) => d.id === selectedDev)?.name ?? 'Developer') + ' overview'}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
                {([
                  {
                    label: 'Avg push time',
                    val: (avgDeltaAll < 0 ? '−' : avgDeltaAll > 0 ? '+' : '±') + fmtDelta(Math.abs(avgDeltaAll)),
                    sub: avgDeltaAll < 0 ? 'avg early before deadline' : avgDeltaAll > 0 ? 'avg late past deadline' : 'right on time',
                    color: avgDeltaAll < 0 ? 'var(--green)' : avgDeltaAll > 0 ? 'var(--red)' : 'var(--text2)',
                  },
                  { label: 'On time or early', val: earlyPctAll + '%', sub: earlyAll + ' of ' + totalTasks + ' tasks', color: 'var(--green)' },
                  { label: 'Late pushes', val: Math.round((lateAll / totalTasks) * 100) + '%', sub: lateAll + ' task' + (lateAll !== 1 ? 's' : ''), color: lateAll > 0 ? 'var(--red)' : 'var(--text2)' },
                  { label: 'Tracked tasks', val: String(totalTasks), sub: 'with PR + deadline', color: 'var(--text)' },
                ] as const).map(({ label, val, sub, color }) => (
                  <div key={label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px' }}>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 4 }}>{label}</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color, marginBottom: 2 }}>{val}</div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>{sub}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Per-dev cards */}
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.7px' }}>
              {selectedDev === 'ALL' ? 'All developers' : 'Developer detail'}
            </div>

            {sorted.map(({ dev, taskPerfs, avgDelta, earlyCount, lateCount, earlyPct, latePct }) => {
              const rgb = hexRgb(dev.color)
              const verdictCls = avgDelta < 0 ? 'early' : avgDelta > 0 ? 'late' : 'neutral'
              const verdictStyle = {
                early: { bg: 'var(--green-dim)', color: 'var(--green)', border: '1px solid #86efac', text: '⚡ Pushes Early' },
                late: { bg: 'var(--red-dim)', color: 'var(--red)', border: '1px solid #fca5a5', text: '⚠ Pushes Late' },
                neutral: { bg: 'var(--surface3)', color: 'var(--text3)', border: '1px solid var(--border)', text: '✓ On Time' },
              }[verdictCls]

              return (
                <div key={dev.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rl)', overflow: 'hidden', flexShrink: 0 }}>
                  {/* Header */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
                    <div className="av" style={{ background: `rgba(${rgb},.15)`, color: dev.color, width: 32, height: 32, fontSize: 12 }}>{initials(dev.name)}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{dev.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text3)' }}>{dev.role}</div>
                    </div>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 5, background: verdictStyle.bg, color: verdictStyle.color, border: verdictStyle.border }}>
                      {verdictStyle.text}
                    </span>
                  </div>

                  {/* Stats grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', borderBottom: '1px solid var(--border)' }}>
                    {([
                      { label: 'Avg delta', val: (avgDelta < 0 ? '−' : avgDelta > 0 ? '+' : '±') + fmtDelta(Math.abs(avgDelta)), sub: avgDelta < 0 ? 'before deadline' : avgDelta > 0 ? 'after deadline' : 'on time', color: avgDelta < 0 ? 'var(--green)' : avgDelta > 0 ? 'var(--red)' : 'var(--text2)' },
                      { label: 'On time / early', val: earlyPct + '%', sub: earlyCount + ' task' + (earlyCount !== 1 ? 's' : ''), color: 'var(--green)' },
                      { label: 'Late', val: latePct + '%', sub: lateCount + ' task' + (lateCount !== 1 ? 's' : ''), color: lateCount > 0 ? 'var(--red)' : 'var(--text2)' },
                      { label: 'Tracked tasks', val: String(taskPerfs.length), sub: 'with PR + deadline', color: 'var(--text)' },
                    ] as const).map(({ label, val, sub, color }) => (
                      <div key={label} style={{ padding: '10px 14px', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.6px' }}>{label}</div>
                        <div style={{ fontSize: 18, fontWeight: 700, color }}>{val}</div>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>{sub}</div>
                      </div>
                    ))}
                  </div>

                  {/* Progress bar */}
                  <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontFamily: 'var(--mono)', fontSize: 10 }}>
                      <span style={{ color: 'var(--green)' }}>{earlyPct}% early</span>
                      <span style={{ color: 'var(--red)' }}>{latePct}% late</span>
                    </div>
                    <div style={{ position: 'relative', height: 6, borderRadius: 3, background: 'var(--surface3)', overflow: 'hidden' }}>
                      <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${earlyPct}%`, background: 'var(--green)', borderRadius: '3px 0 0 3px' }} />
                      <div style={{ position: 'absolute', right: 0, top: 0, height: '100%', width: `${latePct}%`, background: 'var(--red)', borderRadius: '0 3px 3px 0' }} />
                    </div>
                  </div>

                  {/* Task list (sorted: worst late first) */}
                  <div style={{ padding: '0 14px 4px' }}>
                    {taskPerfs.map((p, i) => {
                      const proj = projects.find((pr) => pr.id === p.projectId)
                      const isEarly = p.delta <= 0
                      return (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                          <div style={{ flex: 1, color: 'var(--text2)', minWidth: 0, display: 'flex', alignItems: 'center', gap: 5, overflow: 'hidden' }}>
                            {proj && (
                              <span style={{ fontFamily: 'var(--mono)', fontSize: 9, padding: '1px 5px', borderRadius: 3, background: proj.color + '18', color: proj.color, flexShrink: 0 }}>
                                {proj.name}
                              </span>
                            )}
                            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.title}</span>
                          </div>
                          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', flexShrink: 0 }}>
                            {p.reviewDate}{p.reviewTime ? ' ' + p.reviewTime : ''}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                            <span style={{ fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 5, background: isEarly ? 'var(--green-dim)' : 'var(--red-dim)', color: isEarly ? 'var(--green)' : 'var(--red)', border: `1px solid ${isEarly ? '#86efac' : '#fca5a5'}` }}>
                              {isEarly ? 'Early' : 'Late'}
                            </span>
                            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 600, color: isEarly ? 'var(--green)' : 'var(--red)', whiteSpace: 'nowrap' }}>
                              {isEarly ? '−' : '+'}{fmtDelta(Math.abs(p.delta))}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}
