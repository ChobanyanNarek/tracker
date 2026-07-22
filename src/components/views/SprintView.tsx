import { useState } from 'react'
import { useStore } from '../../store'
import type { Sprint } from '../../types'
import { initials, hexRgb } from '../../utils/format'
import SprintModal from '../sprint/SprintModal'

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function diffDays(a: string, b: string): number {
  return Math.round((new Date(b + 'T12:00:00').getTime() - new Date(a + 'T12:00:00').getTime()) / 86400000)
}

function fmtDate(d: string) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const IcoPlus = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
  </svg>
)

const IcoPencil = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
  </svg>
)

const IcoTrash = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
    <path d="M10 11v6M14 11v6"/>
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
  </svg>
)

function SprintCard({ sprint, onEdit, onDelete }: { sprint: Sprint; onEdit: () => void; onDelete: () => void }) {
  const { tasks, developers, selectedProject } = useStore()
  const today = todayStr()

  const totalDays = Math.max(1, diffDays(sprint.startDate, sprint.endDate))
  const elapsed = Math.max(0, Math.min(totalDays, diffDays(sprint.startDate, today)))
  const daysLeft = Math.max(0, diffDays(today, sprint.endDate))
  const progress = Math.round((elapsed / totalDays) * 100)
  const isOver = today > sprint.endDate
  const isActive = today >= sprint.startDate && today <= sprint.endDate

  const projectTasks = tasks.filter((t) => t.projectId === selectedProject)
  const allJiras = projectTasks.flatMap((t) => t.jiras ?? [])

  const todo = allJiras.filter((j) => j.status === 'todo' && !j.hidden).length
  const active = allJiras.filter((j) => j.status === 'inprogress' && !j.hidden).length
  const review = allJiras.filter((j) => j.status === 'review' && !j.hidden).length
  const blocked = allJiras.filter((j) => j.status === 'blocked' && !j.hidden).length
  const done = allJiras.filter((j) => j.status === 'done' && !j.hidden).length
  const total = todo + active + review + blocked + done

  // Per-dev stats
  const devStats = developers.map((dev) => {
    const devJiras = projectTasks.filter((t) => t.devId === dev.id).flatMap((t) => t.jiras ?? []).filter((j) => !j.hidden)
    const devDone = devJiras.filter((j) => j.status === 'done').length
    const devTotal = devJiras.length
    return { dev, done: devDone, total: devTotal }
  }).filter((d) => d.total > 0)

  const blocked_issues = allJiras.filter((j) => j.status === 'blocked' && !j.hidden)

  return (
    <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
      {/* Sprint header */}
      <div style={{ padding: '12px 14px 10px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{sprint.name}</span>
            {isActive && <span style={{ fontSize: 9, fontWeight: 700, background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 5, padding: '1px 6px', letterSpacing: '.4px' }}>ACTIVE</span>}
            {isOver && <span style={{ fontSize: 9, fontWeight: 700, background: 'rgba(239,68,68,.1)', color: 'var(--red)', border: '1px solid var(--red)', borderRadius: 5, padding: '1px 6px' }}>ENDED</span>}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)', marginTop: 2 }}>
            {fmtDate(sprint.startDate)} – {fmtDate(sprint.endDate)}
            {!isOver && <span style={{ marginLeft: 8, color: daysLeft <= 3 ? 'var(--amber)' : 'var(--text3)' }}>{daysLeft === 0 ? 'Last day' : `${daysLeft}d left`}</span>}
          </div>
        </div>
        <button onClick={onEdit} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text3)', width: 24, height: 24, borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><IcoPencil /></button>
        <button onClick={onDelete} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text3)', width: 24, height: 24, borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><IcoTrash /></button>
      </div>

      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Progress */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.5px' }}>Time Progress</span>
            <span style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--text3)' }}>{progress}%</span>
          </div>
          <div style={{ height: 5, borderRadius: 4, background: 'var(--border2)' }}>
            <div style={{ height: '100%', width: `${progress}%`, background: isOver ? 'var(--red)' : 'var(--accent)', borderRadius: 4 }} />
          </div>
        </div>

        {/* Issue stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
          {[
            { label: 'Todo', value: todo, color: 'var(--text3)', bg: 'var(--surface3)' },
            { label: 'Active', value: active, color: 'var(--accent)', bg: 'var(--accent-dim)' },
            { label: 'Review', value: review, color: 'var(--amber)', bg: 'rgba(245,158,11,.1)' },
            { label: 'Blocked', value: blocked, color: 'var(--red)', bg: 'rgba(239,68,68,.1)' },
            { label: 'Done', value: done, color: 'var(--green)', bg: 'rgba(34,197,94,.1)' },
          ].map(({ label, value, color, bg }) => (
            <div key={label} style={{ background: bg, borderRadius: 6, padding: '8px 6px', textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 700, color, fontFamily: 'var(--mono)' }}>{value}</div>
              <div style={{ fontSize: 9, color: 'var(--text3)', letterSpacing: '.3px', marginTop: 1 }}>{label}</div>
            </div>
          ))}
        </div>

        {/* Completion bar */}
        {total > 0 && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.5px' }}>Done</span>
              <span style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--text3)' }}>{done}/{total}</span>
            </div>
            <div style={{ height: 5, borderRadius: 4, background: 'var(--border2)', display: 'flex', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${(done / total) * 100}%`, background: 'var(--green)', borderRadius: 4 }} />
            </div>
          </div>
        )}

        {/* Per-dev breakdown */}
        {devStats.length > 0 && (
          <div>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 6 }}>By Developer</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {devStats.map(({ dev, done: d, total: t }) => {
                const rgb = hexRgb(dev.color)
                return (
                  <div key={dev.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div className="av" style={{ width: 20, height: 20, fontSize: 7, background: `rgba(${rgb},.15)`, color: dev.color, border: `1.5px solid ${dev.color}30`, flexShrink: 0 }}>{initials(dev.name)}</div>
                    <div style={{ fontSize: 11, color: 'var(--text2)', flex: '0 0 80px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{dev.name}</div>
                    <div style={{ flex: 1, height: 4, borderRadius: 4, background: 'var(--border2)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: t > 0 ? `${(d / t) * 100}%` : '0%', background: dev.color, borderRadius: 4 }} />
                    </div>
                    <span style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--text3)', flexShrink: 0 }}>{d}/{t}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Blocked issues */}
        {blocked_issues.length > 0 && (
          <div>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--red)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 5 }}>Blocked Issues</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {blocked_issues.slice(0, 5).map((j, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 7px', background: 'rgba(239,68,68,.07)', borderRadius: 5, border: '1px solid rgba(239,68,68,.2)' }}>
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
                  {j.url ? (
                    <a href={j.url} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: 'var(--text2)', textDecoration: 'none', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{j.name || j.url}</a>
                  ) : (
                    <span style={{ fontSize: 10, color: 'var(--text2)', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{j.name}</span>
                  )}
                </div>
              ))}
              {blocked_issues.length > 5 && <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)', paddingLeft: 2 }}>+{blocked_issues.length - 5} more</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function SprintView() {
  const { selectedProject, sprints, projects, deleteSprint } = useStore()
  const [modalSprint, setModalSprint] = useState<Sprint | null | 'new'>(null)

  const proj = projects.find((p) => p.id === selectedProject)
  const projectSprints = sprints.filter((s) => s.projectId === selectedProject)

  if (selectedProject === 'ALL' || !proj) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', fontFamily: 'var(--mono)', fontSize: 12 }}>
        Select a project to view sprints
      </div>
    )
  }

  if (proj.mode !== 'scrum') {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', fontFamily: 'var(--mono)', fontSize: 12 }}>
        This project is in Kanban mode — switch to Scrum in project settings
      </div>
    )
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.8px' }}>
          {proj.name} · Sprints
        </span>
        <button
          onClick={() => setModalSprint('new')}
          style={{ display: 'flex', alignItems: 'center', gap: 5, border: '1px solid var(--accent)', background: 'var(--accent-dim)', color: 'var(--accent)', fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 500, padding: '5px 12px', borderRadius: 7, cursor: 'pointer' }}
        >
          <IcoPlus />
          New sprint
        </button>
      </div>

      {projectSprints.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 20px', color: 'var(--text3)', fontFamily: 'var(--mono)', fontSize: 12, gap: 10 }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.3 }}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          <span>No sprints yet — click New sprint to create one</span>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
          {projectSprints.map((sprint) => (
            <SprintCard
              key={sprint.id}
              sprint={sprint}
              onEdit={() => setModalSprint(sprint)}
              onDelete={() => deleteSprint(sprint.id)}
            />
          ))}
        </div>
      )}

      {modalSprint !== null && (
        <SprintModal
          sprint={modalSprint === 'new' ? null : modalSprint}
          projectId={selectedProject}
          onClose={() => setModalSprint(null)}
        />
      )}
    </div>
  )
}
