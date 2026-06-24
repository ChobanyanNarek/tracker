import { useState } from 'react'
import type { JiraIssue, PrEntry, Status, Priority } from '../../types'
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
      <input type="url" placeholder="https://github.com/..." value={value.url} onChange={(e) => autoFill(e.target.value)} style={{ background: '#fff', border: '1px solid var(--border)', color: 'var(--text)', padding: '5px 9px', borderRadius: 6, outline: 'none', width: '100%', fontSize: 12 }} />
      <input type="date" value={value.date} onChange={(e) => onChange({ ...value, date: e.target.value })} style={{ background: '#fff', border: '1px solid var(--border)', color: 'var(--text)', padding: '4px 8px', borderRadius: 6, outline: 'none', fontSize: 12 }} />
      <input type="time" value={value.time} onChange={(e) => onChange({ ...value, time: e.target.value })} style={{ background: '#fff', border: '1px solid var(--border)', color: 'var(--text)', padding: '4px 8px', borderRadius: 6, outline: 'none', fontSize: 12 }} />
      <button onClick={onRemove} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text3)', fontSize: 11, width: 22, height: 22, borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .15s' }} onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--red)'; e.currentTarget.style.color = 'var(--red)' }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text3)' }}>✕</button>
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

  const inp: React.CSSProperties = { background: '#fff', border: '1px solid var(--border)', color: 'var(--text)', padding: '5px 9px', borderRadius: 6, outline: 'none', width: '100%', fontSize: 12 }

  return (
    <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 4 }}>
      {/* name */}
      <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
        <div style={{ flex: 1 }}>
          <input placeholder="Issue name" value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} style={inp} />
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
        <button onClick={onRemove} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text3)', fontSize: 11, width: 22, height: 22, borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>✕</button>
      </div>

      {/* detail row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto 130px 80px', gap: 7, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <input type="url" placeholder="https://jira.company.com/browse/PROJ-1" value={value.url} onChange={(e) => onChange({ ...value, url: e.target.value })} style={inp} />
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

        <select value={value.status} onChange={(e) => onChange({ ...value, status: e.target.value as Status })} style={{ background: 'var(--surface3)', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 11, padding: '4px 8px', borderRadius: 6, outline: 'none', cursor: 'pointer' }}>
          {(['todo', 'inprogress', 'review', 'done', 'blocked'] as Status[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>

        <select value={value.priority} onChange={(e) => onChange({ ...value, priority: e.target.value as Priority })} style={{ background: 'var(--surface3)', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 11, padding: '4px 8px', borderRadius: 6, outline: 'none', cursor: 'pointer' }}>
          {Object.entries(PRIORITY_CONF).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <input type="date" value={value.deadline} onChange={(e) => onChange({ ...value, deadline: e.target.value })} title="Deadline" style={{ ...inp, padding: '5px 8px' }} />
          <button type="button" onClick={() => onChange({ ...value, deadline: todayStr() })} style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent)', color: 'var(--accent)', fontFamily: 'var(--mono)', fontSize: 9, padding: '2px 7px', borderRadius: 4, cursor: 'pointer', lineHeight: 1.4, whiteSpace: 'nowrap' }}>Today</button>
        </div>

        <input type="time" value={value.deadlineTime} onChange={(e) => onChange({ ...value, deadlineTime: e.target.value })} style={{ ...inp, padding: '5px 8px' }} />
      </div>

      {/* comment + PRs */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <input type="text" placeholder="Comment / blocker note (optional)" value={value.comment} onChange={(e) => onChange({ ...value, comment: e.target.value })} style={{ ...inp }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.6px' }}>PR / MR</span>
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
      return existing.jiras.map((j) => ({ url: j.url, name: j.name, status: j.status, priority: j.priority ?? 'low', deadline: j.deadline, deadlineTime: j.deadlineTime, prs: j.prs ?? [], comment: j.comment ?? '' }))
    }
    return [makeBlankJira()]
  })

  const labelStyle: React.CSSProperties = { fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.6px', display: 'block', marginBottom: 3 }
  const inputStyle: React.CSSProperties = { width: '100%', background: '#fff', border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 9px', borderRadius: 6, outline: 'none', fontSize: 13, transition: 'border-color .15s' }
  const selectStyle = inputStyle

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
          _srcIdx: i,
        }
      })

    const allDone = finalJiras.length > 0 && finalJiras.every((j) => j.status === 'done')
    const title = finalJiras[0]?.name || finalJiras[0]?.url || 'Checkpoint'
    const status = allDone ? 'done' : (finalJiras[0]?.status ?? 'todo')

    if (taskId) {
      updateTask(taskId, { devId, projectId, title, status, jiras: finalJiras, deadline: finalJiras[0]?.deadline ?? '', deadlineTime: finalJiras[0]?.deadlineTime ?? '', jira: finalJiras[0]?.url ?? '', comment })
    } else {
      addTask({ devId, projectId, title, status, jiras: finalJiras, jira: finalJiras[0]?.url ?? '', pr: '', prs: [], deadline: finalJiras[0]?.deadline ?? '', deadlineTime: finalJiras[0]?.deadlineTime ?? '', reviewDate: '', reviewTime: '', comment, date: selectedDate })
    }
    onCancel()
  }

  return (
    <div style={{ background: 'var(--surface2)', border: '1px solid var(--accent)', borderRadius: 'var(--rl)', padding: 14, display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 8 }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--accent)' }}>{taskId ? '✎ Edit checkpoint' : '+ New checkpoint'}</div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div>
          <label style={labelStyle}>Developer</label>
          <select value={devId} onChange={(e) => handleDevChange(e.target.value)} style={selectStyle}>
            {developers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Project</label>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={selectStyle}>
            <option value="">— No project —</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          Jira links
          <button type="button" onClick={() => setJiraRows((r) => [...r, makeBlankJira()])} style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent)', color: 'var(--accent)', fontFamily: 'var(--mono)', fontSize: 10, padding: '2px 9px', borderRadius: 5, cursor: 'pointer' }}>+ Add Jira</button>
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
        <label style={labelStyle}>Comment</label>
        <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="Blockers, context…" style={{ ...inputStyle, resize: 'vertical' }} />
      </div>

      <div style={{ display: 'flex', gap: 7, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={{ fontFamily: 'var(--mono)', fontSize: 11, padding: '6px 13px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface3)', color: 'var(--text3)', cursor: 'pointer' }}>Cancel</button>
        <button onClick={handleSave} style={{ fontFamily: 'var(--mono)', fontSize: 11, padding: '6px 13px', borderRadius: 6, border: '1px solid var(--accent)', background: 'var(--accent-dim)', color: 'var(--accent)', cursor: 'pointer' }}>{taskId ? 'Save changes' : 'Add checkpoint'}</button>
      </div>
    </div>
  )
}
