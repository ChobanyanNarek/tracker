import { useState, useEffect } from 'react'
import { clearToken, getUserInfo } from '../../utils/auth'
import { initiatePayment, getSubscriptionStatus } from '../../utils/payment-api'

interface Props {
  onSubscribed: () => void
}

export default function PaywallScreen({ onSubscribed }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const user = getUserInfo()

  // Poll for subscription activation when user returns from payment page
  useEffect(() => {
    const handleFocus = () => { void checkSubscription() }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [])

  // Also check URL params — Ameriabank redirects back with orderID & paymentID
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const orderId = params.get('orderID')
    const paymentId = params.get('paymentID')
    if (orderId && paymentId) {
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname)
      void checkSubscription()
    }
  }, [])

  async function checkSubscription() {
    setChecking(true)
    const status = await getSubscriptionStatus()
    setChecking(false)
    if (status?.subscriptionActive) {
      onSubscribed()
    }
  }

  async function handleSubscribe() {
    setError(null)
    setLoading(true)
    try {
      const result = await initiatePayment('monthly')
      window.location.href = result.paymentUrl
    } catch (e) {
      setError((e as Error).message)
      setLoading(false)
    }
  }

  const handleSignOut = () => {
    clearToken()
    window.location.reload()
  }

  const displayName = user ? [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email : null

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)', padding: 20, fontFamily: 'var(--sans)',
    }}>
      <div style={{
        width: '100%', maxWidth: 440,
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 20, padding: '44px 40px 36px',
        boxShadow: '0 24px 72px rgba(25,35,90,.14)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0,
      }}>
        {/* Logo */}
        <img src="/logo-wordmark.gif" alt="ProgressOr" width={186} height={36} style={{ display: 'block', marginBottom: 28 }} />

        {/* Icon */}
        <div style={{
          width: 56, height: 56, borderRadius: 14, marginBottom: 20,
          background: 'var(--accent-dim)', color: 'var(--accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>

        <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', letterSpacing: '-.4px', marginBottom: 10, textAlign: 'center' }}>
          Subscription Required
        </div>
        <div style={{ fontSize: 13, color: 'var(--text3)', lineHeight: 1.65, textAlign: 'center', maxWidth: 340, marginBottom: 32 }}>
          {displayName ? `Hi ${displayName.split(' ')[0]}, your` : 'Your'} access requires an active subscription. Subscribe to continue using ProgressOr.
        </div>

        {/* Pricing card */}
        <div style={{
          width: '100%', background: 'var(--surface2)', border: '1.5px solid var(--accent-border, #bac4f8)',
          borderRadius: 14, padding: '20px 24px', marginBottom: 24,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Monthly Plan</div>
            <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>Full access · cancel anytime</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--accent)', letterSpacing: '-.5px', lineHeight: 1 }}>
              10 <span style={{ fontSize: 14, fontWeight: 600 }}>AMD</span>
            </div>
            <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)', marginTop: 3 }}>per month</div>
          </div>
        </div>

        {/* Features */}
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 28 }}>
          {[
            'Unlimited projects & tasks',
            'Jira, GitHub, GitLab integrations',
            'Sprint planning & timeline views',
            'Cloud sync across devices',
          ].map((f) => (
            <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--text2)' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              {f}
            </div>
          ))}
        </div>

        {error && (
          <div style={{
            width: '100%', padding: '10px 13px', borderRadius: 9, fontSize: 12, marginBottom: 14,
            background: 'var(--red-dim)', color: 'var(--red)', border: '1px solid var(--red-border)', fontWeight: 500,
          }}>
            {error}
          </div>
        )}

        <button
          onClick={handleSubscribe}
          disabled={loading || checking}
          style={{
            width: '100%', padding: '14px 0', borderRadius: 11, border: 'none',
            background: (loading || checking) ? 'var(--accent-dim)' : 'var(--accent)',
            color: (loading || checking) ? 'var(--accent)' : '#fff',
            fontSize: 15, fontWeight: 700, cursor: (loading || checking) ? 'not-allowed' : 'pointer',
            transition: 'all .15s', letterSpacing: '-.1px', marginBottom: 12,
            boxShadow: (loading || checking) ? 'none' : '0 4px 16px rgba(59,91,219,.3)',
          }}
        >
          {loading ? 'Redirecting to payment…' : checking ? 'Checking status…' : 'Subscribe — 10 AMD / month'}
        </button>

        <button
          onClick={() => { void checkSubscription() }}
          disabled={checking}
          style={{
            width: '100%', padding: '10px 0', borderRadius: 9, border: '1px solid var(--border)',
            background: 'none', color: 'var(--text3)', fontSize: 13, fontWeight: 500,
            cursor: checking ? 'not-allowed' : 'pointer', transition: 'all .15s', marginBottom: 20,
          }}
        >
          {checking ? 'Checking…' : 'I already paid — check status'}
        </button>

        <div style={{ height: 1, width: '100%', background: 'var(--border)', marginBottom: 16 }} />

        <button
          onClick={handleSignOut}
          style={{
            background: 'none', border: 'none', color: 'var(--text4)', fontSize: 12,
            cursor: 'pointer', fontFamily: 'var(--sans)',
          }}
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
