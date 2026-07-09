import { useState } from 'react'
import { useStore } from '../../store'
import { STATUS_LABEL } from '../../constants'
import { getJiras, hexRgb, initials } from '../../utils/format'
import type { Status } from '../../types'
import EmptyState from '../ui/EmptyState'

type StatusFilter = 'ALL' | Status

export default function SearchView() {
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')

  const { tasks, developers, projects, selectedProject, setSelectedDate, setSelectedDev, setSelectedProject, setHighlightedTaskId, setView } = useStore()

  const q = query.trim().toLowerCase()

  const archivedIds = new Set(developers.filter((d) => d.archivedAt).map((d) => d.id))

  let filtered = tasks.filter((t) => !archivedIds.has(t.devId))
  if (selectedProject !== 'ALL') filtered = filtered.filter((t) => t.projectId === selectedProject)
  if (statusFilter !== 'ALL') filtered = filtered.filter((t) => t.status === statusFilter)
  if (q) {
    filtered = filtered.filter((t) => {
      const dev = developers.find((d) => d.id === t.devId)
      const proj = projects.find((p) => p.id === t.projectId)
      const jiraText = getJiras(t)
        .map((j) => `${j.name} ${j.url} ${j.comment}`)
        .join(' ')
        .toLowerCase()
      return (
        t.title.toLowerCase().includes(q) ||
        (t.comment ?? '').toLowerCase().includes(q) ||
        jiraText.includes(q) ||
        (dev?.name ?? '').toLowerCase().includes(q) ||
        (proj?.name ?? '').toLowerCase().includes(q) ||
        t.date.includes(q)
      )
    })
  }
  filtered = [...filtered].sort((a, b) => b.date.localeCompare(a.date))

  const escapeHtml = (s: string) =>
    s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

  const highlight = (str: string) => {
    // Escape first — the result is injected via dangerouslySetInnerHTML, so raw
    // user text (task titles/comments) must never reach the DOM as markup.
    const safe = escapeHtml(str)
    if (!q) return safe
    return safe.replace(
      new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'),
      '<mark style="background:#fef9c3;color:var(--text);border-radius:2px;padding:0 2px">$1</mark>',
    )
  }

  const statuses: StatusFilter[] = ['ALL', 'todo', 'inprogress', 'review', 'done', 'blocked']

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* search bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface)', border: `1px solid ${q ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 'var(--rl)', padding: '8px 14px', boxShadow: 'var(--shadow)', transition: 'border-color .15s' }}>
        <span style={{ color: 'var(--text3)', fontSize: 16, flexShrink: 0 }}>🔍</span>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search checkpoints, Jira issues, developers, projects…"
          style={{ flex: 1, border: 'none', outline: 'none', fontSize: 14, color: 'var(--text)', background: 'transparent' }}
        />
        {q && (
          <button onClick={() => setQuery('')} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 14, padding: '2px 4px' }}>✕</button>
        )}
      </div>

      {/* filters */}
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

      {/* meta */}
      <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>
        {q || statusFilter !== 'ALL' ? `${filtered.length} result${filtered.length !== 1 ? 's' : ''}${q ? ` for "${q}"` : ''}` : `${filtered.length} total checkpoint${filtered.length !== 1 ? 's' : ''}`}
      </div>

      {/* results */}
      {filtered.length === 0 ? (
        <EmptyState icon="🔍" title="No results" hint="Try different keywords or filters" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {filtered.map((t) => {
            const dev = developers.find((d) => d.id === t.devId)
            const proj = projects.find((p) => p.id === t.projectId)
            const rgb = dev ? hexRgb(dev.color) : '37,99,235'
            const devColor = dev?.color ?? '#2563eb'

            return (
              <div
                key={t.id}
                onClick={() => { setSelectedDev('ALL'); setSelectedProject('ALL'); setSelectedDate(t.date); setHighlightedTaskId(t.id); setView('daily') }}
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rl)', padding: '11px 13px', cursor: 'pointer', transition: 'all .15s' }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.boxShadow = 'var(--shadow)' }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = '' }}
              >
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 5 }} dangerouslySetInnerHTML={{ __html: highlight(t.title) }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span className={`spill s-${t.status}`} style={{ marginTop: 0 }}>{STATUS_LABEL[t.status]}</span>
                  {dev && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <div className="av" style={{ background: `rgba(${rgb},.15)`, color: devColor, width: 16, height: 16, fontSize: 8, flexShrink: 0 }}>{initials(dev.name)}</div>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>{dev.name}</span>
                    </div>
                  )}
                  {proj && <span style={{ fontFamily: 'var(--mono)', fontSize: 10, padding: '1px 6px', borderRadius: 3, background: proj.color + '18', color: proj.color }}>{proj.name}</span>}
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>{t.date}</span>
                  {t.comment && <span style={{ fontSize: 11, color: 'var(--text3)', fontStyle: 'italic' }} dangerouslySetInnerHTML={{ __html: highlight(t.comment.slice(0, 60) + (t.comment.length > 60 ? '…' : '')) }} />}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
