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

/** Right-side sliding panel for projects — same style as DevPanel. */
export default function ProjectPanel({ open, onClose, topOffset }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [color, setColor] = useState(PALETTE[0])
  const [membersModalProjId, setMembersModalProjId] = useState<string | null>(null)
  const [deletingProjId, setDeletingProjId] = useState<string | null>(null)

  const { projects, selectedProject, addProject, deleteProject, setSelectedProject } = useStore()

  const deletingProj = projects.find((p) => p.id === deletingProjId)

  const handleAdd = () => {
    if (!name.trim()) return
    addProject({ name: name.trim(), desc: desc.trim(), color, members: [] })
    setName(''); setDesc(''); setShowForm(false)
  }

  const selectProject = (id: string | 'ALL') => {
    setSelectedProject(id)
    onClose()
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
            <button onClick={() => setShowForm((s) => !s)} style={{ background: showForm ? 'var(--accent-dim)' : 'none', border: `1px solid ${showForm ? 'var(--accent)' : 'var(--border2)'}`, color: 'var(--accent)', fontSize: 14, width: 22, height: 22, borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .15s', cursor: 'pointer' }} title="Add project">+</button>
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
              return (
                <div
                  key={p.id}
                  onClick={() => selectProject(p.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', borderRadius: 'var(--r)', cursor: 'pointer', border: `1px solid ${isActive ? 'var(--accent)' : 'transparent'}`, background: isActive ? 'var(--accent-dim)' : '', transition: 'all .15s' }}
                  onMouseEnter={(e) => { if (!isActive) { e.currentTarget.style.background = 'var(--surface2)'; e.currentTarget.style.borderColor = 'var(--border)' } }}
                  onMouseLeave={(e) => { if (!isActive) { e.currentTarget.style.background = ''; e.currentTarget.style.borderColor = 'transparent' } }}
                >
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: p.color + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <div style={{ width: 11, height: 11, borderRadius: 3, background: p.color }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: isActive ? 'var(--accent)' : 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                    {p.desc && <div style={{ fontSize: 11, color: 'var(--text3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.desc}</div>}
                    <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>{p.members.length} member{p.members.length !== 1 ? 's' : ''}</div>
                  </div>
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
