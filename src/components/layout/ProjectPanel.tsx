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
import { fetchJiraBoards, fetchBoardProjectKeys, fetchBoardIssueKeys, type JiraBoardInfo } from '../../utils/jira-api'
import type { Developer, Project, WorkSchedule } from '../../types'
import Icon, { BrandIcon, BRAND } from '../ui/Icon'
import ConfirmDialog from '../ui/ConfirmDialog'
import JiraConfigModal from '../modals/JiraConfigModal'
import GitLabConfigModal from '../modals/GitLabConfigModal'
import GitHubConfigModal from '../modals/GitHubConfigModal'

interface Props {
  open: boolean
  onClose: () => void
  topOffset: number
  onToast?: (msg: string) => void
}

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]
const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const DAY_FULL = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DOW_NAME = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const SCHED_DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

const PANEL_W = 280
const EDIT_W = 320

// ── Shared field styles ──────────────────────────────────────────────────────

const field: React.CSSProperties = {
  padding: '6px 10px', fontSize: 12, background: 'var(--surface)',
  border: '1.5px solid var(--border)', borderRadius: 7, color: 'var(--text)',
  width: '100%', boxSizing: 'border-box', outline: 'none',
}
const label: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, color: 'var(--text3)', letterSpacing: '.5px',
  textTransform: 'uppercase', marginBottom: 4, display: 'block',
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

// Owns the scheduling/archiving drawer state shared by every dev row (only one
// row can have a drawer open at a time) and the actions that mutate it — kept
// out of SortableDevRow's props so that component takes one bundle instead of
// 14 individual props.
function useDevRowActions(archiveDeveloper: (id: string, archivedAt: string) => void, onDeleteRequest: (id: string) => void) {
  const [schedulingId, setSchedulingId] = useState<string | null>(null)
  const [schedDraft, setSchedDraft] = useState<WorkSchedule>(DEFAULT_WORK_SCHEDULE)
  const [archivingId, setArchivingId] = useState<string | null>(null)
  const [archiveDate, setArchiveDate] = useState(todayStr())

  return {
    schedulingId, archivingId, schedDraft, archiveDate, setSchedDraft, setArchiveDate,
    onScheduleToggle: (dev: Developer) => { setSchedDraft(getSchedule(dev)); setSchedulingId(id => id === dev.id ? null : dev.id); setArchivingId(null) },
    onArchiveToggle: (id: string) => { setArchivingId(prev => prev === id ? null : id); setArchiveDate(todayStr()); setSchedulingId(null) },
    onScheduleSave: () => setSchedulingId(null),
    onScheduleCancel: () => setSchedulingId(null),
    onArchiveConfirm: (id: string) => { archiveDeveloper(id, archiveDate); setArchivingId(null) },
    onArchiveCancel: () => setArchivingId(null),
    onDeleteRequest,
  }
}

type DevRowActions = ReturnType<typeof useDevRowActions>

function SortableDevRow({ dev, actions }: { dev: Developer; actions: DevRowActions }) {
  const {
    schedulingId, archivingId, schedDraft, archiveDate, setSchedDraft, setArchiveDate,
    onScheduleToggle, onArchiveToggle, onScheduleSave, onScheduleCancel,
    onArchiveConfirm, onArchiveCancel, onDeleteRequest,
  } = actions
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

        <button onClick={e => { e.stopPropagation(); onScheduleToggle(dev) }} title="Schedule"
          style={{ background: isScheduling ? 'var(--accent-dim)' : 'none', border: `1.5px solid ${isScheduling ? 'var(--accent)' : 'var(--border)'}`, color: isScheduling ? 'var(--accent)' : 'var(--text3)', width: 30, height: 30, borderRadius: 7, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
          onMouseEnter={e => { if (!isScheduling) { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.borderColor = 'var(--accent)' } }}
          onMouseLeave={e => { if (!isScheduling) { e.currentTarget.style.color = 'var(--text3)'; e.currentTarget.style.borderColor = 'var(--border)' } }}
        ><Icon name="clock" size={13} /></button>

        <button onClick={e => { e.stopPropagation(); onArchiveToggle(dev.id) }} title="Archive"
          style={{ background: isArchiving ? 'var(--amber-dim)' : 'none', border: `1.5px solid ${isArchiving ? 'var(--amber)' : 'var(--border)'}`, color: isArchiving ? 'var(--amber)' : 'var(--text3)', width: 30, height: 30, borderRadius: 7, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
          onMouseEnter={e => { if (!isArchiving) { e.currentTarget.style.color = 'var(--amber)'; e.currentTarget.style.borderColor = 'var(--amber)' } }}
          onMouseLeave={e => { if (!isArchiving) { e.currentTarget.style.color = 'var(--text3)'; e.currentTarget.style.borderColor = 'var(--border)' } }}
        ><Icon name="archive" size={13} /></button>
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
            <button onClick={() => onArchiveConfirm(dev.id)} style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: '1.5px solid var(--amber)', background: 'var(--amber-dim)', color: 'var(--amber)', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>Archive</button>
            <button onClick={onArchiveCancel} style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: '1.5px solid var(--border)', background: 'var(--surface2)', color: 'var(--text3)', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
          </div>
          <button onClick={() => onDeleteRequest(dev.id)} style={{ padding: '7px 0', borderRadius: 8, border: '1.5px solid var(--border)', background: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 13, opacity: 0.8 }}>Delete permanently</button>
        </div>
      )}
    </div>
  )
}

// ── Connection card ──────────────────────────────────────────────────────────

function SortableProjectRow({ p, isActive, isEditing, onSelect, onEditToggle, onDeleteRequest }: {
  p: Project; isActive: boolean; isEditing: boolean
  onSelect: () => void; onEditToggle: () => void; onDeleteRequest: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: p.id })

  return (
    <div
      ref={setNodeRef}
      onClick={() => !isEditing && onSelect()}
      style={{
        transform: CSS.Transform.toString(transform), transition,
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12,
        cursor: isEditing ? 'default' : 'pointer',
        border: `1.5px solid ${isDragging ? 'var(--accent)' : isActive ? 'var(--accent)' : isEditing ? 'var(--accent)' : 'transparent'}`,
        background: isActive ? 'var(--accent-dim)' : 'var(--surface2)',
        opacity: isDragging ? 0.5 : 1,
      }}
      onMouseEnter={e => { if (!isActive && !isEditing) { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--surface3)' } }}
      onMouseLeave={e => { if (!isActive && !isEditing) { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'var(--surface2)' } }}
    >
      {/* Drag handle */}
      <span {...attributes} {...listeners} onClick={e => e.stopPropagation()}
        style={{ cursor: 'grab', color: 'var(--text4)', fontSize: 15, lineHeight: 1, userSelect: 'none', flexShrink: 0 }}>⠿</span>

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
          onClick={e => { e.stopPropagation(); onEditToggle() }}
          title={isEditing ? 'Close' : 'Edit'}
          style={{ background: isEditing ? 'var(--accent-dim)' : 'none', border: `1.5px solid ${isEditing ? 'var(--accent)' : 'var(--border)'}`, color: isEditing ? 'var(--accent)' : 'var(--text3)', width: 30, height: 30, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
          onMouseEnter={e => { if (!isEditing) { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.borderColor = 'var(--accent)' } }}
          onMouseLeave={e => { if (!isEditing) { e.currentTarget.style.color = 'var(--text3)'; e.currentTarget.style.borderColor = 'var(--border)' } }}
        ><Icon name="edit" size={13} /></button>
        <button
          onClick={e => { e.stopPropagation(); onDeleteRequest() }}
          title="Delete"
          style={{ background: 'none', border: '1.5px solid var(--border)', color: 'var(--text3)', width: 30, height: 30, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--red)'; e.currentTarget.style.borderColor = 'var(--red)' }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text3)'; e.currentTarget.style.borderColor = 'var(--border)' }}
        ><Icon name="trash" size={13} /></button>
      </div>
    </div>
  )
}

// ── Main panel ──────────────────────────────────────────────────────────────

export default function ProjectPanel({ open, onClose, topOffset, onToast }: Props) {
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
  const [resolvingBoard, setResolvingBoard] = useState(false)

  // Integration modals
  const [jiraModalOpen, setJiraModalOpen] = useState(false)
  const [gitlabModalOpen, setGitlabModalOpen] = useState(false)
  const [githubModalOpen, setGithubModalOpen] = useState(false)
  const [jiraSyncing, setJiraSyncing] = useState(false)
  const [glSyncing, setGlSyncing] = useState(false)
  const [ghSyncing, setGhSyncing] = useState(false)

  // Dev management
  const [showDevForm, setShowDevForm] = useState(false)
  const [devName, setDevName] = useState('')
  const [devRole, setDevRole] = useState('')
  const [devColor, setDevColor] = useState('#2563eb')
  const [showArchived, setShowArchived] = useState(false)
  const [deletingDevId, setDeletingDevId] = useState<string | null>(null)
  const [deletingProjId, setDeletingProjId] = useState<string | null>(null)

  const {
    projects, selectedProject, jiraConnections, gitlabConnections, githubConnections,
    developers, addProject, updateProject, deleteProject, reorderProject, setSelectedProject,
    addDeveloper, archiveDeveloper, unarchiveDeveloper, removeDeveloper, reorderDeveloper,
    syncJira, syncGitlab, syncGithub,
  } = useStore()

  const devRowActions = useDevRowActions(archiveDeveloper, (id) => setDeletingDevId(id))

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
    setShowDevForm(false); devRowActions.onScheduleCancel(); devRowActions.onArchiveCancel()
  }

  const handleSaveEdit = async () => {
    if (!editingProjId || !editName.trim()) return
    const projId = editingProjId
    const boardId = editMode === 'scrum' && editJiraBoardId ? Number(editJiraBoardId) : undefined
    const connId = editJiraConnectionId || undefined

    // Save base fields immediately
    updateProject(projId, {
      name: editName.trim(), desc: editDesc.trim(), color: editColor,
      nonWorkingDays: editNonWorkingDays, mode: editMode,
      jiraBoardId: boardId,
      jiraConnectionId: connId,
    })

    // Resolve the EXACT issue keys on this board so display filtering is precise
    // (a board holds a specific subset of issues; prefix alone is too coarse).
    if (boardId) {
      const editingProjNow = projects.find(p => p.id === projId)
      const conn = jiraConnections.find(c => c.id === connId && c.enabled) ?? jiraConnections.find(c => c.enabled)
      if (conn) {
        setResolvingBoard(true)
        try {
          const members = editingProjNow?.members ?? []
          const emails = developers
            .filter(d => members.length === 0 || members.includes(d.id))
            .map(d => conn.developerEmails?.[d.id] ?? d.jiraEmail ?? '')
            .filter(Boolean)
          const [issueKeys, prefixes] = await Promise.all([
            fetchBoardIssueKeys(conn, boardId, [...new Set(emails)]),
            fetchBoardProjectKeys(conn, boardId, [...new Set(emails)]),
          ])
          updateProject(projId, { boardIssueKeys: issueKeys, boardProjectKeys: prefixes })
        } catch { /* leave undefined — filter falls back to prefix / no-op */ }
        finally { setResolvingBoard(false) }
      }
    } else {
      updateProject(projId, { boardIssueKeys: undefined, boardProjectKeys: undefined })
    }

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

  const handleProjectDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    reorderProject(String(active.id), String(over.id))
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
                {PALETTE.map(c => <div key={c} onClick={() => setColor(c)} style={{ width: 22, height: 22, borderRadius: 6, background: c, cursor: 'pointer', border: `2.5px solid ${c === color ? 'var(--text)' : 'transparent'}`, transform: c === color ? 'scale(1.2)' : '', transition: 'all .15s' }} />)}
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
              <Icon name="folder" size={16} />
            </div>
            <span style={{ fontSize: 14, fontWeight: 600, color: selectedProject === 'ALL' ? 'var(--accent)' : 'var(--text2)' }}>All projects</span>
          </div>

          {/* Projects — drag the handle to reorder */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleProjectDragEnd}>
              <SortableContext items={projects.map(p => p.id)} strategy={verticalListSortingStrategy}>
                {projects.map(p => (
                  <SortableProjectRow
                    key={p.id}
                    p={p}
                    isActive={selectedProject === p.id}
                    isEditing={editingProjId === p.id}
                    onSelect={() => setSelectedProject(p.id)}
                    onEditToggle={() => editingProjId === p.id ? setEditingProjId(null) : startEdit(p.id)}
                    onDeleteRequest={() => setDeletingProjId(p.id)}
                  />
                ))}
              </SortableContext>
            </DndContext>
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
        transform: editDrawerOpen ? 'translateX(0)' : `translateX(-${PANEL_W + EDIT_W}px)`,
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
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, background: 'var(--surface2)' }}>
            <button onClick={() => setEditingProjId(null)} style={{ background: 'none', border: '1.5px solid var(--border)', color: 'var(--text3)', width: 26, height: 26, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text3)' }}
            ><Icon name="chevron-left" size={16} strokeWidth={2.5} /></button>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', lineHeight: 1.2 }}>{editingProj?.name ?? '…'}</div>
              <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 1 }}>Edit project</div>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--surface3)', flexShrink: 0 }}>
            {(['settings', 'team', 'integrations'] as const).map(tab => (
              <button key={tab} onClick={() => setEditTab(tab)} style={{
                flex: 1, padding: '8px 0', fontSize: 10, fontWeight: 700,
                border: 'none', borderBottom: `2px solid ${editTab === tab ? 'var(--accent)' : 'transparent'}`,
                background: editTab === tab ? 'var(--accent-dim)' : 'none',
                color: editTab === tab ? 'var(--accent)' : 'var(--text3)',
                cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '.6px',
              }}>{tab}</button>
            ))}
          </div>

          {/* Tab content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '14px' }}>

            {/* ── Settings ── */}
            {editTab === 'settings' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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
                    {PALETTE.map(c => <div key={c} onClick={() => setEditColor(c)} style={{ width: 20, height: 20, borderRadius: 5, background: c, cursor: 'pointer', border: `2px solid ${c === editColor ? 'var(--text)' : 'transparent'}`, transform: c === editColor ? 'scale(1.2)' : '', transition: 'all .15s' }} />)}
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
                        flex: 1, padding: '7px 0', fontSize: 12, fontWeight: 600, borderRadius: 7,
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
                  <button className="btn-soft" style={{ flex: 1, justifyContent: 'center', padding: '10px 0', fontSize: 13 }} onClick={handleSaveEdit} disabled={resolvingBoard}>{resolvingBoard ? 'Resolving board…' : 'Save changes'}</button>
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
                        <SortableDevRow key={dev.id} dev={dev} actions={devRowActions} />
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
            {editTab === 'integrations' && editingProjId && (() => {
              const jiraConns = jiraConnections.filter(c => c.projectId === editingProjId)
              const gitlabConns = gitlabConnections.filter(c => c.projectId === editingProjId)
              const githubConns = githubConnections.filter(c => c.projectId === editingProjId)
              const jiraEnabled = jiraConns.some(c => c.enabled && c.token)
              const gitlabEnabled = gitlabConns.some(c => c.enabled)
              const githubEnabled = githubConns.some(c => c.enabled)
              const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 13px', borderBottom: '1px solid var(--border)' }
              const iconBtnStyle: React.CSSProperties = { background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--r)', color: 'var(--text3)', width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }
              const badge = (color: string): React.CSSProperties => ({ fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 700, color, padding: '2px 6px', border: `1px solid ${color}40`, borderRadius: 8, background: `${color}14` })
              return (
                <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--rl)', overflow: 'hidden' }}>
                  {/* Jira */}
                  <div style={rowStyle}>
                    <svg width={14} height={14} viewBox="0 0 24 24" fill={jiraEnabled ? BRAND.jira : 'var(--text3)'} style={{ flexShrink: 0 }} aria-hidden="true"><path d="M11.53 2 6.77 6.76a1 1 0 0 0 0 1.42l4.76 4.76 4.77-4.76a1 1 0 0 0 0-1.42L11.53 2zM6.76 6.77 2 11.53l4.76 4.76 4.77-4.76-4.77-4.76zM16.29 6.77l-4.76 4.76 4.76 4.76L21.05 11.53l-4.76-4.76z"/></svg>
                    <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: jiraEnabled ? BRAND.jira : 'var(--text2)' }}>Jira</span>
                    {jiraEnabled && <span style={badge(BRAND.jira)}>on</span>}
                    <button style={iconBtnStyle} title="Jira settings" onClick={() => setJiraModalOpen(true)}><Icon name="gear" size={12} /></button>
                    <button style={{ ...iconBtnStyle, color: jiraEnabled ? BRAND.jira : 'var(--text3)', borderColor: jiraEnabled ? `${BRAND.jira}50` : 'var(--border)', opacity: jiraSyncing ? 0.5 : 1 }} title="Sync from Jira" disabled={jiraSyncing} onClick={async () => { setJiraSyncing(true); try { const { added, updated, removed } = await syncJira(); onToast?.(`Jira synced — ${added} added, ${updated} updated${removed ? `, ${removed} removed` : ''}`) } catch (e) { console.error('[sync] manual Jira sync failed:', e); onToast?.(`Jira sync failed — ${e instanceof Error ? e.message : 'see console'}`) } finally { setJiraSyncing(false) } }}><Icon name="sync" size={12} spinning={jiraSyncing} /></button>
                  </div>
                  {/* GitLab */}
                  <div style={rowStyle}>
                    <BrandIcon brand="gitlab" size={14} color={gitlabEnabled ? BRAND.gitlab : 'var(--text3)'} />
                    <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: gitlabEnabled ? BRAND.gitlab : 'var(--text2)' }}>GitLab</span>
                    {gitlabEnabled && <span style={badge(BRAND.gitlab)}>on</span>}
                    <button style={iconBtnStyle} title="GitLab settings" onClick={() => setGitlabModalOpen(true)}><Icon name="gear" size={12} /></button>
                    <button style={{ ...iconBtnStyle, color: gitlabEnabled ? BRAND.gitlab : 'var(--text3)', borderColor: gitlabEnabled ? `${BRAND.gitlab}50` : 'var(--border)', opacity: glSyncing ? 0.5 : 1 }} title="Sync MRs" disabled={glSyncing} onClick={async () => { setGlSyncing(true); try { await syncGitlab() } catch {} finally { setGlSyncing(false) } }}><Icon name="sync" size={12} spinning={glSyncing} /></button>
                  </div>
                  {/* GitHub */}
                  <div style={{ ...rowStyle, borderBottom: 'none' }}>
                    <BrandIcon brand="github" size={14} color={githubEnabled ? BRAND.github : 'var(--text3)'} />
                    <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: githubEnabled ? BRAND.github : 'var(--text2)' }}>GitHub</span>
                    {githubEnabled && <span style={badge(BRAND.github)}>on</span>}
                    <button style={iconBtnStyle} title="GitHub settings" onClick={() => setGithubModalOpen(true)}><Icon name="gear" size={12} /></button>
                    <button style={{ ...iconBtnStyle, color: githubEnabled ? BRAND.github : 'var(--text3)', borderColor: githubEnabled ? `${BRAND.github}50` : 'var(--border)', opacity: ghSyncing ? 0.5 : 1 }} title="Sync PRs" disabled={ghSyncing} onClick={async () => { setGhSyncing(true); try { await syncGithub() } catch {} finally { setGhSyncing(false) } }}><Icon name="sync" size={12} spinning={ghSyncing} /></button>
                  </div>
                </div>
              )
            })()}
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
          onConfirm={() => { removeDeveloper(deletingDev.id); setDeletingDevId(null); devRowActions.onArchiveCancel() }}
          onCancel={() => setDeletingDevId(null)}
        />
      )}
      {jiraModalOpen && editingProjId && <JiraConfigModal onClose={() => setJiraModalOpen(false)} projectId={editingProjId} />}
      {gitlabModalOpen && editingProjId && <GitLabConfigModal onClose={() => setGitlabModalOpen(false)} projectId={editingProjId} />}
      {githubModalOpen && editingProjId && <GitHubConfigModal onClose={() => setGithubModalOpen(false)} projectId={editingProjId} />}
    </>
  )
}
