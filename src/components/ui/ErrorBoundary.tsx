/**
 * ErrorBoundary — capture les erreurs de rendu React et affiche un
 * message lisible (au lieu d'un écran noir). Le contenu fautif est
 * remplacé par la carte d'erreur ; le reste de l'application survit.
 */
import { Component, type ReactNode } from 'react';

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** Contexte affiché dans la carte d'erreur (ex. « Note IA »). */
  label?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('[ErrorBoundary]', this.props.label ?? 'rendu', error);
  }

  render() {
    if (this.state.error === null) {
      return this.props.children;
    }
    const message = this.state.error.message || 'Erreur inconnue';
    return (
      <div className="flex min-h-[16rem] flex-col items-center justify-center gap-3 rounded-xl border border-red-500/30 bg-red-500/5 p-6 text-center">
        <p className="text-sm font-semibold text-red-700 dark:text-red-300">
          Oups — cette partie de l'interface a planté.
        </p>
        <p className="max-w-md break-words text-xs text-zinc-500 dark:text-zinc-400">
          {this.props.label !== undefined ? `${this.props.label} — ` : ''}
          {message}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            onClick={() => this.setState({ error: null })}
          >
            Réessayer
          </button>
          <button
            type="button"
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
            onClick={() => window.location.reload()}
          >
            Recharger la page
          </button>
        </div>
      </div>
    );
  }
}
