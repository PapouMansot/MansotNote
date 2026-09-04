export interface ServerUser { id: string; username: string }

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
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
}

export async function changeServerPassword(currentPassword: string, newPassword: string): Promise<void> {
  await api('/auth/change-password', {
    method: 'POST', body: JSON.stringify({ currentPassword, newPassword }),
  });
}
