/**
 * MarkdownContextMenu — Menu contextuel interactif au clic droit sur l'aperçu.
 * Permet d'éditer, formater, corriger avec l'IA et convertir en Kanban directement
 * depuis le rendu visuel.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  Copy,
  FilePlus,
  List,
  ListTodo,
  Pencil,
  Quote,
  Sparkles,
  SquareKanban,
  Trash2,
} from 'lucide-react';
import { copyText } from '@/lib/clipboard';
import type { BlockTransformType, MarkdownBlock } from '@/lib/markdown-block';

export interface MarkdownContextMenuProps {
  coords: { x: number; y: number };
  block: MarkdownBlock | null;
  selectedText: string;
  onEditBlock?: (block: MarkdownBlock) => void;
  onAiAction: (action: 'correct' | 'rewrite' | 'style' | 'resume', text: string, block?: MarkdownBlock) => void;
  onTransformBlock?: (block: MarkdownBlock, type: BlockTransformType) => void;
  onDuplicateBlock?: (block: MarkdownBlock) => void;
  onDeleteBlock?: (block: MarkdownBlock) => void;
  onCreateKanbanTask?: (text: string) => void;
  onClose: () => void;
}

export function MarkdownContextMenu({
  coords,
  block,
  selectedText,
  onEditBlock,
  onAiAction,
  onTransformBlock,
  onDuplicateBlock,
  onDeleteBlock,
  onCreateKanbanTask,
  onClose,
}: MarkdownContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('contextmenu', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('contextmenu', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  if (typeof document === 'undefined') return null;

  const targetText = selectedText.trim() || block?.cleanText || '';
  const isSelection = Boolean(selectedText.trim());

  // Ajustement position écran
  const menuWidth = 240;
  const menuHeight = 380;
  const x = Math.max(12, Math.min(coords.x, window.innerWidth - menuWidth - 16));
  const y = Math.max(12, Math.min(coords.y, window.innerHeight - menuHeight - 16));

  const Item = ({
    icon,
    label,
    hint,
    danger,
    onClick,
  }: {
    icon: ReactNode;
    label: string;
    hint?: string;
    danger?: boolean;
    onClick: () => void;
  }) => (
    <button
      type="button"
      onClick={() => {
        onClick();
        onClose();
      }}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
        danger
          ? 'text-red-600 hover:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/15'
          : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800'
      }`}
    >
      <span className="shrink-0 text-zinc-500 dark:text-zinc-400">{icon}</span>
      <span className="flex-1 truncate text-left">{label}</span>
      {hint && <span className="text-[10px] text-zinc-400 dark:text-zinc-500">{hint}</span>}
    </button>
  );

  return createPortal(
    <div
      ref={menuRef}
      style={{ left: `${x}px`, top: `${y}px` }}
      className="fixed z-50 w-60 rounded-xl border border-zinc-200/90 bg-white/95 p-1.5 shadow-2xl backdrop-blur-md dark:border-zinc-700/90 dark:bg-zinc-900/95"
      onClick={(e) => e.stopPropagation()}
    >
      {/* En-tête contextuel */}
      <div className="mb-1 border-b border-zinc-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
        {isSelection ? 'Sélection de texte' : block ? `Bloc : ${block.type}` : 'Action'}
      </div>

      {/* Édition directe du bloc */}
      {block && onEditBlock && !isSelection && (
        <Item
          icon={<Pencil size={13} className="text-indigo-600 dark:text-indigo-400" />}
          label="Modifier ce bloc en direct"
          hint="Double-clic"
          onClick={() => onEditBlock(block)}
        />
      )}

      {/* Actions IA */}
      <div className="my-1 border-t border-zinc-100 dark:border-zinc-800" />
      <div className="px-2.5 py-0.5 text-[10px] font-semibold text-indigo-600 dark:text-indigo-400">
        Assistant IA (SIA)
      </div>
      <Item
        icon={<Sparkles size={13} className="text-amber-500" />}
        label="Corriger l’orthographe & style"
        onClick={() => onAiAction('correct', targetText, block ?? undefined)}
      />
      <Item
        icon={<Sparkles size={13} className="text-indigo-500" />}
        label="Reformuler ce passage"
        onClick={() => onAiAction('rewrite', targetText, block ?? undefined)}
      />
      <Item
        icon={<Sparkles size={13} className="text-purple-500" />}
        label="Améliorer le style"
        onClick={() => onAiAction('style', targetText, block ?? undefined)}
      />

      {/* Action Kanban */}
      {onCreateKanbanTask && targetText && (
        <>
          <div className="my-1 border-t border-zinc-100 dark:border-zinc-800" />
          <Item
            icon={<SquareKanban size={13} className="text-emerald-600" />}
            label="Créer une tâche Kanban"
            hint="Liée à la note"
            onClick={() => onCreateKanbanTask(targetText)}
          />
        </>
      )}

      {/* Changement de structure de bloc */}
      {block && onTransformBlock && !isSelection && (
        <>
          <div className="my-1 border-t border-zinc-100 dark:border-zinc-800" />
          <div className="px-2.5 py-0.5 text-[10px] font-semibold text-zinc-400 dark:text-zinc-500">
            Transformer en…
          </div>
          <div className="grid grid-cols-3 gap-0.5 p-1">
            <button
              type="button"
              onClick={() => {
                onTransformBlock(block, 'h1');
                onClose();
              }}
              title="Titre 1 (#)"
              className="flex h-7 items-center justify-center rounded border border-zinc-200/60 bg-zinc-50 text-xs font-bold text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700/60 dark:bg-zinc-800/60 dark:text-zinc-200 dark:hover:bg-zinc-700"
            >
              H1
            </button>
            <button
              type="button"
              onClick={() => {
                onTransformBlock(block, 'h2');
                onClose();
              }}
              title="Titre 2 (##)"
              className="flex h-7 items-center justify-center rounded border border-zinc-200/60 bg-zinc-50 text-xs font-bold text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700/60 dark:bg-zinc-800/60 dark:text-zinc-200 dark:hover:bg-zinc-700"
            >
              H2
            </button>
            <button
              type="button"
              onClick={() => {
                onTransformBlock(block, 'h3');
                onClose();
              }}
              title="Titre 3 (###)"
              className="flex h-7 items-center justify-center rounded border border-zinc-200/60 bg-zinc-50 text-xs font-bold text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700/60 dark:bg-zinc-800/60 dark:text-zinc-200 dark:hover:bg-zinc-700"
            >
              H3
            </button>
            <button
              type="button"
              onClick={() => {
                onTransformBlock(block, 'list');
                onClose();
              }}
              title="Liste à puces (-)"
              className="flex h-7 items-center justify-center rounded border border-zinc-200/60 bg-zinc-50 text-xs font-bold text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700/60 dark:bg-zinc-800/60 dark:text-zinc-200 dark:hover:bg-zinc-700"
            >
              <List size={12} />
            </button>
            <button
              type="button"
              onClick={() => {
                onTransformBlock(block, 'task');
                onClose();
              }}
              title="Tâche à cocher (- [ ])"
              className="flex h-7 items-center justify-center rounded border border-zinc-200/60 bg-zinc-50 text-xs font-bold text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700/60 dark:bg-zinc-800/60 dark:text-zinc-200 dark:hover:bg-zinc-700"
            >
              <ListTodo size={12} />
            </button>
            <button
              type="button"
              onClick={() => {
                onTransformBlock(block, 'quote');
                onClose();
              }}
              title="Citation (>)"
              className="flex h-7 items-center justify-center rounded border border-zinc-200/60 bg-zinc-50 text-xs font-bold text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700/60 dark:bg-zinc-800/60 dark:text-zinc-200 dark:hover:bg-zinc-700"
            >
              <Quote size={12} />
            </button>
          </div>
        </>
      )}

      {/* Gestion de bloc */}
      <div className="my-1 border-t border-zinc-100 dark:border-zinc-800" />
      {block && onDuplicateBlock && !isSelection && (
        <Item
          icon={<FilePlus size={13} />}
          label="Dupliquer ce bloc"
          onClick={() => onDuplicateBlock(block)}
        />
      )}
      <Item
        icon={copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
        label={copied ? 'Copié !' : 'Copier le texte'}
        onClick={() => {
          void copyText(targetText);
          setCopied(true);
        }}
      />
      {block && onDeleteBlock && !isSelection && (
        <Item
          icon={<Trash2 size={13} />}
          label="Supprimer ce bloc"
          danger
          onClick={() => onDeleteBlock(block)}
        />
      )}
    </div>,
    document.body,
  );
}
