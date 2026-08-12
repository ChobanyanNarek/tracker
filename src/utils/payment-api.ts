import { authHeaders } from './auth'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

export interface InitPaymentResult {
  paymentUrl: string
  orderId: number
  paymentId: string
}

export interface PaymentStatus {
  subscriptionActive: boolean
  subscriptionUntil: string | null
  trialUntil: string | null
  lastPayment?: {
    amount: number
    currency: string
    status: string
    completedAt: string | null
    cardNumber?: string
  } | null
}

// Backend calls Ameriabank InitPayment and returns the redirect URL
export async function initiatePayment(plan: 'monthly'): Promise<InitPaymentResult> {
  const res = await fetch(`${API_URL}/payment/init`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ plan }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string }
    throw new Error(body.message ?? 'Failed to initiate payment')
  }
  return res.json() as Promise<InitPaymentResult>
}

// Backend verifies the payment with Ameriabank GetPaymentDetails and activates subscription
export async function confirmPayment(orderId: string, paymentId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${API_URL}/payment/confirm`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ orderId, paymentId }),
    })
    if (res.ok) return { ok: true }
    const body = await res.json().catch(() => ({})) as { message?: string }
    return { ok: false, error: body.message }
  } catch { return { ok: false } }
}

export async function getSubscriptionStatus(): Promise<PaymentStatus | null> {
  try {
    const res = await fetch(`${API_URL}/payment/status`, { headers: authHeaders() })
    if (!res.ok) return null
    return res.json() as Promise<PaymentStatus>
  } catch { return null }
}
