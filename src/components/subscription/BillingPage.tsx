import { useEffect, useState, useCallback } from 'react'
import { jsPDF } from 'jspdf'
import { getUserInfo } from '../../utils/auth'
import {
  getSubscriptionStatus,
  getPaymentHistory,
  initiatePayment,
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

const LOGO_B64 = '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'

function downloadReceipt(p: PaymentRecord, userEmail: string | null | undefined, userName: string) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = 210
  const gray = '#6b7280'
  const dark = '#111827'

  // Header band
  doc.setFillColor(17, 24, 39)
  doc.rect(0, 0, W, 36, 'F')
  doc.addImage(LOGO_B64, 'PNG', 10, 7, 22, 22)
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.text('Progressor', 36, 15)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(180, 180, 180)
  doc.text('Payment Receipt', 36, 22)
  doc.text('progressor.work', 36, 28)

  // Receipt number + date top-right
  doc.setTextColor(180, 180, 180)
  doc.setFontSize(8)
  doc.text(`Receipt #${String(p.orderId).slice(-6).toUpperCase()}`, W - 14, 15, { align: 'right' })
  doc.text(fmt(p.completedAt ?? p.createdAt), W - 14, 21, { align: 'right' })

  // Status badge
  const statusLabel = p.status.charAt(0).toUpperCase() + p.status.slice(1).toLowerCase()
  doc.setFillColor(34, 197, 94)
  doc.roundedRect(W - 38, 26, 24, 6, 2, 2, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(7)
  doc.setFont('helvetica', 'bold')
  doc.text(statusLabel, W - 26, 30.2, { align: 'center' })

  // Bill To section
  let y = 52
  doc.setTextColor(gray)
  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  doc.text('BILL TO', 14, y)
  y += 6
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(dark)
  doc.setFontSize(10)
  doc.text(userName || 'Customer', 14, y)
  if (userEmail) { y += 5; doc.setFontSize(9); doc.setTextColor(gray); doc.text(userEmail, 14, y) }

  // Payment details table
  y += 14
  doc.setDrawColor(229, 231, 235)
  doc.setLineWidth(0.3)
  doc.line(14, y, W - 14, y)
  y += 8

  const row = (label: string, value: string) => {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(gray)
    doc.text(label, 14, y)
    doc.setTextColor(dark)
    doc.setFont('helvetica', 'bold')
    doc.text(value, W - 14, y, { align: 'right' })
    y += 7
  }

  row('Description', 'Progressor Monthly Subscription')
  row('Payment ID', p.paymentId?.toUpperCase().slice(0, 18) ?? '—')
  row('Order ID', String(p.orderId))
  row('Date', fmt(p.completedAt ?? p.createdAt))
  if (p.cardNumber) row('Card', maskCard(p.cardNumber))

  // Total line
  y += 2
  doc.line(14, y, W - 14, y)
  y += 10
  doc.setFontSize(11)
  doc.setTextColor(gray)
  doc.setFont('helvetica', 'normal')
  doc.text('Total Paid', 14, y)
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(17, 24, 39)
  doc.text(`${Number(p.amount).toLocaleString()} ${p.currency}`, W - 14, y, { align: 'right' })

  // Footer
  y = 270
  doc.setDrawColor(229, 231, 235)
  doc.line(14, y, W - 14, y)
  y += 6
  doc.setFontSize(7.5)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(gray)
  doc.text('Thank you for your subscription to Progressor.', W / 2, y, { align: 'center' })
  y += 4
  doc.text('For support: progressor.tracker@gmail.com', W / 2, y, { align: 'center' })

  doc.save(`progressor-receipt-${String(p.orderId).slice(-6)}.pdf`)
}

export default function BillingPage({ onClose }: Props) {
  const user = getUserInfo()
  const [status, setStatus] = useState<PaymentStatus | null>(null)
  const [history, setHistory] = useState<PaymentRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [subscribing, setSubscribing] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
                      {subscribing ? 'Redirecting…' : 'Subscribe — 10 AMD/mo'}
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
                      <button
                        onClick={() => downloadReceipt(p, user?.email, displayName)}
                        title="Download receipt"
                        style={{ padding: '5px 10px', borderRadius: 7, background: 'var(--surface3)', color: 'var(--text2)', border: '1px solid var(--border)', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}
                      >
                        ↓ Receipt
                      </button>
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
