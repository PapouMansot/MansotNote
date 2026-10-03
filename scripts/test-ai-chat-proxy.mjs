import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import express from 'express';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';

const built = await build({ entryPoints: ['server/ai-chat.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { proxyAiChat } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const defaults = { model: 'gemma4:e4b', messages: [{ role: 'user', content: 'bonjour' }], temperature: 0.15, stream: false };
const config = { ollamaHost: 'http://ollama:11434', ollamaNumCtx: 32768, llamaChatUrl: 'http://llama-gemma:8080/v1/' };
async function harness(t, upstream, options = config) {
  const app = express(); app.use(express.json());
  app.post('/chat', (req, res) => proxyAiChat(req, res, { ...defaults, ...req.body }, options, upstream));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}/chat`;
}
const post = (url, body = {}, signal) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
function textStream(text) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3)); controller.close(); } });
}
test('Gemma OpenAI: base URL, default thinking, tokens, separated reasoning and JSON', async t => {
  const url = await harness(t, async (url, init) => {
    assert.equal(url, 'http://llama-gemma:8080/v1/chat/completions');
    assert.deepEqual(JSON.parse(init.body), { ...defaults, max_tokens: 42, chat_template_kwargs: { enable_thinking: true } });
    assert.equal(init.signal.aborted, false);
    await new Promise(r => setTimeout(r, 20)); // completed request must not abort upstream
    assert.equal(init.signal.aborted, false);
    return Response.json({ choices: [{ message: { role: 'assistant', content: 'réponse', reasoning_content: 'pensée' } }] });
  });
  const response = await post(url, { max_tokens: 42 });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).choices[0].message, { role: 'assistant', content: 'réponse', reasoning_content: 'pensée' });
});
test('multimodal messages preserve OpenAI parts and map Ollama images separately', async t => {
  const image = `data:image/png;base64,${Buffer.alloc(4, 7).toString('base64')}`;
  const messages = [{ role: 'user', content: [{ type: 'text', text: 'Describe' }, { type: 'image_url', image_url: { url: image } }] }];
  const llama = await harness(t, async (_, init) => {
    assert.deepEqual(JSON.parse(init.body).messages, messages);
    return Response.json({ choices: [{ message: { content: 'ok' } }] });
  });
  assert.equal((await post(llama, { messages })).status, 200);
  const ollama = await harness(t, async (_, init) => {
    assert.deepEqual(JSON.parse(init.body).messages, [{ role: 'user', content: 'Describe', images: [Buffer.alloc(4, 7).toString('base64')] }]);
    return Response.json({ message: { content: 'ok' } });
  }, { ...config, llamaChatUrl: '' });
  assert.equal((await post(ollama, { model: 'qwen3.8:9b-q6-32k', messages })).status, 200);
});
test('multimodal input validation rejects malformed data URLs, oversized images and excessive history', async () => {
  const built = await build({ entryPoints: ['server/ai-chat-input.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
  const { chatMessagesSchema } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
  const validImage = `data:image/webp;base64,${Buffer.alloc(3).toString('base64')}`;
  const message = (url) => [{ role: 'user', content: [{ type: 'image_url', image_url: { url } }] }];
  assert.equal(chatMessagesSchema.safeParse(message(validImage)).success, true);
  for (const url of ['data:image/svg+xml;base64,AAAA', 'data:image/png;base64,%%%=', 'data:image/jpeg;base64,']) assert.equal(chatMessagesSchema.safeParse(message(url)).success, false);
  assert.equal(chatMessagesSchema.safeParse(message(`data:image/png;base64,${Buffer.alloc(4 * 1024 * 1024 + 1).toString('base64')}`)).success, false);
  const four = [{ role: 'user', content: Array.from({ length: 4 }, () => ({ type: 'image_url', image_url: { url: validImage } })) }];
  assert.equal(chatMessagesSchema.safeParse(four).success, true);
  assert.equal(chatMessagesSchema.safeParse([{ role: 'user', content: [...four[0].content, { type: 'image_url', image_url: { url: validImage } }] }]).success, false);
  assert.equal(chatMessagesSchema.safeParse([{ role: 'user', content: 'x'.repeat(50_001) }]).success, false);
  assert.equal(chatMessagesSchema.safeParse([{ role: 'user', content: 'x'.repeat(50_000) }, { role: 'assistant', content: 'x'.repeat(50_000) }, { role: 'user', content: 'x'.repeat(20_001) }]).success, false);
});
test('Gemma SSE: fragmented UTF-8 / CRLF / reasoning / DONE', async t => {
  const events = [{ choices: [{ delta: { reasoning_content: 'réflexion' } }] }, { choices: [{ delta: { content: 'été' }, finish_reason: 'stop' }] }];
  const url = await harness(t, async (_, init) => {
    const body = JSON.parse(init.body); assert.equal(body.chat_template_kwargs.enable_thinking, false); assert.equal(body.temperature, 0.7);
    return new Response(textStream(events.map(e => `data: ${JSON.stringify(e)}\r\n\r\n`).join('') + 'data: [DONE]\r\n\r\n'), { headers: { 'Content-Type': 'text/event-stream' } });
  });
  const response = await post(url, { stream: true, think: false, temperature: 0.7 });
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const text = await response.text();
  assert.match(text, /réflexion/); assert.match(text, /été/); assert.equal(text.split('[DONE]').length, 2);
  assert.deepEqual(JSON.parse(text.split('\n\n')[0].slice(6)), events[0]);
});
test('Qwen and unconfigured Gemma remain Ollama, preserving options', async t => {
  for (const [model, options] of [['qwen3.8:9b-q6-32k', config], ['gemma4:e4b', { ...config, llamaChatUrl: '' }]]) {
    const url = await harness(t, async (url, init) => {
      assert.equal(url, 'http://ollama:11434/api/chat');
      assert.deepEqual(JSON.parse(init.body), { model, messages: defaults.messages, stream: false, think: false, keep_alive: -1, options: { temperature: 0.15, num_ctx: 32768, num_predict: 23 } });
      return Response.json({ message: { content: 'ok', thinking: 'raison' } });
    }, options);
    const json = await (await post(url, { model, think: false, max_tokens: 23 })).json();
    assert.equal(json.choices[0].message.content, 'ok'); assert.equal(json.choices[0].message.reasoning_content, 'raison');
  }
});
test('Ollama NDJSON: final unterminated line and separate thinking', async t => {
  const url = await harness(t, async () => new Response(textStream('{"message":{"thinking":"raison","content":"ok"}}\n{"done":true}')));
  const text = await (await post(url, { model: 'qwen3.8:9b-q6-32k', stream: true })).text();
  assert.match(text, /"reasoning_content":"raison"/); assert.match(text, /"content":"ok"/); assert.equal(text.split('[DONE]').length, 2);
});
test('Upstream failures before and after SSE headers never leak details', async t => {
  for (const stream of [false, true]) {
    const url = await harness(t, async () => Response.json({ error: 'SECRET /private/path' }, { status: 500 }));
    const response = await post(url, { stream }); assert.equal(response.status, 502); assert.doesNotMatch(await response.text(), /SECRET|private/);
  }
  const url = await harness(t, async () => new Response(textStream('data: {"error":{"message":"SECRET"}}\n\n')));
  const response = await post(url, { stream: true }); assert.equal(response.status, 200); assert.doesNotMatch(await response.text(), /SECRET/);
  const broken = await harness(t, async () => { throw new Error('SECRET network'); });
  const response2 = await post(broken, { stream: true }); assert.equal(response2.status, 502); assert.match(response2.headers.get('content-type'), /json/);
});
test('Disconnect actually aborts pending upstream in both branches', async t => {
  for (const stream of [false, true]) {
    let started; const ready = new Promise(r => { started = r; });
    let aborted; const cancelled = new Promise(r => { aborted = r; });
    const url = await harness(t, (_, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => { aborted(); reject(init.signal.reason); }, { once: true }); started();
    }));
    const controller = new AbortController(); const request = post(url, { stream }, controller.signal).catch(() => {});
    await ready; controller.abort(); await request;
    await Promise.race([cancelled, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('upstream not aborted')), 1000); timer.unref(); })]);
  }
});
test('Disconnect after SSE headers aborts the active upstream reader (both backends)', async t => {
  for (const model of ['gemma4:e4b', 'qwen3.8:9b-q6-32k']) {
    let notify; const cancelled = new Promise(resolve => { notify = resolve; });
    const url = await harness(t, async (_, init) => new Response(new ReadableStream({
      start(controller) {
        init.signal.addEventListener('abort', () => { notify(); controller.error(new Error('aborted')); }, { once: true });
        controller.enqueue(new TextEncoder().encode(model === 'gemma4:e4b' ? 'data: {"choices":[{"delta":{"content":"first"}}]}\n\n' : '{"message":{"content":"first"}}\n'));
      },
    })));
    const controller = new AbortController(); const response = await post(url, { model, stream: true }, controller.signal);
    const reader = response.body.getReader(); assert.equal((await reader.read()).done, false); controller.abort();
    await Promise.race([cancelled, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('reader not aborted')), 1000); timer.unref(); })]);
    await reader.cancel().catch(() => {});
  }
});
test('Malformed / truncated upstream streams return a generic error, not DONE', async t => {
  for (const text of ['data: SECRET not JSON\n\n', 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n']) {
    const url = await harness(t, async () => new Response(textStream(text)));
    const result = await (await post(url, { stream: true })).text();
    assert.match(result, /Flux IA interrompu/); assert.doesNotMatch(result, /SECRET|\[DONE\]/);
  }
});
test('Server-only llama alias does not alter Ollama model routing', async t => {
  const url = await harness(t, async (_, init) => {
    assert.equal(JSON.parse(init.body).model, 'gemma-alias');
    return Response.json({ choices: [{ message: { content: 'ok' } }] });
  }, { ...config, llamaChatModel: 'gemma-alias' });
  assert.equal((await post(url)).status, 200);
});
test('Route protections and embeddings routing stay present', () => {
  const source = readFileSync('server/index.ts', 'utf8');
  assert.match(source, /aiLimiter, authenticate/); assert.match(source, /isAllowedAiModel\(parsed.data.model\)/); assert.match(source, /chatMessagesSchema/);
  assert.match(source, /\$\{OLLAMA_HOST\}\/v1\/embeddings/);
});
