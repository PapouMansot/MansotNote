import type { PersistedState, StorageAdapter } from '@/types';
import { detachMissingFolders, mergeFolders, mergeNotes, mergeTags } from '@/lib/workspace-merge';

let workspaceVersion = 0;
/** Ids des notes et dossiers connus lors de la dernière synchro réussie (base de fusion). */
let baseNoteIds = new Set<string>();
let baseFolderIds = new Set<string>();
let baseTagIds = new Set<string>();

const MAX_MERGE_ATTEMPTS = 3;

class ConflictError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  if (response.status === 401) throw new Error('SESSION_EXPIRED');
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (response.status === 409) {
      throw new ConflictError('Conflit de synchronisation : recharge les données avant de réessayer.');
    }
    throw new Error(body.error || `API HTTP ${response.status}`);
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

function rememberBase(state: PersistedState | null): void {
  baseNoteIds = new Set((state?.notes ?? []).map((n) => n.id));
  baseFolderIds = new Set((state?.folders ?? []).map((f) => f.id));
  baseTagIds = new Set((state?.tags ?? []).map((t) => t.id));
}

async function fetchWorkspace(): Promise<{ state: PersistedState | null; version: number }> {
  return request<{ state: PersistedState | null; version: number }>('/workspace');
}

export class RemoteStorageAdapter implements StorageAdapter {
  readonly id = 'remote' as const;
  isAvailable(): boolean { return typeof fetch === 'function'; }

  async load(): Promise<PersistedState | null> {
    const result = await fetchWorkspace();
    workspaceVersion = result.version;
    rememberBase(result.state);
    return result.state;
  }

  /**
   * Sauvegarde ; sur conflit (un bot a écrit entre-temps), recharge l'état
   * serveur, fusionne les notes et réessaie. Renvoie l'état fusionné pour que
   * le store l'affiche ; sinon la sauvegarde suivante effacerait la note du bot.
   */
  async save(state: PersistedState): Promise<PersistedState | void> {
    let candidate = state;
    let merged = false;
    for (let attempt = 1; ; attempt += 1) {
      try {
        const result = await request<{ version: number }>('/workspace', {
          method: 'PUT',
          body: JSON.stringify({ state: { ...candidate, savedAt: Date.now() }, expectedVersion: workspaceVersion }),
        });
        workspaceVersion = result.version;
        rememberBase(candidate);
        return merged ? candidate : undefined;
      } catch (error) {
        if (!(error instanceof ConflictError) || attempt >= MAX_MERGE_ATTEMPTS) throw error;
        const server = await fetchWorkspace();
        workspaceVersion = server.version;
        const folders = mergeFolders(candidate.folders, server.state?.folders ?? [], baseFolderIds);
        candidate = {
          ...candidate,
          folders,
          tags: mergeTags(candidate.tags, server.state?.tags ?? [], baseTagIds),
          notes: detachMissingFolders(mergeNotes(candidate.notes, server.state?.notes ?? [], baseNoteIds), folders),
        };
        rememberBase(server.state);
        merged = true;
      }
    }
  }

  async clear(): Promise<void> {
    await request('/workspace', { method: 'DELETE' });
    workspaceVersion = 0;
    baseNoteIds = new Set();
    baseFolderIds = new Set();
    baseTagIds = new Set();
  }
}

export function createRemoteStorageAdapter(): StorageAdapter {
  return new RemoteStorageAdapter();
}
