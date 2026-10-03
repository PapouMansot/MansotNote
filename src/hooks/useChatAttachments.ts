import { useEffect, useRef, useState } from 'react';
import { deleteAttachmentAssets, MAX_CHAT_ATTACHMENTS, prepareChatAttachment, type ChatAttachment } from '@/lib/chat-attachments';
import { useAppStore } from '@/store/app-store';

export function useChatAttachments(scope: string) {
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [preparing, setPreparing] = useState(false);
  const current = useRef<ChatAttachment[]>([]);
  const busy = useRef(false);
  const generation = useRef(0);
  const toast = useAppStore((s) => s.toast);
  const dispose = (items: ChatAttachment[]) => { void deleteAttachmentAssets(items).catch(() => {}); };

  useEffect(() => {
    setAttachments([]);
    current.current = [];
    return () => { generation.current++; dispose(current.current); current.current = []; };
  }, [scope]);

  const addFiles = async (files: File[]) => {
    if (busy.current || files.length === 0) return;
    if (current.current.length + files.length > MAX_CHAT_ATTACHMENTS) {
      toast('error', 'Joignez au maximum 4 fichiers par message.'); return;
    }
    busy.current = true; setPreparing(true);
    const version = generation.current;
    for (const file of files) {
      try {
        const next = await prepareChatAttachment(file);
        if (version !== generation.current) { dispose([next]); break; }
        const imageCount = [...current.current, next].reduce((sum, a) => sum + a.imageCount, 0);
        if (imageCount > MAX_CHAT_ATTACHMENTS) {
          dispose([next]); throw new Error('Limite de 4 images ou pages scannées par message.');
        }
        current.current = [...current.current, next];
        setAttachments(current.current);
        if (next.truncated) toast('info', 'PDF long : seuls les 20 000 premiers caractères seront analysés.');
      } catch (error) {
        if (version !== generation.current) break;
        toast('error', error instanceof Error ? error.message : 'Impossible de lire cette pièce jointe.');
      }
    }
    busy.current = false; setPreparing(false);
  };

  const remove = (id: string) => {
    dispose(current.current.filter((a) => a.id === id));
    current.current = current.current.filter((a) => a.id !== id);
    setAttachments(current.current);
  };
  // Ownership of the images moves to the conversation when it is sent.
  const sent = () => { current.current = []; setAttachments([]); };
  return { attachments, preparing, addFiles, remove, sent };
}
