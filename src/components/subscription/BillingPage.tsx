import { useEffect, useState, useCallback } from 'react'
import { getUserInfo } from '../../utils/auth'
import {
  getSubscriptionStatus,
  getPaymentHistory,
  initiatePayment,
  refundPayment,
  type PaymentStatus,
  type PaymentRecord,
} from '../../utils/payment-api'

interface Props {
  onClose: () => void
}

function fmt(date: string | null | undefined) {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function statusChip(status: string) {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    completed: { label: 'Paid', color: '#22c55e', bg: 'rgba(34,197,94,.12)' },
    pending:   { label: 'Pending', color: '#f59e0b', bg: 'rgba(245,158,11,.12)' },
    failed:    { label: 'Failed', color: 'var(--red)', bg: 'var(--red-dim)' },
    refunded:  { label: 'Refunded', color: '#8b5cf6', bg: 'rgba(139,92,246,.12)' },
  }
  const s = map[status.toLowerCase()] ?? { label: status, color: 'var(--text3)', bg: 'var(--surface3)' }
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: s.bg, color: s.color, fontFamily: 'var(--sans)', letterSpacing: '.2px' }}>
      {s.label}
    </span>
  )
}

function maskCard(card: string | null) {
  if (!card) return '—'
  const clean = card.replace(/\s/g, '')
  return clean.length >= 4 ? `•••• ${clean.slice(-4)}` : card
}

export default function BillingPage({ onClose }: Props) {
  const user = getUserInfo()
  const [status, setStatus] = useState<PaymentStatus | null>(null)
  const [history, setHistory] = useState<PaymentRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [subscribing, setSubscribing] = useState(false)
  const [refunding, setRefunding] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refundConfirm, setRefundConfirm] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    const [s, h] = await Promise.all([getSubscriptionStatus(), getPaymentHistory()])
    setStatus(s)
    setHistory(h)
    setLoading(false)
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  async function handleSubscribe() {
    setError(null)
    setSubscribing(true)
    try {
      const result = await initiatePayment('monthly')
      window.location.href = result.paymentUrl
    } catch (e) {
      setError((e as Error).message)
      setSubscribing(false)
    }
  }

  async function handleRefund(paymentId: string) {
    setRefunding(paymentId)
    setError(null)
    try {
      const res = await refundPayment(paymentId)
      if (!res.ok) {
        setError(res.message ?? 'Refund failed')
      } else {
        await refresh()
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRefunding(null)
      setRefundConfirm(null)
    }
  }

  const active = status?.subscriptionActive ?? false
  const displayName = user ? ([user.firstName, user.lastName].filter(Boolean).join(' ') || user.email || 'Account') : 'Account'

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.5)', backdropFilter: 'blur(4px)' }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 18, width: '100%', maxWidth: 560, maxHeight: '90vh', overflow: 'auto', boxShadow: 'var(--shadow-xl)', fontFamily: 'var(--sans)' }}>

        {/* Header */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', letterSpacing: '-.2px' }}>Account & Billing</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2, fontFamily: 'var(--mono)' }}>{user?.email}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 20, lineHeight: 1, padding: 4, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 24 }}>

          {/* Account info */}
          <section>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text4)', textTransform: 'uppercase', letterSpacing: '.8px', marginBottom: 10 }}>Account</div>
            <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 16, letterSpacing: '-.2px', flexShrink: 0 }}>
                {displayName.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{displayName}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', fontFamily: 'var(--mono)', marginTop: 2 }}>{user?.email}</div>
              </div>
            </div>
          </section>

          {/* Subscription status */}
          <section>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text4)', textTransform: 'uppercase', letterSpacing: '.8px', marginBottom: 10 }}>Subscription</div>
            {loading ? (
              <div style={{ color: 'var(--text3)', fontSize: 13 }}>Loading…</div>
            ) : (
              <div style={{ background: active ? 'rgba(34,197,94,.07)' : 'var(--surface2)', border: `1px solid ${active ? 'rgba(34,197,94,.25)' : 'var(--border)'}`, borderRadius: 12, padding: '16px 18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: active ? '#22c55e' : 'var(--text3)' }}>
                      {active ? 'Active' : 'No active subscription'}
                    </div>
                    {active && status?.subscriptionUntil && (
                      <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>
                        Renews / expires: <strong>{fmt(status.subscriptionUntil)}</strong>
                      </div>
                    )}
                  </div>
                  {!active && (
                    <button
                      onClick={() => { void handleSubscribe() }}
                      disabled={subscribing}
                      style={{ padding: '8px 18px', borderRadius: 9, background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--sans)', fontWeight: 600, fontSize: 13, opacity: subscribing ? 0.6 : 1 }}
                    >
                      {subscribing ? 'Redirecting…' : 'Subscribe — 100 AMD/mo'}
                    </button>
                  )}
                </div>
              </div>
            )}
          </section>

          {error && (
            <div style={{ background: 'var(--red-dim)', border: '1px solid var(--red-border)', borderRadius: 10, padding: '10px 14px', color: 'var(--red)', fontSize: 13 }}>
              {error}
            </div>
          )}

          {/* Payment history */}
          <section>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text4)', textTransform: 'uppercase', letterSpacing: '.8px', marginBottom: 10 }}>Payment History</div>
            {loading ? (
              <div style={{ color: 'var(--text3)', fontSize: 13 }}>Loading…</div>
            ) : history.length === 0 ? (
              <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px 18px', color: 'var(--text3)', fontSize: 13, textAlign: 'center' }}>
                No payment records
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {history.map((p) => (
                  <div key={p.id} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 12, padding: '13px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--mono)' }}>
                          {Number(p.amount).toLocaleString()} {p.currency}
                        </span>
                        {statusChip(p.status)}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4, display: 'flex', gap: 12, fontFamily: 'var(--mono)', flexWrap: 'wrap' }}>
                        <span>{fmt(p.completedAt ?? p.createdAt)}</span>
                        {p.cardNumber && <span>{maskCard(p.cardNumber)}</span>}
                        <span style={{ opacity: 0.5 }}>#{String(p.orderId).slice(-6)}</span>
                      </div>
                    </div>

                    {p.status.toLowerCase() === 'completed' && (
                      refundConfirm === p.paymentId ? (
                        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                          <button
                            onClick={() => { if (p.paymentId) void handleRefund(p.paymentId) }}
                            disabled={refunding === p.paymentId}
                            style={{ padding: '5px 12px', borderRadius: 7, background: 'var(--red)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, opacity: refunding === p.paymentId ? 0.6 : 1 }}
                          >
                            {refunding === p.paymentId ? '…' : 'Yes, refund'}
                          </button>
                          <button
                            onClick={() => setRefundConfirm(null)}
                            style={{ padding: '5px 10px', borderRadius: 7, background: 'var(--surface3)', color: 'var(--text2)', border: '1px solid var(--border)', cursor: 'pointer', fontSize: 12 }}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setRefundConfirm(p.paymentId)}
                          style={{ padding: '5px 12px', borderRadius: 7, background: 'var(--surface3)', color: 'var(--text2)', border: '1px solid var(--border)', cursor: 'pointer', fontSize: 12, fontWeight: 500, flexShrink: 0 }}
                        >
                          Refund
                        </button>
                      )
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

        </div>
      </div>
    </div>
  )
}
