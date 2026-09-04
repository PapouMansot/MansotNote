/**
 * ContextMenu — menu contextuel au clic droit (ou déclencheur) avec portail,
 * positionnement intelligent dans le viewport, et fermeture au clic extérieur/Escape.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

export interface ContextMenuItem {
  label: string;
  icon?: ReactNode;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  divider?: boolean;
  onClick: () => void;
}

export interface ContextMenuProps {
  items: ContextMenuItem[];
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}

export function ContextMenu({
  items,
  children,
  className,
  disabled = false,
}: ContextMenuProps) {
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const onContextMenu = (e: React.MouseEvent) => {
    if (disabled || items.length === 0) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();

    // Calcul de la position avec marge de sécurité
    const menuWidth = 190;
    const menuHeight = items.length * 34 + 16;
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - 8);
    const y = Math.min(e.clientY, window.innerHeight - menuHeight - 8);

    setCoords({
      x: Math.max(8, x),
      y: Math.max(8, y),
    });
  };

  useEffect(() => {
    if (coords === null) {
      return;
    }

    const onPointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setCoords(null);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setCoords(null);
      }
    };

    const onScroll = () => {
      setCoords(null);
    };

    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('contextmenu', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScroll, true);

    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('contextmenu', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [coords]);

  return (
    <div onContextMenu={onContextMenu} className={className}>
      {children}
      {coords !== null &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            style={{ left: `${coords.x}px`, top: `${coords.y}px` }}
            className="fixed z-50 min-w-44 rounded-lg border border-zinc-200 bg-white/95 p-1 shadow-xl backdrop-blur-md dark:border-zinc-700 dark:bg-zinc-900/95"
            onClick={(e) => e.stopPropagation()}
          >
            {items.map((item, index) => (
              <div key={`${item.label}-${index}`}>
                {item.divider && (
                  <div className="my-1 h-px bg-zinc-200 dark:bg-zinc-800" />
                )}
                <button
                  type="button"
                  disabled={item.disabled}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                    item.danger
                      ? 'text-red-600 hover:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/15'
                      : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800',
                  )}
                  onClick={() => {
                    setCoords(null);
                    item.onClick();
                  }}
                >
                  {item.icon !== undefined && (
                    <span className="shrink-0 text-zinc-500 dark:text-zinc-400">
                      {item.icon}
                    </span>
                  )}
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.hint !== undefined && (
                    <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
                      {item.hint}
                    </span>
                  )}
                </button>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
