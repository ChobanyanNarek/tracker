import { useStore } from '../../store'
import type { Sprint } from '../../types'

function diffDays(a: string, b: string): number {
  return Math.round((new Date(b + 'T12:00:00').getTime() - new Date(a + 'T12:00:00').getTime()) / 86400000)
}

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

interface Props {
  sprint: Sprint
}

export default function SprintBand({ sprint }: Props) {
  const { tasks, selectedProject } = useStore()
  const today = todayStr()

  const totalDays = Math.max(1, diffDays(sprint.startDate, sprint.endDate))
  const elapsed = Math.max(0, Math.min(totalDays, diffDays(sprint.startDate, today)))
  const daysLeft = Math.max(0, diffDays(today, sprint.endDate))
  const progress = Math.round((elapsed / totalDays) * 100)

  // Count jira issues for this project
  const projectTasks = tasks.filter((t) => t.projectId === selectedProject)
  const allJiras = projectTasks.flatMap((t) => t.jiras ?? [])

  const todo = allJiras.filter((j) => j.status === 'todo' && !j.hidden).length
  const active = allJiras.filter((j) => j.status === 'inprogress' && !j.hidden).length
  const review = allJiras.filter((j) => j.status === 'review' && !j.hidden).length
  const blocked = allJiras.filter((j) => j.status === 'blocked' && !j.hidden).length
  const done = allJiras.filter((j) => j.status === 'done' && !j.hidden).length

  const fmtDate = (d: string) => {
    const dt = new Date(d + 'T12:00:00')
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  const isOver = today > sprint.endDate

  return (
    <div style={{
      padding: '8px 20px',
      borderBottom: '1px solid var(--border)',
      background: 'var(--surface)',
      display: 'flex',
      alignItems: 'center',
      gap: 16,
      flexShrink: 0,
    }}>
      {/* Sprint name + dates */}
      <div style={{ flexShrink: 0, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', letterSpacing: '-.1px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140 }}>
          {sprint.name}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)', marginTop: 1 }}>
          {fmtDate(sprint.startDate)} – {fmtDate(sprint.endDate)}
        </div>
      </div>

      {/* Days left badge */}
      <div style={{
        flexShrink: 0,
        background: isOver ? 'var(--red-dim, rgba(239,68,68,.1))' : daysLeft <= 3 ? 'rgba(245,158,11,.1)' : 'var(--accent-dim)',
        color: isOver ? 'var(--red)' : daysLeft <= 3 ? 'var(--amber)' : 'var(--accent)',
        border: `1px solid ${isOver ? 'var(--red)' : daysLeft <= 3 ? 'var(--amber)' : 'var(--accent)'}`,
        borderRadius: 6,
        padding: '2px 8px',
        fontSize: 10,
        fontFamily: 'var(--mono)',
        fontWeight: 700,
        whiteSpace: 'nowrap',
      }}>
        {isOver ? 'Ended' : daysLeft === 0 ? 'Last day' : `${daysLeft}d left`}
      </div>

      {/* Progress bar */}
      <div style={{ flex: 1, minWidth: 60 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
          <span style={{ fontSize: 9, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>Progress</span>
          <span style={{ fontSize: 9, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>{progress}%</span>
        </div>
        <div style={{ height: 4, borderRadius: 4, background: 'var(--border2)', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${progress}%`, background: isOver ? 'var(--red)' : 'var(--accent)', borderRadius: 4, transition: 'width .3s' }} />
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
        {[
          { label: 'Todo', value: todo, color: 'var(--text3)' },
          { label: 'Active', value: active, color: 'var(--accent)' },
          { label: 'Review', value: review, color: 'var(--amber)' },
          { label: 'Blocked', value: blocked, color: 'var(--red)' },
          { label: 'Done', value: done, color: 'var(--green)' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color, fontFamily: 'var(--mono)' }}>{value}</div>
            <div style={{ fontSize: 9, color: 'var(--text3)', letterSpacing: '.3px' }}>{label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
