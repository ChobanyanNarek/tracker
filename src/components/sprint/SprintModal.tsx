import { useState } from 'react'
import { useStore } from '../../store'
import type { Sprint } from '../../types'

interface Props {
  sprint: Sprint | null
  projectId: string
  onClose: () => void
}

export default function SprintModal({ sprint, projectId, onClose }: Props) {
  const { addSprint, updateSprint } = useStore()

  const [name, setName] = useState(sprint?.name ?? '')
  const [startDate, setStartDate] = useState(sprint?.startDate ?? new Date().toISOString().slice(0, 10))
  const [endDate, setEndDate] = useState(sprint?.endDate ?? '')

  const handleSave = () => {
    if (!name.trim() || !startDate || !endDate) return
    if (sprint) {
      updateSprint(sprint.id, { name: name.trim(), startDate, endDate })
    } else {
      addSprint({ name: name.trim(), startDate, endDate, projectId })
    }
    onClose()
  }

  const fieldStyle: React.CSSProperties = {
    padding: '6px 9px', fontSize: 12, background: 'var(--surface)',
    border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)',
    width: '100%', boxSizing: 'border-box',
  }
  const labelStyle: React.CSSProperties = {
    fontSize: 10, fontWeight: 600, color: 'var(--text3)', letterSpacing: '.5px',
    textTransform: 'uppercase', marginBottom: 3, display: 'block',
  }

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(10,14,35,.4)', backdropFilter: 'blur(2px)', zIndex: 900 }}
      />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12,
        boxShadow: '0 20px 60px rgba(0,0,0,.3)', zIndex: 901, width: 340, padding: '20px',
      }}>
        <div style={{ marginBottom: 16, fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
          {sprint ? 'Edit Sprint' : 'New Sprint'}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={labelStyle}>Sprint Name</label>
            <input
              style={fieldStyle}
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Sprint 12"
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <label style={labelStyle}>Start Date</label>
              <input type="date" style={fieldStyle} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>End Date</label>
              <input type="date" style={fieldStyle} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          <button
            onClick={handleSave}
            disabled={!name.trim() || !startDate || !endDate}
            style={{ flex: 1, padding: '7px 0', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: (!name.trim() || !startDate || !endDate) ? 0.5 : 1 }}
          >
            {sprint ? 'Save' : 'Create'}
          </button>
          <button
            onClick={onClose}
            style={{ flex: 1, padding: '7px 0', background: 'var(--surface2)', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: 7, fontSize: 12, cursor: 'pointer' }}
          >
            Cancel
          </button>
        </div>
      </div>
    </>
  )
}
