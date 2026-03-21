import React from 'react'

type Props = {
  children: React.ReactNode
}

type State = {
  error: Error | null
  info: string | null
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, info: null }

  static getDerivedStateFromError(error: Error): State {
    return { error, info: null }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Keep it simple: show error on-screen, also log to console.
    // eslint-disable-next-line no-console
    console.error(error, info)
    this.setState({ error, info: info.componentStack ?? null })
  }

  render() {
    const { error, info } = this.state
    if (!error) return this.props.children

    return (
      <div style={{ padding: 18, fontFamily: 'var(--ui)', color: 'var(--text)' }}>
        <div style={{ fontSize: 14, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--muted)' }}>Errore runtime</div>
        <div style={{ marginTop: 10, padding: 12, border: '1px solid var(--stroke)', borderRadius: 14, background: 'rgba(15,22,20,.55)' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 12, whiteSpace: 'pre-wrap' }}>{String(error?.stack ?? error?.message ?? error)}</div>
          {info && (
            <div style={{ marginTop: 10, fontFamily: 'var(--mono)', fontSize: 11, whiteSpace: 'pre-wrap', color: 'var(--muted)' }}>
              {info.trim()}
            </div>
          )}
        </div>
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>
          Apri DevTools Console per dettagli aggiuntivi. Se mi incolli l’errore, lo risolviamo subito.
        </div>
      </div>
    )
  }
}

