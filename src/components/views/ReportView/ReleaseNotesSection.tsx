import { useState } from 'react'
import { useStore } from '../../../store'
import { btnBase } from './shared'
import KanbanReleaseNotes from './KanbanReleaseNotes'
import ScrumReleaseNotes from './ScrumReleaseNotes'

export default function ReleaseNotesSection() {
  const { projects, selectedProject } = useStore()
  const proj = selectedProject !== 'ALL' ? projects.find((p) => p.id === selectedProject) : null
  const defaultMode = proj?.mode === 'scrum' ? 'scrum' : 'kanban'
  const [mode, setMode] = useState<'kanban' | 'scrum'>(defaultMode)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        {(['kanban', 'scrum'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            style={{ ...btnBase, border: `1px solid ${mode === m ? 'var(--accent)' : 'var(--border)'}`, background: mode === m ? 'var(--accent-dim)' : 'var(--surface2)', color: mode === m ? 'var(--accent)' : 'var(--text2)', fontWeight: mode === m ? 700 : 400 }}
          >
            {m === 'kanban' ? 'Kanban' : 'Scrum'}
          </button>
        ))}
      </div>

      {mode === 'kanban' && <KanbanReleaseNotes />}
      {mode === 'scrum' && <ScrumReleaseNotes />}
    </div>
  )
}
