import { beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetErrorReporterForTests, reportError } from './error-reporter'

const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })))

beforeEach(() => {
  __resetErrorReporterForTests()
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  localStorage.setItem('pm_tracker_token', 'token')
})

const sentBodies = () => fetchMock.mock.calls.map((c) => JSON.parse((c as unknown as [string, RequestInit])[1].body as string))

describe('reportError', () => {
  it('sends only the fields the endpoint accepts', () => {
    // The server rejects unknown fields, so an extra one would drop every report.
    reportError({ kind: 'render', message: 'TypeError: boom', stack: 'at x' })
    expect(Object.keys(sentBodies()[0]).sort()).toEqual(['kind', 'message', 'release', 'stack', 'url'])
  })

  it('records the page without its query string', () => {
    window.history.pushState({}, '', '/daily?token=secret')
    reportError({ kind: 'error', message: 'x' })
    expect(sentBodies()[0].url).not.toContain('secret')
  })

  it('sends a repeated error once', () => {
    for (let i = 0; i < 5; i++) reportError({ kind: 'error', message: 'same' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('caps reports per session so an error loop cannot flood the log', () => {
    for (let i = 0; i < 100; i++) reportError({ kind: 'error', message: `distinct ${i}` })
    expect(fetchMock).toHaveBeenCalledTimes(20)
  })

  it('ignores noise that is not the app’s fault', () => {
    reportError({ kind: 'error', message: 'ResizeObserver loop limit exceeded' })
    reportError({ kind: 'error', message: 'Script error.' })
    reportError({ kind: 'error', message: 'x', stack: 'at chrome-extension://abc/inject.js' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does nothing when signed out', () => {
    localStorage.removeItem('pm_tracker_token')
    reportError({ kind: 'error', message: 'x' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('never throws, even if the network call does', () => {
    fetchMock.mockImplementationOnce(() => { throw new Error('offline') })
    expect(() => reportError({ kind: 'error', message: 'x' })).not.toThrow()
  })
})
