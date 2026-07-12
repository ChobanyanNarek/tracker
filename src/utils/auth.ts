const TOKEN_KEY = 'pm_tracker_token'
const USER_KEY = 'pm_tracker_user'
const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

export interface StoredUser {
  id: string
  firstName: string | null
  lastName: string | null
  email: string | null
  phone?: string | null
  role: 'ADMIN' | 'CREATOR' | null
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function getUserInfo(): StoredUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY)
    return raw ? (JSON.parse(raw) as StoredUser) : null
  } catch { return null }
}

function setUserInfo(info: StoredUser): void {
  localStorage.setItem(USER_KEY, JSON.stringify(info))
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

export function isAuthenticated(): boolean {
  return !!getToken()
}

export function authHeaders(): HeadersInit {
  const token = getToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return headers
}

export async function fetchAndStoreUserInfo(): Promise<StoredUser | null> {
  try {
    const res = await fetch(`${API_URL}/auth/me`, { headers: authHeaders() })
    if (!res.ok) return null
    const data = await res.json() as StoredUser
    setUserInfo(data)
    return data
  } catch { return null }
}

interface TokenPayload { token: string; expiresIn?: number }
interface AuthResponse { accessToken: TokenPayload }

const ERROR_CODES: Record<string, string> = {
  'error.userNotFound': 'Account not found. Check your email or phone number.',
  'error.invalidCredentials': 'Incorrect password.',
  'error.accountDisabled': 'Your account has been disabled.',
  'error.userExists': 'An account with this email already exists.',
  'error.invalidVerificationCode': 'Incorrect verification code.',
  'error.verificationCodeExpired': 'Verification code expired. Please request a new one.',
  'error.emailSendFailed': 'Failed to send verification email. Please try again.',
}

function parseErrorMessage(data: unknown): string {
  if (!data || typeof data !== 'object') return 'Something went wrong, please try again.'
  const d = data as Record<string, unknown>
  const msg = d['message']
  if (typeof msg === 'string') return ERROR_CODES[msg] ?? msg
  if (Array.isArray(msg)) {
    const texts = msg.map((m) => {
      if (typeof m === 'string') return ERROR_CODES[m] ?? m
      if (m && typeof m === 'object') {
        const c = (m as Record<string, unknown>)['constraints']
        if (c && typeof c === 'object') return Object.values(c as Record<string, string>).join(', ')
      }
      return null
    }).filter(Boolean) as string[]
    return texts.length ? texts.join(' · ') : 'Please check your input and try again.'
  }
  return 'Something went wrong, please try again.'
}

async function handleAuthResponse(res: Response): Promise<string> {
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(parseErrorMessage(data))
  }
  const data = await res.json() as AuthResponse
  return data.accessToken.token
}

export async function apiLogin(credential: string, password: string): Promise<string> {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential, password }),
  })
  return handleAuthResponse(res)
}

export async function apiSendRegistrationCode(email: string): Promise<void> {
  const res = await fetch(`${API_URL}/auth/send-registration-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(parseErrorMessage(data))
  }
}

export async function apiRegister(
  firstName: string,
  lastName: string,
  email: string,
  password: string,
  code: string,
  phone?: string,
): Promise<string> {
  const res = await fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName, lastName, email, password, code, ...(phone ? { phone } : {}) }),
  })
  return handleAuthResponse(res)
}
