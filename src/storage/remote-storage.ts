import type { PersistedState, StorageAdapter } from '@/types';

let workspaceVersion = 0;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  if (response.status === 401) throw new Error('SESSION_EXPIRED');
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string; version?: number };
    if (response.status === 409) {
      workspaceVersion = body.version ?? workspaceVersion;
      throw new Error('Conflit de synchronisation : recharge les données avant de réessayer.');
    }
    throw new Error(body.error || `API HTTP ${response.status}`);
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

export class RemoteStorageAdapter implements StorageAdapter {
  readonly id = 'remote' as const;
  isAvailable(): boolean { return typeof fetch === 'function'; }

  async load(): Promise<PersistedState | null> {
    const result = await request<{ state: PersistedState | null; version: number }>('/workspace');
    workspaceVersion = result.version;
    return result.state;
  }

  async save(state: PersistedState): Promise<void> {
    const result = await request<{ version: number }>('/workspace', {
      method: 'PUT',
      body: JSON.stringify({ state: { ...state, savedAt: Date.now() }, expectedVersion: workspaceVersion }),
    });
    workspaceVersion = result.version;
  }

  async clear(): Promise<void> {
    await request('/workspace', { method: 'DELETE' });
    workspaceVersion = 0;
  }
}

export function createRemoteStorageAdapter(): StorageAdapter {
  return new RemoteStorageAdapter();
}
