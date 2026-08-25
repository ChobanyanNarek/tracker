import { useState } from 'react'
import StandupSection from './StandupSection'
import MonthlySection from './MonthlySection'
import ReleaseNotesSection from './ReleaseNotesSection'

type SubTab = 'standup' | 'monthly' | 'release'

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'standup', label: 'Standup' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'release', label: 'Release Notes' },
]

export default function ReportView() {
  const [tab, setTab] = useState<SubTab>('standup')

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* secondary tab bar */}
      <div style={{ display: 'flex', gap: 6, padding: '10px 16px', background: 'var(--surface)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        {SUB_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              fontFamily: 'var(--mono)', fontSize: 11, fontWeight: tab === t.id ? 700 : 400,
              padding: '4px 12px', borderRadius: 20, cursor: 'pointer', transition: 'var(--t)',
              border: `1px solid ${tab === t.id ? 'var(--accent)' : 'var(--border)'}`,
              background: tab === t.id ? 'var(--accent-dim)' : 'var(--surface2)',
              color: tab === t.id ? 'var(--accent)' : 'var(--text3)',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 20px' }}>
        {tab === 'standup' && <StandupSection />}
        {tab === 'monthly' && <MonthlySection />}
        {tab === 'release' && <ReleaseNotesSection />}
      </div>
    </div>
  )
}
