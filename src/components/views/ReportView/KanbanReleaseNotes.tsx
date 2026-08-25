import React, { useState, useMemo } from 'react'
import { useStore, getBoardScope, jiraOnBoard } from '../../../store'
import { resolveIssueDisplay } from '../../ui/StatusBadge'
import { getJiras, jiraLabel, jiraDedupeKey } from '../../../utils/format'
import { copyText } from '../../../utils/clipboard'
import { formatDate } from '../../../utils/dates'
import Icon from '../../ui/Icon'
import DatePicker from '../../ui/DatePicker'
import type { Developer, JiraConfig, Task } from '../../../types'
import { btnBase, inputStyle, fmtSeconds, genColId, IssueRow } from './shared'

export default function KanbanReleaseNotes() {
  const state = useStore()
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
    const ok = await copyText(buildMarkdown())
    setCopied(ok)
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
