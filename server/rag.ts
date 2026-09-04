import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool } from './db.js';

interface NoteLike { id: string; title?: string; content?: string; folderId?: string | null; tagIds?: string[]; updatedAt?: number }
interface Chunk { noteId: string; key: string; title: string; heading: string; content: string; metadata: Record<string, unknown>; hash: string }

function chunksFromNote(note: NoteLike): Chunk[] {
  const content = String(note.content || '');
  const lines = content.split(/\r?\n/);
  const chunks: Array<{ heading: string; lines: string[] }> = [];
  let current = { heading: '', lines: [] as string[] };
  for (const line of lines) {
    const heading = line.match(/^#{1,3}\s+(.+)$/)?.[1]?.trim();
    if (heading && current.lines.join('\n').trim()) { chunks.push(current); current = { heading, lines: [] }; }
    else if (heading) current.heading = heading;
    else current.lines.push(line);
  }
  if (current.lines.join('\n').trim() || chunks.length === 0) chunks.push(current);
  return chunks.map((part, index) => {
    const text = part.lines.join('\n').trim().slice(0, 12000);
    const value = `${note.title || 'Sans titre'}\n${part.heading}\n${text}`;
    return {
      noteId: note.id, key: String(index), title: String(note.title || 'Sans titre'),
      heading: part.heading, content: text,
      metadata: { folderId: note.folderId ?? null, tagIds: note.tagIds ?? [], updatedAt: note.updatedAt ?? 0 },
      hash: createHash('sha256').update(value).digest('hex'),
    };
  });
}

async function embeddings(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const base = (process.env.OLLAMA_URL || 'http://192.168.1.47:11434/v1').replace(/\/$/, '');
  const keepAlive = process.env.OLLAMA_KEEP_ALIVE || -1;
  const response = await fetch(`${base}/embeddings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.EMBEDDING_MODEL || 'qwen3-embedding:0.6b-8k',
      input: texts,
      keep_alive: keepAlive,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) throw new Error(`Ollama embeddings HTTP ${response.status}`);
  const body = await response.json() as { data?: Array<{ index?: number; embedding: number[] }> };
  if (!Array.isArray(body.data) || body.data.length !== texts.length) throw new Error('Réponse embeddings invalide');
  return [...body.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((item) => item.embedding);
}

export async function indexWorkspace(client: PoolClient, userId: string, state: any, expectedVersion: number): Promise<void> {
  // Sérialise les indexations d'un même utilisateur sans bloquer les saves.
  // Une version devenue obsolète pendant le calcul des embeddings est jetée.
  await client.query('SELECT pg_advisory_lock(hashtext($1))', [userId]);
  try {
  const chunks = (Array.isArray(state.notes) ? state.notes : []).flatMap(chunksFromNote);
  const current = await client.query('SELECT version FROM workspaces WHERE user_id=$1', [userId]);
  if (!current.rowCount || Number(current.rows[0].version) !== expectedVersion) return;
  const existingResult = await client.query('SELECT note_id,chunk_key,content_hash FROM note_chunks WHERE user_id=$1', [userId]);
  const existing = new Map(existingResult.rows.map((r) => [`${r.note_id}:${r.chunk_key}`, r.content_hash]));
  const changed = chunks.filter((c) => existing.get(`${c.noteId}:${c.key}`) !== c.hash);
  const vectors: number[][] = [];
  for (let i = 0; i < changed.length; i += 24) {
    vectors.push(...await embeddings(changed.slice(i, i + 24).map((c) => `${c.title}\n${c.heading}\n${c.content}`)));
  }
  const latest = await client.query('SELECT version FROM workspaces WHERE user_id=$1', [userId]);
  if (!latest.rowCount || Number(latest.rows[0].version) !== expectedVersion) return;
  const activeKeys = new Set(chunks.map((c) => `${c.noteId}:${c.key}`));
  for (const [key] of existing) {
    if (!activeKeys.has(key)) {
      const [noteId, chunkKey] = key.split(':');
      await client.query('DELETE FROM note_chunks WHERE user_id=$1 AND note_id=$2 AND chunk_key=$3', [userId, noteId, chunkKey]);
    }
  }
  for (let i = 0; i < changed.length; i++) {
    const c = changed[i];
    await client.query(
      `INSERT INTO note_chunks(user_id,note_id,chunk_key,note_title,heading,content,metadata,content_hash,embedding,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::vector,now())
       ON CONFLICT(user_id,note_id,chunk_key) DO UPDATE SET note_title=EXCLUDED.note_title,heading=EXCLUDED.heading,
       content=EXCLUDED.content,metadata=EXCLUDED.metadata,content_hash=EXCLUDED.content_hash,embedding=EXCLUDED.embedding,updated_at=now()`,
      [userId, c.noteId, c.key, c.title, c.heading, c.content, c.metadata, c.hash, `[${vectors[i].join(',')}]`],
    );
  }
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', [userId]);
  }
}

export async function hybridSearch(userId: string, query: string, limit = 6) {
  const [queryVector] = await embeddings([query]);
  const result = await pool.query(
    `WITH semantic AS (
       SELECT id,row_number() OVER(ORDER BY embedding <=> $2::vector) rank FROM note_chunks WHERE user_id=$1 AND embedding IS NOT NULL LIMIT 30
     ), lexical AS (
       SELECT id,row_number() OVER(ORDER BY ts_rank_cd(to_tsvector('simple',note_title||' '||heading||' '||content),plainto_tsquery('simple',$3)) DESC) rank
       FROM note_chunks WHERE user_id=$1 AND to_tsvector('simple',note_title||' '||heading||' '||content) @@ plainto_tsquery('simple',$3) LIMIT 30
     ), scores AS (
       SELECT id,sum(score) score FROM (
         SELECT id,1.0/(60+rank) score FROM semantic UNION ALL SELECT id,1.15/(60+rank) score FROM lexical
       ) x GROUP BY id
     )
     SELECT n.note_id,n.note_title,n.heading,n.content,n.metadata,s.score FROM scores s JOIN note_chunks n ON n.id=s.id
     ORDER BY s.score DESC LIMIT $4`,
    [userId, `[${queryVector.join(',')}]`, query, limit],
  );
  return result.rows;
}
