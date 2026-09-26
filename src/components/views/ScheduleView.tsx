import { useState, useEffect, useRef } from 'react'
import { useStore, joinedByDate } from '../../store'
import { hexRgb, initials } from '../../utils/format'
import { daysInMonth, padDate, isAmHoliday, formatDate, todayStr, isoDate } from '../../utils/dates'
import Icon, { type IconName } from '../ui/Icon'
import type { EmploymentPeriod, ScheduleType } from '../../types'

const DAY_TYPES: Record<string, { label: string; color: string; bg: string; icon: IconName; border: string }> = {
  work:    { label: 'Work',           color: 'var(--green)',  bg: 'var(--green-dim)',  icon: 'briefcase',    border: 'var(--green-border)' },
  vacation:{ label: 'Vacation',       color: 'var(--teal)',   bg: 'var(--teal-dim)',   icon: 'palm',         border: 'var(--teal-border)' },
  dayoff:  { label: 'Day Off',        color: 'var(--amber)',  bg: 'var(--amber-dim)',  icon: 'sun',          border: 'var(--amber-border)' },
  sick:    { label: 'Sick Leave',     color: 'var(--red)',    bg: 'var(--red-dim)',    icon: 'thermometer',  border: 'var(--red-border)' },
  holiday: { label: 'Public Holiday', color: 'var(--pink)',   bg: 'var(--pink-dim)',   icon: 'flag',         border: 'var(--pink-border)' },
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
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rl)', width: 620, maxWidth: '100%', maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '13px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ flex: 1, fontWeight: 700, fontSize: 14 }}>{dev.name} — Employment periods</div>
          <button onClick={onClose} aria-label="Close" className="icon-btn" style={{ fontSize: 16 }}>✕</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {periods.length === 0 && (
            <div style={{ fontSize: 11, color: 'var(--text3)', fontStyle: 'italic', padding: '6px 0' }}>Full time — no periods set</div>
          )}
          {periods.map((p, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', background: 'var(--surface2)', borderRadius: 'var(--r)', border: '1px solid var(--border)', flexWrap: 'wrap' }}>
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
              <input type="date" value={p.from} onChange={(e) => updatePeriod(i, 'from', e.target.value)} title="From" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 11, padding: '3px 6px', borderRadius: 5, width: 130, maxWidth: '100%' }} />
              <span style={{ color: 'var(--text3)', fontSize: 12, flexShrink: 0 }}>→</span>
              <input type="date" value={p.to ?? ''} onChange={(e) => updatePeriod(i, 'to', e.target.value || null)} title="To (leave empty for ongoing)" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 11, padding: '3px 6px', borderRadius: 5, width: 130, maxWidth: '100%' }} />
              <button onClick={() => removePeriod(i)} aria-label="Remove this period" title="Remove this period" style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', padding: '2px 6px', fontSize: 14 }}>✕</button>
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
  onSelect: (type: ScheduleType) => void; onRange: () => void; onClear: () => void; onClose: () => void
  anchorRect: DOMRect
}) {
  const ref = useRef<HTMLDivElement>(null)
  const label = formatDate(dateStr) + (amHoliday ? ' — ' + amHoliday : '')

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    setTimeout(() => document.addEventListener('click', close), 10)
    return () => document.removeEventListener('click', close)
  }, [onClose])

  /*
   * Opened with Enter from a grid cell, the menu sits after the table in the DOM, so Tab
   * walked the rest of the rows before reaching it. Move focus in, keep Tab inside, and
   * let Escape back out -- ScheduleView puts focus back on the cell.
   */
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button')?.focus()
  }, [])

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return }
    if (e.key !== 'Tab' || !ref.current) return
    const items = [...ref.current.querySelectorAll<HTMLElement>('button')]
    if (!items.length) return
    const first = items[0]!
    const last = items[items.length - 1]!
    if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
  }

  // The rows were divs with onClick, so the menu could be opened but not used from a
  // keyboard. They are buttons now; this undoes the UA chrome they come with.
  const row: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', cursor: 'pointer',
    width: '100%', background: 'none', border: 0, font: 'inherit', color: 'inherit', textAlign: 'left',
  }

  const top = Math.min(anchorRect.bottom + 4, window.innerHeight - 320)
  const left = Math.min(anchorRect.left, window.innerWidth - 210)

  return (
    <div ref={ref} role="menu" aria-label={label} onKeyDown={onKeyDown} style={{ position: 'fixed', top, left, zIndex: 9999, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rl)', boxShadow: '0 8px 32px rgba(0,0,0,.25)', minWidth: 200, overflow: 'hidden' }}>
      <div style={{ padding: '7px 12px', fontSize: 11, fontWeight: 600, color: 'var(--text3)', borderBottom: '1px solid var(--border)', fontFamily: 'var(--mono)' }}>{label}</div>
      {(['work', 'dayoff', 'sick', 'holiday'] as const).map((k) => (
        <button type="button" key={k} onClick={() => onSelect(k)} aria-pressed={current === k} style={{ ...row, background: current === k ? 'var(--accent-dim)' : 'none', borderLeft: current === k ? '3px solid var(--accent)' : '3px solid transparent', transition: 'background .1s' }} onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface2)' }} onMouseLeave={(e) => { e.currentTarget.style.background = current === k ? 'var(--accent-dim)' : '' }}>
          <Icon name={DAY_TYPES[k].icon} size={14} color={DAY_TYPES[k].color} />
          <span style={{ fontSize: 12, fontWeight: 600 }}>{DAY_TYPES[k].label}</span>
        </button>
      ))}
      <div style={{ height: 1, background: 'var(--border)', margin: '2px 0' }} />
      <button type="button" onClick={() => onSelect('vacation')} style={row} onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface2)' }} onMouseLeave={(e) => { e.currentTarget.style.background = '' }}>
        <Icon name="palm" size={14} color="var(--teal)" />
        <div>
          <div style={{ fontSize: 12, fontWeight: 600 }}>Vacation</div>
          <div style={{ fontSize: 10, color: 'var(--text3)' }}>Single day</div>
        </div>
      </button>
      <button type="button" onClick={onRange} style={row} onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface2)' }} onMouseLeave={(e) => { e.currentTarget.style.background = '' }}>
        <Icon name="palm" size={14} color="var(--teal)" />
        <div>
          <div style={{ fontSize: 12, fontWeight: 600 }}>Vacation — range</div>
          <div style={{ fontSize: 10, color: 'var(--accent)' }}>Click start → click end date</div>
        </div>
      </button>
      {current && (
        <>
          <div style={{ height: 1, background: 'var(--border)', margin: '2px 0' }} />
          <button type="button" onClick={onClear} style={{ ...row, color: 'var(--red)' }} onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--red-dim)' }} onMouseLeave={(e) => { e.currentTarget.style.background = '' }}>
            <span>✕</span><span style={{ fontSize: 12, fontWeight: 600 }}>Clear this day</span>
          </button>
        </>
      )}
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
  /*
   * One tab stop for the whole grid. A month of cells per developer would otherwise be
   * hundreds of stops between the toolbar and whatever follows the table, so the grid
   * takes a single stop and the arrow keys move within it, as a grid is meant to work.
   */
  const [cursor, setCursor] = useState<{ row: number; col: number }>({ row: 0, col: 0 })
  const gridRef = useRef<HTMLTableElement>(null)
  const movedByKey = useRef(false)

  const allDevelopers = useStore((s) => s.developers.filter((d) => !d.archivedAt))
  const selectedProject = useStore((s) => s.selectedProject)
  const projects = useStore((s) => s.projects)
  const proj = selectedProject !== 'ALL' ? projects.find((p) => p.id === selectedProject) : null
  const developers = proj ? allDevelopers.filter((d) => proj.members.includes(d.id)) : allDevelopers
  const schedule = useStore((s) => s.schedule)
  const setScheduleDay = useStore((s) => s.setScheduleDay)
  const updateDeveloperPeriods = useStore((s) => s.updateDeveloperPeriods)

  const days = daysInMonth(year, month)
  const daysList: string[] = []
  for (let d = 1; d <= days; d++) daysList.push(padDate(year, month, d))
  const today = todayStr()  // the user's calendar day, not UTC's

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
          const ds = isoDate(cur)
          // Public holidays are not leave; charging them cost people days off the balance.
          if (!isWeekend(ds) && !isAmHoliday(ds)) setScheduleDay(clickedDevId, ds, 'vacation')
          cur.setDate(cur.getDate() + 1)
        }
      }
      setRangeStart(null)
      return
    }
    setMenu({ devId: clickedDevId, dateStr, rect })
  }

  // Keep the tab stop on a cell that still exists when the month or the team changes.
  const clamped = {
    row: Math.min(cursor.row, Math.max(developers.length - 1, 0)),
    col: Math.min(cursor.col, Math.max(daysList.length - 1, 0)),
  }

  useEffect(() => {
    if (!movedByKey.current) return
    movedByKey.current = false
    gridRef.current?.querySelector<HTMLElement>(`[data-cell="${clamped.row}-${clamped.col}"]`)?.focus()
  }, [clamped.row, clamped.col])

  const moveCursor = (dRow: number, dCol: number) => {
    movedByKey.current = true
    setCursor((c) => ({
      row: Math.max(0, Math.min(developers.length - 1, Math.min(c.row, developers.length - 1) + dRow)),
      col: Math.max(0, Math.min(daysList.length - 1, Math.min(c.col, daysList.length - 1) + dCol)),
    }))
  }

  // Closing the menu hands focus back to the cell it came from, so a keyboard user does
  // not land back at the top of the page.
  const closeMenu = () => {
    const open = menu
    setMenu(null)
    if (!open) return
    const row = developers.findIndex((d) => d.id === open.devId)
    const col = daysList.indexOf(open.dateStr)
    if (row < 0 || col < 0) return
    requestAnimationFrame(() => {
      gridRef.current?.querySelector<HTMLElement>(`[data-cell="${row}-${col}"]`)?.focus()
    })
  }

  const onCellKeyDown = (e: React.KeyboardEvent<HTMLTableCellElement>, editable: boolean) => {
    switch (e.key) {
      case 'ArrowLeft': e.preventDefault(); moveCursor(0, -1); return
      case 'ArrowRight': e.preventDefault(); moveCursor(0, 1); return
      case 'ArrowUp': e.preventDefault(); moveCursor(-1, 0); return
      case 'ArrowDown': e.preventDefault(); moveCursor(1, 0); return
      case 'Home': e.preventDefault(); movedByKey.current = true; setCursor((c) => ({ ...c, col: 0 })); return
      case 'End': e.preventDefault(); movedByKey.current = true; setCursor((c) => ({ ...c, col: daysList.length - 1 })); return
      case 'Enter':
      case ' ':
        if (!editable) return
        e.preventDefault()
        handleCellClick(developers[clamped.row]!.id, daysList[clamped.col]!, e.currentTarget.getBoundingClientRect())
    }
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
          <button onClick={() => { const n = new Date(); setYear(n.getFullYear()); setMonth(n.getMonth()) }} style={{ fontFamily: 'var(--mono)', fontSize: 10, padding: '4px 10px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text3)', cursor: 'pointer' }}>This month</button>
        </div>

        {rangeStart && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px', background: 'var(--accent-dim)', border: '1px solid var(--accent)', borderRadius: 8, fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--accent)' }}>
            📍 Start: {rangeStart.date} — click end date
            <button onClick={() => setRangeStart(null)} style={{ display: 'inline-flex', background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', padding: 0 }}><Icon name="close" size={13} /></button>
          </div>
        )}

        <div style={{ flex: 1 }} />

        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {Object.entries(DAY_TYPES).map(([k, v]) => (
            <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: 'var(--mono)', fontSize: 10, padding: '2px 8px', borderRadius: 8, background: v.bg, color: v.color, border: `1px solid ${v.border}` }}><Icon name={v.icon} size={11} color={v.color} /> {v.label}</span>
          ))}
        </div>
      </div>

      {/* grid */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <table ref={gridRef} role="grid" aria-label="Team schedule" style={{ borderCollapse: 'collapse', width: '100%', minWidth: 900 }}>
          <colgroup>
            <col style={{ width: 160 }} />
            {daysList.map((d) => <col key={d} />)}
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
                    color: isToday ? 'var(--accent)' : isHol ? 'var(--teal)' : isWe ? 'var(--text3)' : 'var(--text2)',
                    borderBottom: isToday ? '2px solid var(--accent)' : '1px solid var(--border)',
                    borderRight: '1px solid var(--border)',
                    borderLeft: isToday ? '2px solid var(--accent)' : undefined,
                    background: isRS ? 'var(--accent-dim)' : isToday ? '#dbeafe' : isHol ? 'var(--teal-dim)' : isWe ? 'var(--surface3)' : undefined,
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
                // Days before the developer joined aren't theirs to account for — don't
                // count them as worked, or they'd look like a full month on day one.
                if (!joinedByDate(projects, selectedProject, dev.id, ds)) return
                const amHol = isAmHoliday(ds)
                const entry = getEntry(dev.id, ds)
                if (entry) {
                  counts[entry] = (counts[entry] ?? 0) + 1
                  if (entry === 'work') worked++
                }
                else if (amHol) counts['holiday'] = (counts['holiday'] ?? 0) + 1
                else worked++
              })

              const periods = dev.periods ?? []
              const monthStart = padDate(year, month, 1)
              const monthEnd = padDate(year, month, days)
              const activePeriods = periods.filter((p) => (p.from || '0000-01-01') <= monthEnd && (p.to || '9999-12-31') >= monthStart)
              const empSlash = activePeriods.length === 0 ? '' : activePeriods.map((p) => p.type === 'part' ? `Part (${p.hours || 4}h)` : 'Full').join(' / ')

              /*
               * Join date to surface for this row. With a project selected it's that
               * project's date; on 'ALL' it's the earliest across their projects, which
               * is when they effectively started being trackable at all.
               */
              const joinDate = (() => {
                const rel = selectedProject === 'ALL'
                  ? projects.filter((p) => p.members.includes(dev.id))
                  : projects.filter((p) => p.id === selectedProject)
                const ds = rel.map((p) => p.joinDates?.[dev.id]).filter((d): d is string => !!d)
                // On 'ALL', an undated membership means "always", so show nothing.
                if (selectedProject === 'ALL' && ds.length !== rel.length) return null
                return ds.length ? ds.sort()[0] : null
              })()

              return (
                <tr key={dev.id} style={{ background: di % 2 === 0 ? 'var(--surface)' : 'var(--surface2)' }}>
                  <td style={{ padding: '5px 10px', borderBottom: '1px solid var(--border)', borderRight: '1px solid var(--border)', position: 'sticky', left: 0, background: 'inherit', zIndex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
                      <div className="av" style={{ background: `rgba(${rgb},.15)`, color: dev.color, width: 24, height: 24, fontSize: 9, flexShrink: 0 }}>{initials(dev.name)}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 90 }}>{dev.name}</span>
                          <button onClick={() => setEmpModal(dev.id)} title="Edit employment periods" style={{ display: 'inline-flex', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', padding: '0 2px', flexShrink: 0 }}><Icon name="edit" size={11} /></button>
                        </div>
                        {empSlash && <div style={{ fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--accent)', marginBottom: 2 }}>{empSlash}</div>}
                        {joinDate && (
                          <div title={`Joined ${formatDate(joinDate)}`} style={{ fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--text3)', marginBottom: 2, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                            <Icon name="calendar" size={9} /> from {formatDate(joinDate)}
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {worked > 0 && <span title="Worked" style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 9, color: 'var(--green)', fontFamily: 'var(--mono)' }}><Icon name="briefcase" size={10} color="var(--green)" />{worked}d</span>}
                          {(counts['vacation'] ?? 0) > 0 && <span title="Vacation" style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 9, color: 'var(--teal)', fontFamily: 'var(--mono)' }}><Icon name="palm" size={10} color="var(--teal)" />{counts['vacation']}</span>}
                          {(counts['dayoff'] ?? 0) > 0 && <span title="Day off" style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 9, color: 'var(--amber)', fontFamily: 'var(--mono)' }}><Icon name="sun" size={10} color="var(--amber)" />{counts['dayoff']}</span>}
                          {(counts['sick'] ?? 0) > 0 && <span title="Sick" style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 9, color: 'var(--red)', fontFamily: 'var(--mono)' }}><Icon name="thermometer" size={10} color="var(--red)" />{counts['sick']}</span>}
                          {(counts['holiday'] ?? 0) > 0 && <span title="Holidays" style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 9, color: 'var(--pink)', fontFamily: 'var(--mono)' }}><Icon name="flag" size={10} color="var(--pink)" />{counts['holiday']}</span>}
                        </div>
                      </div>
                    </div>
                  </td>
                  {daysList.map((ds, ci) => {
                    const isWe = isWeekend(ds)
                    const amHol = isAmHoliday(ds)
                    const entry = getEntry(dev.id, ds)
                    const effective = entry ?? (amHol ? 'holiday' : null)
                    const dt = effective ? DAY_TYPES[effective] : null
                    const isRS = rangeStart?.devId === dev.id && rangeStart.date === ds
                    const isTodayCol = ds === today
                    const hours = getDevHoursForDate(dev, ds)
                    const isPartial = !effective && !isWe && hours !== 8
                    // Before this developer joined the project — shown inactive and not editable.
                    const preJoin = !joinedByDate(projects, selectedProject, dev.id, ds)

                    const cellBg = preJoin ? 'var(--surface2)'
                      : isRS ? 'var(--accent-border)'
                      : dt ? dt.bg
                      : isWe ? 'var(--surface3)'
                      : amHol ? 'var(--pink-dim)'
                      : (isPartial && !isWe) ? 'var(--accent-dim)'
                      : isTodayCol ? 'var(--accent-dim)'
                      : undefined

                    const cellLabel = preJoin ? 'Before this developer joined' : (amHol || dt?.label || (isPartial && !isWe ? `${hours}h / part-time` : 'Full day'))
                    const editable = !isWe && !preJoin

                    return (
                      <td
                        key={ds}
                        data-cell={`${di}-${ci}`}
                        tabIndex={di === clamped.row && ci === clamped.col ? 0 : -1}
                        onFocus={() => setCursor({ row: di, col: ci })}
                        onKeyDown={(e) => onCellKeyDown(e, editable)}
                        aria-label={`${dev.name}, ${formatDate(ds)} — ${cellLabel}`}
                        onClick={(e) => {
                          if (!editable) return
                          e.stopPropagation()
                          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                          handleCellClick(dev.id, ds, rect)
                        }}
                        title={cellLabel}
                        style={{
                          padding: 2, borderBottom: '1px solid var(--border)', borderRight: '1px solid var(--border)', textAlign: 'center',
                          borderLeft: isTodayCol ? '2px solid var(--accent)' : undefined,
                          cursor: editable ? 'pointer' : 'default',
                          background: cellBg,
                          opacity: preJoin ? 0.45 : undefined,
                          transition: 'filter .1s',
                          height: 30,
                          verticalAlign: 'middle',
                        }}
                        onMouseEnter={(e) => { if (editable) e.currentTarget.style.filter = 'brightness(0.93)' }}
                        onMouseLeave={(e) => { e.currentTarget.style.filter = '' }}
                      >
                        {dt && (
                          <div style={{ width: 22, height: 22, borderRadius: 4, background: dt.bg, border: `1px solid ${dt.border}`, margin: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Icon name={dt.icon} size={12} color={dt.color} />
                          </div>
                        )}
                        {!dt && amHol && <Icon name="flag" size={12} color="var(--pink)" />}
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
          onSelect={(type) => { setScheduleDay(menu.devId, menu.dateStr, type); closeMenu() }}
          onRange={() => { setRangeStart({ devId: menu.devId, date: menu.dateStr }); closeMenu() }}
          onClear={() => { setScheduleDay(menu.devId, menu.dateStr, null); closeMenu() }}
          onClose={closeMenu}
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

    </div>
  )
}
