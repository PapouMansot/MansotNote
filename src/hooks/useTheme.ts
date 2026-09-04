/**
 * useTheme — thème de l'interface (store + DOM).
 *
 *  - expose `theme`, `isDark` (résolu) et les actions store
 *    (`setTheme` / `toggleTheme`, qui appliquent le DOM et persistent
 *    la préférence sous `STORAGE_KEYS.theme`) ;
 *  - en mode `system`, réapplique le thème à chaque changement de
 *    préférence OS (le store ne le fait qu'au set explicite).
 */
import { useEffect } from 'react';
import type { ThemeMode } from '@/types';
import { applyTheme, resolveDark } from '@/lib/theme';
import { useAppStore } from '@/store/app-store';

export interface UseThemeResult {
  /** Préférence courante ('dark' | 'light' | 'system'). */
  theme: ThemeMode;
  /** Thème effectif après résolution de 'system'. */
  isDark: boolean;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
}

export function useTheme(): UseThemeResult {
  const theme = useAppStore((s) => s.data.settings.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const isDark = resolveDark(theme);

  useEffect(() => {
    if (theme !== 'system' || typeof window === 'undefined') {
      return;
    }
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    }
    // Navigateurs très anciens (Safari < 14).
    const legacy = query as unknown as {
      addListener: (fn: () => void) => void;
      removeListener: (fn: () => void) => void;
    };
    legacy.addListener(onChange);
    return () => legacy.removeListener(onChange);
  }, [theme]);

  return { theme, isDark, setTheme, toggleTheme };
}
