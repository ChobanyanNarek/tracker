import { useState } from 'react'
import type { JiraIssue, PrEntry, Status, Priority, StatusHistoryEntry } from '../../types'
import { useStore } from '../../store'
import { PRIORITY_CONF, STATUS_LABEL } from '../../constants'
import { todayStr } from '../../utils/dates'
import { loadPresets, savePresets, loadJiraPresets, saveJiraPresets } from '../../utils/format'

interface JiraFormRow {
  url: string
  name: string
  status: Status
  priority: Priority
  deadline: string
  deadlineTime: string
  prs: PrEntry[]
  comment: string
  // Carried through unchanged on edit so issue identity and history survive a save.
  issueId?: string
  statusHistory?: StatusHistoryEntry[]
  manualStatus?: Status
  hidden?: boolean
}

function PrRow({ value, onChange, onRemove }: { value: PrEntry; onChange: (v: PrEntry) => void; onRemove: () => void }) {
  const autoFill = (url: string) => {
    if (url && !value.date) {
      const n = new Date()
      onChange({
        url,
        date: n.toISOString().split('T')[0],
        time: String(n.getHours()).padStart(2, '0') + ':' + String(n.getMinutes()).padStart(2, '0'),
      })
    } else {
      onChange({ ...value, url })
    }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 6, alignItems: 'center', marginBottom: 4 }}>
      <input className="field" type="url" placeholder="https://github.com/..." value={value.url} onChange={(e) => autoFill(e.target.value)} />
      <input className="field" type="date" value={value.date} onChange={(e) => onChange({ ...value, date: e.target.value })} style={{ width: 'auto' }} />
      <input className="field" type="time" value={value.time} onChange={(e) => onChange({ ...value, time: e.target.value })} style={{ width: 'auto' }} />
      <button className="icon-btn del" onClick={onRemove} title="Remove PR">✕</button>
    </div>
  )
}

function JiraRow({ value, onChange, onRemove }: { value: JiraFormRow; onChange: (v: JiraFormRow) => void; onRemove: () => void }) {
  const [presets, setPresets] = useState(loadPresets)
  const [jiraPresets, setJiraPresets] = useState(loadJiraPresets)
  const [newPreset, setNewPreset] = useState('')
  const [newJiraPreset, setNewJiraPreset] = useState('')

  const addPreset = () => {
    const t = newPreset.trim()
    if (!t || presets.includes(t)) return
    const next = [...presets, t]
    savePresets(next); setPresets(next); setNewPreset('')
  }
  const delPreset = (p: string) => { const next = presets.filter((x) => x !== p); savePresets(next); setPresets(next) }
  const addJiraPreset = () => {
    const t = newJiraPreset.trim()
    if (!t || jiraPresets.includes(t)) return
    const next = [...jiraPresets, t]
    saveJiraPresets(next); setJiraPresets(next); setNewJiraPreset('')
  }
  const delJiraPreset = (u: string) => { const next = jiraPresets.filter((x) => x !== u); saveJiraPresets(next); setJiraPresets(next) }

  return (
    <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 4 }}>
      {/* name */}
      <div style={{ display: 'flex', gap: 7, alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <input className="field" placeholder="Issue name" value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6, alignItems: 'center' }}>
            {presets.map((p) => (
              <span key={p} style={{ display: 'inline-flex', borderRadius: 5, overflow: 'hidden', border: '1px solid var(--border2)' }}>
                <button type="button" onClick={() => onChange({ ...value, name: p })} style={{ background: 'var(--surface3)', border: 'none', color: 'var(--text2)', fontFamily: 'var(--mono)', fontSize: 10, padding: '2px 8px', cursor: 'pointer', whiteSpace: 'nowrap' }}>{p}</button>
                <button type="button" onClick={() => delPreset(p)} style={{ background: 'var(--surface3)', border: 'none', borderLeft: '1px solid var(--border2)', color: 'var(--text3)', fontSize: 11, padding: '2px 5px', cursor: 'pointer' }}>×</button>
              </span>
            ))}
            <span style={{ display: 'inline-flex', alignItems: 'center', border: '1px dashed var(--border2)', borderRadius: 5, overflow: 'hidden' }}>
              <input value={newPreset} onChange={(e) => setNewPreset(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addPreset()} placeholder="+ Add preset" style={{ background: 'transparent', border: 'none', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text)', padding: '2px 7px', outline: 'none', width: 100 }} />
              <button type="button" onClick={addPreset} style={{ background: 'none', border: 'none', borderLeft: '1px dashed var(--border2)', color: 'var(--text3)', fontSize: 13, padding: '0 6px', cursor: 'pointer', lineHeight: 1.6 }}>+</button>
            </span>
          </div>
        </div>
        <button className="icon-btn del" onClick={onRemove} title="Remove issue">✕</button>
      </div>

      {/* detail row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto 130px 80px', gap: 7, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <input className="field" type="url" placeholder="https://jira.company.com/browse/PROJ-1" value={value.url} onChange={(e) => onChange({ ...value, url: e.target.value })} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
            {jiraPresets.map((u) => (
              <span key={u} style={{ display: 'inline-flex', borderRadius: 5, overflow: 'hidden', border: '1px solid var(--border2)' }}>
                <button type="button" onClick={() => onChange({ ...value, url: u })} style={{ background: 'var(--surface3)', border: 'none', color: 'var(--text2)', fontFamily: 'var(--mono)', fontSize: 10, padding: '2px 8px', cursor: 'pointer', whiteSpace: 'nowrap' }}>{u.match(/([A-Z][A-Z0-9]+-\d+)/)?.[1] ?? u.slice(0, 20)}</button>
                <button type="button" onClick={() => delJiraPreset(u)} style={{ background: 'var(--surface3)', border: 'none', borderLeft: '1px solid var(--border2)', color: 'var(--text3)', fontSize: 11, padding: '2px 5px', cursor: 'pointer' }}>×</button>
              </span>
            ))}
            <span style={{ display: 'inline-flex', alignItems: 'center', border: '1px dashed var(--border2)', borderRadius: 5, overflow: 'hidden' }}>
              <input value={newJiraPreset} onChange={(e) => setNewJiraPreset(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addJiraPreset()} placeholder="+ Save Jira URL" style={{ background: 'transparent', border: 'none', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text)', padding: '2px 7px', outline: 'none', width: 100 }} />
              <button type="button" onClick={addJiraPreset} style={{ background: 'none', border: 'none', borderLeft: '1px dashed var(--border2)', color: 'var(--text3)', fontSize: 13, padding: '0 6px', cursor: 'pointer', lineHeight: 1.6 }}>+</button>
            </span>
          </div>
        </div>

        <select className="field" style={{ width: 'auto', fontFamily: 'var(--mono)', fontSize: 11, cursor: 'pointer' }} value={value.status} onChange={(e) => onChange({ ...value, status: e.target.value as Status })}>
          {(['todo', 'inprogress', 'review', 'done', 'blocked'] as Status[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>

        <select className="field" style={{ width: 'auto', fontFamily: 'var(--mono)', fontSize: 11, cursor: 'pointer' }} value={value.priority} onChange={(e) => onChange({ ...value, priority: e.target.value as Priority })}>
          {Object.entries(PRIORITY_CONF).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <input className="field" type="date" value={value.deadline} onChange={(e) => onChange({ ...value, deadline: e.target.value })} title="Deadline" />
          <button type="button" onClick={() => onChange({ ...value, deadline: todayStr() })} style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent)', color: 'var(--accent)', fontFamily: 'var(--mono)', fontSize: 9, padding: '2px 7px', borderRadius: 4, cursor: 'pointer', lineHeight: 1.4, whiteSpace: 'nowrap' }}>Today</button>
        </div>

        <input className="field" type="time" value={value.deadlineTime} onChange={(e) => onChange({ ...value, deadlineTime: e.target.value })} />
      </div>

      {/* comment + PRs */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <input className="field" type="text" placeholder="Comment / blocker note (optional)" value={value.comment} onChange={(e) => onChange({ ...value, comment: e.target.value })} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="field-label" style={{ marginBottom: 0 }}>PR / MR</span>
          <button type="button" onClick={() => onChange({ ...value, prs: [...value.prs, { url: '', date: '', time: '' }] })} style={{ background: 'none', border: '1px dashed var(--border2)', color: 'var(--text3)', fontFamily: 'var(--mono)', fontSize: 9, padding: '1px 7px', borderRadius: 4, cursor: 'pointer' }}>+ Add PR/MR</button>
        </div>
        {value.prs.map((pr, i) => (
          <PrRow
            key={i}
            value={pr}
            onChange={(v) => onChange({ ...value, prs: value.prs.map((p, j) => j === i ? v : p) })}
            onRemove={() => onChange({ ...value, prs: value.prs.filter((_, j) => j !== i) })}
          />
        ))}
      </div>
    </div>
  )
}

interface Props {
  taskId?: string
  forDevId?: string
  onCancel: () => void
}

function makeBlankJira(): JiraFormRow {
  return { url: '', name: '', status: 'todo', priority: 'low', deadline: '', deadlineTime: '', prs: [], comment: '' }
}

export default function TaskForm({ taskId, forDevId, onCancel }: Props) {
  const { developers, projects, tasks, selectedProject, selectedDev, selectedDate, addTask, updateTask } = useStore()
  const existing = taskId ? tasks.find((t) => t.id === taskId) : undefined

  const defaultDev = existing?.devId ?? forDevId ?? (selectedDev !== 'ALL' ? selectedDev : developers[0]?.id ?? '')

  const inferProject = (dId: string) => {
    if (selectedProject !== 'ALL') return selectedProject
    const devProjects = projects.filter((p) => p.members.includes(dId))
    return devProjects[0]?.id ?? ''
  }

  const defaultProj = existing?.projectId ?? inferProject(defaultDev)

  const [devId, setDevId] = useState(defaultDev)
  const [projectId, setProjectId] = useState(defaultProj)

  const handleDevChange = (newDevId: string) => {
    setDevId(newDevId)
    if (!taskId) setProjectId(inferProject(newDevId))
  }
  const [comment, setComment] = useState(existing?.comment ?? '')
  const [jiraRows, setJiraRows] = useState<JiraFormRow[]>(() => {
    if (existing?.jiras?.length) {
      return existing.jiras.map((j) => ({ url: j.url, name: j.name, status: j.status, priority: j.priority ?? 'low', deadline: j.deadline, deadlineTime: j.deadlineTime, prs: j.prs ?? [], comment: j.comment ?? '', issueId: j.issueId, statusHistory: j.statusHistory, manualStatus: j.manualStatus, hidden: j.hidden }))
    }
    return [makeBlankJira()]
  })

  const handleSave = () => {
    if (!devId) return

    const finalJiras: JiraIssue[] = jiraRows
      .filter((r) => r.url || r.name)
      .map((r, i) => {
        const hasPr = r.prs.length > 0
        return {
          url: r.url,
          name: r.name,
          status: hasPr ? 'done' : r.status,
          priority: r.priority,
          deadline: r.deadline,
          deadlineTime: r.deadlineTime,
          prs: r.prs,
          comment: r.comment,
          ...(r.issueId ? { issueId: r.issueId } : {}),
          ...(r.statusHistory ? { statusHistory: r.statusHistory } : {}),
          ...(r.manualStatus ? { manualStatus: r.manualStatus } : {}),
          ...(r.hidden ? { hidden: r.hidden } : {}),
          _srcIdx: i,
        }
      })

    const allDone = finalJiras.length > 0 && finalJiras.every((j) => j.status === 'done')
    const title = finalJiras[0]?.name || finalJiras[0]?.url || 'Checkpoint'
    const status = allDone ? 'done' : (finalJiras[0]?.status ?? 'todo')

    if (taskId) {
      updateTask(taskId, { devId, projectId, title, status, jiras: finalJiras, deadline: finalJiras[0]?.deadline ?? '', deadlineTime: finalJiras[0]?.deadlineTime ?? '', jira: finalJiras[0]?.url ?? '', comment })
      onCancel()
      return
    }

    // A developer has one card per day — if one already exists for this date,
    // append the new issues to it instead of creating a parallel checkpoint.
    const existingCard = tasks.find((t) => t.devId === devId && t.date === selectedDate)
    if (existingCard) {
      const merged: JiraIssue[] = [...(existingCard.jiras ?? []), ...finalJiras].map((j, i) => ({ ...j, _srcIdx: i }))
      const mergedAllDone = merged.length > 0 && merged.every((j) => j.status === 'done')
      updateTask(existingCard.id, {
        projectId: existingCard.projectId || projectId,
        title: merged[0]?.name || merged[0]?.url || 'Checkpoint',
        status: mergedAllDone ? 'done' : (merged[0]?.status ?? 'todo'),
        jiras: merged,
        deadline: merged[0]?.deadline ?? '',
        deadlineTime: merged[0]?.deadlineTime ?? '',
        jira: merged[0]?.url ?? '',
        comment: comment ? (existingCard.comment ? existingCard.comment + '\n' + comment : comment) : existingCard.comment,
      })
      onCancel()
      return
    }

    addTask({ devId, projectId, title, status, jiras: finalJiras, jira: finalJiras[0]?.url ?? '', pr: '', prs: [], deadline: finalJiras[0]?.deadline ?? '', deadlineTime: finalJiras[0]?.deadlineTime ?? '', reviewDate: '', reviewTime: '', comment, date: selectedDate })
    onCancel()
  }

  const willMergeInto = !taskId && tasks.some((t) => t.devId === devId && t.date === selectedDate)

  return (
    <div style={{ background: 'var(--surface2)', border: '1px solid var(--accent)', borderRadius: 'var(--rl)', padding: 14, display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 8 }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--accent)' }}>{taskId ? '✎ Edit checkpoint' : '+ New checkpoint'}</div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div>
          <label className="field-label">Developer</label>
          <select className="field" style={{ cursor: 'pointer' }} value={devId} onChange={(e) => handleDevChange(e.target.value)}>
            {developers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          {willMergeInto && (
            <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--accent)', marginTop: 4 }}>
              ↳ issues will be added to {developers.find((d) => d.id === devId)?.name ?? 'this developer'}'s card for this day
            </div>
          )}
        </div>
        <div>
          <label className="field-label">Project</label>
          <select className="field" style={{ cursor: 'pointer' }} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">— No project —</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className="field-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          Jira links
          <button type="button" className="btn-soft" style={{ fontSize: 10, padding: '2px 9px' }} onClick={() => setJiraRows((r) => [...r, makeBlankJira()])}>+ Add Jira</button>
        </label>
        {jiraRows.map((row, i) => (
          <JiraRow
            key={i}
            value={row}
            onChange={(v) => setJiraRows((rows) => rows.map((r, j) => j === i ? v : r))}
            onRemove={() => setJiraRows((rows) => rows.filter((_, j) => j !== i))}
          />
        ))}
      </div>

      <div>
        <label className="field-label">Comment</label>
        <textarea className="field" value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="Blockers, context…" style={{ resize: 'vertical' }} />
      </div>

      <div style={{ display: 'flex', gap: 7, justifyContent: 'flex-end' }}>
        <button className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button className="btn-primary" onClick={handleSave}>{taskId ? 'Save changes' : 'Add checkpoint'}</button>
      </div>
    </div>
  )
}
