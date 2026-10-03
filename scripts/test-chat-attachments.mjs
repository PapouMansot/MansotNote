import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const built = await build({ entryPoints: ['src/lib/chat-attachments.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
  alias: { '@': './src' }, define: { 'import.meta.env': '{}' }, external: ['pdfjs-dist', 'pdfjs-dist/*'] });
const { buildAttachmentMessages, prepareChatAttachment } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const pdf = (text, extra = {}) => ({ id: 'pdf-test', name: 'document.pdf', kind: 'pdf', size: 12, imageCount: 0, text, ...extra });

test('PDF text is retained in follow-up questions beyond the ordinary 2000-character history cutoff', async () => {
  const document = 'x'.repeat(4000) + '\nMontant : 42 euros';
  const messages = await buildAttachmentMessages([{ role: 'user', content: 'Analyse ce document.', attachments: [pdf(document)] }], { role: 'user', content: 'Quel est le montant ?' });
  assert.match(messages[0].content, /Montant : 42 euros/);
  assert.match(messages[0].content, /document.pdf/);
  assert.equal(messages[1].content, 'Quel est le montant ?');
});

test('Multiple long PDFs produce bounded messages and explicit truncation indicators', async () => {
  const attachments = Array.from({ length: 4 }, () => pdf('x'.repeat(20_000), { truncated: true }));
  const messages = await buildAttachmentMessages([{ role: 'user', content: 'Ancien message', attachments }], { role: 'user', content: 'Analyse', attachments });
  assert.ok(messages[0].content.length < 11_000);
  assert.ok(messages[1].content.length < 33_000);
  assert.match(messages[1].content, /tronqués/);
});

test('Text-only chats remain strings and action payloads are stripped from history', async () => {
  const messages = await buildAttachmentMessages([{ role: 'assistant', content: 'Note enregistrée.\n```action:create_note\n{"content":"secret payload"}\n```' }], { role: 'user', content: 'Merci.' });
  assert.deepEqual(messages, [{ role: 'assistant', content: 'Note enregistrée.' }, { role: 'user', content: 'Merci.' }]);
});

test('Files cannot be prepared outside an authenticated browser account', async () => {
  await assert.rejects(() => prepareChatAttachment(new File(['test'], 'test.pdf', { type: 'application/pdf' })), /Connectez-vous/);
});
