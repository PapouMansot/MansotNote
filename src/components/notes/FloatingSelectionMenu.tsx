/**
 * FloatingSelectionMenu — menu flottant / bulle de formatage qui apparaît
 * directement au-dessus du texte sélectionné dans l'éditeur.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  Bold,
  ChevronDown,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link as LinkIcon,
  List,
  ListTodo,
  Quote,
  Sparkles,
  Strikethrough,
  Terminal,
} from 'lucide-react';
import { Menu, type MenuItem } from '@/components/ui/Menu';

export interface FloatingSelectionMenuProps {
  position: { x: number; y: number } | null;
  onFormatInline: (prefix: string, suffix: string, placeholder: string) => void;
  onFormatLinePrefix: (prefix: string, stripHeading?: boolean) => void;
  onFormatCodeBlock: (lang: string) => void;
  onFormatLink: () => void;
  onAiAction?: (action: 'correct' | 'rewrite' | 'translate' | 'style') => void;
  onClose: () => void;
}

export function FloatingSelectionMenu({
  position,
  onFormatInline,
  onFormatLinePrefix,
  onFormatCodeBlock,
  onFormatLink,
  onAiAction,
  onClose,
}: FloatingSelectionMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (position === null) return;

    const handlePointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [position, onClose]);

  if (position === null || typeof document === 'undefined') {
    return null;
  }

  const headingItems: MenuItem[] = [
    {
      label: 'Titre 1 (Principal)',
      icon: <Heading1 size={13} />,
      onClick: () => {
        onFormatLinePrefix('# ', true);
        onClose();
      },
    },
    {
      label: 'Titre 2 (Section)',
      icon: <Heading2 size={13} />,
      onClick: () => {
        onFormatLinePrefix('## ', true);
        onClose();
      },
    },
    {
      label: 'Titre 3 (Sous-section)',
      icon: <Heading3 size={13} />,
      onClick: () => {
        onFormatLinePrefix('### ', true);
        onClose();
      },
    },
  ];

  const codeItems: MenuItem[] = [
    {
      label: 'Bash / Script',
      icon: <Terminal size={13} />,
      onClick: () => {
        onFormatCodeBlock('bash');
        onClose();
      },
    },
    {
      label: 'TypeScript / JS',
      icon: <Code size={13} />,
      onClick: () => {
        onFormatCodeBlock('typescript');
        onClose();
      },
    },
    {
      label: 'JSON',
      icon: <Code size={13} />,
      onClick: () => {
        onFormatCodeBlock('json');
        onClose();
      },
    },
    {
      label: 'Python',
      icon: <Code size={13} />,
      onClick: () => {
        onFormatCodeBlock('python');
        onClose();
      },
    },
  ];

  const Button = ({
    title,
    icon,
    onClick,
  }: {
    title: string;
    icon: ReactNode;
    onClick: () => void;
  }) => (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => {
        // Empêche le textarea de perdre la sélection avant le clic
        e.preventDefault();
      }}
      onClick={() => {
        onClick();
        onClose();
      }}
      className="flex h-7 w-7 items-center justify-center rounded text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 active:bg-zinc-200 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
    >
      {icon}
    </button>
  );

  return createPortal(
    <div
      ref={menuRef}
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
      }}
      onMouseDown={(e) => e.preventDefault()}
      className="fixed z-50 flex items-center gap-0.5 rounded-lg border border-zinc-200/90 bg-white/95 p-1 shadow-2xl backdrop-blur-md transition-all dark:border-zinc-700/90 dark:bg-zinc-900/95"
    >
      {/* Menu Titres */}
      <Menu
        align="left"
        trigger={
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            className="flex h-7 items-center gap-0.5 rounded px-1.5 text-xs font-semibold text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
            title="Formater en titre"
          >
            <span>H</span>
            <ChevronDown size={11} className="opacity-60" />
          </button>
        }
        items={headingItems}
      />

      <div className="mx-0.5 h-4 w-px bg-zinc-200 dark:bg-zinc-700" />

      {/* Styles inline */}
      <Button
        title="Gras (**texte**)"
        icon={<Bold size={13} />}
        onClick={() => onFormatInline('**', '**', 'gras')}
      />
      <Button
        title="Italique (*texte*)"
        icon={<Italic size={13} />}
        onClick={() => onFormatInline('*', '*', 'italique')}
      />
      <Button
        title="Barré (~~texte~~)"
        icon={<Strikethrough size={13} />}
        onClick={() => onFormatInline('~~', '~~', 'barré')}
      />
      <Button
        title="Code inline (`code`)"
        icon={<Code size={13} />}
        onClick={() => onFormatInline('`', '`', 'code')}
      />

      <div className="mx-0.5 h-4 w-px bg-zinc-200 dark:bg-zinc-700" />

      {/* Bloc Code / Bash */}
      <Menu
        align="left"
        trigger={
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            className="flex h-7 items-center gap-1 rounded bg-indigo-50 px-1.5 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-100 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-900/60"
            title="Bloc de code (Bash, etc.)"
          >
            <Terminal size={12} />
            <span>Bash</span>
            <ChevronDown size={10} className="opacity-60" />
          </button>
        }
        items={codeItems}
      />

      <div className="mx-0.5 h-4 w-px bg-zinc-200 dark:bg-zinc-700" />

      {/* Listes & autres */}
      <Button
        title="Liste à puces"
        icon={<List size={13} />}
        onClick={() => onFormatLinePrefix('- ')}
      />
      <Button
        title="Liste de tâches"
        icon={<ListTodo size={13} />}
        onClick={() => onFormatLinePrefix('- [ ] ')}
      />
      <Button
        title="Citation"
        icon={<Quote size={13} />}
        onClick={() => onFormatLinePrefix('> ')}
      />
      <Button
        title="Lien hypertexte"
        icon={<LinkIcon size={13} />}
        onClick={onFormatLink}
      />

      {onAiAction && (
        <>
          <div className="mx-0.5 h-4 w-px bg-zinc-200 dark:bg-zinc-700" />
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onAiAction('correct');
              onClose();
            }}
            className="flex h-7 items-center gap-1 rounded bg-indigo-600 px-2 text-xs font-semibold text-white shadow-sm transition-all hover:bg-indigo-500 active:scale-95"
            title="Corriger l'orthographe & la grammaire (IA)"
          >
            <Sparkles size={12} />
            <span>Corriger</span>
          </button>
        </>
      )}
    </div>,
    document.body,
  );
}
