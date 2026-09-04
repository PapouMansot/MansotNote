/**
 * Récupération de contexte (RAG local) — chunking + BM25 + métadonnées.
 * -----------------------------------------------------------------------
 * Aucune donnée ne quitte la machine : pas d'embeddings distants, donc le
 * modèle zero-knowledge de MansotNote reste intact.
 *
 * Pipeline :
 *   1. `chunkNote`      découpe une note en passages par titres Markdown
 *   2. `buildChunks`    applique les filtres de métadonnées (tags, dossier…)
 *   3. `searchChunks`   classe les passages par pertinence BM25
 *   4. `buildRagContext` assemble un contexte cité, borné en caractères
 *
 * BM25 est retenu plutôt qu'un simple `includes()` car il pondère les termes
 * rares (discriminants) et compense la longueur des passages : une note de
 * 5000 mots ne domine plus mécaniquement une note courte et précise.
 */
import type { Note, Tag, Folder, ID } from '@/types';
import type { AiConfig } from '@/lib/ai';
import { embedTexts } from '@/lib/ai';
import { normalize } from '@/lib/search';

/** Passage indexable issu d'une note, avec ses métadonnées de filtrage. */
export interface Chunk {
  id: string;
  noteId: ID;
  noteTitle: string;
  /** Titre de section (heading Markdown) dont provient le passage. */
  heading: string;
  text: string;
  tagIds: ID[];
  folderId: ID | null;
  updatedAt: number;
}

export interface RetrievedChunk extends Chunk {
  score: number;
}

/** Filtres de métadonnées appliqués avant le classement. */
export interface RetrievalFilters {
  /** Ne garder que les notes portant TOUS ces tags. */
  tagIds?: ID[];
  /** Restreindre à un dossier. */
  folderId?: ID | null;
  /** Exclure les notes archivées (défaut : true). */
  excludeArchived?: boolean;
  /** Ne garder que les notes modifiées après cet horodatage. */
  updatedAfter?: number;
}

/** Mots vides français/anglais : trop fréquents pour être discriminants. */
const STOP_WORDS = new Set([
  'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'et', 'ou', 'a', 'au',
  'aux', 'ce', 'ces', 'cette', 'dans', 'en', 'est', 'il', 'elle', 'je', 'tu',
  'nous', 'vous', 'ils', 'pour', 'par', 'sur', 'que', 'qui', 'quoi', 'sa',
  'son', 'ses', 'mon', 'ma', 'mes', 'plus', 'pas', 'ne', 'se', 'sont', 'avec',
  'the', 'of', 'and', 'to', 'in', 'is', 'it', 'for', 'on', 'with', 'as', 'at',
]);

/** Découpe un texte en termes normalisés, hors mots vides. */
export function tokenize(text: string): string[] {
  return normalize(text)
    .split(/[^a-z0-9à-ÿ]+/i)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

/** Cible de taille d'un passage, en caractères. */
const CHUNK_TARGET = 1200;

/**
 * Découpe une note en passages.
 *
 * Le découpage suit les titres Markdown : un passage garde ainsi une unité
 * sémantique et le titre sert de citation lisible. Les sections trop longues
 * sont recoupées sur les paragraphes, jamais en plein milieu d'une phrase.
 */
export function chunkNote(note: Note): Chunk[] {
  const chunks: Chunk[] = [];
  const lines = note.content.split('\n');

  let heading = '';
  let buffer: string[] = [];
  let index = 0;

  const flush = () => {
    const text = buffer.join('\n').trim();
    buffer = [];
    if (text === '') return;

    // Recoupe une section trop longue sur les paragraphes.
    const parts: string[] = [];
    if (text.length <= CHUNK_TARGET) {
      parts.push(text);
    } else {
      let current = '';
      for (const para of text.split(/\n{2,}/)) {
        if (current !== '' && (current.length + para.length) > CHUNK_TARGET) {
          parts.push(current.trim());
          current = para;
        } else {
          current = current === '' ? para : `${current}\n\n${para}`;
        }
      }
      if (current.trim() !== '') parts.push(current.trim());
    }

    for (const part of parts) {
      chunks.push({
        id: `${note.id}#${index++}`,
        noteId: note.id,
        noteTitle: note.title,
        heading: heading || note.title,
        text: part,
        tagIds: note.tagIds,
        folderId: note.folderId,
        updatedAt: note.updatedAt,
      });
    }
  };

  for (const line of lines) {
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flush();
      heading = h[2].trim();
      continue;
    }
    buffer.push(line);
  }
  flush();

  return chunks;
}

/** Construit l'index de passages à partir des notes, filtres appliqués. */
export function buildChunks(notes: Note[], filters: RetrievalFilters = {}): Chunk[] {
  const { excludeArchived = true } = filters;

  return notes
    .filter((note) => {
      if (excludeArchived && note.archived === true) return false;
      if (filters.folderId !== undefined && note.folderId !== filters.folderId) return false;
      if (filters.updatedAfter !== undefined && note.updatedAt < filters.updatedAfter) return false;
      if (filters.tagIds && filters.tagIds.length > 0) {
        if (!filters.tagIds.every((t) => note.tagIds.includes(t))) return false;
      }
      return true;
    })
    .flatMap(chunkNote);
}

const BM25_K1 = 1.5; // saturation de la fréquence d'un terme
const BM25_B = 0.75; // force de la normalisation par la longueur

/**
 * Classe les passages par pertinence BM25.
 *
 * Un terme présent dans peu de passages pèse davantage (IDF), et la
 * normalisation par la longueur empêche les passages longs de l'emporter
 * uniquement parce qu'ils contiennent plus de mots.
 */
export function searchChunks(
  chunks: Chunk[],
  query: string,
  limit = 6,
): RetrievedChunk[] {
  const terms = tokenize(query);
  if (terms.length === 0 || chunks.length === 0) return [];

  // Le titre est répété : une correspondance dans le titre est plus parlante.
  const docs = chunks.map((c) => tokenize(`${c.heading} ${c.heading} ${c.text}`));
  const avgLen = docs.reduce((sum, d) => sum + d.length, 0) / docs.length;

  // Nombre de passages contenant chaque terme (pour l'IDF).
  const df = new Map<string, number>();
  for (const doc of docs) {
    for (const term of new Set(doc)) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }

  const scored = chunks.map((chunk, i) => {
    const doc = docs[i];
    const freq = new Map<string, number>();
    for (const t of doc) freq.set(t, (freq.get(t) ?? 0) + 1);

    let score = 0;
    for (const term of terms) {
      const f = freq.get(term);
      if (f === undefined) continue;
      const n = df.get(term) ?? 0;
      // IDF lissé, toujours positif.
      const idf = Math.log(1 + (chunks.length - n + 0.5) / (n + 0.5));
      const norm = f * (BM25_K1 + 1) /
        (f + BM25_K1 * (1 - BM25_B + BM25_B * (doc.length / avgLen)));
      score += idf * norm;
    }
    return { ...chunk, score };
  });

  return scored
    .filter((c) => c.score > 0)
    .sort((a, b) => (b.score - a.score) || (b.updatedAt - a.updatedAt))
    .slice(0, limit);
}

/** Similarité cosinus bornée [-1, 1], 0 si les dimensions diffèrent. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Récupération hybride : BM25 + embeddings.
 *
 * La fusion par rang réciproque (RRF) évite de comparer directement des
 * échelles incompatibles (score BM25 vs cosinus). Elle est robuste même si
 * un moteur produit des scores très concentrés. BM25 est légèrement favorisé
 * pour conserver la précision sur les termes exacts, tandis que l'embedding
 * récupère les formulations sémantiquement proches.
 */
export async function searchChunksHybrid(
  chunks: Chunk[],
  query: string,
  embeddingConfig: AiConfig,
  limit = 6,
): Promise<RetrievedChunk[]> {
  if (chunks.length === 0 || query.trim() === '') return [];

  // On prend davantage de candidats BM25 avant la fusion.
  const bm25 = searchChunks(chunks, query, Math.max(limit * 4, 20));
  const [queryVector, ...chunkVectors] = await embedTexts(
    embeddingConfig,
    [query, ...chunks.map((c) => `${c.noteTitle}\n${c.heading}\n${c.text}`)],
  );

  const semantic = chunks
    .map((chunk, index) => ({
      ...chunk,
      score: cosineSimilarity(queryVector, chunkVectors[index]),
    }))
    // Les embeddings normalisés peuvent avoir une similarité négative ; on
    // ne garde que les candidats positifs.
    .filter((item) => item.score > 0)
    .sort((a, b) => (b.score - a.score) || (b.updatedAt - a.updatedAt));

  const merged = new Map<string, RetrievedChunk>();
  const rrf = new Map<string, number>();
  const RRF_K = 60;

  bm25.forEach((item, rank) => {
    merged.set(item.id, item);
    rrf.set(item.id, (rrf.get(item.id) ?? 0) + 1.15 / (RRF_K + rank + 1));
  });
  semantic.forEach((item, rank) => {
    merged.set(item.id, item);
    rrf.set(item.id, (rrf.get(item.id) ?? 0) + 1 / (RRF_K + rank + 1));
  });

  return [...merged.values()]
    .map((item) => ({ ...item, score: rrf.get(item.id) ?? 0 }))
    .sort((a, b) => (b.score - a.score) || (b.updatedAt - a.updatedAt))
    .slice(0, limit);
}

/** Budget de caractères du contexte injecté dans le prompt. */
const CONTEXT_BUDGET = 6000;

/**
 * Assemble un contexte citable pour le modèle.
 *
 * Chaque extrait est numéroté afin que la réponse puisse citer sa source,
 * et l'ensemble est borné pour ne pas saturer la fenêtre de contexte.
 */
export function buildRagContext(
  results: RetrievedChunk[],
  tags: Tag[] = [],
  folders: Folder[] = [],
): { context: string; sources: RetrievedChunk[] } {
  if (results.length === 0) {
    return { context: '', sources: [] };
  }

  const tagName = new Map(tags.map((t) => [t.id, t.name]));
  const folderName = new Map(folders.map((f) => [f.id, f.name]));

  const parts: string[] = [];
  const used: RetrievedChunk[] = [];
  let budget = CONTEXT_BUDGET;

  results.forEach((r, i) => {
    const meta = [
      r.noteTitle !== r.heading ? `note: ${r.noteTitle}` : null,
      `section: ${r.heading}`,
      r.folderId ? `dossier: ${folderName.get(r.folderId) ?? r.folderId}` : null,
      r.tagIds.length > 0
        ? `tags: ${r.tagIds.map((t) => tagName.get(t) ?? t).join(', ')}`
        : null,
    ].filter(Boolean).join(' | ');

    const block = `[${i + 1}] (${meta})\n${r.text}`;
    if (block.length > budget) return;
    budget -= block.length;
    parts.push(block);
    used.push(r);
  });

  return {
    context: [
      'EXTRAITS DES NOTES DE L\'UTILISATEUR (source de vérité) :',
      ...parts,
      '',
      'Réponds en te fondant sur ces extraits et cite tes sources avec [n].',
      'Si les extraits ne suffisent pas, dis-le explicitement.',
    ].join('\n\n'),
    sources: used,
  };
}

/** Raccourci : des notes + une question vers un contexte prêt à l'emploi. */
export function retrieveContext(
  notes: Note[],
  query: string,
  options: { filters?: RetrievalFilters; limit?: number; tags?: Tag[]; folders?: Folder[] } = {},
): { context: string; sources: RetrievedChunk[]; mode: 'bm25' } {
  const chunks = buildChunks(notes, options.filters);
  const results = searchChunks(chunks, query, options.limit ?? 6);
  return { ...buildRagContext(results, options.tags ?? [], options.folders ?? []), mode: 'bm25' };
}

/**
 * Raccourci asynchrone hybride avec repli automatique BM25.
 * Une panne du modèle d'embedding ne doit jamais bloquer le Copilote.
 */
async function retrieveServerContext(query: string, limit: number): Promise<{
  context: string;
  sources: RetrievedChunk[];
} | null> {
  try {
    const response = await fetch('/api/rag/search', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, limit }),
    });
    if (!response.ok) return null;
    const payload = await response.json() as { results?: Array<{
      note_id: string; note_title: string; heading: string; content: string;
      metadata?: { tagIds?: string[]; folderId?: string | null; updatedAt?: number };
      score: number;
    }> };
    if (!Array.isArray(payload.results) || payload.results.length === 0) return null;
    const sources: RetrievedChunk[] = payload.results.map((item, index) => ({
      id: `server:${item.note_id}:${index}`, noteId: item.note_id,
      noteTitle: item.note_title, heading: item.heading || '', text: item.content,
      tagIds: item.metadata?.tagIds ?? [], folderId: item.metadata?.folderId ?? null,
      updatedAt: item.metadata?.updatedAt ?? 0, score: Number(item.score),
    }));
    return buildRagContext(sources);
  } catch { return null; }
}

export async function retrieveContextHybrid(
  notes: Note[],
  query: string,
  options: {
    embeddingConfig?: AiConfig;
    filters?: RetrievalFilters;
    limit?: number;
    tags?: Tag[];
    folders?: Folder[];
  } = {},
): Promise<{
  context: string;
  sources: RetrievedChunk[];
  mode: 'hybrid' | 'bm25';
  embeddingError?: string;
}> {
  const chunks = buildChunks(notes, options.filters);
  const limit = options.limit ?? 6;
  // En production authentifiée, PostgreSQL/pgvector est partagé entre tous
  // les appareils. En local/tests ou en cas de panne, on retombe sur le RAG
  // navigateur historique sans interrompre le Copilote.
  const server = typeof window !== 'undefined' ? await retrieveServerContext(query, limit) : null;
  if (server) return { ...server, mode: 'hybrid' };
  if (!options.embeddingConfig || options.embeddingConfig.model.trim() === '') {
    const results = searchChunks(chunks, query, limit);
    return {
      ...buildRagContext(results, options.tags ?? [], options.folders ?? []),
      mode: 'bm25',
    };
  }

  try {
    const results = await searchChunksHybrid(chunks, query, options.embeddingConfig, limit);
    return {
      ...buildRagContext(results, options.tags ?? [], options.folders ?? []),
      mode: 'hybrid',
    };
  } catch (error) {
    const results = searchChunks(chunks, query, limit);
    return {
      ...buildRagContext(results, options.tags ?? [], options.folders ?? []),
      mode: 'bm25',
      embeddingError: error instanceof Error ? error.message : 'Embeddings indisponibles',
    };
  }
}
