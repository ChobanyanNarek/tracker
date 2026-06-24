import { useState, useEffect, useRef } from 'react'
import { useStore } from '../../store'
import { hexRgb, initials } from '../../utils/format'
import { daysInMonth, padDate, isAmHoliday } from '../../utils/dates'
import type { EmploymentPeriod } from '../../types'

const DAY_TYPES: Record<string, { label: string; color: string; bg: string; emoji: string; border: string }> = {
  work:    { label: 'Work',           color: 'var(--green)',  bg: '#dcfce7', emoji: '💼', border: '#86efac' },
  vacation:{ label: 'Vacation',       color: '#7c3aed',       bg: '#ede9fe', emoji: '🏖️', border: '#d8b4fe' },
  dayoff:  { label: 'Day Off',        color: 'var(--amber)',  bg: '#fef9c3', emoji: '☀️', border: '#fde047' },
  sick:    { label: 'Sick Leave',     color: 'var(--red)',    bg: '#fee2e2', emoji: '🤒', border: '#fca5a5' },
  holiday: { label: 'Public Holiday', color: '#0891b2',       bg: '#cffafe', emoji: '🎉', border: '#67e8f9' },
}

function isWeekend(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00')
  return d.getDay() === 0 || d.getDay() === 6
}

function getDevHoursForDate(dev: { periods?: EmploymentPeriod[] }, dateStr: string): number {
  const periods = dev.periods ?? []
  for (const p of periods) {
    const from = p.from || '0000-01-01'
    const to = p.to || '9999-12-31'
    if (dateStr >= from && dateStr <= to) return p.type === 'part' ? (p.hours || 4) : 8
  }
  return 8
}

// dates: sorted 'dd.mm' strings from a single year; returns "01.06 – 15.06, 20.06 – 25.06"
function collapseRanges(dates: string[], year: number): string {
  if (!dates.length) return ''
  // Build full ISO strings using the month embedded in each "dd.mm" entry
  const full = dates.map((d) => `${year}-${d.slice(3)}-${d.slice(0, 2)}`)
  const ranges: string[] = []
  let start = full[0], prev = full[0]
  for (let i = 1; i <= full.length; i++) {
    const cur = full[i]
    const prevD = new Date(prev + 'T12:00:00')
    const nextD = new Date(prevD)
    do { nextD.setDate(nextD.getDate() + 1) } while (nextD.getDay() === 0 || nextD.getDay() === 6)
    const nextStr = nextD.toISOString().split('T')[0]
    if (cur && cur === nextStr) {
      prev = cur
    } else {
      const s = start.slice(8) + '.' + start.slice(5, 7)
      const e = prev.slice(8) + '.' + prev.slice(5, 7)
      ranges.push(s === e ? s : `${s} – ${e}`)
      start = cur; prev = cur
    }
  }
  return ranges.join(', ')
}

// Employment period modal
function EmploymentModal({ dev, onClose, onSave }: {
  dev: { id: string; name: string; periods?: EmploymentPeriod[] }
  onClose: () => void
  onSave: (periods: EmploymentPeriod[]) => void
}) {
  const [periods, setPeriods] = useState<EmploymentPeriod[]>(() => JSON.parse(JSON.stringify(dev.periods ?? [])))

  const addPeriod = () => setPeriods((p) => [...p, { type: 'part', hours: 4, from: '', to: null }])
  const removePeriod = (i: number) => setPeriods((p) => p.filter((_, idx) => idx !== i))
  const updatePeriod = (i: number, field: keyof EmploymentPeriod, val: unknown) =>
    setPeriods((p) => p.map((period, idx) => idx === i ? { ...period, [field]: val } : period))

  const confirm = () => {
    onSave(periods.filter((p) => p.from))
    onClose()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rl)', width: 620, maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '13px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ flex: 1, fontWeight: 700, fontSize: 14 }}>{dev.name} — Employment periods</div>
          <button onClick={onClose} className="icon-btn" style={{ fontSize: 16 }}>✕</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {periods.length === 0 && (
            <div style={{ fontSize: 11, color: 'var(--text3)', fontStyle: 'italic', padding: '6px 0' }}>Full time — no periods set</div>
          )}
          {periods.map((p, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', background: 'var(--surface2)', borderRadius: 'var(--r)', border: '1px solid var(--border)', flexWrap: 'nowrap' }}>
              <select value={p.type} onChange={(e) => updatePeriod(i, 'type', e.target.value)} style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 11, padding: '3px 6px', borderRadius: 5 }}>
                <option value="full">Full time</option>
                <option value="part">Part time</option>
              </select>
              {p.type === 'part' && (
                <select value={p.hours} onChange={(e) => updatePeriod(i, 'hours', Number(e.target.value))} style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 11, padding: '3px 6px', borderRadius: 5 }}>
                  {[2, 3, 4, 5, 6, 7].map((h) => <option key={h} value={h}>{h}h/day</option>)}
                </select>
              )}
              {p.type === 'full' && <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>8h/day</span>}
              <input type="date" value={p.from} onChange={(e) => updatePeriod(i, 'from', e.target.value)} title="From" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 11, padding: '3px 6px', borderRadius: 5, width: 130 }} />
              <span style={{ color: 'var(--text3)', fontSize: 12, flexShrink: 0 }}>→</span>
              <input type="date" value={p.to ?? ''} onChange={(e) => updatePeriod(i, 'to', e.target.value || null)} title="To (leave empty for ongoing)" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 11, padding: '3px 6px', borderRadius: 5, width: 130 }} />
              <button onClick={() => removePeriod(i)} style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', padding: '2px 6px', fontSize: 14 }}>✕</button>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
          <button onClick={addPeriod} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', fontFamily: 'var(--mono)', fontSize: 11, padding: '5px 12px', borderRadius: 6, cursor: 'pointer' }}>＋ Add period</button>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', fontFamily: 'var(--mono)', fontSize: 12, padding: '6px 14px', borderRadius: 7, cursor: 'pointer' }}>Cancel</button>
          <button onClick={confirm} style={{ background: 'var(--accent)', border: '1px solid var(--accent)', color: '#fff', fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600, padding: '6px 16px', borderRadius: 7, cursor: 'pointer' }}>✓ Confirm</button>
        </div>
      </div>
    </div>
  )
}

// Context menu for a cell click
function DayCellMenu({ dateStr, current, amHoliday, onSelect, onRange, onClear, onClose, anchorRect }: {
  devId?: string; dateStr: string; current: string | null; amHoliday: string | null
  onSelect: (type: string) => void; onRange: () => void; onClear: () => void; onClose: () => void
  anchorRect: DOMRect
}) {
  const ref = useRef<HTMLDivElement>(null)
  const d = new Date(dateStr + 'T12:00:00')
  const label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) + (amHoliday ? ' — ' + amHoliday : '')

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    setTimeout(() => document.addEventListener('click', close), 10)
    return () => document.removeEventListener('click', close)
  }, [onClose])

  const top = Math.min(anchorRect.bottom + 4, window.innerHeight - 320)
  const left = Math.min(anchorRect.left, window.innerWidth - 210)

  return (
    <div ref={ref} style={{ position: 'fixed', top, left, zIndex: 9999, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rl)', boxShadow: '0 8px 32px rgba(0,0,0,.25)', minWidth: 200, overflow: 'hidden' }}>
      <div style={{ padding: '7px 12px', fontSize: 11, fontWeight: 600, color: 'var(--text3)', borderBottom: '1px solid var(--border)', fontFamily: 'var(--mono)' }}>{label}</div>
      {(['work', 'dayoff', 'sick', 'holiday'] as const).map((k) => (
        <div key={k} onClick={() => onSelect(k)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', cursor: 'pointer', background: current === k ? 'var(--accent-dim)' : undefined, borderLeft: current === k ? '3px solid var(--accent)' : '3px solid transparent', transition: 'background .1s' }} onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface2)' }} onMouseLeave={(e) => { e.currentTarget.style.background = current === k ? 'var(--accent-dim)' : '' }}>
          <span style={{ fontSize: 14 }}>{DAY_TYPES[k].emoji}</span>
          <span style={{ fontSize: 12, fontWeight: 600 }}>{DAY_TYPES[k].label}</span>
        </div>
      ))}
      <div style={{ height: 1, background: 'var(--border)', margin: '2px 0' }} />
      <div onClick={() => onSelect('vacation')} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', cursor: 'pointer' }} onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface2)' }} onMouseLeave={(e) => { e.currentTarget.style.background = '' }}>
        <span style={{ fontSize: 14 }}>🏖️</span>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600 }}>Vacation</div>
          <div style={{ fontSize: 10, color: 'var(--text3)' }}>Single day</div>
        </div>
      </div>
      <div onClick={onRange} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', cursor: 'pointer' }} onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface2)' }} onMouseLeave={(e) => { e.currentTarget.style.background = '' }}>
        <span style={{ fontSize: 14 }}>🏖️</span>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600 }}>Vacation — range</div>
          <div style={{ fontSize: 10, color: 'var(--accent)' }}>Click start → click end date</div>
        </div>
      </div>
      {current && (
        <>
          <div style={{ height: 1, background: 'var(--border)', margin: '2px 0' }} />
          <div onClick={onClear} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', cursor: 'pointer', color: 'var(--red)' }} onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--red-dim)' }} onMouseLeave={(e) => { e.currentTarget.style.background = '' }}>
            <span>✕</span><span style={{ fontSize: 12, fontWeight: 600 }}>Clear this day</span>
          </div>
        </>
      )}
    </div>
  )
}

// Schedule report modal
function ScheduleReportModal({ year, month, onClose }: { year: number; month: number; onClose: () => void }) {
  const { developers: allDevelopers, schedule } = useStore()
  const developers = allDevelopers.filter((d) => !d.archivedAt)
  const [copied, setCopied] = useState(false)
  const days = daysInMonth(year, month)
  const daysList: string[] = []
  for (let d = 1; d <= days; d++) daysList.push(padDate(year, month, d))

  const totalWorkdays = daysList.filter((d) => !isWeekend(d) && !isAmHoliday(d)).length
  const totalHolidays = daysList.filter((d) => !isWeekend(d) && !!isAmHoliday(d)).length
  const weekends = daysList.filter((d) => isWeekend(d)).length

  const monthName = new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  const devStats = developers.map((dev) => {
    const vacD: string[] = [], dayoffD: string[] = [], sickD: string[] = [], holD: string[] = []
    let worked = 0, totalHours = 0
    daysList.forEach((ds) => {
      if (isWeekend(ds)) return
      const amHol = isAmHoliday(ds)
      const entry = schedule[dev.id]?.[ds]
      const ddmm = ds.slice(8) + '.' + ds.slice(5, 7)
      if (entry === 'vacation') vacD.push(ddmm)
      else if (entry === 'dayoff') dayoffD.push(ddmm)
      else if (entry === 'sick') sickD.push(ddmm)
      else if (entry === 'holiday' || (amHol && !entry)) holD.push(ddmm)
      else { worked++; totalHours += getDevHoursForDate(dev, ds) }
    })

    const periods = dev.periods ?? []
    const monthStart = padDate(year, month, 1)
    const monthEnd = padDate(year, month, days)
    const activePeriods = periods.filter((p) => (p.from || '0000-01-01') <= monthEnd && (p.to || '9999-12-31') >= monthStart)
    const periodDesc = activePeriods.length === 0
      ? 'Full time (8h/day)'
      : activePeriods.map((p) => {
          const typeLabel = p.type === 'part' ? `Part time (${p.hours || 4}h/day)` : 'Full time (8h/day)'
          const fromFmt = p.from ? p.from.slice(8) + '.' + p.from.slice(5, 7) : ''
          const toFmt = p.to ? p.to.slice(8) + '.' + p.to.slice(5, 7) : 'present'
          return typeLabel + (fromFmt ? ` from ${fromFmt} to ${toFmt}` : '')
        }).join(', ')

    return { dev, worked, totalHours, periodDesc, vacation: vacD.length, vacationStr: collapseRanges(vacD, year), dayoff: dayoffD.length, dayoffStr: dayoffD.join(', '), sick: sickD.length, sickStr: sickD.join(', '), holidays: holD.length, holidayStr: holD.join(', ') }
  })

  const lines = [
    `MONTHLY WORKING DAYS REPORT — ${monthName.toUpperCase()}`,
    '═'.repeat(60),
    `Total: ${days} days  |  ${totalWorkdays} workdays  |  ${totalHolidays} public holidays  |  ${weekends} weekends`,
    '',
    ...devStats.flatMap(({ dev, worked, periodDesc, vacation, vacationStr, dayoff, dayoffStr, sick, sickStr, holidays, holidayStr }) => {
      const parts = [`${worked} working days`]
      if (holidays) parts.push(`${holidays} public holiday${holidays !== 1 ? 's' : ''} (${holidayStr})`)
      if (vacation) parts.push(`${vacation} vacation day${vacation !== 1 ? 's' : ''} (${vacationStr})`)
      if (dayoff) parts.push(`${dayoff} day off${dayoff !== 1 ? 's' : ''} (${dayoffStr})`)
      if (sick) parts.push(`${sick} sick day${sick !== 1 ? 's' : ''} (${sickStr})`)
      return [`${dev.name} — ${periodDesc}`, parts.join(' / '), '']
    }),
    '─'.repeat(60),
    `Generated: ${new Date().toLocaleString()}`,
  ]
  const textReport = lines.join('\n')

  const copy = async () => {
    await navigator.clipboard.writeText(textReport)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1050, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rl)', width: '100%', maxWidth: 700, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '13px 18px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>📊 Monthly Report — {monthName}</span>
          <button onClick={onClose} className="icon-btn" style={{ fontSize: 16 }}>✕</button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 18px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <button onClick={copy} style={{ background: copied ? '#dcfce7' : 'var(--surface2)', border: `1px solid ${copied ? '#86efac' : 'var(--border)'}`, color: copied ? 'var(--green)' : 'var(--text2)', fontFamily: 'var(--mono)', fontSize: 12, padding: '5px 14px', borderRadius: 6, cursor: 'pointer' }}>
            {copied ? '✓ Copied!' : '📋 Copy as text'}
          </button>
        </div>
        <pre style={{ flex: 1, overflowY: 'auto', padding: '14px 18px', margin: 0, fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text)', background: 'var(--surface2)', whiteSpace: 'pre', lineHeight: 1.7 }}>{textReport}</pre>
      </div>
    </div>
  )
}

export default function ScheduleView() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const [menu, setMenu] = useState<{ devId: string; dateStr: string; rect: DOMRect } | null>(null)
  const [rangeStart, setRangeStart] = useState<{ devId: string; date: string } | null>(null)
  const [empModal, setEmpModal] = useState<string | null>(null) // devId
  const [report, setReport] = useState(false)

  const developers = useStore((s) => s.developers.filter((d) => !d.archivedAt))
  const schedule = useStore((s) => s.schedule)
  const setScheduleDay = useStore((s) => s.setScheduleDay)
  const updateDeveloperPeriods = useStore((s) => s.updateDeveloperPeriods)

  const days = daysInMonth(year, month)
  const daysList: string[] = []
  for (let d = 1; d <= days; d++) daysList.push(padDate(year, month, d))
  const today = new Date().toISOString().split('T')[0]

  const getEntry = (devId: string, dateStr: string) => schedule[devId]?.[dateStr] ?? null

  const handleCellClick = (clickedDevId: string, dateStr: string, rect: DOMRect) => {
    if (isWeekend(dateStr)) return
    if (rangeStart) {
      if (rangeStart.devId === clickedDevId) {
        // Apply vacation range
        const a = rangeStart.date < dateStr ? rangeStart.date : dateStr
        const b = rangeStart.date < dateStr ? dateStr : rangeStart.date
        const cur = new Date(a + 'T12:00:00')
        const end = new Date(b + 'T12:00:00')
        while (cur <= end) {
          const ds = cur.toISOString().split('T')[0]
          if (!isWeekend(ds)) setScheduleDay(clickedDevId, ds, 'vacation')
          cur.setDate(cur.getDate() + 1)
        }
      }
      setRangeStart(null)
      return
    }
    setMenu({ devId: clickedDevId, dateStr, rect })
  }

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

  const empDev = empModal ? developers.find((d) => d.id === empModal) : null

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: 'var(--surface)', borderBottom: '1px solid var(--border)', flexShrink: 0, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button onClick={() => { if (month === 0) { setYear((y) => y - 1); setMonth(11) } else setMonth((m) => m - 1) }} className="icon-btn">‹</button>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 600, minWidth: 130, textAlign: 'center' }}>{MONTHS[month]} {year}</span>
          <button onClick={() => { if (month === 11) { setYear((y) => y + 1); setMonth(0) } else setMonth((m) => m + 1) }} className="icon-btn">›</button>
          <button onClick={() => { setYear(now.getFullYear()); setMonth(now.getMonth()) }} style={{ fontFamily: 'var(--mono)', fontSize: 10, padding: '4px 10px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text3)', cursor: 'pointer' }}>This month</button>
        </div>

        {rangeStart && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px', background: 'var(--accent-dim)', border: '1px solid var(--accent)', borderRadius: 8, fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--accent)' }}>
            📍 Start: {rangeStart.date} — click end date
            <button onClick={() => setRangeStart(null)} style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 13, padding: 0 }}>✕</button>
          </div>
        )}

        <div style={{ flex: 1 }} />
        <button onClick={() => setReport(true)} style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', fontFamily: 'var(--mono)', fontSize: 11, padding: '5px 12px', borderRadius: 6, cursor: 'pointer' }}>
          📊 Monthly Report
        </button>

        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {Object.entries(DAY_TYPES).map(([k, v]) => (
            <span key={k} style={{ fontFamily: 'var(--mono)', fontSize: 10, padding: '2px 8px', borderRadius: 8, background: v.bg, color: v.color, border: `1px solid ${v.border}` }}>{v.emoji} {v.label}</span>
          ))}
        </div>
      </div>

      {/* grid */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', minWidth: 900, tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: 160 }} />
            {daysList.map((d) => <col key={d} style={{ width: 32 }} />)}
          </colgroup>
          <thead>
            <tr style={{ background: 'var(--surface2)', position: 'sticky', top: 0, zIndex: 2 }}>
              <th style={{ padding: '6px 12px', textAlign: 'left', fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 600, color: 'var(--text3)', borderBottom: '1px solid var(--border)', borderRight: '1px solid var(--border)' }}>Assignee</th>
              {daysList.map((ds) => {
                const d = new Date(ds + 'T12:00:00')
                const dow = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][d.getDay()]
                const isWe = isWeekend(ds)
                const isHol = !!isAmHoliday(ds)
                const isToday = ds === today
                const isRS = rangeStart?.date === ds
                return (
                  <th key={ds} title={isAmHoliday(ds) || ''} style={{
                    padding: '3px 2px', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 9,
                    fontWeight: isToday ? 800 : 600,
                    color: isToday ? 'var(--accent)' : isHol ? '#0891b2' : isWe ? 'var(--text3)' : 'var(--text2)',
                    borderBottom: isToday ? '2px solid var(--accent)' : '1px solid var(--border)',
                    borderRight: '1px solid var(--border)',
                    borderLeft: isToday ? '2px solid var(--accent)' : undefined,
                    background: isRS ? 'var(--accent-dim)' : isToday ? '#dbeafe' : isHol ? '#cffafe' : isWe ? 'var(--surface3)' : undefined,
                    minWidth: 28,
                  }}>
                    <div>{d.getDate()}</div>
                    <div style={{ fontSize: 8, opacity: 0.7 }}>{dow}</div>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {developers.map((dev, di) => {
              const rgb = hexRgb(dev.color)
              let worked = 0
              const counts: Record<string, number> = {}
              daysList.forEach((ds) => {
                if (isWeekend(ds)) return
                const amHol = isAmHoliday(ds)
                const entry = getEntry(dev.id, ds)
                if (entry) counts[entry] = (counts[entry] ?? 0) + 1
                else if (amHol) counts['holiday'] = (counts['holiday'] ?? 0) + 1
                else worked++
              })

              const periods = dev.periods ?? []
              const monthStart = padDate(year, month, 1)
              const monthEnd = padDate(year, month, days)
              const activePeriods = periods.filter((p) => (p.from || '0000-01-01') <= monthEnd && (p.to || '9999-12-31') >= monthStart)
              const empSlash = activePeriods.length === 0 ? '' : activePeriods.map((p) => p.type === 'part' ? `Part (${p.hours || 4}h)` : 'Full').join(' / ')

              return (
                <tr key={dev.id} style={{ background: di % 2 === 0 ? 'var(--surface)' : 'var(--surface2)' }}>
                  <td style={{ padding: '5px 10px', borderBottom: '1px solid var(--border)', borderRight: '1px solid var(--border)', position: 'sticky', left: 0, background: 'inherit', zIndex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
                      <div className="av" style={{ background: `rgba(${rgb},.15)`, color: dev.color, width: 24, height: 24, fontSize: 9, flexShrink: 0 }}>{initials(dev.name)}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 90 }}>{dev.name}</span>
                          <button onClick={() => setEmpModal(dev.id)} title="Edit employment periods" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 11, padding: '0 2px', flexShrink: 0 }}>✎</button>
                        </div>
                        {empSlash && <div style={{ fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--accent)', marginBottom: 2 }}>{empSlash}</div>}
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {worked > 0 && <span title="Worked" style={{ fontSize: 9, color: 'var(--green)', fontFamily: 'var(--mono)' }}>💼{worked}d</span>}
                          {(counts['vacation'] ?? 0) > 0 && <span title="Vacation" style={{ fontSize: 9, color: '#7c3aed', fontFamily: 'var(--mono)' }}>🏖️{counts['vacation']}</span>}
                          {(counts['dayoff'] ?? 0) > 0 && <span title="Day off" style={{ fontSize: 9, color: 'var(--amber)', fontFamily: 'var(--mono)' }}>☀️{counts['dayoff']}</span>}
                          {(counts['sick'] ?? 0) > 0 && <span title="Sick" style={{ fontSize: 9, color: 'var(--red)', fontFamily: 'var(--mono)' }}>🤒{counts['sick']}</span>}
                          {(counts['holiday'] ?? 0) > 0 && <span title="Holidays" style={{ fontSize: 9, color: '#0891b2', fontFamily: 'var(--mono)' }}>🎉{counts['holiday']}</span>}
                        </div>
                      </div>
                    </div>
                  </td>
                  {daysList.map((ds) => {
                    const isWe = isWeekend(ds)
                    const amHol = isAmHoliday(ds)
                    const entry = getEntry(dev.id, ds)
                    const effective = entry ?? (amHol ? 'holiday' : null)
                    const dt = effective ? DAY_TYPES[effective] : null
                    const isRS = rangeStart?.devId === dev.id && rangeStart.date === ds
                    const isTodayCol = ds === today
                    const hours = getDevHoursForDate(dev, ds)
                    const isPartial = !effective && !isWe && hours !== 8

                    const cellBg = isRS ? '#bfdbfe'
                      : dt ? dt.bg
                      : isWe ? 'var(--surface3)'
                      : amHol ? '#cffafe'
                      : (isPartial && !isWe) ? '#eff6ff'
                      : isTodayCol ? 'rgba(37,99,235,0.05)'
                      : undefined

                    return (
                      <td
                        key={ds}
                        onClick={(e) => {
                          if (isWe) return
                          e.stopPropagation()
                          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                          handleCellClick(dev.id, ds, rect)
                        }}
                        title={amHol || dt?.label || (isPartial && !isWe ? `${hours}h / part-time` : 'Full day')}
                        style={{
                          padding: 2, borderBottom: '1px solid var(--border)', borderRight: '1px solid var(--border)', textAlign: 'center',
                          borderLeft: isTodayCol ? '2px solid var(--accent)' : undefined,
                          cursor: isWe ? 'default' : 'pointer',
                          background: cellBg,
                          transition: 'filter .1s',
                          height: 30,
                          verticalAlign: 'middle',
                        }}
                        onMouseEnter={(e) => { if (!isWe) e.currentTarget.style.filter = 'brightness(0.93)' }}
                        onMouseLeave={(e) => { e.currentTarget.style.filter = '' }}
                      >
                        {dt && (
                          <div style={{ width: 22, height: 22, borderRadius: 4, background: dt.bg, border: `1px solid ${dt.border}`, margin: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>
                            {dt.emoji}
                          </div>
                        )}
                        {!dt && amHol && <div style={{ fontSize: 11 }}>🎉</div>}
                        {!dt && !amHol && isPartial && !isWe && (
                          <div style={{
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            background: 'var(--accent)', color: '#fff',
                            borderRadius: 3, padding: '1px 3px',
                            fontSize: 9, fontFamily: 'var(--mono)', fontWeight: 700, lineHeight: 1.4,
                            minWidth: 18,
                          }}>{hours}h</div>
                        )}
                        {!dt && !amHol && !isPartial && isWe && <div style={{ width: 4, height: 4, borderRadius: 2, background: 'var(--border2)', margin: 'auto' }} />}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* cell context menu */}
      {menu && (
        <DayCellMenu
          devId={menu.devId}
          dateStr={menu.dateStr}
          current={getEntry(menu.devId, menu.dateStr)}
          amHoliday={isAmHoliday(menu.dateStr)}
          anchorRect={menu.rect}
          onSelect={(type) => { setScheduleDay(menu.devId, menu.dateStr, type); setMenu(null) }}
          onRange={() => { setRangeStart({ devId: menu.devId, date: menu.dateStr }); setMenu(null) }}
          onClear={() => { setScheduleDay(menu.devId, menu.dateStr, null); setMenu(null) }}
          onClose={() => setMenu(null)}
        />
      )}

      {/* employment modal */}
      {empDev && (
        <EmploymentModal
          dev={empDev}
          onClose={() => setEmpModal(null)}
          onSave={(periods) => updateDeveloperPeriods(empDev.id, periods)}
        />
      )}

      {/* report modal */}
      {report && <ScheduleReportModal year={year} month={month} onClose={() => setReport(false)} />}
    </div>
  )
}
