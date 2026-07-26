import { useState, useEffect, useLayoutEffect, useRef } from 'react'

interface DatePickerProps {
  value: string
  onChange: (date: string) => void
  placeholder?: string
  style?: React.CSSProperties
  minDate?: string  // YYYY-MM-DD — dates before this are disabled
  maxDate?: string  // YYYY-MM-DD — dates after this are disabled
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DAY_HEADERS = ['Mo','Tu','We','Th','Fr','Sa','Su']

function formatDisplay(iso: string): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d} ${MONTHS[parseInt(m) - 1].slice(0, 3)} ${y}`
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

export default function DatePicker({ value, onChange, placeholder = 'Select date', style, minDate, maxDate }: DatePickerProps) {
  const today = new Date().toISOString().slice(0, 10)
  const [open, setOpen] = useState(false)

  const initFromValue = () => {
    if (value) {
      const d = new Date(value + 'T12:00:00')
      return { year: d.getFullYear(), month: d.getMonth() }
    }
    const d = new Date()
    return { year: d.getFullYear(), month: d.getMonth() }
  }
  const [nav, setNav] = useState(initFromValue)

  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({})

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    setTimeout(() => document.addEventListener('mousedown', handler), 10)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const popupW = 264
    const popupH = 300
    const goUp = window.innerHeight - rect.bottom < popupH
    const goLeft = rect.left + popupW > window.innerWidth - 8

    const top = goUp ? rect.top - popupH - 4 : rect.bottom + 4
    const left = goLeft
      ? Math.max(8, rect.right - popupW)
      : Math.min(rect.left, window.innerWidth - popupW - 8)

    setPopupStyle({ position: 'fixed', top, left, zIndex: 9999 })
  }, [open])

  // When value changes externally, sync nav
  useEffect(() => {
    if (value) {
      const d = new Date(value + 'T12:00:00')
      setNav({ year: d.getFullYear(), month: d.getMonth() })
    }
  }, [value])

  const prevMonth = () => {
    setNav((n) => n.month === 0 ? { year: n.year - 1, month: 11 } : { ...n, month: n.month - 1 })
  }
  const nextMonth = () => {
    setNav((n) => n.month === 11 ? { year: n.year + 1, month: 0 } : { ...n, month: n.month + 1 })
  }

  const firstDow = new Date(nav.year, nav.month, 1).getDay() // 0=Sun
  const startPad = (firstDow + 6) % 7 // Mon=0
  const totalDays = daysInMonth(nav.year, nav.month)

  const isDisabled = (day: number): boolean => {
    const mm = String(nav.month + 1).padStart(2, '0')
    const dd = String(day).padStart(2, '0')
    const iso = `${nav.year}-${mm}-${dd}`
    if (minDate && iso < minDate) return true
    if (maxDate && iso > maxDate) return true
    return false
  }

  const selectDay = (day: number) => {
    if (isDisabled(day)) return
    const mm = String(nav.month + 1).padStart(2, '0')
    const dd = String(day).padStart(2, '0')
    onChange(`${nav.year}-${mm}-${dd}`)
    setOpen(false)
  }

  const cells: (number | null)[] = [
    ...Array(startPad).fill(null),
    ...Array.from({ length: totalDays }, (_, i) => i + 1),
  ]
  // Pad to full weeks
  while (cells.length % 7 !== 0) cells.push(null)

  const padDate = (day: number) => {
    const mm = String(nav.month + 1).padStart(2, '0')
    const dd = String(day).padStart(2, '0')
    return `${nav.year}-${mm}-${dd}`
  }

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block', ...style }}>
      <button
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
        style={{
          fontFamily: 'var(--mono)',
          fontSize: 11,
          color: value ? 'var(--text)' : 'var(--text3)',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: '3px 28px 3px 8px',
          cursor: 'pointer',
          outline: 'none',
          position: 'relative',
          whiteSpace: 'nowrap',
          minWidth: 110,
          textAlign: 'left',
        }}
      >
        {value ? formatDisplay(value) : placeholder}
        {/* calendar icon */}
        <svg
          width="13" height="13" viewBox="0 0 16 16" fill="none"
          style={{ position: 'absolute', right: 7, top: '50%', transform: 'translateY(-50%)', opacity: 0.5, pointerEvents: 'none' }}
        >
          <rect x="1" y="3" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M1 7h14" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M5 1v4M11 1v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>

      {open && (
        <div style={{
          ...popupStyle,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          boxShadow: 'var(--shadow)',
          width: 264,
          padding: '10px 12px 12px',
          userSelect: 'none',
        }}>
          {/* Month/year nav */}
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
            <button
              onClick={prevMonth}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text2)', padding: '2px 6px', borderRadius: 5, lineHeight: 1, display: 'flex', alignItems: 'center' }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 11L5 7l4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            <span style={{ flex: 1, textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
              {MONTHS[nav.month]} {nav.year}
            </span>
            <button
              onClick={nextMonth}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text2)', padding: '2px 6px', borderRadius: 5, lineHeight: 1, display: 'flex', alignItems: 'center' }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          </div>

          {/* Day headers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 4 }}>
            {DAY_HEADERS.map((d, i) => (
              <div key={d} style={{
                textAlign: 'center',
                fontFamily: 'var(--mono)',
                fontSize: 9,
                fontWeight: 700,
                color: i >= 5 ? 'var(--text3)' : 'var(--text3)',
                padding: '2px 0',
                opacity: i >= 5 ? 0.6 : 1,
              }}>{d}</div>
            ))}
          </div>

          {/* Day cells */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
            {cells.map((day, i) => {
              if (day === null) return <div key={`empty-${i}`} />
              const iso = padDate(day)
              const isSelected = iso === value
              const isToday = iso === today
              const isWeekend = (i % 7) >= 5
              return (
                <DayCell
                  key={iso}
                  day={day}
                  isSelected={isSelected}
                  isToday={isToday}
                  isWeekend={isWeekend}
                  isDisabled={isDisabled(day)}
                  onClick={() => selectDay(day)}
                />
              )
            })}
          </div>

          {/* Clear button if value set */}
          {value && (
            <div style={{ marginTop: 8, textAlign: 'center' }}>
              <button
                onClick={() => { onChange(''); setOpen(false) }}
                style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
              >
                Clear
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function DayCell({ day, isSelected, isToday, isWeekend, isDisabled, onClick }: {
  day: number
  isSelected: boolean
  isToday: boolean
  isWeekend: boolean
  isDisabled: boolean
  onClick: () => void
}) {
  const [hovered, setHovered] = useState(false)

  const bg = isSelected
    ? 'var(--accent)'
    : hovered && !isDisabled
    ? 'var(--surface2)'
    : 'transparent'

  const color = isDisabled
    ? 'var(--text3)'
    : isSelected
    ? '#fff'
    : isWeekend
    ? 'var(--text3)'
    : 'var(--text)'

  const border = isToday && !isSelected
    ? '1.5px solid var(--accent)'
    : '1.5px solid transparent'

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: '100%',
        aspectRatio: '1',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 6,
        fontFamily: 'var(--mono)',
        fontSize: 11,
        fontWeight: isSelected || isToday ? 700 : 400,
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        background: bg,
        color,
        border,
        transition: 'background .1s, color .1s',
        opacity: isDisabled ? 0.3 : isWeekend && !isSelected ? 0.65 : 1,
        textDecoration: isDisabled ? 'line-through' : 'none',
      }}
    >
      {day}
    </div>
  )
}
