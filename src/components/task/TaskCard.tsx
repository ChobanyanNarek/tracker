import { useState } from 'react'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { DragEndEvent } from '@dnd-kit/core'
import { useStore } from '../../store'
import type { Task, JiraIssue } from '../../types'
import { getJiras, jiraLabel } from '../../utils/format'
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
  const { updateJiraStatus, updateJiraPriority, updateJira, reorderJiras, deleteJira, toggleJiraHidden } = useStore()
  const [deletingIssue, setDeletingIssue] = useState<{ issueId: string | undefined; url: string; name: string } | null>(null)
  const [editingIssueKey, setEditingIssueKey] = useState<string | null>(null)

  const jiras = getJiras(task)
  const issueKey = (j: JiraIssue) => j.issueId ?? j.url ?? ''

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
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
              {jiras.map((j, i) =>
                editingIssueKey && editingIssueKey === issueKey(j) ? (
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
                    onStatusChange={(iid, url, s) => updateJiraStatus(task.id, iid, url, s)}
                    onPriorityChange={(iid, url, p) => updateJiraPriority(task.id, iid, url, p)}
                    onEdit={() => setEditingIssueKey(issueKey(j))}
                    onDelete={(iid, url) => {
                      const issue = jiras.find((x) => (iid && x.issueId === iid) || (url && x.url === url))
                      setDeletingIssue({ issueId: iid, url, name: issue?.name || jiraLabel(url) || 'this issue' })
                    }}
                    onHide={(iid, url) => toggleJiraHidden(task.id, iid, url)}
                  />
                ),
              )}
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
