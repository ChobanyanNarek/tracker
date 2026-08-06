import { useState, useMemo, useRef, useEffect } from 'react'
import { useStore } from '../../store'
import type { Note, Project } from '../../types'
import Icon from '../ui/Icon'
import DatePicker from '../ui/DatePicker'
import TimePicker from '../ui/TimePicker'
import EmptyState from '../ui/EmptyState'

const COLORS = ['var(--accent)', 'var(--amber)', 'var(--green)', 'var(--teal)', 'var(--pink)', 'var(--purple)', 'var(--red)']

// ── reminder helpers ───────────────────────────────────────────────────────────
type ReminderState = 'over' | 'soon' | 'set' | null
function reminderState(iso: string | undefined): ReminderState {
  if (!iso) return null
  const ms = new Date(iso).getTime()
  if (isNaN(ms)) return null
  const diff = ms - Date.now()
  if (diff <= 0) return 'over'
  if (diff <= 60 * 60 * 1000) return 'soon'
  return 'set'
}
function reminderLabel(iso: string): string {
  const d = new Date(iso)
  const diff = d.getTime() - Date.now()
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (diff <= 0) return 'Overdue'
  if (diff <= 60 * 60 * 1000) return `in ${Math.max(1, Math.round(diff / 60000))} min`
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const dd = new Date(d); dd.setHours(0, 0, 0, 0)
  const days = Math.round((dd.getTime() - today.getTime()) / 86400000)
  if (days === 0) return `Today ${time}`
  if (days === 1) return `Tomorrow ${time}`
  if (days < 7) return `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${time}`
}
function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.round(diff / 60000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.round(h / 24)
  if (d < 7) return `${d}d`
  return `${Math.round(d / 7)}w`
}

// split reminderAt ISO into date (YYYY-MM-DD) + time (HH:MM) for the pickers
function splitReminder(iso: string | undefined): { date: string; time: string } {
  if (!iso) return { date: '', time: '' }
  const [date, rest] = iso.split('T')
  return { date: date ?? '', time: (rest ?? '').slice(0, 5) }
}
function joinReminder(date: string, time: string): string | undefined {
  if (!date) return undefined
  return `${date}T${time || '09:00'}`
}

// ── minimal, safe markdown renderer (bold, lists, checkboxes, inline code) ──────
function renderMarkdown(src: string, onToggleCheck?: (lineIdx: number) => void): JSX.Element[] {
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))
  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
  const lines = src.split('\n')
  const out: JSX.Element[] = []
  let list: JSX.Element[] = []
  const flush = () => { if (list.length) { out.push(<ul key={`ul-${out.length}`}>{list}</ul>); list = [] } }
  lines.forEach((raw, i) => {
    const line = raw.replace(/\s+$/, '')
    const chk = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)$/)
    if (chk) {
      const done = chk[1].toLowerCase() === 'x'
      list.push(
        <li key={i} className={`nv-chk${done ? ' done' : ''}`}>
          <span className="nv-box" onClick={(e) => { e.stopPropagation(); onToggleCheck?.(i) }} style={{ cursor: onToggleCheck ? 'pointer' : undefined }}>
            {done && <Icon name="check" size={10} color="#fff" />}
          </span>
          <span dangerouslySetInnerHTML={{ __html: inline(chk[2]) }} />
        </li>,
      )
      return
    }
    const li = line.match(/^\s*[-*]\s+(.*)$/)
    if (li) { list.push(<li key={i} dangerouslySetInnerHTML={{ __html: inline(li[1]) }} />); return }
    const h = line.match(/^(#{1,3})\s+(.*)$/)
    flush()
    if (h) { out.push(<h3 key={i} className="nv-mdh" dangerouslySetInnerHTML={{ __html: inline(h[2]) }} />); return }
    if (line.trim() === '') { out.push(<div key={i} style={{ height: 8 }} />); return }
    out.push(<p key={i} dangerouslySetInnerHTML={{ __html: inline(line) }} />)
  })
  flush()
  return out
}

function preview(body: string): string {
  return body.replace(/[#*`\-\[\]]/g, '').replace(/\s+/g, ' ').trim()
}

export default function NotesView() {
  // @ts-ignore
  const state = useStore() as any
  const { notes, projects, selectedProject, addNote, updateNote, deleteNote, highlightedNoteId, setHighlightedNoteId } = state as {
    notes: Note[]; projects: Project[]; selectedProject: string
    addNote: () => string; updateNote: (id: string, c: Partial<Note>) => void; deleteNote: (id: string) => void
    highlightedNoteId?: string | null; setHighlightedNoteId?: (id: string | null) => void
  }

  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'reminders' | 'project'>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // React to a reminder-notification click routing here
  useEffect(() => {
    if (highlightedNoteId) {
      setSelectedId(highlightedNoteId)
      setHighlightedNoteId?.(null)
    }
  }, [highlightedNoteId, setHighlightedNoteId])

  const projName = (id?: string) => projects.find((p) => p.id === id)?.name
  const projColor = (id?: string) => projects.find((p) => p.id === id)?.color ?? 'var(--text3)'

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (notes ?? [])
      .filter((n) => !n.archivedAt)
      .filter((n) => filter !== 'project' || n.projectId === selectedProject)
      .filter((n) => filter !== 'reminders' || !!n.reminderAt)
      .filter((n) => !q || n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q))
  }, [notes, query, filter, selectedProject])

  // group: pinned first, then reminders (by time), then the rest (by updatedAt)
  const groups = useMemo(() => {
    const withRem = filtered.filter((n) => n.reminderAt).sort((a, b) => (a.reminderAt! < b.reminderAt! ? -1 : 1))
    const noRem = filtered.filter((n) => !n.reminderAt).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    const pin = <T extends Note>(arr: T[]) => [...arr.filter((n) => n.pinned), ...arr.filter((n) => !n.pinned)]
    return { withRem: pin(withRem), noRem: pin(noRem) }
  }, [filtered])

  const selected = (notes ?? []).find((n) => n.id === selectedId) ?? null

  const createNote = () => {
    const id = addNote()
    setSelectedId(id)
  }

  // ── styles ────────────────────────────────────────────────────────────────
  const railBtn = (on: boolean): React.CSSProperties => ({
    fontFamily: 'var(--mono)', fontSize: 10, padding: '3px 9px', borderRadius: 20, cursor: 'pointer',
    border: `1px solid ${on ? 'var(--accent-border)' : 'var(--border)'}`,
    background: on ? 'var(--accent-dim)' : 'var(--surface)', color: on ? 'var(--accent)' : 'var(--text3)', fontWeight: on ? 600 : 400,
  })

  return (
    <div style={{ flex: 1, minHeight: 0, padding: '16px 20px', display: 'flex' }}>
      <div style={{
        display: 'grid', gridTemplateColumns: '300px 1fr', flex: 1, minHeight: 0,
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rx)',
        boxShadow: 'var(--shadow)', overflow: 'hidden',
      }}>
        {/* ── LEFT RAIL ── */}
        <aside style={{ borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--surface2)' }}>
          <div style={{ padding: '12px 12px 10px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 9 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="notes" size={15} color="var(--accent)" />
              <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700 }}>Notes</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', background: 'var(--surface3)', borderRadius: 20, padding: '1px 7px' }}>{filtered.length}</span>
              <button onClick={createNote} title="New note" style={{ marginLeft: 'auto', width: 26, height: 26, borderRadius: 7, border: '1px solid var(--accent)', background: 'var(--accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                <Icon name="plus" size={14} />
              </button>
            </div>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', display: 'flex', color: 'var(--text3)' }}><Icon name="search" size={13} /></span>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search notes…" style={{ width: '100%', fontFamily: 'var(--sans)', fontSize: 12, color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7, padding: '6px 9px 6px 28px', outline: 'none' }} />
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button style={railBtn(filter === 'all')} onClick={() => setFilter('all')}>All</button>
              <button style={railBtn(filter === 'reminders')} onClick={() => setFilter('reminders')}>Reminders</button>
              {selectedProject !== 'ALL' && <button style={railBtn(filter === 'project')} onClick={() => setFilter('project')}>{projName(selectedProject) ?? 'Project'}</button>}
            </div>
          </div>

          <div style={{ overflowY: 'auto', flex: 1, minHeight: 0, padding: 6 }}>
            {filtered.length === 0 && (
              <div style={{ padding: '30px 14px', textAlign: 'center', color: 'var(--text3)', fontSize: 12, fontStyle: 'italic' }}>
                No notes yet. Click + to add one.
              </div>
            )}
            {groups.withRem.length > 0 && <GroupLabel text="Has reminder" />}
            {groups.withRem.map((n) => <NoteItem key={n.id} note={n} selected={n.id === selectedId} onClick={() => setSelectedId(n.id)} projName={projName} projColor={projColor} />)}
            {groups.noRem.length > 0 && <GroupLabel text="Notes" />}
            {groups.noRem.map((n) => <NoteItem key={n.id} note={n} selected={n.id === selectedId} onClick={() => setSelectedId(n.id)} projName={projName} projColor={projColor} />)}
          </div>
        </aside>

        {/* ── RIGHT DETAIL ── */}
        {selected
          ? <NoteEditor key={selected.id} note={selected} projects={projects} onChange={(c) => updateNote(selected.id, c)} onDelete={() => { deleteNote(selected.id); setSelectedId(null) }} />
          : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <EmptyState icon="notes" title="Select a note" hint="Or create a new one with the + button" />
            </div>
          )}
      </div>
    </div>
  )
}

function GroupLabel({ text }: { text: string }) {
  return <div style={{ fontFamily: 'var(--mono)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '.7px', color: 'var(--text3)', padding: '8px 8px 5px' }}>{text}</div>
}

function NoteItem({ note, selected, onClick, projName, projColor }: {
  note: Note; selected: boolean; onClick: () => void
  projName: (id?: string) => string | undefined; projColor: (id?: string) => string
}) {
  const rs = reminderState(note.reminderAt)
  const pv = preview(note.body)
  const remClass: Record<string, React.CSSProperties> = {
    over: { background: 'var(--red-dim)', color: 'var(--red)', fontWeight: 600 },
    soon: { background: 'var(--amber-dim)', color: 'var(--amber)' },
    set: { background: 'var(--accent-dim)', color: 'var(--accent)' },
  }
  return (
    <div onClick={onClick} style={{
      position: 'relative', padding: '9px 10px 9px 14px', borderRadius: 9, cursor: 'pointer',
      display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 1,
      background: selected ? 'var(--surface)' : 'transparent',
      border: `1px solid ${selected ? 'var(--border)' : 'transparent'}`,
      boxShadow: selected ? 'var(--shadow-xs)' : 'none',
    }}
      onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = 'var(--surface3)' }}
      onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = 'transparent' }}
    >
      <span style={{ position: 'absolute', left: 4, top: 10, bottom: 10, width: 3, borderRadius: 2, background: note.color ?? 'var(--accent)' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 620, lineHeight: 1.25, letterSpacing: '-.1px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: note.title ? 'var(--text)' : 'var(--text3)' }}>
          {note.title || 'Untitled note'}
        </span>
        {note.pinned && <span style={{ color: 'var(--amber)', display: 'flex' }}><Icon name="pin" size={11} /></span>}
        {!note.reminderAt && <span style={{ fontFamily: 'var(--mono)', fontSize: 9.5, color: 'var(--text4)' }}>{relTime(note.updatedAt)}</span>}
      </div>
      {pv && <div style={{ fontSize: 11.5, color: 'var(--text3)', lineHeight: 1.4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pv}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 1 }}>
        {rs && note.reminderAt && (
          <span style={{ fontFamily: 'var(--mono)', fontSize: 9.5, display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px', borderRadius: 20, ...remClass[rs] }}>
            <Icon name="clock" size={9} /> {reminderLabel(note.reminderAt)}
          </span>
        )}
        {note.projectId && (
          <span style={{ fontFamily: 'var(--mono)', fontSize: 9.5, display: 'inline-flex', alignItems: 'center', gap: 4, color: projColor(note.projectId) }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: projColor(note.projectId) }} />
            {projName(note.projectId)}
          </span>
        )}
      </div>
    </div>
  )
}

// ── formatting toolbar ────────────────────────────────────────────────────────
type FmtAction = { label: string; title: string; apply: (sel: string, before: string) => { text: string; offset: number } }

const FMT_ACTIONS: FmtAction[] = [
  {
    label: 'B', title: 'Bold (Ctrl+B)',
    apply: (sel) => sel ? { text: `**${sel}**`, offset: 2 } : { text: '****', offset: 2 },
  },
  {
    label: 'H', title: 'Heading',
    apply: (sel, before) => {
      const atLineStart = !before || before.endsWith('\n')
      const prefix = atLineStart ? '## ' : '\n## '
      return { text: prefix + (sel || 'Heading'), offset: prefix.length }
    },
  },
  {
    label: '•', title: 'Bullet list',
    apply: (sel, before) => {
      const prefix = (!before || before.endsWith('\n')) ? '- ' : '\n- '
      return { text: prefix + (sel || 'Item'), offset: prefix.length }
    },
  },
  {
    label: '☐', title: 'Checklist item',
    apply: (sel, before) => {
      const prefix = (!before || before.endsWith('\n')) ? '- [ ] ' : '\n- [ ] '
      return { text: prefix + (sel || 'Task'), offset: prefix.length }
    },
  },
  {
    label: '`', title: 'Inline code',
    apply: (sel) => sel ? { text: '`' + sel + '`', offset: 1 } : { text: '``', offset: 1 },
  },
]

function applyFormat(ta: HTMLTextAreaElement, action: FmtAction, onChange: (body: string) => void) {
  const start = ta.selectionStart
  const end = ta.selectionEnd
  const val = ta.value
  const sel = val.slice(start, end)
  const before = val.slice(0, start)
  const { text, offset } = action.apply(sel, before)
  const next = before + text + val.slice(end)
  onChange(next)
  requestAnimationFrame(() => {
    ta.focus()
    const cursor = start + offset
    const selEnd = sel ? cursor + sel.length : cursor
    ta.setSelectionRange(cursor, selEnd)
  })
}

function NoteEditor({ note, projects, onChange, onDelete }: {
  note: Note; projects: Project[]
  onChange: (c: Partial<Note>) => void; onDelete: () => void
}) {
  const { date, time } = splitReminder(note.reminderAt)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const [editingBody, setEditingBody] = useState(!note.body)

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
      e.preventDefault()
      applyFormat(ta, FMT_ACTIONS[0], (body) => onChange({ body }))
      return
    }
    // auto-continue lists on Enter
    if (e.key === 'Enter') {
      const start = ta.selectionStart
      const lineStart = ta.value.lastIndexOf('\n', start - 1) + 1
      const line = ta.value.slice(lineStart, start)
      const chk = line.match(/^(\s*)([-*]\s+\[[ xX]\]\s+)(.*)$/)
      const li = !chk && line.match(/^(\s*)([-*]\s+)(.*)$/)
      const match = chk ?? li
      if (match && match[3].trim()) {
        e.preventDefault()
        const prefix = chk ? `${match[1]}- [ ] ` : `${match[1]}${match[2]}`
        const next = ta.value.slice(0, start) + '\n' + prefix + ta.value.slice(start)
        onChange({ body: next })
        requestAnimationFrame(() => {
          ta.focus()
          const pos = start + 1 + prefix.length
          ta.setSelectionRange(pos, pos)
        })
      }
    }
  }

  const fmtBtn = (action: FmtAction) => (
    <button
      key={action.label}
      title={action.title}
      onMouseDown={(e) => {
        e.preventDefault()
        if (bodyRef.current) applyFormat(bodyRef.current, action, (body) => onChange({ body }))
        if (!editingBody) setEditingBody(true)
      }}
      style={{ fontFamily: action.label === 'B' ? 'var(--sans)' : 'var(--mono)', fontWeight: action.label === 'B' ? 700 : 400, fontSize: 12, minWidth: 28, height: 26, padding: '0 6px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text2)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
    >
      {action.label}
    </button>
  )

  return (
    <section style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* header */}
      <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <input
            value={note.title}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder="Note title"
            style={{ flex: 1, fontSize: 20, fontWeight: 700, letterSpacing: '-.3px', lineHeight: 1.25, border: 'none', background: 'transparent', color: 'var(--text)', outline: 'none', fontFamily: 'var(--sans)' }}
          />
          <button onClick={() => onChange({ pinned: !note.pinned })} title={note.pinned ? 'Unpin' : 'Pin'}
            style={{ width: 30, height: 30, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
              border: `1px solid ${note.pinned ? 'var(--amber-border)' : 'var(--border)'}`, background: note.pinned ? 'var(--amber-dim)' : 'var(--surface2)', color: note.pinned ? 'var(--amber)' : 'var(--text3)' }}>
            <Icon name="pin" size={15} />
          </button>
          <button onClick={onDelete} title="Delete note"
            style={{ width: 30, height: 30, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text3)' }}>
            <Icon name="trash" size={15} />
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--text3)', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="bell" size={11} /> Remind</span>
            <DatePicker value={date} onChange={(d) => onChange({ reminderAt: joinReminder(d, time) })} placeholder="No date" />
            {date && <TimePicker value={time} onChange={(t) => onChange({ reminderAt: joinReminder(date, t) })} />}
            {note.reminderAt && (
              <button onClick={() => onChange({ reminderAt: undefined })} title="Clear reminder" style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', display: 'flex', padding: 2 }}><Icon name="close" size={12} /></button>
            )}
          </span>

          <select
            value={note.projectId ?? ''}
            onChange={(e) => onChange({ projectId: e.target.value || undefined })}
            style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text)', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 7, padding: '6px 8px', cursor: 'pointer', outline: 'none' }}
          >
            <option value="">No project</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>

          <div style={{ display: 'flex', gap: 5, alignItems: 'center', marginLeft: 'auto' }}>
            {COLORS.map((c) => (
              <span key={c} onClick={() => onChange({ color: c })} title="Color"
                style={{ width: 18, height: 18, borderRadius: 5, cursor: 'pointer', background: c, border: `2px solid ${note.color === c ? 'var(--text)' : 'transparent'}` }} />
            ))}
          </div>
        </div>
      </div>

      {/* formatting toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '7px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface2)' }}>
        {FMT_ACTIONS.map(fmtBtn)}
        <span style={{ marginLeft: 6, fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text4)' }}>Ctrl+B bold · Enter continues lists</span>
      </div>

      {/* body — click to edit, blur to render markdown */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px' }}>
        {editingBody ? (
          <textarea
            ref={bodyRef}
            autoFocus
            value={note.body}
            onChange={(e) => onChange({ body: e.target.value })}
            onBlur={() => { if (note.body.trim()) setEditingBody(false) }}
            onKeyDown={handleKeyDown}
            placeholder="Write your note…"
            style={{ width: '100%', minHeight: 320, resize: 'none', border: 'none', outline: 'none', background: 'transparent', color: 'var(--text2)', fontFamily: 'var(--sans)', fontSize: 14, lineHeight: 1.62 }}
          />
        ) : (
          <div className="nv-md" onClick={() => setEditingBody(true)} style={{ cursor: 'text', minHeight: 320, fontSize: 14, lineHeight: 1.62, color: 'var(--text2)' }}>
            {note.body.trim() ? renderMarkdown(note.body, (lineIdx) => {
              const lines = note.body.split('\n')
              const line = lines[lineIdx]
              if (!line) return
              const done = /^\s*[-*]\s+\[x\]/i.test(line)
              lines[lineIdx] = line.replace(/^(\s*[-*]\s+)\[([ xX])\]/, (_, pre) => `${pre}[${done ? ' ' : 'x'}]`)
              onChange({ body: lines.join('\n') })
            }) : <span style={{ color: 'var(--text3)', fontStyle: 'italic' }}>Click to write…</span>}
          </div>
        )}
      </div>

      {/* footer */}
      <div style={{ padding: '9px 22px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>
        <span>Edited {relTime(note.updatedAt)} ago</span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--green)', fontWeight: 600 }}>
          <Icon name="check" size={12} color="var(--green)" /> Saved
        </span>
      </div>
    </section>
  )
}
