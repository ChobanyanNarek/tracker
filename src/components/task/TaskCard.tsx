import { useState } from 'react'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { DragEndEvent } from '@dnd-kit/core'
import { useStore } from '../../store'
import type { Task, JiraIssue } from '../../types'
import { getJiras, jiraLabel, nestByParent } from '../../utils/format'
import JiraIssueCard from './JiraIssueCard'
import IssueEditForm from './IssueEditForm'
import ConfirmDialog from '../ui/ConfirmDialog'

interface Props {
  task: Task
  onToast: (msg: string) => void
}

/** Renders one checkpoint's issue list. Always embedded inside a dev's shared
 *  card in DailyView — never shows its own header/border, so multiple
 *  checkpoints for the same developer+day read as one seamless block. */
export default function TaskCard({ task, onToast }: Props) {
  const { updateJiraStatus, updateJiraPriority, updateJira, reorderJiras, deleteJira, toggleJiraHidden, jiraConnections } = useStore()
  // The connection for THIS task's project — a card can be rendered in a view that spans
  // projects, so resolving status groups against the first connection would label a task
  // with another project's mappings.
  const conn = jiraConnections.find((c) => c.enabled && c.projectId === task.projectId && c.statusMappings?.length)
  const [deletingIssue, setDeletingIssue] = useState<{ issueId: string | undefined; url: string; name: string } | null>(null)
  const [editingIssueKey, setEditingIssueKey] = useState<string | null>(null)

  const jiras = getJiras(task)
  const issueKey = (j: JiraIssue) => j.issueId ?? j.url ?? ''

  // Subtasks render underneath their parent. Collapsed parents are remembered per issue
  // in localStorage: it is a per-viewer display preference, so it must not travel into the
  // synced state where it would follow the user onto other devices and other people.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('pm_collapsed_issues')
      return new Set<string>(raw ? JSON.parse(raw) as string[] : [])
    } catch { return new Set<string>() }
  })
  const toggleCollapsed = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      try { localStorage.setItem('pm_collapsed_issues', JSON.stringify([...next])) } catch { /* private mode */ }
      return next
    })
  }

  const nested = nestByParent(jiras)
  // Hide any row whose parent — or any ancestor — is collapsed.
  const visibleRows = (() => {
    const out: typeof nested = []
    let hideBelowDepth: number | null = null
    for (const row of nested) {
      if (hideBelowDepth !== null && row.depth > hideBelowDepth) continue
      hideBelowDepth = null
      out.push(row)
      const k = row.issue.issueId ?? row.issue.url ?? ''
      if (row.childCount > 0 && collapsed.has(k)) hideBelowDepth = row.depth
    }
    return out
  })()

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    // Reordering is disabled while anything is nested: dragging a parent would have to
    // carry its subtasks, and dropping a subtask between two unrelated issues has no
    // meaning. Jira owns the hierarchy, so manual order applies to flat lists only.
    if (nested.some((r) => r.depth > 0)) return
    const ids = jiras.map((_, i) => `${task.id}-${i}`)
    const fromIdx = ids.indexOf(String(active.id))
    const toIdx = ids.indexOf(String(over.id))
    if (fromIdx < 0 || toIdx < 0) return
    // Reorder by stable identity — the displayed list may be a deduped subset of
    // the stored jiras, so positional indices would move the wrong issue.
    const idOf = (j: JiraIssue) => j.issueId ?? j.url ?? ''
    reorderJiras(task.id, idOf(jiras[fromIdx]), idOf(jiras[toIdx]))
  }

  return (
    <div>
      {/* jira issues */}
      {jiras.length > 0 && (
        <div style={{ padding: '6px 14px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={jiras.map((_, i) => `${task.id}-${i}`)} strategy={verticalListSortingStrategy}>
              {visibleRows.map(({ issue: j, depth, childCount }) => {
                const i = jiras.indexOf(j)
                const k = issueKey(j)
                const isCollapsed = collapsed.has(k)
                return (
                <div key={`${task.id}-${i}-row`} style={{ display: 'flex', alignItems: 'stretch', gap: 0, width: '100%', minWidth: 0 }}>
                  {/* indent rail + connector, one per level of depth */}
                  {depth > 0 && (
                    <div style={{ display: 'flex', flexShrink: 0 }} aria-hidden>
                      {/* one rail per ancestor level, then the elbow into this row */}
                      {Array.from({ length: depth - 1 }, (_, d) => (
                        <div key={d} style={{ width: 28, display: 'flex', justifyContent: 'center' }}>
                          <div style={{ width: 0, borderLeft: '2px solid var(--border2)' }} />
                        </div>
                      ))}
                      <div style={{ width: 28, position: 'relative' }}>
                        <div style={{ position: 'absolute', left: '50%', top: 0, bottom: '50%', borderLeft: '2px solid var(--border2)' }} />
                        <div style={{ position: 'absolute', left: '50%', top: '50%', width: 14, borderTop: '2px solid var(--border2)' }} />
                      </div>
                    </div>
                  )}
                  {/* collapse toggle, only on rows that actually have children */}
                  {childCount > 0 ? (
                    <button
                      onClick={() => toggleCollapsed(k)}
                      title={isCollapsed ? `Show ${childCount} subtask${childCount !== 1 ? 's' : ''}` : 'Hide subtasks'}
                      aria-expanded={!isCollapsed}
                      style={{ alignSelf: 'center', flexShrink: 0, width: 16, height: 16, marginRight: 4, padding: 0,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                        background: 'var(--surface3)', border: '1px solid var(--border2)', borderRadius: 4,
                        color: 'var(--text3)', fontSize: 9, fontFamily: 'var(--mono)', lineHeight: 1 }}
                    >
                      {isCollapsed ? '+' : '−'}
                    </button>
                  ) : (
                    <span style={{ width: depth > 0 ? 0 : 20, flexShrink: 0 }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0, ...(depth > 0 ? { opacity: 0.94 } : {}) }}>
                {editingIssueKey && editingIssueKey === issueKey(j) ? (
                  <IssueEditForm
                    key={`${task.id}-${i}-edit`}
                    issue={j}
                    onSave={(patch) => {
                      updateJira(task.id, j.issueId, j.url ?? '', patch)
                      setEditingIssueKey(null)
                      onToast('Issue updated')
                    }}
                    onCancel={() => setEditingIssueKey(null)}
                  />
                ) : (
                  <JiraIssueCard
                    key={`${task.id}-${i}`}
                    issue={j}
                    taskId={task.id}
                    index={i}
                    conn={conn}
                    onStatusChange={(iid, url, s, gid) => updateJiraStatus(task.id, iid, url, s, gid)}
                    onPriorityChange={(iid, url, p) => updateJiraPriority(task.id, iid, url, p)}
                    onEdit={() => setEditingIssueKey(issueKey(j))}
                    onDelete={(iid, url) => {
                      const issue = jiras.find((x) => (iid && x.issueId === iid) || (url && x.url === url))
                      setDeletingIssue({ issueId: iid, url, name: issue?.name || jiraLabel(url) || 'this issue' })
                    }}
                    onHide={(iid, url) => toggleJiraHidden(task.id, iid, url)}
                  />
                )}
                  </div>
                </div>
                )
              })}
            </SortableContext>
          </DndContext>
        </div>
      )}

      {/* comment */}
      {task.comment && (
        <div style={{ padding: '0 14px 10px', fontSize: 12, color: 'var(--text3)', fontStyle: 'italic' }}>
          {task.comment}
        </div>
      )}

      {deletingIssue && (
        <ConfirmDialog
          title="Delete issue?"
          message={<>"<b>{deletingIssue.name}</b>" will be removed from this checkpoint.</>}
          onConfirm={() => { deleteJira(task.id, deletingIssue.issueId, deletingIssue.url); onToast('Issue deleted'); setDeletingIssue(null) }}
          onCancel={() => setDeletingIssue(null)}
        />
      )}
    </div>
  )
}
