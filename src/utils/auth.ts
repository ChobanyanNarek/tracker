const TOKEN_KEY = 'pm_tracker_token'
const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
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

interface TokenPayload { token: string; expiresIn?: number }
interface AuthResponse { accessToken: TokenPayload }

async function handleAuthResponse(res: Response): Promise<string> {
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { message?: string }
    throw new Error(data.message ?? `Request failed (${res.status})`)
  }
  const data = await res.json() as AuthResponse
  return data.accessToken.token
}

export async function apiLogin(email: string, password: string): Promise<string> {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  return handleAuthResponse(res)
}

export async function apiRegister(
  firstName: string,
  lastName: string,
  email: string,
  password: string,
): Promise<string> {
  const res = await fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName, lastName, email, password }),
  })
  return handleAuthResponse(res)
}

export async function apiGoogleLogin(idToken: string): Promise<string> {
  const res = await fetch(`${API_URL}/auth/google-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  })
  return handleAuthResponse(res)
}
