import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { cp, mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import express from 'express';
import { build } from 'esbuild';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { createTestPool } from './pglite-test-pool.mjs';

const built = await build({ entryPoints: ['server/ai-correction.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { correctAiText, correctionInputSchema, CORRECTION_PROMPT } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const config = { ollamaHost: 'http://ollama:11434', ollamaNumCtx: 32768, llamaChatUrl: 'http://llama:8080/v1' };
const input = { text: 'Bonjours, comment va tu ?', model: 'gemma4:e4b' };
const close = server => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve); });
const post = (url, body = input, signal) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
async function harness(t, upstream) {
  const app = express(); app.use(express.json());
  app.post('/correct', (req, res) => correctAiText(req, res, req.body, config, upstream));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => close(server));
  return `http://127.0.0.1:${server.address().port}/correct`;
}

test('Correction uses only the supplied text; Gemma and Ollama return the same contract', async t => {
  for (const model of ['gemma4:e4b', 'qwen3.8:9b-q6-32k']) {
    const url = await harness(t, async (url, init) => {
      const payload = JSON.parse(init.body);
      assert.deepEqual(payload.messages, [{ role: 'system', content: CORRECTION_PROMPT }, { role: 'user', content: input.text }]);
      assert.equal(payload.stream, false);
      if (model === 'gemma4:e4b') {
        assert.equal(url, 'http://llama:8080/v1/chat/completions');
        assert.equal(payload.chat_template_kwargs.enable_thinking, false);
        assert.equal(payload.temperature, 0.05);
        return Response.json({ choices: [{ message: { content: 'Bonjour, comment vas-tu ?', reasoning_content: 'private reasoning' }, finish_reason: 'stop' }] });
      }
      assert.equal(url, 'http://ollama:11434/api/chat');
      assert.equal(payload.think, false); assert.equal(payload.options.temperature, 0.05);
      return Response.json({ message: { content: 'Bonjour, comment vas-tu ?', thinking: 'private reasoning' }, done: true, done_reason: 'stop' });
    });
    const response = await post(url, { ...input, model });
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    const json = await response.json(); assert.equal(json.correctedText, 'Bonjour, comment vas-tu ?');
    assert.equal(json.choices[0].message.content, json.correctedText); assert.equal(json.model, model);
    assert.doesNotMatch(JSON.stringify(json), /private reasoning/);
  }
});

test('Correction schema rejects blank, excessive, unexpected or non-text input', () => {
  assert.equal(correctionInputSchema.parse({ text: 'bonjour' }).model, 'gemma4:e4b');
  assert.equal(correctionInputSchema.safeParse({ text: 'a'.repeat(10_000) }).success, true);
  for (const body of [{}, { text: '' }, { text: ' \n\t' }, { text: 12 }, { text: 'a'.repeat(10_001) }, { ...input, messages: [] }, { ...input, model: '' }]) {
    assert.equal(correctionInputSchema.safeParse(body).success, false);
  }
});

test('Reasoning and an outer markdown fence are removed without changing paragraphs', async t => {
  const url = await harness(t, async () => Response.json({ choices: [{ message: { content: '<think>raison</think>\n```markdown\n# Bonjour\n\n- Comment vas-tu ?\n```' }, finish_reason: 'stop' }] }));
  assert.equal((await (await post(url)).json()).correctedText, '# Bonjour\n\n- Comment vas-tu ?');
});

test('Empty, truncated, malformed and failed upstream responses never masquerade as a correction', async t => {
  const failures = [
    () => Response.json({ choices: [{ message: { content: 'partiel SECRET' }, finish_reason: 'length' }] }),
    () => Response.json({ choices: [{ message: { content: '<think>SECRET' } }] }),
    () => Response.json({ choices: [{ message: { content: ' ' } }] }),
    () => Response.json({ choices: [{ message: { content: 12 } }] }),
    () => Response.json({ error: 'SECRET internal path' }, { status: 500 }),
    () => new Response('SECRET malformed JSON'),
    () => { throw new Error('SECRET connection failure'); },
  ];
  for (const failure of failures) {
    const url = await harness(t, async () => failure()); const response = await post(url);
    assert.equal(response.status, 502); assert.doesNotMatch(await response.text(), /SECRET|correctedText/);
  }
  const url = await harness(t, async () => Response.json({ message: { content: 'partiel' }, done_reason: 'length' }));
  assert.equal((await post(url, { ...input, model: 'qwen3.8:9b-q6-32k' })).status, 502);
});

test('Disconnect cancels pending correction work', async t => {
  let started, aborted;
  const ready = new Promise(resolve => { started = resolve; });
  const cancelled = new Promise(resolve => { aborted = resolve; });
  const url = await harness(t, (_, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => { aborted(); reject(init.signal.reason); }, { once: true }); started();
  }));
  const controller = new AbortController(); const request = post(url, input, controller.signal).catch(() => {});
  await ready; controller.abort(); await request;
  await Promise.race([cancelled, new Promise((_, reject) => { setTimeout(() => reject(new Error('correction not cancelled')), 1000).unref(); })]);
});

test('Real API: Bearer authentication, network policy, aliases, model limits and revocation', async t => {
  // Real routes and migrations; disposable database and local model stub only.
  const cache = 'node_modules/.cache/ai-correction'; await mkdir(cache, { recursive: true });
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await close(probe);
  let generations = 0;
  const upstream = createHttpServer(async (req, res) => {
    let raw = ''; for await (const part of req) raw += part;
    const payload = JSON.parse(raw); generations++;
    assert.equal(payload.model, 'gemma4:e4b'); assert.equal(payload.stream, false);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Bonjour, comment vas-tu ?' }, finish_reason: 'stop' }] }));
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening'); t.after(() => close(upstream));
  const db = await PGlite.create({ extensions: { vector } }); t.after(() => db.close());
  globalThis.__mansotCorrectionPool = createTestPool(db);
  await build({ entryPoints: ['server/index.ts'], outfile: `${cache}/index.mjs`, bundle: true, platform: 'node', format: 'esm', packages: 'external',
    plugins: [{ name: 'temporary-postgres', setup(builder) {
      builder.onResolve({ filter: /^\.\/db\.js$/ }, () => ({ path: 'test-db', namespace: 'test' }));
      builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const pool=globalThis.__mansotCorrectionPool; export async function assertDatabase(){await pool.query("SELECT 1");}' }));
    } }] });
  await cp('server/migrations', `${cache}/migrations`, { recursive: true });
  const env = { HOST: '127.0.0.1', PORT: String(port), NODE_ENV: 'test', INITIAL_ADMIN_USERNAME: 'CorrectionTest',
    INITIAL_ADMIN_PASSWORD: 'Correction-test-2026!', ALLOW_PUBLIC_TOKENS: '0', ALLOWED_AI_MODELS: 'gemma4:e4b,qwen3.8:9b-q6-32k',
    LLAMA_CHAT_URL: `http://127.0.0.1:${upstream.address().port}/v1`, LLAMA_CHAT_MODEL: '', OLLAMA_URL: `http://127.0.0.1:${upstream.address().port}/v1` };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]])); Object.assign(process.env, env);
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const { httpServer } = await import(new URL(`../${cache}/index.mjs`, import.meta.url));
  t.after(() => close(httpServer)); if (!httpServer.listening) await once(httpServer, 'listening');
  const base = `http://127.0.0.1:${port}`;
  const request = (path, body, headers = {}) => fetch(base + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const login = await request('/auth/login', { username: 'CorrectionTest', password: env.INITIAL_ADMIN_PASSWORD }); assert.equal(login.status, 200);
  const user = (await login.json()).user; const session = { Cookie: login.headers.get('set-cookie').split(';')[0], 'X-Mansot-User': user.id };
  const created = await request('/tokens', { name: 'corrector', permissions: { read: true, write: false } }, session);
  assert.equal(created.status, 201); const token = await created.json(); const bearer = { Authorization: `Bearer ${token.token}` };
  assert.equal((await request('/api/v1/ai/correct', input)).status, 401);
  assert.equal((await request('/api/v1/ai/correct', input, { Authorization: 'Bearer invalid-token-with-enough-characters' })).status, 401);
  assert.equal((await request('/api/v1/ai/correct', { text: ' ' }, bearer)).status, 400);
  assert.equal((await request('/api/v1/ai/correct', { text: 'x'.repeat(10_001) }, bearer)).status, 400);
  assert.equal((await request('/api/v1/ai/correct', { ...input, model: 'not-allowed' }, bearer)).status, 403);
  const edge = { 'CF-Connecting-IP': '93.184.216.34', 'CF-Ray': 'test', 'X-Forwarded-For': '93.184.216.34' };
  assert.equal((await request('/api/v1/ai/correct', input, { ...bearer, ...edge })).status, 403); assert.equal(generations, 0);
  for (const path of ['/api/v1/ai/correct', '/v1/ai/correct']) {
    const response = await request(path, { text: input.text }, bearer); assert.equal(response.status, 200);
    assert.equal((await response.json()).correctedText, 'Bonjour, comment vas-tu ?');
  }
  assert.equal((await request('/v1/ai/correct', input, session)).status, 200);
  for (const path of ['/api/v1/ai/chat/completions', '/v1/ai/chat/completions']) {
    const response = await request(path, { model: input.model, messages: [{ role: 'user', content: input.text }], stream: false, think: false }, bearer);
    assert.equal(response.status, 200); assert.equal((await response.json()).choices[0].message.content, 'Bonjour, comment vas-tu ?');
  }
  const models = await request('/api/v1/ai/models', undefined, bearer); assert.equal(models.status, 200);
  assert.equal((await globalThis.__mansotCorrectionPool.query('SELECT count(*)::int AS n FROM notes')).rows[0].n, 0);
  assert.equal(generations, 5);
  const revoked = await globalThis.__mansotCorrectionPool.query('DELETE FROM api_tokens WHERE id=$1', [token.record.id]);
  assert.equal(revoked.rowCount, 1);
  assert.equal((await request('/api/v1/ai/correct', input, bearer)).status, 401);
});
