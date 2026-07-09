import { useStore } from '../../store'
import { hexRgb, initials, getJiras, jiraLabel, prLabel } from '../../utils/format'
import { dlInfo } from '../../utils/dates'
import { STATUS_LABEL, STATUS_COLOR, PRIORITY_CONF } from '../../constants'
import type { Task } from '../../types'

interface Props {
  task: Task
  onClose: () => void
}

export default function TaskDetailModal({ task, onClose }: Props) {
  const { developers, projects, setSelectedDate, setView } = useStore()
  const dev = developers.find((d) => d.id === task.devId)
  const proj = projects.find((p) => p.id === task.projectId)
  const jiras = getJiras(task)
  const rgb = dev ? hexRgb(dev.color) : '37,99,235'
  const devColor = dev?.color ?? '#2563eb'

  const goToDaily = () => {
    setSelectedDate(task.date)
    setView('daily')
    onClose()
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.45)', padding: '20px' }}
      onClick={onClose}
    >
      <div
        style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rl)', width: '100%', maxWidth: 660, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 40px rgba(0,0,0,.4)', overflow: 'hidden' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            {dev && (
              <div className="av" style={{ background: `rgba(${rgb},.15)`, color: devColor, width: 36, height: 36, fontSize: 13, flexShrink: 0 }}>{initials(dev.name)}</div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', lineHeight: 1.3 }}>{task.title || 'Checkpoint'}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                {dev && <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>{dev.name}</span>}
                {proj && <span style={{ fontFamily: 'var(--mono)', fontSize: 10, padding: '1px 6px', borderRadius: 3, background: proj.color + '18', color: proj.color }}>{proj.name}</span>}
                <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>{task.date}</span>
                {task.carriedOver && task.carriedFrom && (
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 9, padding: '1px 6px', borderRadius: 4, background: 'var(--amber-dim)', color: 'var(--amber)', border: '1px solid var(--amber)' }}>
                    ⏩ from {new Date(task.carriedFrom + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={onClose}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface2)', color: 'var(--text3)', cursor: 'pointer', fontSize: 14, flexShrink: 0 }}
            >✕</button>
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {jiras.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text3)', fontFamily: 'var(--mono)', fontSize: 12 }}>No issues attached</div>
          ) : (
            jiras.map((j, i) => {
              const jiraLbl = jiraLabel(j.url)
              const dl = j.deadline ? dlInfo(j.deadline, j.deadlineTime) : null
              const pc = PRIORITY_CONF[j.priority ?? 'medium']
              const statusColor = STATUS_COLOR[j.status]
              const prsWithDate = (j.prs ?? []).filter((p) => p.date)
              const latestPr = prsWithDate.length
                ? prsWithDate.reduce((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')) >= 0 ? a : b)
                : null

              return (
                <div
                  key={i}
                  style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}
                >
                  {/* Issue header */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor, marginTop: 4, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', lineHeight: 1.4 }}>
                        {j.name || jiraLbl || 'Issue'}
                      </div>
                      {jiraLbl && (
                        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>{jiraLbl}</div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 600, padding: '2px 7px', borderRadius: 4, background: statusColor + '20', color: statusColor, border: `1px solid ${statusColor}40` }}>
                        {STATUS_LABEL[j.status]}
                      </span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 600, padding: '2px 7px', borderRadius: 4, background: 'transparent', color: pc.color, border: `1px solid ${pc.color}60` }}>
                        {pc.label}
                      </span>
                      {j.url && (
                        <a
                          href={j.url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          style={{ display: 'flex', alignItems: 'center', gap: 3, fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--accent)', textDecoration: 'none', padding: '2px 7px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--surface)' }}
                        >
                          <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><path d="M11.53 2c0 2.4 1.97 4.35 4.35 4.35h1.78v1.7c0 2.4 1.94 4.34 4.34 4.35V2.84a.84.84 0 0 0-.84-.84zM6.77 6.8a4.362 4.362 0 0 0 4.34 4.34h1.79v1.71a4.362 4.362 0 0 0 4.34 4.34V7.63a.84.84 0 0 0-.83-.83zM2 11.6c0 2.4 1.95 4.34 4.35 4.34h1.78v1.72c.01 2.39 1.95 4.34 4.35 4.34v-9.57a.84.84 0 0 0-.84-.83z"/></svg>
                          Jira
                        </a>
                      )}
                    </div>
                  </div>

                  {/* Deadline + PR */}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {dl && dl.cls !== 'dl-none' && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--mono)', fontSize: 11 }}>
                        <span style={{ color: 'var(--text3)' }}>Due:</span>
                        <span className={dl.cls}>{dl.text}</span>
                        {j.deadlineTime && <span style={{ color: 'var(--text3)', fontSize: 10 }}>at {j.deadlineTime}</span>}
                      </div>
                    )}
                    {latestPr && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--mono)', fontSize: 11 }}>
                        <span style={{ color: 'var(--text3)' }}>PR:</span>
                        {latestPr.url ? (
                          <a href={latestPr.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: 'var(--accent)', textDecoration: 'none' }}>
                            {prLabel(latestPr.url) ?? 'PR/MR'}
                          </a>
                        ) : <span style={{ color: 'var(--text2)' }}>PR/MR</span>}
                        <span style={{ color: 'var(--text3)' }}>{latestPr.date}{latestPr.time ? ' at ' + latestPr.time : ''}</span>
                      </div>
                    )}
                  </div>

                  {/* Comment */}
                  {j.comment && (
                    <div style={{ fontSize: 12, color: 'var(--text3)', fontStyle: 'italic', borderTop: '1px dashed var(--border)', paddingTop: 6 }}>{j.comment}</div>
                  )}
                </div>
              )
            })
          )}

          {/* Task-level comment */}
          {task.comment && (
            <div style={{ padding: '10px 14px', background: 'var(--surface2)', borderRadius: 8, border: '1px solid var(--border)' }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 4 }}>Note</div>
              <div style={{ fontSize: 12, color: 'var(--text2)', fontStyle: 'italic' }}>{task.comment}</div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', flexShrink: 0, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={onClose}
            style={{ fontFamily: 'var(--mono)', fontSize: 11, padding: '7px 14px', border: '1px solid var(--border)', borderRadius: 7, background: 'var(--surface2)', color: 'var(--text3)', cursor: 'pointer' }}
          >
            Close
          </button>
          <button
            onClick={goToDaily}
            style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600, padding: '7px 16px', border: '1px solid var(--accent)', borderRadius: 7, background: 'var(--accent-dim)', color: 'var(--accent)', cursor: 'pointer' }}
          >
            → Go to Daily View
          </button>
        </div>
      </div>
    </div>
  )
}
