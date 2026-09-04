#!/usr/bin/env node
/**
 * Vérification one-shot du fallback CORS de `chatComplete` (src/lib/ai.ts)
 * contre un serveur local qui imite LM Studio :
 *   - les OPTIONS et les POST `application/json` échouent (préflight bloquée,
 *     simulée par une coupure de socket = le TypeError que voit le navigateur) ;
 *   - les POST « simples » (text/plain) sont acceptés : le corps JSON est
 *     parsé quel que soit le Content-Type (comportement des serveurs Go) ;
 *   - `GET /v1/models` renvoie la liste des modèles.
 *
 * Exécution (après `npm run smoke` pour le bundle) :
 *   node scripts/test-ai-fallback.mjs
 */
import http from 'node:http';
import assert from 'node:assert/strict';

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/v1/models') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'qwen/qwen3.8-27b' }, { id: 'llama3.1' }] }));
    return;
  }
  if (req.method === 'OPTIONS' || (req.headers['content-type'] || '').includes('application/json')) {
    // Préflight bloquée côté navigateur : coupure brutale → TypeError côté fetch.
    req.socket.destroy();
    return;
  }
  let data = '';
  req.on('data', (chunk) => (data += chunk));
  req.on('end', () => {
    let body;
    try {
      body = JSON.parse(data);
    } catch {
      body = undefined;
    }
    if (!body || !Array.isArray(body.messages) || !body.model) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: "'messages' field is required" } }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        choices: [{ message: { content: '```markdown\n# OK\n\nreçu: ' + body.model + '\n```' } }],
      }),
    );
  });
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

const { chatComplete, listModels } = await import(
  new URL('../node_modules/.cache/smoke/lib/ai.js', import.meta.url)
);

// 1. Le serveur « LM Studio-like » accepte bien un POST text/plain à corps JSON.
const textPlain = await new Promise((resolve, reject) => {
  const req = http.request(
    {
      host: '127.0.0.1',
      port,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    },
    (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    },
  );
  req.on('error', reject);
  req.end(JSON.stringify({ model: 'qwen/qwen3.8-27b', messages: [{ role: 'user', content: 'hello' }] }));
});
assert.equal(textPlain.status, 200, `POST text/plain refusé : ${textPlain.body}`);
console.log('ok   serveur type LM Studio : corps JSON parsé malgré Content-Type: text/plain');

// 2. chatComplete : le 1er essai (JSON) est « bloqué » → le fallback text/plain passe.
const out = await chatComplete(
  { endpoint: `http://127.0.0.1:${port}`, apiKey: '', model: 'qwen/qwen3.8-27b' },
  [{ role: 'user', content: 'hello' }],
);
assert.equal(out, '# OK\n\nreçu: qwen/qwen3.8-27b', 'fallback + retrait des clôtures');
console.log('ok   chatComplete : premier essai bloqué → fallback simple réussi + clôtures retirées');

// 3. listModels via GET /models.
const models = await listModels({ endpoint: `http://127.0.0.1:${port}`, apiKey: '', model: '' });
assert.deepEqual(models, ['llama3.1', 'qwen/qwen3.8-27b'], 'liste triée des modèles');
console.log('ok   listModels : GET /models → ' + models.join(', '));

server.close();
console.log('\nFallback LM Studio : 3/3 ok\n');
