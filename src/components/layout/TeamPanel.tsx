import { useState } from 'react'
import { useStore } from '../../store'
import { hexRgb, initials } from '../../utils/format'
import { todayStr, formatDate } from '../../utils/dates'
import type { Developer } from '../../types'
import Icon, { BrandIcon } from '../ui/Icon'
import EmptyState from '../ui/EmptyState'
import ConfirmDialog from '../ui/ConfirmDialog'

const PANEL_W = 560

interface PanelProps {
  open: boolean
  onClose: () => void
  topOffset: number
}

const PALETTE = ['#2563eb', '#d97706', '#16a34a', '#0d9488', '#db2777', '#7c3aed', '#dc2626']

/*
 * Raw editable rows for an identity field: unlike identityList(), this KEEPS blank rows,
 * because a just-added empty row must survive long enough for the user to type into it.
 * Only handles the legacy bare-string shape; everything else is passed through as-is.
 */
function identityRows(value: string | string[] | undefined): string[] {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

const field: React.CSSProperties = {
  width: '100%', padding: '7px 9px', borderRadius: 7, border: '1px solid var(--border)',
  background: 'var(--surface)', color: 'var(--text)', fontSize: 13, outline: 'none', boxSizing: 'border-box',
}
const label: React.CSSProperties = {
  display: 'block', fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 600,
  letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 4,
}

/*
 * One identity per row, with a + to add more — a developer often has several accounts per
 * service (work vs personal, a renamed handle, separate Jira instances) and every one of
 * them is used when syncing. Always emits an array, even for a single value, so callers
 * never have to deal with the legacy bare-string shape.
 */
function IdentityRows({ values, placeholder, onChange }: {
  values: string[]
  placeholder: string
  onChange: (next: string[]) => void
}) {
  /*
   * Rows are rendered from the RAW stored array, not a cleaned list: a freshly added row
   * is empty, and filtering blanks out would delete it the instant it appeared, making
   * "Add another" look broken. Blanks are ignored when reading (identityList) and are
   * harmless in storage, so they can safely live here until the user types or removes them.
   */
  const rows = values.length ? values : ['']

  const setAt = (i: number, v: string) => {
    const next = [...rows]
    next[i] = v
    onChange(next)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {rows.map((v, i) => (
        <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input style={field} value={v} placeholder={placeholder} onChange={(e) => setAt(i, e.target.value)} />
          {rows.length > 1 && (
            <button
              onClick={() => onChange(rows.filter((_, j) => j !== i))}
              title="Remove"
              style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text3)', cursor: 'pointer', display: 'flex', padding: 5, flexShrink: 0 }}
            >
              <Icon name="close" size={11} />
            </button>
          )}
        </div>
      ))}
      <button
        onClick={() => onChange([...rows, ''])}
        style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 10, padding: '2px 0' }}
      >
        <Icon name="plus" size={10} /> Add another
      </button>
    </div>
  )
}

export default function TeamPanel({ open, onClose, topOffset }: PanelProps) {
  const developers = useStore((s) => s.developers)
  const projects = useStore((s) => s.projects)
  const addDeveloper = useStore((s) => s.addDeveloper)
  const updateDeveloper = useStore((s) => s.updateDeveloper)
  const removeDeveloper = useStore((s) => s.removeDeveloper)
  const archiveDeveloper = useStore((s) => s.archiveDeveloper)
  const unarchiveDeveloper = useStore((s) => s.unarchiveDeveloper)
  const toggleMember = useStore((s) => s.toggleMember)
  const setMemberJoinDate = useStore((s) => s.setMemberJoinDate)

  const [showArchived, setShowArchived] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ name: '', role: '', color: PALETTE[0]!, jiraEmail: '', gitlabUsername: '', githubUsername: '' })

  const active = developers.filter((d) => !d.archivedAt)
  const archived = developers.filter((d) => d.archivedAt)
  const shown = showArchived ? archived : active
  const deleting = developers.find((d) => d.id === deletingId)

  const resetDraft = () => setDraft({ name: '', role: '', color: PALETTE[0]!, jiraEmail: '', gitlabUsername: '', githubUsername: '' })

  const handleAdd = () => {
    if (!draft.name.trim()) return
    addDeveloper({
      name: draft.name.trim(),
      role: draft.role.trim() || 'Developer',
      color: draft.color,
      jiraEmail: draft.jiraEmail.trim() || undefined,
      gitlabUsername: draft.gitlabUsername.trim() || undefined,
      githubUsername: draft.githubUsername.trim() || undefined,
    })
    resetDraft()
    setAdding(false)
  }

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 190, background: 'rgba(10,14,35,.2)', backdropFilter: 'blur(1px)', WebkitBackdropFilter: 'blur(1px)' }} />
      )}

      <div style={{
        position: 'fixed', top: topOffset, left: 0, width: PANEL_W, maxWidth: '100vw',
        height: `calc(100vh - ${topOffset}px)`,
        background: 'var(--surface)', borderRight: '1px solid var(--border)',
        boxShadow: open ? '8px 0 40px rgba(25,35,90,.13)' : 'none',
        zIndex: 200, display: 'flex', flexDirection: 'column',
        transform: open ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform .24s cubic-bezier(.4,0,.2,1), box-shadow .24s',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <Icon name="users" size={15} color="var(--accent)" />
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '1px' }}>Team</span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', background: 'var(--surface3)', borderRadius: 20, padding: '2px 8px' }}>
            {active.length} active{archived.length > 0 ? ` · ${archived.length} archived` : ''}
          </span>
          <button onClick={onClose} title="Close" className="icon-btn" style={{ marginLeft: 'auto' }}>
            <Icon name="close" size={14} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px' }}>
      {/* actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {archived.length > 0 && (
          <button className="btn-soft" onClick={() => setShowArchived((v) => !v)}>
            <Icon name="archive" size={12} /> {showArchived ? 'Show active' : `Archived (${archived.length})`}
          </button>
        )}
        <button
          onClick={() => { setAdding((v) => !v); setEditingId(null) }}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginLeft: 'auto', padding: '6px 12px', borderRadius: 8, border: '1px solid var(--accent)', background: adding ? 'var(--accent-dim)' : 'var(--accent)', color: adding ? 'var(--accent)' : '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
        >
          <Icon name="plus" size={13} /> Add developer
        </button>
      </div>

      {/* add form */}
      {adding && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--accent)', borderRadius: 'var(--rl)', padding: 14, marginBottom: 14, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
          <div>
            <span style={label}>Name</span>
            <input autoFocus style={field} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Full name" onKeyDown={(e) => e.key === 'Enter' && handleAdd()} />
          </div>
          <div>
            <span style={label}>Role</span>
            <input style={field} value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} placeholder="e.g. Frontend" onKeyDown={(e) => e.key === 'Enter' && handleAdd()} />
          </div>
          <div>
            <span style={{ ...label, display: 'inline-flex', alignItems: 'center', gap: 5 }}><BrandIcon brand="jira" size={10} /> Jira email</span>
            <input style={field} value={draft.jiraEmail} onChange={(e) => setDraft({ ...draft, jiraEmail: e.target.value })} placeholder="name@company.com" />
          </div>
          <div>
            <span style={{ ...label, display: 'inline-flex', alignItems: 'center', gap: 5 }}><BrandIcon brand="gitlab" size={10} /> GitLab username</span>
            <input style={field} value={draft.gitlabUsername} onChange={(e) => setDraft({ ...draft, gitlabUsername: e.target.value })} placeholder="username" />
          </div>
          <div>
            <span style={{ ...label, display: 'inline-flex', alignItems: 'center', gap: 5 }}><BrandIcon brand="github" size={10} /> GitHub username</span>
            <input style={field} value={draft.githubUsername} onChange={(e) => setDraft({ ...draft, githubUsername: e.target.value })} placeholder="username" />
          </div>
          <div>
            <span style={label}>Color</span>
            <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
              {PALETTE.map((c) => (
                <span key={c} onClick={() => setDraft({ ...draft, color: c })} title={c}
                  style={{ width: 22, height: 22, borderRadius: 6, cursor: 'pointer', background: c, border: `2px solid ${draft.color === c ? 'var(--text)' : 'transparent'}` }} />
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
            <button className="btn-soft" style={{ flex: 1, justifyContent: 'center' }} onClick={() => { setAdding(false); resetDraft() }}>Cancel</button>
            <button
              onClick={handleAdd}
              disabled={!draft.name.trim()}
              style={{ flex: 1, justifyContent: 'center', display: 'inline-flex', alignItems: 'center', padding: '7px 12px', borderRadius: 7, border: '1px solid var(--accent)', background: draft.name.trim() ? 'var(--accent)' : 'var(--surface2)', color: draft.name.trim() ? '#fff' : 'var(--text4)', cursor: draft.name.trim() ? 'pointer' : 'default', fontSize: 12, fontWeight: 600 }}
            >Add</button>
          </div>
        </div>
      )}

      {shown.length === 0 ? (
        <EmptyState
          icon="users"
          title={showArchived ? 'No archived developers' : 'No developers yet'}
          hint={showArchived ? undefined : 'Add your first developer with the button above'}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {shown.map((dev) => (
            <DevCard
              key={dev.id}
              dev={dev}
              projects={projects}
              expanded={editingId === dev.id}
              onToggle={() => setEditingId(editingId === dev.id ? null : dev.id)}
              onUpdate={(c) => updateDeveloper(dev.id, c)}
              onToggleMember={(projId) => toggleMember(projId, dev.id)}
              onJoinDate={(projId, date) => setMemberJoinDate(projId, dev.id, date)}
              onArchive={() => archiveDeveloper(dev.id, todayStr())}
              onUnarchive={() => unarchiveDeveloper(dev.id)}
              onDelete={() => setDeletingId(dev.id)}
            />
          ))}
        </div>
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete developer?"
          message={`"${deleting.name}" and ALL of their tasks will be permanently deleted. Archive them instead if you just want to hide them from current views.`}
          confirmLabel="Delete permanently"
          onConfirm={() => { removeDeveloper(deleting.id); setDeletingId(null) }}
          onCancel={() => setDeletingId(null)}
        />
      )}
        </div>
      </div>
    </>
  )
}

function DevCard({ dev, projects, expanded, onToggle, onUpdate, onToggleMember, onJoinDate, onArchive, onUnarchive, onDelete }: {
  dev: Developer
  projects: { id: string; name: string; color: string; members: string[]; joinDates?: Record<string, string> }[]
  expanded: boolean
  onToggle: () => void
  onUpdate: (c: Partial<Developer>) => void
  onToggleMember: (projId: string) => void
  onJoinDate: (projId: string, date: string | null) => void
  onArchive: () => void
  onUnarchive: () => void
  onDelete: () => void
}) {
  const rgb = hexRgb(dev.color)
  const memberOf = projects.filter((p) => p.members.includes(dev.id))

  return (
    <div style={{ background: 'var(--surface)', border: `1px solid ${expanded ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 'var(--rl)', overflow: 'hidden', opacity: dev.archivedAt ? 0.7 : 1 }}>
      {/* row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 14px' }}>
        <div className="av" style={{ background: `rgba(${rgb},.15)`, color: dev.color, width: 34, height: 34, fontSize: 12, flexShrink: 0, border: `1.5px solid ${dev.color}30` }}>{initials(dev.name)}</div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{dev.name}</span>
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>{dev.role}</span>
            {dev.archivedAt && (
              <span style={{ fontFamily: 'var(--mono)', fontSize: 9, background: 'var(--surface3)', color: 'var(--text3)', borderRadius: 4, padding: '1px 6px' }}>
                archived {formatDate(dev.archivedAt)}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 4 }}>
            {memberOf.length === 0 && <span style={{ fontSize: 10, color: 'var(--text4)', fontStyle: 'italic' }}>No projects</span>}
            {memberOf.map((p) => {
              const jd = p.joinDates?.[dev.id]
              return (
                <span key={p.id} title={jd ? `Joined ${formatDate(jd)}` : 'No join date set'}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: 'var(--mono)', fontSize: 9.5, color: 'var(--text3)', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 20, padding: '1px 7px' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: p.color }} />
                  {p.name}{jd ? ` · ${formatDate(jd)}` : ''}
                </span>
              )
            })}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
          <button onClick={onToggle} title={expanded ? 'Close' : 'Edit'} className="icon-btn"
            style={{ background: expanded ? 'var(--accent-dim)' : 'none', borderColor: expanded ? 'var(--accent)' : 'var(--border)', color: expanded ? 'var(--accent)' : 'var(--text3)' }}>
            <Icon name="edit" size={13} />
          </button>
          {dev.archivedAt
            ? <button onClick={onUnarchive} title="Restore" className="icon-btn"><Icon name="restore" size={13} /></button>
            : <button onClick={onArchive} title="Archive (keeps their history)" className="icon-btn"><Icon name="archive" size={13} /></button>}
        </div>
      </div>

      {/* editor */}
      {expanded && (
        <div style={{ borderTop: '1px solid var(--border)', background: 'var(--surface2)', padding: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
            <div>
              <span style={label}>Name</span>
              <input style={field} value={dev.name} onChange={(e) => onUpdate({ name: e.target.value })} />
            </div>
            <div>
              <span style={label}>Role</span>
              <input style={field} value={dev.role} onChange={(e) => onUpdate({ role: e.target.value })} />
            </div>
            <div>
              <span style={label}>Color</span>
              <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
                {PALETTE.map((c) => (
                  <span key={c} onClick={() => onUpdate({ color: c })} title={c}
                    style={{ width: 22, height: 22, borderRadius: 6, cursor: 'pointer', background: c, border: `2px solid ${dev.color === c ? 'var(--text)' : 'transparent'}` }} />
                ))}
                <input type="color" value={dev.color} onChange={(e) => onUpdate({ color: e.target.value })}
                  style={{ width: 30, height: 24, padding: 1, cursor: 'pointer', borderRadius: 6, border: '1px solid var(--border)', background: 'none' }} />
              </div>
            </div>
          </div>

          {/* integration identities */}
          <div>
            <span style={label}>Integrations</span>
            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
              <div>
                <span style={{ ...label, display: 'inline-flex', alignItems: 'center', gap: 5 }}><BrandIcon brand="jira" size={10} /> Jira emails</span>
                <IdentityRows
                  values={identityRows(dev.jiraEmail)}
                  placeholder="name@company.com"
                  onChange={(next) => onUpdate({ jiraEmail: next })}
                />
              </div>
              <div>
                <span style={{ ...label, display: 'inline-flex', alignItems: 'center', gap: 5 }}><BrandIcon brand="gitlab" size={10} /> GitLab usernames</span>
                <IdentityRows
                  values={identityRows(dev.gitlabUsername)}
                  placeholder="username"
                  onChange={(next) => onUpdate({ gitlabUsername: next })}
                />
              </div>
              <div>
                <span style={{ ...label, display: 'inline-flex', alignItems: 'center', gap: 5 }}><BrandIcon brand="github" size={10} /> GitHub usernames</span>
                <IdentityRows
                  values={identityRows(dev.githubUsername)}
                  placeholder="username"
                  onChange={(next) => onUpdate({ githubUsername: next })}
                />
              </div>
            </div>
            <div style={{ fontSize: 10, color: 'var(--text4)', marginTop: 6 }}>
              All values are used when syncing — add several if a developer has more than one
              account. A connection that sets its own override for this developer wins.
            </div>
          </div>

          {/* project membership + join dates */}
          <div>
            <span style={label}>Projects &amp; join dates</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {projects.length === 0 && <span style={{ fontSize: 11, color: 'var(--text4)', fontStyle: 'italic' }}>No projects yet</span>}
              {projects.map((p) => {
                const isMember = p.members.includes(dev.id)
                const jd = p.joinDates?.[dev.id] ?? ''
                return (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 9px', borderRadius: 7, background: isMember ? 'var(--surface)' : 'transparent', border: `1px solid ${isMember ? 'var(--border)' : 'transparent'}` }}>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer', flex: 1, minWidth: 0 }}>
                      <input type="checkbox" checked={isMember} onChange={() => onToggleMember(p.id)} style={{ cursor: 'pointer' }} />
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
                      <span style={{ fontSize: 12, color: isMember ? 'var(--text)' : 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                    </label>
                    {isMember && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text3)' }}>JOINED</span>
                        <input
                          type="date"
                          value={jd}
                          onChange={(e) => onJoinDate(p.id, e.target.value || null)}
                          style={{ ...field, width: 'auto', padding: '4px 7px', fontSize: 11, fontFamily: 'var(--mono)' }}
                        />
                        {jd && (
                          <button onClick={() => onJoinDate(p.id, null)} title="Clear join date"
                            style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', display: 'flex', padding: 2 }}>
                            <Icon name="close" size={11} />
                          </button>
                        )}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text4)', marginTop: 6 }}>
              Days before the join date are greyed out in Schedule and excluded from worked-day totals.
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--border)', paddingTop: 11 }}>
            <button onClick={onDelete}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 11px', borderRadius: 7, border: '1px solid var(--border)', background: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 11 }}>
              <Icon name="trash" size={12} /> Delete developer &amp; all their tasks
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
