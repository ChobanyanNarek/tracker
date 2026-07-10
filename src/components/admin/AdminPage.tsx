import { useState, useEffect, useCallback, type ReactNode } from 'react'
import { adminGetUsers, adminDeleteUser, adminDeleteUserData, adminChangePassword, adminEditUser, type AdminUser } from '../../utils/cloud-api'

interface Props {
  onBack: () => void
}

// ── SVG icons ──────────────────────────────────────────────────────
const IcoBack    = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
const IcoRefresh = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12A9 9 0 1 1 15 4"/><path d="M15 1v4h4"/></svg>
const IcoKey     = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
const IcoWipe    = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/><line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/></svg>
const IcoTrash   = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6m4-6v6"/><path d="M9 6V4h6v2"/></svg>
const IcoPhone   = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.15 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.06 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21 16.92z"/></svg>

// ── Helpers ────────────────────────────────────────────────────────
function initials(u: AdminUser) {
  const f = (u.firstName ?? '').trim()
  const l = (u.lastName ?? '').trim()
  if (f && l) return (f[0] + l[0]).toUpperCase()
  if (f) return f.slice(0, 2).toUpperCase()
  return (u.email.split('@')[0][0] ?? '?').toUpperCase()
}
function displayName(u: AdminUser) {
  return [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email.split('@')[0]
}

// ── Sub-components ─────────────────────────────────────────────────
function Avatar({ u }: { u: AdminUser }) {
  const isAdmin = u.role === 'ADMIN'
  return (
    <div style={{
      width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600, letterSpacing: '-.3px',
      background: isAdmin ? 'var(--accent-dim, #eef1ff)' : 'var(--surface3, #eceef6)',
      color: isAdmin ? 'var(--accent)' : 'var(--text2, #4a5178)',
      border: isAdmin ? '1px solid var(--accent-border, #bac4f8)' : '1px solid var(--border)',
    }}>
      {initials(u)}
    </div>
  )
}

function RoleBadge({ u }: { u: AdminUser }) {
  const isAdmin = u.role === 'ADMIN'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '3px 8px', borderRadius: 6,
      fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 600, letterSpacing: '.05em', whiteSpace: 'nowrap',
      background: isAdmin ? 'var(--accent-dim, #eef1ff)' : 'var(--surface3, #eceef6)',
      color: isAdmin ? 'var(--accent)' : 'var(--text3)',
      border: isAdmin ? '1px solid var(--accent-border, #bac4f8)' : '1px solid var(--border)',
    }}>
      {isAdmin ? 'Admin' : 'Creator'}
    </span>
  )
}

function ConnPill({ on, cls, label }: { on: boolean; cls: string; label: string }) {
  const styles: Record<string, { bg: string; color: string; dot: string }> = {
    jira: { bg: '#e8f0fe', color: '#1a56db', dot: '#1a56db' },
    gl:   { bg: '#fff1e6', color: '#e24329', dot: '#e24329' },
    gh:   { bg: 'var(--surface3, #eceef6)', color: 'var(--text2, #4a5178)', dot: 'var(--text2, #4a5178)' },
  }
  const s = styles[cls]
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 5,
      fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap',
      background: on ? s.bg : 'transparent',
      color: on ? s.color : 'var(--text4, #b5bbce)',
      border: on ? 'none' : '1px solid var(--border)',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: on ? s.dot : 'var(--border2, #c5cbe0)' }} />
      {label}
    </span>
  )
}

function ActionBtn({ variant, onClick, children }: { variant: 'pw' | 'wipe' | 'del'; onClick: () => void; children: ReactNode }) {
  const [hov, setHov] = useState(false)
  const vars = {
    pw:   { color: hov ? 'var(--text)' : 'var(--text3)',        border: 'var(--border)',        bg: hov ? 'var(--surface2)' : 'transparent' },
    wipe: { color: 'var(--amber, #d97706)',                      border: 'var(--amber-border, #fcd34d)', bg: hov ? 'var(--amber-dim, #fef3c7)' : 'transparent' },
    del:  { color: 'var(--red, #dc2626)',                        border: 'var(--red-border, #fca5a5)',   bg: hov ? 'var(--red-dim, #fee2e2)' : 'transparent' },
  }[variant]
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 6,
        fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap',
        border: `1px solid ${vars.border}`, background: vars.bg, color: vars.color,
        cursor: 'pointer', transition: 'all .12s',
      }}
    >
      {children}
    </button>
  )
}

function Modal({ title, desc, icon, confirmLabel, confirmVariant, onConfirm, onCancel, busy, children }: {
  title: string; desc?: ReactNode; icon: ReactNode; confirmLabel: string
  confirmVariant: 'accent' | 'amber' | 'red'; onConfirm: () => void; onCancel: () => void; busy: boolean
  children?: ReactNode
}) {
  const bgMap = { accent: 'var(--accent)', amber: 'var(--amber, #d97706)', red: 'var(--red, #dc2626)' }
  const iconBg = { accent: 'var(--accent-dim, #eef1ff)', amber: 'var(--amber-dim, #fef3c7)', red: 'var(--red-dim, #fee2e2)' }
  const iconColor = { accent: 'var(--accent)', amber: 'var(--amber, #d97706)', red: 'var(--red, #dc2626)' }
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(23,26,45,.45)', backdropFilter: 'blur(3px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={() => !busy && onCancel()}
    >
      <div
        style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 28, width: '100%', maxWidth: 400, boxShadow: '0 24px 72px rgba(25,35,90,.18)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ width: 46, height: 46, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 18, background: iconBg[confirmVariant], color: iconColor[confirmVariant] }}>
          {icon}
        </div>
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', letterSpacing: '-.2px', marginBottom: 8 }}>{title}</div>
        {desc && <div style={{ fontSize: 13, color: 'var(--text3)', lineHeight: 1.65, marginBottom: 20 }}>{desc}</div>}
        {children}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: desc ? 4 : 0 }}>
          <button
            onClick={onCancel} disabled={busy}
            style={{ padding: '8px 18px', borderRadius: 7, border: '1px solid var(--border)', background: 'none', fontSize: 13, color: 'var(--text3)', cursor: 'pointer', opacity: busy ? .5 : 1 }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm} disabled={busy}
            style={{ padding: '8px 18px', borderRadius: 7, border: 'none', background: bgMap[confirmVariant], fontSize: 13, fontWeight: 500, color: '#fff', cursor: busy ? 'default' : 'pointer', opacity: busy ? .55 : 1 }}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────
export default function AdminPage({ onBack }: Props) {
  const [users, setUsers]           = useState<AdminUser[]>([])
  const [loading, setLoading]       = useState(true)
  const [toast, setToast]           = useState<{ msg: string; ok: boolean } | null>(null)
  const [deleteTarget, setDelTarget] = useState<AdminUser | null>(null)
  const [dataTarget, setDataTarget]  = useState<AdminUser | null>(null)
  const [pwTarget, setPwTarget]      = useState<AdminUser | null>(null)
  const [newPw, setNewPw]            = useState('')
  const [phoneTarget, setPhoneTarget] = useState<AdminUser | null>(null)
  const [newPhone, setNewPhone]       = useState('')
  const [busy, setBusy]              = useState(false)
  const [isMobile, setIsMobile]      = useState(() => window.innerWidth < 768)

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const showToast = useCallback((msg: string, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 4000)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setUsers(await adminGetUsers())
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  const handleDelete = async () => {
    if (!deleteTarget) return
    setBusy(true)
    const ok = await adminDeleteUser(deleteTarget.id)
    setBusy(false)
    setDelTarget(null)
    if (ok) { showToast(`${displayName(deleteTarget)} deleted`); setUsers((p) => p.filter((u) => u.id !== deleteTarget.id)) }
    else showToast('Delete failed', false)
  }

  const handleDeleteData = async () => {
    if (!dataTarget) return
    setBusy(true)
    const ok = await adminDeleteUserData(dataTarget.id)
    setBusy(false)
    setDataTarget(null)
    if (ok) { showToast(`Data wiped for ${displayName(dataTarget)}`); await load() }
    else showToast('Failed to delete data', false)
  }

  const handleChangePw = async () => {
    if (!pwTarget || newPw.length < 6) return
    setBusy(true)
    const ok = await adminChangePassword(pwTarget.id, newPw)
    setBusy(false)
    if (ok) { showToast('Password updated'); setPwTarget(null); setNewPw('') }
    else showToast('Password change failed', false)
  }

  const handleEditPhone = async () => {
    if (!phoneTarget) return
    setBusy(true)
    const phone = newPhone.trim() || null
    const ok = await adminEditUser(phoneTarget.id, { phone })
    setBusy(false)
    if (ok) {
      showToast('Phone updated')
      setUsers((p) => p.map((u) => u.id === phoneTarget.id ? { ...u, phone } : u))
      setPhoneTarget(null)
      setNewPhone('')
    } else {
      showToast('Phone update failed', false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg)', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, padding: `0 ${isMobile ? 16 : 24}px`, height: 54, borderBottom: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0, boxShadow: '0 1px 4px rgba(25,35,90,.07)' }}>
        <HeaderBtn onClick={onBack}><IcoBack /> {!isMobile && 'Back'}</HeaderBtn>
        <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 14px' }} />
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap' }}>Admin Panel</span>
        {!isMobile && !loading && (
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)', marginLeft: 8 }}>
            {users.length} user{users.length !== 1 ? 's' : ''}
          </span>
        )}
        <div style={{ marginLeft: 'auto' }}>
          <HeaderBtn onClick={() => { void load() }}><IcoRefresh /> {!isMobile && 'Refresh'}</HeaderBtn>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: 'auto', padding: isMobile ? 16 : 28 }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, height: 240, color: 'var(--text3)', fontFamily: 'var(--mono)', fontSize: 13 }}>
            <Spinner /><span>Loading users…</span>
          </div>
        ) : users.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 240, color: 'var(--text3)', fontFamily: 'var(--mono)', fontSize: 13 }}>
            No users found
          </div>
        ) : isMobile ? (
          /* ── Mobile cards ── */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {users.map((u) => (
              <div key={u.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 18, boxShadow: '0 1px 4px rgba(25,35,90,.07)' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
                  <Avatar u={u} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                      <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>{displayName(u)}</span>
                      <RoleBadge u={u} />
                    </div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)', wordBreak: 'break-all' }}>{u.email}</div>
                    {u.phone && <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{u.phone}</div>}
                  </div>
                </div>
                <div style={{ display: 'flex', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', marginBottom: 12 }}>
                  {[{ n: u.devCount, l: 'Devs' }, { n: u.projectCount, l: 'Projects' }].map(({ n, l }, i) => (
                    <div key={l} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '10px 8px', borderLeft: i > 0 ? '1px solid var(--border)' : 'none' }}>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: 18, fontWeight: 600, color: n > 0 ? 'var(--text)' : 'var(--text4, #b5bbce)', lineHeight: 1 }}>{n}</div>
                      <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>{l}</div>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 14 }}>
                  <ConnPill on={u.jiraConnected}   cls="jira" label="Jira" />
                  <ConnPill on={u.gitlabConnected} cls="gl"   label="GitLab" />
                  <ConnPill on={u.githubConnected} cls="gh"   label="GitHub" />
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {([
                    { v: 'pw',   icon: <IcoPhone />, label: 'Phone',    action: () => { setPhoneTarget(u); setNewPhone(u.phone ?? '') } },
                    { v: 'pw',   icon: <IcoKey />,   label: 'Password', action: () => { setPwTarget(u); setNewPw('') } },
                    { v: 'wipe', icon: <IcoWipe />,  label: 'Data',     action: () => setDataTarget(u) },
                    { v: 'del',  icon: <IcoTrash />, label: 'Delete',   action: () => setDelTarget(u) },
                  ] as const).map(({ v, icon, label, action }) => (
                    <MobileActionBtn key={label} variant={v} onClick={action}>{icon} {label}</MobileActionBtn>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* ── Desktop table ── */
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 4px rgba(25,35,90,.07)' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
                    {['User', 'Role', 'Stats', 'Connections', 'Actions'].map((h) => (
                      <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text3)', whiteSpace: 'nowrap' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.map((u, i) => (
                    <TableRow key={u.id} u={u} isLast={i === users.length - 1}
                      onPhone={() => { setPhoneTarget(u); setNewPhone(u.phone ?? '') }}
                      onPw={() => { setPwTarget(u); setNewPw('') }}
                      onData={() => setDataTarget(u)}
                      onDel={() => setDelTarget(u)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ── Modals ── */}
      {dataTarget && (
        <Modal
          title="Delete user data?"
          desc={<>All tasks, developers, projects, and integration configs for <strong style={{ color: 'var(--text)' }}>{displayName(dataTarget)}</strong> will be permanently wiped. The account is kept — the user can sign in and start fresh.</>}
          icon={<IcoWipe />}
          confirmLabel="Delete data" confirmVariant="amber"
          onConfirm={() => { void handleDeleteData() }}
          onCancel={() => !busy && setDataTarget(null)}
          busy={busy}
        />
      )}
      {deleteTarget && (
        <Modal
          title="Delete account?"
          desc={<>This will permanently remove <strong style={{ color: 'var(--text)' }}>{displayName(deleteTarget)}</strong>'s account and all their data. This cannot be undone.</>}
          icon={<IcoTrash />}
          confirmLabel="Delete account" confirmVariant="red"
          onConfirm={() => { void handleDelete() }}
          onCancel={() => !busy && setDelTarget(null)}
          busy={busy}
        />
      )}
      {pwTarget && (
        <Modal
          title="Change password"
          icon={<IcoKey />}
          confirmLabel="Update password" confirmVariant="accent"
          onConfirm={() => { void handleChangePw() }}
          onCancel={() => { if (!busy) { setPwTarget(null); setNewPw('') } }}
          busy={busy}
        >
          <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text3)', marginBottom: 16 }}>{pwTarget.email}</div>
          <label style={{ display: 'block', fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 6 }}>
            New password
          </label>
          <input
            type="password" value={newPw} autoFocus
            onChange={(e) => setNewPw(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleChangePw() }}
            placeholder="Minimum 6 characters"
            style={{ width: '100%', padding: '9px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 13, outline: 'none', boxSizing: 'border-box', marginBottom: 20 }}
          />
        </Modal>
      )}
      {phoneTarget && (
        <Modal
          title="Edit phone number"
          icon={<IcoPhone />}
          confirmLabel="Save phone" confirmVariant="accent"
          onConfirm={() => { void handleEditPhone() }}
          onCancel={() => { if (!busy) { setPhoneTarget(null); setNewPhone('') } }}
          busy={busy}
        >
          <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text3)', marginBottom: 16 }}>{phoneTarget.email}</div>
          <label style={{ display: 'block', fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 6 }}>
            Phone number (with country code)
          </label>
          <input
            type="tel" value={newPhone} autoFocus
            onChange={(e) => setNewPhone(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleEditPhone() }}
            placeholder="+37491234567"
            style={{ width: '100%', padding: '9px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 13, outline: 'none', boxSizing: 'border-box', marginBottom: 4 }}
          />
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', marginBottom: 20 }}>Leave blank to remove phone number.</div>
        </Modal>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: toast.ok ? 'var(--text)' : 'var(--red, #dc2626)', color: '#fff', fontFamily: 'var(--mono)', fontSize: 12, padding: '9px 18px', borderRadius: 24, boxShadow: '0 4px 20px rgba(0,0,0,.2)', zIndex: 2000, whiteSpace: 'nowrap' }}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}

// ── Small helpers ──────────────────────────────────────────────────
function Spinner() {
  return (
    <div style={{ width: 16, height: 16, border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin .65s linear infinite' }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

function HeaderBtn({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  const [hov, setHov] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 6, background: hov ? 'var(--surface2)' : 'none', border: '1px solid var(--border)', borderColor: 'transparent', color: hov ? 'var(--text2)' : 'var(--text3)', fontFamily: 'var(--mono)', fontSize: 11, padding: '5px 10px', borderRadius: 6, cursor: 'pointer', transition: 'all .14s', whiteSpace: 'nowrap' }}
    >
      {children}
    </button>
  )
}

function MobileActionBtn({ variant, onClick, children }: { variant: 'pw' | 'wipe' | 'del'; onClick: () => void; children: ReactNode }) {
  const [hov, setHov] = useState(false)
  const v = {
    pw:   { color: hov ? 'var(--text)' : 'var(--text2)',  border: 'var(--border)',        bg: hov ? 'var(--surface2)' : 'transparent' },
    wipe: { color: 'var(--amber, #d97706)',                border: 'var(--amber-border, #fcd34d)', bg: hov ? 'var(--amber-dim, #fef3c7)' : 'transparent' },
    del:  { color: 'var(--red, #dc2626)',                  border: 'var(--red-border, #fca5a5)',   bg: hov ? 'var(--red-dim, #fee2e2)' : 'transparent' },
  }[variant]
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px 4px', borderRadius: 7, fontSize: 12, fontWeight: 500, border: `1px solid ${v.border}`, background: v.bg, color: v.color, cursor: 'pointer', transition: 'all .12s', whiteSpace: 'nowrap' }}
    >
      {children}
    </button>
  )
}

function TableRow({ u, isLast, onPw, onData, onDel, onPhone }: { u: AdminUser; isLast: boolean; onPw: () => void; onData: () => void; onDel: () => void; onPhone: () => void }) {
  const [hov, setHov] = useState(false)
  return (
    <tr
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{ borderBottom: isLast ? 'none' : '1px solid rgba(222,225,237,.7)', background: hov ? 'var(--surface2)' : 'transparent', transition: 'background .1s' }}
    >
      <td style={{ padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Avatar u={u} />
          <div>
            <div style={{ fontWeight: 500, fontSize: 13, color: 'var(--text)', lineHeight: 1.3 }}>{displayName(u)}</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)', marginTop: 2, wordBreak: 'break-all' }}>{u.email}</div>
            {u.phone && <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>{u.phone}</div>}
          </div>
        </div>
      </td>
      <td style={{ padding: '14px 16px' }}><RoleBadge u={u} /></td>
      <td style={{ padding: '14px 16px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {[{ n: u.devCount, l: 'devs' }, { n: u.projectCount, l: 'projects' }].map(({ n, l }) => (
            <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--mono)', fontSize: 11, whiteSpace: 'nowrap' }}>
              <span style={{ fontWeight: 600, color: n > 0 ? 'var(--text)' : 'var(--text4, #b5bbce)', minWidth: 16 }}>{n}</span>
              <span style={{ color: 'var(--text3)' }}>{l}</span>
            </div>
          ))}
        </div>
      </td>
      <td style={{ padding: '14px 16px' }}>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <ConnPill on={u.jiraConnected}   cls="jira" label="Jira" />
          <ConnPill on={u.gitlabConnected} cls="gl"   label="GitLab" />
          <ConnPill on={u.githubConnected} cls="gh"   label="GitHub" />
        </div>
      </td>
      <td style={{ padding: '14px 16px' }}>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <ActionBtn variant="pw"   onClick={onPhone}><IcoPhone /> Phone   </ActionBtn>
          <ActionBtn variant="pw"   onClick={onPw}>  <IcoKey />   Password</ActionBtn>
          <ActionBtn variant="wipe" onClick={onData}><IcoWipe />  Data    </ActionBtn>
          <ActionBtn variant="del"  onClick={onDel}> <IcoTrash /> Delete  </ActionBtn>
        </div>
      </td>
    </tr>
  )
}
