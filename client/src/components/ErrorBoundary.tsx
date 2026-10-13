import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Top-level render-error safety net.
 *
 * This does NOT replace the per-page loading/error/empty states already
 * used throughout the app for failed API calls — those stay local to each
 * page so a failed fetch never has to blank the whole screen. This only
 * catches unexpected render-time exceptions (a bad prop, a null deref,
 * a third-party library throwing) so the user sees a calm recovery screen
 * instead of a blank white page.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('LifeLink: unhandled UI error', error, info.componentStack);
  }

  handleReload = () => {
    this.setState({ hasError: false });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          style={{
            minHeight: '60vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: '3rem 1.5rem',
            gap: '0.75rem',
          }}
        >
          <div style={{ fontSize: '40px' }} aria-hidden="true">🩸</div>
          <h2 style={{ margin: 0, color: 'var(--tx)' }}>Something went wrong</h2>
          <p style={{ color: 'var(--gr)', maxWidth: '380px', margin: 0 }}>
            LifeLink hit an unexpected error. Your data is safe — try reloading the page.
          </p>
          <button className="btn btn-red" style={{ marginTop: '0.5rem' }} onClick={this.handleReload}>
            Reload LifeLink
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
