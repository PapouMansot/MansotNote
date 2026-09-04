/**
 * Thème — application DOM, résolution et préférence persistée.
 *
 * La préférence vit dans localStorage sous STORAGE_KEYS.theme :
 * c'est la même clé lue par le script anti-flash d'index.html.
 */
import type { ThemeMode } from '@/types';
import { STORAGE_KEYS } from '@/constants';

/** Résout si le thème donné impose le mode sombre. */
export function resolveDark(theme: ThemeMode): boolean {
  if (theme === 'light') return false;
  if (theme === 'dark') return true;
  // 'system'
  if (typeof window !== 'undefined') {
    return !window.matchMedia('(prefers-color-scheme: light)').matches;
  }
  return true;
}

/** Applique le thème au document (classe `dark` + color-scheme). */
export function applyTheme(theme: ThemeMode): void {
  if (typeof document === 'undefined') {
    return;
  }
  const dark = resolveDark(theme);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}

/** Persiste la préférence de thème (clé partagée avec index.html). */
export function persistThemePreference(theme: ThemeMode): void {
  try {
    window.localStorage.setItem(STORAGE_KEYS.theme, theme);
  } catch {
    /* localStorage indisponible : le thème reste en mémoire */
  }
}

/** Lit la préférence de thème ; null si absente ou invalide. */
export function readThemePreference(): ThemeMode | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEYS.theme);
    if (value === 'dark' || value === 'light' || value === 'system') {
      return value;
    }
  } catch {
    /* ignore */
  }
  return null;
}
