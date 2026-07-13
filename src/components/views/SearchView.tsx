import { useState } from 'react'
import { useStore } from '../../store'
import { STATUS_LABEL } from '../../constants'
import { resolveIssueDisplay } from '../ui/StatusBadge'
import { getJiras, jiraLabel, jiraDedupeKey, hexRgb, initials } from '../../utils/format'
import { dlInfo } from '../../utils/dates'
import type { Status, Task, JiraIssue, Developer, Project } from '../../types'
import EmptyState from '../ui/EmptyState'

type StatusFilter = 'ALL' | Status

interface IssueResult {
  key: string
  issue: JiraIssue
  task: Task
  dev: Developer | undefined
  proj: Project | undefined
  issueKey: string | null  // extracted from URL via regex, e.g. "NML-3776"
}

interface PlainResult {
  task: Task
  dev: Developer | undefined
  proj: Project | undefined
}

export default function SearchView() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')

  const {
    tasks, developers, projects, selectedProject,
    searchQuery, setSearchQuery, jiraConnections,
    setSelectedDate, setSelectedDev, setSelectedProject, setHighlightedTaskId, setView,
  } = useStore()
  const conn = jiraConnections.find((c) => c.enabled && c.statusMappings?.length)

  const q = searchQuery.trim().toLowerCase()

  const archivedIds = new Set(developers.filter((d) => d.archivedAt).map((d) => d.id))
  const devById = new Map(developers.map((d) => [d.id, d]))
  const projById = new Map(projects.map((p) => [p.id, p]))

  // ── Build issue-centric index (deduplicated by issueId / dedupeKey) ──────────
  // For each unique issue, keep the task with the most recent date.
  const issueMap = new Map<string, IssueResult>()
  const plainMap = new Map<string, PlainResult>()  // tasks with no jiras

  for (const task of tasks) {
    if (archivedIds.has(task.devId)) continue
    if (selectedProject !== 'ALL' && task.projectId !== selectedProject) continue

    const jiras = getJiras(task)
    if (jiras.length) {
      for (const issue of jiras) {
        const dk = jiraLabel(issue.url) ?? jiraDedupeKey(issue.url, issue.name)
        const key = `${task.devId}|${dk}`
        const ex = issueMap.get(key)
        if (!ex || task.date > ex.task.date) {
          issueMap.set(key, {
            key,
            issue,
            task,
            dev: devById.get(task.devId),
            proj: projById.get(task.projectId),
            issueKey: jiraLabel(issue.url),
          })
        }
      }
    } else if (task.title || task.comment) {
      // Plain tasks without jiras — deduplicate by devId+title
      const pk = `${task.devId}|title:${task.title}`
      const ex = plainMap.get(pk)
      if (!ex || task.date > ex.task.date) {
        plainMap.set(pk, { task, dev: devById.get(task.devId), proj: projById.get(task.projectId) })
      }
    }
  }

  // ── Filter ────────────────────────────────────────────────────────────────────
  const matchIssue = (r: IssueResult): boolean => {
    if (statusFilter !== 'ALL' && r.issue.status !== statusFilter) return false
    if (!q) return true
    const issueKey = r.issueKey?.toLowerCase() ?? ''
    return (
      issueKey.includes(q) ||
      r.issue.name.toLowerCase().includes(q) ||
      r.issue.url.toLowerCase().includes(q) ||
      (r.issue.comment ?? '').toLowerCase().includes(q) ||
      (r.dev?.name ?? '').toLowerCase().includes(q) ||
      (r.proj?.name ?? '').toLowerCase().includes(q) ||
      r.task.date.includes(q)
    )
  }

  const matchPlain = (r: PlainResult): boolean => {
    if (statusFilter !== 'ALL' && r.task.status !== statusFilter) return false
    if (!q) return true
    return (
      r.task.title.toLowerCase().includes(q) ||
      (r.task.comment ?? '').toLowerCase().includes(q) ||
      (r.dev?.name ?? '').toLowerCase().includes(q) ||
      (r.proj?.name ?? '').toLowerCase().includes(q) ||
      r.task.date.includes(q)
    )
  }

  const issueResults = [...issueMap.values()].filter(matchIssue)
    .sort((a, b) => b.task.date.localeCompare(a.task.date))
  const plainResults = [...plainMap.values()].filter(matchPlain)
    .sort((a, b) => b.task.date.localeCompare(a.task.date))

  const totalCount = issueResults.length + plainResults.length

  // ── Highlight helper ──────────────────────────────────────────────────────────
  const escHtml = (s: string) =>
    s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

  const hl = (str: string) => {
    const safe = escHtml(str)
    if (!q) return safe
    return safe.replace(
      new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'),
      '<mark style="background:#fef9c3;color:var(--text);border-radius:2px;padding:0 2px">$1</mark>',
    )
  }

  const jumpTo = (task: Task) => {
    setSelectedDev('ALL')
    setSelectedProject('ALL')
    setSelectedDate(task.date)
    setHighlightedTaskId(task.id)
    setView('daily')
  }

  const statuses: StatusFilter[] = ['ALL', 'todo', 'inprogress', 'review', 'done', 'blocked']

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* search bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface)', border: `1px solid ${q ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 'var(--rl)', padding: '8px 14px', boxShadow: 'var(--shadow)', transition: 'border-color .15s' }}>
        <span style={{ color: 'var(--text3)', fontSize: 16, flexShrink: 0 }}>🔍</span>
        <input
          autoFocus
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by issue key (NML-123), name, developer, project…"
          style={{ flex: 1, border: 'none', outline: 'none', fontSize: 14, color: 'var(--text)', background: 'transparent' }}
        />
        {q && (
          <button onClick={() => setSearchQuery('')} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 14, padding: '2px 4px' }}>✕</button>
        )}
      </div>

      {/* status filters */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {statuses.map((s) => (
          <button
            key={s}
            className={`chip${statusFilter === s ? ' active' : ''}`}
            onClick={() => setStatusFilter(s)}
          >
            {s === 'ALL' ? 'All statuses' : STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      {/* count */}
      <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>
        {q || statusFilter !== 'ALL'
          ? `${totalCount} result${totalCount !== 1 ? 's' : ''}${q ? ` for "${q}"` : ''}`
          : `${totalCount} issue${totalCount !== 1 ? 's' : ''} total`}
      </div>

      {/* results */}
      {totalCount === 0 ? (
        <EmptyState icon="🔍" title="No results" hint="Try different keywords or filters" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {/* Jira issue cards */}
          {issueResults.map((r) => {
            const { issue, task, dev, proj, issueKey } = r
            const rgb = dev ? hexRgb(dev.color) : '37,99,235'
            const devColor = dev?.color ?? '#2563eb'
            const dl = issue.deadline ? dlInfo(issue.deadline) : null
            const { label: issueStatusLabel, text: statusColor } = resolveIssueDisplay(issue, conn)

            return (
              <div
                key={r.key}
                onClick={() => jumpTo(task)}
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rl)', padding: '11px 13px', cursor: 'pointer', transition: 'all .15s' }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.boxShadow = 'var(--shadow)' }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = '' }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                  {/* issue key badge */}
                  {issueKey && (
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: 'var(--surface3)', color: 'var(--text2)', border: '1px solid var(--border)', flexShrink: 0, whiteSpace: 'nowrap' }}
                      dangerouslySetInnerHTML={{ __html: hl(issueKey) }}
                    />
                  )}
                  <span
                    style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', flex: 1, minWidth: 0 }}
                    dangerouslySetInnerHTML={{ __html: hl(issue.name || issue.url || 'Issue') }}
                  />
                  {dl && (
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: dl.cls === 'dl-over' ? 'var(--red)' : dl.cls === 'dl-warn' ? 'var(--amber)' : 'var(--green)', flexShrink: 0, whiteSpace: 'nowrap' }}>
                      {dl.text}
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {/* status dot */}
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: 'var(--mono)', fontSize: 10, color: statusColor }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
                    {issueStatusLabel}
                  </span>

                  {dev && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <div className="av" style={{ background: `rgba(${rgb},.15)`, color: devColor, width: 16, height: 16, fontSize: 8, flexShrink: 0 }}>{initials(dev.name)}</div>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }} dangerouslySetInnerHTML={{ __html: hl(dev.name) }} />
                    </div>
                  )}

                  {proj && (
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 10, padding: '1px 6px', borderRadius: 3, background: proj.color + '18', color: proj.color }}
                      dangerouslySetInnerHTML={{ __html: hl(proj.name) }}
                    />
                  )}

                  <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>{task.date}</span>

                  {issue.comment && (
                    <span style={{ fontSize: 11, color: 'var(--text3)', fontStyle: 'italic' }}
                      dangerouslySetInnerHTML={{ __html: hl(issue.comment.slice(0, 80) + (issue.comment.length > 80 ? '…' : '')) }}
                    />
                  )}
                </div>
              </div>
            )
          })}

          {/* Plain task cards (no jiras) */}
          {plainResults.map(({ task, dev, proj }) => {
            const rgb = dev ? hexRgb(dev.color) : '37,99,235'
            const devColor = dev?.color ?? '#2563eb'
            return (
              <div
                key={task.id}
                onClick={() => jumpTo(task)}
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: '3px solid var(--border)', borderRadius: 'var(--rl)', padding: '11px 13px', cursor: 'pointer', transition: 'all .15s', opacity: 0.85 }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.boxShadow = 'var(--shadow)' }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = '' }}
              >
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 5 }}
                  dangerouslySetInnerHTML={{ __html: hl(task.title) }}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span className={`spill s-${task.status}`} style={{ marginTop: 0 }}>{STATUS_LABEL[task.status]}</span>
                  {dev && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <div className="av" style={{ background: `rgba(${rgb},.15)`, color: devColor, width: 16, height: 16, fontSize: 8, flexShrink: 0 }}>{initials(dev.name)}</div>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>{dev.name}</span>
                    </div>
                  )}
                  {proj && <span style={{ fontFamily: 'var(--mono)', fontSize: 10, padding: '1px 6px', borderRadius: 3, background: proj.color + '18', color: proj.color }}>{proj.name}</span>}
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>{task.date}</span>
                  {task.comment && (
                    <span style={{ fontSize: 11, color: 'var(--text3)', fontStyle: 'italic' }}
                      dangerouslySetInnerHTML={{ __html: hl(task.comment.slice(0, 60) + (task.comment.length > 60 ? '…' : '')) }}
                    />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
