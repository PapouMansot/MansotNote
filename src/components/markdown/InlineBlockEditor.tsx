/**
 * InlineBlockEditor — Éditeur léger inline directement intégré dans la vue d'aperçu.
 * Permet de modifier un paragraphe, titre ou liste directement sur place,
 * sans devoir basculer en mode code ou chercher la ligne dans le Markdown brut.
 */
import { useEffect, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import type { MarkdownBlock } from '@/lib/markdown-block';

export interface InlineBlockEditorProps {
  block: MarkdownBlock;
  onSave: (newContent: string) => void;
  onCancel: () => void;
}

export function InlineBlockEditor({
  block,
  onSave,
  onCancel,
}: InlineBlockEditorProps) {
  const [value, setValue] = useState(block.rawText);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.focus();
      // Sélectionne tout le texte ou place le curseur à la fin
      el.setSelectionRange(el.value.length, el.value.length);
      // Auto-taille
      el.style.height = 'auto';
      el.style.height = `${Math.max(el.scrollHeight, 40)}px`;
    }
  }, []);

  const handleInput = () => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.max(el.scrollHeight, 40)}px`;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSave(value.trim());
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div className="my-2 rounded-xl border-2 border-indigo-500 bg-white p-2.5 shadow-lg dark:bg-zinc-900 dark:border-indigo-400">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        className="w-full resize-none bg-transparent text-sm leading-relaxed text-zinc-900 focus:outline-none dark:text-zinc-100"
        rows={1}
      />
      <div className="mt-2 flex items-center justify-between border-t border-zinc-100 pt-1.5 dark:border-zinc-800">
        <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
          <kbd className="font-mono">Entrée</kbd> pour valider · <kbd className="font-mono">Maj + Entrée</kbd> saut de ligne · <kbd className="font-mono">Échap</kbd> annuler
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onCancel}
            className="flex h-6 items-center gap-1 rounded px-2 text-[11px] font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            <X size={12} />
            Annuler
          </button>
          <button
            type="button"
            onClick={() => onSave(value.trim())}
            className="flex h-6 items-center gap-1 rounded bg-indigo-600 px-2.5 text-[11px] font-semibold text-white shadow-sm hover:bg-indigo-500"
          >
            <Check size={12} />
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}

