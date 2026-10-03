import type { Express, RequestHandler } from 'express';
import { z } from 'zod';
import { pool } from './db.js';
import { hashPassword, normalizeUsername } from './security.js';
import type { AuthRequest } from './index.js';

const userFields = 'id, username, role, created_at as "createdAt", disabled_at as "disabledAt"';
const passwordSchema = z.string().min(12).max(512);
const createSchema = z.object({
  username: z.string().trim().min(1).max(80),
  password: passwordSchema,
  role: z.enum(['admin', 'user']).default('user'),
}).strict();
const updateSchema = z.object({
  role: z.enum(['admin', 'user']).optional(),
  disabled: z.boolean().optional(),
}).strict().refine((v) => v.role !== undefined || v.disabled !== undefined);

/** L'administration est réservée aux sessions humaines, même pour un jeton d'admin. */
export function registerAdminUsers(app: Express, authenticate: RequestHandler, limiter: RequestHandler) {
  const admin: RequestHandler = (request, response, next) => {
    const req = request as AuthRequest;
    if (req.authMethod !== 'session' || req.user?.role !== 'admin') {
      response.status(403).json({ error: 'Session administrateur requise' });
      return;
    }
    next();
  };
  app.get('/admin/users', authenticate, admin, async (_req, res) => {
    const result = await pool.query(`SELECT ${userFields} FROM users ORDER BY created_at, id`);
    res.json({ users: result.rows });
  });
  app.post('/admin/users', limiter, authenticate, admin, async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Identifiant, rôle ou mot de passe invalide (12 caractères minimum)' });
    const data = parsed.data;
    const passwordHash = await hashPassword(data.password);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
      const actor = await client.query("SELECT 1 FROM users WHERE id=$1 AND role='admin' AND disabled_at IS NULL", [(req as AuthRequest).user!.id]);
      if (!actor.rowCount) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'Session administrateur requise' }); }
      const result = await client.query(
        `INSERT INTO users(username, username_normalized, password_hash, role) VALUES($1,$2,$3,$4) RETURNING ${userFields}`,
        [data.username, normalizeUsername(data.username), passwordHash, data.role],
      );
      await client.query('COMMIT');
      res.status(201).json({ user: result.rows[0] });
    } catch (error) {
      await client.query('ROLLBACK');
      if ((error as { code?: string }).code === '23505') return res.status(409).json({ error: 'Cet identifiant existe déjà' });
      throw error;
    } finally { client.release(); }
  });
  app.patch('/admin/users/:id', limiter, authenticate, admin, async (request, res) => {
    const req = request as AuthRequest;
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success || !z.uuid().safeParse(req.params.id).success) return res.status(400).json({ error: 'Modification de compte invalide' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Sérialise les modifications des administrateurs : deux requêtes
      // concurrentes ne peuvent retirer les deux derniers admins.
      await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
      const actor = await client.query("SELECT 1 FROM users WHERE id=$1 AND role='admin' AND disabled_at IS NULL", [req.user!.id]);
      if (!actor.rowCount) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'Session administrateur requise' }); }
      const found = await client.query('SELECT role, disabled_at FROM users WHERE id=$1', [req.params.id]);
      if (!found.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Compte introuvable' }); }
      const current = found.rows[0];
      const role = parsed.data.role ?? current.role;
      const disabled = parsed.data.disabled ?? Boolean(current.disabled_at);
      if (req.params.id === req.user!.id && (disabled || role !== 'admin')) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Vous ne pouvez pas désactiver votre compte ou retirer votre propre rôle administrateur' });
      }
      if (current.role === 'admin' && !current.disabled_at && (disabled || role !== 'admin')) {
        const others = await client.query("SELECT 1 FROM users WHERE role='admin' AND disabled_at IS NULL AND id<>$1 LIMIT 1", [req.params.id]);
        if (!others.rowCount) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Au moins un administrateur actif doit être conservé' }); }
      }
      const result = await client.query(
        `UPDATE users SET role=$2, disabled_at=CASE WHEN $3 THEN COALESCE(disabled_at,now()) ELSE NULL END, updated_at=now()
         WHERE id=$1 RETURNING ${userFields}`, [req.params.id, role, disabled],
      );
      if (disabled || role !== current.role) await client.query('DELETE FROM sessions WHERE user_id=$1', [req.params.id]);
      await client.query('COMMIT');
      res.json({ user: result.rows[0] });
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  });
  app.post('/admin/users/:id/password', limiter, authenticate, admin, async (request, res) => {
    const req = request as AuthRequest;
    const parsed = z.object({ password: passwordSchema }).strict().safeParse(req.body);
    if (!parsed.success || !z.uuid().safeParse(req.params.id).success) return res.status(400).json({ error: 'Mot de passe invalide (12 caractères minimum)' });
    if (req.params.id === req.user!.id) return res.status(409).json({ error: 'Utilisez l’onglet Sécurité pour changer votre propre mot de passe' });
    const passwordHash = await hashPassword(parsed.data.password);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
      const actor = await client.query("SELECT 1 FROM users WHERE id=$1 AND role='admin' AND disabled_at IS NULL", [req.user!.id]);
      if (!actor.rowCount) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'Session administrateur requise' }); }
      const changed = await client.query('UPDATE users SET password_hash=$2, updated_at=now() WHERE id=$1', [req.params.id, passwordHash]);
      if (!changed.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Compte introuvable' }); }
      await client.query('DELETE FROM sessions WHERE user_id=$1', [req.params.id]);
      await client.query('COMMIT');
      res.status(204).end();
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  });
}
