import { accountFetch, SESSION_USER_KEY } from './browser-user';

export interface ServerUser { id: string; username: string; role: 'admin' | 'user'; legacyOwner: boolean }

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await accountFetch(`/api${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || `API HTTP ${response.status}`);
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

export async function getServerSession(): Promise<ServerUser | null> {
  try { return (await api<{ user: ServerUser }>('/auth/session')).user; }
  catch { return null; }
}

export async function loginServer(username: string, password: string): Promise<ServerUser> {
  return (await api<{ user: ServerUser }>('/auth/login', {
    method: 'POST', body: JSON.stringify({ username, password }),
  })).user;
}

export async function logoutServer(): Promise<void> {
  await api('/auth/logout', { method: 'POST' });
  try { window.localStorage.removeItem(SESSION_USER_KEY); } catch { /* Stockage facultatif. */ }
}

export interface ManagedUser {
  id: string;
  username: string;
  role: 'admin' | 'user';
  createdAt: string;
  disabledAt: string | null;
}
export async function listServerUsers(): Promise<ManagedUser[]> {
  return (await api<{ users: ManagedUser[] }>('/admin/users')).users;
}
export async function createServerUser(username: string, password: string, role: ManagedUser['role']): Promise<void> {
  await api('/admin/users', { method: 'POST', body: JSON.stringify({ username, password, role }) });
}
export async function updateServerUser(id: string, patch: { role?: ManagedUser['role']; disabled?: boolean }): Promise<void> {
  await api(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}
export async function resetServerUserPassword(id: string, password: string): Promise<void> {
  await api(`/admin/users/${id}/password`, { method: 'POST', body: JSON.stringify({ password }) });
}

export async function changeServerPassword(currentPassword: string, newPassword: string): Promise<void> {
  await api('/auth/change-password', {
    method: 'POST', body: JSON.stringify({ currentPassword, newPassword }),
  });
}
