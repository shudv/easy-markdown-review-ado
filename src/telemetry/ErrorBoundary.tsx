// React error boundary — converts a render/runtime crash inside the app tree
// into (a) a reported exception and (b) a readable fallback, instead of an
// unmounted white screen. Wraps each app root in the entry points.

import * as React from "react";

import { trackException } from "./telemetry";

interface ErrorBoundaryProps {
  /** Logical area name for the report, e.g. "pr-tab" | "documents-hub". */
  source: string;
  children: React.ReactNode;
  /** Optional custom fallback; defaults to a minimal inline message. */
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  override state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    trackException({
      error,
      severity: "critical",
      source: `react-boundary:${this.props.source}`,
      handled: true,
      properties: {
        // componentStack can include user-authored component names only —
        // safe, but the sanitizer would drop it anyway. Send a boolean instead.
        hasComponentStack: Boolean(info.componentStack),
      },
    });
  }

  override render(): React.ReactNode {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;
    return (
      <div
        role="alert"
        style={{
          padding: 24,
          fontFamily: "'Segoe UI', system-ui, sans-serif",
          color: "#cd3030",
        }}
      >
        <h2 style={{ marginTop: 0 }}>Something went wrong</h2>
        <p style={{ color: "#333" }}>
          This view hit an unexpected error. Try reloading; if it persists, the
          issue has been reported automatically.
        </p>
      </div>
    );
  }
}
