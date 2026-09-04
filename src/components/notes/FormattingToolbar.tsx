/**
 * FormattingToolbar — barre d'outils de formatage pour l'éditeur de notes.
 * Permet de formater le texte en Markdown sans avoir à taper la syntaxe à la main :
 * Titres (H1..H3), Gras, Italique, Barré, Code inline, Blocs de code (Bash, TS, Python...),
 * Listes, Tâches, Citations, Liens et Tableaux.
 */
import { type RefObject } from 'react';
import {
  Bold,
  ChevronDown,
  Code,
  Heading,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Quote,
  Redo2,
  Strikethrough,
  Table,
  Terminal,
  Type,
  Undo2,
} from 'lucide-react';
import { IconButton } from '@/components/ui/IconButton';
import { Menu, type MenuItem } from '@/components/ui/Menu';

export interface FormattingToolbarProps {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  content: string;
  onChange: (newContent: string) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}

export function FormattingToolbar({
  textareaRef,
  content,
  onChange,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
}: FormattingToolbarProps) {
  const getTextarea = () => textareaRef.current;

  /**
   * Entoure ou insère du texte inline (ex: **gras**, *italique*, `code`).
   */
  const formatInline = (prefix: string, suffix: string, placeholder: string) => {
    const el = getTextarea();
    if (!el) return;

    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = content.slice(start, end);
    const innerText = selected || placeholder;
    const replacement = `${prefix}${innerText}${suffix}`;
    const newContent = content.slice(0, start) + replacement + content.slice(end);

    onChange(newContent);

    setTimeout(() => {
      el.focus();
      if (selected) {
        el.setSelectionRange(start, start + replacement.length);
      } else {
        el.setSelectionRange(start + prefix.length, start + prefix.length + placeholder.length);
      }
    }, 0);
  };

  /**
   * Applique un préfixe sur chaque ligne sélectionnée (Titres, Listes, Citations).
   */
  const formatLinePrefix = (prefix: string, stripHeading = false) => {
    const el = getTextarea();
    if (!el) return;

    const start = el.selectionStart;
    const end = el.selectionEnd;
    const lineStart = content.lastIndexOf('\n', start - 1) + 1;
    const lineEndIdx = content.indexOf('\n', end);
    const lineEnd = lineEndIdx === -1 ? content.length : lineEndIdx;

    const targetChunk = content.slice(lineStart, lineEnd);
    const lines = targetChunk.split('\n');

    const formattedLines = lines.map((line) => {
      let cleanLine = line;
      if (stripHeading) {
        cleanLine = cleanLine.replace(/^#{1,6}\s+/, '');
      }
      return `${prefix}${cleanLine}`;
    });

    const replacement = formattedLines.join('\n');
    const newContent = content.slice(0, lineStart) + replacement + content.slice(lineEnd);

    onChange(newContent);

    setTimeout(() => {
      el.focus();
      el.setSelectionRange(lineStart, lineStart + replacement.length);
    }, 0);
  };

  /**
   * Insère un bloc de code coloré (Bash, TypeScript, JSON, etc.).
   */
  const formatCodeBlock = (lang: string) => {
    const el = getTextarea();
    if (!el) return;

    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = content.slice(start, end);
    const sample =
      selected ||
      (lang === 'bash'
        ? 'npm install\nnpm run dev'
        : lang === 'typescript' || lang === 'javascript'
          ? 'const greeting = "Hello World";\nconsole.log(greeting);'
          : lang === 'json'
            ? '{\n  "name": "MansotNote",\n  "status": "active"\n}'
            : lang === 'python'
              ? 'def hello():\n    print("Hello World")'
              : 'code ici');

    const before = content.slice(0, start);
    const after = content.slice(end);

    const padBefore =
      before.length > 0 && !before.endsWith('\n\n')
        ? before.endsWith('\n')
          ? '\n'
          : '\n\n'
        : '';
    const padAfter =
      after.length > 0 && !after.startsWith('\n\n')
        ? after.startsWith('\n')
          ? '\n'
          : '\n\n'
        : '';

    const replacement = `${padBefore}\`\`\`${lang}\n${sample}\n\`\`\`${padAfter}`;
    const newContent = before + replacement + after;

    onChange(newContent);

    setTimeout(() => {
      el.focus();
      const codeStart = start + padBefore.length + `\`\`\`${lang}\n`.length;
      el.setSelectionRange(codeStart, codeStart + sample.length);
    }, 0);
  };

  /**
   * Insère un lien Markdown.
   */
  const formatLink = () => {
    const el = getTextarea();
    if (!el) return;

    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = content.slice(start, end);
    const text = selected || 'texte du lien';
    const replacement = `[${text}](https://)`;
    const newContent = content.slice(0, start) + replacement + content.slice(end);

    onChange(newContent);

    setTimeout(() => {
      el.focus();
      const urlStart = start + replacement.length - 9;
      el.setSelectionRange(urlStart, urlStart + 8);
    }, 0);
  };

  /**
   * Insère un tableau Markdown prêt à l'emploi.
   */
  const formatTable = () => {
    const el = getTextarea();
    if (!el) return;

    const start = el.selectionStart;
    const tableTemplate = `\n| En-tête 1 | En-tête 2 | En-tête 3 |\n| :--- | :--- | :--- |\n| Ligne 1 | Valeur A | Valeur B |\n| Ligne 2 | Valeur C | Valeur D |\n\n`;

    const newContent = content.slice(0, start) + tableTemplate + content.slice(start);
    onChange(newContent);

    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + 3, start + 13);
    }, 0);
  };

  /**
   * Insère une ligne horizontale de séparation.
   */
  const formatDivider = () => {
    const el = getTextarea();
    if (!el) return;

    const start = el.selectionStart;
    const divider = `\n\n---\n\n`;
    const newContent = content.slice(0, start) + divider + content.slice(start);
    onChange(newContent);

    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + divider.length, start + divider.length);
    }, 0);
  };

  const headingItems: MenuItem[] = [
    {
      label: 'Titre 1 (Principal)',
      icon: <Heading1 size={14} />,
      onClick: () => formatLinePrefix('# ', true),
    },
    {
      label: 'Titre 2 (Section)',
      icon: <Heading2 size={14} />,
      onClick: () => formatLinePrefix('## ', true),
    },
    {
      label: 'Titre 3 (Sous-section)',
      icon: <Heading3 size={14} />,
      onClick: () => formatLinePrefix('### ', true),
    },
    {
      label: 'Texte normal',
      icon: <Type size={14} />,
      onClick: () => formatLinePrefix('', true),
    },
  ];

  const codeBlockItems: MenuItem[] = [
    {
      label: 'Bash / Terminal (Script)',
      icon: <Terminal size={14} />,
      onClick: () => formatCodeBlock('bash'),
    },
    {
      label: 'TypeScript',
      icon: <Code size={14} />,
      onClick: () => formatCodeBlock('typescript'),
    },
    {
      label: 'JavaScript',
      icon: <Code size={14} />,
      onClick: () => formatCodeBlock('javascript'),
    },
    {
      label: 'JSON (Données)',
      icon: <Code size={14} />,
      onClick: () => formatCodeBlock('json'),
    },
    {
      label: 'Python',
      icon: <Code size={14} />,
      onClick: () => formatCodeBlock('python'),
    },
    {
      label: 'HTML / CSS',
      icon: <Code size={14} />,
      onClick: () => formatCodeBlock('html'),
    },
    {
      label: 'SQL (Base de données)',
      icon: <Code size={14} />,
      onClick: () => formatCodeBlock('sql'),
    },
    {
      label: 'Texte brut (Plaintext)',
      icon: <Code size={14} />,
      onClick: () => formatCodeBlock('plaintext'),
    },
  ];

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-zinc-200 bg-zinc-50/80 px-3 py-1.5 dark:border-zinc-800 dark:bg-zinc-900/60">
      {/* Historique : Annuler / Rétablir */}
      {onUndo !== undefined && (
        <>
          <button
            type="button"
            disabled={!canUndo}
            onClick={onUndo}
            title="Annuler (Ctrl+Z)"
            aria-label="Annuler"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-zinc-600 transition-colors hover:bg-zinc-200/70 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-30 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            <Undo2 size={14} />
          </button>
          <button
            type="button"
            disabled={!canRedo}
            onClick={onRedo}
            title="Rétablir (Ctrl+Y / Ctrl+Shift+Z)"
            aria-label="Rétablir"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-zinc-600 transition-colors hover:bg-zinc-200/70 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-30 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            <Redo2 size={14} />
          </button>
          <div className="h-4 w-px bg-zinc-200 dark:bg-zinc-800" />
        </>
      )}

      {/* Menu Titres */}
      <Menu
        align="left"
        trigger={
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            title="Formater en titre (H1, H2, H3)"
          >
            <Heading size={14} />
            <span>Titre</span>
            <ChevronDown size={12} className="opacity-60" />
          </button>
        }
        items={headingItems}
      />

      <div className="h-4 w-px bg-zinc-200 dark:bg-zinc-800" />

      {/* Styles inline */}
      <IconButton
        label="Gras (**texte**)"
        icon={<Bold size={14} />}
        className="h-7 w-7"
        onClick={() => formatInline('**', '**', 'texte en gras')}
      />
      <IconButton
        label="Italique (*texte*)"
        icon={<Italic size={14} />}
        className="h-7 w-7"
        onClick={() => formatInline('*', '*', 'texte en italique')}
      />
      <IconButton
        label="Barré (~~texte~~)"
        icon={<Strikethrough size={14} />}
        className="h-7 w-7"
        onClick={() => formatInline('~~', '~~', 'texte barré')}
      />
      <IconButton
        label="Code inline (`code`)"
        icon={<Code size={14} />}
        className="h-7 w-7"
        onClick={() => formatInline('`', '`', 'code')}
      />

      <div className="h-4 w-px bg-zinc-200 dark:bg-zinc-800" />

      {/* Menu Blocs de code (Bash, etc.) */}
      <Menu
        align="left"
        trigger={
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
            title="Insérer un bloc de code coloré (Bash, JS, TS, Python...)"
          >
            <Terminal size={14} />
            <span>Bloc Code / Bash</span>
            <ChevronDown size={12} className="opacity-60" />
          </button>
        }
        items={codeBlockItems}
      />

      <div className="h-4 w-px bg-zinc-200 dark:bg-zinc-800" />

      {/* Listes */}
      <IconButton
        label="Liste à puces (- item)"
        icon={<List size={14} />}
        className="h-7 w-7"
        onClick={() => formatLinePrefix('- ')}
      />
      <IconButton
        label="Liste numérotée (1. item)"
        icon={<ListOrdered size={14} />}
        className="h-7 w-7"
        onClick={() => formatLinePrefix('1. ')}
      />
      <IconButton
        label="Liste de tâches (- [ ] tâche)"
        icon={<ListTodo size={14} />}
        className="h-7 w-7"
        onClick={() => formatLinePrefix('- [ ] ')}
      />

      <div className="h-4 w-px bg-zinc-200 dark:bg-zinc-800" />

      {/* Citation, Lien, Tableau, Ligne */}
      <IconButton
        label="Citation (> texte)"
        icon={<Quote size={14} />}
        className="h-7 w-7"
        onClick={() => formatLinePrefix('> ')}
      />
      <IconButton
        label="Insérer un lien ([texte](url))"
        icon={<LinkIcon size={14} />}
        className="h-7 w-7"
        onClick={formatLink}
      />
      <IconButton
        label="Insérer un tableau"
        icon={<Table size={14} />}
        className="h-7 w-7"
        onClick={formatTable}
      />
      <IconButton
        label="Ligne horizontale (---)"
        icon={<Minus size={14} />}
        className="h-7 w-7"
        onClick={formatDivider}
      />
    </div>
  );
}
