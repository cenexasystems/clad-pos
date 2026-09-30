import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/common/ErrorBoundary'
import { installScrollLockSafetyReset } from './lib/scrollLock'

// Global deployment chunk recovery & benign error suppression
if (typeof window !== 'undefined') {
  // Install scroll-lock safety reset so returning from WhatsApp doesn't freeze scrolling
  installScrollLockSafetyReset()

  const forceFreshReload = () => {
    try {
      if ('serviceWorker' in navigator) {
        void navigator.serviceWorker.getRegistrations().then((regs) => {
          regs.forEach((r) => void r.unregister())
        })
      }
      if (typeof caches !== 'undefined') {
        void caches.keys().then((names) => {
          names.forEach((name) => void caches.delete(name))
        })
      }
    } catch {
      // Ignore cleanup failures
    }
    setTimeout(() => {
      window.location.reload()
    }, 80)
  }

  // Vite official event when dynamic chunk fails to preload (e.g. after new deployment)
  window.addEventListener('vite:preloadError', (event) => {
    console.warn('[Vite] Preload error detected after new deployment, reloading...', event)
    const lastReload = sessionStorage.getItem('chunk_reload_ts')
    const now = Date.now()
    if (!lastReload || now - Number(lastReload) > 8000) {
      sessionStorage.setItem('chunk_reload_ts', String(now))
      forceFreshReload()
    }
  })

  const isBenignError = (errorMsg: string, source?: string) => {
    if (!errorMsg && !source) return false
    const s = `${errorMsg} ${source || ''}`
    return (
      s.includes('disconnected port object') ||
      s.includes('Attempting to use a disconnected port object') ||
      s.includes('proxy.js') ||
      s.includes('handleMessageFromPage') ||
      s.includes('message channel closed before a response was received') ||
      s.includes('The message port closed before a response was received') ||
      s.includes('A listener indicated an asynchronous response') ||
      s.includes('Extension context invalidated') ||
      s.includes('Could not establish connection. Receiving end does not exist') ||
      s.includes('ResizeObserver loop completed with undelivered notifications') ||
      s.includes('ResizeObserver loop limit exceeded') ||
      s.includes('Non-Error promise rejection captured') ||
      s.includes('Permissions policy violation: unload') ||
      s.includes('unload is not allowed in this document') ||
      s.includes('Using DEFAULT root logger')
    )
  }

  window.onerror = (message, source, _lineno, _colno, error) => {
    const errStr = error instanceof Error ? error.message : String(error || '')
    if (isBenignError(String(message), String(source || '')) || isBenignError(errStr, String(source || ''))) {
      return true
    }
  }

  window.onunhandledrejection = (event) => {
    const errorMsg =
      event.reason instanceof Error
        ? event.reason.message
        : typeof event.reason === 'string'
        ? event.reason
        : event.reason && typeof event.reason === 'object' && 'message' in event.reason
        ? String((event.reason as { message?: unknown }).message)
        : ''
    if (isBenignError(errorMsg)) {
      event.preventDefault()
      return true
    }
  }

  window.addEventListener(
    'unhandledrejection',
    (event) => {
      const errorMsg =
        event.reason instanceof Error
          ? event.reason.message
          : typeof event.reason === 'string'
          ? event.reason
          : event.reason && typeof event.reason === 'object' && 'message' in event.reason
          ? String((event.reason as { message?: unknown }).message)
          : ''

      // Handle stale deployment chunk 404/MIME errors by gracefully reloading the page once
      if (
        errorMsg.includes('Failed to fetch dynamically imported module') ||
        errorMsg.includes('Expected a JavaScript-or-Wasm module script') ||
        errorMsg.includes('error loading dynamically imported module') ||
        errorMsg.includes('Importing a module script failed') ||
        errorMsg.includes('Refused to apply style') ||
        errorMsg.includes('stylesheet MIME type')
      ) {
        console.warn('[App] Stale deployment asset detected, refreshing page for updated assets:', errorMsg)
        const lastReload = sessionStorage.getItem('chunk_reload_ts')
        const now = Date.now()
        if (!lastReload || now - Number(lastReload) > 8000) {
          sessionStorage.setItem('chunk_reload_ts', String(now))
          forceFreshReload()
          return
        }
      }

      if (isBenignError(errorMsg)) {
        event.preventDefault()
        event.stopImmediatePropagation?.()
      }
    },
    true
  )

  window.addEventListener(
    'error',
    (event) => {
      const errorMsg =
        event.message ||
        (event.error instanceof Error ? event.error.message : String(event.error || ''))
      const src = event.filename || ''

      if (
        errorMsg.includes('Refused to apply style') ||
        errorMsg.includes('stylesheet MIME type')
      ) {
        const lastReload = sessionStorage.getItem('chunk_reload_ts')
        const now = Date.now()
        if (!lastReload || now - Number(lastReload) > 8000) {
          sessionStorage.setItem('chunk_reload_ts', String(now))
          forceFreshReload()
          return
        }
      }

      if (isBenignError(errorMsg, src)) {
        event.preventDefault()
        event.stopImmediatePropagation?.()
      }
    },
    true
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)


