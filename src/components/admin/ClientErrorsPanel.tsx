import { useCallback, useEffect, useState } from 'react'
import { adminGetClientErrors, type AdminUser, type ClientErrorEntry } from '../../utils/cloud-api'

const KIND_LABEL: Record<string, string> = {
  render: 'Screen crash',
  error: 'Uncaught error',
  unhandledrejection: 'Unhandled promise',
  save: 'Save rejected',
}

function when(iso: string): string {
  const d = new Date(iso)
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

/*
 * Errors raised in users' browsers, recorded by the built-in reporter. Newest first; click
 * a row for the stack trace, page and browser.
 */
export default function ClientErrorsPanel({ users }: { users: AdminUser[] }) {
  const [rows, setRows] = useState<ClientErrorEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await adminGetClientErrors()
    setFailed(res === null)
    setRows(res?.data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  const emailFor = (userId?: string) => users.find((u) => u.id === userId)?.email ?? userId ?? 'unknown user'

  return (
    <section style={{ marginTop: 28 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', margin: 0 }}>Browser errors</h2>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>
          {loading ? 'loading…' : `${rows.length} most recent`}
        </span>
        <button onClick={() => void load()} style={{ marginLeft: 'auto', fontSize: 12, background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', color: 'var(--text2)', cursor: 'pointer' }}>
          Refresh
        </button>
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 4px rgba(25,35,90,.07)' }}>
        {failed ? (
          <div style={{ padding: 20, fontSize: 13, color: 'var(--red)' }}>Couldn't load browser errors. Check that the backend is deployed, then refresh.</div>
        ) : !loading && rows.length === 0 ? (
          <div style={{ padding: 20, fontSize: 13, color: 'var(--text3)' }}>No browser errors recorded. When something breaks for a user, it appears here.</div>
        ) : (
          rows.map((r, i) => {
            const c = r.context ?? {}
            const isOpen = open === r.id
            return (
              <div key={r.id} style={{ borderTop: i ? '1px solid var(--border)' : 'none' }}>
                <button
                  onClick={() => setOpen(isOpen ? null : r.id)}
                  aria-expanded={isOpen}
                  style={{ width: '100%', display: 'grid', gridTemplateColumns: '130px 130px 1fr auto', gap: 12, alignItems: 'center', padding: '10px 14px', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', color: 'var(--text)' }}
                >
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)', fontVariantNumeric: 'tabular-nums' }}>{when(r.timestamp)}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: c.kind === 'save' ? 'var(--amber)' : 'var(--red)' }}>{KIND_LABEL[c.kind ?? 'error'] ?? c.kind}</span>
                  <span style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.message}</span>
                  <span style={{ fontSize: 11, color: 'var(--text3)', whiteSpace: 'nowrap' }}>{emailFor(c.userId)}</span>
                </button>
                {isOpen && (
                  <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--text2)' }}>
                    <div><strong>Page:</strong> {c.url ?? '—'} · <strong>Build:</strong> {c.release ?? '—'}</div>
                    <div style={{ color: 'var(--text3)' }}><strong>Browser:</strong> {c.userAgent ?? '—'}</div>
                    {c.stack && (
                      <pre style={{ margin: 0, padding: 10, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, fontFamily: 'var(--mono)', fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 320, overflow: 'auto' }}>{c.stack}</pre>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </section>
  )
}
