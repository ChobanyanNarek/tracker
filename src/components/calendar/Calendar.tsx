import { useStore } from '../../store'
import { todayStr, dlInfo, daysInMonth, padDate, isAmHoliday } from '../../utils/dates'
import { getJiras } from '../../utils/format'

export default function Calendar() {
  const { selectedDate, selectedProject, tasks, setSelectedDate } = useStore()
  const today = todayStr()

  const selD = new Date(selectedDate + 'T12:00:00')
  const year = selD.getFullYear()
  const month = selD.getMonth()
  const total = daysInMonth(year, month)

  const monthLabel = new Date(year, month, 1)
    .toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    .toUpperCase()

  // Build alert dot map
  const dlMap: Record<string, 'over' | 'warn'> = {}
  tasks.forEach((t) => {
    if (selectedProject !== 'ALL' && t.projectId !== selectedProject) return
    const jiras = getJiras(t)
    const deadlines = jiras.length
      ? jiras.filter((j) => j.deadline && j.status !== 'done').map((j) => ({ dl: j.deadline, dt: j.deadlineTime }))
      : t.deadline && t.status !== 'done' ? [{ dl: t.deadline, dt: t.deadlineTime }] : []
    deadlines.forEach(({ dl, dt }) => {
      const info = dlInfo(dl, dt)
      if (info.diff <= 2 && info.diff >= -1) dlMap[dl] = info.diff < 0 ? 'over' : 'warn'
    })
  })

  const goMonth = (delta: number) => {
    const d = new Date(selectedDate + 'T12:00:00')
    d.setMonth(d.getMonth() + delta)
    setSelectedDate(d.toISOString().split('T')[0])
  }

  const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

  return (
    <div style={{ padding: '9px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: 11 }}>
      {/* nav */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <button onClick={() => goMonth(-1)} style={{ background: 'var(--surface3)', border: '1px solid var(--border)', color: 'var(--text2)', width: 26, height: 26, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, transition: 'all .15s' }}>‹</button>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 500, color: 'var(--text2)', minWidth: 82, textAlign: 'center', letterSpacing: '.5px' }}>{monthLabel}</div>
        <button onClick={() => goMonth(1)} style={{ background: 'var(--surface3)', border: '1px solid var(--border)', color: 'var(--text2)', width: 26, height: 26, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, transition: 'all .15s' }}>›</button>
      </div>

      {/* day chips */}
      <div style={{ display: 'flex', gap: 3, overflowX: 'auto', flex: 1, scrollbarWidth: 'none' }}>
        {Array.from({ length: total }, (_, i) => i + 1).map((day) => {
          const ds = padDate(year, month, day)
          const d = new Date(ds + 'T12:00:00')
          const dow = DOW[d.getDay()]
          const weekend = d.getDay() === 0 || d.getDay() === 6
          const holiday = isAmHoliday(ds)
          const isToday = ds === today
          const isActive = ds === selectedDate
          const alertType = dlMap[ds]

          let bg = 'var(--surface2)'
          let textColor = 'var(--text2)'
          let border = '1px solid var(--border)'
          let opacity: string | number = 1

          if (isActive) { bg = 'var(--accent-dim)'; border = '1px solid var(--accent)'; textColor = 'var(--accent)' }
          else if (holiday) { bg = '#cffafe'; border = '1px solid #a5f3fc'; textColor = '#0891b2' }
          else if (weekend) { bg = 'var(--surface3)'; textColor = 'var(--text3)'; opacity = 0.7 }

          return (
            <div
              key={ds}
              onClick={() => setSelectedDate(ds)}
              title={holiday ?? ''}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, padding: '4px 7px', borderRadius: 'var(--r)', border, cursor: 'pointer', background: bg, transition: 'all .15s', minWidth: 38, flexShrink: 0, position: 'relative', opacity }}
            >
              {alertType && isToday && (
                <div style={{ position: 'absolute', top: 3, right: 3, width: 5, height: 5, borderRadius: '50%', background: alertType === 'over' ? 'var(--red)' : 'var(--amber)', border: '1px solid var(--surface)' }} />
              )}
              <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: textColor, textTransform: 'uppercase', letterSpacing: '.4px' }}>{dow}</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 600, color: textColor }}>
                {day}
                {isToday && !isActive && <div style={{ width: 4, height: 4, background: 'var(--green)', borderRadius: '50%', margin: '1px auto 0' }} />}
              </div>
            </div>
          )
        })}
      </div>

      <button
        onClick={() => setSelectedDate(today)}
        style={{ background: 'var(--surface2)', border: '1px solid var(--border2)', color: 'var(--text2)', fontFamily: 'var(--mono)', fontSize: 10, padding: '4px 9px', borderRadius: 6, whiteSpace: 'nowrap', transition: 'all .15s' }}
      >
        Today
      </button>
    </div>
  )
}
