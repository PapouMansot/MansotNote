/**
 * MarkdownRenderer — rendu Markdown sécurisé + blocs de code interactifs.
 *
 * Pipeline : `renderMarkdown` (marked → DOMPurify) → découpage en
 * fragments (HTML / blocs `<pre><code>` via DOMParser) → rendu React :
 * les fragments HTML passent par `prose`, chaque bloc de code devient
 * un `CodeBlock` (coloration Shiki lazy + bouton Copier).
 */
import { useMemo, type MouseEvent as ReactMouseEvent } from 'react';
import { cn } from '@/lib/utils';
import { renderMarkdown, toggleTaskCheckbox } from '@/lib/markdown';
import { CodeBlock } from './CodeBlock';

type Part =
  | { kind: 'html'; html: string }
  | { kind: 'code'; code: string; lang: string };

/** Découpe le HTML rendu : les `<pre><code>` deviennent des parties « code ». */
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
  /**
   * Appelé quand une case à cocher est basculée, avec le Markdown mis à jour.
   * Non fourni : les cases restent en lecture seule.
   */
  onMarkdownChange?: (markdown: string) => void;
}

export function MarkdownRenderer({
  markdown,
  className,
  onMarkdownChange,
}: MarkdownRendererProps) {
  const parts = useMemo(() => parseParts(renderMarkdown(markdown)), [markdown]);
  const editable = onMarkdownChange !== undefined;

  /**
   * Le HTML est injecté via `dangerouslySetInnerHTML` : React n'attache donc
   * aucun gestionnaire aux cases. On intercepte le clic par délégation sur le
   * conteneur, puis on retrouve l'index de la case par sa position dans le
   * rendu — le même ordre que dans le Markdown source.
   */
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

    // La case est repeinte à partir du Markdown : on empêche le navigateur
    // de la cocher lui-même pour éviter un affichage incohérent si la note
    // ne peut pas être enregistrée.
    event.preventDefault();
    onMarkdownChange(toggleTaskCheckbox(markdown, index));
  };

  return (
    <div
      onClick={handleClick}
      className={cn(
        'max-w-none prose prose-sm prose-zinc dark:prose-invert',
        'prose-pre:m-0 prose-pre:bg-transparent prose-pre:p-0',
        // Curseur explicite : la case est cliquable uniquement si un
        // gestionnaire de mise à jour est fourni.
        editable && '[&_input[type=checkbox]]:cursor-pointer',
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
              // HTML produit par marked + DOMPurify : injection contrôlée.
              dangerouslySetInnerHTML={{ __html: part.html }}
            />
          ),
        )
      )}
    </div>
  );
}
