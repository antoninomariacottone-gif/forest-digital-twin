import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import './styles.css'

function showFatal(err: unknown) {
  const el = document.getElementById('app')
  if (!el) return
  const msg = err instanceof Error ? (err.stack ?? err.message) : String(err)
  el.innerHTML = `
    <div style="padding:18px;font-family:ui-sans-serif,system-ui;color:#111;">
      <div style="font-size:14px;letter-spacing:.04em;text-transform:uppercase;color:#444;">Fatal (prima di React)</div>
      <pre style="margin-top:10px;white-space:pre-wrap;background:#fff3f3;border:1px solid #f1b6b6;padding:12px;border-radius:12px;max-width:980px;">${escapeHtml(msg)}</pre>
      <div style="margin-top:10px;font-size:12px;color:#444;">Se vedi questo, incolla qui il testo del riquadro e l’errore in Console.</div>
    </div>
  `
}

function escapeHtml(s: string) {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

window.addEventListener('error', (e) => showFatal(e.error ?? e.message))
window.addEventListener('unhandledrejection', (e) => showFatal((e as PromiseRejectionEvent).reason))

try {
  ReactDOM.createRoot(document.getElementById('app')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
  // Remove boot screen only after React render is scheduled.
  document.getElementById('boot')?.remove()
} catch (err) {
  showFatal(err)
}
