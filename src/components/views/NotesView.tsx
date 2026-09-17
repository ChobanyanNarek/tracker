import { useState, useMemo, useRef, useEffect } from 'react'
import { useStore } from '../../store'
import type { Note, Project } from '../../types'
import Icon from '../ui/Icon'
import DatePicker from '../ui/DatePicker'
import TimePicker from '../ui/TimePicker'
import EmptyState from '../ui/EmptyState'
import ConfirmDialog from '../ui/ConfirmDialog'

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


function preview(body: string): string {
  return body.replace(/[#*`_\-\[\]]/g, '').replace(/\s+/g, ' ').trim()
}

export default function NotesView() {
  const { notes, projects, selectedProject, addNote, updateNote, deleteNote, highlightedNoteId, setHighlightedNoteId } = useStore()

  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'reminders' | 'project'>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const hasActiveReminders = (notes ?? []).some((n) => n.reminderAt && !n.archivedAt)
  const notifsBlocked = typeof Notification !== 'undefined' && Notification.permission === 'denied' && hasActiveReminders
  const overdueNotes = (notes ?? []).filter((n) => !n.archivedAt && n.reminderAt && new Date(n.reminderAt).getTime() <= Date.now())
  const clearAllOverdue = () => overdueNotes.forEach((n) => updateNote(n.id, { reminderAt: undefined }))
  const snoozeOneHour = (id: string) => updateNote(id, { reminderAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() })

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

  const [autoEdit, setAutoEdit] = useState(false)
  // Tracked here (not inside the editor) because switching notes REMOUNTS the editor —
  // its draft would be discarded before it could warn about losing unsaved work.
  const dirtyRef = useRef(false)

  const confirmDiscard = () =>
    !dirtyRef.current || window.confirm('This note has unsaved changes. Discard them?')

  const selectNote = (id: string) => {
    if (id === selectedId || !confirmDiscard()) return
    dirtyRef.current = false
    setSelectedId(id)
  }

  const createNote = () => {
    if (!confirmDiscard()) return
    dirtyRef.current = false
    const id = addNote()
    setSelectedId(id)
    setAutoEdit(true)
  }

  // Closing the tab or reloading with unsaved note edits should prompt, the same as any
  // editor — the draft lives only in memory until Save.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) e.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

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
            {overdueNotes.length > 0 && (
              <button onClick={clearAllOverdue} style={{ fontFamily: 'var(--mono)', fontSize: 10, padding: '4px 9px', borderRadius: 7, cursor: 'pointer', border: '1px solid var(--red-border)', background: 'var(--red-dim)', color: 'var(--red)', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                <Icon name="close" size={10} /> Clear {overdueNotes.length} overdue reminder{overdueNotes.length !== 1 ? 's' : ''}
              </button>
            )}
          </div>

          {notifsBlocked && (
            <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', background: 'var(--amber-dim)', color: 'var(--amber)', fontSize: 11, lineHeight: 1.5, display: 'flex', gap: 6, alignItems: 'flex-start' }}>
              <Icon name="bell-off" size={13} color="var(--amber)" style={{ flexShrink: 0, marginTop: 1 }} />
              <span>Notifications are blocked in your browser, so reminders won't fire. Enable them in your browser's site settings to get notified.</span>
            </div>
          )}

          <div style={{ overflowY: 'auto', flex: 1, minHeight: 0, padding: 6 }}>
            {filtered.length === 0 && (
              <div style={{ padding: '30px 14px', textAlign: 'center', color: 'var(--text3)', fontSize: 12, fontStyle: 'italic' }}>
                No notes yet. Click + to add one.
              </div>
            )}
            {groups.withRem.length > 0 && <GroupLabel text="Has reminder" />}
            {groups.withRem.map((n) => <NoteItem key={n.id} note={n} selected={n.id === selectedId} onClick={() => selectNote(n.id)} onSnooze={snoozeOneHour} projName={projName} projColor={projColor} />)}
            {groups.noRem.length > 0 && <GroupLabel text="Notes" />}
            {groups.noRem.map((n) => <NoteItem key={n.id} note={n} selected={n.id === selectedId} onClick={() => selectNote(n.id)} onSnooze={snoozeOneHour} projName={projName} projColor={projColor} />)}
          </div>
        </aside>

        {/* ── RIGHT DETAIL ── */}
        {selected
          ? <NoteEditor key={selected.id} note={selected} projects={projects} initialEdit={autoEdit} onEditStart={() => setAutoEdit(false)} onDirtyChange={(d) => { dirtyRef.current = d }} onChange={(c) => updateNote(selected.id, c)} onDelete={() => { dirtyRef.current = false; deleteNote(selected.id); setSelectedId(null) }} />
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

function NoteItem({ note, selected, onClick, onSnooze, projName, projColor }: {
  note: Note; selected: boolean; onClick: () => void; onSnooze: (id: string) => void
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
        {rs === 'over' && (
          <button
            onClick={(e) => { e.stopPropagation(); onSnooze(note.id) }}
            title="Snooze 1 hour"
            style={{ fontFamily: 'var(--mono)', fontSize: 9.5, padding: '1px 6px', borderRadius: 20, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text3)', cursor: 'pointer' }}
          >
            Snooze 1h
          </button>
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
// Each action's actual behavior lives in applyFmtByLabel (below), keyed by label —
// this array only drives the toolbar buttons and their titles/shortcuts.
type FmtAction = { label: string; title: string }

const FMT_ACTIONS: FmtAction[] = [
  { label: 'B', title: 'Bold (Ctrl+B)' },
  { label: 'I', title: 'Italic (Ctrl+I)' },
  { label: 'U', title: 'Underline (Ctrl+U)' },
  { label: 'H', title: 'Heading (Ctrl+H)' },
  { label: '•', title: 'Bullet list' },
  { label: '☐', title: 'Checklist item' },
  { label: '`', title: 'Inline code' },
]


// Convert markdown body to HTML for contenteditable
function mdToHtml(src: string): string {
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))
  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/__(.+?)__/g, '<u>$1</u>')
      .replace(/_(.+?)_/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
  return src.split('\n').map((raw) => {
    const line = raw.replace(/\s+$/, '')
    const h = line.match(/^(#{1,3})\s+(.*)$/)
    if (h) return `<div><h3 class="nv-mdh">${inline(h[2])}</h3></div>`
    const chk = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)$/)
    if (chk) {
      const done = chk[1].toLowerCase() === 'x'
      /*
       * The box is a span so it can be clicked to toggle (see handleBodyClick). It stays a
       * plain text glyph inside, so htmlToMd — which reads textContent — still round-trips
       * it to "- [x] " / "- [ ] " without needing to know this markup exists.
       * contentEditable=false keeps the caret from landing inside the box itself.
       */
      return `<div><span class="nv-check" contenteditable="false" role="checkbox" aria-checked="${done}" title="Click to toggle">${done ? '☑' : '☐'}</span> ${inline(chk[2])}</div>`
    }
    const li = line.match(/^\s*[-*]\s+(.*)$/)
    if (li) return `<div>• ${inline(li[1])}</div>`
    if (line.trim() === '') return `<div><br></div>`
    return `<div>${inline(line)}</div>`
  }).join('')
}

// Markdown markers a line can start with, mapped back from the glyphs mdToHtml renders.
function mdLinePrefix(line: string): string {
  if (line.startsWith('• ')) return '- ' + line.slice(2)
  if (line.startsWith('☑ ')) return '- [x] ' + line.slice(2)
  if (line.startsWith('☐ ')) return '- [ ] ' + line.slice(2)
  return line
}

const BLOCK_TAGS = new Set(['DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'UL', 'OL', 'BLOCKQUOTE', 'PRE'])

// Inline tags that map to a symmetric markdown marker around their contents.
const INLINE_WRAP: Record<string, string> = {
  STRONG: '**', B: '**',
  EM: '_', I: '_',
  U: '__',
  CODE: '`',
}

/*
 * Extract markdown from contenteditable HTML by walking the DOM and emitting a line break
 * wherever the browser actually renders one — i.e. matching innerText, which is the only
 * definition of "a line" the user can see.
 *
 * The previous version handled <br> only at the top level and stripped it everywhere else,
 * so `<div>first<br>second</div>` (what you get pressing Enter then Shift+Enter) saved as
 * "firstsecond" — two visible lines silently collapsed into one. It also emitted a blank
 * line for every top-level <br>, so soft breaks multiplied on each save/reload round-trip.
 *
 * Emitting breaks structurally instead of accumulating whole lines fixes both: a <br> is
 * exactly one break, and a block element is one break before and after, deduplicated.
 */
function htmlToMd(html: string): string {
  const container = document.createElement('div')
  container.innerHTML = html

  // Build the text as a flat stream with explicit break markers, then split. This avoids
  // the "is this element a line or a container of lines?" ambiguity entirely.
  let out = ''
  const breakLine = () => { if (out !== '' && !out.endsWith('\n')) out += '\n' }

  const walk = (node: ChildNode): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      // Normalize the non-breaking spaces contenteditable inserts, but keep real text as-is.
      out += (node.textContent ?? '').replace(/ /g, ' ')
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as HTMLElement

    if (el.tagName === 'BR') { out += '\n'; return }

    const isBlock = BLOCK_TAGS.has(el.tagName)
    if (isBlock) breakLine()

    // Inline formatting wraps its children; recurse so nesting (bold inside italic, a <br>
    // inside bold, …) is preserved rather than flattened by a regex.
    const wrap = INLINE_WRAP[el.tagName]
    if (wrap) out += wrap
    Array.from(el.childNodes).forEach(walk)
    if (wrap) out += wrap

    // A heading is a whole line in markdown, so mark it once its text is known.
    if (/^H[1-6]$/.test(el.tagName)) {
      const start = out.lastIndexOf('\n') + 1
      out = out.slice(0, start) + '## ' + out.slice(start)
    }
    if (isBlock) breakLine()
  }

  Array.from(container.childNodes).forEach(walk)

  return out
    .split('\n')
    .map((line) => mdLinePrefix(line.replace(/[ \t]+$/, '')))
    .join('\n')
    // An empty trailing line is an artifact of the final block's closing break, not content.
    .replace(/\n+$/, '')
}

function NoteEditor({ note, projects, initialEdit, onEditStart, onDirtyChange, onChange, onDelete }: {
  note: Note; projects: Project[]; initialEdit?: boolean
  onChange: (c: Partial<Note>) => void; onDelete: () => void; onEditStart?: () => void
  onDirtyChange?: (dirty: boolean) => void
}) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const isComposing = useRef(false)

  // Local draft — no per-keystroke store writes (the previous real-time save on every
  // input was causing lag/instability). Edits only persist when the user clicks Save.
  const [draft, setDraft] = useState<Note>(note)
  const [dirty, setDirty] = useState(false)
  const { date, time } = splitReminder(draft.reminderAt)

  const patchDraft = (c: Partial<Note>) => {
    setDraft((d) => ({ ...d, ...c }))
    setDirty(true)
    onDirtyChange?.(true)
  }

  const save = () => {
    onChange(draft)
    setDirty(false)
    onDirtyChange?.(false)
  }

  useEffect(() => {
    // setFocused(true) alone only flips React state — it does not move actual browser
    // focus/selection into the div, so toolbar buttons (which read window.getSelection())
    // would silently no-op until the user manually clicked into the body first. Focusing
    // the element for real keeps the two in sync for a freshly-created note.
    if (initialEdit) {
      onEditStart?.()
      bodyRef.current?.focus()
    }
  }, [initialEdit])

  /*
   * Render markdown into the editor ONLY when a different note is loaded — never in
   * response to the user's own typing. Writing innerHTML resets the caret to the start,
   * and draft.body changes on every keystroke, so keying this on the body (as before)
   * yanked the cursor mid-word whenever `focused` happened to be stale — which it was
   * the moment a toolbar or Save click blurred the editor.
   */
  useEffect(() => {
    const el = bodyRef.current
    if (el) el.innerHTML = mdToHtml(note.body)
    // note.id, not note.body: identity change means "load a different note".
  }, [note.id])

  // Ctrl/Cmd+S saves explicitly
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        save()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [draft])

  const handleInput = () => {
    if (isComposing.current) return
    const el = bodyRef.current
    if (!el) return
    patchDraft({ body: htmlToMd(el.innerHTML) })
  }

  // Tick/untick a checklist item by clicking its box. Mutating the glyph in place (rather
  // than re-rendering the note from markdown) keeps the caret and the rest of the line
  // untouched, then reports the change through the normal input path.
  const handleBodyClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const box = (e.target as HTMLElement).closest?.('.nv-check')
    if (!box) return
    e.preventDefault()
    const done = box.textContent?.trim() === '☑'
    box.textContent = done ? '☐' : '☑'
    box.setAttribute('aria-checked', String(!done))
    handleInput()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!(e.ctrlKey || e.metaKey)) return
    const key = e.key.toLowerCase()
    if (key === 'b') { e.preventDefault(); applyFmtByLabel('B') }
    else if (key === 'i') { e.preventDefault(); applyFmtByLabel('I') }
    else if (key === 'u') { e.preventDefault(); applyFmtByLabel('U') }
    else if (key === 'h') { e.preventDefault(); applyFmtByLabel('H') }
  }

  const insertHtmlAtCursor = (html: string) => {
    const el = bodyRef.current
    const sel = window.getSelection()
    if (!el || !sel) return
    // The current selection can point anywhere on the page (e.g. the title input, or a
    // stale range left over from before switching notes) — inserting there instead of into
    // the note body would corrupt unrelated content. Fall back to placing the cursor at the
    // end of the body when the selection isn't actually inside it.
    let range = sel.rangeCount ? sel.getRangeAt(0) : null
    if (!range || !el.contains(range.commonAncestorContainer)) {
      range = document.createRange()
      range.selectNodeContents(el)
      range.collapse(false)
      sel.removeAllRanges()
      sel.addRange(range)
    }
    range.deleteContents()
    const tpl = document.createElement('div')
    tpl.innerHTML = html
    const frag = document.createDocumentFragment()
    let lastNode: Node | null = null
    Array.from(tpl.childNodes).forEach((n) => { lastNode = frag.appendChild(n) })
    range.insertNode(frag)
    if (lastNode) {
      const r = document.createRange()
      r.setStartAfter(lastNode)
      r.collapse(true)
      sel.removeAllRanges()
      sel.addRange(r)
    }
  }

  const applyFmtByLabel = (label: string) => {
    const el = bodyRef.current
    if (!el) return
    el.focus()
    const sel = window.getSelection()
    const selText = sel && sel.rangeCount ? sel.getRangeAt(0).toString() : ''
    if (label === 'B') {
      insertHtmlAtCursor(`<strong>${selText || 'bold'}</strong>`)
    } else if (label === 'I') {
      insertHtmlAtCursor(`<em>${selText || 'italic'}</em>`)
    } else if (label === 'U') {
      insertHtmlAtCursor(`<u>${selText || 'underline'}</u>`)
    } else if (label === 'H') {
      insertHtmlAtCursor(`<div><h3 class="nv-mdh">${selText || 'Heading'}</h3></div><div><br></div>`)
    } else if (label === '•') {
      insertHtmlAtCursor(`<div>• ${selText || 'Item'}</div>`)
    } else if (label === '☐') {
      insertHtmlAtCursor(`<div><span class="nv-check" contenteditable="false" role="checkbox" aria-checked="false" title="Click to toggle">☐</span> ${selText || 'Task'}</div>`)
    } else if (label === '`') {
      insertHtmlAtCursor(`<code>${selText || 'code'}</code>`)
    }
    handleInput()
  }

  const applyFmt = (action: FmtAction) => applyFmtByLabel(action.label)

  const fmtBtn = (action: FmtAction) => (
    <button
      key={action.label}
      title={action.title}
      onMouseDown={(e) => { e.preventDefault(); applyFmt(action) }}
      style={{ fontFamily: ['B','I','U'].includes(action.label) ? 'var(--sans)' : 'var(--mono)', fontWeight: action.label === 'B' ? 700 : 400, fontStyle: action.label === 'I' ? 'italic' : 'normal', textDecoration: action.label === 'U' ? 'underline' : 'none', fontSize: 12, minWidth: 28, height: 26, padding: '0 6px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text2)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
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
            value={draft.title}
            onChange={(e) => patchDraft({ title: e.target.value })}
            placeholder="Note title"
            style={{ flex: 1, fontSize: 20, fontWeight: 700, letterSpacing: '-.3px', lineHeight: 1.25, border: 'none', background: 'transparent', color: 'var(--text)', outline: 'none', fontFamily: 'var(--sans)' }}
          />
          <button
            onClick={save}
            title="Save (Ctrl+S)"
            disabled={!dirty}
            style={{ width: 30, height: 30, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: dirty ? 'pointer' : 'default',
              border: `1px solid ${dirty ? 'var(--accent)' : 'var(--border)'}`, background: dirty ? 'var(--accent)' : 'var(--surface2)', color: dirty ? '#fff' : 'var(--text4)' }}>
            <Icon name="save" size={15} />
          </button>
          <button onClick={() => patchDraft({ pinned: !draft.pinned })} title={draft.pinned ? 'Unpin' : 'Pin'}
            style={{ width: 30, height: 30, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
              border: `1px solid ${draft.pinned ? 'var(--amber-border)' : 'var(--border)'}`, background: draft.pinned ? 'var(--amber-dim)' : 'var(--surface2)', color: draft.pinned ? 'var(--amber)' : 'var(--text3)' }}>
            <Icon name="pin" size={15} />
          </button>
          <button onClick={() => setConfirmDelete(true)} title="Delete note"
            style={{ width: 30, height: 30, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text3)' }}>
            <Icon name="trash" size={15} />
          </button>
        </div>

        {confirmDelete && (
          <ConfirmDialog
            title="Delete note?"
            message={`"${draft.title || 'Untitled note'}" will be permanently deleted.`}
            onConfirm={() => { setConfirmDelete(false); onDelete() }}
            onCancel={() => setConfirmDelete(false)}
          />
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--text3)', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="bell" size={11} /> Remind</span>
            <DatePicker value={date} onChange={(d) => patchDraft({ reminderAt: joinReminder(d, time) })} placeholder="No date" />
            {date && <TimePicker value={time} onChange={(t) => patchDraft({ reminderAt: joinReminder(date, t) })} />}
            {draft.reminderAt && (
              <button onClick={() => patchDraft({ reminderAt: undefined })} title="Clear reminder" style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', display: 'flex', padding: 2 }}><Icon name="close" size={12} /></button>
            )}
          </span>

          <select
            value={draft.projectId ?? ''}
            onChange={(e) => patchDraft({ projectId: e.target.value || undefined })}
            style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text)', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 7, padding: '6px 8px', cursor: 'pointer', outline: 'none' }}
          >
            <option value="">No project</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>

          <div style={{ display: 'flex', gap: 5, alignItems: 'center', marginLeft: 'auto' }}>
            {COLORS.map((c) => (
              <span key={c} onClick={() => patchDraft({ color: c })} title="Color"
                style={{ width: 18, height: 18, borderRadius: 5, cursor: 'pointer', background: c, border: `2px solid ${draft.color === c ? 'var(--text)' : 'transparent'}` }} />
            ))}
          </div>
        </div>
      </div>

      {/* formatting toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '7px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface2)' }}>
        {FMT_ACTIONS.map(fmtBtn)}
        <span style={{ marginLeft: 6, fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text4)' }}>Ctrl+B bold · Ctrl+I italic · Ctrl+U underline · Ctrl+H heading</span>
        <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 10, color: dirty ? 'var(--amber)' : 'var(--text4)' }}>{dirty ? 'Unsaved changes' : 'Saved'}</span>
      </div>

      {/* body — contenteditable, always shows rendered markdown */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px' }}>
        <div
          ref={bodyRef}
          contentEditable
          suppressContentEditableWarning
          className="nv-md nv-editor"
          onClick={handleBodyClick}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => { isComposing.current = true }}
          onCompositionEnd={() => { isComposing.current = false; handleInput() }}
          data-placeholder="Write your note…"
          style={{ minHeight: 320, fontSize: 14, lineHeight: 1.62, color: 'var(--text2)', outline: 'none', cursor: 'text' }}
        />
      </div>

      {/* footer */}
      <div style={{ padding: '9px 22px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>
        <span>Created {new Date(note.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</span>
        <span style={{ opacity: 0.4 }}>·</span>
        <span>Edited {relTime(note.updatedAt)} ago</span>
      </div>
    </section>
  )
}
