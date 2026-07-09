import { useState } from 'react'
import type { JiraIssue, PrEntry, Status, Priority } from '../../types'
import { PRIORITY_CONF, STATUS_LABEL } from '../../constants'
import { todayStr } from '../../utils/dates'

interface Props {
  issue: JiraIssue
  onSave: (patch: Partial<JiraIssue>) => void
  onCancel: () => void
}

/** Compact inline editor for a single issue — rendered in place of the issue
 *  card so edits stay in context, without opening the whole checkpoint form. */
export default function IssueEditForm({ issue, onSave, onCancel }: Props) {
  const [name, setName] = useState(issue.name)
  const [url, setUrl] = useState(issue.url ?? '')
  const [status, setStatus] = useState<Status>(issue.status)
  const [priority, setPriority] = useState<Priority>(issue.priority ?? 'low')
  const [deadline, setDeadline] = useState(issue.deadline ?? '')
  const [deadlineTime, setDeadlineTime] = useState(issue.deadlineTime ?? '')
  const [comment, setComment] = useState(issue.comment ?? '')
  const [prs, setPrs] = useState<PrEntry[]>(issue.prs ?? [])

  const originalPrUrls = new Set((issue.prs ?? []).map((p) => p.url).filter(Boolean))

  const setPr = (i: number, pr: PrEntry) => setPrs((list) => list.map((p, j) => (j === i ? pr : p)))
  const prUrlChange = (i: number, prUrl: string) => {
    const cur = prs[i]
    if (prUrl && !cur.date) {
      const n = new Date()
      setPr(i, { url: prUrl, date: n.toISOString().split('T')[0], time: `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}` })
    } else {
      setPr(i, { ...cur, url: prUrl })
    }
    if (prUrl && !originalPrUrls.has(prUrl)) setStatus('done')
  }

  const save = () => {
    const filteredPrs = prs.filter((p) => p.url.trim())
    const hasNewPr = filteredPrs.some((p) => !originalPrUrls.has(p.url))
    onSave({
      name: name.trim(),
      url: url.trim(),
      status: hasNewPr ? 'done' : status,
      priority,
      deadline,
      deadlineTime,
      comment: comment.trim(),
      prs: filteredPrs,
    })
  }

  return (
    <div style={{ border: '1px solid var(--accent)', background: 'var(--surface2)', borderRadius: 'var(--r)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '.6px' }}>✎ Edit issue</div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
        <div>
          <label className="field-label">Issue name</label>
          <input className="field" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Issue name" />
        </div>
        <div>
          <label className="field-label">Jira URL</label>
          <input className="field" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://jira…/browse/PROJ-1" />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'auto auto 1fr auto auto', gap: 7, alignItems: 'end' }}>
        <div>
          <label className="field-label">Status</label>
          <select className="field" style={{ width: 'auto', fontFamily: 'var(--mono)', fontSize: 11, cursor: 'pointer' }} value={status} onChange={(e) => setStatus(e.target.value as Status)}>
            {(['todo', 'inprogress', 'review', 'done', 'blocked'] as Status[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </div>
        <div>
          <label className="field-label">Priority</label>
          <select className="field" style={{ width: 'auto', fontFamily: 'var(--mono)', fontSize: 11, cursor: 'pointer' }} value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
            {Object.entries(PRIORITY_CONF).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
        <div />
        <div>
          <label className="field-label">Deadline</label>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input className="field" type="date" style={{ width: 'auto' }} value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            <button type="button" onClick={() => setDeadline(todayStr())} style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent)', color: 'var(--accent)', fontFamily: 'var(--mono)', fontSize: 9, padding: '3px 7px', borderRadius: 4, cursor: 'pointer', whiteSpace: 'nowrap' }}>Today</button>
          </div>
        </div>
        <div>
          <label className="field-label">Time</label>
          <input className="field" type="time" style={{ width: 'auto' }} value={deadlineTime} onChange={(e) => setDeadlineTime(e.target.value)} />
        </div>
      </div>

      <div>
        <label className="field-label">Comment</label>
        <input className="field" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Blocker note, context… (optional)" />
      </div>

      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <span className="field-label" style={{ marginBottom: 0 }}>PR / MR</span>
          <button type="button" onClick={() => setPrs((p) => [...p, { url: '', date: '', time: '' }])} style={{ background: 'none', border: '1px dashed var(--border2)', color: 'var(--text3)', fontFamily: 'var(--mono)', fontSize: 9, padding: '1px 7px', borderRadius: 4, cursor: 'pointer' }}>+ Add PR/MR</button>
        </div>
        {prs.map((pr, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 6, alignItems: 'center', marginBottom: 4 }}>
            <input className="field" type="url" placeholder="https://gitlab.com/…/merge_requests/1" value={pr.url} onChange={(e) => prUrlChange(i, e.target.value)} />
            <input className="field" type="date" style={{ width: 'auto' }} value={pr.date} onChange={(e) => setPr(i, { ...pr, date: e.target.value })} />
            <input className="field" type="time" style={{ width: 'auto' }} value={pr.time} onChange={(e) => setPr(i, { ...pr, time: e.target.value })} />
            <button className="icon-btn del" title="Remove PR" onClick={() => setPrs((list) => list.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button className="btn-primary" onClick={save}>Save issue</button>
      </div>
    </div>
  )
}
