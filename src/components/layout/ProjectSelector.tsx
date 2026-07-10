import { useStore } from '../../store'

interface Props {
  open: boolean
  onToggle: () => void
  compact?: boolean
  fill?: boolean
}

/** Top-bar project selector — same nav-segment style as DevSelector;
 *  clicking it opens the right-side ProjectPanel. */
export default function ProjectSelector({ open, onToggle, compact, fill }: Props) {
  const { projects, selectedProject } = useStore()
  const activeProj = selectedProject === 'ALL' ? null : projects.find((p) => p.id === selectedProject)

  return (
    <div className={`navseg${open ? ' open' : ''}${compact ? ' compact' : ''}`} style={{ minWidth: compact || fill ? 0 : 190, flex: fill ? 1 : undefined }} onClick={onToggle}>
      <div style={{ width: 10, height: 10, borderRadius: 3, background: activeProj?.color ?? 'var(--text3)', flexShrink: 0 }} />
      {!compact && (
        <span style={{ fontSize: 13, fontWeight: 500, flex: 1, color: open ? 'var(--accent)' : activeProj ? 'var(--text)' : 'var(--text2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {activeProj?.name ?? 'All projects'}
        </span>
      )}
      <span className="navseg-caret">▾</span>
    </div>
  )
}
