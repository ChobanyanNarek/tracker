import React, { useState, useMemo, useEffect } from 'react'
import { useStore, getBoardScope, jiraOnBoard, getActiveBoardId, sprintMatchesBoard } from '../../../store'
import { resolveIssueDisplay } from '../../ui/StatusBadge'
import { getJiras, jiraLabel, jiraDedupeKey } from '../../../utils/format'
import { copyText } from '../../../utils/clipboard'
import { formatDate, formatDateTime } from '../../../utils/dates'
import Icon from '../../ui/Icon'
import type { Developer, JiraConfig, JiraIssue, Sprint, Task } from '../../../types'
import { btnBase, inputStyle, fmtSeconds, genColId } from './shared'

type SprintIssueRow = { j: JiraIssue; devId: string }

export default function ScrumReleaseNotes() {
  const state = useStore()
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
        const origEst = fmtSeconds((j as any).timeOriginalEstimate, hpd)
        const timeSpent = fmtSeconds((j as any).timeSpent, hpd)
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
    const ok = await copyText(buildMarkdown())
    setCopied(ok)
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
