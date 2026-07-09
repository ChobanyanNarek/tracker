import { useStore } from '../../store'
import { hexRgb, initials } from '../../utils/format'
import Modal from '../ui/Modal'

interface Props {
  projectId: string
  onClose: () => void
}

export default function MembersModal({ projectId, onClose }: Props) {
  const { developers, projects, toggleMember } = useStore()
  const project = projects.find((p) => p.id === projectId)
  if (!project) return null

  return (
    <Modal
      title="Project Members"
      subtitle={project.name}
      width={380}
      zIndex={1000}
      onClose={onClose}
      footer={<button className="btn-primary" onClick={onClose}>Done</button>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {developers.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text3)', textAlign: 'center', padding: '20px 0' }}>No developers added yet</div>
        ) : (
          developers.map((dev) => {
            const rgb = hexRgb(dev.color)
            const isMember = project.members.includes(dev.id)
            return (
              <div key={dev.id} onClick={() => toggleMember(projectId, dev.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 'var(--r)', border: `1px solid ${isMember ? 'var(--accent)' : 'var(--border)'}`, background: isMember ? 'var(--accent-dim)' : 'var(--surface2)', cursor: 'pointer', transition: 'all .15s' }}>
                <div className="av" style={{ background: `rgba(${rgb},.15)`, color: dev.color, width: 28, height: 28, fontSize: 10, flexShrink: 0 }}>{initials(dev.name)}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{dev.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>{dev.role}</div>
                </div>
                <div style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${isMember ? 'var(--accent)' : 'var(--border)'}`, background: isMember ? 'var(--accent)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all .15s' }}>
                  {isMember && <span style={{ color: '#fff', fontSize: 11, fontWeight: 700, lineHeight: 1 }}>✓</span>}
                </div>
              </div>
            )
          })
        )}
      </div>
    </Modal>
  )
}
