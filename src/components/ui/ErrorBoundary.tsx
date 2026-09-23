import { Component, type ErrorInfo, type ReactNode } from 'react'
import { reportError } from '../../utils/error-reporter'

interface State { failed: boolean }

/*
 * A render error anywhere below this used to unmount the whole tree and leave a blank
 * page, with no record of what happened. It is now reported to the admin log and the user
 * gets a way back. Their data is untouched: state lives in the store and the cloud, not in
 * the components that crashed.
 */
export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportError({
      kind: 'render',
      message: `${error.name}: ${error.message}`,
      // The component stack says which screen broke, which the JS stack alone often doesn't.
      stack: `${error.stack ?? ''}\n\nComponent stack:${info.componentStack ?? ''}`,
    })
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <div role="alert" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: 24 }}>
        <div style={{ maxWidth: 420, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>Something went wrong on this screen</div>
          <div style={{ fontSize: 13, color: 'var(--text3)', lineHeight: 1.5 }}>
            Your data is safe. The error has been reported automatically — reloading usually fixes it.
          </div>
          <button className="btn-primary" onClick={() => window.location.reload()}>Reload</button>
        </div>
      </div>
    )
  }
}
