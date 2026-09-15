import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Sparkles, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ReasoningBlockProps {
  reasoning: string;
  isStreaming?: boolean;
  className?: string;
}

export function ReasoningBlock({
  reasoning,
  isStreaming = false,
  className,
}: ReasoningBlockProps) {
  // Ouvert par défaut tant que la réflexion est active
  const [isOpen, setIsOpen] = useState(isStreaming);

  useEffect(() => {
    if (isStreaming) {
      setIsOpen(true);
    }
  }, [isStreaming]);

  if (!reasoning && !isStreaming) return null;

  const wordCount = reasoning.trim() ? reasoning.trim().split(/\s+/).length : 0;

  return (
    <div
      className={cn(
        'mb-3 overflow-hidden rounded-xl border border-indigo-100/80 bg-indigo-50/40 text-xs transition-all dark:border-indigo-950/60 dark:bg-indigo-950/20',
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex w-full items-center justify-between px-3 py-2 text-left font-medium text-indigo-700 transition-colors hover:bg-indigo-100/40 dark:text-indigo-300 dark:hover:bg-indigo-900/30"
      >
        <span className="flex items-center gap-2">
          {isStreaming ? (
            <>
              <Loader2 size={13} className="animate-spin text-indigo-600 dark:text-indigo-400" />
              <span className="font-semibold">Réflexion en cours…</span>
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-indigo-500 animate-ping" />
            </>
          ) : (
            <>
              <Sparkles size={13} className="text-indigo-500 dark:text-indigo-400" />
              <span className="font-semibold">Raisonnement du Copilote</span>
              {wordCount > 0 && (
                <span className="text-[11px] font-normal text-indigo-500/80 dark:text-indigo-400/80">
                  ({wordCount} {wordCount > 1 ? 'mots' : 'mot'})
                </span>
              )}
            </>
          )}
        </span>
        <span className="flex items-center text-indigo-500 dark:text-indigo-400">
          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>

      {isOpen && (
        <div className="border-t border-indigo-100/60 px-3 py-2.5 dark:border-indigo-950/50">
          <div className="max-h-60 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">
            {reasoning || <span className="italic text-zinc-400">Analyse de la demande…</span>}
            {isStreaming && <span className="inline-block animate-pulse text-indigo-500 ml-0.5">▋</span>}
          </div>
        </div>
      )}
    </div>
  );
}
