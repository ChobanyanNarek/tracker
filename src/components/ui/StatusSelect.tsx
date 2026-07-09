import type { Status } from '../../types'
import { STATUS_LABEL } from '../../constants'

const INLINE: Record<Status, React.CSSProperties> = {
  todo:       { background: 'var(--surface3)', borderColor: 'var(--border2)', color: 'var(--text3)' },
  inprogress: { background: 'var(--amber-dim)', borderColor: 'var(--amber)', color: 'var(--amber)' },
  review:     { background: 'var(--purple-dim)', borderColor: 'var(--purple)', color: 'var(--purple)' },
  done:       { background: 'var(--green-dim)', borderColor: 'var(--green)', color: 'var(--green)' },
  blocked:    { background: 'var(--red-dim)', borderColor: 'var(--red)', color: 'var(--red)' },
}

interface Props {
  value: Status
  onChange: (v: Status) => void
  style?: React.CSSProperties
}

export default function StatusSelect({ value, onChange, style }: Props) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as Status)}
      style={{
        border: '1.5px solid',
        borderRadius: 20,
        fontFamily: 'var(--mono)',
        fontSize: 11,
        fontWeight: 600,
        padding: '4px 24px 4px 10px',
        outline: 'none',
        cursor: 'pointer',
        appearance: 'none',
        WebkitAppearance: 'none',
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' fill='none'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%239aa0b8' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E")`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 8px center',
        transition: 'all .15s',
        ...INLINE[value],
        ...style,
      }}
    >
      {(['todo', 'inprogress', 'review', 'done', 'blocked'] as Status[]).map((s) => (
        <option key={s} value={s} style={{ background: 'var(--surface)', color: 'var(--text)', fontWeight: 500 }}>
          {STATUS_LABEL[s]}
        </option>
      ))}
    </select>
  )
}
