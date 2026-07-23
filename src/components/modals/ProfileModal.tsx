import { useState } from 'react'
import { getUserInfo, fetchAndStoreUserInfo } from '../../utils/auth'
import { updateMyProfile, changeMyPassword } from '../../utils/cloud-api'
import Modal from '../ui/Modal'

interface Props { onClose: () => void }

const COUNTRY_CODES = [
  { code: '+374', label: '🇦🇲 +374' },
  { code: '+994', label: '🇦🇿 +994' },
  { code: '+375', label: '🇧🇾 +375' },
  { code: '+32',  label: '🇧🇪 +32'  },
  { code: '+86',  label: '🇨🇳 +86'  },
  { code: '+420', label: '🇨🇿 +420' },
  { code: '+33',  label: '🇫🇷 +33'  },
  { code: '+995', label: '🇬🇪 +995' },
  { code: '+49',  label: '🇩🇪 +49'  },
  { code: '+30',  label: '🇬🇷 +30'  },
  { code: '+91',  label: '🇮🇳 +91'  },
  { code: '+972', label: '🇮🇱 +972' },
  { code: '+39',  label: '🇮🇹 +39'  },
  { code: '+81',  label: '🇯🇵 +81'  },
  { code: '+7',   label: '🇰🇿 +7 KZ' },
  { code: '+31',  label: '🇳🇱 +31'  },
  { code: '+47',  label: '🇳🇴 +47'  },
  { code: '+48',  label: '🇵🇱 +48'  },
  { code: '+351', label: '🇵🇹 +351' },
  { code: '+7',   label: '🇷🇺 +7 RU' },
  { code: '+966', label: '🇸🇦 +966' },
  { code: '+34',  label: '🇪🇸 +34'  },
  { code: '+46',  label: '🇸🇪 +46'  },
  { code: '+41',  label: '🇨🇭 +41'  },
  { code: '+90',  label: '🇹🇷 +90'  },
  { code: '+971', label: '🇦🇪 +971' },
  { code: '+44',  label: '🇬🇧 +44'  },
  { code: '+380', label: '🇺🇦 +380' },
  { code: '+1',   label: '🇺🇸 +1'   },
]

function parsePhone(phone: string | null | undefined): { code: string; local: string } {
  if (!phone) return { code: '+374', local: '' }
  const sorted = [...COUNTRY_CODES]
    .filter((v, i, a) => a.findIndex(x => x.code === v.code) === i)
    .sort((a, b) => b.code.length - a.code.length)
  for (const { code } of sorted) {
    if (phone.startsWith(code)) return { code, local: phone.slice(code.length) }
  }
  return { code: '+374', local: phone.startsWith('+') ? phone.slice(1) : phone }
}

function isValidPhone(code: string, local: string): boolean {
  const digits = local.replace(/\D/g, '')
  return /^\+[1-9]\d{6,14}$/.test(code + digits)
}

export default function ProfileModal({ onClose }: Props) {
  const user = getUserInfo()
  const parsed = parsePhone(user?.phone)

  const [countryCode, setCountryCode] = useState(parsed.code)
  const [localNumber, setLocalNumber] = useState(parsed.local)
  const [phoneSaving, setPhoneSaving] = useState(false)
  const [phoneMsg, setPhoneMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const handlePhoneSave = async () => {
    setPhoneMsg(null)
    const trimmed = localNumber.trim()
    if (trimmed && !isValidPhone(countryCode, trimmed)) {
      setPhoneMsg({ ok: false, text: 'Enter a valid phone number for the selected country code.' })
      return
    }
    setPhoneSaving(true)
    const normalized = trimmed ? countryCode + trimmed.replace(/\D/g, '') : null
    const ok = await updateMyProfile(normalized)
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
        <div style={{ display: 'flex', gap: 6 }}>
          <select
            value={countryCode}
            onChange={(e) => setCountryCode(e.target.value)}
            style={{ ...fieldStyle, width: 112, flexShrink: 0, cursor: 'pointer' }}
          >
            {COUNTRY_CODES.map((c, i) => (
              <option key={i} value={c.code}>{c.label}</option>
            ))}
          </select>
          <input
            style={{ ...fieldStyle, flex: 1 }}
            type="tel"
            value={localNumber}
            onChange={(e) => setLocalNumber(e.target.value)}
            placeholder="XX XXX XXXX"
            onKeyDown={(e) => e.key === 'Enter' && handlePhoneSave()}
          />
        </div>
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
