import Icon from './Icon'

interface Props {
  page: number
  totalPages: number
  onChange: (page: number) => void
}

// Compact "‹ 1 2 … 12 ›" control. Always shows first/last page, the current
// page's immediate neighbors, and collapses the rest behind an ellipsis so it
// stays a fixed, small width regardless of how many pages there are.
function pageNumbers(page: number, totalPages: number): (number | '…')[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
  const out: (number | '…')[] = [1]
  if (page > 3) out.push('…')
  for (let p = Math.max(2, page - 1); p <= Math.min(totalPages - 1, page + 1); p++) out.push(p)
  if (page < totalPages - 2) out.push('…')
  out.push(totalPages)
  return out
}

export default function Pagination({ page, totalPages, onChange }: Props) {
  if (totalPages <= 1) return null

  const btn = (active: boolean): React.CSSProperties => ({
    minWidth: 26, height: 26, padding: '0 6px', borderRadius: 7,
    fontFamily: 'var(--mono)', fontSize: 11, fontWeight: active ? 700 : 400,
    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
    background: active ? 'var(--accent-dim)' : 'var(--surface)',
    color: active ? 'var(--accent)' : 'var(--text3)',
    cursor: active ? 'default' : 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  })

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '10px 0' }}>
      <button
        onClick={() => page > 1 && onChange(page - 1)}
        disabled={page === 1}
        style={{ ...btn(false), opacity: page === 1 ? 0.4 : 1, cursor: page === 1 ? 'default' : 'pointer' }}
        title="Previous page"
      >
        <Icon name="chevron-left" size={12} />
      </button>

      {pageNumbers(page, totalPages).map((p, i) =>
        p === '…' ? (
          <span key={`e${i}`} style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text4)', padding: '0 2px' }}>…</span>
        ) : (
          <button key={p} onClick={() => onChange(p)} style={btn(p === page)}>{p}</button>
        )
      )}

      <button
        onClick={() => page < totalPages && onChange(page + 1)}
        disabled={page === totalPages}
        style={{ ...btn(false), opacity: page === totalPages ? 0.4 : 1, cursor: page === totalPages ? 'default' : 'pointer' }}
        title="Next page"
      >
        <Icon name="chevron-right" size={12} />
      </button>
    </div>
  )
}
