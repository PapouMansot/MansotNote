import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { pool, assertDatabase } from './db.js';
import { migrate } from './migrate.js';
import { hybridSearch, indexWorkspace } from './rag.js';
import { assembleWorkspaceFromDb, syncWorkspaceToRelational } from './relational-sync.js';
import {
  MAX_CHILD_TOKENS,
  normalizePermissions,
  validateChildPolicy,
  validatePolicy,
  type TokenPermissions,
  type TokenPolicy,
} from './token-policy.js';
import {
  createSessionToken,
  hashPassword,
  hashSessionToken,
  normalizeUsername,
  verifyPassword,
} from './security.js';

const PORT = Number(process.env.PORT || 3000);
const SESSION_COOKIE = 'mansot_session';
const SESSION_DAYS = Math.max(1, Number(process.env.SESSION_DAYS || 30));
const isProduction = process.env.NODE_ENV === 'production';

const app = express();
app.set('trust proxy', ['loopback', 'linklocal', 'uniquelocal']);
// L'API ne sert que du JSON : une CSP verrouillée est sans risque ici et
// neutralise tout rendu de contenu injecté dans une réponse d'erreur.
app.use(helmet({
  contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"] } },
  crossOriginResourcePolicy: { policy: 'same-origin' },
  referrerPolicy: { policy: 'no-referrer' },
  hsts: isProduction ? { maxAge: 63072000, includeSubDomains: true } : false,
}));
app.disable('x-powered-by');
app.use(express.json({ limit: '15mb' }));
app.use(cookieParser());

const credentialsSchema = z.object({
  username: z.string().trim().min(1).max(80),
  password: z.string().min(10).max(512),
});
const workspaceSchema = z.object({
  state: z.object({
    schemaVersion: z.number(), notes: z.array(z.unknown()), folders: z.array(z.unknown()),
    tags: z.array(z.unknown()), columns: z.array(z.unknown()), cards: z.array(z.unknown()),
    labels: z.array(z.unknown()), settings: z.record(z.string(), z.unknown()),
    savedAt: z.number(), seed: z.unknown().nullable(),
  }).passthrough(),
  expectedVersion: z.number().int().nonnegative().optional(),
});

export interface ApiTokenData {
  id: string;
  name: string;
  permissions: TokenPermissions;
  allowedFolderIds: string[];
  deniedTagIds: string[];
  autoTagId: string | null;
  /**
   * Dossiers réellement accessibles (dossiers autorisés + sous-dossiers),
   * résolus à chaque requête. null = aucune restriction ; [] = aucun dossier
   * accessible (dossier autorisé supprimé) : le jeton ne voit alors rien.
   */
  folderScope: string[] | null;
}

type AuthRequest = Request & {
  user?: { id: string; username: string };
  sessionToken?: string;
  authMethod?: 'session' | 'api_token';
  apiToken?: ApiTokenData;
};

/** Dossiers autorisés + tous leurs sous-dossiers existants. */
async function resolveFolderScope(userId: string, rootIds: string[]): Promise<string[]> {
  const result = await pool.query(
    `WITH RECURSIVE tree AS (
       SELECT id FROM folders WHERE user_id=$1 AND id = ANY($2::text[])
       UNION
       SELECT f.id FROM folders f JOIN tree t ON f.parent_id = t.id WHERE f.user_id=$1
     )
     SELECT id FROM tree`,
    [userId, rootIds],
  );
  return result.rows.map((r) => String(r.id));
}

/** Périmètre de dossiers du jeton : null = sans restriction (session ou jeton global). */
function folderScopeOf(req: AuthRequest): string[] | null {
  return req.apiToken?.folderScope ?? null;
}

function deniedTagsOf(req: AuthRequest): string[] | null {
  const denied = req.apiToken?.deniedTagIds;
  return denied && denied.length > 0 ? denied : null;
}

function inFolderScope(req: AuthRequest, folderId: string | null | undefined): boolean {
  const scope = folderScopeOf(req);
  return scope === null || (typeof folderId === 'string' && scope.includes(folderId));
}

function hasDeniedTag(req: AuthRequest, tagIds: unknown): boolean {
  const denied = deniedTagsOf(req);
  if (!denied) return false;
  return Array.isArray(tagIds) && tagIds.some((t) => denied.includes(String(t)));
}

/** Routes réservées à l'application web : un jeton de bot n'y a jamais accès. */
function requireSession(req: AuthRequest, res: Response): boolean {
  if (req.authMethod === 'session') return true;
  res.status(403).json({ error: 'Session navigateur requise' });
  return false;
}

async function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  // 1. Vérification Bearer Token (Extension Web Clipper, Webhooks, CLI)
  const authHeader = req.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const bearerToken = authHeader.slice(7).trim();
    if (bearerToken.length >= 20) {
      const tokenHash = hashSessionToken(bearerToken);
      const tokenResult = await pool.query(
        `SELECT u.id, u.username, t.id as token_id, t.name, t.permissions,
                t.allowed_folder_ids as "allowedFolderIds",
                t.denied_tag_ids as "deniedTagIds",
                t.auto_tag_id as "autoTagId"
         FROM api_tokens t
         JOIN users u ON u.id = t.user_id
         WHERE t.token_hash = $1
           AND (t.expires_at IS NULL OR t.expires_at > now())
           AND u.disabled_at IS NULL`,
        [tokenHash],
      );

      if (tokenResult.rowCount) {
        const row = tokenResult.rows[0];
        req.user = { id: row.id, username: row.username };
        req.authMethod = 'api_token';
        req.apiToken = {
          id: row.token_id,
          name: row.name,
          permissions: normalizePermissions(row.permissions),
          allowedFolderIds: Array.isArray(row.allowedFolderIds) ? row.allowedFolderIds : [],
          deniedTagIds: Array.isArray(row.deniedTagIds) ? row.deniedTagIds : [],
          autoTagId: typeof row.autoTagId === 'string' ? row.autoTagId : null,
          folderScope: null,
        };
        if (req.apiToken.allowedFolderIds.length > 0) {
          req.apiToken.folderScope = await resolveFolderScope(row.id, req.apiToken.allowedFolderIds);
        }
        // Met à jour la date de dernière utilisation en arrière-plan
        void pool.query('UPDATE api_tokens SET last_used_at=now() WHERE id=$1', [row.token_id]);
        return next();
      }
    }
  }

  // 2. Vérification Cookie de Session Navigateur
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== 'string' || token.length < 20) return res.status(401).json({ error: 'Authentification requise' });
  const result = await pool.query(
    `SELECT u.id, u.username FROM sessions s JOIN users u ON u.id=s.user_id
     WHERE s.token_hash=$1 AND s.expires_at>now() AND u.disabled_at IS NULL`,
    [hashSessionToken(token)],
  );
  if (!result.rowCount) return res.status(401).json({ error: 'Session expirée' });
  req.user = result.rows[0]; req.sessionToken = token; req.authMethod = 'session';
  await pool.query('UPDATE sessions SET last_seen_at=now() WHERE token_hash=$1', [hashSessionToken(token)]);
  next();
}

const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false });
// Sauvegardes et lectures : large pour l'autosave, borné contre l'abus.
const dataLimiter = rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: true, legacyHeaders: false });
// Le RAG déclenche des embeddings Ollama : plafond nettement plus strict.
const ragLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });
// Générations IA : limite dédiée pour empêcher un token volé de saturer le GPU.
const aiLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });

const ALLOWED_AI_MODELS = new Set(
  (process.env.ALLOWED_AI_MODELS || 'qwen3.8:9b-q6-32k')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'qwen3-embedding:0.6b-8k';
const OLLAMA_HOST = (process.env.OLLAMA_URL || 'http://ollama:11434/v1')
  .replace(/\/v1\/?$/, '')
  .replace(/\/+$/, '');
// Contexte maximum du modèle. Sans `num_ctx`, Ollama applique son défaut
// (4096 tokens) et tronque silencieusement les prompts du copilote, qui
// dépassent vite 4k tokens (note active + RAG + historique).
const OLLAMA_NUM_CTX = Math.max(2048, Number(process.env.OLLAMA_NUM_CTX || 16384));

function isAllowedAiModel(model: string): boolean {
  return ALLOWED_AI_MODELS.has(model);
}

// File d'indexation RAG : une seule indexation active par utilisateur.
// Sans sérialisation, chaque autosave (1,5 s) lance une indexation qui retient
// un client du pool PostgreSQL sur le pg_advisory_lock pendant toute la durée
// des appels Ollama : les indexations s'empilent, le pool (10 clients) s'épuise
// et les autosaves suivants échouent en 500.
const indexQueues = new Map<string, Promise<void>>();

function enqueueWorkspaceIndex(userId: string, state: unknown, version: number): void {
  const previous = indexQueues.get(userId) ?? Promise.resolve();
  const run = previous
    .catch(() => undefined)
    .then(async () => {
      const client = await pool.connect();
      try {
        await indexWorkspace(client, userId, state, version);
      } catch (error) {
        console.error('[rag] indexation différée:', error instanceof Error ? error.message : error);
      } finally {
        client.release();
      }
    });
  indexQueues.set(userId, run);
  void run.catch(() => undefined).finally(() => {
    if (indexQueues.get(userId) === run) indexQueues.delete(userId);
  });
}

app.get('/health', async (_req, res) => {
  try { await assertDatabase(); res.json({ ok: true }); }
  catch { res.status(503).json({ ok: false }); }
});

app.post('/auth/login', loginLimiter, async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Identifiants invalides' });
  const result = await pool.query(
    'SELECT id,username,password_hash FROM users WHERE username_normalized=$1 AND disabled_at IS NULL',
    [normalizeUsername(parsed.data.username)],
  );
  const user = result.rows[0];
  if (!user || !(await verifyPassword(parsed.data.password, user.password_hash))) {
    return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect' });
  }
  const token = createSessionToken();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM sessions WHERE expires_at<=now()');
    await client.query(
      `INSERT INTO sessions(user_id,token_hash,expires_at,ip,user_agent)
       VALUES($1,$2,now()+($3 || ' days')::interval,$4,$5)`,
      [user.id, hashSessionToken(token), SESSION_DAYS, req.ip, req.get('user-agent')?.slice(0, 500)],
    );
    // Conserve au maximum les dix connexions les plus récentes du compte.
    await client.query(
      `DELETE FROM sessions WHERE user_id=$1 AND id NOT IN (
         SELECT id FROM sessions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10
       )`,
      [user.id],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, secure: isProduction, sameSite: 'strict', path: '/', maxAge: SESSION_DAYS * 86400000 });
  res.json({ user: { id: user.id, username: user.username } });
});

app.post('/auth/logout', authenticate, async (req: AuthRequest, res) => {
  if (req.authMethod === 'session' && req.sessionToken) {
    await pool.query('DELETE FROM sessions WHERE token_hash=$1', [hashSessionToken(req.sessionToken)]);
  }
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: isProduction, sameSite: 'strict', path: '/' });
  res.status(204).end();
});
app.get('/auth/session', authenticate, (req: AuthRequest, res) => res.json({ user: req.user }));

// Sous-requête Nginx (`auth_request`) protégeant le relais Ollama : sans session
// valide, aucune requête n'atteint le serveur d'inférence.
app.get('/auth/verify', authenticate, (_req: AuthRequest, res) => res.status(204).end());
app.post('/auth/change-password', authenticate, loginLimiter, async (req: AuthRequest, res) => {
  if (req.authMethod !== 'session' || !req.sessionToken) {
    return res.status(403).json({ error: 'Une session navigateur est requise pour changer le mot de passe' });
  }
  const parsed = z.object({ currentPassword: z.string().min(10).max(512), newPassword: z.string().min(12).max(512) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Mot de passe invalide (12 caractères minimum)' });
  const result = await pool.query('SELECT password_hash FROM users WHERE id=$1', [req.user!.id]);
  if (!result.rowCount || !(await verifyPassword(parsed.data.currentPassword, result.rows[0].password_hash))) {
    return res.status(401).json({ error: 'Mot de passe actuel incorrect' });
  }
  const passwordHash = await hashPassword(parsed.data.newPassword);
  await pool.query('UPDATE users SET password_hash=$1,updated_at=now() WHERE id=$2', [passwordHash, req.user!.id]);
  // Révoque les autres appareils, conserve la session courante.
  await pool.query('DELETE FROM sessions WHERE user_id=$1 AND token_hash<>$2', [req.user!.id, hashSessionToken(req.sessionToken!)]);
  res.status(204).end();
});

app.get('/workspace', dataLimiter, authenticate, async (req: AuthRequest, res) => {
  // L'état complet contient toutes les notes et les réglages (clé IA) :
  // jamais accessible à un jeton, qui passe par l'API filtrée /api/v1/notes.
  if (!requireSession(req, res)) return;
  const relationalResult = await assembleWorkspaceFromDb(pool, req.user!.id);
  if (relationalResult) {
    return res.json(relationalResult);
  }
  const result = await pool.query('SELECT state,version,updated_at FROM workspaces WHERE user_id=$1', [req.user!.id]);
  if (!result.rowCount) return res.json({ state: null, version: 0 });
  res.json({ state: result.rows[0].state, version: Number(result.rows[0].version), updatedAt: result.rows[0].updated_at });
});

app.put('/workspace', dataLimiter, authenticate, async (req: AuthRequest, res) => {
  if (!requireSession(req, res)) return;
  const parsed = workspaceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Workspace invalide' });
  const { state, expectedVersion } = parsed.data;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query('SELECT version FROM workspaces WHERE user_id=$1 FOR UPDATE', [req.user!.id]);
    const version = current.rowCount ? Number(current.rows[0].version) : 0;
    if (expectedVersion !== undefined && expectedVersion !== version) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Conflit de synchronisation', version });
    }
    const nextVersion = version + 1;

    // Synchronise dans les tables relationnelles Supabase (notes, folders, tags, kanban)
    await syncWorkspaceToRelational(client, req.user!.id, state);

    await client.query(
      `INSERT INTO workspaces(user_id,state,version,updated_at) VALUES($1,$2,$3,now())
       ON CONFLICT(user_id) DO UPDATE SET state=EXCLUDED.state,version=EXCLUDED.version,updated_at=now()`,
      [req.user!.id, state, nextVersion],
    );
    await client.query('COMMIT');
    // L'index est dérivé du workspace : la réponse d'autosave ne doit pas
    // attendre Ollama. L'indexation continue en arrière-plan (sérielle par
    // utilisateur, voir enqueueWorkspaceIndex) et une panne ne remet jamais
    // en cause la sauvegarde PostgreSQL déjà commitée.
    enqueueWorkspaceIndex(req.user!.id, state, nextVersion);
    res.json({ version: nextVersion });
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
});

// ==========================================
// API REST individuelle pour les Notes (Supabase)
// ==========================================
// Une note est visible par un jeton si elle est dans son périmètre de dossiers
// et ne porte aucun tag interdit. Sinon : 404, pour ne pas révéler qu'elle existe.
const NOTE_COLUMNS = 'id, folder_id as "folderId", title, content, tag_ids as "tagIds", pinned, archived, archived_at as "archivedAt", created_at as "createdAt", updated_at as "updatedAt"';

app.get(['/api/v1/notes', '/v1/notes'], dataLimiter, authenticate, async (req: AuthRequest, res) => {
  if (req.apiToken && !req.apiToken.permissions.read) {
    return res.status(403).json({ error: 'Permission de lecture refusée pour ce jeton' });
  }
  const notes = await pool.query(
    `SELECT ${NOTE_COLUMNS}
     FROM notes
     WHERE user_id=$1
       AND ($2::text[] IS NULL OR folder_id = ANY($2::text[]))
       AND ($3::text[] IS NULL OR NOT (tag_ids ?| $3::text[]))
     ORDER BY updated_at DESC`,
    [req.user!.id, folderScopeOf(req), deniedTagsOf(req)],
  );
  res.json(notes.rows);
});

app.get(['/api/v1/notes/:id', '/v1/notes/:id'], dataLimiter, authenticate, async (req: AuthRequest, res) => {
  if (req.apiToken && !req.apiToken.permissions.read) {
    return res.status(403).json({ error: 'Permission de lecture refusée pour ce jeton' });
  }
  const note = await pool.query(
    `SELECT ${NOTE_COLUMNS}
     FROM notes
     WHERE user_id=$1 AND id=$2
       AND ($3::text[] IS NULL OR folder_id = ANY($3::text[]))
       AND ($4::text[] IS NULL OR NOT (tag_ids ?| $4::text[]))`,
    [req.user!.id, req.params.id, folderScopeOf(req), deniedTagsOf(req)],
  );
  if (!note.rowCount) return res.status(404).json({ error: 'Note introuvable' });
  res.json(note.rows[0]);
});

/**
 * Verrouille la ligne workspace AVANT de toucher aux notes. PUT /workspace
 * prend les verrous dans le même ordre (workspace puis notes) : aucun
 * interblocage possible entre un bot et l'onglet ouvert.
 */
async function lockWorkspace(client: PoolClient, userId: string): Promise<number> {
  const result = await client.query('SELECT version FROM workspaces WHERE user_id=$1 FOR UPDATE', [userId]);
  return result.rowCount ? Number(result.rows[0].version) : 0;
}

/**
 * Reconstruit l'état JSON depuis les tables et incrémente la version. Le
 * navigateur recevra un 409 à sa prochaine sauvegarde et fusionnera.
 */
async function publishWorkspace(client: PoolClient, userId: string, version: number) {
  const assembled = await assembleWorkspaceFromDb(client, userId);
  if (!assembled) return null;
  const nextVersion = version + 1;
  await client.query(
    'UPDATE workspaces SET state=$2, version=$3, updated_at=now() WHERE user_id=$1',
    [userId, assembled.state, nextVersion],
  );
  return { state: assembled.state, version: nextVersion };
}

const createNoteSchema = z.object({
  title: z.string().trim().max(500).optional(),
  content: z.string().max(2_000_000).default(''),
  folderId: z.string().nullable().optional(),
  tagIds: z.array(z.string()).max(50).optional(),
  pinned: z.boolean().optional().default(false),
});

app.post(['/api/v1/notes', '/v1/notes'], dataLimiter, authenticate, async (req: AuthRequest, res) => {
  if (req.apiToken && !req.apiToken.permissions.write) {
    return res.status(403).json({ error: "Permission d'écriture refusée pour ce jeton" });
  }
  const parsed = createNoteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Données de note invalides', details: parsed.error.issues });
  }
  let folderId = parsed.data.folderId ?? null;
  const tagIds = [...new Set(parsed.data.tagIds ?? [])];
  if (req.apiToken) {
    const scope = folderScopeOf(req);
    if (scope !== null && folderId === null) {
      // Dossier par défaut : le premier dossier configuré qui existe encore.
      folderId = req.apiToken.allowedFolderIds.find((id) => scope.includes(id)) ?? null;
    }
    if (!inFolderScope(req, folderId)) {
      return res.status(403).json({ error: "Ce jeton n'est pas autorisé à écrire dans ce dossier" });
    }
    if (req.apiToken.autoTagId && !tagIds.includes(req.apiToken.autoTagId)) {
      tagIds.push(req.apiToken.autoTagId);
    }
    if (hasDeniedTag(req, tagIds)) {
      return res.status(403).json({ error: 'Ce jeton ne peut pas utiliser un tag interdit' });
    }
  }

  const now = Date.now();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const version = await lockWorkspace(client, req.user!.id);
    const result = await client.query(
      `INSERT INTO notes (id, user_id, folder_id, title, content, tag_ids, pinned, archived, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, false, $8, $8)
       RETURNING ${NOTE_COLUMNS}`,
      [randomUUID(), req.user!.id, folderId, parsed.data.title || 'Sans titre', parsed.data.content, JSON.stringify(tagIds), parsed.data.pinned, now],
    );
    const published = await publishWorkspace(client, req.user!.id, version);
    await client.query('COMMIT');
    // Après le COMMIT : l'indexation lit la version depuis une autre connexion.
    if (published) enqueueWorkspaceIndex(req.user!.id, published.state, published.version);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[notes] erreur création:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Impossible de créer la note' });
  } finally {
    client.release();
  }
});

const updateNoteSchema = z.object({
  title: z.string().trim().max(500).optional(),
  content: z.string().max(2_000_000).optional(),
  appendContent: z.string().max(2_000_000).optional(),
  folderId: z.string().nullable().optional(),
  tagIds: z.array(z.string()).max(50).optional(),
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
}).refine((d) => d.content === undefined || d.appendContent === undefined, {
  message: 'content et appendContent ne peuvent pas être envoyés ensemble',
});

app.patch(['/api/v1/notes/:id', '/v1/notes/:id'], dataLimiter, authenticate, async (req: AuthRequest, res) => {
  if (req.apiToken && !req.apiToken.permissions.write) {
    return res.status(403).json({ error: "Permission d'écriture refusée pour ce jeton" });
  }
  const parsed = updateNoteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Données invalides', details: parsed.error.issues });
  }
  const data = parsed.data;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const version = await lockWorkspace(client, req.user!.id);
    const existingRes = await client.query(
      `SELECT ${NOTE_COLUMNS} FROM notes WHERE id=$1 AND user_id=$2 FOR UPDATE`,
      [req.params.id, req.user!.id],
    );
    const note = existingRes.rows[0];
    if (!note || (req.apiToken && (!inFolderScope(req, note.folderId) || hasDeniedTag(req, note.tagIds)))) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Note introuvable' });
    }

    const newFolderId = data.folderId !== undefined ? data.folderId : note.folderId;
    const newTagIds: string[] = data.tagIds !== undefined
      ? [...new Set(data.tagIds)]
      : (Array.isArray(note.tagIds) ? [...note.tagIds] : []);
    if (req.apiToken) {
      // Couvre aussi folderId: null, qui sortirait la note du périmètre du bot.
      if (!inFolderScope(req, newFolderId)) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Déplacement vers un dossier interdit pour ce jeton' });
      }
      if (req.apiToken.autoTagId && !newTagIds.includes(req.apiToken.autoTagId)) {
        newTagIds.push(req.apiToken.autoTagId);
      }
      if (hasDeniedTag(req, newTagIds)) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Ce jeton ne peut pas utiliser un tag interdit' });
      }
    }

    let newContent: string = note.content;
    if (data.appendContent !== undefined) {
      newContent = newContent ? `${newContent}\n\n${data.appendContent}` : data.appendContent;
    } else if (data.content !== undefined) {
      newContent = data.content;
    }
    const now = Date.now();
    const newArchived = data.archived ?? Boolean(note.archived);
    const newArchivedAt = newArchived ? (note.archived ? note.archivedAt : now) : null;

    const updateRes = await client.query(
      `UPDATE notes
       SET title=$1, content=$2, folder_id=$3, tag_ids=$4::jsonb, pinned=$5, archived=$6, archived_at=$7, updated_at=$8
       WHERE id=$9 AND user_id=$10
       RETURNING ${NOTE_COLUMNS}`,
      [data.title ?? note.title, newContent, newFolderId, JSON.stringify(newTagIds), data.pinned ?? Boolean(note.pinned),
        newArchived, newArchivedAt, now, req.params.id, req.user!.id],
    );
    const published = await publishWorkspace(client, req.user!.id, version);
    await client.query('COMMIT');
    if (published) enqueueWorkspaceIndex(req.user!.id, published.state, published.version);
    res.json(updateRes.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[notes] erreur modification:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Impossible de modifier la note' });
  } finally {
    client.release();
  }
});

app.delete(['/api/v1/notes/:id', '/v1/notes/:id'], dataLimiter, authenticate, async (req: AuthRequest, res) => {
  if (req.apiToken && !req.apiToken.permissions.delete) {
    return res.status(403).json({ error: 'Permission de suppression refusée pour ce jeton' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const version = await lockWorkspace(client, req.user!.id);
    const existingRes = await client.query(
      'SELECT folder_id as "folderId", tag_ids as "tagIds" FROM notes WHERE id=$1 AND user_id=$2 FOR UPDATE',
      [req.params.id, req.user!.id],
    );
    const note = existingRes.rows[0];
    if (!note || (req.apiToken && (!inFolderScope(req, note.folderId) || hasDeniedTag(req, note.tagIds)))) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Note introuvable' });
    }
    await client.query('DELETE FROM notes WHERE id=$1 AND user_id=$2', [req.params.id, req.user!.id]);
    await client.query('DELETE FROM note_chunks WHERE note_id=$1 AND user_id=$2', [req.params.id, req.user!.id]);
    await publishWorkspace(client, req.user!.id, version);
    await client.query('COMMIT');
    res.status(204).end();
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[notes] erreur suppression:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Impossible de supprimer la note' });
  } finally {
    client.release();
  }
});

app.get(['/api/v1/folders', '/v1/folders'], dataLimiter, authenticate, async (req: AuthRequest, res) => {
  if (req.apiToken && !req.apiToken.permissions.read) {
    return res.status(403).json({ error: 'Permission de lecture refusée pour ce jeton' });
  }
  const folders = await pool.query(
    `SELECT id, name, parent_id as "parentId", order_index as "order", created_at as "createdAt"
     FROM folders
     WHERE user_id=$1 AND ($2::text[] IS NULL OR id = ANY($2::text[]))
     ORDER BY order_index ASC`,
    [req.user!.id, folderScopeOf(req)],
  );
  res.json(folders.rows);
});

const createFolderSchema = z.object({
  name: z.string().trim().min(1).max(120),
  parentId: z.string().max(200).nullable().optional(),
});

app.post(['/api/v1/folders', '/v1/folders'], dataLimiter, authenticate, async (req: AuthRequest, res) => {
  if (req.apiToken && !req.apiToken.permissions.write) {
    return res.status(403).json({ error: "Permission d'écriture refusée pour ce jeton" });
  }
  const parsed = createFolderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Données de dossier invalides', details: parsed.error.issues });

  let parentId = parsed.data.parentId ?? null;
  const scope = folderScopeOf(req);
  if (scope !== null) {
    if (parentId === null) parentId = req.apiToken!.allowedFolderIds.find((id) => scope.includes(id)) ?? null;
    if (!inFolderScope(req, parentId)) {
      return res.status(403).json({ error: 'Ce jeton ne peut créer un dossier que dans son périmètre' });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const version = await lockWorkspace(client, req.user!.id);
    if (parentId !== null) {
      const parent = await client.query('SELECT 1 FROM folders WHERE id=$1 AND user_id=$2', [parentId, req.user!.id]);
      if (!parent.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Dossier parent introuvable' });
      }
    }
    // Un sous-dossier d'un dossier du périmètre est automatiquement dans le périmètre.
    const result = await client.query(
      `INSERT INTO folders (id, user_id, name, parent_id, order_index, created_at)
       VALUES ($1, $2, $3, $4::text,
               COALESCE((SELECT MAX(order_index) + 1 FROM folders WHERE user_id=$2 AND parent_id IS NOT DISTINCT FROM $4::text), 0), $5)
       RETURNING id, name, parent_id as "parentId", order_index as "order", created_at as "createdAt"`,
      [randomUUID(), req.user!.id, parsed.data.name, parentId, Date.now()],
    );
    await publishWorkspace(client, req.user!.id, version);
    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[folders] erreur création:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Impossible de créer le dossier' });
  } finally {
    client.release();
  }
});

app.get(['/api/v1/tags', '/v1/tags'], dataLimiter, authenticate, async (req: AuthRequest, res) => {
  if (req.apiToken && !req.apiToken.permissions.read) {
    return res.status(403).json({ error: 'Permission de lecture refusée pour ce jeton' });
  }
  const tags = await pool.query(
    `SELECT id, name, color, created_at as "createdAt"
     FROM tags
     WHERE user_id=$1 AND ($2::text[] IS NULL OR NOT (id = ANY($2::text[])))
     ORDER BY name ASC`,
    [req.user!.id, deniedTagsOf(req)],
  );
  res.json(tags.rows);
});

// ==========================================
// Upload de médias / images (Supabase Storage)
// ==========================================
const mediaUploadSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  contentType: z.string().trim().refine(
    (t) => ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'].includes(t),
    { message: 'Type de fichier non supporté (png, jpeg, gif, webp, svg uniquement)' }
  ),
  dataBase64: z.string().min(1).max(15 * 1024 * 1024),
});

app.post(['/api/v1/media/upload', '/v1/media/upload'], authenticate, async (req: AuthRequest, res) => {
  if (req.apiToken && !req.apiToken.permissions.write) {
    return res.status(403).json({ error: "Permission d'écriture refusée pour ce jeton" });
  }
  const parsed = mediaUploadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Données d'image invalides", details: parsed.error.issues });
  }

  const { filename, contentType, dataBase64 } = parsed.data;
  const buffer = Buffer.from(dataBase64.replace(/^data:image\/[a-z+]+;base64,/, ''), 'base64');

  const ext = filename.split('.').pop() || 'png';
  const objectPath = `${req.user!.id}/${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${ext}`;

  const supaStorageHost = process.env.SUPABASE_STORAGE_URL || 'http://supabase-storage:5000';
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    const uploadRes = await fetch(`${supaStorageHost}/object/mansotnote-media/${objectPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        'Authorization': `Bearer ${supaKey}`,
        'apikey': supaKey || '',
        'x-upsert': 'true',
      },
      body: buffer,
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      console.error('[media] Erreur upload Supabase Storage:', errText);
      return res.status(502).json({ error: 'Échec de stockage Supabase', details: errText });
    }

    const publicUrl = `/storage/v1/object/public/mansotnote-media/${objectPath}`;
    res.json({ url: publicUrl, path: objectPath, filename });
  } catch (err: any) {
    console.error('[media] Erreur upload:', err);
    res.status(500).json({ error: err.message || 'Erreur interne upload' });
  }
});

// ==========================================
// Proxy IA Ollama / OpenAI pour l'extension (avec Token API Bearer)
// ==========================================
app.post(['/api/v1/ai/chat', '/v1/ai/chat'], aiLimiter, authenticate, async (req: AuthRequest, res) => {
  const parsed = z.object({
    model: z.string().trim().min(1).max(120).default('qwen3.8:9b-q6-32k'),
    messages: z.array(z.object({
      role: z.enum(['system', 'user', 'assistant']),
      content: z.string().max(50_000),
    })).min(1).max(30),
    temperature: z.number().min(0).max(2).optional().default(0.15),
    max_tokens: z.number().int().min(1).max(4096).optional(),
    think: z.boolean().optional(),
    stream: z.boolean().optional().default(false),
  }).safeParse(req.body);

  if (!parsed.success) return res.status(400).json({ error: 'Requête IA invalide' });
  if (!isAllowedAiModel(parsed.data.model)) return res.status(403).json({ error: 'Modèle IA non autorisé' });

  const totalChars = parsed.data.messages.reduce((acc, m) => acc + m.content.length, 0);
  if (totalChars > 120_000) {
    return res.status(400).json({ error: 'Historique de messages trop volumineux (120k caractères max)' });
  }

  // Interrompt immédiatement le calcul Ollama si le client se déconnecte ou annule
  const abortController = new AbortController();
  req.on('close', () => {
    if (!res.writableEnded) abortController.abort();
  });
  const timeoutSignal = AbortSignal.timeout(600_000);
  const fetchSignal = 'any' in AbortSignal
    ? AbortSignal.any([timeoutSignal, abortController.signal])
    : abortController.signal;

  // Streaming : on relaie la NDJSON d'Ollama en SSE compatible OpenAI
  // (data: {choices:[{delta:{content}}]}… puis data: [DONE]). Sans ça le
  // client attendrait toute la génération avant le premier byte.
  if (parsed.data.stream) {
    try {
      const aiRes = await fetch(`${OLLAMA_HOST}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: parsed.data.model,
          messages: parsed.data.messages,
          stream: true,
          ...(parsed.data.think !== undefined ? { think: parsed.data.think } : {}),
          keep_alive: -1,
          options: {
            temperature: parsed.data.temperature,
            num_ctx: OLLAMA_NUM_CTX,
            ...(parsed.data.max_tokens ? { num_predict: parsed.data.max_tokens } : {}),
          },
        }),
        signal: fetchSignal,
      });

      if (!aiRes.ok || !aiRes.body) {
        const err = await aiRes.json().catch(() => ({}));
        return res.status(aiRes.status || 502).json({ error: err.error || 'Erreur du serveur IA' });
      }

      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      req.socket?.setNoDelay(true);
      res.socket?.setNoDelay(true);
      res.flushHeaders?.();

      const reader = aiRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const chunkId = `chatcmpl-${Date.now()}`;
      const sendChunk = (delta: Record<string, unknown>) => {
        res.write(`data: ${JSON.stringify({ id: chunkId, object: 'chat.completion.chunk', choices: [{ index: 0, delta }] })}\n\n`);
        if (typeof (res as any).flush === 'function') {
          (res as any).flush();
        }
      };
      sendChunk({ role: 'assistant' });

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline: number;
        while ((newline = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line === '') continue;
          const event = JSON.parse(line) as {
            message?: { role?: string; content?: string; thinking?: string };
            done?: boolean;
            error?: string;
          };
          if (event.error) {
            res.write(`data: ${JSON.stringify({ error: { message: event.error } })}\n\n`);
            continue;
          }
          if (event.message?.thinking) {
            sendChunk({ reasoning_content: event.message.thinking });
          }
          if (event.message?.content) {
            sendChunk({ content: event.message.content });
          }
          if (event.done) { sendChunk({}); res.write('data: [DONE]\n\n'); }
        }
      }
      res.end();
    } catch (error) {
      if (!abortController.signal.aborted) {
        console.error('[ai-proxy-stream] erreur:', error);
      }
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ error: { message: 'Flux IA interrompu' } })}\n\n`);
        res.end();
      }
    }
    return;
  }

  try {
    const aiRes = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: parsed.data.model,
        messages: parsed.data.messages,
        stream: false,
        ...(parsed.data.think !== undefined ? { think: parsed.data.think } : {}),
        keep_alive: -1,
        options: {
          temperature: parsed.data.temperature,
          num_ctx: OLLAMA_NUM_CTX,
          ...(parsed.data.max_tokens ? { num_predict: parsed.data.max_tokens } : {}),
        },
      }),
      signal: fetchSignal,
    });

    if (!aiRes.ok) {
      const err = await aiRes.json().catch(() => ({}));
      return res.status(aiRes.status).json({ error: err.error || 'Erreur du serveur IA' });
    }

    const data = (await aiRes.json()) as { message?: { content?: string } };
    res.json({ choices: [{ message: { role: 'assistant', content: data.message?.content || '' } }] });
  } catch (error) {
    console.error('[ai-proxy] erreur:', error);
    res.status(502).json({ error: 'Impossible de joindre le serveur IA local' });
  }
});

app.post(['/api/v1/ai/embeddings', '/v1/ai/embeddings'], ragLimiter, authenticate, async (req: AuthRequest, res) => {
  const parsed = z.object({
    model: z.string().trim().max(120).optional().default(EMBEDDING_MODEL),
    input: z.union([z.string().max(50_000), z.array(z.string().max(12_000)).min(1).max(24)]),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Requête embeddings invalide' });
  if (parsed.data.model !== EMBEDDING_MODEL) return res.status(403).json({ error: 'Modèle d’embedding non autorisé' });

  try {
    const aiRes = await fetch(`${OLLAMA_HOST}/v1/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: parsed.data.input, keep_alive: -1 }),
      signal: AbortSignal.timeout(180_000),
    });
    const payload = await aiRes.json().catch(() => ({}));
    if (!aiRes.ok) return res.status(aiRes.status).json({ error: (payload as { error?: unknown }).error || 'Erreur embeddings' });
    res.json(payload);
  } catch (error) {
    console.error('[ai-embeddings] erreur:', error);
    res.status(502).json({ error: 'Impossible de joindre le serveur d’embeddings' });
  }
});

app.get(['/api/v1/ai/models', '/v1/ai/models'], dataLimiter, authenticate, (_req: AuthRequest, res) => {
  res.json({ data: [...ALLOWED_AI_MODELS].map((id) => ({ id, object: 'model' })) });
});
// ==========================================
// Gestion des jetons : session navigateur, ou jeton « gestionnaire »
// (permissions.manage) qui n'agit que sur les jetons qu'il a créés lui-même.
// ==========================================
function canManageTokens(req: AuthRequest, res: Response): boolean {
  if (req.authMethod === 'session' || req.apiToken?.permissions.manage) return true;
  res.status(403).json({ error: 'Session navigateur ou jeton gestionnaire requis' });
  return false;
}

const TOKEN_SELECT = `SELECT t.id, t.name, t.permissions,
       t.allowed_folder_ids as "allowedFolderIds",
       t.denied_tag_ids as "deniedTagIds",
       t.auto_tag_id as "autoTagId",
       t.created_by_token_id as "createdByTokenId",
       p.name as "createdByName",
       t.created_at, t.last_used_at, t.expires_at
  FROM api_tokens t
  LEFT JOIN api_tokens p ON p.id = t.created_by_token_id`;

function presentToken(row: Record<string, unknown>) {
  return { ...row, permissions: normalizePermissions(row.permissions) };
}

/** Identifiant du gestionnaire qui agit, null pour une session (qui voit tous les jetons). */
function managerIdOf(req: AuthRequest): string | null {
  return req.apiToken?.id ?? null;
}

const UUID = z.string().uuid();

/**
 * Valide une politique de jeton : cohérence, dossiers existants, et, pour un
 * gestionnaire, respect de ses propres limites. null = acceptée.
 */
async function checkTokenPolicy(req: AuthRequest, policy: TokenPolicy, newFolderIds: string[]): Promise<{ status: number; error: string } | null> {
  const invalid = validatePolicy(policy);
  if (invalid) return { status: 400, error: invalid };
  if (newFolderIds.length > 0) {
    const found = await pool.query('SELECT id FROM folders WHERE user_id=$1 AND id = ANY($2::text[])', [req.user!.id, newFolderIds]);
    if (found.rowCount !== new Set(newFolderIds).size) return { status: 400, error: 'Dossier inconnu' };
  }
  if (req.apiToken) {
    const limit = validateChildPolicy(
      { permissions: req.apiToken.permissions, folderScope: req.apiToken.folderScope, deniedTagIds: req.apiToken.deniedTagIds },
      policy,
    );
    if (limit) return { status: 403, error: limit };
  }
  return null;
}

app.get(['/api/tokens', '/tokens'], authenticate, async (req: AuthRequest, res) => {
  if (!canManageTokens(req, res)) return;
  const result = await pool.query(
    `${TOKEN_SELECT}
     WHERE t.user_id=$1 AND ($2::uuid IS NULL OR t.created_by_token_id = $2::uuid)
     ORDER BY t.created_at DESC`,
    [req.user!.id, managerIdOf(req)],
  );
  res.json({ tokens: result.rows.map(presentToken) });
});

const permissionsInput = z.object({
  read: z.boolean(), write: z.boolean(), delete: z.boolean(), manage: z.boolean(),
}).partial();

const createTokenSchema = z.object({
  name: z.string().trim().min(1).max(80),
  permissions: permissionsInput.optional(),
  allowedFolderIds: z.array(z.string().max(200)).max(100).optional().default([]),
  deniedTagIds: z.array(z.string().max(200)).max(100).optional().default([]),
  autoTagId: z.string().max(200).nullable().optional(),
});

app.post(['/api/tokens', '/tokens'], authenticate, async (req: AuthRequest, res) => {
  if (!canManageTokens(req, res)) return;
  const parsed = createTokenSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Données de jeton invalides', details: parsed.error.issues });

  const policy: TokenPolicy = {
    permissions: normalizePermissions({ read: true, write: true, delete: false, manage: false, ...parsed.data.permissions }),
    allowedFolderIds: [...new Set(parsed.data.allowedFolderIds)],
    deniedTagIds: [...new Set(parsed.data.deniedTagIds)],
    autoTagId: parsed.data.autoTagId || null,
  };
  const problem = await checkTokenPolicy(req, policy, policy.allowedFolderIds);
  if (problem) return res.status(problem.status).json({ error: problem.error });

  const managerId = managerIdOf(req);
  if (managerId) {
    const count = await pool.query('SELECT count(*)::int AS n FROM api_tokens WHERE created_by_token_id=$1', [managerId]);
    if (count.rows[0].n >= MAX_CHILD_TOKENS) {
      return res.status(403).json({ error: `Limite de ${MAX_CHILD_TOKENS} jetons créés par ce jeton atteinte` });
    }
  }

  const rawToken = `mn_${createSessionToken()}`;
  const inserted = await pool.query(
    `INSERT INTO api_tokens(user_id, token_hash, name, permissions, allowed_folder_ids, denied_tag_ids, auto_tag_id, created_by_token_id)
     VALUES($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8)
     RETURNING id`,
    [req.user!.id, hashSessionToken(rawToken), parsed.data.name, JSON.stringify(policy.permissions),
      JSON.stringify(policy.allowedFolderIds), JSON.stringify(policy.deniedTagIds), policy.autoTagId, managerId],
  );
  const record = await pool.query(`${TOKEN_SELECT} WHERE t.id=$1`, [inserted.rows[0].id]);

  res.status(201).json({
    token: rawToken, // Unique affichage du jeton en clair
    record: presentToken(record.rows[0]),
  });
});

const updateTokenSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  permissions: permissionsInput.optional(),
  allowedFolderIds: z.array(z.string().max(200)).max(100).optional(),
  deniedTagIds: z.array(z.string().max(200)).max(100).optional(),
  autoTagId: z.string().max(200).nullable().optional(),
});

app.patch(['/api/tokens/:id', '/tokens/:id'], authenticate, async (req: AuthRequest, res) => {
  if (!canManageTokens(req, res)) return;
  if (!UUID.safeParse(req.params.id).success) return res.status(404).json({ error: 'Jeton introuvable' });
  const parsed = updateTokenSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Données de mise à jour invalides' });
  const data = parsed.data;

  const existing = await pool.query(
    `SELECT name, permissions, allowed_folder_ids, denied_tag_ids, auto_tag_id
     FROM api_tokens
     WHERE id=$1 AND user_id=$2 AND ($3::uuid IS NULL OR created_by_token_id = $3::uuid)`,
    [req.params.id, req.user!.id, managerIdOf(req)],
  );
  if (!existing.rowCount) return res.status(404).json({ error: 'Jeton introuvable' });
  const current = existing.rows[0];

  const policy: TokenPolicy = {
    permissions: normalizePermissions({ ...normalizePermissions(current.permissions), ...data.permissions }),
    allowedFolderIds: data.allowedFolderIds ? [...new Set(data.allowedFolderIds)] : (Array.isArray(current.allowed_folder_ids) ? current.allowed_folder_ids : []),
    deniedTagIds: data.deniedTagIds ? [...new Set(data.deniedTagIds)] : (Array.isArray(current.denied_tag_ids) ? current.denied_tag_ids : []),
    autoTagId: data.autoTagId !== undefined ? data.autoTagId : current.auto_tag_id,
  };
  const problem = await checkTokenPolicy(req, policy, data.allowedFolderIds ?? []);
  if (problem) return res.status(problem.status).json({ error: problem.error });

  await pool.query(
    `UPDATE api_tokens
     SET name=$1, permissions=$2::jsonb, allowed_folder_ids=$3::jsonb, denied_tag_ids=$4::jsonb, auto_tag_id=$5
     WHERE id=$6 AND user_id=$7`,
    [data.name ?? current.name, JSON.stringify(policy.permissions), JSON.stringify(policy.allowedFolderIds),
      JSON.stringify(policy.deniedTagIds), policy.autoTagId, req.params.id, req.user!.id],
  );
  const record = await pool.query(`${TOKEN_SELECT} WHERE t.id=$1`, [req.params.id]);
  res.json({ record: presentToken(record.rows[0]) });
});

app.delete(['/api/tokens/:id', '/tokens/:id'], authenticate, async (req: AuthRequest, res) => {
  if (!canManageTokens(req, res)) return;
  if (!UUID.safeParse(req.params.id).success) return res.status(404).json({ error: 'Jeton introuvable' });
  // Les jetons créés par celui-ci sont supprimés avec lui (ON DELETE CASCADE).
  const removed = await pool.query(
    'DELETE FROM api_tokens WHERE id=$1 AND user_id=$2 AND ($3::uuid IS NULL OR created_by_token_id = $3::uuid)',
    [req.params.id, req.user!.id, managerIdOf(req)],
  );
  if (!removed.rowCount) return res.status(404).json({ error: 'Jeton introuvable' });
  res.status(204).end();
});

// ==========================================
// Endpoints Clips (Web Clipper Inbox)
// ==========================================
const clipSchema = z.object({
  type: z.enum(['note', 'card']).default('note'),
  title: z.string().trim().min(1).max(500),
  content: z.string().max(200_000).default(''),
  url: z.string().url().max(2000).optional().or(z.literal('')),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
  idempotentKey: z.string().max(128).optional(),
});

// Réception d'un clip depuis l'extension
app.post(['/api/v1/clips', '/v1/clips'], dataLimiter, authenticate, async (req: AuthRequest, res) => {
  // Un clip devient une note sans dossier côté navigateur : il contournerait
  // le périmètre d'un bot confiné, qui doit utiliser POST /api/v1/notes.
  if (req.apiToken && (!req.apiToken.permissions.write || req.apiToken.folderScope !== null)) {
    return res.status(403).json({ error: 'Ce jeton ne peut pas déposer de clip ; utilisez POST /api/v1/notes' });
  }
  const parsed = clipSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Données de clip invalides', details: parsed.error.issues });

  const { type, title, content, url, metadata, idempotentKey } = parsed.data;

  try {
    const result = await pool.query(
      `INSERT INTO clips(user_id, type, title, content, url, metadata, idempotent_key, status)
       VALUES($1, $2, $3, $4, $5, $6, $7, 'pending')
       ON CONFLICT (user_id, idempotent_key) DO UPDATE SET title=EXCLUDED.title, content=EXCLUDED.content
       RETURNING id, type, title, status, created_at`,
      [req.user!.id, type, title, content, url || null, JSON.stringify(metadata), idempotentKey || null],
    );

    res.status(201).json({ success: true, clip: result.rows[0] });
  } catch (error) {
    console.error('[clips] erreur création clip:', error);
    res.status(500).json({ error: 'Impossible d\'enregistrer le clip' });
  }
});

// Récupération des clips en attente (drainés par l'app web)
app.get(['/api/v1/clips/pending', '/v1/clips/pending'], authenticate, async (req: AuthRequest, res) => {
  // Seule l'application web vide l'inbox ; un bot ne lit pas les clips des autres.
  if (!requireSession(req, res)) return;
  const result = await pool.query(
    `SELECT id, type, title, content, url, metadata, created_at
     FROM clips
     WHERE user_id=$1 AND status='pending'
     ORDER BY created_at ASC
     LIMIT 50`,
    [req.user!.id],
  );
  res.json({ clips: result.rows });
});

// Acquittement des clips traités par l'app web
app.post(['/api/v1/clips/ack', '/v1/clips/ack'], authenticate, async (req: AuthRequest, res) => {
  if (!requireSession(req, res)) return;
  const parsed = z.object({
    ids: z.array(z.string().uuid()),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'IDs invalides' });

  if (parsed.data.ids.length > 0) {
    await pool.query(
      `UPDATE clips
       SET status='processed', processed_at=now()
       WHERE user_id=$1 AND id = ANY($2::uuid[])`,
      [req.user!.id, parsed.data.ids],
    );
  }

  res.json({ success: true, count: parsed.data.ids.length });
});

app.delete('/workspace', authenticate, async (req: AuthRequest, res) => {
  if (req.authMethod !== 'session') return res.status(403).json({ error: 'Session navigateur requise' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM note_chunks WHERE user_id=$1', [req.user!.id]);
    await client.query('DELETE FROM workspaces WHERE user_id=$1', [req.user!.id]);
    await client.query('COMMIT');
    res.status(204).end();
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
});

app.post('/rag/search', ragLimiter, authenticate, async (req: AuthRequest, res) => {
  if (req.apiToken && !req.apiToken.permissions.read) {
    return res.status(403).json({ error: 'Permission de recherche refusée pour ce jeton' });
  }
  const parsed = z.object({ query: z.string().trim().min(1).max(4000), limit: z.number().int().min(1).max(20).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Requête RAG invalide' });
  const results = await hybridSearch(req.user!.id, parsed.data.query, parsed.data.limit ?? 6, {
    folderScope: folderScopeOf(req),
    deniedTagIds: deniedTagsOf(req),
  });
  res.json({ mode: 'hybrid-pgvector', results });
});

// Création initiale idempotente, exécutée au démarrage depuis variables Docker.
async function ensureAdmin(): Promise<void> {
  const username = process.env.INITIAL_ADMIN_USERNAME;
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  if (!username || !password) return;
  const normalized = normalizeUsername(username);
  const exists = await pool.query('SELECT 1 FROM users WHERE username_normalized=$1', [normalized]);
  if (!exists.rowCount) {
    const passwordHash = await hashPassword(password);
    await pool.query('INSERT INTO users(username,username_normalized,password_hash) VALUES($1,$2,$3)', [username, normalized, passwordHash]);
    console.log(`[auth] compte initial créé: ${username}`);
  }
}

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[api]', error instanceof Error ? error.message : error);
  res.status(500).json({ error: 'Erreur interne' });
});

await migrate();
await ensureAdmin();
app.listen(PORT, '0.0.0.0', () => console.log(`[api] écoute sur :${PORT}`));
