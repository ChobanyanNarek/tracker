import { useState } from 'react'
import { useStore } from '../../store'
import { dlInfo, todayStr, formatDate } from '../../utils/dates'
import { getJiras, jiraLabel, jiraDedupeKey, hexRgb, initials } from '../../utils/format'
import { STATUS_LABEL, STATUS_COLOR } from '../../constants'
import type { DeadlineItem, Developer, Project } from '../../types'
import EmptyState from '../ui/EmptyState'

type SortKey = 'urgency' | 'date-asc' | 'date-desc' | 'assignee' | 'project' | 'status'

// Module-level so it isn't recreated on every DeadlinesView render (which would
// remount every card instead of updating it).
function DeadlineCard({ item, developers, projects, yesterday, onJump }: {
  item: DeadlineItem
  developers: Developer[]
  projects: Project[]
  yesterday: string
  onJump: (item: DeadlineItem) => void
}) {
  const { task, deadline, deadlineTime, title, status, jiraUrl, _sinceDate } = item
  const dev = developers.find((d) => d.id === task.devId)
  const proj = projects.find((p) => p.id === task.projectId)
  const d = deadline ? dlInfo(deadline, deadlineTime) : null
  const rgb = dev ? hexRgb(dev.color) : '37,99,235'
  const devColor = dev?.color ?? '#2563eb'
  const cardCls = !d ? 'none' : d.diff < 0 ? 'over' : d.diff === 0 ? 'today' : d.diff <= 7 ? 'soon' : 'ok'
  const borderColor = { over: 'var(--red)', today: 'var(--amber)', soon: '#f59e0b', ok: 'var(--green)', none: 'var(--border)' }[cardCls]
  const dlColor = { over: STATUS_COLOR.blocked, today: STATUS_COLOR.inprogress, soon: '#f59e0b', ok: STATUS_COLOR.done, none: 'var(--text3)' }[cardCls]

  return (
    <div onClick={() => onJump(item)} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: `4px solid ${borderColor}`, borderRadius: 'var(--rl)', padding: '12px 14px', marginBottom: 7, display: 'flex', alignItems: 'flex-start', gap: 12, cursor: 'pointer', transition: 'box-shadow .15s' }}
      onMouseEnter={(e) => (e.currentTarget.style.boxShadow = 'var(--shadow)')}
      onMouseLeave={(e) => (e.currentTarget.style.boxShadow = '')}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 4 }}>
          {title}
          {jiraUrl && (
            <a className="elink jira" href={jiraUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ fontSize: 10, marginLeft: 4 }}>{jiraLabel(jiraUrl) ?? jiraUrl.split('/').pop()}</a>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {dev && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div className="av" style={{ background: `rgba(${rgb},.15)`, color: devColor, width: 18, height: 18, fontSize: 8, flexShrink: 0 }}>{initials(dev.name)}</div>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>{dev.name}</span>
            </div>
          )}
          {proj && <span style={{ fontFamily: 'var(--mono)', fontSize: 10, padding: '1px 6px', borderRadius: 3, background: proj.color + '18', color: proj.color }}>{proj.name}</span>}
          <span className={`spill s-${status}`} style={{ marginTop: 0 }}>{STATUS_LABEL[status]}</span>
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        {d ? (
          <>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600, color: dlColor }}>{d.text}</div>
            {deadlineTime && <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>{deadlineTime}</div>}
          </>
        ) : task.date === yesterday ? (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600, color: 'var(--amber)' }}>
            {`Since ${formatDate(_sinceDate)}`}
          </div>
        ) : (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>No deadline</div>
        )}
        <button onClick={(e) => { e.stopPropagation(); onJump(item) }} style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>→ Go to task</button>
      </div>
    </div>
  )
}

export default function DeadlinesView() {
  const [sortKey, setSortKey] = useState<SortKey>('urgency')
  const { tasks, developers, projects, selectedDev, selectedProject, setSelectedDate, setSelectedDev, setSelectedProject, setHighlightedTaskId, setView } = useStore()

  const today = todayStr()
  const yesterday = new Date(new Date(today + 'T12:00:00').getTime() - 86_400_000).toISOString().slice(0, 10)

  const archivedIds = new Set(developers.filter((d) => d.archivedAt).map((d) => d.id))

  // Pre-pass: find the earliest date each issue had each status, scanning ALL history
  // (no dev/project filter — filtering here causes the since-date to fall back to today
  // whenever the task lived in a different project at the time).
  // Key: "${devId}|${dedupeKey}|${status}" → earliest date with that status
  const statusSince = new Map<string, string>()
  tasks.forEach((task) => {
    if (archivedIds.has(task.devId)) return
    const jiras = getJiras(task)
    if (jiras.length) {
      jiras.forEach((j) => {
        const dk = jiraDedupeKey(j.url, j.name)
        if (!dk) return
        const k = `${task.devId}|${dk}|${j.status}`
        const ex = statusSince.get(k)
        if (!ex || task.date < ex) statusSince.set(k, task.date)
      })
    } else if (task.deadline) {
      const k = `${task.devId}|task-title:${task.title}|${task.status}`
      const ex = statusSince.get(k)
      if (!ex || task.date < ex) statusSince.set(k, task.date)
    }
  })

  type JiraEntry = { latestItem: DeadlineItem; minDate: string }
  const jiraMap = new Map<string, JiraEntry>()

  tasks.forEach((task) => {
    if (archivedIds.has(task.devId)) return
    if (selectedDev !== 'ALL' && task.devId !== selectedDev) return
    if (selectedProject !== 'ALL' && task.projectId !== selectedProject) return

    const jiras = getJiras(task)
    if (jiras.length) {
      jiras.forEach((j, ji) => {
        // Issues without a deadline only contribute from today/yesterday (the "stuck" display).
        // Issues with a deadline are collected from any date; dedup picks the latest occurrence.
        if (!j.deadline && task.date !== today && task.date !== yesterday) return
        const jKey = `${task.devId}|${jiraDedupeKey(j.url, j.name) || `_anon${ji}`}`
        const item: DeadlineItem = {
          task, deadline: j.deadline, deadlineTime: j.deadlineTime ?? '',
          title: j.name || jiraLabel(j.url) || 'Issue', status: j.status,
          jiraUrl: j.url ?? '', taskDate: task.date,
          _key: `${task.id}-j${ji}`, _daysStuck: 0, _sinceDate: task.date,
        }
        const ex = jiraMap.get(jKey)
        if (!ex) {
          jiraMap.set(jKey, { latestItem: item, minDate: task.date })
        } else {
          if (task.date > ex.latestItem.taskDate) ex.latestItem = item
          if (task.date < ex.minDate) ex.minDate = task.date
        }
      })
    } else if (task.deadline && (task.date === today || task.date === yesterday)) {
      const tKey = `${task.devId}|task-title:${task.title}`
      const item: DeadlineItem = {
        task, deadline: task.deadline, deadlineTime: task.deadlineTime ?? '',
        title: task.title, status: task.status,
        jiraUrl: '', taskDate: task.date,
        _key: `${task.id}-task`, _daysStuck: 0, _sinceDate: task.date,
      }
      const ex = jiraMap.get(tKey)
      if (!ex) {
        jiraMap.set(tKey, { latestItem: item, minDate: task.date })
      } else {
        if (task.date > ex.latestItem.taskDate) ex.latestItem = item
        if (task.date < ex.minDate) ex.minDate = task.date
      }
    }
  })

  const deduped: DeadlineItem[] = []
  jiraMap.forEach(({ latestItem, minDate }, jKey) => {
    if (latestItem.status === 'done') return
    const realSince = statusSince.get(`${jKey}|${latestItem.status}`) ?? minDate
    const daysStuck = Math.max(0, Math.round(
      (new Date(today).getTime() - new Date(realSince + 'T12:00:00').getTime()) / 86_400_000,
    ))
    deduped.push({ ...latestItem, _daysStuck: daysStuck, _sinceDate: realSince })
  })

  // Items without a deadline sort to the end
  const dlDate = (item: DeadlineItem) =>
    item.deadline ? new Date(item.deadline + 'T' + (item.deadlineTime || '23:59')).getTime() : Infinity
  const sorted = [...deduped]
  if (sortKey === 'date-asc' || sortKey === 'urgency') sorted.sort((a, b) => dlDate(a) - dlDate(b))
  else if (sortKey === 'date-desc') sorted.sort((a, b) => dlDate(b) - dlDate(a))
  else if (sortKey === 'assignee') sorted.sort((a, b) => (developers.find((d) => d.id === a.task.devId)?.name ?? '').localeCompare(developers.find((d) => d.id === b.task.devId)?.name ?? '') || dlDate(a) - dlDate(b))
  else if (sortKey === 'project') sorted.sort((a, b) => (projects.find((p) => p.id === a.task.projectId)?.name ?? '').localeCompare(projects.find((p) => p.id === b.task.projectId)?.name ?? '') || dlDate(a) - dlDate(b))
  else if (sortKey === 'status') { const o: Record<string, number> = { blocked: 0, inprogress: 1, review: 2, todo: 3 }; sorted.sort((a, b) => (o[a.status] ?? 3) - (o[b.status] ?? 3) || dlDate(a) - dlDate(b)) }

  const jumpTo = (item: DeadlineItem) => {
    // Reset filters so the task is always visible regardless of active dev/project filters
    setSelectedDev('ALL')
    setSelectedProject('ALL')
    setSelectedDate(item.task.date)
    setHighlightedTaskId(item.task.id)
    setView('daily')
  }

  const SORTS: [SortKey, string][] = [['urgency', '🔴 By urgency'], ['date-asc', '↑ Soonest'], ['date-desc', '↓ Latest'], ['assignee', '👤 Assignee'], ['project', '📁 Project'], ['status', '● Status']]

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* sort bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 20px', background: 'var(--surface)', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', flexShrink: 0 }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.7px', marginRight: 2 }}>Sort:</span>
        {SORTS.map(([key, lbl]) => (
          <button key={key} className={`chip${sortKey === key ? ' active' : ''}`} onClick={() => setSortKey(key)}>{lbl}</button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
        {sorted.length === 0 ? (
          <EmptyState icon="🎉" title="All clear" hint="No open issues" />
        ) : sortKey === 'urgency' ? (
          (() => {
            const groups: Record<string, DeadlineItem[]> = { '🔴 Overdue': [], '🟠 Today': [], '🟡 This week': [], '🔵 This month': [], '🟢 Later': [], '⚪ No deadline': [] }
            sorted.forEach((item) => {
              if (!item.deadline) { groups['⚪ No deadline'].push(item); return }
              const d = dlInfo(item.deadline, item.deadlineTime)
              if (d.diff < 0) groups['🔴 Overdue'].push(item)
              else if (d.diff === 0) groups['🟠 Today'].push(item)
              else if (d.diff <= 7) groups['🟡 This week'].push(item)
              else if (d.diff <= 31) groups['🔵 This month'].push(item)
              else groups['🟢 Later'].push(item)
            })
            return Object.entries(groups).filter(([, items]) => items.length > 0).map(([label, items]) => (
              <div key={label} style={{ marginBottom: 20 }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.8px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 7, padding: '4px 0' }}>
                  {label} <span style={{ background: 'var(--surface3)', color: 'var(--text3)', padding: '1px 7px', borderRadius: 8, fontSize: 10 }}>{items.length}</span>
                </div>
                {items.map((item) => <DeadlineCard key={item._key} item={item} developers={developers} projects={projects} yesterday={yesterday} onJump={jumpTo} />)}
              </div>
            ))
          })()
        ) : (
          sorted.map((item) => <DeadlineCard key={item._key} item={item} developers={developers} projects={projects} yesterday={yesterday} onJump={jumpTo} />)
        )}
      </div>
    </div>
  )
}
