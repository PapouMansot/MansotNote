import type { PoolClient } from 'pg';

export class WorkspaceOwnershipError extends Error {
  constructor() { super('Identifiant ou référence invalide dans cet espace personnel'); }
}

/** Vérifie avant toute suppression, puis les upserts et les triggers couvrent les courses concurrentes. */
export async function validateWorkspaceOwnership(client: PoolClient, userId: string, state: Record<string, any>) {
  const entities = [
    ['folders', 'folders'], ['tags', 'tags'], ['notes', 'notes'],
    ['columns', 'kanban_columns'], ['labels', 'kanban_labels'], ['cards', 'kanban_cards'],
  ] as const;
  const ids: Record<string, Set<string>> = {};
  for (const [key, table] of entities) {
    const list = state[key];
    if (!Array.isArray(list) || list.some((item) => !item || typeof item.id !== 'string' || !item.id || item.id.length > 200)) {
      throw new WorkspaceOwnershipError();
    }
    ids[key] = new Set(list.map((item) => item.id));
    if (ids[key].size !== list.length) throw new WorkspaceOwnershipError();
    const conflict = await client.query(`SELECT 1 FROM ${table} WHERE id=ANY($1::text[]) AND user_id<>$2 LIMIT 1`, [[...ids[key]], userId]);
    if (conflict.rowCount) throw new WorkspaceOwnershipError();
  }
  const history = await client.query('SELECT 1 FROM note_versions WHERE note_id=ANY($1::text[]) AND user_id<>$2 LIMIT 1', [[...ids.notes], userId]);
  if (history.rowCount) throw new WorkspaceOwnershipError();
  const optional = (value: unknown, key: string) => value == null || (typeof value === 'string' && ids[key].has(value));
  const list = (value: unknown, key: string) => value === undefined || (Array.isArray(value) && value.every((id) => typeof id === 'string' && ids[key].has(id)));
  if (state.folders.some((f: any) => !optional(f.parentId, 'folders')) ||
      state.notes.some((n: any) => !optional(n.folderId, 'folders') || !list(n.tagIds, 'tags')) ||
      state.cards.some((c: any) => !ids.columns.has(c.columnId) || !optional(c.linkedNoteId, 'notes') || !list(c.labelIds, 'labels')) ||
      !optional(state.settings?.defaultFolderId, 'folders')) throw new WorkspaceOwnershipError();
}
