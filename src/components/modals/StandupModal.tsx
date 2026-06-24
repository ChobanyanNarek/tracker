import { useState, useCallback } from 'react'
import { useStore } from '../../store'
import { STATUS_EMOJI, STATUS_LABEL } from '../../constants'
import { getJiras, jiraLabel } from '../../utils/format'
import { dlInfo } from '../../utils/dates'

const OFF_LABEL: Record<string, string> = {
  vacation: '🏖 On vacation',
  dayoff: '🏠 Day off',
  sick: '🤒 Sick leave',
  holiday: '🎉 Holiday',
}

interface Props { onClose: () => void }

export default function StandupModal({ onClose }: Props) {
  const [copied, setCopied] = useState(false)
  const { developers, projects, tasks, schedule, selectedDev, selectedProject, selectedDate } = useStore()

  const dateTasks = tasks.filter(
    (t) =>
      t.date === selectedDate &&
      (selectedProject === 'ALL' || t.projectId === selectedProject) &&
      (selectedDev === 'ALL' || t.devId === selectedDev),
  )

  const proj = projects.find((p) => p.id === selectedProject)

  const dateLabel = new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  })

  // Devs relevant to the current filter
  const relevantDevs = developers.filter((d) => {
    if (d.archivedAt) return false
    if (selectedDev !== 'ALL' && d.id !== selectedDev) return false
    if (selectedProject !== 'ALL') {
      const p = projects.find((pr) => pr.id === selectedProject)
      if (p && p.members.length > 0 && !p.members.includes(d.id)) return false
    }
    return true
  })

  const isFiltered = selectedProject !== 'ALL'
  const projIds = [...new Set(dateTasks.map((t) => t.projectId || 'none'))]
  const multiProj = !isFiltered && projIds.length > 1

  const projGroups = projIds.map((pid) => ({
    proj: projects.find((p) => p.id === pid),
    groupTasks: dateTasks.filter((t) => (t.projectId || 'none') === pid),
  }))

  const buildSlack = useCallback(() => {
    const lines: string[] = []

    lines.push(`📋 Daily Standup — ${dateLabel}${proj ? `  |  ${proj.name}` : ''}`)
    lines.push('')

    if (dateTasks.length === 0) {
      // Only off devs, no task data
      relevantDevs.forEach((dev) => {
        const offType = schedule[dev.id]?.[selectedDate]
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
        const dt = groupTasks.filter((t) => t.devId === dev.id)
        const offType = schedule[dev.id]?.[selectedDate]
        const offSuffix = offType && offType !== 'work' ? `  —  ${OFF_LABEL[offType] ?? offType}` : ''

        lines.push(`${indent}${dev.name} (${dev.role})${offSuffix}`)

        dt.forEach((t) => {
          const jiras = getJiras(t).filter((j) => !j.hidden)
          if (jiras.length) {
            if (t.comment?.trim()) lines.push(`${indent}  📌 ${t.comment.trim()}`)
            jiras.forEach((j) => {
              const name = j.name || jiraLabel(j.url) || 'Issue'
              const status = STATUS_LABEL[j.status ?? 'todo'] ?? j.status
              const emoji = STATUS_EMOJI[j.status ?? 'todo'] ?? '📋'
              const dl = j.deadline ? dlInfo(j.deadline, j.deadlineTime).text : ''
              const cmt = j.comment?.trim() ?? ''
              lines.push(`${indent}  ${emoji} ${name} — ${status}${dl ? `  (${dl})` : ''}${cmt ? `  • ${cmt}` : ''}`)
            })
          } else {
            const status = STATUS_LABEL[t.status ?? 'todo'] ?? t.status
            const cmt = t.comment?.trim() ?? ''
            lines.push(`${indent}  ${STATUS_EMOJI[t.status ?? 'todo'] ?? '📋'} ${status}${cmt ? `  — ${cmt}` : ''}`)
          }
        })
        lines.push('')
      })
    })

    // Devs who are off but had no tasks at all — shown once, after all project sections
    relevantDevs.filter((d) => !devsWithTasks.has(d.id)).forEach((dev) => {
      const offType = schedule[dev.id]?.[selectedDate]
      if (offType && offType !== 'work') {
        lines.push(`${dev.name} (${dev.role}) — ${OFF_LABEL[offType] ?? offType}`)
        lines.push('')
      }
    })

    return lines.join('\n').trimEnd()
  }, [dateTasks, developers, projects, dateLabel, proj, projGroups, multiProj, relevantDevs, schedule, selectedDate])

  const body = buildSlack()
  const hasContent = dateTasks.length > 0 || relevantDevs.some((d) => schedule[d.id]?.[selectedDate] && schedule[d.id]?.[selectedDate] !== 'work')

  const copy = async () => {
    await navigator.clipboard.writeText(body)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rl)', width: '100%', maxWidth: 620, minHeight: 420, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>

        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', flex: 1 }}>📢 Standup — {dateLabel}</span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', marginRight: 12, padding: '3px 8px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6 }}>Slack</span>
          <button onClick={onClose} className="icon-btn" style={{ fontSize: 16 }}>✕</button>
        </div>

        {/* body */}
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

        {/* footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 18px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
          <button onClick={onClose} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', fontFamily: 'var(--mono)', fontSize: 12, padding: '6px 16px', borderRadius: 7, cursor: 'pointer' }}>
            Close
          </button>
          <button
            onClick={copy}
            disabled={!hasContent}
            style={{ background: copied ? '#dcfce7' : 'var(--accent)', border: `1px solid ${copied ? '#86efac' : 'var(--accent)'}`, color: copied ? '#16a34a' : '#fff', fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600, padding: '6px 18px', borderRadius: 7, cursor: 'pointer', transition: 'all .2s' }}
          >
            {copied ? '✓ Copied!' : '⎘ Copy for Slack'}
          </button>
        </div>
      </div>
    </div>
  )
}
