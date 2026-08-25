import { useState, useEffect } from 'react'

interface TimePickerProps {
  value: string // "HH:MM"
  onChange: (time: string) => void
  placeholder?: string
  style?: React.CSSProperties
}

// Accepts: "9", "930", "19", "1900", "9:30", "9 30", "09:30" etc.
function normalizeTime(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  const digits = trimmed.replace(/[^0-9]/g, '')
  if (!digits) return null
  let h: number, m: number
  if (digits.length <= 2) {
    h = parseInt(digits, 10); m = 0
  } else if (digits.length === 3) {
    h = parseInt(digits.slice(0, 1), 10); m = parseInt(digits.slice(1), 10)
  } else {
    h = parseInt(digits.slice(0, 2), 10); m = parseInt(digits.slice(2, 4), 10)
  }
  if (isNaN(h) || isNaN(m) || h > 23 || m > 59) return null
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export default function TimePicker({ value, onChange, placeholder = 'hh:mm', style }: TimePickerProps) {
  const [draft, setDraft] = useState(value)
  const [invalid, setInvalid] = useState(false)

  useEffect(() => { setDraft(value); setInvalid(false) }, [value])

  const commit = () => {
    const norm = normalizeTime(draft)
    if (norm === null) {
      setInvalid(true)
      setTimeout(() => { setDraft(value); setInvalid(false) }, 600)
    } else {
      setInvalid(false)
      onChange(norm)
      setDraft(norm)
    }
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block', ...style }}>
      <input
        value={draft}
        placeholder={placeholder}
        onChange={(e) => { setDraft(e.target.value); setInvalid(false) }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur() }
          else if (e.key === 'Escape') { setDraft(value); setInvalid(false); (e.target as HTMLInputElement).blur() }
        }}
        inputMode="numeric"
        style={{
          fontFamily: 'var(--mono)',
          fontSize: 11,
          color: invalid ? 'var(--red)' : value ? 'var(--text)' : 'var(--text3)',
          background: 'var(--surface)',
          border: `1px solid ${invalid ? 'var(--red)' : 'var(--border)'}`,
          borderRadius: 6,
          padding: '3px 8px',
          outline: 'none',
          minWidth: 54,
          width: 54,
          boxSizing: 'border-box',
          transition: 'border-color .15s, color .15s',
        }}
      />
    </div>
  )
}
