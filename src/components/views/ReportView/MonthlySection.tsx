import { useState } from 'react'
import { useStore } from '../../../store'
import { copyText } from '../../../utils/clipboard'
import { formatDateTime, daysInMonth, padDate, isAmHoliday } from '../../../utils/dates'
import Icon from '../../ui/Icon'
import type { EmploymentPeriod } from '../../../types'
import { btnBase } from './shared'

// ── helpers ──────────────────────────────────────────────────────────────────

function getDevHoursForDate(dev: { periods?: EmploymentPeriod[] }, dateStr: string): number {
  const periods = dev.periods ?? []
  for (const p of periods) {
    const from = p.from || '0000-01-01'
    const to = p.to || '9999-12-31'
    if (dateStr >= from && dateStr <= to) return p.type === 'part' ? (p.hours || 4) : 8
  }
  return 8
}

function collapseRanges(dates: string[], year: number): string {
  if (!dates.length) return ''
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

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

function isWeekend(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00')
  return d.getDay() === 0 || d.getDay() === 6
}

export default function MonthlySection() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const [copied, setCopied] = useState(false)

  const { developers: allDevs, schedule, selectedProject, selectedDev, projects } = useStore()
  const proj = selectedProject !== 'ALL' ? projects.find((p) => p.id === selectedProject) : null
  const developers = allDevs.filter((d) => {
    if (d.archivedAt) return false
    if (selectedDev !== 'ALL' && d.id !== selectedDev) return false
    if (proj && proj.members.length > 0 && !proj.members.includes(d.id)) return false
    return true
  })

  const days = daysInMonth(year, month)
  const daysList: string[] = []
  for (let d = 1; d <= days; d++) daysList.push(padDate(year, month, d))

  const buildTextReport = () => {
    const monthName = `${MONTHS[month]} ${year}`
    const totalWorkdays = daysList.filter((d) => !isWeekend(d) && !isAmHoliday(d)).length
    const totalHolidays = daysList.filter((d) => !isWeekend(d) && !!isAmHoliday(d)).length
    const weekends = daysList.filter((d) => isWeekend(d)).length

    const richStats = developers.map((dev) => {
      const vacD: string[] = [], dayoffD: string[] = [], sickD: string[] = [], holD: string[] = []
      let worked = 0
      daysList.forEach((ds) => {
        if (isWeekend(ds)) return
        const amHol = isAmHoliday(ds)
        const entry = schedule[dev.id]?.[ds]
        const ddmm = ds.slice(8) + '.' + ds.slice(5, 7)
        if (entry === 'vacation') vacD.push(ddmm)
        else if (entry === 'dayoff') dayoffD.push(ddmm)
        else if (entry === 'sick') sickD.push(ddmm)
        else if (entry === 'holiday' || (amHol && !entry)) holD.push(ddmm)
        else { worked++; getDevHoursForDate(dev, ds) }
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
      return { dev, worked, periodDesc, vacation: vacD.length, vacationStr: collapseRanges(vacD, year), dayoff: dayoffD.length, dayoffStr: dayoffD.join(', '), sick: sickD.length, sickStr: sickD.join(', '), holidays: holD.length, holidayStr: holD.join(', ') }
    })

    const lines = [
      `MONTHLY WORKING DAYS REPORT — ${monthName.toUpperCase()}`,
      '═'.repeat(60),
      `Total: ${days} days  |  ${totalWorkdays} workdays  |  ${totalHolidays} public holidays  |  ${weekends} weekends`,
      '',
      ...richStats.flatMap(({ dev, worked, periodDesc, vacation, vacationStr, dayoff, dayoffStr, sick, sickStr, holidays, holidayStr }) => {
        const parts = [`${worked} working days`]
        if (holidays) parts.push(`${holidays} public holiday${holidays !== 1 ? 's' : ''} (${holidayStr})`)
        if (vacation) parts.push(`${vacation} vacation day${vacation !== 1 ? 's' : ''} (${vacationStr})`)
        if (dayoff) parts.push(`${dayoff} day off${dayoff !== 1 ? 's' : ''} (${dayoffStr})`)
        if (sick) parts.push(`${sick} sick day${sick !== 1 ? 's' : ''} (${sickStr})`)
        return [`${dev.name} — ${periodDesc}`, parts.join(' / '), '']
      }),
      '─'.repeat(60),
      `Generated: ${formatDateTime(new Date())}`,
    ]
    return lines.join('\n')
  }

  const prevMonth = () => {
    if (month === 0) { setYear((y) => y - 1); setMonth(11) } else setMonth((m) => m - 1)
  }
  const nextMonth = () => {
    if (month === 11) { setYear((y) => y + 1); setMonth(0) } else setMonth((m) => m + 1)
  }

  const reportText = buildTextReport()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={prevMonth} className="icon-btn">‹</button>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 600, minWidth: 130, textAlign: 'center' }}>{MONTHS[month]} {year}</span>
        <button onClick={nextMonth} className="icon-btn">›</button>
        <button onClick={() => { const n = new Date(); setYear(n.getFullYear()); setMonth(n.getMonth()) }} style={{ fontFamily: 'var(--mono)', fontSize: 10, padding: '3px 10px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text3)', cursor: 'pointer' }}>This month</button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button
            onClick={() => {
              const blob = new Blob([reportText], { type: 'text/plain' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = `monthly-report-${MONTHS[month].toLowerCase()}-${year}.txt`
              a.click()
              URL.revokeObjectURL(url)
            }}
            style={{ ...btnBase, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text2)' }}
          >
            <Icon name="download" size={12} />
            Download .txt
          </button>
          <button
            onClick={async () => {
              const ok = await copyText(reportText)
              setCopied(ok)
              setTimeout(() => setCopied(false), 2000)
            }}
            style={{ ...btnBase, background: copied ? 'var(--green-dim)' : 'var(--accent)', border: `1px solid ${copied ? 'var(--green-border)' : 'var(--accent)'}`, color: copied ? 'var(--green)' : '#fff', fontWeight: 600 }}
          >
            <Icon name={copied ? 'check' : 'copy'} size={12} color={copied ? 'var(--green)' : '#fff'} />
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      {developers.length === 0 ? (
        <div style={{ color: 'var(--text3)', fontStyle: 'italic', fontSize: 13 }}>No developers match the current filter.</div>
      ) : (
        <textarea
          readOnly
          value={reportText}
          style={{ border: '1px solid var(--border)', outline: 'none', padding: '12px 16px', fontFamily: 'var(--mono)', fontSize: 12, lineHeight: 1.7, color: 'var(--text2)', background: 'var(--surface2)', resize: 'vertical', borderRadius: 8, minHeight: 320 }}
        />
      )}
    </div>
  )
}
