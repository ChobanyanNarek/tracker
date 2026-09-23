import type { Transport } from '../sync-core/transport'
import { authHeaders } from './auth'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

// The sync's route to the backend from the browser: an authenticated POST to the API.
export const browserTransport: Transport = {
  post: (path, body) => fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  }),
}
