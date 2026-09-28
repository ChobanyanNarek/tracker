import { useMemo, useState } from 'react'
import { useStore } from '../../store'
import { computeTeamPerformance } from '../../utils/performance'
import { computePlanStatus, type Feasibility, type PlanHealth, type PlanStatus } from '../../utils/plan'
/*
 * Hours throughout, never days. The document sent to the partner is written in hours, and
 * a screen that answers "are we inside it" has to be readable straight against that
 * document — "254h of 320h", not "31.8d of 320h".
 */
const hrs = (h: number) => `${Math.round(h)}h`
import EmptyState from '../ui/EmptyState'
import PlanEditor from './PlanEditor'

const GREEN = 'var(--green)'
const AMBER = 'var(--amber)'
const RED = 'var(--red)'

const PLAN_HEALTH: Record<PlanHealth, { label: string; color: string }> = {
  onPlan: { label: 'inside the hours', color: GREEN },
  atRisk: { label: 'slightly over', color: AMBER },
  over: { label: 'heading over', color: RED },
  noData: { label: 'nothing delivered yet', color: 'var(--text3)' },
}

const FEASIBILITY: Record<Feasibility, { label: string; color: string } | null> = {
  fits: null, // the ordinary case needs no badge
  tight: { label: 'barely enough time', color: AMBER },
  impossible: { label: 'not enough hours before the date', color: RED },
  unknown: null,
}

/*
 * The agreed document, against reality. Three answers, because they fail separately: are we
 * inside the hours, will we make the date, and do these people even have the hours.
 */
function PlanPanel({ status, devName }: { status: PlanStatus; devName: (id: string) => string }) {
  const hoursLabel = (h: number | null) => (h == null ? '—' : hrs(h))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {status.lines.map((l) => {
        const health = PLAN_HEALTH[l.health]
        const feas = FEASIBILITY[l.feasibility]
        const usedPct = l.allocatedH > 0 ? Math.min(100, (l.actualH / l.allocatedH) * 100) : 0
        const projPct = l.projectedH != null && l.allocatedH > 0 ? Math.min(140, (l.projectedH / l.allocatedH) * 100) : null

        return (
          <div key={l.line.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{l.line.label || 'Untitled line'}</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>
                {l.line.target.kind === 'developer' ? devName(l.line.target.devId) : l.line.target.roles.join(' + ') || 'no role picked'}
              </span>
              <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text2)', fontVariantNumeric: 'tabular-nums' }}>
                {hoursLabel(l.actualH)} of {hrs(l.allocatedH)}
              </span>
            </div>

            {/* spent, with the projection drawn past it when it runs over */}
            <div style={{ position: 'relative', height: 12, background: 'var(--surface3)', borderRadius: 4, overflow: 'hidden' }}>
              {projPct != null && projPct > usedPct && (
                <div style={{ position: 'absolute', inset: 0, width: `${projPct}%`, background: health.color, opacity: 0.25 }} />
              )}
              <div style={{ position: 'absolute', inset: 0, width: `${usedPct}%`, background: health.color }} />
              {l.allocatedH > 0 && projPct != null && projPct > 100 && (
                <div style={{ position: 'absolute', top: 0, bottom: 0, left: '100%', width: 2, background: 'var(--text)' }} />
              )}
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text3)' }}>
              <span style={{ color: health.color }}>{health.label}</span>
              {l.projectedH != null && (
                <span>will land near <b style={{ color: 'var(--text2)' }}>{hrs(l.projectedH)}</b>
                  {l.deviationPct != null && Math.abs(l.deviationPct) >= 1 && (
                    <b style={{ color: l.deviationPct > 0 ? RED : GREEN }}> ({l.deviationPct > 0 ? '+' : ''}{Math.round(l.deviationPct)}%)</b>
                  )}
                </span>
              )}
              <span>{l.deliveredCount} done · {l.openCount} open</span>
              {l.capacityLeftH != null && (
                <span title="Working hours these people have left before the date, after leave and holidays">
                  {hoursLabel(l.capacityLeftH)} available
                  {l.remainingH != null && l.remainingH > l.capacityLeftH && <b style={{ color: RED }}> · {hrs(l.remainingH)} still needed</b>}
                </span>
              )}
              {l.end && <span>by {l.end}</span>}
              {feas && <span style={{ color: feas.color }}>· {feas.label}</span>}
              {l.unsizedCount > 0 && <span>· {l.unsizedCount} unsized</span>}
            </div>
          </div>
        )
      })}

      {(status.unplannedCount > 0 || status.unsizedCount > 0) && (
        <div style={{ fontSize: 10, color: 'var(--text3)', lineHeight: 1.6, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          {status.unplannedCount > 0 && <>{status.unplannedCount} issue{status.unplannedCount === 1 ? '' : 's'} belong to nobody in the plan. </>}
          {status.unsizedCount > 0 && <>{status.unsizedCount} could not be sized — no estimate, no branch, no dates. </>}
          They are outside every number above.
        </div>
      )}
    </div>
  )
}


/**
 * Plan vs actual: what was promised to the partner, against what is happening.
 *
 * The other views describe the work; this one holds it to the document that was agreed
 * before any of it started. Three answers, kept apart because they fail apart: are we
 * inside the hours, will we make the date, and do these people even have the hours.
 */
export default function PlanView() {
  const store = useStore()
  const { developers, projects, tasks, schedule, scheduleHours, selectedProject, updateProject } = store
  const [editing, setEditing] = useState(false)

  const project = selectedProject !== 'ALL' ? projects.find((p) => p.id === selectedProject) : null

  const team = useMemo(
    () => computeTeamPerformance({ developers, tasks, schedule, scheduleHours }),
    [developers, tasks, schedule, scheduleHours],
  )

  const status = useMemo(
    () => (project ? computePlanStatus(project, developers, tasks, team, schedule, scheduleHours) : null),
    [project, developers, tasks, team, schedule, scheduleHours],
  )

  if (!project) {
    return (
      <EmptyState
        icon="flag"
        title="Pick a project"
        hint="A plan belongs to one project — choose one at the top to see how it is holding up."
      />
    )
  }

  const editor = (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rx)', padding: 16 }}>
      <PlanEditor
        project={project}
        developers={developers}
        tasks={tasks}
        onChange={(plan) => updateProject(project.id, { plan })}
      />
    </div>
  )

  /*
   * With nothing filled in there is nothing to compare, so the form is the screen. This is
   * where the numbers come from, so it belongs here rather than behind project settings.
   */
  if (!status) {
    return (
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 760 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{project.name}</div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4, lineHeight: 1.6 }}>
            Enter the hours from the document you sent the partner. Once they are here, this
            screen shows whether the work opened since is still inside them.
          </div>
        </div>
        {editor}
      </div>
    )
  }

  const overall = status.deviationPct
  const headline = overall == null ? null
    : overall > 10 ? { text: `Heading ${Math.round(overall)}% over the agreed hours`, color: RED }
    : overall > 0 ? { text: `About ${Math.round(overall)}% over — worth watching`, color: AMBER }
    : { text: `Inside the agreed hours by ${Math.abs(Math.round(overall))}%`, color: GREEN }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{project.name}</span>
        {status.targetEnd && (
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>agreed by {status.targetEnd}</span>
        )}
        {headline && (
          <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: headline.color }}>{headline.text}</span>
        )}
        <button className="btn-soft" onClick={() => setEditing((e) => !e)} style={{ flexShrink: 0 }}>
          {editing ? 'Done editing' : 'Edit the agreement'}
        </button>
      </div>

      {editing && editor}

      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        {[
          { label: 'Agreed', value: hrs(status.allocatedH), color: undefined as string | undefined, sub: undefined as string | undefined },
          { label: 'Spent', value: hrs(status.actualH), color: undefined, sub: undefined },
          {
            label: 'Will land near',
            value: status.projectedH != null ? hrs(status.projectedH) : '—',
            color: headline?.color,
            sub: overall != null ? `${overall > 0 ? '+' : ''}${Math.round(overall)}%` : undefined,
          },
          {
            label: 'Hours available',
            value: status.capacityLeftH != null ? hrs(status.capacityLeftH) : '—',
            color: status.feasibility === 'impossible' ? RED : status.feasibility === 'tight' ? AMBER : undefined,
            sub: status.feasibility === 'impossible' ? 'not enough' : status.feasibility === 'tight' ? 'tight' : 'before the date',
          },
        ].map((c) => (
          <div key={c.label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: '7px 11px', flexShrink: 0 }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.6px', whiteSpace: 'nowrap' }}>{c.label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: c.color ?? 'var(--text)', lineHeight: 1.1 }}>{c.value}</div>
            {c.sub && <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: c.color ?? 'var(--text3)', marginTop: 1, whiteSpace: 'nowrap' }}>{c.sub}</div>}
          </div>
        ))}
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rx)', padding: 14 }}>
        <PlanPanel status={status} devName={(id) => developers.find((d) => d.id === id)?.name ?? 'Unknown'} />
      </div>
    </div>
  )
}
