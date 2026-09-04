/**
 * useToasts — notifications éphémères (store `ui.toasts`, max 3).
 *
 * Raccourcis `success` / `error` / `info` + `dismissToast` /
 * `clearToasts`. Le composant hôte (ToastHost) lit `toasts` et rend
 * la pile ; la disparition automatique est du ressort du hôte.
 */
import { useCallback } from 'react';
import type { ID, Toast } from '@/types';
import { useAppStore } from '@/store/app-store';

export interface UseToastsResult {
  toasts: Toast[];
  toast: (kind: Toast['kind'], message: string) => ID;
  success: (message: string) => ID;
  error: (message: string) => ID;
  info: (message: string) => ID;
  dismissToast: (id: ID) => void;
  clearToasts: () => void;
}

export function useToasts(): UseToastsResult {
  const toasts = useAppStore((s) => s.ui.toasts);
  const toast = useAppStore((s) => s.toast);
  const dismissToast = useAppStore((s) => s.dismissToast);
  const clearToasts = useAppStore((s) => s.clearToasts);

  const success = useCallback(
    (message: string) => toast('success', message),
    [toast],
  );
  const error = useCallback(
    (message: string) => toast('error', message),
    [toast],
  );
  const info = useCallback(
    (message: string) => toast('info', message),
    [toast],
  );

  return { toasts, toast, success, error, info, dismissToast, clearToasts };
}
