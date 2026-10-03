import { useEffect, useState } from 'react';
import { FileText, ImageIcon, X } from 'lucide-react';
import { getAttachmentImages, type ChatAttachment } from '@/lib/chat-attachments';

export function ChatAttachments({ attachments, onRemove }: { attachments: ChatAttachment[]; onRemove?: (id: string) => void }) {
  if (!attachments.length) return null;
  return <div className="my-2 flex flex-wrap gap-2" aria-label="Pièces jointes">
    {attachments.map((attachment) => <Attachment key={attachment.id} attachment={attachment} onRemove={onRemove} />)}
    {onRemove && attachments.reduce((sum, a) => sum + (a.text?.length ?? 0), 0) > 32_000 && <p className="w-full text-[10px] text-amber-600 dark:text-amber-400">Documents longs : des extraits répartis entre les fichiers seront analysés, dans la limite de 32 000 caractères.</p>}
  </div>;
}

function Attachment({ attachment, onRemove }: { attachment: ChatAttachment; onRemove?: (id: string) => void }) {
  const [preview, setPreview] = useState<string>();
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let active = true;
    if (attachment.imageCount) void getAttachmentImages(attachment)
      .then((images) => { if (active) setPreview(images[0]); })
      .catch(() => { if (active) setUnavailable(true); });
    return () => { active = false; };
  }, [attachment.id, attachment.imageCount]);
  return <div className="flex max-w-full items-center gap-2 rounded-xl border border-zinc-300/40 bg-zinc-100 px-2.5 py-2 text-xs text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">
    {preview ? <img src={preview} alt={attachment.name} className="h-12 w-12 rounded-md object-cover" />
      : attachment.kind === 'pdf' ? <FileText size={20} className="shrink-0 text-indigo-500" /> : <ImageIcon size={20} className="shrink-0 text-indigo-500" />}
    <div className="min-w-0">
      <p className="max-w-48 truncate font-medium" title={attachment.name}>{attachment.name}</p>
      <p className="text-[10px] text-zinc-500 dark:text-zinc-400">{attachment.kind === 'pdf' ? `PDF · ${attachment.pageCount} page(s)` : 'Image'} · {Math.ceil(attachment.size / 1024)} Ko</p>
      {attachment.truncated && <p className="text-[10px] text-amber-600 dark:text-amber-400">Extrait : 20 000 premiers caractères</p>}
      {unavailable && <p className="text-[10px] text-red-600 dark:text-red-400">Image indisponible : à joindre de nouveau</p>}
    </div>
    {onRemove && <button type="button" aria-label={`Retirer ${attachment.name}`} title="Retirer la pièce jointe" className="shrink-0 rounded p-1 hover:bg-zinc-200 dark:hover:bg-zinc-700" onClick={() => onRemove(attachment.id)}><X size={14} /></button>}
  </div>;
}
