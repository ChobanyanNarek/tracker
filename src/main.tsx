import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import ErrorBoundary from './components/ui/ErrorBoundary'
import { installErrorReporting } from './utils/error-reporter'

// Report uncaught errors and unhandled promise rejections to the admin log.
installErrorReporting()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
