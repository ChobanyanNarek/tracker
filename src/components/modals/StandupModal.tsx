import { useState } from 'react'
import { useStore, getVisibleTasks, getVisibleDevIds } from '../../store'
import { STATUS_EMOJI, STATUS_LABEL } from '../../constants'
import { getJiras, jiraLabel } from '../../utils/format'
import { dlInfo, todayStr } from '../../utils/dates'
import Modal from '../ui/Modal'

const OFF_LABEL: Record<string, string> = {
  vacation: '🏖 On vacation',
  dayoff: '🏠 Day off',
  sick: '🤒 Sick leave',
  holiday: '🎉 Holiday',
}

interface Props { onClose: () => void }

export default function StandupModal({ onClose }: Props) {
  const [copied, setCopied] = useState(false)
  const state = useStore()
  const { developers, projects, schedule, selectedDev, selectedProject } = state

  const today = todayStr()
  // Override selectedDate so getVisibleTasks always operates on today
  const stateForToday = { ...state, selectedDate: today }

  const proj = projects.find((p) => p.id === selectedProject)

  const dateLabel = new Date(today + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  })

  // Devs relevant to the current filter — use today's state so archived check is correct
  const relevantDevs = developers.filter((d) => {
    if (d.archivedAt) return false
    if (selectedDev !== 'ALL' && d.id !== selectedDev) return false
    if (selectedProject !== 'ALL') {
      const p = projects.find((pr) => pr.id === selectedProject)
      if (p && p.members.length > 0 && !p.members.includes(d.id)) return false
    }
    return true
  })

  // Use the exact same visibility logic as the daily view, but for today
  const visibleDevIds = getVisibleDevIds(stateForToday)
    .filter((id) => selectedDev === 'ALL' || id === selectedDev)
  const dateTasks = visibleDevIds.flatMap((devId) => getVisibleTasks(stateForToday, devId))

  const isFiltered = selectedProject !== 'ALL'
  const projIds = [...new Set(dateTasks.map((t) => t.projectId || 'none'))]
  const multiProj = !isFiltered && projIds.length > 1

  const projGroups = projIds.map((pid) => ({
    proj: projects.find((p) => p.id === pid),
    groupTasks: dateTasks.filter((t) => (t.projectId || 'none') === pid),
  }))

  const buildSlack = () => {
    const lines: string[] = []

    lines.push(`📋 Daily Standup — ${dateLabel}${proj ? `  |  ${proj.name}` : ''}`)
    lines.push('')

    if (dateTasks.length === 0) {
      relevantDevs.forEach((dev) => {
        const offType = schedule[dev.id]?.[today]
        if (offType && offType !== 'work') {
          lines.push(`${dev.name} (${dev.role}) — ${OFF_LABEL[offType] ?? offType}`)
        }
      })
      if (lines.length === 2) lines.push('No updates for this date.')
      return lines.join('\n')
    }

    const devsWithTasks = new Set(dateTasks.map((t) => t.devId))

    projGroups.forEach(({ proj: pg, groupTasks }) => {
      if (multiProj) {
        lines.push(`[ ${pg ? pg.name : 'No project'} ]`)
        lines.push('')
      }
      const indent = multiProj ? '  ' : ''
      const devsInGroup = developers.filter((d) => groupTasks.some((t) => t.devId === d.id))

      devsInGroup.forEach((dev) => {
        // getVisibleTasks already deduplicated jiras — collect only visible (non-hidden) ones
        const dt = groupTasks.filter((t) => t.devId === dev.id)
        const offType = schedule[dev.id]?.[today]
        const offSuffix = offType && offType !== 'work' ? `  —  ${OFF_LABEL[offType] ?? offType}` : ''

        const taskItems = dt.map((t) => ({
          jiras: getJiras(t).filter((j) => !j.hidden && (j.name?.trim() || j.url?.trim())),
          comment: t.comment?.trim() ?? '',
        })).filter((tc) => tc.jiras.length > 0 || tc.comment)

        if (!taskItems.length) return

        lines.push(`${indent}${dev.name} (${dev.role})${offSuffix}`)

        taskItems.forEach(({ jiras, comment }) => {
          jiras.forEach((j) => {
            const name = j.name || jiraLabel(j.url) || 'Issue'
            const status = STATUS_LABEL[j.status ?? 'todo'] ?? j.status
            const emoji = STATUS_EMOJI[j.status ?? 'todo'] ?? '📋'
            const dl = j.deadline ? dlInfo(j.deadline, j.deadlineTime).text : ''
            const cmt = j.comment?.trim() ?? ''
            lines.push(`${indent}  ${emoji} ${name} — ${status}${dl ? `  (${dl})` : ''}${cmt ? `  • ${cmt}` : ''}`)
          })
          if (comment) lines.push(`${indent}  💬 ${comment}`)
        })

        lines.push('')
      })
    })

    // Devs who are off but had no tasks at all
    relevantDevs.filter((d) => !devsWithTasks.has(d.id)).forEach((dev) => {
      const offType = schedule[dev.id]?.[today]
      if (offType && offType !== 'work') {
        lines.push(`${dev.name} (${dev.role}) — ${OFF_LABEL[offType] ?? offType}`)
        lines.push('')
      }
    })

    return lines.join('\n').trimEnd()
  }

  const body = buildSlack()
  const hasContent = dateTasks.length > 0 || relevantDevs.some((d) => schedule[d.id]?.[today] && schedule[d.id]?.[today] !== 'work')

  const copy = async () => {
    await navigator.clipboard.writeText(body)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Modal
      title={`📢 Standup — ${dateLabel}`}
      width={620}
      zIndex={1000}
      onClose={onClose}
      headerExtra={<span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', marginRight: 12, padding: '3px 8px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6 }}>Slack</span>}
      bodyStyle={{ padding: 0, display: 'flex', flexDirection: 'column', minHeight: 320 }}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Close</button>
          <button
            onClick={copy}
            disabled={!hasContent}
            style={{ background: copied ? '#dcfce7' : 'var(--accent)', border: `1px solid ${copied ? '#86efac' : 'var(--accent)'}`, color: copied ? '#16a34a' : '#fff', fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600, padding: '7px 18px', borderRadius: 8, cursor: 'pointer', transition: 'all .2s' }}
          >
            {copied ? '✓ Copied!' : '⎘ Copy for Slack'}
          </button>
        </>
      }
    >
      {!hasContent ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', fontStyle: 'italic', fontSize: 13 }}>
          No data for this date.
        </div>
      ) : (
        <textarea
          readOnly
          value={body}
          style={{ flex: 1, border: 'none', outline: 'none', padding: '14px 18px', fontFamily: 'var(--mono)', fontSize: 12, lineHeight: 1.7, color: 'var(--text2)', background: 'var(--surface2)', resize: 'none', overflowY: 'auto' }}
        />
      )}
    </Modal>
  )
}
