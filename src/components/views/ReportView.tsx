import React, { useState, useMemo, useEffect } from 'react'
import { useStore, getVisibleTasks, getVisibleDevIds, getBoardScope, jiraOnBoard, getActiveBoardId, sprintMatchesBoard } from '../../store'
import { STATUS_EMOJI } from '../../constants'
import { resolveIssueDisplay } from '../ui/StatusBadge'
import { getJiras, jiraLabel, jiraDedupeKey } from '../../utils/format'
import { dlInfo, formatDate, formatDateTime, daysInMonth, padDate, isAmHoliday } from '../../utils/dates'
import Icon from '../ui/Icon'
import DatePicker from '../ui/DatePicker'
import type { Developer, JiraConfig, JiraIssue, Sprint, Task, EmploymentPeriod } from '../../types'

// ── helpers ──────────────────────────────────────────────────────────────────

function getDevHoursForDate(dev: { periods?: EmploymentPeriod[] }, dateStr: string): number {
  const periods = dev.periods ?? []
  for (const p of periods) {
    const from = p.from || '0000-01-01'
    const to = p.to || '9999-12-31'
    if (dateStr >= from && dateStr <= to) return p.type === 'part' ? (p.hours || 4) : 8
  }
  return 8
}

function collapseRanges(dates: string[], year: number): string {
  if (!dates.length) return ''
  const full = dates.map((d) => `${year}-${d.slice(3)}-${d.slice(0, 2)}`)
  const ranges: string[] = []
  let start = full[0], prev = full[0]
  for (let i = 1; i <= full.length; i++) {
    const cur = full[i]
    const prevD = new Date(prev + 'T12:00:00')
    const nextD = new Date(prevD)
    do { nextD.setDate(nextD.getDate() + 1) } while (nextD.getDay() === 0 || nextD.getDay() === 6)
    const nextStr = nextD.toISOString().split('T')[0]
    if (cur && cur === nextStr) {
      prev = cur
    } else {
      const s = start.slice(8) + '.' + start.slice(5, 7)
      const e = prev.slice(8) + '.' + prev.slice(5, 7)
      ranges.push(s === e ? s : `${s} – ${e}`)
      start = cur; prev = cur
    }
  }
  return ranges.join(', ')
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

const OFF_LABEL: Record<string, string> = {
  vacation: '🏖 On vacation',
  dayoff: '🏠 Day off',
  sick: '🤒 Sick leave',
  holiday: '🎉 Holiday',
}

function isWeekend(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00')
  return d.getDay() === 0 || d.getDay() === 6
}

// ── shared button styles ──────────────────────────────────────────────────────

const btnBase: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 500,
  padding: '5px 12px', borderRadius: 7, cursor: 'pointer', transition: 'var(--t)',
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sub-section 1: Standup
// ═══════════════════════════════════════════════════════════════════════════════

function StandupSection() {
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
    await navigator.clipboard.writeText(body)
    setCopied(true)
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

// ═══════════════════════════════════════════════════════════════════════════════
// Sub-section 2: Monthly Report
// ═══════════════════════════════════════════════════════════════════════════════

function MonthlySection() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const [copied, setCopied] = useState(false)

  const { developers: allDevs, schedule, selectedProject, selectedDev, projects } = useStore()
  const proj = selectedProject !== 'ALL' ? projects.find((p) => p.id === selectedProject) : null
  const developers = allDevs.filter((d) => {
    if (d.archivedAt) return false
    if (selectedDev !== 'ALL' && d.id !== selectedDev) return false
    if (proj && proj.members.length > 0 && !proj.members.includes(d.id)) return false
    return true
  })

  const days = daysInMonth(year, month)
  const daysList: string[] = []
  for (let d = 1; d <= days; d++) daysList.push(padDate(year, month, d))

  const buildTextReport = () => {
    const monthName = `${MONTHS[month]} ${year}`
    const totalWorkdays = daysList.filter((d) => !isWeekend(d) && !isAmHoliday(d)).length
    const totalHolidays = daysList.filter((d) => !isWeekend(d) && !!isAmHoliday(d)).length
    const weekends = daysList.filter((d) => isWeekend(d)).length

    const richStats = developers.map((dev) => {
      const vacD: string[] = [], dayoffD: string[] = [], sickD: string[] = [], holD: string[] = []
      let worked = 0
      daysList.forEach((ds) => {
        if (isWeekend(ds)) return
        const amHol = isAmHoliday(ds)
        const entry = schedule[dev.id]?.[ds]
        const ddmm = ds.slice(8) + '.' + ds.slice(5, 7)
        if (entry === 'vacation') vacD.push(ddmm)
        else if (entry === 'dayoff') dayoffD.push(ddmm)
        else if (entry === 'sick') sickD.push(ddmm)
        else if (entry === 'holiday' || (amHol && !entry)) holD.push(ddmm)
        else { worked++; getDevHoursForDate(dev, ds) }
      })
      const periods = dev.periods ?? []
      const monthStart = padDate(year, month, 1)
      const monthEnd = padDate(year, month, days)
      const activePeriods = periods.filter((p) => (p.from || '0000-01-01') <= monthEnd && (p.to || '9999-12-31') >= monthStart)
      const periodDesc = activePeriods.length === 0
        ? 'Full time (8h/day)'
        : activePeriods.map((p) => {
            const typeLabel = p.type === 'part' ? `Part time (${p.hours || 4}h/day)` : 'Full time (8h/day)'
            const fromFmt = p.from ? p.from.slice(8) + '.' + p.from.slice(5, 7) : ''
            const toFmt = p.to ? p.to.slice(8) + '.' + p.to.slice(5, 7) : 'present'
            return typeLabel + (fromFmt ? ` from ${fromFmt} to ${toFmt}` : '')
          }).join(', ')
      return { dev, worked, periodDesc, vacation: vacD.length, vacationStr: collapseRanges(vacD, year), dayoff: dayoffD.length, dayoffStr: dayoffD.join(', '), sick: sickD.length, sickStr: sickD.join(', '), holidays: holD.length, holidayStr: holD.join(', ') }
    })

    const lines = [
      `MONTHLY WORKING DAYS REPORT — ${monthName.toUpperCase()}`,
      '═'.repeat(60),
      `Total: ${days} days  |  ${totalWorkdays} workdays  |  ${totalHolidays} public holidays  |  ${weekends} weekends`,
      '',
      ...richStats.flatMap(({ dev, worked, periodDesc, vacation, vacationStr, dayoff, dayoffStr, sick, sickStr, holidays, holidayStr }) => {
        const parts = [`${worked} working days`]
        if (holidays) parts.push(`${holidays} public holiday${holidays !== 1 ? 's' : ''} (${holidayStr})`)
        if (vacation) parts.push(`${vacation} vacation day${vacation !== 1 ? 's' : ''} (${vacationStr})`)
        if (dayoff) parts.push(`${dayoff} day off${dayoff !== 1 ? 's' : ''} (${dayoffStr})`)
        if (sick) parts.push(`${sick} sick day${sick !== 1 ? 's' : ''} (${sickStr})`)
        return [`${dev.name} — ${periodDesc}`, parts.join(' / '), '']
      }),
      '─'.repeat(60),
      `Generated: ${formatDateTime(new Date())}`,
    ]
    return lines.join('\n')
  }

  const prevMonth = () => {
    if (month === 0) { setYear((y) => y - 1); setMonth(11) } else setMonth((m) => m - 1)
  }
  const nextMonth = () => {
    if (month === 11) { setYear((y) => y + 1); setMonth(0) } else setMonth((m) => m + 1)
  }

  const reportText = buildTextReport()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={prevMonth} className="icon-btn">‹</button>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 600, minWidth: 130, textAlign: 'center' }}>{MONTHS[month]} {year}</span>
        <button onClick={nextMonth} className="icon-btn">›</button>
        <button onClick={() => { const n = new Date(); setYear(n.getFullYear()); setMonth(n.getMonth()) }} style={{ fontFamily: 'var(--mono)', fontSize: 10, padding: '3px 10px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text3)', cursor: 'pointer' }}>This month</button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button
            onClick={() => {
              const blob = new Blob([reportText], { type: 'text/plain' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = `monthly-report-${MONTHS[month].toLowerCase()}-${year}.txt`
              a.click()
              URL.revokeObjectURL(url)
            }}
            style={{ ...btnBase, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text2)' }}
          >
            <Icon name="download" size={12} />
            Download .txt
          </button>
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(reportText)
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            }}
            style={{ ...btnBase, background: copied ? 'var(--green-dim)' : 'var(--accent)', border: `1px solid ${copied ? 'var(--green-border)' : 'var(--accent)'}`, color: copied ? 'var(--green)' : '#fff', fontWeight: 600 }}
          >
            <Icon name={copied ? 'check' : 'copy'} size={12} color={copied ? 'var(--green)' : '#fff'} />
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      {developers.length === 0 ? (
        <div style={{ color: 'var(--text3)', fontStyle: 'italic', fontSize: 13 }}>No developers match the current filter.</div>
      ) : (
        <textarea
          readOnly
          value={reportText}
          style={{ border: '1px solid var(--border)', outline: 'none', padding: '12px 16px', fontFamily: 'var(--mono)', fontSize: 12, lineHeight: 1.7, color: 'var(--text2)', background: 'var(--surface2)', resize: 'vertical', borderRadius: 8, minHeight: 320 }}
        />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sub-section 3: Release Notes
// ═══════════════════════════════════════════════════════════════════════════════

function ReleaseNotesSection() {
  const { projects, selectedProject } = useStore()
  const proj = selectedProject !== 'ALL' ? projects.find((p) => p.id === selectedProject) : null
  const defaultMode = proj?.mode === 'scrum' ? 'scrum' : 'kanban'
  const [mode, setMode] = useState<'kanban' | 'scrum'>(defaultMode)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        {(['kanban', 'scrum'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            style={{ ...btnBase, border: `1px solid ${mode === m ? 'var(--accent)' : 'var(--border)'}`, background: mode === m ? 'var(--accent-dim)' : 'var(--surface2)', color: mode === m ? 'var(--accent)' : 'var(--text2)', fontWeight: mode === m ? 700 : 400 }}
          >
            {m === 'kanban' ? 'Kanban' : 'Scrum'}
          </button>
        ))}
      </div>

      {mode === 'kanban' && <KanbanReleaseNotes />}
      {mode === 'scrum' && <ScrumReleaseNotes />}
    </div>
  )
}

type IssueRow = { j: JiraIssue; task: Task; devId: string }

function fmtSeconds(s: number | undefined, hoursPerDay = 8): string {
  if (!s) return '—'
  const totalMin = Math.round(s / 60)
  const minPerDay = hoursPerDay * 60
  const d = Math.floor(totalMin / minPerDay)
  const rem = totalMin % minPerDay
  const h = Math.floor(rem / 60)
  const m = rem % 60
  const parts: string[] = []
  if (d > 0) parts.push(`${d}d`)
  if (h > 0) parts.push(`${h}h`)
  if (m > 0) parts.push(`${m}m`)
  return parts.length ? parts.join(' ') : '—'
}

function genColId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

const inputStyle: React.CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)',
  fontFamily: 'var(--mono)', fontSize: 11, padding: '3px 7px', borderRadius: 5, outline: 'none', width: '100%', boxSizing: 'border-box',
}

function KanbanReleaseNotes() {
  // @ts-ignore
  const state = useStore() as any
  const { tasks, developers, projects, selectedProject, selectedDev, jiraConnections, releaseNoteColumns, releaseNoteData, setReleaseNoteColumns, updateReleaseNoteIssue } = state
  const conn: JiraConfig | undefined = jiraConnections.find((c: JiraConfig) => c.enabled && c.statusMappings?.length)
  const hpd = conn?.hoursPerDay ?? 8
  const boardScope = getBoardScope(state)

  // Developers visible for the selected project — scopes issues to project members,
  // matching the Daily dashboard. When a project is selected, only its members' tasks count.
  const memberIds = useMemo<Set<string> | null>(() => {
    if (selectedProject === 'ALL') return null
    const p = projects.find((pr: any) => pr.id === selectedProject)
    return p?.members?.length ? new Set<string>(p.members) : new Set<string>()
  }, [projects, selectedProject])

  const today = new Date().toISOString().split('T')[0]
  const defaultStart = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
  const [startDate, setStartDate] = useState(defaultStart)
  const [endDate, setEndDate] = useState(today)
  const [copied, setCopied] = useState(false)
  const [showHidden, setShowHidden] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string[]>([])   // empty = all statuses
  const [statusMenuOpen, setStatusMenuOpen] = useState(false)
  const [addingCol, setAddingCol] = useState(false)
  const [newColLabel, setNewColLabel] = useState('')
  const [editingColId, setEditingColId] = useState<string | null>(null)
  const [editingColLabel, setEditingColLabel] = useState('')

  const cols: { id: string; label: string }[] = releaseNoteColumns ?? []
  const rnData: Record<string, { hidden?: boolean; selected?: boolean; customFields?: Record<string, string> }> = releaseNoteData ?? {}

  // All unique issues across all tasks, deduplicated by key, filtered by board scope + created date
  const allRows = useMemo((): IssueRow[] => {
    const map = new Map<string, IssueRow>()
    tasks.forEach((t: Task) => {
      if (selectedProject !== 'ALL' && t.projectId !== selectedProject) return
      if (memberIds && !memberIds.has(t.devId)) return
      if (selectedDev !== 'ALL' && t.devId !== selectedDev) return
      getJiras(t).forEach((j) => {
        if (j.hidden) return
        if (!jiraOnBoard(j, boardScope)) return
        // Filter by Jira issue creation date. Fall back to the tracker task date
        // for issues synced before jiraCreatedAt existed, so the range still applies.
        const created = ((j as any).jiraCreatedAt as string | undefined) || t.date
        if (created < startDate || created > endDate) return
        const key = jiraDedupeKey(j.url, j.name)
        // keep the most recent task snapshot for each issue
        const existing = map.get(key)
        if (!existing || t.date > existing.task.date) map.set(key, { j, task: t, devId: t.devId })
      })
    })
    return Array.from(map.values())
  }, [tasks, selectedProject, selectedDev, startDate, endDate, boardScope, memberIds])

  // Status groups from integration settings, in order
  const statusGroups: { id: string; label: string; color: string }[] = useMemo(() => {
    if (!conn?.statusGroups?.length) return []
    return conn.statusGroups.filter((g: any) => g.id !== 'hidden')
  }, [conn])

  // Group rows by their groupId → status group
  const groupedRows = useMemo(() => {
    const hidden: IssueRow[] = []
    const byGroup = new Map<string, IssueRow[]>()
    const ungrouped: IssueRow[] = []
    allRows.forEach((r) => {
      const key = jiraDedupeKey(r.j.url, r.j.name)
      if (rnData[key]?.hidden) { hidden.push(r); return }
      const gid = r.j.groupId
      // status filter: when set, keep only issues whose group is selected
      if (statusFilter.length && (!gid || !statusFilter.includes(gid))) return
      if (!gid || gid === 'hidden') { ungrouped.push(r); return }
      const arr = byGroup.get(gid) ?? []
      arr.push(r)
      byGroup.set(gid, arr)
    })
    return { byGroup, ungrouped, hidden }
  }, [allRows, rnData, statusFilter])

  const hiddenCount = groupedRows.hidden.length
  const isSelected = (key: string) => rnData[key]?.selected !== false

  const buildMarkdown = () => {
    const lines: string[] = []
    lines.push(`# Release Notes — ${formatDate(startDate)} to ${formatDate(endDate)}`)
    lines.push('')
    const customHeaders = cols.map((c) => c.label).join(' | ')
    const headerRow = `| Key | Title | Assignee | Due Date | Original Est | Time Spent | Story Points | Status${cols.length ? ' | ' + customHeaders : ''} |`
    const sepRow = `|---|---|---|---|---|---|---|---${cols.map(() => '|---').join('')}|`

    const renderRows = (rows: IssueRow[]) => rows.forEach(({ j, devId }) => {
      const key = jiraDedupeKey(j.url, j.name)
      if (!isSelected(key)) return
      const keyLabel = jiraLabel(j.url) || key
      const assignee = developers.find((d: Developer) => d.id === devId)?.name ?? '—'
      const dueDate = j.deadline ? formatDate(j.deadline) : '—'
      const origEst = fmtSeconds((j as any).timeOriginalEstimate, hpd)
      const timeSpent = fmtSeconds((j as any).timeSpent, hpd)
      const sp = (j as any).storyPoints ?? '—'
      const status = resolveIssueDisplay(j, conn).label
      const customCells = cols.map((c) => rnData[key]?.customFields?.[c.id] ?? '').join(' | ')
      lines.push(`| ${keyLabel} | ${j.name || '—'} | ${assignee} | ${dueDate} | ${origEst} | ${timeSpent} | ${sp} | ${status}${cols.length ? ' | ' + customCells : ''} |`)
    })

    if (statusGroups.length) {
      statusGroups.forEach((g) => {
        const rows = groupedRows.byGroup.get(g.id) ?? []
        if (!rows.length) return
        lines.push(`## ${g.label}`)
        lines.push(headerRow); lines.push(sepRow)
        renderRows(rows)
        lines.push('')
      })
      if (groupedRows.ungrouped.length) {
        lines.push('## Other')
        lines.push(headerRow); lines.push(sepRow)
        renderRows(groupedRows.ungrouped)
        lines.push('')
      }
    } else {
      lines.push(headerRow); lines.push(sepRow)
      renderRows([...groupedRows.ungrouped, ...Array.from(groupedRows.byGroup.values()).flat()])
    }
    return lines.join('\n')
  }

  const copy = async () => {
    await navigator.clipboard.writeText(buildMarkdown())
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const download = () => {
    const blob = new Blob([buildMarkdown()], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `release-notes-${startDate}-${endDate}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  const addColumn = () => {
    const label = newColLabel.trim()
    if (!label) return
    const id = genColId()
    setReleaseNoteColumns([...cols, { id, label }])
    setNewColLabel('')
    setAddingCol(false)
  }

  const deleteColumn = (colId: string) => {
    setReleaseNoteColumns(cols.filter((c) => c.id !== colId))
  }

  const startEditCol = (col: { id: string; label: string }) => {
    setEditingColId(col.id)
    setEditingColLabel(col.label)
  }

  const commitEditCol = () => {
    if (!editingColId) return
    const label = editingColLabel.trim()
    if (label) setReleaseNoteColumns(cols.map((c) => c.id === editingColId ? { ...c, label } : c))
    setEditingColId(null)
  }

  const thStyle: React.CSSProperties = { padding: '7px 10px', textAlign: 'left', fontWeight: 700, color: 'var(--text3)', fontSize: 10, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
  const tdStyle: React.CSSProperties = { padding: '6px 10px', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <label style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>From</label>
        <DatePicker value={startDate} onChange={(d) => { if (!d) return; setStartDate(d); if (endDate && d > endDate) setEndDate(d) }} maxDate={endDate || undefined} />
        <label style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>To</label>
        <DatePicker value={endDate} onChange={(d) => { if (!d) return; if (startDate && d < startDate) { setEndDate(startDate) } else { setEndDate(d) } }} minDate={startDate || undefined} />

        {/* status filter */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setStatusMenuOpen((v) => !v)}
            style={{ ...btnBase, border: `1px solid ${statusFilter.length ? 'var(--accent)' : 'var(--border)'}`, background: statusFilter.length ? 'var(--accent-dim)' : 'var(--surface2)', color: statusFilter.length ? 'var(--accent)' : 'var(--text2)' }}
          >
            <Icon name="list" size={12} /> {statusFilter.length ? `${statusFilter.length} status${statusFilter.length > 1 ? 'es' : ''}` : 'All statuses'}
          </button>
          {statusMenuOpen && (
            <>
              <div onClick={() => setStatusMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
              <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 41, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: 'var(--shadow)', padding: 6, minWidth: 180 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 6, cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text2)' }}>
                  <input type="checkbox" checked={statusFilter.length === 0} onChange={() => setStatusFilter([])} style={{ cursor: 'pointer' }} />
                  All statuses
                </label>
                {statusGroups.map((g) => {
                  const checked = statusFilter.includes(g.id)
                  return (
                    <label key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 6, cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text)' }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => setStatusFilter((prev) => checked ? prev.filter((x) => x !== g.id) : [...prev, g.id])}
                        style={{ cursor: 'pointer' }}
                      />
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: `var(--${g.color === 'gray' ? 'text2' : g.color})`, border: '1px solid var(--border)', boxSizing: 'border-box' }} />
                      {g.label}
                    </label>
                  )
                })}
              </div>
            </>
          )}
        </div>

        {hiddenCount > 0 && (
          <button
            onClick={() => setShowHidden((v) => !v)}
            style={{ ...btnBase, border: `1px solid ${showHidden ? 'var(--amber-border)' : 'var(--border)'}`, background: showHidden ? 'var(--amber-dim)' : 'var(--surface2)', color: showHidden ? 'var(--amber)' : 'var(--text2)' }}
          >
            <Icon name="eye" size={12} /> {showHidden ? 'Hide hidden' : `Show hidden (${hiddenCount})`}
          </button>
        )}

        {addingCol ? (
          <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
            <input
              autoFocus
              placeholder="Column label"
              value={newColLabel}
              onChange={(e) => setNewColLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addColumn(); if (e.key === 'Escape') { setAddingCol(false); setNewColLabel('') } }}
              style={{ ...inputStyle, width: 140 }}
            />
            <button onClick={addColumn} style={{ ...btnBase, border: '1px solid var(--accent)', background: 'var(--accent-dim)', color: 'var(--accent)', padding: '3px 10px' }}>Add</button>
            <button onClick={() => { setAddingCol(false); setNewColLabel('') }} style={{ ...btnBase, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text3)', padding: '3px 8px' }}><Icon name="close" size={11} /></button>
          </div>
        ) : (
          <button onClick={() => setAddingCol(true)} style={{ ...btnBase, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text2)' }}>
            <Icon name="plus" size={11} /> Add Column
          </button>
        )}
        {cols.length > 0 && (
          <button onClick={() => setReleaseNoteColumns([])} style={{ ...btnBase, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text3)' }}>
            Clear all columns
          </button>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={download} style={{ ...btnBase, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text2)' }}>
            <Icon name="download" size={12} /> Download .md
          </button>
          <button onClick={copy} style={{ ...btnBase, background: copied ? 'var(--green-dim)' : 'var(--accent)', border: `1px solid ${copied ? 'var(--green-border)' : 'var(--accent)'}`, color: copied ? 'var(--green)' : '#fff', fontWeight: 600 }}>
            <Icon name={copied ? 'check' : 'copy'} size={12} color={copied ? 'var(--green)' : '#fff'} />
            {copied ? 'Copied!' : 'Copy Markdown'}
          </button>
        </div>
      </div>

      {(groupedRows.byGroup.size === 0 && groupedRows.ungrouped.length === 0) ? (
        <div style={{ color: 'var(--text3)', fontStyle: 'italic', fontSize: 13 }}>No issues found for this date range and status filter.</div>
      ) : (
        <>
          {/* render each status group as its own table */}
          {(statusGroups.length
            ? [
                ...statusGroups.map((g) => ({ id: g.id, label: g.label, color: g.color, rows: groupedRows.byGroup.get(g.id) ?? [] })),
                ...(groupedRows.ungrouped.length ? [{ id: '__other', label: 'Other', color: 'gray', rows: groupedRows.ungrouped }] : []),
              ]
            : [{ id: '__all', label: 'All Issues', color: 'gray', rows: [...groupedRows.ungrouped, ...Array.from(groupedRows.byGroup.values()).flat()] }]
          ).map(({ id, label, color, rows }) => {
            if (!rows.length) return null
            const groupAllChecked = rows.every((r) => isSelected(jiraDedupeKey(r.j.url, r.j.name)))
            const toggleGroupAll = () => {
              const val = !groupAllChecked
              rows.forEach((r) => updateReleaseNoteIssue(jiraDedupeKey(r.j.url, r.j.name), { selected: val }))
            }
            const accentVar = `var(--${color === 'gray' ? 'text3' : color})`
            const bgVar = `var(--${color === 'gray' ? 'surface2' : color + '-dim'})`
            const borderVar = `var(--${color === 'gray' ? 'border' : color + '-border'})`
            return (
              <div key={id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '3px 10px 3px 8px', borderRadius: 8, background: bgVar, border: `1px solid ${borderVar}`, alignSelf: 'flex-start' }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, color: accentVar }}>{label}</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: accentVar, opacity: 0.7 }}>{rows.length}</span>
                </div>
                <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12, fontFamily: 'var(--mono)' }}>
                    <thead>
                      <tr style={{ background: 'var(--surface2)' }}>
                        <th style={{ ...thStyle, width: 32 }}>
                          <input type="checkbox" checked={groupAllChecked} onChange={toggleGroupAll} style={{ cursor: 'pointer' }} />
                        </th>
                        <th style={thStyle}>Key</th>
                        <th style={thStyle}>Title</th>
                        <th style={thStyle}>Assignee</th>
                        <th style={thStyle}>Due Date</th>
                        <th style={thStyle}>Orig Est</th>
                        <th style={thStyle}>Time Spent</th>
                        <th style={thStyle}>SP</th>
                        {cols.map((col) => (
                          <th key={col.id} style={{ ...thStyle, minWidth: 110 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              {editingColId === col.id ? (
                                <input autoFocus value={editingColLabel} onChange={(e) => setEditingColLabel(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') commitEditCol() }} onBlur={commitEditCol} style={{ ...inputStyle, width: 90, fontSize: 10 }} />
                              ) : <span style={{ flex: 1 }}>{col.label}</span>}
                              <button onClick={() => startEditCol(col)} title="Edit" style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', padding: '0 2px', lineHeight: 1, display: 'flex', alignItems: 'center' }}><Icon name="edit" size={11} /></button>
                              <button onClick={() => deleteColumn(col.id)} title="Delete" style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', padding: '0 2px', lineHeight: 1, display: 'flex', alignItems: 'center' }}><Icon name="close" size={11} /></button>
                            </div>
                          </th>
                        ))}
                        <th style={{ ...thStyle, width: 36 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(({ j, devId }, i) => {
                        const issueKey = jiraDedupeKey(j.url, j.name)
                        const keyLabel = jiraLabel(j.url) || issueKey
                        const assignee = developers.find((d: Developer) => d.id === devId)?.name ?? '—'
                        const selected = isSelected(issueKey)
                        const rowBg = i % 2 === 0 ? 'var(--surface)' : 'var(--surface2)'
                        return (
                          <tr key={issueKey} style={{ background: rowBg }}>
                            <td style={{ ...tdStyle, width: 32 }}>
                              <input type="checkbox" checked={selected} onChange={() => updateReleaseNoteIssue(issueKey, { selected: !selected })} style={{ cursor: 'pointer' }} />
                            </td>
                            <td style={tdStyle}>
                              {j.url ? <a href={j.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}>{keyLabel}</a> : <span>{keyLabel}</span>}
                            </td>
                            <td style={{ ...tdStyle, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }} title={j.name}>{j.name || '—'}</td>
                            <td style={{ ...tdStyle, color: 'var(--text2)' }}>{assignee}</td>
                            <td style={{ ...tdStyle, color: 'var(--text3)' }}>{j.deadline ? formatDate(j.deadline) : '—'}</td>
                            <td style={{ ...tdStyle, color: 'var(--text3)' }}>{fmtSeconds((j as any).timeOriginalEstimate, hpd)}</td>
                            <td style={{ ...tdStyle, color: 'var(--text3)' }}>{fmtSeconds((j as any).timeSpent, hpd)}</td>
                            <td style={{ ...tdStyle, color: 'var(--text2)' }}>{(j as any).storyPoints ?? '—'}</td>
                            {cols.map((col) => (
                              <td key={col.id} style={{ ...tdStyle, minWidth: 110 }}>
                                <input value={rnData[issueKey]?.customFields?.[col.id] ?? ''} onChange={(e) => { const ex = rnData[issueKey]?.customFields ?? {}; updateReleaseNoteIssue(issueKey, { customFields: { ...ex, [col.id]: e.target.value } }) }} style={{ ...inputStyle }} />
                              </td>
                            ))}
                            <td style={{ ...tdStyle, width: 36 }}>
                              <button onClick={() => updateReleaseNoteIssue(issueKey, { hidden: true })} title="Hide" style={{ background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1, color: 'var(--text3)', display: 'flex', alignItems: 'center' }}><Icon name="eye" size={12} /></button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}

          {/* hidden issues */}
          {showHidden && groupedRows.hidden.map(({ j }) => {
            const issueKey = jiraDedupeKey(j.url, j.name)
            const keyLabel = jiraLabel(j.url) || issueKey
            return (
              <div key={issueKey} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', background: 'var(--amber-dim)', border: '1px solid var(--amber-border)', borderRadius: 6, fontFamily: 'var(--mono)', fontSize: 11, opacity: 0.7 }}>
                <span style={{ color: 'var(--amber)', flex: 1 }}>{keyLabel} — {j.name}</span>
                <button onClick={() => updateReleaseNoteIssue(issueKey, { hidden: false })} title="Restore" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--amber)', display: 'flex', alignItems: 'center' }}><Icon name="restore" size={12} /></button>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}

type SprintIssueRow = { j: JiraIssue; devId: string }

function ScrumReleaseNotes() {
  // @ts-ignore
  const state = useStore() as any
  const { tasks, developers, projects, sprints, selectedProject, selectedDev, jiraConnections, releaseNoteData, updateReleaseNoteIssue, releaseNoteColumns, setReleaseNoteColumns } = state
  const conn: JiraConfig | undefined = jiraConnections.find((c: JiraConfig) => c.enabled && c.statusMappings?.length)
  const hpd = conn?.hoursPerDay ?? 8
  const boardScope = getBoardScope(state)

  const memberIds = useMemo<Set<string> | null>(() => {
    if (selectedProject === 'ALL') return null
    const p = projects.find((pr: any) => pr.id === selectedProject)
    return p?.members?.length ? new Set<string>(p.members) : new Set<string>()
  }, [projects, selectedProject])

  const activeBoardId = getActiveBoardId(state)
  const projectSprints = useMemo((): Sprint[] =>
    sprints
      .filter((s: Sprint) => selectedProject === 'ALL'
        ? true
        : sprintMatchesBoard(s, selectedProject, activeBoardId))
      .sort((a: Sprint, b: Sprint) => b.startDate.localeCompare(a.startDate)),
    [sprints, selectedProject, activeBoardId]
  )

  const [selectedSprintId, setSelectedSprintId] = useState(() => projectSprints[0]?.id ?? '')

  // When the project/board changes, the previously selected sprint may no longer belong
  // to the current board — reset to the first valid sprint (or none) to avoid showing
  // issues from an unrelated board.
  useEffect(() => {
    if (!projectSprints.some((s) => s.id === selectedSprintId)) {
      setSelectedSprintId(projectSprints[0]?.id ?? '')
    }
  }, [projectSprints, selectedSprintId])
  const [copied, setCopied] = useState(false)
  const [showHidden, setShowHidden] = useState(false)
  const [addingCol, setAddingCol] = useState(false)
  const [newColLabel, setNewColLabel] = useState('')
  const [editingColId, setEditingColId] = useState<string | null>(null)
  const [editingColLabel, setEditingColLabel] = useState('')
  const [hiddenStatuses, setHiddenStatuses] = useState<Set<string>>(new Set())

  const cols: { id: string; label: string }[] = releaseNoteColumns ?? []
  const rnData: Record<string, { hidden?: boolean; selected?: boolean; customFields?: Record<string, string> }> = releaseNoteData ?? {}
  const sprint = projectSprints.find((s: Sprint) => s.id === selectedSprintId)

  const { completed, carriedOver, blocked } = useMemo((): { completed: SprintIssueRow[]; carriedOver: SprintIssueRow[]; blocked: SprintIssueRow[] } => {
    if (!sprint) return { completed: [], carriedOver: [], blocked: [] }

    const issuesDone = new Map<string, SprintIssueRow>()
    const issuesBlocked = new Map<string, SprintIssueRow>()
    const issuesAfterSprint = new Set<string>()

    tasks.forEach((t: Task) => {
      if (selectedProject !== 'ALL' && t.projectId !== selectedProject) return
      if (memberIds && !memberIds.has(t.devId)) return
      if (selectedDev !== 'ALL' && t.devId !== selectedDev) return
      const jiras = getJiras(t)
      jiras.forEach((j: JiraIssue) => {
        if (!jiraOnBoard(j, boardScope)) return
        if (j.hidden) return
        const key = jiraDedupeKey(j.url, j.name)
        if (t.date >= sprint.startDate && t.date <= sprint.endDate) {
          if (j.status === 'done' && !issuesDone.has(key)) issuesDone.set(key, { j, devId: t.devId })
          if (j.status === 'blocked' && !issuesBlocked.has(key)) issuesBlocked.set(key, { j, devId: t.devId })
        }
        if (t.date > sprint.endDate && j.status !== 'done') issuesAfterSprint.add(key)
      })
    })

    const carriedOverList: SprintIssueRow[] = []
    issuesAfterSprint.forEach((key) => {
      const task = tasks.find((t: Task) => {
        if (t.date < sprint.startDate || t.date > sprint.endDate) return false
        if (selectedDev !== 'ALL' && t.devId !== selectedDev) return false
        return getJiras(t).some((j: JiraIssue) => jiraDedupeKey(j.url, j.name) === key && j.status !== 'done')
      })
      if (task) {
        const j = getJiras(task).find((j: JiraIssue) => jiraDedupeKey(j.url, j.name) === key)
        if (j) carriedOverList.push({ j, devId: task.devId })
      }
    })

    return {
      completed: Array.from(issuesDone.values()),
      carriedOver: carriedOverList,
      blocked: Array.from(issuesBlocked.values()),
    }
  }, [sprint, tasks, selectedDev, selectedProject, memberIds, boardScope])

  const totalIssues = completed.length + carriedOver.length
  const completionPct = totalIssues > 0 ? Math.round((completed.length / totalIssues) * 100) : 0

  const isSelected = (key: string) => rnData[key]?.selected !== false

  const addColumn = () => {
    const label = newColLabel.trim()
    if (!label) return
    const id = genColId()
    setReleaseNoteColumns([...cols, { id, label }])
    setNewColLabel('')
    setAddingCol(false)
  }
  const deleteColumn = (colId: string) => setReleaseNoteColumns(cols.filter((c) => c.id !== colId))
  const startEditCol = (col: { id: string; label: string }) => { setEditingColId(col.id); setEditingColLabel(col.label) }
  const commitEditCol = () => {
    if (!editingColId) return
    const label = editingColLabel.trim()
    if (label) setReleaseNoteColumns(cols.map((c) => c.id === editingColId ? { ...c, label } : c))
    setEditingColId(null)
  }

  // All issues across sections for status chip computation
  const allIssues = [...completed, ...carriedOver, ...blocked]
  const allStatuses = Array.from(new Set(allIssues.map((r) => resolveIssueDisplay(r.j, conn).label)))
  const toggleStatus = (s: string) => setHiddenStatuses((prev) => {
    const next = new Set(prev)
    if (next.has(s)) next.delete(s); else next.add(s)
    return next
  })

  const buildMarkdown = () => {
    if (!sprint) return ''
    const lines: string[] = []
    lines.push(`# Sprint Release Notes — ${sprint.name}`)
    lines.push(`**${formatDate(sprint.startDate)} – ${formatDate(sprint.endDate)}**  |  Completion: ${completionPct}% (${completed.length}/${totalIssues})`)
    lines.push('')

    const section = (emoji: string, title: string, rows: SprintIssueRow[]) => {
      const visible = rows.filter((r) => {
        const key = jiraDedupeKey(r.j.url, r.j.name)
        return !rnData[key]?.hidden && isSelected(key)
      })
      if (!visible.length) return
      lines.push(`## ${emoji} ${title}`)
      const customHeaders = cols.map((c) => c.label).join(' | ')
      lines.push(`| Key | Title | Assignee | Due Date | Orig Est | Time Spent | SP | Status${cols.length ? ' | ' + customHeaders : ''} |`)
      lines.push(`|---|---|---|---|---|---|---|---${cols.map(() => '|---').join('')}|`)
      visible.forEach(({ j, devId }) => {
        const issKey = jiraDedupeKey(j.url, j.name)
        const key = jiraLabel(j.url) || issKey
        const assignee = developers.find((d: Developer) => d.id === devId)?.name ?? '—'
        const dueDate = j.deadline ? formatDate(j.deadline) : '—'
        const origEst = fmtSeconds((j as any).timeOriginalEstimate)
        const timeSpent = fmtSeconds((j as any).timeSpent)
        const sp = (j as any).storyPoints ?? '—'
        const status = resolveIssueDisplay(j, conn).label
        const customCells = cols.map((c) => rnData[issKey]?.customFields?.[c.id] ?? '').join(' | ')
        lines.push(`| ${key} | ${j.name || '—'} | ${assignee} | ${dueDate} | ${origEst} | ${timeSpent} | ${sp} | ${status}${cols.length ? ' | ' + customCells : ''} |`)
      })
      lines.push('')
    }

    section('✅', 'Completed', completed)
    section('🔄', 'Carried Over', carriedOver)
    section('⚠️', 'Blocked During Sprint', blocked)
    lines.push(`---`)
    lines.push(`Generated: ${formatDateTime(new Date())}`)
    return lines.join('\n')
  }

  const copy = async () => {
    await navigator.clipboard.writeText(buildMarkdown())
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const download = () => {
    const md = buildMarkdown()
    const blob = new Blob([md], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `sprint-notes-${sprint?.name ?? 'sprint'}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  const thStyle: React.CSSProperties = { padding: '6px 10px', textAlign: 'left', fontWeight: 700, color: 'var(--text3)', fontSize: 10, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
  const tdStyle: React.CSSProperties = { padding: '5px 10px', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)' }

  const IssueTable = ({ rows, label }: { rows: SprintIssueRow[]; label: string }) => {
    const baseRows = showHidden ? rows : rows.filter((r) => !rnData[jiraDedupeKey(r.j.url, r.j.name)]?.hidden)
    const allRows = baseRows.filter((r) => !hiddenStatuses.has(resolveIssueDisplay(r.j, conn).label))
    if (!allRows.length) return null
    const hiddenInGroup = rows.filter((r) => rnData[jiraDedupeKey(r.j.url, r.j.name)]?.hidden === true).length
    const allChecked = allRows.filter((r) => !rnData[jiraDedupeKey(r.j.url, r.j.name)]?.hidden).every((r) => isSelected(jiraDedupeKey(r.j.url, r.j.name)))

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, color: 'var(--text3)' }}>{label}</div>
          {hiddenInGroup > 0 && (
            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--amber)', background: 'var(--amber-dim)', border: '1px solid var(--amber-border)', borderRadius: 6, padding: '1px 6px' }}>
              {hiddenInGroup} hidden
            </span>
          )}
        </div>
        <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid var(--border)' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12, fontFamily: 'var(--mono)' }}>
            <thead>
              <tr style={{ background: 'var(--surface2)' }}>
                <th style={{ ...thStyle, width: 32 }}>
                  <input type="checkbox" checked={allChecked} onChange={() => {
                    const val = !allChecked
                    allRows.filter((r) => !rnData[jiraDedupeKey(r.j.url, r.j.name)]?.hidden).forEach((r) => {
                      updateReleaseNoteIssue(jiraDedupeKey(r.j.url, r.j.name), { selected: val })
                    })
                  }} style={{ cursor: 'pointer' }} />
                </th>
                <th style={thStyle}>Key</th>
                <th style={thStyle}>Title</th>
                <th style={thStyle}>Assignee</th>
                <th style={thStyle}>Due Date</th>
                <th style={thStyle}>Orig Est</th>
                <th style={thStyle}>Time Spent</th>
                <th style={thStyle}>SP</th>
                <th style={thStyle}>Status</th>
                {cols.map((col) => (
                  <th key={col.id} style={{ ...thStyle, minWidth: 110 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      {editingColId === col.id ? (
                        <input
                          autoFocus
                          value={editingColLabel}
                          onChange={(e) => setEditingColLabel(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') commitEditCol() }}
                          onBlur={commitEditCol}
                          style={{ ...inputStyle, width: 90, fontSize: 10 }}
                        />
                      ) : (
                        <span style={{ flex: 1 }}>{col.label}</span>
                      )}
                      <button onClick={() => startEditCol(col)} title="Edit column" style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', padding: '0 2px', lineHeight: 1, display: 'flex', alignItems: 'center' }}><Icon name="edit" size={11} /></button>
                      <button onClick={() => deleteColumn(col.id)} title="Delete column" style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', padding: '0 2px', lineHeight: 1, display: 'flex', alignItems: 'center' }}><Icon name="close" size={11} /></button>
                    </div>
                  </th>
                ))}
                <th style={{ ...thStyle, width: 36 }} />
              </tr>
            </thead>
            <tbody>
              {allRows.map(({ j, devId }, i) => {
                const issueKey = jiraDedupeKey(j.url, j.name)
                const keyLabel = jiraLabel(j.url) || issueKey
                const assignee = developers.find((d: Developer) => d.id === devId)?.name ?? '—'
                const { label: statusLabel, text: statusColor } = resolveIssueDisplay(j, conn)
                const isHidden = rnData[issueKey]?.hidden === true
                const selected = isSelected(issueKey)
                const rowBg = isHidden ? 'var(--amber-dim)' : (i % 2 === 0 ? 'var(--surface)' : 'var(--surface2)')
                return (
                  <tr key={issueKey} style={{ background: rowBg, opacity: isHidden ? 0.6 : 1 }}>
                    <td style={{ ...tdStyle, width: 32 }}>
                      <input type="checkbox" checked={selected} onChange={() => updateReleaseNoteIssue(issueKey, { selected: !selected })} style={{ cursor: 'pointer' }} disabled={isHidden} />
                    </td>
                    <td style={tdStyle}>
                      {j.url ? <a href={j.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}>{keyLabel}</a> : <span>{keyLabel}</span>}
                    </td>
                    <td style={{ ...tdStyle, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis' }} title={j.name}>{j.name || '—'}</td>
                    <td style={{ ...tdStyle, color: 'var(--text2)' }}>{assignee}</td>
                    <td style={{ ...tdStyle, color: 'var(--text3)' }}>{j.deadline ? formatDate(j.deadline) : '—'}</td>
                    <td style={{ ...tdStyle, color: 'var(--text3)' }}>{fmtSeconds((j as any).timeOriginalEstimate, hpd)}</td>
                    <td style={{ ...tdStyle, color: 'var(--text3)' }}>{fmtSeconds((j as any).timeSpent, hpd)}</td>
                    <td style={{ ...tdStyle, color: 'var(--text2)' }}>{(j as any).storyPoints ?? '—'}</td>
                    <td style={tdStyle}><span style={{ color: statusColor, fontWeight: 600 }}>{statusLabel}</span></td>
                    {cols.map((col) => (
                      <td key={col.id} style={{ ...tdStyle, minWidth: 110 }}>
                        <input
                          value={rnData[issueKey]?.customFields?.[col.id] ?? ''}
                          onChange={(e) => {
                            const existing = rnData[issueKey]?.customFields ?? {}
                            updateReleaseNoteIssue(issueKey, { customFields: { ...existing, [col.id]: e.target.value } })
                          }}
                          style={{ ...inputStyle }}
                        />
                      </td>
                    ))}
                    <td style={{ ...tdStyle, width: 36 }}>
                      {isHidden ? (
                        <button onClick={() => updateReleaseNoteIssue(issueKey, { hidden: false })} title="Restore" style={{ background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1, color: 'var(--amber)', display: 'flex', alignItems: 'center' }}><Icon name="restore" size={12} /></button>
                      ) : (
                        <button onClick={() => updateReleaseNoteIssue(issueKey, { hidden: true })} title="Hide issue" style={{ background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1, color: 'var(--text3)', display: 'flex', alignItems: 'center' }}><Icon name="eye" size={12} /></button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  const allHiddenCount = [...completed, ...carriedOver, ...blocked].filter((r) => rnData[jiraDedupeKey(r.j.url, r.j.name)]?.hidden === true).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <label style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>Sprint</label>
        {projectSprints.length === 0 ? (
          <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text3)', fontStyle: 'italic' }}>No sprints for this project.</span>
        ) : (
          <select
            value={selectedSprintId}
            onChange={(e) => setSelectedSprintId(e.target.value)}
            style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 12, padding: '4px 8px', borderRadius: 6 }}
          >
            {projectSprints.map((s: Sprint) => (
              <option key={s.id} value={s.id}>{s.name} ({formatDate(s.startDate)} – {formatDate(s.endDate)})</option>
            ))}
          </select>
        )}

        {allHiddenCount > 0 && (
          <button
            onClick={() => setShowHidden((v) => !v)}
            style={{ ...btnBase, border: `1px solid ${showHidden ? 'var(--amber-border)' : 'var(--border)'}`, background: showHidden ? 'var(--amber-dim)' : 'var(--surface2)', color: showHidden ? 'var(--amber)' : 'var(--text2)' }}
          >
            <Icon name="eye" size={12} /> {showHidden ? 'Hide hidden' : `Show hidden (${allHiddenCount})`}
          </button>
        )}

        {addingCol ? (
          <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
            <input
              autoFocus
              placeholder="Column label"
              value={newColLabel}
              onChange={(e) => setNewColLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addColumn(); if (e.key === 'Escape') { setAddingCol(false); setNewColLabel('') } }}
              style={{ ...inputStyle, width: 140 }}
            />
            <button onClick={addColumn} style={{ ...btnBase, border: '1px solid var(--accent)', background: 'var(--accent-dim)', color: 'var(--accent)', padding: '3px 10px' }}>Add</button>
            <button onClick={() => { setAddingCol(false); setNewColLabel('') }} style={{ ...btnBase, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text3)', padding: '3px 8px' }}><Icon name="close" size={11} /></button>
          </div>
        ) : (
          <button onClick={() => setAddingCol(true)} style={{ ...btnBase, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text2)' }}>
            <Icon name="plus" size={11} /> Add Column
          </button>
        )}
        {cols.length > 0 && (
          <button onClick={() => setReleaseNoteColumns([])} style={{ ...btnBase, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text3)' }}>
            Clear all columns
          </button>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={download} style={{ ...btnBase, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text2)' }}>
            <Icon name="download" size={12} /> Download .md
          </button>
          <button onClick={copy} style={{ ...btnBase, background: copied ? 'var(--green-dim)' : 'var(--accent)', border: `1px solid ${copied ? 'var(--green-border)' : 'var(--accent)'}`, color: copied ? 'var(--green)' : '#fff', fontWeight: 600 }}>
            <Icon name={copied ? 'check' : 'copy'} size={12} color={copied ? 'var(--green)' : '#fff'} />
            {copied ? 'Copied!' : 'Copy Markdown'}
          </button>
        </div>
      </div>

      {sprint && (
        <>
          <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{sprint.name}</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>
              {formatDate(sprint.startDate)} – {formatDate(sprint.endDate)}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <div style={{ flex: 1, height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${completionPct}%`, background: 'var(--accent)', borderRadius: 3, transition: 'width .3s' }} />
              </div>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text2)', whiteSpace: 'nowrap' }}>{completionPct}% ({completed.length}/{totalIssues})</span>
            </div>
          </div>

          {allStatuses.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>Filter:</span>
              {allStatuses.map((s) => {
                const active = !hiddenStatuses.has(s)
                return (
                  <button
                    key={s}
                    onClick={() => toggleStatus(s)}
                    style={{ fontFamily: 'var(--mono)', fontSize: 10, padding: '2px 8px', borderRadius: 10, border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`, background: active ? 'var(--accent-dim)' : 'var(--surface2)', color: active ? 'var(--accent)' : 'var(--text3)', cursor: 'pointer' }}
                  >{s}</button>
                )
              })}
            </div>
          )}

          <IssueTable rows={completed} label="✅ Completed" />
          <IssueTable rows={carriedOver} label="🔄 Carried Over" />
          <IssueTable rows={blocked} label="⚠️ Blocked During Sprint" />

          {completed.length === 0 && carriedOver.length === 0 && blocked.length === 0 && (
            <div style={{ color: 'var(--text3)', fontStyle: 'italic', fontSize: 13 }}>No issues found for this sprint.</div>
          )}
        </>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// Root: ReportView
// ═══════════════════════════════════════════════════════════════════════════════

type SubTab = 'standup' | 'monthly' | 'release'

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'standup', label: 'Standup' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'release', label: 'Release Notes' },
]

export default function ReportView() {
  const [tab, setTab] = useState<SubTab>('standup')

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* secondary tab bar */}
      <div style={{ display: 'flex', gap: 6, padding: '10px 16px', background: 'var(--surface)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        {SUB_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              fontFamily: 'var(--mono)', fontSize: 11, fontWeight: tab === t.id ? 700 : 400,
              padding: '4px 12px', borderRadius: 20, cursor: 'pointer', transition: 'var(--t)',
              border: `1px solid ${tab === t.id ? 'var(--accent)' : 'var(--border)'}`,
              background: tab === t.id ? 'var(--accent-dim)' : 'var(--surface2)',
              color: tab === t.id ? 'var(--accent)' : 'var(--text3)',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 20px' }}>
        {tab === 'standup' && <StandupSection />}
        {tab === 'monthly' && <MonthlySection />}
        {tab === 'release' && <ReleaseNotesSection />}
      </div>
    </div>
  )
}
