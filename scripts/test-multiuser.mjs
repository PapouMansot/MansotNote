// API réelle + migrations sur une base PostgreSQL WASM jetable, sans données existantes.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { build } from 'esbuild';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { createTestPool } from './pglite-test-pool.mjs';

const preview = process.argv.includes('--preview');
const cache = 'node_modules/.cache/multiuser';
await mkdir(cache, { recursive: true });
const freePort = async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
};
const apiPort = await freePort();
// Embeddings déterministes : aucune note de test n'est envoyée à un fournisseur IA.
const storageObjects = new Map();
let mediaReads = 0;
const embeddingServer = createHttpServer(async (req, res) => {
  if (req.url.startsWith('/object/')) {
    assert.equal(req.headers.authorization, 'Bearer test-only-service-key');
    if (req.method === 'POST') {
      const parts = []; for await (const part of req) parts.push(part);
      storageObjects.set(req.url, Buffer.concat(parts));
      res.setHeader('Content-Type', 'application/json'); res.end('{}'); return;
    }
    mediaReads++;
    const object = storageObjects.get(req.url.replace('/object/authenticated/', '/object/'));
    if (!object) { res.statusCode = 404; res.end(); return; }
    res.setHeader('Content-Type', 'image/png'); res.end(object); return;
  }
  let raw = ''; for await (const part of req) raw += part;
  const { input } = JSON.parse(raw);
  const texts = Array.isArray(input) ? input : [input];
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ data: texts.map((text, index) => ({ index,
    embedding: Array.from({ length: 1024 }, (_, dimension) => dimension === (String(text).includes('bob') ? 1 : 0) ? 1 : 0),
  })) }));
});
await new Promise((resolve) => embeddingServer.listen(0, '127.0.0.1', resolve));
const embeddingPort = embeddingServer.address().port;
const db = await PGlite.create({ extensions: { vector } });
await db.exec("CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY, public boolean); INSERT INTO storage.buckets VALUES('mansotnote-media',true),('other-app',true);");
const testPool = createTestPool(db);
globalThis.__mansotTestPool = testPool;
await build({ entryPoints: ['server/index.ts'], outfile: `${cache}/index.mjs`, bundle: true, platform: 'node', format: 'esm', packages: 'external',
  plugins: [{ name: 'temporary-postgres', setup(builder) {
    builder.onResolve({ filter: /^\.\/db\.js$/ }, () => ({ path: 'test-db', namespace: 'test' }));
    builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const pool=globalThis.__mansotTestPool; export async function assertDatabase(){await pool.query("SELECT 1");}' }));
  } }] });
await cp('server/migrations', `${cache}/migrations`, { recursive: true });
Object.assign(process.env, { HOST: '127.0.0.1', PORT: String(apiPort), NODE_ENV: 'test',
  INITIAL_ADMIN_USERNAME: 'AdminTest', INITIAL_ADMIN_PASSWORD: 'Mansot-test-2026!', OLLAMA_URL: `http://127.0.0.1:${embeddingPort}/v1`,
  SUPABASE_STORAGE_URL: `http://127.0.0.1:${embeddingPort}`, SUPABASE_SERVICE_ROLE_KEY: 'test-only-service-key' });
let { httpServer } = await import(new URL(`../${cache}/index.mjs`, import.meta.url));
const base = `http://127.0.0.1:${apiPort}`;
const request = async (path, session, method = 'GET', body, extras = {}) => {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json',
    ...(session ? { Cookie: session.cookie, 'X-Mansot-User': session.user.id } : {}), ...extras },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json().catch(() => null), cookie: response.headers.get('set-cookie')?.split(';')[0] };
};
const login = async (username, password = 'Mansot-test-2026!') => {
  const response = await request('/auth/login', null, 'POST', { username, password });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return { cookie: response.cookie, user: response.body.user };
};
let checks = 0;
const check = (label) => { checks++; console.log(`OK ${label}`); };
let vite;
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(base + '/health')).ok) break; } catch {}
    if (attempt > 120) throw new Error('API non prête');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const admin = await login('AdminTest');
  assert.equal(admin.user.role, 'admin');
  assert.equal(admin.user.legacyOwner, true);
  assert.equal((await request('/admin/users')).status, 401);
  check('Compte initial administrateur ; API protégée');
  for (const name of ['Alice', 'Bob']) {
    assert.equal((await request('/admin/users', admin, 'POST', { username: name, password: 'Mansot-test-2026!' })).status, 201);
  }
  assert.equal((await request('/admin/users', admin, 'POST', { username: ' alice ', password: 'Mansot-test-2026!' })).status, 409);
  assert.equal((await request('/admin/users', admin, 'POST', { username: 'Weak', password: 'short' })).status, 400);
  assert.equal((await request('/admin/users', admin, 'POST', { username: 'Elevate', password: 'Mansot-test-2026!', role: 'superadmin' })).status, 400);
  check('Création, doublons normalisés et validation des comptes');
  let alice = await login('Alice');
  const bob = await login('Bob');
  assert.equal(alice.user.role, 'user');
  assert.equal(alice.user.legacyOwner, false);
  for (const [path, method, body] of [
    ['/admin/users', 'GET'], ['/admin/users', 'POST', { username: 'Intruder', password: 'Mansot-test-2026!', role: 'admin' }],
    [`/admin/users/${bob.user.id}`, 'PATCH', { role: 'admin' }], [`/admin/users/${bob.user.id}/password`, 'POST', { password: 'Mansot-test-2026!' }],
  ]) assert.equal((await request(path, alice, method, body)).status, 403);
  check('Utilisateur sans accès à aucune action d’administration');
  assert.equal((await request(`/admin/users/${admin.user.id}`, admin, 'PATCH', { disabled: true })).status, 409);
  assert.equal((await request(`/admin/users/${admin.user.id}`, admin, 'PATCH', { role: 'user' })).status, 409);
  check('Protection de son propre compte administrateur');

  const workspace = (prefix) => ({ schemaVersion: 1, savedAt: Date.now(), seed: null,
    settings: { aiApiKey: `${prefix}-private-key`, defaultFolderId: `${prefix}-folder` },
    folders: [{ id: `${prefix}-child`, name: 'Enfant', parentId: `${prefix}-folder` }, { id: `${prefix}-folder`, name: 'Privé' }],
    tags: [{ id: `${prefix}-tag`, name: 'privé', color: '#64748b' }],
    notes: [{ id: `${prefix}-note`, title: `${prefix} privé`, content: `${prefix} secret`, folderId: `${prefix}-child`, tagIds: [`${prefix}-tag`] }],
    columns: [{ id: `${prefix}-column`, title: 'À faire' }], labels: [{ id: `${prefix}-label`, name: 'Privé', color: '#64748b' }],
    cards: [{ id: `${prefix}-card`, columnId: `${prefix}-column`, title: 'Privé', labelIds: [`${prefix}-label`], linkedNoteId: `${prefix}-note` }],
  });
  const aliceState = workspace('alice');
  const bobState = workspace('bob');
  assert.equal((await request('/workspace', alice, 'PUT', { state: aliceState, expectedVersion: 0 })).status, 200);
  assert.equal((await request('/workspace', bob, 'PUT', { state: bobState, expectedVersion: 0 })).status, 200);
  const own = await request('/workspace', alice);
  assert.equal(own.body.state.notes.length, 1);
  assert.equal(own.body.state.notes[0].id, 'alice-note');
  assert.equal(own.body.state.cards[0].id, 'alice-card');
  assert.equal(own.body.state.settings.aiApiKey, 'alice-private-key');
  assert.equal((await request('/v1/notes/bob-note', alice)).status, 404);
  assert.equal((await request('/v1/notes/bob-note/versions', alice)).status, 404);
  assert.equal((await request('/v1/notes/bob-note', alice, 'PATCH', { title: 'Attaque' })).status, 404);
  assert.equal((await request('/v1/notes/bob-note', alice, 'DELETE')).status, 404);
  check('Notes, Kanban, réglages et historique isolés entre deux comptes');
  // Attendre les indexations de fond sur la connexion de test sérialisée.
  await testPool.query('SELECT 1');
  for (const session of [alice, bob]) {
    const result = await request('/rag/search', session, 'POST', { query: 'secret' });
    assert.equal(result.status, 200);
    assert.equal(result.body.results.length, 1);
    assert.equal(result.body.results[0].note_id, session === alice ? 'alice-note' : 'bob-note');
  }
  check('Recherche RAG vectorielle et lexicale limitée aux notes du compte');
  assert.equal((await testPool.query("SELECT public FROM storage.buckets WHERE id='mansotnote-media'")).rows[0].public, false);
  assert.equal((await testPool.query("SELECT public FROM storage.buckets WHERE id='other-app'")).rows[0].public, true);
  const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
  const uploaded = await request('/v1/media/upload', bob, 'POST', { filename: 'test.png', contentType: 'image/png', dataBase64: imageBytes.toString('base64') });
  assert.equal(uploaded.status, 200);
  assert.ok(uploaded.body.url.startsWith(`/api/media/${bob.user.id}/`));
  const mediaPath = uploaded.body.url.replace(/^\/api/, '');
  assert.equal((await request(mediaPath)).status, 401);
  assert.equal((await request(mediaPath, alice)).status, 404);
  assert.equal((await request(mediaPath, admin)).status, 404);
  assert.equal(mediaReads, 0);
  const image = await fetch(base + mediaPath, { headers: { Cookie: bob.cookie } });
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), imageBytes);
  check('Images accessibles uniquement au propriétaire ; seul le bucket MansotNote devient privé');

  for (const key of ['notes', 'folders', 'tags', 'columns', 'labels', 'cards']) {
    const attack = structuredClone(aliceState);
    attack[key][0].id = bobState[key][0].id;
    assert.equal((await request('/workspace', alice, 'PUT', { state: attack, expectedVersion: 1 })).status, 400);
  }
  const invalidRef = structuredClone(aliceState);
  invalidRef.notes[0].folderId = 'bob-folder';
  assert.equal((await request('/workspace', alice, 'PUT', { state: invalidRef, expectedVersion: 1 })).status, 400);
  assert.equal((await request('/workspace', alice, 'PUT', { state: aliceState, expectedVersion: 1 }, { 'X-Mansot-User': bob.user.id })).status, 409);
  assert.equal((await request('/workspace', alice, 'PUT', { state: aliceState, expectedVersion: 1 }, { 'X-Mansot-User': '' })).status, 409);
  assert.equal((await request('/workspace', bob)).body.state.notes[0].title, 'bob privé');
  check('Collisions d’identifiants, références croisées et sauvegarde d’un ancien onglet refusées');

  // La base refuse aussi les liens croisés et changements de propriétaire hors autosave.
  await assert.rejects(testPool.query('UPDATE notes SET folder_id=$1 WHERE id=$2', ['bob-folder', 'alice-note']), /Invalid folder owner/);
  await assert.rejects(testPool.query('UPDATE tags SET user_id=$1 WHERE id=$2', [bob.user.id, 'alice-tag']), /owner cannot change/);
  await assert.rejects(testPool.query('UPDATE kanban_cards SET linked_note_id=$1 WHERE id=$2', ['bob-note', 'alice-card']), /Invalid linked note owner/);
  check('Contraintes de propriété appliquées par PostgreSQL');

  const adminToken = await request('/tokens', admin, 'POST', { name: 'test-admin-bot', permissions: { read: true, write: true, manage: true } });
  assert.equal(adminToken.status, 201, JSON.stringify(adminToken.body));
  assert.equal((await request('/admin/users', null, 'GET', undefined, { Authorization: `Bearer ${adminToken.body.token}` })).status, 403);
  const token = await request('/tokens', alice, 'POST', { name: 'alice-bot', permissions: { read: true, write: true } });
  assert.equal(token.status, 201, JSON.stringify(token.body));
  const tokenHeaders = { Authorization: `Bearer ${token.body.token}` };
  assert.equal((await request('/workspace', null, 'GET', undefined, tokenHeaders)).status, 403);
  assert.equal((await request('/v1/notes', null, 'GET', undefined, tokenHeaders)).body[0].id, 'alice-note');
  assert.equal((await request('/v1/notes/bob-note', null, 'GET', undefined, tokenHeaders)).status, 404);
  assert.equal((await request('/rag/search', null, 'POST', { query: 'secret' }, tokenHeaders)).body.results[0].note_id, 'alice-note');
  check('Jetons personnels, sans administration ni accès global au workspace');

  assert.equal((await request(`/admin/users/${alice.user.id}`, admin, 'PATCH', { disabled: true })).status, 200);
  assert.equal((await request('/workspace', alice)).status, 401);
  assert.equal((await request('/v1/notes', null, 'GET', undefined, tokenHeaders)).status, 401);
  assert.equal((await request('/auth/login', null, 'POST', { username: 'Alice', password: 'Mansot-test-2026!' })).status, 401);
  assert.equal((await request(`/admin/users/${alice.user.id}`, admin, 'PATCH', { disabled: false })).status, 200);
  alice = await login('Alice');
  assert.equal((await request('/workspace', alice)).body.state.notes[0].content, 'alice secret');
  assert.equal((await request('/v1/notes', null, 'GET', undefined, tokenHeaders)).status, 200);
  check('Désactivation bloque sessions et bots ; réactivation conserve les données');
  assert.equal((await request(`/admin/users/${alice.user.id}/password`, admin, 'POST', { password: 'Mansot-reset-2026!' })).status, 204);
  assert.equal((await request('/workspace', alice)).status, 401);
  assert.equal((await request('/auth/login', null, 'POST', { username: 'Alice', password: 'Mansot-test-2026!' })).status, 401);
  alice = await login('Alice', 'Mansot-reset-2026!');
  assert.equal((await request('/v1/notes', null, 'GET', undefined, tokenHeaders)).status, 200);
  check('Réinitialisation révoque les sessions et change réellement le mot de passe');
  assert.equal((await request(`/admin/users/${bob.user.id}`, admin, 'PATCH', { role: 'admin' })).status, 200);
  assert.equal((await request('/admin/users', bob)).status, 401);
  const secondAdmin = await login('Bob');
  assert.equal((await request('/admin/users', secondAdmin)).status, 200);
  assert.equal((await request(`/admin/users/${bob.user.id}`, admin, 'PATCH', { role: 'user' })).status, 200);
  check('Rôles appliqués à la connexion ; changement de rôle révoque les sessions');

  // Une note supprimée reste réservée à son propriétaire tant que son historique existe.
  assert.equal((await request('/v1/notes/bob-note', await login('Bob'), 'DELETE')).status, 204);
  const reused = structuredClone(aliceState); reused.notes[0].id = 'bob-note'; reused.cards = [];
  const latest = (await request('/workspace', alice)).body.version;
  assert.equal((await request('/workspace', alice, 'PUT', { state: reused, expectedVersion: latest })).status, 400);
  check('Historique et corbeille protégés contre la réutilisation d’un identifiant');

  // Rejouer les migrations doit conserver les rôles et les espaces existants.
  for (const file of (await readdir('server/migrations')).filter((f) => f.endsWith('.sql')).sort()) {
    await testPool.query(await readFile(`server/migrations/${file}`, 'utf8'));
  }
  assert.equal((await testPool.query('SELECT role FROM users WHERE id=$1', [bob.user.id])).rows[0].role, 'user');
  assert.equal((await request('/workspace', alice)).body.state.notes[0].content, 'alice secret');
  check('Migrations rejouables sans promotion ni perte de données');

  await build({ entryPoints: ['scripts/test-multiuser-browser.ts'], outfile: `${cache}/browser.mjs`, bundle: true, platform: 'node', format: 'esm',
    alias: { '@': './src' }, define: { 'import.meta.env': '{}' } });
  await import(new URL(`../${cache}/browser.mjs`, import.meta.url));
  console.log(`\n${checks} scénarios API/SQL validés, plus les contrôles du stockage navigateur.`);
  if (preview) {
    // Nouvelle instance de l'API : les essais automatisés ne consomment pas
    // la limite de connexions de la vérification manuelle.
    await new Promise((resolve) => httpServer.close(resolve));
    ({ httpServer } = await import(new URL(`../${cache}/index.mjs?preview`, import.meta.url)));
    const frontendPort = await freePort();
    const viteCli = 'node_modules/vite/bin/vite.js';
    vite = spawn(process.execPath, [viteCli, '--host', '127.0.0.1', '--port', String(frontendPort), '--strictPort'], {
      env: { ...process.env, MANSOTNOTE_DEV_API_URL: base }, stdio: 'inherit', windowsHide: true,
    });
    await writeFile(`${cache}/preview.json`, JSON.stringify({ url: `http://127.0.0.1:${frontendPort}`, apiUrl: base }));
    console.log(`PREVIEW http://127.0.0.1:${frontendPort} — AdminTest / Mansot-test-2026! (comptes de test uniquement)`);
    await new Promise((resolve) => {
      process.once('SIGINT', resolve);
      process.stdin.resume();
      process.stdin.once('data', resolve);
    });
    process.stdin.pause();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  vite?.kill();
  await new Promise((resolve) => httpServer.close(resolve));
  await testPool.query('SELECT 1');
  await db.close();
  await new Promise((resolve) => embeddingServer.close(resolve));
}
