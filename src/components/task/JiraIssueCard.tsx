import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useState, useRef, useEffect } from 'react'
import type { JiraIssue, JiraConfig, PrEntry } from '../../types'
import { PRIORITY_CONF } from '../../constants'
import { dlInfo, formatDate } from '../../utils/dates'
import { prLabel, jiraLabel } from '../../utils/format'
import StatusSelect from '../ui/StatusSelect'
import Icon, { BrandIcon } from '../ui/Icon'

function PrHistoryPopover({ p }: { p: PrEntry }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const stateColors: Record<string, { bg: string; color: string }> = {
    draft:  { bg: 'var(--surface2)', color: 'var(--text3)' },
    open:   { bg: 'var(--green-dim)', color: 'var(--green)' },
    merged: { bg: 'var(--purple-dim)', color: 'var(--purple)' },
    closed: { bg: 'var(--red-dim)', color: 'var(--red)' },
  }
  const sc = p.state ? stateColors[p.state] : null

  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
      {sc && (
        <span style={{ fontFamily: 'var(--mono)', fontSize: 8, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: sc.bg, color: sc.color, textTransform: 'uppercase', letterSpacing: '.4px' }}>
          {p.state}
        </span>
      )}
      {p.stateHistory?.length ? (
        <button
          onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', color: 'var(--text3)', fontSize: 9, lineHeight: 1, display: 'flex', alignItems: 'center' }}
          title="State history"
        >
          <svg width="8" height="8" viewBox="0 0 10 10" fill="currentColor"><path d="M5 1a4 4 0 1 0 0 8A4 4 0 0 0 5 1Zm0 1.2a2.8 2.8 0 1 1 0 5.6A2.8 2.8 0 0 1 5 2.2Zm-.5 1v2.1l1.5 1-.4.6L4 5.5V3.2h.5Z"/></svg>
        </button>
      ) : null}
      {open && p.stateHistory?.length ? (
        <span style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 200, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,.12)', padding: '8px 12px', minWidth: 180, whiteSpace: 'nowrap' }}>
          {p.stateHistory.map((e, i) => {
            const d = new Date(e.at)
            const dateStr = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
            const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
            const dot = stateColors[e.state]
            return (
              <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: i < p.stateHistory!.length - 1 ? 6 : 0 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: dot?.color ?? 'var(--text3)', flexShrink: 0 }} />
                <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.3px', minWidth: 44 }}>{e.state}</span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text)' }}>{dateStr} {timeStr}</span>
              </span>
            )
          })}
        </span>
      ) : null}
    </span>
  )
}

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
          <Icon name="eye" size={11} />
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
          <Icon name="pen" size={11} />
        </button>
        <button
          onClick={() => onHide(issue.issueId, issue.url ?? '')}
          title="Hide issue (keeps syncing)"
          style={iconBtn}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text2)'; e.currentTarget.style.opacity = '1' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text3)'; e.currentTarget.style.opacity = '0.5' }}
        >
          <Icon name="eye-off" size={11} />
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
            <BrandIcon brand="jira" size={9} />
            {jiraLbl ?? 'Jira'}
          </a>
        )}
        {issue.issueTypeName && (
          <span
            title={issue.issueTypeName}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 4, background: 'var(--surface3)', color: 'var(--text2)', border: '1px solid var(--border)' }}
          >
            {issue.issueTypeIconUrl && (
              <img src={issue.issueTypeIconUrl} alt="" width={10} height={10} style={{ display: 'block' }} />
            )}
            {issue.issueTypeName}
          </span>
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
                <PrHistoryPopover p={p} />
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
