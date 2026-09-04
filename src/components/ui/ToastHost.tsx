/**
 * ToastHost — pile des notifications (store `ui.toasts`, max 3).
 * Disparition automatique après 4 s ; fermeture manuelle possible.
 */
import { useEffect, useRef } from 'react';
import { Check, Info, X, XCircle } from 'lucide-react';
import type { Toast } from '@/types';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app-store';

const TOAST_TTL_MS = 4000;

const STYLES: Record<Toast['kind'], { icon: JSX.Element; classes: string }> = {
  success: {
    icon: <Check size={15} />,
    classes:
      'border-emerald-500/30 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-200',
  },
  error: {
    icon: <XCircle size={15} />,
    classes:
      'border-red-500/30 bg-red-50 text-red-800 dark:bg-red-950/70 dark:text-red-200',
  },
  info: {
    icon: <Info size={15} />,
    classes:
      'border-indigo-500/30 bg-indigo-50 text-indigo-800 dark:bg-indigo-950/70 dark:text-indigo-200',
  },
};

export function ToastHost() {
  const toasts = useAppStore((s) => s.ui.toasts);
  const dismissToast = useAppStore((s) => s.dismissToast);
  const scheduled = useRef(new Set<string>());

  useEffect(() => {
    for (const toast of toasts) {
      if (scheduled.current.has(toast.id)) {
        continue;
      }
      scheduled.current.add(toast.id);
      setTimeout(() => dismissToast(toast.id), TOAST_TTL_MS);
    }
  }, [toasts, dismissToast]);

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {toasts.map((toast) => {
        const style = STYLES[toast.kind];
        return (
          <div
            key={toast.id}
            className={cn(
              'pointer-events-auto flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm shadow-lg',
              style.classes,
            )}
          >
            <span className="mt-0.5 shrink-0">{style.icon}</span>
            <span className="min-w-0 flex-1 break-words">{toast.message}</span>
            <button
              type="button"
              aria-label="Fermer la notification"
              className="shrink-0 rounded p-0.5 opacity-60 transition-opacity hover:opacity-100"
              onClick={() => dismissToast(toast.id)}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
