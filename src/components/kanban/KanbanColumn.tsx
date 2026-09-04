/**
 * KanbanColumn — colonne (réordonnable) + ses cartes (sortables).
 * En-tête : renommer en place, menu (renommer / supprimer).
 */
import { useState } from 'react';
import { CSS } from '@dnd-kit/utilities';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import type { KanbanCard, KanbanColumn as KanbanColumnType } from '@/types';
import { useAppStore } from '@/store/app-store';
import { IconButton } from '@/components/ui/IconButton';
import { Menu } from '@/components/ui/Menu';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { KanbanCardItem } from './KanbanCardItem';

export interface KanbanColumnProps {
  column: KanbanColumnType;
  cards: KanbanCard[];
}

export function KanbanColumn({ column, cards }: KanbanColumnProps) {
  const renameColumn = useAppStore((s) => s.renameColumn);
  const deleteColumn = useAppStore((s) => s.deleteColumn);
  const createCard = useAppStore((s) => s.createCard);
  const toast = useAppStore((s) => s.toast);

  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(column.title);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({
    id: `col-${column.id}`,
    data: { type: 'column', columnId: column.id },
  });

  const commitRename = () => {
    const value = name.trim();
    if (value !== '' && value !== column.title) {
      renameColumn(column.id, value);
    } else {
      setName(column.title);
    }
    setRenaming(false);
  };

  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className="flex max-h-full w-72 shrink-0 flex-col rounded-xl border border-zinc-200/90 bg-zinc-100/80 dark:border-zinc-800 dark:bg-zinc-900/50"
    >
      <header
        {...attributes}
        {...listeners}
        className="flex cursor-grab items-center gap-1.5 px-3 py-2.5 active:cursor-grabbing"
      >
        {renaming ? (
          <input
            autoFocus
            className="field h-7 w-full px-2 text-sm font-semibold"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') {
                setName(column.title);
                setRenaming(false);
              }
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <h3 className="flex-1 truncate text-sm font-semibold tracking-tight">
            {column.title}
          </h3>
        )}
        <span className="rounded-full bg-zinc-200/80 px-1.5 py-px text-[11px] tabular-nums text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
          {cards.length}
        </span>
        <div className="flex items-center">
          <IconButton
            label="Nouvelle carte"
            icon={<Plus size={14} />}
            className="h-6 w-6"
            onClick={() => createCard(column.id)}
          />
          <Menu
            align="right"
            trigger={
              <IconButton
                label="Autres actions"
                icon={<MoreHorizontal size={14} />}
                className="h-6 w-6"
              />
            }
            items={[
              {
                label: 'Renommer',
                icon: <Pencil size={13} />,
                onClick: () => {
                  setName(column.title);
                  setRenaming(true);
                },
              },
              {
                label: 'Supprimer',
                icon: <Trash2 size={13} />,
                danger: true,
                onClick: () => setConfirmDelete(true),
              },
            ]}
          />
        </div>
      </header>

      <SortableContext
        items={cards.map((card) => `card-${card.id}`)}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
          {cards.map((card) => (
            <KanbanCardItem key={card.id} cardId={card.id} />
          ))}
          {cards.length === 0 && (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-zinc-300 p-4 text-center text-[11px] text-zinc-400 dark:border-zinc-700 dark:text-zinc-500">
              Dépose une carte ici
            </div>
          )}
        </div>
      </SortableContext>

      <footer className="px-2 pb-2">
        <button
          type="button"
          onClick={() => createCard(column.id)}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-200/70 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        >
          <Plus size={13} />
          Ajouter une carte
        </button>
      </footer>

      <ConfirmModal
        open={confirmDelete}
        title="Supprimer la colonne"
        message={`Es-tu sûr de vouloir supprimer définitivement la colonne « ${column.title} » et ses ${cards.length} carte${cards.length > 1 ? 's' : ''} ?`}
        confirmLabel="Supprimer"
        onConfirm={() => {
          deleteColumn(column.id);
          toast('info', 'Colonne supprimée');
          setConfirmDelete(false);
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </section>
  );
}
