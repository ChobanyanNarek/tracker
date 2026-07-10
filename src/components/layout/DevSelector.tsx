import { useStore } from '../../store'

interface Props {
  open: boolean
  onToggle: () => void
  compact?: boolean
  fill?: boolean
}

/** Top-bar developer selector — same nav-segment style as ProjectDropdown;
 *  clicking it opens the right-side DevPanel. */
export default function DevSelector({ open, onToggle, compact, fill }: Props) {
  const { selectedDev, developers } = useStore()
  const activeDev = selectedDev === 'ALL' ? null : developers.find((d) => d.id === selectedDev)

  return (
    <div className={`navseg${open ? ' open' : ''}${compact ? ' compact' : ''}`} style={{ minWidth: compact || fill ? 0 : 170, flex: fill ? 1 : undefined }} onClick={onToggle}>
      <div style={{ width: 10, height: 10, borderRadius: '50%', background: activeDev?.color ?? 'var(--text3)', flexShrink: 0 }} />
      {!compact && (
        <span style={{ fontSize: 13, fontWeight: 500, flex: 1, color: open ? 'var(--accent)' : activeDev ? 'var(--text)' : 'var(--text2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {activeDev?.name ?? 'All devs'}
        </span>
      )}
      <span className="navseg-caret">▾</span>
    </div>
  )
}
