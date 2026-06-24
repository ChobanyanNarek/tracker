import { useState } from 'react'
import { useStore, getVisibleDevIds } from '../../store'
import { hexRgb, initials } from '../../utils/format'
import { todayStr } from '../../utils/dates'

export default function Sidebar() {
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [color, setColor] = useState('#2563eb')
  const [archivingId, setArchivingId] = useState<string | null>(null)
  const [archiveDate, setArchiveDate] = useState(todayStr())
  const [showArchived, setShowArchived] = useState(false)

  const { developers, selectedDev, selectedProject, setSelectedDev, addDeveloper, removeDeveloper, archiveDeveloper, unarchiveDeveloper } = useStore()
  const state = useStore()
  const visibleIds = getVisibleDevIds(state)

  const activeDevs = developers.filter((d) => !d.archivedAt)
  const archivedDev = developers.filter((d) => !!d.archivedAt)
  const visibleActive = activeDevs.filter((d) => visibleIds.includes(d.id))

  const handleAdd = () => {
    if (!name.trim()) return
    addDeveloper({ name: name.trim(), role: role.trim() || 'Developer', color })
    setName(''); setRole(''); setShowForm(false)
  }

  const confirmArchive = (id: string) => {
    archiveDeveloper(id, archiveDate)
    setArchivingId(null)
  }

  return (
    <div style={{ width: 215, flexShrink: 0, borderRight: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
      <div style={{ padding: '11px 13px 8px', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.8px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        Developers
        <button onClick={() => setShowForm((s) => !s)} style={{ background: 'none', border: '1px solid var(--border2)', color: 'var(--accent)', fontSize: 14, width: 20, height: 20, borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .15s' }}>+</button>
      </div>

      {/* All */}
      <div
        onClick={() => setSelectedDev('ALL')}
        style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 8px', borderRadius: 'var(--r)', cursor: 'pointer', border: `1px solid ${selectedDev === 'ALL' ? 'var(--accent)' : 'var(--border)'}`, background: selectedDev === 'ALL' ? 'var(--accent-dim)' : 'var(--surface2)', margin: '6px 6px 0', transition: 'all .15s' }}
      >
        <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--surface3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0 }}>⚡</div>
        <span style={{ fontSize: 13, fontWeight: 500, color: selectedDev === 'ALL' ? 'var(--accent)' : 'var(--text2)', flex: 1 }}>All</span>
      </div>

      {/* Active developers */}
      <div style={{ padding: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {selectedProject !== 'ALL' && visibleActive.length === 0 ? (
          <div style={{ padding: '10px 13px', fontSize: 12, color: 'var(--text3)', fontFamily: 'var(--mono)', lineHeight: 1.6 }}>
            No members assigned.
          </div>
        ) : (
          visibleActive.map((dev) => {
            const rgb = hexRgb(dev.color)
            const isActive = selectedDev === dev.id
            const isArchiving = archivingId === dev.id
            return (
              <div key={dev.id}>
                <div
                  onClick={() => { if (!isArchiving) setSelectedDev(dev.id) }}
                  style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 8px', borderRadius: 'var(--r)', cursor: isArchiving ? 'default' : 'pointer', border: `1px solid ${isActive ? 'var(--accent)' : 'transparent'}`, background: isActive ? 'var(--accent-dim)' : '', transition: 'all .15s' }}
                  onMouseEnter={(e) => { if (!isActive && !isArchiving) { e.currentTarget.style.background = 'var(--surface2)'; e.currentTarget.style.borderColor = 'var(--border)' } }}
                  onMouseLeave={(e) => { if (!isActive && !isArchiving) { e.currentTarget.style.background = ''; e.currentTarget.style.borderColor = 'transparent' } }}
                >
                  <div className="av" style={{ background: `rgba(${rgb},.15)`, color: dev.color, width: 26, height: 26, fontSize: 10 }}>{initials(dev.name)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: isActive ? 'var(--accent)' : 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{dev.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)' }}>{dev.role}</div>
                  </div>
                  {/* Archive button */}
                  <button
                    onClick={(e) => { e.stopPropagation(); setArchivingId(dev.id); setArchiveDate(todayStr()) }}
                    style={{ background: 'none', border: 'none', color: 'transparent', fontSize: 11, padding: 2, transition: 'all .15s', flexShrink: 0, lineHeight: 1 }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--amber)')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = 'transparent')}
                    title="Archive developer"
                  >▾</button>
                </div>

                {/* Inline archive form */}
                {isArchiving && (
                  <div style={{ margin: '2px 4px 4px', padding: '8px 10px', background: 'var(--surface3)', border: '1px solid var(--border)', borderRadius: 'var(--r)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.5px' }}>Archive date</div>
                    <input
                      type="date"
                      value={archiveDate}
                      onChange={(e) => setArchiveDate(e.target.value)}
                      style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '4px 7px', borderRadius: 5, fontSize: 12, width: '100%', outline: 'none' }}
                    />
                    <div style={{ display: 'flex', gap: 5 }}>
                      <button
                        onClick={() => confirmArchive(dev.id)}
                        style={{ flex: 1, fontFamily: 'var(--mono)', fontSize: 10, padding: '4px 0', borderRadius: 5, border: '1px solid var(--amber)', background: '#fef3c720', color: 'var(--amber)', cursor: 'pointer' }}
                      >Archive</button>
                      <button
                        onClick={() => setArchivingId(null)}
                        style={{ flex: 1, fontFamily: 'var(--mono)', fontSize: 10, padding: '4px 0', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text3)', cursor: 'pointer' }}
                      >Cancel</button>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); if (confirm('Permanently remove developer and all their tasks?')) { removeDeveloper(dev.id); setArchivingId(null) } }}
                      style={{ fontFamily: 'var(--mono)', fontSize: 10, padding: '4px 0', borderRadius: 5, border: '1px solid var(--border)', background: 'none', color: 'var(--red)', cursor: 'pointer', opacity: 0.7 }}
                    >Delete permanently</button>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Archived developers */}
      {archivedDev.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border)', marginTop: 'auto' }}>
          <button
            onClick={() => setShowArchived((s) => !s)}
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 13px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.7px' }}
          >
            <span>Archived ({archivedDev.length})</span>
            <span style={{ fontSize: 9, opacity: 0.6 }}>{showArchived ? '▲' : '▼'}</span>
          </button>

          {showArchived && (
            <div style={{ padding: '0 6px 6px', display: 'flex', flexDirection: 'column', gap: 2 }}>
              {archivedDev.map((dev) => {
                const rgb = hexRgb(dev.color)
                return (
                  <div
                    key={dev.id}
                    style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 8px', borderRadius: 'var(--r)', border: '1px solid var(--border)', background: 'var(--surface2)', opacity: 0.65 }}
                  >
                    <div className="av" style={{ background: `rgba(${rgb},.15)`, color: dev.color, width: 26, height: 26, fontSize: 10 }}>{initials(dev.name)}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{dev.name}</div>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>
                        until {new Date(dev.archivedAt! + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flexShrink: 0 }}>
                      <button
                        onClick={() => unarchiveDeveloper(dev.id)}
                        title="Restore developer"
                        style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text3)', fontSize: 10, padding: '2px 5px', borderRadius: 4, cursor: 'pointer', lineHeight: 1, transition: 'all .15s' }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.borderColor = 'var(--accent)' }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text3)'; e.currentTarget.style.borderColor = 'var(--border)' }}
                      >↩</button>
                      <button
                        onClick={() => { if (confirm('Permanently remove developer and all their tasks?')) removeDeveloper(dev.id) }}
                        title="Delete permanently"
                        style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text3)', fontSize: 10, padding: '2px 5px', borderRadius: 4, cursor: 'pointer', lineHeight: 1, transition: 'all .15s' }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--red)'; e.currentTarget.style.borderColor = 'var(--red)' }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text3)'; e.currentTarget.style.borderColor = 'var(--border)' }}
                      >✕</button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Add developer form */}
      {showForm && (
        <div style={{ padding: 8, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 5 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" onKeyDown={(e) => e.key === 'Enter' && document.getElementById('dev-role-input')?.focus()} style={{ background: 'var(--surface3)', border: '1px solid var(--border)', color: 'var(--text)', padding: '5px 8px', borderRadius: 5, outline: 'none', width: '100%', fontSize: 12 }} />
          <input id="dev-role-input" value={role} onChange={(e) => setRole(e.target.value)} placeholder="Role (e.g. Frontend)" onKeyDown={(e) => e.key === 'Enter' && handleAdd()} style={{ background: 'var(--surface3)', border: '1px solid var(--border)', color: 'var(--text)', padding: '5px 8px', borderRadius: 5, outline: 'none', width: '100%', fontSize: 12 }} />
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ height: 28, padding: '2px 4px', cursor: 'pointer', borderRadius: 5, border: '1px solid var(--border)', width: '100%' }} />
          <div style={{ display: 'flex', gap: 5 }}>
            <button onClick={handleAdd} style={{ flex: 1, fontFamily: 'var(--mono)', fontSize: 10, padding: 4, borderRadius: 5, border: '1px solid var(--accent)', background: 'var(--accent-dim)', color: 'var(--accent)' }}>Add</button>
            <button onClick={() => setShowForm(false)} style={{ flex: 1, fontFamily: 'var(--mono)', fontSize: 10, padding: 4, borderRadius: 5, border: '1px solid var(--border)', background: 'var(--surface3)', color: 'var(--text3)' }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
