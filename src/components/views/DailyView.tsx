import { useState, useEffect } from 'react'
import { useStore, getVisibleDevIds, getVisibleTasks } from '../../store'
import { hexRgb, initials } from '../../utils/format'
import TaskCard from '../task/TaskCard'
import TaskForm from '../task/TaskForm'
import EmptyState from '../ui/EmptyState'

interface Props {
  onToast: (msg: string) => void
  onStandup: () => void
  onGantt: () => void
}

export default function DailyView({ onToast, onStandup, onGantt }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [globalForm, setGlobalForm] = useState(false)
  const [formForDev, setFormForDev] = useState<string | null>(null)
  const [flashId, setFlashId] = useState<string | null>(null)

  const state = useStore()
  const { developers, projects, selectedDev, selectedProject, highlightedTaskId, setHighlightedTaskId } = state
  const visibleIds = getVisibleDevIds(state)

  useEffect(() => {
    if (!highlightedTaskId) return
    // rAF ensures the DOM has committed before we try to scroll
    const raf = requestAnimationFrame(() => {
      const el = document.getElementById(`task-${highlightedTaskId}`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        setFlashId(highlightedTaskId)
      }
    })
    const t = setTimeout(() => {
      setHighlightedTaskId(null)
      setFlashId(null)
    }, 2500)
    return () => { cancelAnimationFrame(raf); clearTimeout(t) }
  }, [highlightedTaskId, setHighlightedTaskId])

  const proj = projects.find((p) => p.id === selectedProject)
  const titleParts = [
    selectedDev === 'ALL' ? 'All developers' : developers.find((d) => d.id === selectedDev)?.name ?? 'Developer',
    proj ? `· ${proj.name}` : '',
  ]

  const visibleDevs =
    selectedDev === 'ALL'
      ? developers.filter((d) => visibleIds.includes(d.id))
      : developers.filter((d) => d.id === selectedDev && visibleIds.includes(d.id))

  const cancelForm = () => { setEditingId(null); setGlobalForm(false); setFormForDev(null) }

  // "+ Add checkpoint": when a single developer is selected, go straight into
  // their card — open the existing checkpoint's edit form (issues are added
  // there) or a new scoped form. With "All devs" the global form opens and the
  // save merges into the developer's existing card for the day.
  const handleAddCheckpoint = () => {
    setEditingId(null)
    if (selectedDev !== 'ALL' && visibleDevs[0]) {
      const dev = visibleDevs[0]
      const devTasks = getVisibleTasks(state, dev.id)
      if (devTasks.length > 0) { setEditingId(devTasks[0].id); setGlobalForm(false); setFormForDev(null); return }
      setFormForDev(dev.id); setGlobalForm(false)
      return
    }
    setGlobalForm(true); setFormForDev(null)
  }

  if (!visibleDevs.length) {
    return (
      <EmptyState
        title="No checkpoints here"
        hint="Add a developer first or select a different date"
      />
    )
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px 10px', marginBottom: 12 }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.8px' }}>{titleParts.join(' ')}</span>
        <div style={{ display: 'flex', gap: 7, marginLeft: 'auto', flexShrink: 0 }}>
          <button className="btn-soft" onClick={handleAddCheckpoint}>
            + Add checkpoint
          </button>
          <button
            onClick={onGantt}
            style={{ display: 'flex', alignItems: 'center', gap: 5, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text2)', fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 500, padding: '5px 12px', borderRadius: 7, cursor: 'pointer', transition: 'var(--t)', whiteSpace: 'nowrap' }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="3" rx="1"/><rect x="3" y="10.5" width="12" height="3" rx="1"/><rect x="3" y="17" width="15" height="3" rx="1"/></svg>
            Timeline
          </button>
          <button
            onClick={onStandup}
            style={{ display: 'flex', alignItems: 'center', gap: 5, border: '1px solid #86efac', background: 'var(--green-dim)', color: 'var(--green)', fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 500, padding: '5px 12px', borderRadius: 7, cursor: 'pointer', transition: 'var(--t)', whiteSpace: 'nowrap' }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            Standup
          </button>
        </div>
      </div>

      {globalForm && <TaskForm onCancel={cancelForm} />}

      {visibleDevs.map((dev) => {
        const rgb = hexRgb(dev.color)
        const devTasks = getVisibleTasks(state, dev.id)
        const isOpen = devTasks.length > 0 || formForDev === dev.id
        const taskCount = devTasks.reduce((n, t) => n + (t.jiras?.length ?? 0), 0)

        return (
          <div key={dev.id} style={{ marginBottom: 16 }}>
            {/* Dev header — colored left stripe accent */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, marginBottom: 0,
              padding: '10px 14px 10px 0', paddingLeft: 0,
              background: 'var(--surface2)',
              borderRadius: isOpen ? 'var(--rl) var(--rl) 0 0' : 'var(--rl)',
              border: '1px solid var(--border)',
              overflow: 'hidden',
              position: 'relative',
            }}>
              {/* Colored left accent stripe */}
              <div style={{ width: 4, alignSelf: 'stretch', background: dev.color, flexShrink: 0 }} />

              <div className="av" style={{ background: `rgba(${rgb},.15)`, color: dev.color, width: 30, height: 30, fontSize: 11, flexShrink: 0, border: `1.5px solid ${dev.color}30` }}>{initials(dev.name)}</div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', letterSpacing: '-.2px' }}>{dev.name}</span>
                  <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 500 }}>{dev.role}</span>
                </div>
                {taskCount > 0 && (
                  <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)', marginTop: 1 }}>
                    {taskCount} issue{taskCount !== 1 ? 's' : ''}
                  </div>
                )}
              </div>

              {devTasks.length > 0 && (
                <button
                  className="icon-btn"
                  title="Edit — add or change issues"
                  onClick={() => { setEditingId(devTasks[0].id); setGlobalForm(false); setFormForDev(null) }}
                  style={{ marginRight: 4 }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
              )}
            </div>

            {formForDev === dev.id && <TaskForm forDevId={dev.id} onCancel={cancelForm} />}

            {devTasks.length === 0 && formForDev !== dev.id && (
              <div style={{ padding: '8px 14px 8px 18px', color: 'var(--text3)', fontSize: 11, fontFamily: 'var(--mono)', background: 'var(--surface)', border: '1px solid var(--border)', borderTop: 'none', borderRadius: '0 0 var(--rl) var(--rl)' }}>
                No checkpoints — use + Add checkpoint above
              </div>
            )}

            {devTasks.length > 0 && (
              <div
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderTop: 'none',
                  borderRadius: '0 0 var(--rl) var(--rl)',
                  overflow: 'hidden',
                  marginBottom: 7,
                  transition: 'box-shadow .15s',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = 'var(--shadow)' }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = '' }}
              >
                {devTasks.map((task) =>
                  editingId === task.id ? (
                    <TaskForm key={task.id} taskId={task.id} onCancel={cancelForm} />
                  ) : (
                    <div
                      key={task.id}
                      id={`task-${task.id}`}
                      style={{ transition: 'box-shadow .3s', ...(flashId === task.id ? { boxShadow: 'inset 0 0 0 2px var(--accent)' } : {}) }}
                    >
                      <TaskCard task={task} onToast={onToast} />
                    </div>
                  ),
                )}
              </div>
            )}
          </div>
        )
      })}

    </div>
  )
}
