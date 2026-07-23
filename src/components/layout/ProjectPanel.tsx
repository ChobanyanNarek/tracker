import { useState, useEffect } from 'react'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { DragEndEvent } from '@dnd-kit/core'
import { useStore } from '../../store'
import { PALETTE } from '../../constants'
import { hexRgb, initials } from '../../utils/format'
import { todayStr, formatDate } from '../../utils/dates'
import { DEFAULT_WORK_SCHEDULE, getSchedule } from '../../utils/working-hours'
import { fetchJiraBoards, type JiraBoardInfo } from '../../utils/jira-api'
import type { Developer, WorkSchedule } from '../../types'
import ConfirmDialog from '../ui/ConfirmDialog'
import JiraConfigModal from '../modals/JiraConfigModal'
import GitLabConfigModal from '../modals/GitLabConfigModal'
import GitHubConfigModal from '../modals/GitHubConfigModal'

interface Props {
  open: boolean
  onClose: () => void
  topOffset: number
}

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]
const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const DAY_FULL = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DOW_NAME = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const SCHED_DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

const PANEL_W = 340
const EDIT_W = 380

// ── Icons ───────────────────────────────────────────────────────────────────

const IcoFolder = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
  </svg>
)
const IcoPencil = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
  </svg>
)
const IcoTrash = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
    <path d="M10 11v6M14 11v6"/>
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
  </svg>
)
const IcoClock = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5"/><path d="M8 5v3l2 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
)
const IcoArchive = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="2" width="13" height="3" rx="1" stroke="currentColor" strokeWidth="1.5"/><path d="M2.5 5v7.5a1 1 0 001 1h9a1 1 0 001-1V5" stroke="currentColor" strokeWidth="1.5"/><path d="M6 9h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
)
const IcoChevronLeft = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
)

// ── Shared field styles ──────────────────────────────────────────────────────

const field: React.CSSProperties = {
  padding: '9px 12px', fontSize: 13, background: 'var(--surface)',
  border: '1.5px solid var(--border)', borderRadius: 9, color: 'var(--text)',
  width: '100%', boxSizing: 'border-box', outline: 'none',
}
const label: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: 'var(--text3)', letterSpacing: '.5px',
  textTransform: 'uppercase', marginBottom: 5, display: 'block',
}
const section: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 5 }

// ── DayPicker ────────────────────────────────────────────────────────────────

function DayPicker({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  const toggle = (d: number) => onChange(value.includes(d) ? value.filter(x => x !== d) : [...value, d].sort())
  return (
    <div style={{ display: 'flex', gap: 5 }}>
      {WEEK_ORDER.map((dow, i) => {
        const on = value.includes(dow)
        return (
          <button key={dow} type="button" onClick={() => toggle(dow)} title={DAY_FULL[i]} style={{
            flex: 1, height: 34, borderRadius: 8, fontSize: 11, fontWeight: 700,
            border: `1.5px solid ${on ? 'var(--accent)' : 'var(--border2)'}`,
            background: on ? 'var(--accent-dim)' : 'none',
            color: on ? 'var(--accent)' : 'var(--text3)',
            cursor: 'pointer', transition: 'all .12s', padding: 0,
          }}>{DAY_LABELS[i]}</button>
        )
      })}
    </div>
  )
}

// ── Sortable dev row ─────────────────────────────────────────────────────────

interface DevRowProps {
  dev: Developer
  schedulingId: string | null
  archivingId: string | null
  schedDraft: WorkSchedule
  archiveDate: string
  onScheduleToggle: (id: string) => void
  onArchiveToggle: (id: string) => void
  onScheduleSave: () => void
  onScheduleCancel: () => void
  onArchiveConfirm: (id: string) => void
  onArchiveCancel: () => void
  onDeleteRequest: (id: string) => void
  setSchedDraft: React.Dispatch<React.SetStateAction<WorkSchedule>>
  setArchiveDate: (d: string) => void
}

function SortableDevRow({ dev, schedulingId, archivingId, schedDraft, archiveDate,
  onScheduleToggle, onArchiveToggle, onScheduleSave, onScheduleCancel,
  onArchiveConfirm, onArchiveCancel, onDeleteRequest, setSchedDraft, setArchiveDate }: DevRowProps) {
  const { updateDeveloperSchedule } = useStore()
  const isScheduling = schedulingId === dev.id
  const isArchiving = archivingId === dev.id
  const rgb = hexRgb(dev.color)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: dev.id })

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
        borderRadius: 10, border: `1.5px solid ${isDragging ? 'var(--accent)' : 'var(--border)'}`,
        background: 'var(--surface)', marginBottom: 6, transition: 'all .15s',
      }}>
        <span {...attributes} {...listeners} onClick={e => e.stopPropagation()}
          style={{ cursor: 'grab', color: 'var(--text4)', fontSize: 15, lineHeight: 1, userSelect: 'none', flexShrink: 0 }}>⠿</span>

        <div className="av" style={{ background: `rgba(${rgb},.15)`, color: dev.color, width: 36, height: 36, fontSize: 12, flexShrink: 0, borderRadius: 10 }}>{initials(dev.name)}</div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{dev.name}</div>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>{dev.role}</div>
        </div>

        <button onClick={e => { e.stopPropagation(); onScheduleToggle(dev.id) }} title="Schedule"
          style={{ background: isScheduling ? 'var(--accent-dim)' : 'none', border: `1.5px solid ${isScheduling ? 'var(--accent)' : 'var(--border)'}`, color: isScheduling ? 'var(--accent)' : 'var(--text3)', width: 30, height: 30, borderRadius: 7, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
          onMouseEnter={e => { if (!isScheduling) { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.borderColor = 'var(--accent)' } }}
          onMouseLeave={e => { if (!isScheduling) { e.currentTarget.style.color = 'var(--text3)'; e.currentTarget.style.borderColor = 'var(--border)' } }}
        ><IcoClock /></button>

        <button onClick={e => { e.stopPropagation(); onArchiveToggle(dev.id) }} title="Archive"
          style={{ background: isArchiving ? '#fef3c720' : 'none', border: `1.5px solid ${isArchiving ? 'var(--amber)' : 'var(--border)'}`, color: isArchiving ? 'var(--amber)' : 'var(--text3)', width: 30, height: 30, borderRadius: 7, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
          onMouseEnter={e => { if (!isArchiving) { e.currentTarget.style.color = 'var(--amber)'; e.currentTarget.style.borderColor = 'var(--amber)' } }}
          onMouseLeave={e => { if (!isArchiving) { e.currentTarget.style.color = 'var(--text3)'; e.currentTarget.style.borderColor = 'var(--border)' } }}
        ><IcoArchive /></button>
      </div>

      {isScheduling && (
        <div style={{ marginBottom: 8, padding: '14px', background: 'var(--surface2)', border: '1.5px solid var(--accent)', borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '.6px' }}>Work Schedule — {dev.name}</div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 6, fontWeight: 600 }}>Work days</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
              {SCHED_DAY_LABELS.map((lbl, i) => {
                const on = schedDraft.workDays.includes(i)
                return (
                  <button key={i} onClick={() => setSchedDraft(s => ({ ...s, workDays: on ? s.workDays.filter(d => d !== i) : [...s.workDays, i].sort() }))}
                    style={{ fontSize: 11, padding: '6px 0', borderRadius: 6, border: `1.5px solid ${on ? 'var(--accent)' : 'var(--border)'}`, background: on ? 'var(--accent-dim)' : 'var(--surface3)', color: on ? 'var(--accent)' : 'var(--text3)', cursor: 'pointer', fontWeight: on ? 700 : 400 }}
                  >{lbl}</button>
                )
              })}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 6, fontWeight: 600 }}>Hours window</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="time" value={schedDraft.startTime} onChange={e => setSchedDraft(s => ({ ...s, startTime: e.target.value }))} style={{ flex: 1, background: 'var(--surface3)', border: '1.5px solid var(--border)', color: 'var(--text)', padding: '7px 8px', borderRadius: 7, fontSize: 12, outline: 'none' }} />
              <span style={{ color: 'var(--text3)', fontSize: 13 }}>–</span>
              <input type="time" value={schedDraft.endTime} onChange={e => setSchedDraft(s => ({ ...s, endTime: e.target.value }))} style={{ flex: 1, background: 'var(--surface3)', border: '1.5px solid var(--border)', color: 'var(--text)', padding: '7px 8px', borderRadius: 7, fontSize: 12, outline: 'none' }} />
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 6, fontWeight: 600 }}>Productive h/day — {schedDraft.dailyHours}h</div>
            <input type="range" min={0.5} max={24} step={0.5} value={schedDraft.dailyHours} onChange={e => setSchedDraft(s => ({ ...s, dailyHours: Number(e.target.value) }))} style={{ width: '100%', accentColor: 'var(--accent)' }} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 6, fontWeight: 600 }}>Timezone (IANA)</div>
            <input type="text" value={schedDraft.timezone ?? ''} onChange={e => setSchedDraft(s => ({ ...s, timezone: e.target.value.trim() || undefined }))} placeholder={Intl.DateTimeFormat().resolvedOptions().timeZone} style={{ width: '100%', background: 'var(--surface3)', border: '1.5px solid var(--border)', color: 'var(--text)', padding: '7px 10px', borderRadius: 7, fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => { updateDeveloperSchedule(dev.id, schedDraft); onScheduleSave() }} style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: '1.5px solid var(--accent)', background: 'var(--accent-dim)', color: 'var(--accent)', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>Save</button>
            <button onClick={onScheduleCancel} style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: '1.5px solid var(--border)', background: 'var(--surface3)', color: 'var(--text3)', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
          </div>
        </div>
      )}

      {isArchiving && (
        <div style={{ marginBottom: 8, padding: '14px', background: 'var(--surface3)', border: '1.5px solid var(--amber)', borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '.5px' }}>Archive {dev.name}</div>
          <input type="date" value={archiveDate} onChange={e => setArchiveDate(e.target.value)} style={{ background: 'var(--surface2)', border: '1.5px solid var(--border)', color: 'var(--text)', padding: '7px 10px', borderRadius: 7, fontSize: 13, width: '100%', outline: 'none' }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => onArchiveConfirm(dev.id)} style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: '1.5px solid var(--amber)', background: '#fef3c720', color: 'var(--amber)', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>Archive</button>
            <button onClick={onArchiveCancel} style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: '1.5px solid var(--border)', background: 'var(--surface2)', color: 'var(--text3)', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
          </div>
          <button onClick={() => onDeleteRequest(dev.id)} style={{ padding: '7px 0', borderRadius: 8, border: '1.5px solid var(--border)', background: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 13, opacity: 0.8 }}>Delete permanently</button>
        </div>
      )}
    </div>
  )
}

// ── Connection card ──────────────────────────────────────────────────────────

function ConnCard({ enabled, label, onSync }: { enabled: boolean; label: string; onSync: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 10, border: `1.5px solid ${enabled ? 'var(--border)' : 'var(--border)'}`, background: enabled ? 'var(--surface)' : 'var(--surface3)', marginBottom: 6 }}>
      <div style={{ width: 9, height: 9, borderRadius: '50%', background: enabled ? '#22c55e' : 'var(--text4)', flexShrink: 0, boxShadow: enabled ? '0 0 7px #22c55e99' : 'none' }} />
      <span style={{ fontSize: 13, fontWeight: 500, color: enabled ? 'var(--text)' : 'var(--text3)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ fontSize: 10, fontWeight: 700, color: enabled ? '#22c55e' : 'var(--text4)', letterSpacing: '.5px', flexShrink: 0 }}>{enabled ? 'ON' : 'OFF'}</span>
      <button onClick={onSync} title="Sync now" style={{ background: 'none', border: '1.5px solid var(--border)', color: 'var(--text3)', borderRadius: 6, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 14, flexShrink: 0 }}>⟳</button>
    </div>
  )
}

function UnassignedConnCard({ enabled, label, onAssign }: { enabled: boolean; label: string; onAssign: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 10, border: '1.5px dashed var(--border)', background: 'var(--surface3)', marginBottom: 6 }}>
      <div style={{ width: 9, height: 9, borderRadius: '50%', background: enabled ? '#22c55e' : 'var(--text4)', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
        <div style={{ fontSize: 10, color: 'var(--text4)', marginTop: 1 }}>Not assigned to any project</div>
      </div>
      <button onClick={onAssign} style={{ fontSize: 11, fontWeight: 600, background: 'var(--accent-dim)', border: '1.5px solid var(--accent)', color: 'var(--accent)', borderRadius: 7, padding: '5px 12px', cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}>Assign here</button>
    </div>
  )
}

// ── Section header ───────────────────────────────────────────────────────────

function SectionHeader({ title, onAdd }: { title: string; onAdd: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.6px' }}>{title}</span>
      <button onClick={onAdd} style={{ fontSize: 12, fontWeight: 600, background: 'var(--accent-dim)', border: '1.5px solid var(--accent)', color: 'var(--accent)', borderRadius: 7, padding: '5px 12px', cursor: 'pointer' }}>+ Add</button>
    </div>
  )
}

// ── Main panel ──────────────────────────────────────────────────────────────

export default function ProjectPanel({ open, onClose, topOffset }: Props) {
  // Project add form
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [color, setColor] = useState(PALETTE[0])
  const [nonWorkingDays, setNonWorkingDays] = useState<number[]>([0, 6])

  // Edit drawer state
  const [editingProjId, setEditingProjId] = useState<string | null>(null)
  const [editTab, setEditTab] = useState<'settings' | 'team' | 'integrations'>('settings')
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editColor, setEditColor] = useState(PALETTE[0])
  const [editNonWorkingDays, setEditNonWorkingDays] = useState<number[]>([0, 6])
  const [editMode, setEditMode] = useState<'kanban' | 'scrum'>('kanban')
  const [editJiraBoardId, setEditJiraBoardId] = useState('')
  const [editJiraConnectionId, setEditJiraConnectionId] = useState('')
  const [boards, setBoards] = useState<JiraBoardInfo[]>([])
  const [loadingBoards, setLoadingBoards] = useState(false)

  // Integration modals
  const [jiraModalOpen, setJiraModalOpen] = useState(false)
  const [gitlabModalOpen, setGitlabModalOpen] = useState(false)
  const [githubModalOpen, setGithubModalOpen] = useState(false)

  // Dev management
  const [showDevForm, setShowDevForm] = useState(false)
  const [devName, setDevName] = useState('')
  const [devRole, setDevRole] = useState('')
  const [devColor, setDevColor] = useState('#2563eb')
  const [schedulingId, setSchedulingId] = useState<string | null>(null)
  const [schedDraft, setSchedDraft] = useState<WorkSchedule>(DEFAULT_WORK_SCHEDULE)
  const [archivingId, setArchivingId] = useState<string | null>(null)
  const [archiveDate, setArchiveDate] = useState(todayStr())
  const [showArchived, setShowArchived] = useState(false)
  const [deletingDevId, setDeletingDevId] = useState<string | null>(null)
  const [deletingProjId, setDeletingProjId] = useState<string | null>(null)

  const {
    projects, selectedProject, jiraConnections, gitlabConnections, githubConnections,
    developers, addProject, updateProject, deleteProject, setSelectedProject,
    addDeveloper, archiveDeveloper, unarchiveDeveloper, removeDeveloper, reorderDeveloper,
    syncJira, syncGitlab, syncGithub,
    setJiraConnections, setGitlabConnections, setGithubConnections,
  } = useStore()

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  useEffect(() => {
    if (editMode !== 'scrum') return
    const conn = jiraConnections.find(c => c.id === editJiraConnectionId && c.enabled) ?? jiraConnections.find(c => c.enabled)
    if (!conn) return
    setLoadingBoards(true)
    fetchJiraBoards(conn).then(b => setBoards(b.filter(x => x.type === 'scrum'))).catch(() => {}).finally(() => setLoadingBoards(false))
  }, [editMode, editJiraConnectionId, jiraConnections])

  const deletingProj = projects.find(p => p.id === deletingProjId)
  const deletingDev = developers.find(d => d.id === deletingDevId)
  const editingProj = projects.find(p => p.id === editingProjId)
  const activeDevs = developers.filter(d => !d.archivedAt)
  const archivedDevs = developers.filter(d => !!d.archivedAt)

  const handleAdd = () => {
    if (!name.trim()) return
    addProject({ name: name.trim(), desc: desc.trim(), color, members: [], nonWorkingDays })
    setName(''); setDesc(''); setColor(PALETTE[0]); setNonWorkingDays([0, 6]); setShowForm(false)
  }

  const startEdit = (projId: string) => {
    const p = projects.find(pr => pr.id === projId)
    if (!p) return
    setEditingProjId(projId)
    setEditTab('settings')
    setEditName(p.name)
    setEditDesc(p.desc ?? '')
    setEditColor(p.color)
    setEditNonWorkingDays(p.nonWorkingDays ?? [0, 6])
    setEditMode(p.mode ?? 'kanban')
    setEditJiraBoardId(p.jiraBoardId != null ? String(p.jiraBoardId) : '')
    setEditJiraConnectionId(p.jiraConnectionId ?? '')
    setShowDevForm(false); setSchedulingId(null); setArchivingId(null)
  }

  const handleSaveEdit = () => {
    if (!editingProjId || !editName.trim()) return
    updateProject(editingProjId, {
      name: editName.trim(), desc: editDesc.trim(), color: editColor,
      nonWorkingDays: editNonWorkingDays, mode: editMode,
      jiraBoardId: editMode === 'scrum' && editJiraBoardId ? Number(editJiraBoardId) : undefined,
      jiraConnectionId: editJiraConnectionId || undefined,
    })
    setEditingProjId(null)
  }

  const handleAddDev = () => {
    if (!devName.trim()) return
    addDeveloper({ name: devName.trim(), role: devRole.trim() || 'Developer', color: devColor })
    setDevName(''); setDevRole(''); setShowDevForm(false)
  }

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    reorderDeveloper(String(active.id), String(over.id))
  }

  const assignToProject = (projId: string, type: 'jira' | 'gitlab' | 'github', connId: string) => {
    if (type === 'jira') setJiraConnections(jiraConnections.map(c => c.id === connId ? { ...c, projectId: projId } : c))
    else if (type === 'gitlab') setGitlabConnections(gitlabConnections.map(c => c.id === connId ? { ...c, projectId: projId } : c))
    else setGithubConnections(githubConnections.map(c => c.id === connId ? { ...c, projectId: projId } : c))
  }

  useEffect(() => {
    if (!open) setEditingProjId(null)
  }, [open])

  const editDrawerOpen = open && !!editingProjId

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 190, background: 'rgba(10,14,35,.2)', backdropFilter: 'blur(1px)', WebkitBackdropFilter: 'blur(1px)' }} />
      )}

      {/* Project list panel */}
      <div style={{
        position: 'fixed', top: topOffset, left: 0, width: PANEL_W,
        height: `calc(100vh - ${topOffset}px)`,
        background: 'var(--surface)', borderRight: '1px solid var(--border)',
        boxShadow: open ? '8px 0 40px rgba(25,35,90,.13)' : 'none',
        zIndex: 200, display: 'flex', flexDirection: 'column',
        transform: open ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform .24s cubic-bezier(.4,0,.2,1), box-shadow .24s',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '16px 18px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '1px' }}>Projects</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => { setShowForm(s => !s); setEditingProjId(null) }}
              style={{ background: showForm ? 'var(--accent-dim)' : 'none', border: `1.5px solid ${showForm ? 'var(--accent)' : 'var(--border2)'}`, color: 'var(--accent)', fontSize: 16, width: 28, height: 28, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
              title="Add project">+</button>
            <button onClick={onClose} className="icon-btn" style={{ fontSize: 14 }}>✕</button>
          </div>
        </div>

        {/* Add form */}
        {showForm && (
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0, background: 'var(--surface2)' }}>
            <input style={field} autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Project name" onKeyDown={e => e.key === 'Enter' && document.getElementById('pp-desc')?.focus()} />
            <input style={field} id="pp-desc" value={desc} onChange={e => setDesc(e.target.value)} placeholder="Description (optional)" onKeyDown={e => e.key === 'Enter' && handleAdd()} />
            <div>
              <label style={label}>Color</label>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {PALETTE.map(c => <div key={c} onClick={() => setColor(c)} style={{ width: 22, height: 22, borderRadius: 6, background: c, cursor: 'pointer', border: `2.5px solid ${c === color ? '#1e293b' : 'transparent'}`, transform: c === color ? 'scale(1.2)' : '', transition: 'all .15s' }} />)}
              </div>
            </div>
            <div>
              <label style={label}>Non-working days</label>
              <DayPicker value={nonWorkingDays} onChange={setNonWorkingDays} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-soft" style={{ flex: 1, justifyContent: 'center' }} onClick={handleAdd}>Create</button>
              <button className="btn-secondary" style={{ flex: 1, padding: '8px 0' }} onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </div>
        )}

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '12px 12px' }}>
          {/* All projects */}
          <div
            onClick={() => setSelectedProject('ALL')}
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, cursor: 'pointer', border: `1.5px solid ${selectedProject === 'ALL' ? 'var(--accent)' : 'transparent'}`, background: selectedProject === 'ALL' ? 'var(--accent-dim)' : 'var(--surface2)', marginBottom: 8, transition: 'all .15s' }}
            onMouseEnter={e => { if (selectedProject !== 'ALL') { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--surface3)' } }}
            onMouseLeave={e => { if (selectedProject !== 'ALL') { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'var(--surface2)' } }}
          >
            <div style={{ width: 38, height: 38, borderRadius: 10, background: selectedProject === 'ALL' ? 'var(--accent-dim)' : 'var(--surface3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: selectedProject === 'ALL' ? 'var(--accent)' : 'var(--text3)', flexShrink: 0 }}>
              <IcoFolder />
            </div>
            <span style={{ fontSize: 14, fontWeight: 600, color: selectedProject === 'ALL' ? 'var(--accent)' : 'var(--text2)' }}>All projects</span>
          </div>

          {/* Projects */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {projects.map(p => {
              const isActive = selectedProject === p.id
              const isEditing = editingProjId === p.id
              return (
                <div
                  key={p.id}
                  onClick={() => !isEditing && setSelectedProject(p.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, cursor: isEditing ? 'default' : 'pointer', border: `1.5px solid ${isActive ? 'var(--accent)' : isEditing ? 'var(--accent)' : 'transparent'}`, background: isActive ? 'var(--accent-dim)' : 'var(--surface2)', transition: 'all .15s' }}
                  onMouseEnter={e => { if (!isActive && !isEditing) { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--surface3)' } }}
                  onMouseLeave={e => { if (!isActive && !isEditing) { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'var(--surface2)' } }}
                >
                  {/* Color */}
                  <div style={{ width: 38, height: 38, borderRadius: 10, background: p.color + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <div style={{ width: 14, height: 14, borderRadius: 4, background: p.color }} />
                  </div>

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: isActive ? 'var(--accent)' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                      <span style={{ fontSize: 11, color: 'var(--text3)' }}>
                        {p.members.length} dev{p.members.length !== 1 ? 's' : ''}
                        {(p.nonWorkingDays ?? [0, 6]).length > 0 && <span> · off {(p.nonWorkingDays ?? [0, 6]).map(d => DOW_NAME[d]).join(',')}</span>}
                      </span>
                      {p.mode === 'scrum' && <span style={{ fontSize: 9, fontWeight: 700, background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 4, padding: '1px 5px' }}>SCRUM</span>}
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    <button
                      onClick={e => { e.stopPropagation(); isEditing ? setEditingProjId(null) : startEdit(p.id) }}
                      title={isEditing ? 'Close' : 'Edit'}
                      style={{ background: isEditing ? 'var(--accent-dim)' : 'none', border: `1.5px solid ${isEditing ? 'var(--accent)' : 'var(--border)'}`, color: isEditing ? 'var(--accent)' : 'var(--text3)', width: 30, height: 30, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                      onMouseEnter={e => { if (!isEditing) { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.borderColor = 'var(--accent)' } }}
                      onMouseLeave={e => { if (!isEditing) { e.currentTarget.style.color = 'var(--text3)'; e.currentTarget.style.borderColor = 'var(--border)' } }}
                    ><IcoPencil /></button>
                    <button
                      onClick={e => { e.stopPropagation(); setDeletingProjId(p.id) }}
                      title="Delete"
                      style={{ background: 'none', border: '1.5px solid var(--border)', color: 'var(--text3)', width: 30, height: 30, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                      onMouseEnter={e => { e.currentTarget.style.color = 'var(--red)'; e.currentTarget.style.borderColor = 'var(--red)' }}
                      onMouseLeave={e => { e.currentTarget.style.color = 'var(--text3)'; e.currentTarget.style.borderColor = 'var(--border)' }}
                    ><IcoTrash /></button>
                  </div>
                </div>
              )
            })}
            {projects.length === 0 && !showForm && (
              <div style={{ padding: '28px 0', textAlign: 'center', fontSize: 13, color: 'var(--text3)' }}>No projects yet — click + to add one</div>
            )}
          </div>
        </div>
      </div>

      {/* Edit drawer — slides in next to the panel */}
      <div style={{
        position: 'fixed', top: topOffset, left: PANEL_W, width: EDIT_W,
        height: `calc(100vh - ${topOffset}px)`,
        zIndex: 210, pointerEvents: editDrawerOpen ? 'all' : 'none',
        transform: editDrawerOpen ? 'translateX(0)' : `translateX(-${EDIT_W}px)`,
        transition: 'transform .24s cubic-bezier(.4,0,.2,1)',
      }}>
        {/* Drawer body */}
        <div style={{
          width: EDIT_W, height: '100%', background: 'var(--surface)',
          borderLeft: '1px solid var(--border)', borderRight: '1px solid var(--border)',
          boxShadow: '8px 0 40px rgba(25,35,90,.15)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          {/* Drawer header */}
          <div style={{ padding: '16px 20px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, background: 'var(--surface2)' }}>
            <button onClick={() => setEditingProjId(null)} style={{ background: 'none', border: '1.5px solid var(--border)', color: 'var(--text3)', width: 30, height: 30, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text3)' }}
            ><IcoChevronLeft /></button>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', lineHeight: 1.2 }}>{editingProj?.name ?? '…'}</div>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>Edit project</div>
            </div>
            {editTab === 'settings' && (
              <button onClick={handleSaveEdit} style={{ background: 'var(--accent)', border: 'none', color: '#fff', borderRadius: 8, padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Save</button>
            )}
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--surface3)', flexShrink: 0 }}>
            {(['settings', 'team', 'integrations'] as const).map(tab => (
              <button key={tab} onClick={() => setEditTab(tab)} style={{
                flex: 1, padding: '12px 0', fontSize: 11, fontWeight: 700,
                border: 'none', borderBottom: `2.5px solid ${editTab === tab ? 'var(--accent)' : 'transparent'}`,
                background: editTab === tab ? 'var(--accent-dim)' : 'none',
                color: editTab === tab ? 'var(--accent)' : 'var(--text3)',
                cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '.7px',
              }}>{tab}</button>
            ))}
          </div>

          {/* Tab content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>

            {/* ── Settings ── */}
            {editTab === 'settings' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                <div style={section}>
                  <label style={label}>Name</label>
                  <input style={field} autoFocus value={editName} onChange={e => setEditName(e.target.value)} placeholder="Project name" />
                </div>
                <div style={section}>
                  <label style={label}>Description</label>
                  <input style={field} value={editDesc} onChange={e => setEditDesc(e.target.value)} placeholder="Optional" />
                </div>
                <div style={section}>
                  <label style={label}>Color</label>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {PALETTE.map(c => <div key={c} onClick={() => setEditColor(c)} style={{ width: 26, height: 26, borderRadius: 7, background: c, cursor: 'pointer', border: `3px solid ${c === editColor ? '#1e293b' : 'transparent'}`, transform: c === editColor ? 'scale(1.2)' : '', transition: 'all .15s' }} />)}
                  </div>
                </div>
                <div style={section}>
                  <label style={label}>Non-working days</label>
                  <DayPicker value={editNonWorkingDays} onChange={setEditNonWorkingDays} />
                </div>
                <div style={section}>
                  <label style={label}>Mode</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {(['kanban', 'scrum'] as const).map(m => (
                      <button key={m} type="button" onClick={() => setEditMode(m)} style={{
                        flex: 1, padding: '10px 0', fontSize: 13, fontWeight: 600, borderRadius: 9,
                        border: `1.5px solid ${editMode === m ? 'var(--accent)' : 'var(--border2)'}`,
                        background: editMode === m ? 'var(--accent-dim)' : 'var(--surface)',
                        color: editMode === m ? 'var(--accent)' : 'var(--text3)', cursor: 'pointer', textTransform: 'capitalize',
                      }}>{m}</button>
                    ))}
                  </div>
                </div>
                {jiraConnections.length > 0 && (
                  <div style={section}>
                    <label style={label}>Jira Connection</label>
                    <select style={{ ...field, cursor: 'pointer' }} value={editJiraConnectionId} onChange={e => setEditJiraConnectionId(e.target.value)}>
                      <option value="">— no Jira link —</option>
                      {jiraConnections.map(c => <option key={c.id} value={c.id}>{c.name || c.baseUrl || c.id}{!c.enabled ? ' (disabled)' : ''}</option>)}
                    </select>
                  </div>
                )}
                {editMode === 'scrum' && (
                  <div style={section}>
                    <label style={label}>Jira Scrum Board</label>
                    {loadingBoards ? (
                      <div style={{ fontSize: 12, color: 'var(--text3)' }}>Loading boards…</div>
                    ) : boards.length > 0 ? (
                      <select style={{ ...field, cursor: 'pointer' }} value={editJiraBoardId} onChange={e => setEditJiraBoardId(e.target.value)}>
                        <option value="">— select board —</option>
                        {boards.map(b => <option key={b.id} value={String(b.id)}>{b.name} (#{b.id})</option>)}
                      </select>
                    ) : (
                      <input style={field} value={editJiraBoardId} onChange={e => setEditJiraBoardId(e.target.value)} placeholder="Board ID" type="number" />
                    )}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <button className="btn-soft" style={{ flex: 1, justifyContent: 'center', padding: '10px 0', fontSize: 13 }} onClick={handleSaveEdit}>Save changes</button>
                  <button className="btn-secondary" style={{ flex: 1, padding: '10px 0', fontSize: 13 }} onClick={() => setEditingProjId(null)}>Cancel</button>
                </div>
              </div>
            )}

            {/* ── Team ── */}
            {editTab === 'team' && editingProj && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {/* Project members */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.6px' }}>In this project</span>
                  </div>
                  {editingProj.members.length === 0 && (
                    <div style={{ fontSize: 13, color: 'var(--text3)', padding: '8px 0' }}>No members yet</div>
                  )}
                  {developers.filter(d => editingProj.members.includes(d.id) && !d.archivedAt).map(d => {
                    const rgb = hexRgb(d.color)
                    return (
                      <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, background: 'var(--surface)', border: '1.5px solid var(--border)', marginBottom: 6 }}>
                        <div className="av" style={{ background: `rgba(${rgb},.15)`, color: d.color, width: 36, height: 36, fontSize: 12, borderRadius: 10, flexShrink: 0 }}>{initials(d.name)}</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{d.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--text3)' }}>{d.role}</div>
                        </div>
                        <button onClick={() => useStore.getState().toggleMember(editingProj.id, d.id)} style={{ background: 'none', border: '1.5px solid var(--border)', color: 'var(--text3)', borderRadius: 6, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 14 }}
                          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--red)'; e.currentTarget.style.color = 'var(--red)' }}
                          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text3)' }}
                        >✕</button>
                      </div>
                    )
                  })}
                  {developers.filter(d => !editingProj.members.includes(d.id) && !d.archivedAt).length > 0 && (
                    <select value="" onChange={e => { if (e.target.value) useStore.getState().toggleMember(editingProj.id, e.target.value) }}
                      style={{ ...field, color: 'var(--text3)', cursor: 'pointer', marginTop: 4 }}>
                      <option value="">+ Add developer to this project…</option>
                      {developers.filter(d => !editingProj.members.includes(d.id) && !d.archivedAt).map(d => (
                        <option key={d.id} value={d.id}>{d.name} — {d.role}</option>
                      ))}
                    </select>
                  )}
                </div>

                {/* All developers manage */}
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 18 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.6px' }}>All developers</span>
                    <button onClick={() => setShowDevForm(s => !s)} style={{ fontSize: 12, fontWeight: 600, background: showDevForm ? 'var(--accent-dim)' : 'var(--surface3)', border: `1.5px solid ${showDevForm ? 'var(--accent)' : 'var(--border)'}`, color: showDevForm ? 'var(--accent)' : 'var(--text3)', borderRadius: 7, padding: '5px 12px', cursor: 'pointer' }}>+ Add</button>
                  </div>

                  {showDevForm && (
                    <div style={{ background: 'var(--surface3)', border: '1.5px solid var(--border)', borderRadius: 10, padding: '14px', display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
                      <input style={field} autoFocus value={devName} onChange={e => setDevName(e.target.value)} placeholder="Full name" onKeyDown={e => e.key === 'Enter' && document.getElementById('team-role')?.focus()} />
                      <input style={field} id="team-role" value={devRole} onChange={e => setDevRole(e.target.value)} placeholder="Role (e.g. Frontend)" onKeyDown={e => e.key === 'Enter' && handleAddDev()} />
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <label style={{ ...label, marginBottom: 0, flexShrink: 0 }}>Color</label>
                        <input type="color" value={devColor} onChange={e => setDevColor(e.target.value)} style={{ height: 34, padding: '2px 4px', cursor: 'pointer', borderRadius: 7, border: '1.5px solid var(--border)', flex: 1 }} />
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn-soft" style={{ flex: 1, justifyContent: 'center' }} onClick={handleAddDev}>Add</button>
                        <button className="btn-secondary" style={{ flex: 1, padding: '8px 0' }} onClick={() => setShowDevForm(false)}>Cancel</button>
                      </div>
                    </div>
                  )}

                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    <SortableContext items={activeDevs.map(d => d.id)} strategy={verticalListSortingStrategy}>
                      {activeDevs.map(dev => (
                        <SortableDevRow key={dev.id} dev={dev}
                          schedulingId={schedulingId} archivingId={archivingId}
                          schedDraft={schedDraft} archiveDate={archiveDate}
                          onScheduleToggle={id => { setSchedDraft(getSchedule(dev)); setSchedulingId(schedulingId === id ? null : id); setArchivingId(null) }}
                          onArchiveToggle={id => { setArchivingId(archivingId === id ? null : id); setArchiveDate(todayStr()); setSchedulingId(null) }}
                          onScheduleSave={() => setSchedulingId(null)}
                          onScheduleCancel={() => setSchedulingId(null)}
                          onArchiveConfirm={id => { archiveDeveloper(id, archiveDate); setArchivingId(null) }}
                          onArchiveCancel={() => setArchivingId(null)}
                          onDeleteRequest={id => setDeletingDevId(id)}
                          setSchedDraft={setSchedDraft} setArchiveDate={setArchiveDate}
                        />
                      ))}
                    </SortableContext>
                  </DndContext>
                  {activeDevs.length === 0 && <div style={{ fontSize: 13, color: 'var(--text3)', padding: '8px 0' }}>No developers yet</div>}

                  {archivedDevs.length > 0 && (
                    <div style={{ borderTop: '1px solid var(--border)', marginTop: 10 }}>
                      <button onClick={() => setShowArchived(s => !s)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.6px' }}>
                        <span>Archived ({archivedDevs.length})</span>
                        <span style={{ fontSize: 10, opacity: 0.6 }}>{showArchived ? '▲' : '▼'}</span>
                      </button>
                      {showArchived && archivedDevs.map(dev => {
                        const rgb = hexRgb(dev.color)
                        return (
                          <div key={dev.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, border: '1.5px solid var(--border)', background: 'var(--surface3)', opacity: 0.7, marginBottom: 6 }}>
                            <div className="av" style={{ background: `rgba(${rgb},.15)`, color: dev.color, width: 34, height: 34, fontSize: 11, borderRadius: 9 }}>{initials(dev.name)}</div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text2)' }}>{dev.name}</div>
                              <div style={{ fontSize: 11, color: 'var(--text3)' }}>until {formatDate(dev.archivedAt!)}</div>
                            </div>
                            <button onClick={() => unarchiveDeveloper(dev.id)} title="Restore" style={{ background: 'none', border: '1.5px solid var(--border)', color: 'var(--text3)', fontSize: 12, padding: '4px 8px', borderRadius: 6, cursor: 'pointer' }}
                              onMouseEnter={e => { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.borderColor = 'var(--accent)' }}
                              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text3)'; e.currentTarget.style.borderColor = 'var(--border)' }}>↩</button>
                            <button onClick={() => setDeletingDevId(dev.id)} title="Delete" style={{ background: 'none', border: '1.5px solid var(--border)', color: 'var(--text3)', fontSize: 12, padding: '4px 8px', borderRadius: 6, cursor: 'pointer' }}
                              onMouseEnter={e => { e.currentTarget.style.color = 'var(--red)'; e.currentTarget.style.borderColor = 'var(--red)' }}
                              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text3)'; e.currentTarget.style.borderColor = 'var(--border)' }}>✕</button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Integrations ── */}
            {editTab === 'integrations' && editingProjId && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

                {/* Jira */}
                <div>
                  <SectionHeader title="Jira" onAdd={() => setJiraModalOpen(true)} />
                  {jiraConnections.filter(c => c.projectId === editingProjId).map(c => (
                    <ConnCard key={c.id} enabled={c.enabled} label={c.name || c.baseUrl || c.id} onSync={async () => { try { await syncJira() } catch {} }} />
                  ))}
                  {jiraConnections.filter(c => !c.projectId).map(c => (
                    <UnassignedConnCard key={c.id} enabled={c.enabled} label={c.name || c.baseUrl || c.id} onAssign={() => assignToProject(editingProjId, 'jira', c.id)} />
                  ))}
                  {jiraConnections.filter(c => c.projectId === editingProjId).length === 0 && jiraConnections.filter(c => !c.projectId).length === 0 && (
                    <div style={{ fontSize: 13, color: 'var(--text3)', padding: '4px 0' }}>No Jira connections yet</div>
                  )}
                </div>

                {/* GitLab */}
                <div>
                  <SectionHeader title="GitLab" onAdd={() => setGitlabModalOpen(true)} />
                  {gitlabConnections.filter(c => c.projectId === editingProjId).map(c => (
                    <ConnCard key={c.id} enabled={c.enabled} label={c.name || c.groupPath || c.id} onSync={async () => { try { await syncGitlab() } catch {} }} />
                  ))}
                  {gitlabConnections.filter(c => !c.projectId).map(c => (
                    <UnassignedConnCard key={c.id} enabled={c.enabled} label={c.name || c.groupPath || c.id} onAssign={() => assignToProject(editingProjId, 'gitlab', c.id)} />
                  ))}
                  {gitlabConnections.filter(c => c.projectId === editingProjId).length === 0 && gitlabConnections.filter(c => !c.projectId).length === 0 && (
                    <div style={{ fontSize: 13, color: 'var(--text3)', padding: '4px 0' }}>No GitLab connections yet</div>
                  )}
                </div>

                {/* GitHub */}
                <div>
                  <SectionHeader title="GitHub" onAdd={() => setGithubModalOpen(true)} />
                  {githubConnections.filter(c => c.projectId === editingProjId).map(c => (
                    <ConnCard key={c.id} enabled={c.enabled} label={c.name || c.orgOrUser || c.id} onSync={async () => { try { await syncGithub() } catch {} }} />
                  ))}
                  {githubConnections.filter(c => !c.projectId).map(c => (
                    <UnassignedConnCard key={c.id} enabled={c.enabled} label={c.name || c.orgOrUser || c.id} onAssign={() => assignToProject(editingProjId, 'github', c.id)} />
                  ))}
                  {githubConnections.filter(c => c.projectId === editingProjId).length === 0 && githubConnections.filter(c => !c.projectId).length === 0 && (
                    <div style={{ fontSize: 13, color: 'var(--text3)', padding: '4px 0' }}>No GitHub connections yet</div>
                  )}
                </div>

              </div>
            )}
          </div>
        </div>
      </div>

      {deletingProj && (
        <ConfirmDialog
          title={`Delete "${deletingProj.name}"?`}
          message="Checkpoints assigned to this project will keep their data but lose the project tag."
          onConfirm={() => { deleteProject(deletingProj.id); setDeletingProjId(null) }}
          onCancel={() => setDeletingProjId(null)}
        />
      )}
      {deletingDev && (
        <ConfirmDialog
          title={`Remove ${deletingDev.name} permanently?`}
          message="The developer and ALL their checkpoints will be permanently removed. Consider archiving instead."
          confirmLabel="Delete forever"
          onConfirm={() => { removeDeveloper(deletingDev.id); setDeletingDevId(null); setArchivingId(null) }}
          onCancel={() => setDeletingDevId(null)}
        />
      )}
      {jiraModalOpen && editingProjId && <JiraConfigModal onClose={() => setJiraModalOpen(false)} projectId={editingProjId} />}
      {gitlabModalOpen && editingProjId && <GitLabConfigModal onClose={() => setGitlabModalOpen(false)} projectId={editingProjId} />}
      {githubModalOpen && editingProjId && <GitHubConfigModal onClose={() => setGithubModalOpen(false)} projectId={editingProjId} />}
    </>
  )
}
