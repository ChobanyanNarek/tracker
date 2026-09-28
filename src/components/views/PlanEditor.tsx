import { useMemo } from 'react'
import type { Developer, JiraIssue, PlanLine, Project, ProjectPlan, Task } from '../../types'
import { makeId } from '../../sync-core/util'
import { inScope } from '../../utils/plan'
import DatePicker from '../ui/DatePicker'
import Icon from '../ui/Icon'

/*
 * The document that goes to a partner before development starts, entered as the app will
 * check it: independent lines that add up, each naming either a set of roles or one person.
 */
export default function PlanEditor({ project, developers, tasks, onChange }: {
  project: Project
  developers: Developer[]
  tasks: Task[]
  onChange: (plan: ProjectPlan) => void
}) {
  const plan: ProjectPlan = project.plan ?? { lines: [] }
  const members = developers.filter((d) => !d.archivedAt && project.members.includes(d.id))

  /*
   * Roles come from the team rather than being typed again. The role field is free text, so
   * a line that said "frontend" against a developer who said "Frontend" would silently
   * match nobody.
   */
  const roles = useMemo(() => {
    const seen = new Map<string, string>()
    for (const d of members) {
      const role = d.role.trim()
      if (role && !seen.has(role.toLowerCase())) seen.set(role.toLowerCase(), role)
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b))
  }, [members])

  /*
   * Every issue this project has, once each, with its epic. The scope picker works off
   * what is actually there rather than asking anyone to type keys from memory.
   */
  const { epics, issues } = useMemo(() => {
    const seen = new Map<string, { key: string; name: string; parentKey?: string }>()
    for (const t of tasks) {
      if (t.projectId !== project.id) continue
      for (const j of t.jiras ?? []) {
        const key = (j.issueId ?? j.url?.split('/').pop() ?? '').trim().toUpperCase()
        if (!key || seen.has(key)) continue
        seen.set(key, { key, name: j.name || key, ...(j.parentKey ? { parentKey: j.parentKey.trim().toUpperCase() } : {}) })
      }
    }
    const list = [...seen.values()].sort((a, b) => a.key.localeCompare(b.key))
    return { epics: [...new Set(list.map((i) => i.parentKey).filter((k): k is string => !!k))].sort(), issues: list }
  }, [tasks, project.id])

  const scope = plan.scope ?? {}
  const scoped = (list: keyof typeof scope, key: string) => {
    const current = (scope[list] ?? []) as string[]
    const on = current.some((k) => k.toUpperCase() === key.toUpperCase())
    const next = on ? current.filter((k) => k.toUpperCase() !== key.toUpperCase()) : [...current, key]
    patch({ scope: { ...scope, [list]: next.length ? next : undefined } })
  }
  const isOn = (list: keyof typeof scope, key: string) =>
    ((scope[list] ?? []) as string[]).some((k) => k.toUpperCase() === key.toUpperCase())

  const narrowed = !!(scope.parentKeys?.length || scope.issueKeys?.length || scope.excludeKeys?.length)

  const patch = (next: Partial<ProjectPlan>) => onChange({ ...plan, ...next })
  const setLines = (lines: PlanLine[]) => patch({ lines })
  const updateLine = (id: string, changes: Partial<PlanLine>) =>
    setLines(plan.lines.map((l) => (l.id === id ? { ...l, ...changes } : l)))

  const addLine = () => setLines([...plan.lines, {
    id: makeId('pl_'), label: '', target: { kind: 'roles', roles: [] }, hours: 0,
  }])

  const totalH = plan.lines.reduce((sum, l) => sum + (l.hours || 0), 0)

  const label: React.CSSProperties = {
    fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text3)',
    textTransform: 'uppercase', letterSpacing: '.7px', marginBottom: 5, display: 'block',
  }
  const field: React.CSSProperties = {
    width: '100%', background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 'var(--r)', color: 'var(--text)', fontSize: 12, padding: '6px 9px', outline: 'none',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <span style={label}>Agreed end date</span>
        <DatePicker
          value={plan.targetEnd ?? ''}
          onChange={(d) => patch({ targetEnd: d || undefined })}
          placeholder="Whole project"
        />
        <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 5, lineHeight: 1.5 }}>
          A line without its own date is judged against this one.
        </div>
      </div>

      <div>
        <span style={label}>Agreed on</span>
        <DatePicker
          value={plan.approvedAt ?? ''}
          onChange={(d) => patch({ approvedAt: d || undefined })}
          placeholder="When the document was signed"
        />
        <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 5, lineHeight: 1.5 }}>
          Work due before this date is left out — the document does not cover it.
        </div>
      </div>

      <div style={{ height: 1, background: 'var(--border)' }} />

      {/* ── Which tasks this covers ── */}
      <div>
        <span style={label}>Which tasks this covers</span>
        <div style={{ fontSize: 11, color: narrowed ? 'var(--text2)' : 'var(--text3)', marginBottom: 8, lineHeight: 1.5 }}>
          {narrowed
            ? `${issues.filter((i) => inScope(scope, { issueId: i.key, parentKey: i.parentKey } as JiraIssue)).length} of ${issues.length} issues in this project`
            : `Everything in this project${plan.approvedAt ? ' since the agreed date' : ''} — ${issues.length} issues`}
        </div>

        {epics.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 5 }}>By epic</div>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {epics.map((e) => (
                <button key={e} className={`chip${isOn('parentKeys', e) ? ' active' : ''}`} onClick={() => scoped('parentKeys', e)}>{e}</button>
              ))}
            </div>
          </div>
        )}

        {issues.length > 0 && (
          <details>
            <summary style={{ fontSize: 11, color: 'var(--accent)', cursor: 'pointer', marginBottom: 6 }}>
              Pick individual issues
            </summary>
            <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {issues.map((i) => {
                const picked = isOn('issueKeys', i.key)
                const excluded = isOn('excludeKeys', i.key)
                return (
                  <div key={i.key} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 4px', borderRadius: 4, background: excluded ? 'var(--red-dim)' : picked ? 'var(--accent-dim)' : 'transparent' }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text2)', width: 78, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{i.key}</span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 11, color: excluded ? 'var(--text3)' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: excluded ? 'line-through' : 'none' }}>{i.name}</span>
                    <button className={`chip${picked ? ' active' : ''}`} style={{ fontSize: 9 }} onClick={() => scoped('issueKeys', i.key)}>include</button>
                    <button className={`chip${excluded ? ' active' : ''}`} style={{ fontSize: 9 }} onClick={() => scoped('excludeKeys', i.key)}>exclude</button>
                  </div>
                )
              })}
            </div>
          </details>
        )}

        {narrowed && (
          <button className="btn-soft" style={{ marginTop: 8, fontSize: 11 }} onClick={() => patch({ scope: undefined })}>
            Clear and cover everything
          </button>
        )}
      </div>

      <div style={{ height: 1, background: 'var(--border)' }} />

      <div>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ ...label, marginBottom: 0, flex: 1 }}>Hours</span>
          {totalH > 0 && (
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text2)' }}>
              {totalH}h total
            </span>
          )}
        </div>

        {!plan.lines.length && (
          <div style={{ fontSize: 11, color: 'var(--text3)', fontStyle: 'italic', padding: '4px 0 10px' }}>
            No lines yet. Add one for each block of hours in the document.
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {plan.lines.map((line) => {
            const isPerson = line.target.kind === 'developer'
            return (
              <div key={line.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--rl)', padding: 10, background: 'var(--surface2)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    style={{ ...field, flex: 1 }}
                    value={line.label}
                    onChange={(e) => updateLine(line.id, { label: e.target.value })}
                    placeholder="e.g. Development"
                  />
                  <input
                    style={{ ...field, width: 74, flexShrink: 0, fontFamily: 'var(--mono)' }}
                    type="number"
                    min={0}
                    value={line.hours || ''}
                    onChange={(e) => updateLine(line.id, { hours: Number(e.target.value) || 0 })}
                    placeholder="hours"
                    aria-label={`Hours for ${line.label || 'this line'}`}
                  />
                  <button
                    onClick={() => setLines(plan.lines.filter((l) => l.id !== line.id))}
                    title="Remove this line"
                    aria-label="Remove this line"
                    style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', padding: '0 4px', flexShrink: 0 }}
                  ><Icon name="close" size={13} /></button>
                </div>

                <div style={{ display: 'flex', gap: 6 }}>
                  {(['roles', 'developer'] as const).map((kind) => (
                    <button
                      key={kind}
                      onClick={() => updateLine(line.id, {
                        target: kind === 'roles' ? { kind: 'roles', roles: [] } : { kind: 'developer', devId: members[0]?.id ?? '' },
                      })}
                      className={`chip${(line.target.kind === kind) ? ' active' : ''}`}
                    >{kind === 'roles' ? 'By role' : 'One person'}</button>
                  ))}
                </div>

                {!isPerson && (
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    {roles.length === 0 && (
                      <span style={{ fontSize: 10, color: 'var(--text3)', fontStyle: 'italic' }}>
                        Nobody on this project has a role set yet.
                      </span>
                    )}
                    {roles.map((role) => {
                      const picked = line.target.kind === 'roles' && line.target.roles.some((r) => r.toLowerCase() === role.toLowerCase())
                      return (
                        <button
                          key={role}
                          className={`chip${picked ? ' active' : ''}`}
                          onClick={() => {
                            if (line.target.kind !== 'roles') return
                            const next = picked
                              ? line.target.roles.filter((r) => r.toLowerCase() !== role.toLowerCase())
                              : [...line.target.roles, role]
                            updateLine(line.id, { target: { kind: 'roles', roles: next } })
                          }}
                        >{role}</button>
                      )
                    })}
                  </div>
                )}

                {isPerson && (
                  <select
                    style={field}
                    value={line.target.kind === 'developer' ? line.target.devId : ''}
                    onChange={(e) => updateLine(line.id, { target: { kind: 'developer', devId: e.target.value } })}
                    aria-label="Whose hours this line covers"
                  >
                    {members.map((d) => <option key={d.id} value={d.id}>{d.name}{d.role ? ` — ${d.role}` : ''}</option>)}
                  </select>
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 10, color: 'var(--text3)', flexShrink: 0 }}>Own date</span>
                  <DatePicker
                    value={line.end ?? ''}
                    onChange={(d) => updateLine(line.id, { end: d || undefined })}
                    placeholder="Project's"
                  />
                </div>
              </div>
            )
          })}
        </div>

        <button className="btn-soft" style={{ marginTop: 10, width: '100%', justifyContent: 'center', padding: '8px 0' }} onClick={addLine}>
          + Add line
        </button>
      </div>

      <div style={{ fontSize: 10, color: 'var(--text3)', lineHeight: 1.6 }}>
        Lines are independent and add up. A line naming a person wins over one naming their
        role, so nobody's hours are counted twice.
      </div>
    </div>
  )
}
