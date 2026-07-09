import { useEffect, useRef, useState } from 'react'
import { apiGoogleLogin, apiLogin, apiRegister, setToken } from '../../utils/auth'

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (cfg: {
            client_id: string
            callback: (r: { credential: string }) => void
          }) => void
          renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void
        }
      }
    }
  }
}

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''

const Logo = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width={44} height={44}>
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

interface Props { onAuth: () => void }

export default function LoginPage({ onAuth }: Props) {
  const [tab, setTab] = useState<'login' | 'register'>('login')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const googleBtnRef = useRef<HTMLDivElement>(null)

  const initGoogle = () => {
    if (!GOOGLE_CLIENT_ID || !window.google || !googleBtnRef.current) return
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: async (response) => {
        setLoading(true)
        setError(null)
        try {
          const token = await apiGoogleLogin(response.credential)
          setToken(token)
          onAuth()
        } catch (err) {
          setError((err as Error).message)
          setLoading(false)
        }
      },
    })
    window.google.accounts.id.renderButton(googleBtnRef.current, {
      theme: 'outline',
      size: 'large',
      type: 'standard',
      shape: 'rectangular',
      text: 'signin_with',
      width: 340,
    })
  }

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return
    if (window.google) {
      initGoogle()
      return
    }
    const script = document.querySelector('script[src*="accounts.google.com"]')
    if (script) {
      script.addEventListener('load', initGoogle)
      return () => script.removeEventListener('load', initGoogle)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Re-render google button when tab changes
  useEffect(() => {
    if (window.google && googleBtnRef.current && GOOGLE_CLIENT_ID) {
      window.google.accounts.id.renderButton(googleBtnRef.current, {
        theme: 'outline',
        size: 'large',
        type: 'standard',
        shape: 'rectangular',
        text: 'signin_with',
        width: 340,
      })
    }
  }, [tab])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      let token: string
      if (tab === 'login') {
        token = await apiLogin(email.trim(), password)
      } else {
        if (!firstName.trim() || !lastName.trim()) {
          setError('First and last name are required')
          setLoading(false)
          return
        }
        token = await apiRegister(firstName.trim(), lastName.trim(), email.trim(), password)
      }
      setToken(token)
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
    transition: 'border-color .15s',
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)', padding: 20,
    }}>
      <div style={{
        width: '100%', maxWidth: 380,
        background: 'var(--surface)',
        borderRadius: 16, padding: '36px 32px 32px',
        boxShadow: 'var(--shadow-xl)',
        border: '1px solid var(--border)',
      }}>

        {/* Logo + Title */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, marginBottom: 28 }}>
          <Logo />
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', letterSpacing: '-.4px', fontFamily: 'var(--sans)' }}>
              ProgressOr
            </div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 3, fontFamily: 'var(--mono)' }}>
              {tab === 'login' ? 'Sign in to your workspace' : 'Create a new workspace'}
            </div>
          </div>
        </div>

        {/* Tab switcher */}
        <div style={{ display: 'flex', background: 'var(--surface2)', borderRadius: 8, padding: 3, marginBottom: 24, gap: 2 }}>
          {(['login', 'register'] as const).map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); setError(null) }}
              style={{
                flex: 1, padding: '7px 0', borderRadius: 6, border: 'none',
                background: tab === t ? 'var(--surface)' : 'transparent',
                color: tab === t ? 'var(--text)' : 'var(--text3)',
                fontFamily: 'var(--sans)', fontSize: 13, fontWeight: tab === t ? 600 : 400,
                cursor: 'pointer', transition: 'all .15s',
                boxShadow: tab === t ? 'var(--shadow-xs)' : 'none',
              }}
            >
              {t === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {tab === 'register' && (
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 500, display: 'block', marginBottom: 4 }}>First name</label>
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
                <label style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 500, display: 'block', marginBottom: 4 }}>Last name</label>
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
          )}

          <div>
            <label style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 500, display: 'block', marginBottom: 4 }}>Email</label>
            <input
              style={inputStyle}
              type="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </div>

          <div>
            <label style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 500, display: 'block', marginBottom: 4 }}>Password</label>
            <div style={{ position: 'relative' }}>
              <input
                style={{ ...inputStyle, paddingRight: 36 }}
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
                  position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 13, padding: 2,
                }}
              >
                {showPw ? '🙈' : '👁'}
              </button>
            </div>
          </div>

          {error && (
            <div style={{
              padding: '9px 12px', borderRadius: 8, fontSize: 12,
              background: 'var(--red-dim)', color: 'var(--red)',
              border: '1px solid var(--red-border)', fontFamily: 'var(--mono)',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: '11px 0', borderRadius: 8, border: 'none',
              background: loading ? 'var(--accent-dim)' : 'var(--accent)',
              color: loading ? 'var(--accent)' : '#fff',
              fontFamily: 'var(--sans)', fontSize: 14, fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'background .15s', marginTop: 4,
            }}
          >
            {loading ? '…' : tab === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        {GOOGLE_CLIENT_ID && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '20px 0' }}>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)', whiteSpace: 'nowrap' }}>or continue with</span>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            </div>
            <div ref={googleBtnRef} style={{ display: 'flex', justifyContent: 'center' }} />
          </>
        )}
      </div>
    </div>
  )
}
