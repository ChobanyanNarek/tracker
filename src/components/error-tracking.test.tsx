import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ErrorBoundary from './ui/ErrorBoundary'
import ClientErrorsPanel from './admin/ClientErrorsPanel'
import { __resetErrorReporterForTests } from '../utils/error-reporter'

// React 18 requires this flag for act() outside a test renderer.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
const fetchMock = vi.fn()

beforeEach(() => {
  __resetErrorReporterForTests()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  localStorage.setItem('pm_tracker_token', 'token')
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function Boom(): never {
  throw new Error('render exploded')
}

describe('ErrorBoundary', () => {
  it('shows a recovery screen instead of a blank page, and reports the crash', () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    vi.spyOn(console, 'error').mockImplementation(() => {}) // React logs caught errors

    act(() => root.render(<ErrorBoundary><Boom /></ErrorBoundary>))

    expect(host.textContent).toContain('Something went wrong on this screen')
    expect(host.querySelector('button')?.textContent).toBe('Reload')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/pm-tracker/client-errors')
    const body = JSON.parse(init.body as string)
    expect(body.kind).toBe('render')
    expect(body.message).toBe('Error: render exploded')
    expect(body.stack).toContain('Component stack')
  })

  it('renders children untouched when nothing fails', () => {
    act(() => root.render(<ErrorBoundary><p>fine</p></ErrorBoundary>))
    expect(host.textContent).toBe('fine')
  })
})

describe('ClientErrorsPanel', () => {
  const users = [{ id: 'u1', email: 'narek@example.com' }] as never

  it('lists recorded browser errors newest first, with the user and a readable kind', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      data: [{
        id: 'e1', timestamp: '2026-09-23T10:00:00Z', message: 'TypeError: x is undefined',
        context: { userId: 'u1', kind: 'render', url: 'https://www.progressor.work/', release: 'abc1234', stack: 'at render' },
      }],
      meta: { page: 1, take: 50, itemCount: 1, pageCount: 1, hasPreviousPage: false, hasNextPage: false },
    }), { status: 200 }))

    await act(async () => root.render(<ClientErrorsPanel users={users} />))

    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toContain('/admin/logs')
    expect(url).toContain('source=web')
    expect(url).toContain('order=DESC')
    expect(host.textContent).toContain('TypeError: x is undefined')
    expect(host.textContent).toContain('Screen crash')
    expect(host.textContent).toContain('narek@example.com')

    // Expanding a row reveals the stack and the build it came from.
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click())
    expect(host.textContent).toContain('at render')
    expect(host.textContent).toContain('abc1234')
  })

  it('says so plainly when there is nothing to show', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [], meta: {} }), { status: 200 }))
    await act(async () => root.render(<ClientErrorsPanel users={users} />))
    expect(host.textContent).toContain('No browser errors recorded')
  })

  it('reports a failed load instead of looking empty', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 500 }))
    await act(async () => root.render(<ClientErrorsPanel users={users} />))
    expect(host.textContent).toContain("Couldn't load browser errors")
  })
})
