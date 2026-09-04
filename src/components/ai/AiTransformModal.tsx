/**
 * AiTransformModal — aperçu du résultat d'une transformation IA
 * (correction / résumé / reformulation / traduction) avant remplacement.
 * Inclut un mode Diff visuel (ajouts en vert, suppressions en rouge).
 */
import { useState, useMemo } from 'react';
import { Check, Eye, GitCompare } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { MarkdownRenderer } from '@/components/markdown/MarkdownRenderer';
import { diffWords, type DiffPart } from '@/lib/diff';
import { cn } from '@/lib/utils';

export interface AiTransformModalProps {
  actionLabel: string;
  markdown: string;
  original?: string;
  scope?: 'note' | 'selection';
  onClose: () => void;
  onApply: () => void;
}

export function AiTransformModal({
  actionLabel,
  markdown,
  original,
  scope = 'note',
  onClose,
  onApply,
}: AiTransformModalProps) {
  const [viewTab, setViewTab] = useState<'preview' | 'diff'>(original ? 'diff' : 'preview');

  const diffParts = useMemo<DiffPart[]>(() => {
    if (!original) return [];
    return diffWords(original, markdown);
  }, [original, markdown]);

  const hasDifferences = original !== undefined && original !== markdown;

  return (
    <Modal
      title={`IA — ${actionLabel}`}
      wide
      onClose={onClose}
      footer={
        <>
          <div className="mr-auto flex items-center gap-1.5">
            {original && (
              <div className="flex rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800">
                <button
                  type="button"
                  onClick={() => setViewTab('diff')}
                  className={cn(
                    'flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                    viewTab === 'diff'
                      ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100'
                      : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200',
                  )}
                >
                  <GitCompare size={13} />
                  <span>Différence</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewTab('preview')}
                  className={cn(
                    'flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                    viewTab === 'preview'
                      ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100'
                      : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200',
                  )}
                >
                  <Eye size={13} />
                  <span>Rendu</span>
                </button>
              </div>
            )}
          </div>
          <Button size="sm" onClick={onClose}>
            Annuler
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon={<Check size={13} />}
            onClick={onApply}
          >
            {scope === 'selection' ? 'Remplacer la sélection' : 'Remplacer le contenu'}
          </Button>
        </>
      }
    >
      {viewTab === 'diff' && original ? (
        <div className="rounded-xl border border-zinc-200 bg-zinc-50/50 p-4 font-mono text-xs leading-relaxed text-zinc-800 dark:border-zinc-800 dark:bg-zinc-950/60 dark:text-zinc-200 whitespace-pre-wrap max-h-[60vh] overflow-y-auto">
          {!hasDifferences ? (
            <div className="py-6 text-center text-sm font-sans text-zinc-500">
              ✨ Aucune différence détectée : le texte est déjà parfait.
            </div>
          ) : (
            diffParts.map((part, idx) => {
              if (part.type === 'ins') {
                return (
                  <span
                    key={idx}
                    className="rounded bg-emerald-500/20 px-0.5 py-0.5 text-emerald-800 font-semibold underline decoration-emerald-500 dark:bg-emerald-950/60 dark:text-emerald-300"
                  >
                    {part.text}
                  </span>
                );
              }
              if (part.type === 'del') {
                return (
                  <span
                    key={idx}
                    className="rounded bg-red-500/20 px-0.5 py-0.5 text-red-800 line-through decoration-red-500 opacity-70 dark:bg-red-950/60 dark:text-red-300"
                  >
                    {part.text}
                  </span>
                );
              }
              return <span key={idx}>{part.text}</span>;
            })
          )}
        </div>
      ) : (
        <MarkdownRenderer markdown={markdown} />
      )}
    </Modal>
  );
}
