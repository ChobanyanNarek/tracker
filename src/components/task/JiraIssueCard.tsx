import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { JiraIssue, JiraConfig } from '../../types'
import { PRIORITY_CONF } from '../../constants'
import { dlInfo, formatDate } from '../../utils/dates'
import { prLabel, jiraLabel } from '../../utils/format'
import StatusSelect from '../ui/StatusSelect'

interface Props {
  issue: JiraIssue
  taskId: string
  index: number
  conn?: JiraConfig
  onStatusChange: (issueId: string | undefined, url: string, status: JiraIssue['status'], groupId: string) => void
  onPriorityChange: (issueId: string | undefined, url: string, priority: JiraIssue['priority']) => void
  onEdit: (issueId: string | undefined, url: string) => void
  onDelete: (issueId: string | undefined, url: string) => void
  onHide: (issueId: string | undefined, url: string) => void
}

export default function JiraIssueCard({ issue, taskId, index, conn, onStatusChange, onPriorityChange, onEdit, onDelete, onHide }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `${taskId}-${index}`,
  })

  const pc = PRIORITY_CONF[issue.priority ?? 'low']
  const dl = issue.deadline ? dlInfo(issue.deadline, issue.deadlineTime) : null
  const jiraLbl = jiraLabel(issue.url)

  const perfBadge = (() => {
    if (!issue.deadline || !issue.prs?.length) return null
    const latest = [...issue.prs].filter((p) => p.date).sort((a, b) => (b.date + (b.time ?? '')).localeCompare(a.date + (a.time ?? '')))[0]
    if (!latest) return null
    const isEarly = new Date(latest.date + 'T' + (latest.time || '12:00')) <= new Date(issue.deadline + 'T' + (issue.deadlineTime || '23:59'))
    return isEarly
      ? <span style={{ fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: 'var(--green-dim)', color: 'var(--green)', border: '1px solid #86efac' }}>Early</span>
      : <span style={{ fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: 'var(--red-dim)', color: 'var(--red)', border: '1px solid #fca5a5' }}>Late</span>
  })()

  const iconBtn: React.CSSProperties = {
    background: 'none', border: 'none', color: 'var(--text3)', fontSize: 11,
    padding: '2px 3px', cursor: 'pointer', transition: 'color .15s', lineHeight: 1, opacity: 0.5,
  }

  // Collapsed hidden row
  if (issue.hidden) {
    return (
      <div
        ref={setNodeRef}
        style={{ transform: CSS.Transform.toString(transform), transition, display: 'flex', alignItems: 'center', gap: 7, padding: '5px 11px', border: '1px dashed var(--border)', borderRadius: 'var(--r)', background: 'transparent', opacity: 0.5 }}
      >
        <span {...attributes} {...listeners} style={{ cursor: 'grab', color: 'var(--text3)', fontSize: 14, lineHeight: 1, userSelect: 'none' }}>⠿</span>
        <span style={{ flex: 1, fontSize: 11, color: 'var(--text3)', fontStyle: 'italic' }}>{issue.name || jiraLbl || 'Issue'}</span>
        <button
          onClick={() => onHide(issue.issueId, issue.url ?? '')}
          title="Show issue"
          style={{ ...iconBtn, opacity: 0.7 }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.opacity = '1' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text3)'; e.currentTarget.style.opacity = '0.7' }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
      </div>
    )
  }

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? 'box-shadow var(--t)',
    opacity: isDragging ? 0.4 : 1,
    border: isDragging ? '2px dashed var(--accent)' : '1px solid var(--border)',
    background: 'var(--surface2)',
    borderRadius: 'var(--r)',
    padding: '8px 11px',
    display: 'flex',
    flexDirection: 'column',
    gap: 5,
    boxShadow: isDragging ? 'var(--shadow)' : 'var(--shadow-xs)',
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      onMouseEnter={(e) => { if (!isDragging) (e.currentTarget as HTMLDivElement).style.boxShadow = 'var(--shadow-sm)' }}
      onMouseLeave={(e) => { if (!isDragging) (e.currentTarget as HTMLDivElement).style.boxShadow = 'var(--shadow-xs)' }}
    >
      {/* header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span {...attributes} {...listeners} style={{ cursor: 'grab', color: 'var(--text3)', fontSize: 14, lineHeight: 1, padding: '2px 3px', borderRadius: 3, userSelect: 'none' }} title="Drag to reorder">⠿</span>
        <div style={{ flex: 1, fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>
          {issue.name || jiraLbl || 'Jira Issue'}
        </div>
        {perfBadge}
        <select
          value={issue.priority ?? 'low'}
          onChange={(e) => onPriorityChange(issue.issueId, issue.url ?? '', e.target.value as JiraIssue['priority'])}
          style={{ border: `1.5px solid ${pc.color}`, borderRadius: 10, fontSize: 10, fontWeight: 600, padding: '1px 6px', outline: 'none', cursor: 'pointer', background: 'transparent', color: pc.color, fontFamily: 'var(--mono)' }}
        >
          {Object.entries(PRIORITY_CONF).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <button
          onClick={() => onEdit(issue.issueId, issue.url ?? '')}
          title="Edit issue"
          style={iconBtn}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.opacity = '1' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text3)'; e.currentTarget.style.opacity = '0.5' }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
        </button>
        <button
          onClick={() => onHide(issue.issueId, issue.url ?? '')}
          title="Hide issue (keeps syncing)"
          style={iconBtn}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text2)'; e.currentTarget.style.opacity = '1' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text3)'; e.currentTarget.style.opacity = '0.5' }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
        </button>
        <button
          onClick={() => onDelete(issue.issueId, issue.url ?? '')}
          style={iconBtn}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--red)'; e.currentTarget.style.opacity = '1' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text3)'; e.currentTarget.style.opacity = '0.5' }}
          title="Delete issue"
        >✕</button>
      </div>

      {/* row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {issue.url && (
          <a className="elink jira" href={issue.url} target="_blank" rel="noreferrer" style={{ fontSize: 10 }}>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><path d="M11.53 2c0 2.4 1.97 4.35 4.35 4.35h1.78v1.7c0 2.4 1.94 4.34 4.34 4.35V2.84a.84.84 0 0 0-.84-.84zM6.77 6.8a4.362 4.362 0 0 0 4.34 4.34h1.79v1.71a4.362 4.362 0 0 0 4.34 4.34V7.63a.84.84 0 0 0-.83-.83zM2 11.6c0 2.4 1.95 4.34 4.35 4.34h1.78v1.72c.01 2.39 1.95 4.34 4.35 4.34v-9.57a.84.84 0 0 0-.84-.83z"/></svg>
            {jiraLbl ?? 'Jira'}
          </a>
        )}
        <StatusSelect
          value={issue.status}
          groupId={issue.groupId}
          conn={conn}
          onChange={(v, gid) => onStatusChange(issue.issueId, issue.url ?? '', v, gid)}
          style={{ fontSize: 10, padding: '2px 20px 2px 8px' }}
        />
        {dl && dl.cls !== 'dl-none' && (
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10 }} className={dl.cls}>{dl.text}</span>
        )}
      </div>

      {/* PRs */}
      {issue.prs?.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 3, paddingTop: 4, borderTop: '1px dashed var(--border)' }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.5px' }}>PR/MR</span>
          {issue.prs.map((p, i) => {
            const lbl = prLabel(p.url)
            const prDateLabel = p.date
              ? formatDate(p.date) + (p.time ? ' at ' + p.time : '')
              : null
            return lbl ? (
              <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <a className="elink" href={p.url} target="_blank" rel="noreferrer" style={{ fontSize: 10 }}>
                  <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354Z"/></svg>
                  {lbl}
                </a>
                {prDateLabel && <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>{prDateLabel}</span>}
              </span>
            ) : null
          })}
        </div>
      )}

      {/* comment */}
      {issue.comment && (
        <div style={{ fontSize: 11, color: 'var(--text3)', fontStyle: 'italic', paddingLeft: 2 }}>{issue.comment}</div>
      )}
    </div>
  )
}
