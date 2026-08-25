import { useState } from 'react'
import { useStore, getVisibleTasks, getVisibleDevIds } from '../../../store'
import { STATUS_EMOJI } from '../../../constants'
import { resolveIssueDisplay } from '../../ui/StatusBadge'
import { getJiras, jiraLabel } from '../../../utils/format'
import { copyText } from '../../../utils/clipboard'
import { dlInfo, formatDate } from '../../../utils/dates'
import Icon from '../../ui/Icon'
import { btnBase } from './shared'

const OFF_LABEL: Record<string, string> = {
  vacation: '🏖 On vacation',
  dayoff: '🏠 Day off',
  sick: '🤒 Sick leave',
  holiday: '🎉 Holiday',
}

export default function StandupSection() {
  const state = useStore()
  const { developers, projects, schedule, selectedDev, selectedProject, selectedDate, jiraConnections } = state
  const conn = jiraConnections.find((c) => c.enabled && c.statusMappings?.length)

  const [reportDate, setReportDate] = useState(selectedDate)
  const [copied, setCopied] = useState(false)

  const proj = projects.find((p) => p.id === selectedProject)

  const buildSlack = (date: string): string => {
    const dateLabel = formatDate(date)

    const relevantDevs = developers.filter((d) => {
      if (d.archivedAt) return false
      if (selectedDev !== 'ALL' && d.id !== selectedDev) return false
      if (selectedProject !== 'ALL') {
        const p = projects.find((pr) => pr.id === selectedProject)
        if (p && p.members.length > 0 && !p.members.includes(d.id)) return false
      }
      return true
    })

    const stateForDate = { ...state, selectedDate: date }
    const visibleDevIds = getVisibleDevIds(stateForDate)
      .filter((id) => selectedDev === 'ALL' || id === selectedDev)
    const dateTasks = visibleDevIds.flatMap((devId) => getVisibleTasks(stateForDate, devId))

    const isFiltered = selectedProject !== 'ALL'
    const projIds = [...new Set(dateTasks.map((t) => t.projectId || 'none'))]
    const multiProj = !isFiltered && projIds.length > 1

    const projGroups = projIds.map((pid) => ({
      proj: projects.find((p) => p.id === pid),
      groupTasks: dateTasks.filter((t) => (t.projectId || 'none') === pid),
    }))

    const lines: string[] = []
    lines.push(`📋 Daily Standup — ${dateLabel}${proj ? `  |  ${proj.name}` : ''}`)
    lines.push('')

    if (dateTasks.length === 0) {
      relevantDevs.forEach((dev) => {
        const offType = schedule[dev.id]?.[date]
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
        const offType = schedule[dev.id]?.[date]
        const offSuffix = offType && offType !== 'work' ? `  —  ${OFF_LABEL[offType] ?? offType}` : ''

        const taskItems = dt.map((t) => ({
          jiras: getJiras(t).filter((j) => !j.hidden && (j.name?.trim() || j.url?.trim())),
          comment: t.comment?.trim() ?? '',
        })).filter((tc) => tc.jiras.length > 0 || tc.comment)

        if (!taskItems.length) {
          if (offType && offType !== 'work') {
            lines.push(`${indent}${dev.name} (${dev.role}) — ${OFF_LABEL[offType] ?? offType}`)
            lines.push('')
          }
          return
        }

        lines.push(`${indent}${dev.name} (${dev.role})${offSuffix}`)
        taskItems.forEach(({ jiras, comment }) => {
          jiras.forEach((j) => {
            const name = j.name || jiraLabel(j.url) || 'Issue'
            const status = resolveIssueDisplay(j, conn).label
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

    relevantDevs.filter((d) => !devsWithTasks.has(d.id)).forEach((dev) => {
      const offType = schedule[dev.id]?.[date]
      if (offType && offType !== 'work') {
        lines.push(`${dev.name} (${dev.role}) — ${OFF_LABEL[offType] ?? offType}`)
        lines.push('')
      }
    })

    return lines.join('\n').trimEnd()
  }

  const body = buildSlack(reportDate)

  const copy = async () => {
    const ok = await copyText(body)
    setCopied(ok)
    setTimeout(() => setCopied(false), 2000)
  }

  const download = () => {
    const blob = new Blob([body], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `standup-${reportDate}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <label style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>Date</label>
        <input
          type="date"
          value={reportDate}
          onChange={(e) => setReportDate(e.target.value)}
          style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 12, padding: '4px 8px', borderRadius: 6 }}
        />
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={download} style={{ ...btnBase, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text2)' }}>
            <Icon name="download" size={12} />
            Download .txt
          </button>
          <button
            onClick={copy}
            style={{ ...btnBase, background: copied ? 'var(--green-dim)' : 'var(--accent)', border: `1px solid ${copied ? 'var(--green-border)' : 'var(--accent)'}`, color: copied ? 'var(--green)' : '#fff', fontWeight: 600 }}
          >
            <Icon name={copied ? 'check' : 'copy'} size={12} color={copied ? 'var(--green)' : '#fff'} />
            {copied ? 'Copied!' : 'Copy for Slack'}
          </button>
        </div>
      </div>

      <textarea
        readOnly
        value={body}
        style={{ border: '1px solid var(--border)', outline: 'none', padding: '12px 16px', fontFamily: 'var(--mono)', fontSize: 12, lineHeight: 1.7, color: 'var(--text2)', background: 'var(--surface2)', resize: 'vertical', borderRadius: 8, minHeight: 320 }}
      />
    </div>
  )
}
