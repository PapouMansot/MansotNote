import type { Request, Response } from 'express';

export interface ChatInput {
  model: string;
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
  temperature: number;
  max_tokens?: number;
  think?: boolean;
  stream: boolean;
}
interface ChatBackendConfig {
  ollamaHost: string;
  ollamaNumCtx: number;
  /** OpenAI API base, e.g. http://llama-gemma:8080/v1. Optional. */
  llamaChatUrl?: string;
  llamaChatModel?: string;
}

// Decode split UTF-8 chunks and both CRLF/LF. Also consume a final unterminated line.
async function* lines(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        yield buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
      }
      if (done) { if (buffer) yield buffer.replace(/\r$/, ''); break; }
    }
  } finally {
    try { await reader.cancel(); } catch { /* disconnected/aborted stream */ }
    reader.releaseLock();
  }
}

async function* sseData(body: ReadableStream<Uint8Array>) {
  let data: string[] = [];
  for await (const line of lines(body)) {
    if (line === '') {
      if (data.length) yield data.join('\n');
      data = [];
    } else if (line.startsWith('data:')) {
      data.push(line.slice(5).replace(/^ /, ''));
    }
  }
  if (data.length) yield data.join('\n');
}

export async function proxyAiChat(
  req: Request, res: Response, input: ChatInput, config: ChatBackendConfig,
  fetchUpstream: typeof fetch = fetch,
): Promise<void> {
  const useLlama = input.model === 'gemma4:e4b' && Boolean(config.llamaChatUrl?.trim());
  const url = useLlama
    ? `${config.llamaChatUrl!.trim().replace(/\/+$/, '')}/chat/completions`
    : `${config.ollamaHost}/api/chat`;
  const payload = useLlama ? {
    model: config.llamaChatModel?.trim() || input.model,
    messages: input.messages,
    stream: input.stream,
    temperature: input.temperature,
    ...(input.max_tokens !== undefined ? { max_tokens: input.max_tokens } : {}),
    chat_template_kwargs: { enable_thinking: input.think ?? true },
  } : {
    model: input.model, messages: input.messages, stream: input.stream,
    ...(input.think !== undefined ? { think: input.think } : {}),
    keep_alive: -1,
    options: {
      temperature: input.temperature, num_ctx: config.ollamaNumCtx,
      ...(input.max_tokens !== undefined ? { num_predict: input.max_tokens } : {}),
    },
  };
  const controller = new AbortController();
  // IncomingMessage.close can fire after receiving the POST body, before generation.
  const onClose = () => { if (!res.writableEnded) controller.abort(); };
  res.on('close', onClose);
  const timeout = setTimeout(() => controller.abort(), 600_000);
  timeout.unref();
  const write = async (data: string) => {
    if (controller.signal.aborted || res.destroyed) throw new Error('Client disconnected');
    if (res.write(data)) {
      (res as Response & { flush?: () => void }).flush?.();
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { res.off('drain', onDrain); controller.signal.removeEventListener('abort', onAbort); };
      const onDrain = () => { cleanup(); resolve(); };
      const onAbort = () => { cleanup(); reject(new Error('Chat aborted')); };
      res.once('drain', onDrain);
      controller.signal.addEventListener('abort', onAbort, { once: true });
      if (controller.signal.aborted) onAbort();
    });
  };
  const send = (value: unknown) => write(`data: ${JSON.stringify(value)}\n\n`);
  let upstream: globalThis.Response | undefined;
  try {
    upstream = await fetchUpstream(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: controller.signal,
    });
    if (controller.signal.aborted || res.destroyed) return;
    if (!upstream.ok || (input.stream && !upstream.body)) {
      // Never relay backend error bodies (paths, prompts, HTML, infrastructure details).
      res.status(502).json({ error: 'Erreur du serveur IA' });
      return;
    }
    if (!input.stream) {
      const data = await upstream.json();
      if (data.error) throw new Error('Upstream chat error');
      if (controller.signal.aborted || res.destroyed) return;
      if (useLlama) {
        if (!Array.isArray(data.choices)) throw new Error('Invalid upstream completion');
        res.json(data);
      } else {
        res.json({ choices: [{ message: {
          role: 'assistant', content: data.message?.content || '',
          ...(data.message?.thinking ? { reasoning_content: data.message.thinking } : {}),
        } }] });
      }
      return;
    }
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    req.socket?.setNoDelay(true);
    res.socket?.setNoDelay(true);
    res.flushHeaders();
    if (useLlama) {
      for await (const data of sseData(upstream.body!)) {
        if (data === '[DONE]') { await write('data: [DONE]\n\n'); res.end(); return; }
        const event = JSON.parse(data);
        if (event.error) throw new Error('Upstream stream error');
        // Preserve reasoning_content independently, finish_reason and usage.
        if (!Array.isArray(event.choices)) throw new Error('Invalid upstream chunk');
        await send(event);
      }
      throw new Error('Upstream stream ended without DONE');
    }
    const id = `chatcmpl-${Date.now()}`;
    const chunk = (delta: Record<string, unknown>) => send({ id, object: 'chat.completion.chunk', choices: [{ index: 0, delta }] });
    await chunk({ role: 'assistant' });
    for await (const line of lines(upstream.body!)) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      if (event.error) throw new Error('Upstream stream error');
      if (event.message?.thinking) await chunk({ reasoning_content: event.message.thinking });
      if (event.message?.content) await chunk({ content: event.message.content });
      if (event.done) {
        await chunk({}); await write('data: [DONE]\n\n'); res.end(); return;
      }
    }
    throw new Error('Upstream stream ended without done');
  } catch {
    if (!res.destroyed && !res.writableEnded) {
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ error: { message: 'Flux IA interrompu' } })}\n\n`);
        res.end();
      } else {
        res.status(502).json({ error: 'Impossible de joindre le serveur IA local' });
      }
    }
  } finally {
    clearTimeout(timeout);
    res.off('close', onClose);
    controller.abort(); // stop generation on protocol errors / early DONE as well
    if (upstream?.body && !upstream.body.locked) {
      try { await upstream.body.cancel(); } catch { /* already consumed */ }
    }
  }
}
