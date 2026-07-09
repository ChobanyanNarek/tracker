import { useState, useRef, type CSSProperties } from 'react'
import { useStore } from '../../store'
import { useClickOutside } from '../../hooks/useClickOutside'
import ConfirmDialog from '../ui/ConfirmDialog'

interface Props {
  onFeedback: (msg: string) => void
}

/** Backup / Restore consolidated into one dropdown — same pattern as the Services menu. */
export default function DataDropdown({ onFeedback }: Props) {
  const [open, setOpen] = useState(false)
  const [pendingImport, setPendingImport] = useState<string | null>(null)
  const ref = useClickOutside<HTMLDivElement>(() => setOpen(false))
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { exportJSON, importJSON } = useStore()

  const handleRestore = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => setPendingImport(ev.target!.result as string)
    reader.readAsText(file)
    e.target.value = ''
  }

  const confirmImport = () => {
    if (!pendingImport) return
    try {
      importJSON(pendingImport)
      onFeedback('Data restored from backup')
    } catch (err) {
      onFeedback('Could not read file: ' + (err as Error).message)
    }
    setPendingImport(null)
  }

  const rowStyle: CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 9, padding: '9px 13px',
    background: 'none', border: 'none', width: '100%', cursor: 'pointer',
    textAlign: 'left', transition: 'background .15s',
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />
      <button
        onClick={() => setOpen((o) => !o)}
        title="Backup & restore data"
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          border: '1px solid var(--border)', background: 'var(--surface)',
          color: 'var(--text3)', fontFamily: 'var(--mono)', fontSize: 11,
          padding: '5px 11px', borderRadius: 6, cursor: 'pointer',
          transition: 'all .15s', whiteSpace: 'nowrap',
        }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
        Data
      </button>

      {open && (
        <div className="menu" style={{ top: 'calc(100% + 6px)', right: 0, width: 210, zIndex: 500 }}>
          <div style={{ padding: '8px 13px 6px', borderBottom: '1px solid var(--border)' }}>
            <span className="section-label">Backup & Restore</span>
          </div>
          <button
            style={rowStyle}
            onClick={() => { setOpen(false); exportJSON(); onFeedback('Backup downloaded') }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface2)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = '')}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            <div>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>Backup</div>
              <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--text3)' }}>Download all data as JSON</div>
            </div>
          </button>
          <button
            style={{ ...rowStyle, borderTop: '1px solid var(--border)' }}
            onClick={() => { setOpen(false); handleRestore() }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface2)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = '')}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--amber)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 14 12 9 17 14"/><line x1="12" y1="9" x2="12" y2="21"/></svg>
            <div>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>Restore</div>
              <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--text3)' }}>Replace data from a file</div>
            </div>
          </button>
        </div>
      )}

      {pendingImport && (
        <ConfirmDialog
          title="Restore from backup?"
          message="This replaces ALL current data — developers, projects, checkpoints and settings — with the contents of the selected file."
          confirmLabel="Replace data"
          onConfirm={confirmImport}
          onCancel={() => setPendingImport(null)}
        />
      )}
    </div>
  )
}
