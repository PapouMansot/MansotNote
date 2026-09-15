import type { Pool, PoolClient } from 'pg';

export interface DbNote {
  id: string;
  folderId: string | null;
  title: string;
  content: string;
  tagIds: string[];
  pinned: boolean;
  archived: boolean;
  archivedAt?: number | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * Reconstitue l'état du workspace directement depuis les tables relationnelles Supabase.
 * Cela permet à toute modification faite dans Supabase Studio (Table Editor)
 * d'être immédiatement visible dans l'application MansotNote.
 */
export async function assembleWorkspaceFromDb(pool: Pool, userId: string) {
  const wsResult = await pool.query(
    'SELECT state, version, updated_at FROM workspaces WHERE user_id=$1',
    [userId]
  );
  if (!wsResult.rowCount) return null;

  const [notesRes, foldersRes, tagsRes, colsRes, cardsRes, labelsRes] = await Promise.all([
    pool.query(
      'SELECT id, folder_id as "folderId", title, content, tag_ids as "tagIds", pinned, archived, archived_at as "archivedAt", created_at as "createdAt", updated_at as "updatedAt" FROM notes WHERE user_id=$1 ORDER BY updated_at DESC',
      [userId]
    ),
    pool.query(
      'SELECT id, name, parent_id as "parentId", order_index as "order", created_at as "createdAt" FROM folders WHERE user_id=$1 ORDER BY order_index ASC',
      [userId]
    ),
    pool.query(
      'SELECT id, name, color, created_at as "createdAt" FROM tags WHERE user_id=$1',
      [userId]
    ),
    pool.query(
      'SELECT id, title, order_index as "order", created_at as "createdAt" FROM kanban_columns WHERE user_id=$1 ORDER BY order_index ASC',
      [userId]
    ),
    pool.query(
      'SELECT id, column_id as "columnId", order_index as "order", title, description, label_ids as "labelIds", priority, due_date as "dueDate", checklist, linked_note_id as "linkedNoteId", archived, archived_at as "archivedAt", created_at as "createdAt", updated_at as "updatedAt" FROM kanban_cards WHERE user_id=$1 ORDER BY order_index ASC',
      [userId]
    ),
    pool.query(
      'SELECT id, name, color, created_at as "createdAt" FROM kanban_labels WHERE user_id=$1',
      [userId]
    ),
  ]);

  const rawState = wsResult.rows[0].state || {};
  const version = Number(wsResult.rows[0].version);
  const updatedAt = wsResult.rows[0].updated_at;

  const state = {
    schemaVersion: rawState.schemaVersion ?? 1,
    savedAt: rawState.savedAt ?? Date.now(),
    seed: rawState.seed ?? null,
    settings: rawState.settings ?? {},
    notes: notesRes.rows.map((r) => ({
      ...r,
      pinned: Boolean(r.pinned),
      archived: Boolean(r.archived),
      tagIds: Array.isArray(r.tagIds) ? r.tagIds : [],
      createdAt: Number(r.createdAt),
      updatedAt: Number(r.updatedAt),
      archivedAt: r.archivedAt ? Number(r.archivedAt) : undefined,
    })),
    folders: foldersRes.rows.map((r) => ({
      ...r,
      order: Number(r.order),
      createdAt: Number(r.createdAt),
    })),
    tags: tagsRes.rows.map((r) => ({
      ...r,
      createdAt: Number(r.createdAt),
    })),
    columns: colsRes.rows.map((r) => ({
      ...r,
      order: Number(r.order),
      createdAt: Number(r.createdAt),
    })),
    cards: cardsRes.rows.map((r) => ({
      ...r,
      order: Number(r.order),
      labelIds: Array.isArray(r.labelIds) ? r.labelIds : [],
      checklist: Array.isArray(r.checklist) ? r.checklist : [],
      archived: Boolean(r.archived),
      createdAt: Number(r.createdAt),
      updatedAt: Number(r.updatedAt),
      archivedAt: r.archivedAt ? Number(r.archivedAt) : undefined,
    })),
    labels: labelsRes.rows.map((r) => ({
      ...r,
      createdAt: Number(r.createdAt),
    })),
  };

  return { state, version, updatedAt };
}

/**
 * Synchronise les entités du workspace dans leurs tables relationnelles respectives
 * au sein d'une transaction PostgreSQL.
 */
export async function syncWorkspaceToRelational(
  client: PoolClient,
  userId: string,
  state: any
): Promise<void> {
  // 1. Folders
  const folders = Array.isArray(state.folders) ? state.folders : [];
  const folderIds = folders.map((f: any) => f.id);
  if (folderIds.length > 0) {
    await client.query('DELETE FROM folders WHERE user_id=$1 AND NOT (id = ANY($2::text[]))', [
      userId,
      folderIds,
    ]);
  } else {
    await client.query('DELETE FROM folders WHERE user_id=$1', [userId]);
  }
  for (const f of folders) {
    await client.query(
      `INSERT INTO folders (id, user_id, name, parent_id, order_index, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         parent_id = EXCLUDED.parent_id,
         order_index = EXCLUDED.order_index`,
      [f.id, userId, f.name, f.parentId || null, f.order ?? 0, f.createdAt ?? Date.now()]
    );
  }

  // 2. Tags
  const tags = Array.isArray(state.tags) ? state.tags : [];
  const tagIds = tags.map((t: any) => t.id);
  if (tagIds.length > 0) {
    await client.query('DELETE FROM tags WHERE user_id=$1 AND NOT (id = ANY($2::text[]))', [
      userId,
      tagIds,
    ]);
  } else {
    await client.query('DELETE FROM tags WHERE user_id=$1', [userId]);
  }
  for (const t of tags) {
    await client.query(
      `INSERT INTO tags (id, user_id, name, color, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         color = EXCLUDED.color`,
      [t.id, userId, t.name, t.color ?? '#64748b', t.createdAt ?? Date.now()]
    );
  }

  // 3. Notes
  const notes = Array.isArray(state.notes) ? state.notes : [];
  const noteIds = notes.map((n: any) => n.id);
  if (noteIds.length > 0) {
    await client.query('DELETE FROM notes WHERE user_id=$1 AND NOT (id = ANY($2::text[]))', [
      userId,
      noteIds,
    ]);
  } else {
    await client.query('DELETE FROM notes WHERE user_id=$1', [userId]);
  }
  for (const n of notes) {
    await client.query(
      `INSERT INTO notes (id, user_id, folder_id, title, content, tag_ids, pinned, archived, archived_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO UPDATE SET
         folder_id = EXCLUDED.folder_id,
         title = EXCLUDED.title,
         content = EXCLUDED.content,
         tag_ids = EXCLUDED.tag_ids,
         pinned = EXCLUDED.pinned,
         archived = EXCLUDED.archived,
         archived_at = EXCLUDED.archived_at,
         updated_at = EXCLUDED.updated_at`,
      [
        n.id,
        userId,
        n.folderId || null,
        n.title ?? '',
        n.content ?? '',
        JSON.stringify(n.tagIds ?? []),
        Boolean(n.pinned),
        Boolean(n.archived),
        n.archivedAt ?? null,
        n.createdAt ?? Date.now(),
        n.updatedAt ?? Date.now(),
      ]
    );
  }

  // 4. Kanban Columns
  const columns = Array.isArray(state.columns) ? state.columns : [];
  const columnIds = columns.map((c: any) => c.id);
  if (columnIds.length > 0) {
    await client.query(
      'DELETE FROM kanban_columns WHERE user_id=$1 AND NOT (id = ANY($2::text[]))',
      [userId, columnIds]
    );
  } else {
    await client.query('DELETE FROM kanban_columns WHERE user_id=$1', [userId]);
  }
  for (const c of columns) {
    await client.query(
      `INSERT INTO kanban_columns (id, user_id, title, order_index, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title,
         order_index = EXCLUDED.order_index`,
      [c.id, userId, c.title, c.order ?? 0, c.createdAt ?? Date.now()]
    );
  }

  // 5. Kanban Labels
  const labels = Array.isArray(state.labels) ? state.labels : [];
  const labelIds = labels.map((l: any) => l.id);
  if (labelIds.length > 0) {
    await client.query(
      'DELETE FROM kanban_labels WHERE user_id=$1 AND NOT (id = ANY($2::text[]))',
      [userId, labelIds]
    );
  } else {
    await client.query('DELETE FROM kanban_labels WHERE user_id=$1', [userId]);
  }
  for (const l of labels) {
    await client.query(
      `INSERT INTO kanban_labels (id, user_id, name, color, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         color = EXCLUDED.color`,
      [l.id, userId, l.name, l.color ?? '#64748b', l.createdAt ?? Date.now()]
    );
  }

  // 6. Kanban Cards
  const cards = Array.isArray(state.cards) ? state.cards : [];
  const cardIds = cards.map((cd: any) => cd.id);
  if (cardIds.length > 0) {
    await client.query(
      'DELETE FROM kanban_cards WHERE user_id=$1 AND NOT (id = ANY($2::text[]))',
      [userId, cardIds]
    );
  } else {
    await client.query('DELETE FROM kanban_cards WHERE user_id=$1', [userId]);
  }
  for (const cd of cards) {
    await client.query(
      `INSERT INTO kanban_cards (id, user_id, column_id, order_index, title, description, label_ids, priority, due_date, checklist, linked_note_id, archived, archived_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (id) DO UPDATE SET
         column_id = EXCLUDED.column_id,
         order_index = EXCLUDED.order_index,
         title = EXCLUDED.title,
         description = EXCLUDED.description,
         label_ids = EXCLUDED.label_ids,
         priority = EXCLUDED.priority,
         due_date = EXCLUDED.due_date,
         checklist = EXCLUDED.checklist,
         linked_note_id = EXCLUDED.linked_note_id,
         archived = EXCLUDED.archived,
         archived_at = EXCLUDED.archived_at,
         updated_at = EXCLUDED.updated_at`,
      [
        cd.id,
        userId,
        cd.columnId,
        cd.order ?? 0,
        cd.title ?? '',
        cd.description ?? '',
        JSON.stringify(cd.labelIds ?? []),
        cd.priority ?? 'medium',
        cd.dueDate ?? null,
        JSON.stringify(cd.checklist ?? []),
        cd.linkedNoteId || null,
        Boolean(cd.archived),
        cd.archivedAt ?? null,
        cd.createdAt ?? Date.now(),
        cd.updatedAt ?? Date.now(),
      ]
    );
  }
}

