import { useEffect, useRef, useState } from 'react'
import { apiLogin, apiRegister, apiSendRegistrationCode, fetchAndStoreUserInfo, setToken } from '../../utils/auth'

interface Country { flag: string; name: string; code: string }

const COUNTRIES: Country[] = [
  { flag: '🇺🇸', name: 'United States', code: '+1' },
  { flag: '🇨🇦', name: 'Canada', code: '+1' },
  { flag: '🇬🇧', name: 'United Kingdom', code: '+44' },
  { flag: '🇩🇪', name: 'Germany', code: '+49' },
  { flag: '🇫🇷', name: 'France', code: '+33' },
  { flag: '🇮🇹', name: 'Italy', code: '+39' },
  { flag: '🇪🇸', name: 'Spain', code: '+34' },
  { flag: '🇷🇺', name: 'Russia', code: '+7' },
  { flag: '🇺🇦', name: 'Ukraine', code: '+380' },
  { flag: '🇵🇱', name: 'Poland', code: '+48' },
  { flag: '🇳🇱', name: 'Netherlands', code: '+31' },
  { flag: '🇨🇭', name: 'Switzerland', code: '+41' },
  { flag: '🇦🇹', name: 'Austria', code: '+43' },
  { flag: '🇸🇪', name: 'Sweden', code: '+46' },
  { flag: '🇳🇴', name: 'Norway', code: '+47' },
  { flag: '🇩🇰', name: 'Denmark', code: '+45' },
  { flag: '🇫🇮', name: 'Finland', code: '+358' },
  { flag: '🇨🇿', name: 'Czech Republic', code: '+420' },
  { flag: '🇷🇴', name: 'Romania', code: '+40' },
  { flag: '🇭🇺', name: 'Hungary', code: '+36' },
  { flag: '🇵🇹', name: 'Portugal', code: '+351' },
  { flag: '🇬🇷', name: 'Greece', code: '+30' },
  { flag: '🇦🇲', name: 'Armenia', code: '+374' },
  { flag: '🇬🇪', name: 'Georgia', code: '+995' },
  { flag: '🇦🇿', name: 'Azerbaijan', code: '+994' },
  { flag: '🇮🇳', name: 'India', code: '+91' },
  { flag: '🇨🇳', name: 'China', code: '+86' },
  { flag: '🇯🇵', name: 'Japan', code: '+81' },
  { flag: '🇰🇷', name: 'South Korea', code: '+82' },
  { flag: '🇦🇺', name: 'Australia', code: '+61' },
  { flag: '🇧🇷', name: 'Brazil', code: '+55' },
  { flag: '🇲🇽', name: 'Mexico', code: '+52' },
  { flag: '🇹🇷', name: 'Turkey', code: '+90' },
  { flag: '🇮🇱', name: 'Israel', code: '+972' },
  { flag: '🇸🇦', name: 'Saudi Arabia', code: '+966' },
]

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

const Logo = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width={44} height={44} style={{ animation: 'spin 2s linear infinite' }}>
    <path fillRule="evenodd" fill="#171a2d"
      d="M24,3 A21,21 0 1,0 24,45 A21,21 0 1,0 24,3 Z M24,9 A15,15 0 1,0 24,39 A15,15 0 1,0 24,9 Z" />
    <g stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round">
      <line x1="21" y1="7" x2="27" y2="5" />
      <line x1="21" y1="7" x2="27" y2="5" transform="rotate(60 24 24)" />
      <line x1="21" y1="7" x2="27" y2="5" transform="rotate(120 24 24)" />
      <line x1="21" y1="7" x2="27" y2="5" transform="rotate(180 24 24)" />
      <line x1="21" y1="7" x2="27" y2="5" transform="rotate(240 24 24)" />
      <line x1="21" y1="7" x2="27" y2="5" transform="rotate(300 24 24)" />
    </g>
  </svg>
)

const EyeIcon = ({ open }: { open: boolean }) => open ? (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
) : (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
    <line x1="1" y1="1" x2="23" y2="23"/>
  </svg>
)

interface Props { onAuth: () => void }

export default function LoginPage({ onAuth }: Props) {
  const [tab, setTab] = useState<'login' | 'register'>('login')

  // login
  const [credential, setCredential] = useState('')

  // register
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [phone, setPhone] = useState('')
  const [country, setCountry] = useState<Country>(COUNTRIES[0])
  const [showCountry, setShowCountry] = useState(false)
  const [countrySearch, setCountrySearch] = useState('')

  // email verification OTP
  const [codeSent, setCodeSent] = useState(false)
  const [codeSending, setCodeSending] = useState(false)
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState<string | null>(null)
  const [resendCooldown, setResendCooldown] = useState(0)

  // common
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const countryRef = useRef<HTMLDivElement>(null)

  const filteredCountries = COUNTRIES.filter(c =>
    countrySearch === '' ||
    c.name.toLowerCase().includes(countrySearch.toLowerCase()) ||
    c.code.includes(countrySearch)
  )

  useEffect(() => {
    if (!showCountry) return
    const handler = (e: MouseEvent) => {
      if (countryRef.current && !countryRef.current.contains(e.target as Node)) {
        setShowCountry(false)
        setCountrySearch('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showCountry])

  // Resend cooldown countdown
  useEffect(() => {
    if (resendCooldown <= 0) return
    const t = setTimeout(() => setResendCooldown(s => s - 1), 1000)
    return () => clearTimeout(t)
  }, [resendCooldown])

  const validateEmail = (val: string) => {
    if (!val.trim()) return 'Email is required'
    if (!EMAIL_RE.test(val.trim())) return 'Enter a valid email address'
    return null
  }

  async function handleSendCode() {
    const err = validateEmail(email)
    if (err) { setEmailError(err); return }
    setCodeError(null)
    setCodeSending(true)
    try {
      await apiSendRegistrationCode(email.trim())
      setCodeSent(true)
      setResendCooldown(60)
    } catch (e) {
      setCodeError((e as Error).message)
    } finally {
      setCodeSending(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (tab === 'register') {
      const err = validateEmail(email)
      if (err) { setEmailError(err); return }
      if (!codeSent) { setCodeError('Please verify your email first.'); return }
      if (!code.trim()) { setCodeError('Enter the verification code.'); return }
    }

    setLoading(true)
    try {
      let token: string
      if (tab === 'login') {
        token = await apiLogin(credential.trim(), password)
      } else {
        const fullPhone = phone.trim() ? `${country.code}${phone.trim()}` : undefined
        token = await apiRegister(firstName.trim(), lastName.trim(), email.trim(), password, code.trim(), fullPhone)
      }
      setToken(token)
      await fetchAndStoreUserInfo()
      onAuth()
    } catch (err) {
      setError((err as Error).message)
      setLoading(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 12px',
    border: '1.5px solid var(--border)', borderRadius: 8,
    background: 'var(--surface2)', color: 'var(--text)',
    fontSize: 14, fontFamily: 'var(--sans)', outline: 'none',
    transition: 'border-color .15s', boxSizing: 'border-box',
  }

  const inputErrStyle: React.CSSProperties = {
    ...inputStyle, borderColor: 'var(--red)',
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 11, color: 'var(--text3)', fontWeight: 600, display: 'block',
    marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.4px',
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)', padding: 20,
    }}>
      <div style={{
        width: '100%', maxWidth: 400,
        background: 'var(--surface)',
        borderRadius: 20, padding: '40px 36px 36px',
        boxShadow: 'var(--shadow-xl)',
        border: '1px solid var(--border)',
        maxHeight: '92vh', overflowY: 'auto',
      }}>

        {/* Logo + Title */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, marginBottom: 32 }}>
          <div style={{ background: 'var(--surface2)', borderRadius: 18, padding: 14, border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Logo />
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text)', letterSpacing: '-.5px', fontFamily: 'var(--sans)' }}>
              ProgressOr
            </div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4, fontFamily: 'var(--sans)', fontWeight: 500 }}>
              {tab === 'login' ? 'Sign in to your workspace' : 'Create a new workspace'}
            </div>
          </div>
        </div>

        {/* Tab switcher */}
        <div style={{ display: 'flex', background: 'var(--surface2)', borderRadius: 10, padding: 3, marginBottom: 26, gap: 2, border: '1px solid var(--border)' }}>
          {(['login', 'register'] as const).map((t) => (
            <button
              key={t}
              onClick={() => {
                setTab(t)
                setError(null)
                setEmailError(null)
                setCodeError(null)
                setCodeSent(false)
                setCode('')
                setResendCooldown(0)
              }}
              style={{
                flex: 1, padding: '8px 0', borderRadius: 8, border: 'none',
                background: tab === t ? 'var(--surface)' : 'transparent',
                color: tab === t ? 'var(--accent)' : 'var(--text3)',
                fontFamily: 'var(--sans)', fontSize: 13, fontWeight: tab === t ? 700 : 500,
                cursor: 'pointer', transition: 'all .15s',
                boxShadow: tab === t ? 'var(--shadow-sm)' : 'none',
              }}
            >
              {t === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* ── Register-only fields ── */}
          {tab === 'register' && (
            <>
              {/* First + Last name */}
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>First name</label>
                  <input
                    style={inputStyle}
                    placeholder="Alex"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    autoComplete="given-name"
                    required
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Last name</label>
                  <input
                    style={inputStyle}
                    placeholder="Smith"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    autoComplete="family-name"
                    required
                  />
                </div>
              </div>

              {/* Email with Send Code button */}
              <div>
                <label style={labelStyle}>Email</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    style={{ ...(emailError ? inputErrStyle : inputStyle), flex: 1 }}
                    type="text"
                    inputMode="email"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value)
                      if (emailError) setEmailError(null)
                      if (codeSent) { setCodeSent(false); setCode(''); setResendCooldown(0) }
                    }}
                    onBlur={() => setEmailError(validateEmail(email))}
                    autoComplete="email"
                    required
                  />
                  <button
                    type="button"
                    onClick={handleSendCode}
                    disabled={codeSending || resendCooldown > 0}
                    style={{
                      flexShrink: 0, padding: '0 12px', borderRadius: 8, border: '1.5px solid var(--accent)',
                      background: codeSent ? 'var(--accent-dim)' : 'var(--accent)',
                      color: codeSent ? 'var(--accent)' : '#fff',
                      fontFamily: 'var(--sans)', fontSize: 12, fontWeight: 600,
                      cursor: (codeSending || resendCooldown > 0) ? 'not-allowed' : 'pointer',
                      whiteSpace: 'nowrap', transition: 'all .15s', opacity: resendCooldown > 0 ? 0.6 : 1,
                    }}
                  >
                    {codeSending ? '…' : resendCooldown > 0 ? `${resendCooldown}s` : codeSent ? 'Resend' : 'Send code'}
                  </button>
                </div>
                {emailError && (
                  <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4, fontWeight: 500 }}>
                    {emailError}
                  </div>
                )}
              </div>

              {/* OTP field — shown once code is sent */}
              {codeSent && (
                <div>
                  <label style={labelStyle}>Verification code</label>
                  <input
                    style={codeError ? inputErrStyle : inputStyle}
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="6-digit code from your email"
                    value={code}
                    onChange={(e) => { setCode(e.target.value.replace(/\D/g, '')); setCodeError(null) }}
                    autoComplete="one-time-code"
                    required
                  />
                  {codeError && (
                    <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4, fontWeight: 500 }}>
                      {codeError}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 5, fontWeight: 500 }}>
                    A 6-digit code was sent to {email.trim()}. Expires in 15 minutes.
                  </div>
                </div>
              )}

              {/* Prompt to send code if not sent yet */}
              {!codeSent && codeError && (
                <div style={{ fontSize: 11, color: 'var(--red)', fontWeight: 500 }}>
                  {codeError}
                </div>
              )}

              {/* Phone with country code */}
              <div>
                <label style={labelStyle}>Phone number <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, opacity: .7 }}>(optional)</span></label>
                <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
                  {/* Country code selector */}
                  <div ref={countryRef} style={{ position: 'relative', flexShrink: 0 }}>
                    <button
                      type="button"
                      onClick={() => { setShowCountry(s => !s); setCountrySearch('') }}
                      style={{
                        height: '100%', minHeight: 40, padding: '0 8px',
                        border: '1.5px solid var(--border)', borderRadius: 8,
                        background: 'var(--surface2)', color: 'var(--text)',
                        fontSize: 13, fontFamily: 'var(--sans)', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
                      }}
                    >
                      <span style={{ fontSize: 17, lineHeight: 1 }}>{country.flag}</span>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{country.code}</span>
                      <span style={{ fontSize: 10, opacity: .6 }}>▾</span>
                    </button>

                    {showCountry && (
                      <div style={{
                        position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 100,
                        width: 220, maxHeight: 240, overflowY: 'auto',
                        background: 'var(--surface)', border: '1.5px solid var(--border)',
                        borderRadius: 10, boxShadow: 'var(--shadow-xl)',
                        display: 'flex', flexDirection: 'column',
                      }}>
                        <div style={{ padding: '8px 8px 4px', flexShrink: 0 }}>
                          <input
                            autoFocus
                            placeholder="Search country…"
                            value={countrySearch}
                            onChange={(e) => setCountrySearch(e.target.value)}
                            style={{
                              width: '100%', padding: '6px 8px', boxSizing: 'border-box',
                              border: '1.5px solid var(--border)', borderRadius: 6,
                              background: 'var(--surface2)', color: 'var(--text)',
                              fontSize: 12, fontFamily: 'var(--sans)', outline: 'none',
                            }}
                          />
                        </div>
                        <div style={{ overflowY: 'auto', flex: 1 }}>
                          {filteredCountries.map((c, i) => (
                            <button
                              key={`${c.code}-${i}`}
                              type="button"
                              onClick={() => { setCountry(c); setShowCountry(false); setCountrySearch('') }}
                              style={{
                                width: '100%', padding: '7px 10px', border: 'none',
                                background: country === c ? 'var(--accent-dim)' : 'transparent',
                                color: 'var(--text)', textAlign: 'left',
                                fontFamily: 'var(--sans)', fontSize: 12, cursor: 'pointer',
                                display: 'flex', alignItems: 'center', gap: 8,
                              }}
                            >
                              <span style={{ fontSize: 16 }}>{c.flag}</span>
                              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                              <span style={{ color: 'var(--text3)', fontWeight: 600, flexShrink: 0 }}>{c.code}</span>
                            </button>
                          ))}
                          {filteredCountries.length === 0 && (
                            <div style={{ padding: '12px 10px', fontSize: 12, color: 'var(--text3)', textAlign: 'center' }}>
                              No results
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Local number input */}
                  <input
                    style={{ ...inputStyle, flex: 1, minWidth: 0 }}
                    type="tel"
                    placeholder="91 234 567"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    autoComplete="tel-national"
                  />
                </div>
              </div>
            </>
          )}

          {/* ── Login-only: credential field ── */}
          {tab === 'login' && (
            <div>
              <label style={labelStyle}>Email or phone number</label>
              <input
                style={inputStyle}
                type="text"
                placeholder="you@company.com or +1234567890"
                value={credential}
                onChange={(e) => setCredential(e.target.value)}
                autoComplete="username"
                required
              />
            </div>
          )}

          {/* Password (common) */}
          <div>
            <label style={labelStyle}>Password</label>
            <div style={{ position: 'relative' }}>
              <input
                style={{ ...inputStyle, paddingRight: 40 }}
                type={showPw ? 'text' : 'password'}
                placeholder={tab === 'register' ? 'Min 6 characters' : '••••••••'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
                required
                minLength={6}
              />
              <button
                type="button"
                onClick={() => setShowPw((s) => !s)}
                style={{
                  position: 'absolute', right: 11, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', padding: 2,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <EyeIcon open={showPw} />
              </button>
            </div>
          </div>

          {error && (
            <div style={{
              padding: '10px 13px', borderRadius: 9, fontSize: 12,
              background: 'var(--red-dim)', color: 'var(--red)',
              border: '1px solid var(--red-border)', fontFamily: 'var(--sans)', fontWeight: 500,
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: '12px 0', borderRadius: 10, border: 'none',
              background: loading ? 'var(--accent-dim)' : 'var(--accent)',
              color: loading ? 'var(--accent)' : '#fff',
              fontFamily: 'var(--sans)', fontSize: 14, fontWeight: 700,
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'all .15s', marginTop: 2, letterSpacing: '-.1px',
              boxShadow: loading ? 'none' : '0 2px 12px rgba(59,91,219,.3)',
            }}
          >
            {loading ? '…' : tab === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>
      </div>
    </div>
  )
}
