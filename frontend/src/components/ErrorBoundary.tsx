import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("Unhandled render error", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="card" style={{ margin: 20 }}>
          <h2>Etwas ist schiefgelaufen</h2>
          <p style={{ fontSize: 13, color: "var(--muted)" }}>
            Diese Ansicht konnte nicht dargestellt werden. Das betrifft nur diese Anzeige - keine Daten
            wurden verändert.
          </p>
          <button className="btn primary" onClick={() => this.setState({ error: null })}>
            Erneut versuchen
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
