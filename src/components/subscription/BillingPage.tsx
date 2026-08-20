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


const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path fill-rule="evenodd" fill="#ffffff" d="M24,3 A21,21 0 1,0 24,45 A21,21 0 1,0 24,3 Z M24,9 A15,15 0 1,0 24,39 A15,15 0 1,0 24,9 Z"/><g stroke="#ffffff" stroke-width="2.2" stroke-linecap="round"><line x1="21" y1="7" x2="27" y2="5"/><line x1="21" y1="7" x2="27" y2="5" transform="rotate(60 24 24)"/><line x1="21" y1="7" x2="27" y2="5" transform="rotate(120 24 24)"/><line x1="21" y1="7" x2="27" y2="5" transform="rotate(180 24 24)"/><line x1="21" y1="7" x2="27" y2="5" transform="rotate(240 24 24)"/><line x1="21" y1="7" x2="27" y2="5" transform="rotate(300 24 24)"/></g></svg>`

function svgToDataUrl(svg: string, size: number): Promise<string> {
  return new Promise((resolve) => {
    const blob = new Blob([svg], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = size; canvas.height = size
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, size, size)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/png'))
    }
    img.src = url
  })
}

async function downloadReceipt(p: PaymentRecord, userEmail: string | null | undefined, userName: string) {
  const logoDataUrl = await svgToDataUrl(LOGO_SVG, 128)
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = 210
  const gray = '#6b7280'
  const dark = '#111827'

  // Header band
  doc.setFillColor(17, 24, 39)
  doc.rect(0, 0, W, 36, 'F')
  doc.addImage(logoDataUrl, 'PNG', 8, 7, 22, 22)

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
                        onClick={() => { void downloadReceipt(p, user?.email, displayName) }}
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
