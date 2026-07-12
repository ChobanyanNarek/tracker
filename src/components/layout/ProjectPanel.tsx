import { useState } from 'react'
import { useStore } from '../../store'
import { PALETTE } from '../../constants'
import ConfirmDialog from '../ui/ConfirmDialog'
import MembersModal from '../modals/MembersModal'

interface Props {
  open: boolean
  onClose: () => void
  topOffset: number
}

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const DAY_FULL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function DayPicker({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  const toggle = (d: number) => onChange(value.includes(d) ? value.filter((x) => x !== d) : [...value, d].sort())
  return (
    <div style={{ display: 'flex', gap: 3 }}>
      {DAY_LABELS.map((label, i) => {
        const active = value.includes(i)
        return (
          <button
            key={i}
            type="button"
            onClick={() => toggle(i)}
            title={DAY_FULL[i]}
            style={{
              width: 26, height: 26, borderRadius: 6, fontSize: 10, fontWeight: 700,
              border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border2)'}`,
              background: active ? 'var(--accent-dim)' : 'none',
              color: active ? 'var(--accent)' : 'var(--text3)',
              cursor: 'pointer', transition: 'all .12s', padding: 0,
            }}
          >{label}</button>
        )
      })}
    </div>
  )
}

/** Right-side sliding panel for projects — same style as DevPanel. */
export default function ProjectPanel({ open, onClose, topOffset }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [color, setColor] = useState(PALETTE[0])
  const [nonWorkingDays, setNonWorkingDays] = useState<number[]>([0, 6])
  const [membersModalProjId, setMembersModalProjId] = useState<string | null>(null)
  const [deletingProjId, setDeletingProjId] = useState<string | null>(null)

  // Edit state
  const [editingProjId, setEditingProjId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editColor, setEditColor] = useState(PALETTE[0])
  const [editNonWorkingDays, setEditNonWorkingDays] = useState<number[]>([0, 6])

  const { projects, selectedProject, addProject, updateProject, deleteProject, setSelectedProject } = useStore()

  const deletingProj = projects.find((p) => p.id === deletingProjId)

  const handleAdd = () => {
    if (!name.trim()) return
    addProject({ name: name.trim(), desc: desc.trim(), color, members: [], nonWorkingDays })
    setName(''); setDesc(''); setColor(PALETTE[0]); setNonWorkingDays([0, 6]); setShowForm(false)
  }

  const startEdit = (projId: string) => {
    const p = projects.find((pr) => pr.id === projId)
    if (!p) return
    setEditingProjId(projId)
    setEditName(p.name)
    setEditDesc(p.desc ?? '')
    setEditColor(p.color)
    setEditNonWorkingDays(p.nonWorkingDays ?? [0, 6])
  }

  const handleSaveEdit = () => {
    if (!editingProjId || !editName.trim()) return
    updateProject(editingProjId, {
      name: editName.trim(),
      desc: editDesc.trim(),
      color: editColor,
      nonWorkingDays: editNonWorkingDays,
    })
    setEditingProjId(null)
  }

  const selectProject = (id: string | 'ALL') => {
    setSelectedProject(id)
    onClose()
  }

  const fieldStyle: React.CSSProperties = {
    padding: '5px 8px', fontSize: 12, background: 'var(--surface)',
    border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text)',
    width: '100%', boxSizing: 'border-box',
  }
  const labelStyle: React.CSSProperties = {
    fontSize: 10, fontWeight: 600, color: 'var(--text3)', letterSpacing: '.5px',
    textTransform: 'uppercase', marginBottom: 2, display: 'block',
  }

  return (
    <>
      {open && (
        <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 190, background: 'rgba(10,14,35,.18)', backdropFilter: 'blur(1px)', WebkitBackdropFilter: 'blur(1px)' }} />
      )}

      <div style={{
        position: 'fixed', top: topOffset, left: 0, width: 264,
        height: `calc(100vh - ${topOffset}px)`,
        background: 'var(--surface)', borderRight: '1px solid var(--border)',
        boxShadow: open ? '6px 0 32px rgba(25,35,90,.13)' : 'none',
        zIndex: 200, display: 'flex', flexDirection: 'column',
        transform: open ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform .22s cubic-bezier(.4,0,.2,1), box-shadow .22s',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '12px 14px 10px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <span className="section-label" style={{ letterSpacing: '.9px' }}>Projects</span>
          <div style={{ display: 'flex', gap: 5 }}>
            <button onClick={() => { setShowForm((s) => !s); setEditingProjId(null) }} style={{ background: showForm ? 'var(--accent-dim)' : 'none', border: `1px solid ${showForm ? 'var(--accent)' : 'var(--border2)'}`, color: 'var(--accent)', fontSize: 14, width: 22, height: 22, borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .15s', cursor: 'pointer' }} title="Add project">+</button>
            <button onClick={onClose} className="icon-btn" style={{ fontSize: 13 }}>✕</button>
          </div>
        </div>

        {/* Add project form */}
        {showForm && (
          <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 5, flexShrink: 0, background: 'var(--surface2)' }}>
            <input className="field" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name" onKeyDown={(e) => e.key === 'Enter' && document.getElementById('pp-desc-input')?.focus()} />
            <input className="field" id="pp-desc-input" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Description (optional)" onKeyDown={(e) => e.key === 'Enter' && handleAdd()} />
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {PALETTE.map((c) => (
                <div key={c} onClick={() => setColor(c)} style={{ width: 19, height: 19, borderRadius: 4, background: c, cursor: 'pointer', border: `2px solid ${c === color ? '#1e293b' : 'transparent'}`, transform: c === color ? 'scale(1.2)' : '', transition: 'all .15s' }} />
              ))}
            </div>
            <div>
              <label style={labelStyle}>Non-working days</label>
              <DayPicker value={nonWorkingDays} onChange={setNonWorkingDays} />
            </div>
            <div style={{ display: 'flex', gap: 5 }}>
              <button className="btn-soft" style={{ flex: 1, justifyContent: 'center' }} onClick={handleAdd}>Add</button>
              <button className="btn-secondary" style={{ flex: 1, padding: '5px 0' }} onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </div>
        )}

        {/* Scrollable list */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minHeight: 0 }}>
          {/* All projects */}
          <div style={{ padding: '6px 8px 2px' }}>
            <div onClick={() => selectProject('ALL')} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', borderRadius: 'var(--r)', cursor: 'pointer', border: `1px solid ${selectedProject === 'ALL' ? 'var(--accent)' : 'var(--border)'}`, background: selectedProject === 'ALL' ? 'var(--accent-dim)' : 'var(--surface2)', transition: 'all .15s' }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--surface3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0 }}>📁</div>
              <span style={{ fontSize: 13, fontWeight: 500, color: selectedProject === 'ALL' ? 'var(--accent)' : 'var(--text2)', flex: 1 }}>All projects</span>
            </div>
          </div>

          {/* Project list */}
          <div style={{ padding: '4px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {projects.map((p) => {
              const isActive = selectedProject === p.id
              const isEditing = editingProjId === p.id
              return (
                <div key={p.id}>
                  <div
                    onClick={() => !isEditing && selectProject(p.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', borderRadius: 'var(--r)', cursor: isEditing ? 'default' : 'pointer', border: `1px solid ${isActive ? 'var(--accent)' : isEditing ? 'var(--border2)' : 'transparent'}`, background: isActive ? 'var(--accent-dim)' : isEditing ? 'var(--surface2)' : '', transition: 'all .15s' }}
                    onMouseEnter={(e) => { if (!isActive && !isEditing) { e.currentTarget.style.background = 'var(--surface2)'; e.currentTarget.style.borderColor = 'var(--border)' } }}
                    onMouseLeave={(e) => { if (!isActive && !isEditing) { e.currentTarget.style.background = ''; e.currentTarget.style.borderColor = 'transparent' } }}
                  >
                    <div style={{ width: 28, height: 28, borderRadius: 8, background: p.color + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <div style={{ width: 11, height: 11, borderRadius: 3, background: p.color }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: isActive ? 'var(--accent)' : 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                      {p.desc && <div style={{ fontSize: 11, color: 'var(--text3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.desc}</div>}
                      <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>
                        {p.members.length} member{p.members.length !== 1 ? 's' : ''}
                        {(p.nonWorkingDays ?? [0, 6]).length > 0 && (
                          <span style={{ marginLeft: 4 }}>· off: {(p.nonWorkingDays ?? [0, 6]).map((d) => DAY_FULL[d]).join(', ')}</span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); isEditing ? setEditingProjId(null) : startEdit(p.id) }}
                      title={isEditing ? 'Cancel edit' : 'Edit project'}
                      style={{ background: isEditing ? 'var(--accent-dim)' : 'none', border: `1px solid ${isEditing ? 'var(--accent)' : 'var(--border)'}`, color: isEditing ? 'var(--accent)' : 'var(--text3)', fontSize: 10, width: 22, height: 22, borderRadius: 5, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all .15s', flexShrink: 0 }}
                      onMouseEnter={(e) => { if (!isEditing) { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.borderColor = 'var(--accent)' } }}
                      onMouseLeave={(e) => { if (!isEditing) { e.currentTarget.style.color = 'var(--text3)'; e.currentTarget.style.borderColor = 'var(--border)' } }}
                    >✏️</button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setMembersModalProjId(p.id) }}
                      title="Edit members"
                      style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text3)', fontSize: 11, width: 22, height: 22, borderRadius: 5, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all .15s', flexShrink: 0 }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.borderColor = 'var(--accent)' }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text3)'; e.currentTarget.style.borderColor = 'var(--border)' }}
                    >👥</button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeletingProjId(p.id) }}
                      title="Delete project"
                      style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text3)', fontSize: 10, width: 22, height: 22, borderRadius: 5, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all .15s', flexShrink: 0 }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--red)'; e.currentTarget.style.borderColor = 'var(--red)' }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text3)'; e.currentTarget.style.borderColor = 'var(--border)' }}
                    >✕</button>
                  </div>

                  {/* Inline edit form */}
                  {isEditing && (
                    <div style={{ margin: '2px 0 4px', padding: '8px 9px', background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div>
                        <label style={labelStyle}>Name</label>
                        <input style={fieldStyle} autoFocus value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Project name" />
                      </div>
                      <div>
                        <label style={labelStyle}>Description</label>
                        <input style={fieldStyle} value={editDesc} onChange={(e) => setEditDesc(e.target.value)} placeholder="Optional" />
                      </div>
                      <div>
                        <label style={labelStyle}>Color</label>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {PALETTE.map((c) => (
                            <div key={c} onClick={() => setEditColor(c)} style={{ width: 18, height: 18, borderRadius: 4, background: c, cursor: 'pointer', border: `2px solid ${c === editColor ? '#1e293b' : 'transparent'}`, transform: c === editColor ? 'scale(1.2)' : '', transition: 'all .15s' }} />
                          ))}
                        </div>
                      </div>
                      <div>
                        <label style={labelStyle}>Non-working days</label>
                        <DayPicker value={editNonWorkingDays} onChange={setEditNonWorkingDays} />
                      </div>
                      <div style={{ display: 'flex', gap: 5, marginTop: 2 }}>
                        <button className="btn-soft" style={{ flex: 1, justifyContent: 'center', fontSize: 11 }} onClick={handleSaveEdit}>Save</button>
                        <button className="btn-secondary" style={{ flex: 1, padding: '4px 0', fontSize: 11 }} onClick={() => setEditingProjId(null)}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}

            {projects.length === 0 && !showForm && (
              <div style={{ padding: '14px 10px', fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text3)', textAlign: 'center' }}>
                No projects yet — click + to add one
              </div>
            )}
          </div>
        </div>
      </div>

      {membersModalProjId && (
        <MembersModal projectId={membersModalProjId} onClose={() => setMembersModalProjId(null)} />
      )}

      {deletingProj && (
        <ConfirmDialog
          title={`Delete "${deletingProj.name}"?`}
          message="Checkpoints assigned to this project will keep their data but lose the project tag."
          onConfirm={() => { deleteProject(deletingProj.id); setDeletingProjId(null) }}
          onCancel={() => setDeletingProjId(null)}
        />
      )}
    </>
  )
}
