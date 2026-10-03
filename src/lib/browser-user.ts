import type { ServerUser } from './server-auth';

let currentUser: ServerUser | null = null;
export const SESSION_USER_KEY = 'mansotnote.session_user';

export function getBrowserUser(): ServerUser | null { return currentUser; }
export function setBrowserUser(user: ServerUser): void {
  currentUser = user;
  try { window.localStorage.setItem(SESSION_USER_KEY, user.id); } catch { /* Stockage facultatif. */ }
}
export function accountStorageKey(key: string): string | null {
  return currentUser ? `${key}:${currentUser.id}` : null;
}
/** En-tête uniquement pour l'API du site, jamais envoyé aux fournisseurs IA externes. */
export function accountHeaders(url = '/api'): Record<string, string> {
  if (!currentUser || typeof window === 'undefined') return {};
  const target = new URL(url, window.location.href);
  return target.origin === window.location.origin && target.pathname.startsWith('/api')
    ? { 'X-Mansot-User': currentUser.id } : {};
}

export function accountFetch(input: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  for (const [key, value] of Object.entries(accountHeaders(input))) headers.set(key, value);
  return fetch(input, { ...init, headers });
}
