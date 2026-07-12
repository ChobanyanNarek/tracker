import { useState } from 'react'
import { getUserInfo, fetchAndStoreUserInfo } from '../../utils/auth'
import { updateMyProfile, changeMyPassword } from '../../utils/cloud-api'
import Modal from '../ui/Modal'

interface Props { onClose: () => void }

export default function ProfileModal({ onClose }: Props) {
  const user = getUserInfo()

  const [phone, setPhone] = useState(user?.phone ?? '')
  const [phoneSaving, setPhoneSaving] = useState(false)
  const [phoneMsg, setPhoneMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const handlePhoneSave = async () => {
    setPhoneSaving(true)
    setPhoneMsg(null)
    const trimmed = phone.trim() || null
    const ok = await updateMyProfile(trimmed)
    if (ok) {
      await fetchAndStoreUserInfo()
      setPhoneMsg({ ok: true, text: 'Phone updated.' })
    } else {
      setPhoneMsg({ ok: false, text: 'Failed to update phone.' })
    }
    setPhoneSaving(false)
  }

  const handlePasswordChange = async () => {
    if (!currentPw || !newPw) return
    if (newPw !== confirmPw) {
      setPwMsg({ ok: false, text: 'New passwords do not match.' })
      return
    }
    if (newPw.length < 6) {
      setPwMsg({ ok: false, text: 'New password must be at least 6 characters.' })
      return
    }
    setPwSaving(true)
    setPwMsg(null)
    const result = await changeMyPassword(currentPw, newPw)
    if (result.ok) {
      setPwMsg({ ok: true, text: 'Password changed successfully.' })
      setCurrentPw(''); setNewPw(''); setConfirmPw('')
    } else {
      const knownErrors: Record<string, string> = {
        'error.invalidCurrentPassword': 'Current password is incorrect.',
      }
      setPwMsg({ ok: false, text: knownErrors[result.error ?? ''] ?? 'Failed to change password.' })
    }
    setPwSaving(false)
  }

  const fieldStyle: React.CSSProperties = {
    width: '100%', padding: '7px 10px', border: '1px solid var(--border)',
    borderRadius: 7, fontSize: 13, background: 'var(--surface2)',
    color: 'var(--text)', fontFamily: 'var(--sans)', outline: 'none',
    boxSizing: 'border-box',
  }
  const labelStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 600, color: 'var(--text3)',
    letterSpacing: '.6px', textTransform: 'uppercase', marginBottom: 4, display: 'block',
  }
  const msgStyle = (ok: boolean): React.CSSProperties => ({
    fontSize: 12, color: ok ? 'var(--green, #16a34a)' : 'var(--red)', marginTop: 6,
  })

  return (
    <Modal
      title="Profile Settings"
      width={420}
      zIndex={900}
      onClose={onClose}
      bodyStyle={{ padding: '20px 20px 4px' }}
      footer={<button className="btn-secondary" onClick={onClose}>Close</button>}
    >
      {/* User info */}
      <div style={{ marginBottom: 20, padding: '10px 14px', background: 'var(--surface2)', borderRadius: 8, border: '1px solid var(--border)' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
          {[user?.firstName, user?.lastName].filter(Boolean).join(' ') || 'User'}
        </div>
        {user?.email && (
          <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)', marginTop: 2 }}>{user.email}</div>
        )}
      </div>

      {/* Phone section */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '.7px' }}>Phone Number</div>
        <label style={labelStyle}>Phone</label>
        <input
          style={fieldStyle}
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+374 XX XXX XXX"
          onKeyDown={(e) => e.key === 'Enter' && handlePhoneSave()}
        />
        {phoneMsg && <div style={msgStyle(phoneMsg.ok)}>{phoneMsg.text}</div>}
        <button
          onClick={handlePhoneSave}
          disabled={phoneSaving}
          style={{ marginTop: 8, padding: '6px 16px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: phoneSaving ? 'not-allowed' : 'pointer', opacity: phoneSaving ? .7 : 1 }}
        >
          {phoneSaving ? 'Saving…' : 'Save Phone'}
        </button>
      </div>

      <div style={{ height: 1, background: 'var(--border)', margin: '0 0 20px' }} />

      {/* Password section */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '.7px' }}>Change Password</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div>
            <label style={labelStyle}>Current Password</label>
            <input style={fieldStyle} type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} placeholder="••••••••" />
          </div>
          <div>
            <label style={labelStyle}>New Password</label>
            <input style={fieldStyle} type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="Min. 6 characters" />
          </div>
          <div>
            <label style={labelStyle}>Confirm New Password</label>
            <input style={fieldStyle} type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} placeholder="Repeat new password" onKeyDown={(e) => e.key === 'Enter' && handlePasswordChange()} />
          </div>
        </div>
        {pwMsg && <div style={msgStyle(pwMsg.ok)}>{pwMsg.text}</div>}
        <button
          onClick={handlePasswordChange}
          disabled={pwSaving || !currentPw || !newPw || !confirmPw}
          style={{ marginTop: 10, padding: '6px 16px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: (pwSaving || !currentPw || !newPw || !confirmPw) ? 'not-allowed' : 'pointer', opacity: (pwSaving || !currentPw || !newPw || !confirmPw) ? .6 : 1 }}
        >
          {pwSaving ? 'Changing…' : 'Change Password'}
        </button>
      </div>
    </Modal>
  )
}
