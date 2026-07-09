import { useState, useEffect, useCallback } from 'react'
import { adminGetUsers, adminDeleteUser, adminChangePassword, type AdminUser } from '../../utils/cloud-api'

interface Props {
  onBack: () => void
}

export default function AdminPage({ onBack }: Props) {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null)
  const [pwTarget, setPwTarget] = useState<AdminUser | null>(null)
  const [newPw, setNewPw] = useState('')
  const [busy, setBusy] = useState(false)

  const showToast = useCallback((msg: string, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 4000)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const data = await adminGetUsers()
    setUsers(data)
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  const handleDelete = async () => {
    if (!deleteTarget) return
    setBusy(true)
    const ok = await adminDeleteUser(deleteTarget.id)
    setBusy(false)
    setDeleteTarget(null)
    if (ok) {
      showToast(`${deleteTarget.email} deleted`)
      setUsers((prev) => prev.filter((u) => u.id !== deleteTarget.id))
    } else {
      showToast('Delete failed', false)
    }
  }

  const handleChangePassword = async () => {
    if (!pwTarget || newPw.length < 6) return
    setBusy(true)
    const ok = await adminChangePassword(pwTarget.id, newPw)
    setBusy(false)
    if (ok) {
      showToast(`Password updated for ${pwTarget.email}`)
      setPwTarget(null)
      setNewPw('')
    } else {
      showToast('Password change failed', false)
    }
  }

  const dot = (on: boolean) => (
    <span style={{
      display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
      background: on ? 'var(--green, #22c55e)' : 'var(--border)',
      flexShrink: 0,
    }} />
  )

  const badge = (label: string, color: string) => (
    <span style={{
      fontSize: 10, fontFamily: 'var(--mono)', padding: '2px 7px', borderRadius: 8,
      background: color + '18', color, border: `1px solid ${color}40`,
      fontWeight: 600, whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg)', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '0 24px',
        height: 54, borderBottom: '1px solid var(--border)', background: 'var(--surface)',
        flexShrink: 0,
      }}>
        <button
          onClick={onBack}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontFamily: 'var(--sans)', fontSize: 13, padding: '4px 8px', borderRadius: 6, transition: 'background .15s' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface2)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
        >
          ← Back
        </button>
        <div style={{ width: 1, height: 20, background: 'var(--border)' }} />
        <span style={{ fontFamily: 'var(--sans)', fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
          Admin Panel
        </span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)', marginLeft: 4 }}>
          {!loading && `${users.length} user${users.length !== 1 ? 's' : ''}`}
        </span>
        <div style={{ marginLeft: 'auto' }}>
          <button
            onClick={() => { void load() }}
            style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text3)', fontFamily: 'var(--mono)', fontSize: 11, padding: '4px 10px', borderRadius: 6, transition: 'all .15s' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface2)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: 'var(--text3)', fontFamily: 'var(--mono)', fontSize: 13 }}>
            Loading…
          </div>
        ) : users.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: 'var(--text3)', fontFamily: 'var(--mono)', fontSize: 13 }}>
            No users found
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--sans)', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border)' }}>
                  {['Name', 'Email', 'Role', 'Devs', 'Projects', 'Jira', 'GitLab', 'GitHub', 'Actions'].map((h) => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--text3)', fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr
                    key={u.id}
                    style={{ borderBottom: '1px solid var(--border)', transition: 'background .1s' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                  >
                    <td style={{ padding: '11px 12px', whiteSpace: 'nowrap' }}>
                      <div style={{ fontWeight: 500, color: 'var(--text)' }}>{u.firstName} {u.lastName}</div>
                    </td>
                    <td style={{ padding: '11px 12px' }}>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text3)' }}>{u.email}</span>
                    </td>
                    <td style={{ padding: '11px 12px' }}>
                      {u.role === 'ADMIN'
                        ? badge('ADMIN', 'var(--accent)')
                        : badge('CREATOR', 'var(--text3)')}
                    </td>
                    <td style={{ padding: '11px 12px', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 13, color: u.devCount > 0 ? 'var(--text)' : 'var(--text3)' }}>
                      {u.devCount}
                    </td>
                    <td style={{ padding: '11px 12px', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 13, color: u.projectCount > 0 ? 'var(--text)' : 'var(--text3)' }}>
                      {u.projectCount}
                    </td>
                    <td style={{ padding: '11px 12px', textAlign: 'center' }}>{dot(u.jiraConnected)}</td>
                    <td style={{ padding: '11px 12px', textAlign: 'center' }}>{dot(u.gitlabConnected)}</td>
                    <td style={{ padding: '11px 12px', textAlign: 'center' }}>{dot(u.githubConnected)}</td>
                    <td style={{ padding: '11px 12px', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          onClick={() => { setPwTarget(u); setNewPw('') }}
                          title="Change password"
                          style={{ fontSize: 11, fontFamily: 'var(--mono)', padding: '4px 9px', borderRadius: 5, border: '1px solid var(--border)', background: 'none', cursor: 'pointer', color: 'var(--text3)', transition: 'all .12s' }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface2)'; e.currentTarget.style.color = 'var(--text)' }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text3)' }}
                        >
                          🔑 Password
                        </button>
                        <button
                          onClick={() => setDeleteTarget(u)}
                          title="Delete account"
                          style={{ fontSize: 11, fontFamily: 'var(--mono)', padding: '4px 9px', borderRadius: 5, border: '1px solid var(--red, #ef4444)40', background: 'none', cursor: 'pointer', color: 'var(--red, #ef4444)', transition: 'all .12s' }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--red, #ef4444)12')}
                          onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                        >
                          🗑 Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Delete confirm modal */}
      {deleteTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => !busy && setDeleteTarget(null)}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 28, width: 380, boxShadow: 'var(--shadow-xl)' }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 10 }}>Delete account?</div>
            <div style={{ fontSize: 13, color: 'var(--text3)', lineHeight: 1.5, marginBottom: 22 }}>
              This will permanently delete <strong style={{ color: 'var(--text)' }}>{deleteTarget.firstName} {deleteTarget.lastName}</strong> (<span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{deleteTarget.email}</span>) and all their pm-tracker data. This cannot be undone.
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={busy}
                style={{ padding: '8px 16px', borderRadius: 7, border: '1px solid var(--border)', background: 'none', cursor: 'pointer', fontFamily: 'var(--sans)', fontSize: 13, color: 'var(--text3)' }}
              >
                Cancel
              </button>
              <button
                onClick={() => { void handleDelete() }}
                disabled={busy}
                style={{ padding: '8px 16px', borderRadius: 7, border: 'none', background: 'var(--red, #ef4444)', cursor: busy ? 'default' : 'pointer', fontFamily: 'var(--sans)', fontSize: 13, color: '#fff', opacity: busy ? 0.6 : 1 }}
              >
                {busy ? 'Deleting…' : 'Delete account'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Change password modal */}
      {pwTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => !busy && setPwTarget(null)}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 28, width: 380, boxShadow: 'var(--shadow-xl)' }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>Change password</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', fontFamily: 'var(--mono)', marginBottom: 18 }}>{pwTarget.email}</div>
            <input
              type="password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleChangePassword() }}
              placeholder="New password (min 6 chars)"
              autoFocus
              style={{
                width: '100%', padding: '9px 12px', borderRadius: 7, border: '1px solid var(--border)',
                background: 'var(--bg)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 13,
                outline: 'none', boxSizing: 'border-box', marginBottom: 18,
              }}
            />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => { setPwTarget(null); setNewPw('') }}
                disabled={busy}
                style={{ padding: '8px 16px', borderRadius: 7, border: '1px solid var(--border)', background: 'none', cursor: 'pointer', fontFamily: 'var(--sans)', fontSize: 13, color: 'var(--text3)' }}
              >
                Cancel
              </button>
              <button
                onClick={() => { void handleChangePassword() }}
                disabled={busy || newPw.length < 6}
                style={{ padding: '8px 16px', borderRadius: 7, border: 'none', background: 'var(--accent)', cursor: (busy || newPw.length < 6) ? 'default' : 'pointer', fontFamily: 'var(--sans)', fontSize: 13, color: '#fff', opacity: (busy || newPw.length < 6) ? 0.5 : 1 }}
              >
                {busy ? 'Saving…' : 'Update password'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: toast.ok ? 'var(--text)' : 'var(--red, #ef4444)', color: '#fff', fontFamily: 'var(--mono)', fontSize: 12, padding: '9px 18px', borderRadius: 24, boxShadow: '0 4px 20px rgba(0,0,0,.3)', zIndex: 2000 }}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
