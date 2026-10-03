import { Menu as MenuIcon, Sparkles, SquareKanban, StickyNote } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MainView } from '@/types';

interface MobileNavProps {
  view: MainView;
  assistantName: string;
  menuOpen: boolean;
  onSelect: (view: MainView) => void;
  onOpenMenu: () => void;
}

/** Barre d'onglets du téléphone : on revient toujours aux notes, au Kanban ou au menu. */
export function MobileNav({ view, assistantName, menuOpen, onSelect, onOpenMenu }: MobileNavProps) {
  const items: Array<{ id: MainView; label: string; icon: typeof StickyNote }> = [
    { id: 'notes', label: 'Notes', icon: StickyNote },
    { id: 'kanban', label: 'Kanban', icon: SquareKanban },
    { id: 'chat', label: assistantName, icon: Sparkles },
  ];
  const tab = 'flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors';
  return (
    <nav
      aria-label="Navigation principale"
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-zinc-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95"
    >
      {items.map(({ id, label, icon: Icon }) => {
        const active = view === id && !menuOpen;
        return (
          <button
            key={id}
            type="button"
            aria-current={active ? 'page' : undefined}
            onClick={() => onSelect(id)}
            className={cn(tab, 'h-14', active ? 'text-indigo-600 dark:text-indigo-400' : 'text-zinc-500 dark:text-zinc-400')}
          >
            <Icon size={20} />
            <span className="max-w-full truncate px-1">{label}</span>
          </button>
        );
      })}
      <button
        type="button"
        aria-expanded={menuOpen}
        onClick={onOpenMenu}
        className={cn(tab, 'h-14', menuOpen ? 'text-indigo-600 dark:text-indigo-400' : 'text-zinc-500 dark:text-zinc-400')}
      >
        <MenuIcon size={20} />
        <span>Menu</span>
      </button>
    </nav>
  );
}
