import { useState } from 'react'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { DragEndEvent } from '@dnd-kit/core'
import { useStore } from '../../store'
import { hexRgb, initials } from '../../utils/format'
import { todayStr } from '../../utils/dates'
import { DEFAULT_WORK_SCHEDULE, getSchedule } from '../../utils/working-hours'
import type { Developer, WorkSchedule } from '../../types'
import ConfirmDialog from '../ui/ConfirmDialog'

const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

interface Props {
  open: boolean
  onClose: () => void
  topOffset: number
}

// ── Sortable developer row ──────────────────────────────────────────────────

interface DevRowProps {
  dev: Developer
  isActive: boolean
  schedulingId: string | null
  archivingId: string | null
  schedDraft: WorkSchedule
  archiveDate: string
  onSelect: (id: string) => void
  onScheduleToggle: (id: string) => void
  onArchiveToggle: (id: string) => void
  onScheduleSave: (id: string) => void
  onScheduleCancel: () => void
  onArchiveConfirm: (id: string) => void
  onArchiveCancel: () => void
  onDeleteRequest: (id: string) => void
  setSchedDraft: React.Dispatch<React.SetStateAction<WorkSchedule>>
  setArchiveDate: (d: string) => void
}

function SortableDevRow({ dev, isActive, schedulingId, archivingId, schedDraft, archiveDate,
  onSelect, onScheduleToggle, onArchiveToggle, onScheduleSave, onScheduleCancel,
  onArchiveConfirm, onArchiveCancel, onDeleteRequest, setSchedDraft, setArchiveDate }: DevRowProps) {
  const { updateDeveloperSchedule } = useStore()
  const isScheduling = schedulingId === dev.id
  const isArchiving = archivingId === dev.id
  const rgb = hexRgb(dev.color)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: dev.id })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.45 : 1 }}
    >
      <div
        onClick={() => { if (!isArchiving && !isScheduling) onSelect(dev.id) }}
        style={{
          display: 'flex', alignItems: 'center', gap: 7, padding: '6px 8px',
          borderRadius: 'var(--r)', cursor: isArchiving || isScheduling ? 'default' : 'pointer',
          border: `1px solid ${isActive ? 'var(--accent)' : isDragging ? 'var(--accent)' : 'transparent'}`,
          background: isActive ? 'var(--accent-dim)' : isDragging ? 'var(--surface2)' : '',
          transition: 'all .15s',
        }}
        onMouseEnter={(e) => { if (!isActive && !isArchiving && !isScheduling && !isDragging) { e.currentTarget.style.background = 'var(--surface2)'; e.currentTarget.style.borderColor = 'var(--border)' } }}
        onMouseLeave={(e) => { if (!isActive && !isArchiving && !isScheduling && !isDragging) { e.currentTarget.style.background = ''; e.currentTarget.style.borderColor = 'transparent' } }}
      >
        {/* Drag handle */}
        <span
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          title="Drag to reorder"
          style={{ cursor: 'grab', color: 'var(--text4)', fontSize: 14, lineHeight: 1, padding: '2px 1px', userSelect: 'none', flexShrink: 0 }}
        >⠿</span>

        <div className="av" style={{ background: `rgba(${rgb},.15)`, color: dev.color, width: 28, height: 28, fontSize: 10, flexShrink: 0 }}>{initials(dev.name)}</div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: isActive ? 'var(--accent)' : 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{dev.name}</div>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>{dev.role}</div>
        </div>

        {/* Schedule button */}
        <button
          onClick={(e) => { e.stopPropagation(); onScheduleToggle(dev.id) }}
          title="Work schedule"
          style={{ background: isScheduling ? 'var(--accent-dim)' : 'none', border: `1px solid ${isScheduling ? 'var(--accent)' : 'var(--border)'}`, color: isScheduling ? 'var(--accent)' : 'var(--text3)', width: 22, height: 22, borderRadius: 5, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .15s', flexShrink: 0, cursor: 'pointer' }}
          onMouseEnter={(e) => { if (!isScheduling) { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.borderColor = 'var(--accent)' } }}
          onMouseLeave={(e) => { if (!isScheduling) { e.currentTarget.style.color = 'var(--text3)'; e.currentTarget.style.borderColor = 'var(--border)' } }}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5"/><path d="M8 5v3l2 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>

        {/* Archive button */}
        <button
          onClick={(e) => { e.stopPropagation(); onArchiveToggle(dev.id) }}
          title="Archive developer"
          style={{ background: isArchiving ? '#fef3c720' : 'none', border: `1px solid ${isArchiving ? 'var(--amber)' : 'var(--border)'}`, color: isArchiving ? 'var(--amber)' : 'var(--text3)', width: 22, height: 22, borderRadius: 5, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .15s', flexShrink: 0, cursor: 'pointer' }}
          onMouseEnter={(e) => { if (!isArchiving) { e.currentTarget.style.color = 'var(--amber)'; e.currentTarget.style.borderColor = 'var(--amber)' } }}
          onMouseLeave={(e) => { if (!isArchiving) { e.currentTarget.style.color = 'var(--text3)'; e.currentTarget.style.borderColor = 'var(--border)' } }}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="2" width="13" height="3" rx="1" stroke="currentColor" strokeWidth="1.5"/><path d="M2.5 5v7.5a1 1 0 001 1h9a1 1 0 001-1V5" stroke="currentColor" strokeWidth="1.5"/><path d="M6 9h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        </button>
      </div>

      {/* Inline schedule editor */}
      {isScheduling && (
        <div style={{ margin: '3px 0 4px', padding: '10px', background: 'var(--surface2)', border: '1px solid var(--accent)', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 9 }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '.6px', fontWeight: 600 }}>Work Schedule</div>
          <div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text3)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.4px' }}>Work days</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3 }}>
              {DAY_LABELS.map((lbl, i) => {
                const active = schedDraft.workDays.includes(i)
                return (
                  <button key={i} onClick={() => setSchedDraft((s) => ({ ...s, workDays: active ? s.workDays.filter((d) => d !== i) : [...s.workDays, i].sort() }))}
                    style={{ fontFamily: 'var(--mono)', fontSize: 9, padding: '4px 0', borderRadius: 4, border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`, background: active ? 'var(--accent-dim)' : 'var(--surface3)', color: active ? 'var(--accent)' : 'var(--text3)', cursor: 'pointer', fontWeight: active ? 700 : 400 }}
                  >{lbl}</button>
                )
              })}
            </div>
          </div>
          <div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text3)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.4px' }}>Hours window</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="time" value={schedDraft.startTime} onChange={(e) => setSchedDraft((s) => ({ ...s, startTime: e.target.value }))} style={{ flex: 1, minWidth: 0, background: 'var(--surface3)', border: '1px solid var(--border)', color: 'var(--text)', padding: '4px 4px', borderRadius: 5, fontSize: 11, outline: 'none' }} />
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>–</span>
              <input type="time" value={schedDraft.endTime} onChange={(e) => setSchedDraft((s) => ({ ...s, endTime: e.target.value }))} style={{ flex: 1, minWidth: 0, background: 'var(--surface3)', border: '1px solid var(--border)', color: 'var(--text)', padding: '4px 4px', borderRadius: 5, fontSize: 11, outline: 'none' }} />
            </div>
          </div>
          <div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text3)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.4px' }}>Productive h/day</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="range" min={0.5} max={24} step={0.5} value={schedDraft.dailyHours} onChange={(e) => setSchedDraft((s) => ({ ...s, dailyHours: Number(e.target.value) }))} style={{ flex: 1, minWidth: 0, accentColor: 'var(--accent)' }} />
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text)', fontWeight: 600, minWidth: 28, textAlign: 'right' }}>{schedDraft.dailyHours}h</span>
            </div>
          </div>
          <div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text3)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.4px' }}>Timezone (IANA)</div>
            <input type="text" value={schedDraft.timezone ?? ''} onChange={(e) => setSchedDraft((s) => ({ ...s, timezone: e.target.value.trim() || undefined }))} placeholder={Intl.DateTimeFormat().resolvedOptions().timeZone} style={{ width: '100%', background: 'var(--surface3)', border: '1px solid var(--border)', color: 'var(--text)', padding: '4px 6px', borderRadius: 5, fontSize: 11, outline: 'none', fontFamily: 'var(--mono)', boxSizing: 'border-box' }} />
          </div>
          <div style={{ display: 'flex', gap: 5 }}>
            <button onClick={() => { updateDeveloperSchedule(dev.id, schedDraft); onScheduleSave(dev.id) }} style={{ flex: 1, fontFamily: 'var(--mono)', fontSize: 10, padding: '5px 0', borderRadius: 5, border: '1px solid var(--accent)', background: 'var(--accent-dim)', color: 'var(--accent)', cursor: 'pointer', fontWeight: 600 }}>Save</button>
            <button onClick={onScheduleCancel} style={{ flex: 1, fontFamily: 'var(--mono)', fontSize: 10, padding: '5px 0', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--surface3)', color: 'var(--text3)', cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Inline archive form */}
      {isArchiving && (
        <div style={{ margin: '2px 0 4px', padding: '8px 10px', background: 'var(--surface3)', border: '1px solid var(--border)', borderRadius: 'var(--r)', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.5px' }}>Archive date</div>
          <input type="date" value={archiveDate} onChange={(e) => setArchiveDate(e.target.value)} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '4px 7px', borderRadius: 5, fontSize: 12, width: '100%', outline: 'none' }} />
          <div style={{ display: 'flex', gap: 5 }}>
            <button onClick={() => onArchiveConfirm(dev.id)} style={{ flex: 1, fontFamily: 'var(--mono)', fontSize: 10, padding: '4px 0', borderRadius: 5, border: '1px solid var(--amber)', background: '#fef3c720', color: 'var(--amber)', cursor: 'pointer' }}>Archive</button>
            <button onClick={onArchiveCancel} style={{ flex: 1, fontFamily: 'var(--mono)', fontSize: 10, padding: '4px 0', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text3)', cursor: 'pointer' }}>Cancel</button>
          </div>
          <button onClick={() => onDeleteRequest(dev.id)} style={{ fontFamily: 'var(--mono)', fontSize: 10, padding: '4px 0', borderRadius: 5, border: '1px solid var(--border)', background: 'none', color: 'var(--red)', cursor: 'pointer', opacity: 0.7 }}>Delete permanently</button>
        </div>
      )}
    </div>
  )
}

// ── Main panel ──────────────────────────────────────────────────────────────

export default function DevPanel({ open, onClose, topOffset }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [color, setColor] = useState('#2563eb')
  const [archivingId, setArchivingId] = useState<string | null>(null)
  const [archiveDate, setArchiveDate] = useState(todayStr())
  const [showArchived, setShowArchived] = useState(false)
  const [schedulingId, setSchedulingId] = useState<string | null>(null)
  const [schedDraft, setSchedDraft] = useState<WorkSchedule>(DEFAULT_WORK_SCHEDULE)
  const [deletingDevId, setDeletingDevId] = useState<string | null>(null)

  const { developers, selectedDev, setSelectedDev, addDeveloper, archiveDeveloper,
    unarchiveDeveloper, removeDeveloper, reorderDeveloper } = useStore()

  const deletingDev = developers.find((d) => d.id === deletingDevId)

  const activeDevs = developers.filter((d) => !d.archivedAt)
  const archivedDevs = developers.filter((d) => !!d.archivedAt)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    reorderDeveloper(String(active.id), String(over.id))
  }

  const handleAdd = () => {
    if (!name.trim()) return
    addDeveloper({ name: name.trim(), role: role.trim() || 'Developer', color })
    setName(''); setRole(''); setShowForm(false)
  }

  const selectDev = (id: string | 'ALL') => {
    setSelectedDev(id)
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
          <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.9px' }}>Developers</span>
          <div style={{ display: 'flex', gap: 5 }}>
            <button onClick={() => { setShowForm((s) => !s); setArchivingId(null); setSchedulingId(null) }} style={{ background: showForm ? 'var(--accent-dim)' : 'none', border: `1px solid ${showForm ? 'var(--accent)' : 'var(--border2)'}`, color: 'var(--accent)', fontSize: 14, width: 22, height: 22, borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .15s', cursor: 'pointer' }} title="Add developer">+</button>
            <button onClick={onClose} className="icon-btn" style={{ fontSize: 13 }}>✕</button>
          </div>
        </div>

        {/* Add developer form */}
        {showForm && (
          <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 5, flexShrink: 0, background: 'var(--surface2)' }}>
            <input className="field" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" onKeyDown={(e) => e.key === 'Enter' && document.getElementById('dp-role-input')?.focus()} />
            <input className="field" id="dp-role-input" value={role} onChange={(e) => setRole(e.target.value)} placeholder="Role (e.g. Frontend)" onKeyDown={(e) => e.key === 'Enter' && handleAdd()} />
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ height: 28, padding: '2px 4px', cursor: 'pointer', borderRadius: 5, border: '1px solid var(--border)', width: '100%' }} />
            <div style={{ display: 'flex', gap: 5 }}>
              <button className="btn-soft" style={{ flex: 1, justifyContent: 'center' }} onClick={handleAdd}>Add</button>
              <button className="btn-secondary" style={{ flex: 1, padding: '5px 0' }} onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </div>
        )}

        {/* Scrollable list */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minHeight: 0 }}>
          {/* All */}
          <div style={{ padding: '6px 8px 2px' }}>
            <div onClick={() => selectDev('ALL')} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', borderRadius: 'var(--r)', cursor: 'pointer', border: `1px solid ${selectedDev === 'ALL' ? 'var(--accent)' : 'var(--border)'}`, background: selectedDev === 'ALL' ? 'var(--accent-dim)' : 'var(--surface2)', transition: 'all .15s' }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--surface3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0 }}>⚡</div>
              <span style={{ fontSize: 13, fontWeight: 500, color: selectedDev === 'ALL' ? 'var(--accent)' : 'var(--text2)', flex: 1 }}>All developers</span>
            </div>
          </div>

          {/* DnD sortable developer list */}
          <div style={{ padding: '4px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={activeDevs.map((d) => d.id)} strategy={verticalListSortingStrategy}>
                {activeDevs.map((dev) => (
                  <SortableDevRow
                    key={dev.id}
                    dev={dev}
                    isActive={selectedDev === dev.id}
                    schedulingId={schedulingId}
                    archivingId={archivingId}
                    schedDraft={schedDraft}
                    archiveDate={archiveDate}
                    onSelect={selectDev}
                    onScheduleToggle={(id) => { setSchedDraft(getSchedule(dev)); setSchedulingId(schedulingId === id ? null : id); setArchivingId(null) }}
                    onArchiveToggle={(id) => { setArchivingId(archivingId === id ? null : id); setArchiveDate(todayStr()); setSchedulingId(null) }}
                    onScheduleSave={() => setSchedulingId(null)}
                    onScheduleCancel={() => setSchedulingId(null)}
                    onArchiveConfirm={(id) => { archiveDeveloper(id, archiveDate); setArchivingId(null) }}
                    onArchiveCancel={() => setArchivingId(null)}
                    onDeleteRequest={(id) => setDeletingDevId(id)}
                    setSchedDraft={setSchedDraft}
                    setArchiveDate={setArchiveDate}
                  />
                ))}
              </SortableContext>
            </DndContext>
          </div>

          {/* Archived developers */}
          {archivedDevs.length > 0 && (
            <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0 0' }}>
              <button onClick={() => setShowArchived((s) => !s)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 13px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.7px' }}>
                <span>Archived ({archivedDevs.length})</span>
                <span style={{ fontSize: 9, opacity: 0.6 }}>{showArchived ? '▲' : '▼'}</span>
              </button>
              {showArchived && (
                <div style={{ padding: '0 8px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {archivedDevs.map((dev) => {
                    const rgb = hexRgb(dev.color)
                    return (
                      <div key={dev.id} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 8px', borderRadius: 'var(--r)', border: '1px solid var(--border)', background: 'var(--surface2)', opacity: 0.65 }}>
                        <div className="av" style={{ background: `rgba(${rgb},.15)`, color: dev.color, width: 26, height: 26, fontSize: 10 }}>{initials(dev.name)}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{dev.name}</div>
                          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>until {new Date(dev.archivedAt! + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flexShrink: 0 }}>
                          <button onClick={() => unarchiveDeveloper(dev.id)} title="Restore" style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text3)', fontSize: 10, padding: '2px 5px', borderRadius: 4, cursor: 'pointer', lineHeight: 1, transition: 'all .15s' }} onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.borderColor = 'var(--accent)' }} onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text3)'; e.currentTarget.style.borderColor = 'var(--border)' }}>↩</button>
                          <button onClick={() => setDeletingDevId(dev.id)} title="Delete" style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text3)', fontSize: 10, padding: '2px 5px', borderRadius: 4, cursor: 'pointer', lineHeight: 1, transition: 'all .15s' }} onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--red)'; e.currentTarget.style.borderColor = 'var(--red)' }} onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text3)'; e.currentTarget.style.borderColor = 'var(--border)' }}>✕</button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {deletingDev && (
        <ConfirmDialog
          title={`Remove ${deletingDev.name} permanently?`}
          message="The developer and ALL their checkpoints across every date will be permanently removed. Consider archiving instead — it keeps the history."
          confirmLabel="Delete forever"
          onConfirm={() => { removeDeveloper(deletingDev.id); setDeletingDevId(null); setArchivingId(null) }}
          onCancel={() => setDeletingDevId(null)}
        />
      )}
    </>
  )
}
