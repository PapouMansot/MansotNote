/**
 * Badge — pastille colorée (tag, étiquette, compteur).
 */
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface BadgeProps {
  /** Couleur du point (hex de COLOR_PALETTE). */
  color?: string;
  label: ReactNode;
  /** Badge cliquable (filtre). */
  active?: boolean;
  onClick?: () => void;
  className?: string;
  title?: string;
}

export function Badge({
  color,
  label,
  active = false,
  onClick,
  className,
  title,
}: BadgeProps) {
  const base = cn(
    'inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
    onClick && 'cursor-pointer transition-colors',
    active
      ? 'bg-indigo-500/15 text-indigo-700 dark:bg-indigo-400/15 dark:text-indigo-300'
      : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
    onClick &&
      !active &&
      'hover:bg-zinc-200 dark:hover:bg-zinc-700',
    className,
  );

  const content = (
    <>
      {color !== undefined && (
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
      )}
      <span className="truncate">{label}</span>
    </>
  );

  if (onClick === undefined) {
    return <span className={base} title={title}>
      {content}
    </span>;
  }
  return (
    <button
      type="button"
      className={base}
      onClick={onClick}
      title={title}
      aria-pressed={active}
    >
      {content}
    </button>
  );
}
