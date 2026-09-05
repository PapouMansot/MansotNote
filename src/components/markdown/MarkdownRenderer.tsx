/**
 * MarkdownRenderer — rendu Markdown interactif & intelligent :
 *  - Rendu sécurisé (marked + DOMPurify) et blocs de code Shiki interactifs.
 *  - Cases à cocher interactives (toggleTaskCheckbox).
 *  - Menu contextuel au clic droit sur n'importe quel bloc ou sélection :
 *     * Actions IA (Corriger, Reformuler, Améliorer le style)
 *     * Conversion en tâche Kanban liée
 *     * Changement de structure (Titre H1/H2/H3, Liste, Tâche, Citation)
 *     * Duplication / Suppression de bloc
 *  - Édition directe du bloc au double-clic (InlineBlockEditor).
 *  - Bulle flottante de formatage et d'action sur sélection de texte.
 */
import { useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { renderMarkdown, toggleTaskCheckbox } from '@/lib/markdown';
import {
  deleteBlock,
  duplicateBlock,
  findBlockByText,
  replaceSelectionInMarkdown,
  transformBlockType,
  updateBlock,
  type BlockTransformType,
  type MarkdownBlock,
} from '@/lib/markdown-block';
import { CodeBlock } from './CodeBlock';
import { MarkdownContextMenu } from './MarkdownContextMenu';
import { InlineBlockEditor } from './InlineBlockEditor';
import { FloatingSelectionMenu } from '@/components/notes/FloatingSelectionMenu';

type Part =
  | { kind: 'html'; html: string }
  | { kind: 'code'; code: string; lang: string };

function parseParts(markdownHtml: string): Part[] {
  if (markdownHtml === '' || typeof DOMParser === 'undefined') {
    return markdownHtml === '' ? [] : [{ kind: 'html', html: markdownHtml }];
  }
  const doc = new DOMParser().parseFromString(
    `<div id="__mansot_root">${markdownHtml}</div>`,
    'text/html',
  );
  const root = doc.getElementById('__mansot_root');
  if (root === null) {
    return [{ kind: 'html', html: markdownHtml }];
  }
  const parts: Part[] = [];
  const buffer: string[] = [];
  const flush = () => {
    if (buffer.length > 0) {
      parts.push({ kind: 'html', html: buffer.join('') });
      buffer.length = 0;
    }
  };
  for (const child of Array.from(root.children)) {
    const codeElement = child.tagName === 'PRE' ? child.querySelector('code') : null;
    if (codeElement !== null) {
      const lang = codeElement.className.match(/language-([\w+-]+)/)?.[1] ?? 'plaintext';
      flush();
      parts.push({ kind: 'code', code: codeElement.textContent ?? '', lang });
    } else {
      buffer.push(child.outerHTML);
    }
  }
  flush();
  return parts;
}

export interface MarkdownRendererProps {
  markdown: string;
  className?: string;
  onMarkdownChange?: (markdown: string) => void;
  onAiAction?: (
    action: 'correct' | 'rewrite' | 'style' | 'resume',
    text: string,
    block?: MarkdownBlock,
  ) => void;
  onCreateKanbanTask?: (text: string) => void;
}

export function MarkdownRenderer({
  markdown,
  className,
  onMarkdownChange,
  onAiAction,
  onCreateKanbanTask,
}: MarkdownRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const parts = useMemo(() => parseParts(renderMarkdown(markdown)), [markdown]);
  const editable = onMarkdownChange !== undefined;

  // État du menu contextuel (clic droit)
  const [contextMenu, setContextMenu] = useState<{
    coords: { x: number; y: number };
    block: MarkdownBlock | null;
    selectedText: string;
  } | null>(null);

  // État du bloc en cours d'édition inline (double-clic)
  const [editingBlock, setEditingBlock] = useState<{
    block: MarkdownBlock;
    rect: { top: number; left: number; width: number };
  } | null>(null);

  // État de la sélection de texte flottante
  const [floatingPos, setFloatingPos] = useState<{ x: number; y: number } | null>(null);
  const [currentSelection, setCurrentSelection] = useState<string>('');

  /* ---------------------- Détection de la sélection ---------------------- */
  const handleMouseUp = () => {
    if (!editable) return;
    const sel = window.getSelection();
    const selText = sel?.toString().trim() ?? '';

    if (sel && selText.length > 0 && !sel.isCollapsed) {
      try {
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          const x = Math.max(20, Math.min(rect.left + rect.width / 2 - 120, window.innerWidth - 280));
          const y = Math.max(40, rect.top - 46);
          setFloatingPos({ x, y });
          setCurrentSelection(selText);
          return;
        }
      } catch {}
    }
    setFloatingPos(null);
    setCurrentSelection('');
  };

  /* ------------------- Clics & bascule de checkboxes --------------------- */
  const handleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (
      !editable ||
      target.tagName !== 'INPUT' ||
      target.getAttribute('type') !== 'checkbox'
    ) {
      return;
    }
    const container = event.currentTarget;
    const boxes = Array.from(
      container.querySelectorAll('input[type="checkbox"]'),
    );
    const index = boxes.indexOf(target as HTMLInputElement);
    if (index === -1) return;

    event.preventDefault();
    onMarkdownChange(toggleTaskCheckbox(markdown, index));
  };

  /* ------------------------ Double-clic : édition ------------------------ */
  const handleDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!editable) return;
    const target = event.target as HTMLElement;
    const blockEl = target.closest<HTMLElement>(
      'h1, h2, h3, h4, h5, h6, p, li, blockquote, pre',
    );
    if (!blockEl) return;

    const text = blockEl.innerText.trim();
    const block = findBlockByText(markdown, text);
    if (!block) return;

    const rect = blockEl.getBoundingClientRect();
    setEditingBlock({
      block,
      rect: {
        top: rect.top + window.scrollY,
        left: rect.left + window.scrollX,
        width: Math.max(rect.width, 300),
      },
    });
  };

  /* ---------------------- Clic droit contextuel -------------------------- */
  const handleContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!editable) return;
    const target = event.target as HTMLElement;

    // Détection d'une sélection éventuelle
    const sel = window.getSelection();
    const selText = sel?.toString().trim() ?? '';

    // Détection du bloc cible sous le curseur
    const blockEl = target.closest<HTMLElement>(
      'h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, tr',
    );
    const elementText = blockEl ? blockEl.innerText.trim() : '';
    const block = findBlockByText(markdown, elementText);

    if (selText || block) {
      event.preventDefault();
      event.stopPropagation();
      setFloatingPos(null);
      setContextMenu({
        coords: { x: event.clientX, y: event.clientY },
        block,
        selectedText: selText,
      });
    }
  };

  /* ------------------ Handlers du Menu Contextuel ------------------------ */
  const handleTransformBlock = (block: MarkdownBlock, type: BlockTransformType) => {
    if (!editable) return;
    const updated = transformBlockType(markdown, block, type);
    onMarkdownChange(updated);
  };

  const handleDuplicateBlock = (block: MarkdownBlock) => {
    if (!editable) return;
    const updated = duplicateBlock(markdown, block);
    onMarkdownChange(updated);
  };

  const handleDeleteBlock = (block: MarkdownBlock) => {
    if (!editable) return;
    const updated = deleteBlock(markdown, block);
    onMarkdownChange(updated);
  };

  const handleInlineSave = (newText: string) => {
    if (!editable || !editingBlock) return;
    const updated = updateBlock(markdown, editingBlock.block, newText);
    onMarkdownChange(updated);
    setEditingBlock(null);
  };

  /* ---------------- Handlers de la Bulle Flottante ----------------------- */
  const handleFormatInline = (prefix: string, suffix: string, _placeholder: string) => {
    if (!editable || !currentSelection) return;
    const rep = `${prefix}${currentSelection}${suffix}`;
    const updated = replaceSelectionInMarkdown(markdown, currentSelection, rep);
    onMarkdownChange(updated);
    setFloatingPos(null);
  };

  const handleFormatLinePrefix = (prefix: string) => {
    if (!editable || !currentSelection) return;
    const block = findBlockByText(markdown, currentSelection);
    if (block) {
      const updated = updateBlock(markdown, block, `${prefix}${block.cleanText}`);
      onMarkdownChange(updated);
    } else {
      const updated = replaceSelectionInMarkdown(markdown, currentSelection, `${prefix}${currentSelection}`);
      onMarkdownChange(updated);
    }
    setFloatingPos(null);
  };

  return (
    <div
      ref={containerRef}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      onMouseUp={handleMouseUp}
      className={cn(
        'max-w-none prose prose-sm prose-zinc dark:prose-invert',
        'prose-pre:m-0 prose-pre:bg-transparent prose-pre:p-0',
        editable && [
          '[&_input[type=checkbox]]:cursor-pointer',
          // Indication visuelle discrète au survol des blocs pour signifier leur interactivité
          '[&_p:hover]:bg-indigo-50/25 dark:[&_p:hover]:bg-indigo-950/20 [&_p]:rounded-md [&_p]:px-1.5 [&_p]:-mx-1.5 [&_p]:transition-colors',
          '[&_h1:hover]:bg-indigo-50/25 dark:[&_h1:hover]:bg-indigo-950/20 [&_h1]:rounded-md [&_h1]:px-1.5 [&_h1]:-mx-1.5 [&_h1]:transition-colors',
          '[&_h2:hover]:bg-indigo-50/25 dark:[&_h2:hover]:bg-indigo-950/20 [&_h2]:rounded-md [&_h2]:px-1.5 [&_h2]:-mx-1.5 [&_h2]:transition-colors',
          '[&_h3:hover]:bg-indigo-50/25 dark:[&_h3:hover]:bg-indigo-950/20 [&_h3]:rounded-md [&_h3]:px-1.5 [&_h3]:-mx-1.5 [&_h3]:transition-colors',
          '[&_li:hover]:bg-indigo-50/25 dark:[&_li:hover]:bg-indigo-950/20 [&_li]:rounded-md [&_li]:px-1.5 [&_li]:-mx-1.5 [&_li]:transition-colors',
          '[&_blockquote:hover]:bg-indigo-50/25 dark:[&_blockquote:hover]:bg-indigo-950/20 [&_blockquote]:rounded-md [&_blockquote]:transition-colors',
        ],
        className,
      )}
    >
      {parts.length === 0 ? (
        <p className="text-sm text-zinc-400 dark:text-zinc-500">
          Contenu vide.
        </p>
      ) : (
        parts.map((part, index) =>
          part.kind === 'code' ? (
            <CodeBlock key={`code-${index}`} code={part.code} lang={part.lang} />
          ) : (
            <div
              key={`html-${index}`}
              dangerouslySetInnerHTML={{ __html: part.html }}
            />
          ),
        )
      )}

      {/* Menu contextuel Clic Droit */}
      {contextMenu && (
        <MarkdownContextMenu
          coords={contextMenu.coords}
          block={contextMenu.block}
          selectedText={contextMenu.selectedText}
          onEditBlock={(blk) => {
            const el = containerRef.current;
            const rect = el?.getBoundingClientRect() ?? { top: 100, left: 100, width: 400 };
            setEditingBlock({
              block: blk,
              rect: {
                top: rect.top + window.scrollY,
                left: rect.left + window.scrollX,
                width: Math.max(rect.width - 40, 300),
              },
            });
          }}
          onAiAction={(action, text, blk) => {
            if (onAiAction) {
              onAiAction(action, text, blk);
            }
          }}
          onTransformBlock={handleTransformBlock}
          onDuplicateBlock={handleDuplicateBlock}
          onDeleteBlock={handleDeleteBlock}
          onCreateKanbanTask={onCreateKanbanTask}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Édition directe inline d'un bloc (Double-clic) */}
      {editingBlock &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            style={{
              position: 'absolute',
              top: `${editingBlock.rect.top}px`,
              left: `${editingBlock.rect.left}px`,
              width: `${editingBlock.rect.width}px`,
              zIndex: 60,
            }}
          >
            <InlineBlockEditor
              block={editingBlock.block}
              onSave={handleInlineSave}
              onCancel={() => setEditingBlock(null)}
            />
          </div>,
          document.body,
        )}

      {/* Bulle flottante sur sélection de texte dans l'aperçu */}
      {floatingPos && (
        <FloatingSelectionMenu
          position={floatingPos}
          onFormatInline={handleFormatInline}
          onFormatLinePrefix={handleFormatLinePrefix}
          onFormatCodeBlock={(lang) => {
            if (!editable || !currentSelection) return;
            const rep = `\`\`\`${lang}\n${currentSelection}\n\`\`\``;
            const updated = replaceSelectionInMarkdown(markdown, currentSelection, rep);
            onMarkdownChange(updated);
            setFloatingPos(null);
          }}
          onFormatLink={() => {
            if (!editable || !currentSelection) return;
            const rep = `[${currentSelection}](https://)`;
            const updated = replaceSelectionInMarkdown(markdown, currentSelection, rep);
            onMarkdownChange(updated);
            setFloatingPos(null);
          }}
          onAiAction={(action) => {
            if (onAiAction && currentSelection) {
              onAiAction(action === 'translate' ? 'rewrite' : action, currentSelection);
              setFloatingPos(null);
            }
          }}
          onClose={() => {
            setFloatingPos(null);
            setCurrentSelection('');
          }}
        />
      )}
    </div>
  );
}
