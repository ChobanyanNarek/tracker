import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { DragEndEvent } from '@dnd-kit/core'
import { useStore } from '../../store'
import type { Task } from '../../types'
import { hexRgb, initials, getJiras, hasPending } from '../../utils/format'
import { dlInfo } from '../../utils/dates'
import JiraIssueCard from './JiraIssueCard'

interface Props {
  task: Task
  onEdit: () => void
  onToast: (msg: string) => void
}

export default function TaskCard({ task, onEdit, onToast }: Props) {
  const { developers, projects, deleteTask, duplicateTask, carryOver, updateJiraStatus, updateJiraPriority, reorderJiras, deleteJira, toggleJiraHidden, selectedDate } = useStore()

  const dev = developers.find((d) => d.id === task.devId)
  const proj = projects.find((p) => p.id === task.projectId)
  const jiras = getJiras(task)

  const rgb = dev ? hexRgb(dev.color) : '37,99,235'
  const devColor = dev?.color ?? '#2563eb'
  const devInit = dev ? initials(dev.name) : '?'

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const ids = jiras.map((_, i) => `${task.id}-${i}`)
    const fromIdx = ids.indexOf(String(active.id))
    const toIdx = ids.indexOf(String(over.id))
    if (fromIdx !== -1 && toIdx !== -1) reorderJiras(task.id, fromIdx, toIdx)
  }

  const handleCarry = () => {
    const result = carryOver(task.id)
    if (result === 'all-done') { onToast('All issues are done — nothing to carry'); return }
    if (result) {
      const label = new Date(result + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
      onToast('Carried to ' + label)
    }
  }

  const cardBorderLeft = (() => {
    if (task.carriedOver) return '3px solid var(--amber)'
    const dl = task.deadline ? dlInfo(task.deadline, task.deadlineTime) : null
    if (dl?.diff !== undefined && dl.diff < 0) return '3px solid var(--red)'
    if (dl?.diff !== undefined && dl.diff <= 2) return '3px solid var(--amber)'
    return undefined
  })()

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: cardBorderLeft, borderRadius: 'var(--rl)', overflow: 'hidden', marginBottom: 7, transition: 'border-color .15s, box-shadow .15s', ...(task.carriedOver ? { background: 'linear-gradient(to right, var(--amber-dim) 0%, var(--surface) 60px)' } : {}) }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = 'var(--shadow)' }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = '' }}
    >
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, flex: 1, minWidth: 0 }}>
          <div className="av" style={{ background: `rgba(${rgb},.15)`, color: devColor, width: 26, height: 26, fontSize: 10, flexShrink: 0 }}>{devInit}</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
              {dev?.name ?? 'Unknown'}
              <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 400, marginLeft: 6 }}>· {dev?.role}</span>
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
              <span>{task.date}</span>
              {proj && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: proj.color + '18', color: proj.color, fontFamily: 'var(--mono)', fontSize: 10, padding: '1px 5px', borderRadius: 3 }}>
                  <span style={{ width: 5, height: 5, borderRadius: 2, background: proj.color, display: 'inline-block' }} />
                  {proj.name}
                </span>
              )}
              {task.carriedOver && task.carriedFrom && (
                <span className="carried-badge" title={`Carried from ${task.carriedFrom}`}>
                  ⏩ From {new Date(task.carriedFrom + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 3, flexShrink: 0, marginLeft: 'auto' }}>
          {hasPending(task) && (
            <button className="icon-btn carry" onClick={handleCarry} title="Carry over to next work day">→</button>
          )}
          <button className="icon-btn" onClick={() => { duplicateTask(task.id, selectedDate); onToast('Checkpoint duplicated') }} title="Duplicate to today">⧉</button>
          <button className="icon-btn" onClick={onEdit} title="Edit">✎</button>
          <button className="icon-btn del" onClick={() => deleteTask(task.id)} title="Delete">✕</button>
        </div>
      </div>

      {/* jira issues */}
      {jiras.length > 0 && (
        <div style={{ padding: '6px 14px 10px', display: 'flex', flexDirection: 'column', gap: 6, borderBottom: '1px solid var(--border)' }}>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={jiras.map((_, i) => `${task.id}-${i}`)} strategy={verticalListSortingStrategy}>
              {jiras.map((j, i) => (
                <JiraIssueCard
                  key={i}
                  issue={j}
                  taskId={task.id}
                  index={i}
                  onStatusChange={(iid, url, s) => updateJiraStatus(task.id, iid, url, s)}
                  onPriorityChange={(iid, url, p) => updateJiraPriority(task.id, iid, url, p)}
                  onDelete={(iid, url) => deleteJira(task.id, iid, url)}
                  onHide={(iid, url) => toggleJiraHidden(task.id, iid, url)}
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>
      )}

      {/* comment */}
      {task.comment && (
        <div style={{ padding: '7px 14px', fontSize: 12, color: 'var(--text3)', fontStyle: 'italic' }}>
          {task.comment}
        </div>
      )}
    </div>
  )
}
