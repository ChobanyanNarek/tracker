import { useState, useEffect, useLayoutEffect, useRef } from 'react'

interface TimePickerProps {
  value: string // "HH:MM"
  onChange: (time: string) => void
  placeholder?: string
  style?: React.CSSProperties
}

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'))

function formatDisplay(val: string): string {
  if (!val) return ''
  return val
}

export default function TimePicker({ value, onChange, placeholder = '--:--', style }: TimePickerProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({})
  const hourRef = useRef<HTMLDivElement>(null)
  const minRef = useRef<HTMLDivElement>(null)

  const [selHour, selMin] = value ? value.split(':') : ['', '']

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
    const popupW = 148
    const popupH = 220
    const goUp = window.innerHeight - rect.bottom < popupH
    const goLeft = rect.left + popupW > window.innerWidth - 8
    const top = goUp ? rect.top - popupH - 4 : rect.bottom + 4
    const left = goLeft
      ? Math.max(8, rect.right - popupW)
      : Math.min(rect.left, window.innerWidth - popupW - 8)
    setPopupStyle({ position: 'fixed', top, left, zIndex: 9999 })
    // Scroll selected into view
    setTimeout(() => {
      if (hourRef.current) {
        const active = hourRef.current.querySelector('[data-active="true"]') as HTMLElement | null
        if (active) hourRef.current.scrollTop = active.offsetTop - 40
      }
      if (minRef.current) {
        const active = minRef.current.querySelector('[data-active="true"]') as HTMLElement | null
        if (active) minRef.current.scrollTop = active.offsetTop - 40
      }
    }, 0)
  }, [open])

  const select = (h: string, m: string) => {
    onChange(`${h}:${m}`)
  }

  const colStyle: React.CSSProperties = {
    overflowY: 'auto',
    height: 180,
    flex: 1,
    scrollbarWidth: 'none',
  }

  const itemStyle = (active: boolean): React.CSSProperties => ({
    padding: '7px 0',
    textAlign: 'center',
    fontFamily: 'var(--mono)',
    fontSize: 13,
    fontWeight: active ? 700 : 400,
    color: active ? '#fff' : 'var(--text2)',
    background: active ? 'var(--accent)' : 'transparent',
    borderRadius: 7,
    cursor: 'pointer',
    transition: 'background .1s, color .1s',
    margin: '1px 4px',
  })

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
          minWidth: 72,
          textAlign: 'left',
        }}
      >
        {value ? formatDisplay(value) : placeholder}
        <svg
          width="12" height="12" viewBox="0 0 16 16" fill="none"
          style={{ position: 'absolute', right: 7, top: '50%', transform: 'translateY(-50%)', opacity: 0.5, pointerEvents: 'none' }}
        >
          <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M8 5v3.5l2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open && (
        <div style={{
          ...popupStyle,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          boxShadow: 'var(--shadow)',
          width: 148,
          padding: '8px 0',
          userSelect: 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: 0,
        }}>
          {/* header */}
          <div style={{ display: 'flex', fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.6px', padding: '0 8px 6px', borderBottom: '1px solid var(--border)', gap: 0 }}>
            <div style={{ flex: 1, textAlign: 'center' }}>Hour</div>
            <div style={{ flex: 1, textAlign: 'center' }}>Min</div>
          </div>

          <div style={{ display: 'flex', flex: 1, gap: 0 }}>
            {/* Hours column */}
            <div ref={hourRef} style={{ ...colStyle, borderRight: '1px solid var(--border)' }}>
              {HOURS.map((h) => (
                <div
                  key={h}
                  data-active={h === selHour}
                  onClick={() => select(h, selMin || '00')}
                  style={itemStyle(h === selHour)}
                >
                  {h}
                </div>
              ))}
            </div>

            {/* Minutes column */}
            <div ref={minRef} style={colStyle}>
              {MINUTES.map((m) => (
                <div
                  key={m}
                  data-active={m === selMin}
                  onClick={() => select(selHour || '00', m)}
                  style={itemStyle(m === selMin)}
                >
                  {m}
                </div>
              ))}
            </div>
          </div>

          {/* clear */}
          {value && (
            <div style={{ borderTop: '1px solid var(--border)', padding: '6px 0 2px', textAlign: 'center' }}>
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
