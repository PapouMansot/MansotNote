import type { ChatContentPart, ChatMessage } from './ai';
import { sanitizeHistoryContent } from './ai';
import { getBrowserUser } from './browser-user';

export const CHAT_ATTACHMENT_ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp';
export const MAX_CHAT_ATTACHMENTS = 4;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_PDF_PAGES = 50;
const MAX_PDF_TEXT = 20_000;

export interface ChatAttachment {
  id: string;
  name: string;
  kind: 'image' | 'pdf';
  size: number;
  text?: string;
  imageCount: number;
  pageCount?: number;
  truncated?: boolean;
}

// Images stay out of localStorage, whose quota is too small for chat histories.
let database: Promise<IDBDatabase> | undefined;
function openDatabase(): Promise<IDBDatabase> {
  if (!database) {
    database = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('mansotnote.chat-assets', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('images');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Le stockage des pièces jointes est indisponible.'));
    }).catch((error) => { database = undefined; throw error; });
  }
  return database;
}

function ownerKey(id: string): string {
  const user = getBrowserUser();
  if (!user) throw new Error('Connectez-vous pour ajouter une pièce jointe.');
  return `${user.id}:${id}`;
}

async function assetOperation<T>(id: string, mode: IDBTransactionMode, action: (store: IDBObjectStore, key: string) => IDBRequest<T>): Promise<T> {
  const key = ownerKey(id); // Capture the account before any asynchronous work.
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('images', mode);
    const request = action(tx.objectStore('images'), key);
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = tx.onerror = () => reject(new Error('Impossible de conserver la pièce jointe dans ce navigateur.'));
  });
}

export async function getAttachmentImages(attachment: ChatAttachment): Promise<string[]> {
  const images = await assetOperation(attachment.id, 'readonly', (store, key) => store.get(key));
  if (!Array.isArray(images) || images.length !== attachment.imageCount) {
    throw new Error(`La pièce jointe « ${attachment.name} » n’est plus disponible. Ajoutez-la de nouveau.`);
  }
  return images;
}

export async function deleteAttachmentAssets(attachments: ChatAttachment[]): Promise<void> {
  await Promise.all(attachments.filter((a) => a.imageCount).map((a) =>
    assetOperation(a.id, 'readwrite', (store, key) => store.delete(key))));
}

function canvasImage(canvas: HTMLCanvasElement): string {
  let data = canvas.toDataURL('image/jpeg', 0.85);
  if (data.length > 1_400_000) data = canvas.toDataURL('image/jpeg', 0.55);
  if (data.length > 1_400_000) throw new Error('Cette image reste trop volumineuse après compression.');
  return data;
}

async function readImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('Image illisible.');
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Impossible de préparer cette image.');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvasImage(canvas);
  } finally { URL.revokeObjectURL(url); }
}

export async function prepareChatAttachment(file: File): Promise<ChatAttachment> {
  const owner = getBrowserUser()?.id;
  if (!owner) throw new Error('Connectez-vous pour ajouter une pièce jointe.');
  if (file.size === 0) throw new Error(`« ${file.name} » est vide.`);
  if (file.size > MAX_FILE_BYTES) throw new Error(`« ${file.name} » dépasse la limite de 10 Mo.`);
  const attachment: ChatAttachment = {
    id: crypto.randomUUID(), name: file.name.slice(0, 200), size: file.size,
    kind: file.type === 'application/pdf' || /\.pdf$/i.test(file.name) ? 'pdf' : 'image', imageCount: 0,
  };
  let images: string[] = [];
  if (attachment.kind === 'image') {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Formats acceptés : PDF, PNG, JPEG et WebP.');
    images = [await readImage(file)];
  } else {
    // Lazy loaded, including the local worker: no document is sent to a PDF service.
    const pdfjs = await import('pdfjs-dist');
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const assetBase = `${import.meta.env.BASE_URL}pdfjs/${pdfjs.version}/`;
    const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()),
      cMapUrl: `${assetBase}cmaps/`, cMapPacked: true,
      standardFontDataUrl: `${assetBase}standard_fonts/`, wasmUrl: `${assetBase}wasm/`,
    });
    let passwordProtected = false;
    task.onPassword = () => { passwordProtected = true; void task.destroy().catch(() => {}); };
    try {
      const pdf = await task.promise;
      attachment.pageCount = pdf.numPages;
      if (pdf.numPages > MAX_PDF_PAGES) throw new Error('Ce PDF dépasse 50 pages. Joignez un extrait plus court.');
      let text = '';
      for (let index = 1; index <= pdf.numPages; index++) {
        const page = await pdf.getPage(index);
        const content = await page.getTextContent();
        const pageText = content.items.map((item) => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').trim();
        if (pageText) text += `\n--- Page ${index} ---\n${pageText}\n`;
        else {
          if (images.length >= MAX_CHAT_ATTACHMENTS) throw new Error('Ce PDF contient plus de 4 pages scannées. Joignez un extrait de 4 pages maximum.');
          const original = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: Math.min(2, 1600 / Math.max(original.width, original.height)) });
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
          await page.render({ canvas, viewport }).promise;
          images.push(canvasImage(canvas));
          text += `\n--- Page ${index} : image jointe ${images.length} ---\n`;
        }
        page.cleanup();
        if (text.length > MAX_PDF_TEXT) { attachment.truncated = index < pdf.numPages || text.length > MAX_PDF_TEXT; break; }
      }
      attachment.text = text.slice(0, MAX_PDF_TEXT).trim();
    } catch (error) {
      if (passwordProtected) throw new Error('Ce PDF est protégé par un mot de passe. Joignez une version déverrouillée.');
      throw error;
    } finally { await task.destroy(); }
  }
  attachment.imageCount = images.length;
  if (getBrowserUser()?.id !== owner) throw new Error('Le compte actif a changé. Ajoutez de nouveau la pièce jointe.');
  if (images.length) await assetOperation(attachment.id, 'readwrite', (store, key) => store.put(images, key));
  return attachment;
}

interface AttachmentTurn { role: 'user' | 'assistant'; content: string; attachments?: ChatAttachment[] }

/** The newest images take priority; history retains document text and file names. */
export async function buildAttachmentMessages(history: AttachmentTurn[], current: AttachmentTurn): Promise<ChatMessage[]> {
  const turns = [...history.slice(-8), current];
  let remainingImages = MAX_CHAT_ATTACHMENTS;
  const built: ChatMessage[] = [];
  for (let index = turns.length - 1; index >= 0; index--) {
    const turn = turns[index];
    const isCurrent = index === turns.length - 1;
    const documentLimit = isCurrent ? 32_000 : 8_000;
    let documentText = '';
    const parts: ChatContentPart[] = [];
    const perDocumentLimit = Math.floor((documentLimit - 1024) / Math.max(1, turn.attachments?.length ?? 0));
    for (const attachment of turn.attachments ?? []) {
      documentText += `\n\n=== Pièce jointe : ${attachment.name} ===\n${(attachment.text ?? '').slice(0, perDocumentLimit)}`;
      if ((attachment.text?.length ?? 0) > perDocumentLimit) documentText += '\n[Extraits des pièces jointes tronqués.]';
      if (attachment.truncated) documentText += '\n[PDF tronqué aux 20 000 premiers caractères.]';
      if (attachment.imageCount) {
        if (attachment.imageCount <= remainingImages) {
          const images = await getAttachmentImages(attachment);
          parts.push(...images.map((url): ChatContentPart => ({ type: 'image_url', image_url: { url } })));
          remainingImages -= images.length;
        } else if (isCurrent) throw new Error('Joignez au maximum 4 images ou pages scannées à la fois.');
        else documentText += '\n[Image ancienne omise : joignez-la de nouveau pour la réexaminer.]';
      }
    }
    const text = (isCurrent ? turn.content.slice(0, 12_000) : sanitizeHistoryContent(turn.content))
      + documentText.slice(0, documentLimit)
      + (documentText.length > documentLimit ? '\n[Extraits des pièces jointes tronqués.]' : '');
    built.unshift({ role: turn.role, content: parts.length ? [{ type: 'text', text }, ...parts] : text });
  }
  return built;
}
