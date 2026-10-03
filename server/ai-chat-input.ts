import { z } from 'zod';

export const MAX_CHAT_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_DATA_URL = 32 + Math.ceil(MAX_CHAT_IMAGE_BYTES * 4 / 3);
const imageDataUrl = z.string().max(MAX_IMAGE_DATA_URL).superRefine((value, ctx) => {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]*={0,2})$/.exec(value);
  if (!match || !match[2].length || match[2].length % 4 !== 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid image data URL' }); return;
  }
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > MAX_CHAT_IMAGE_BYTES || bytes.toString('base64') !== match[2]) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid or oversized image' });
  }
});

const textPart = z.object({ type: z.literal('text'), text: z.string().max(50_000) }).strict();
const imagePart = z.object({ type: z.literal('image_url'), image_url: z.object({ url: imageDataUrl }).strict() }).strict();
export const chatContentSchema = z.union([
  z.string().max(50_000),
  z.array(z.union([textPart, imagePart])).min(1).max(5),
]);
export const chatMessagesSchema = z.array(z.object({
  role: z.enum(['system', 'user', 'assistant']), content: chatContentSchema,
}).strict()).min(1).max(30).superRefine((messages, ctx) => {
  let totalChars = 0;
  let imageCount = 0;
  for (const [messageIndex, message] of messages.entries()) {
    const parts = typeof message.content === 'string' ? [{ type: 'text' as const, text: message.content }] : message.content;
    let messageChars = 0;
    for (const [partIndex, part] of parts.entries()) {
      if (part.type === 'text') { totalChars += part.text.length; messageChars += part.text.length; }
      else imageCount++;
      if (part.type === 'image_url' && message.role !== 'user') {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [messageIndex, 'content', partIndex], message: 'Images are only allowed in user messages' });
      }
    }
    if (messageChars > 50_000) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [messageIndex, 'content'], message: 'Message text exceeds 50000 characters' });
  }
  if (totalChars > 120_000) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Total chat text exceeds 120000 characters' });
  if (imageCount > 4) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'At most four images are allowed' });
});

export type ChatContent = z.infer<typeof chatContentSchema>;
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: ChatContent };
