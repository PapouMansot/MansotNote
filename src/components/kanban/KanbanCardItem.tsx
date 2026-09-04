import { useState } from 'react';
import { CSS } from '@dnd-kit/utilities';
import { useSortable } from '@dnd-kit/sortable';
import {
  Archive,
  ArchiveRestore,
  Calendar,
  Flag,
  Link2,
  ListTodo,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react';
import { formatDueDate, getDueDateStatus } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app-store';
import { ContextMenu, type ContextMenuItem } from '@/components/ui/ContextMenu';
import { Menu } from '@/components/ui/Menu';
import { IconButton } from '@/components/ui/IconButton';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { PRIORITY_META } from './priority';

const DUE_STYLES = {
  overdue: 'text-red-600 dark:text-red-400',
  today: 'text-amber-600 dark:text-amber-400',
  upcoming: 'text-zinc-400 dark:text-zinc-500',
} as const;

export function KanbanCardItem({ cardId }: { cardId: string }) {
  const card = useAppStore((s) => s.data.cards.find((c) => c.id === cardId));
  const labels = useAppStore((s) => s.data.labels);
  const notes = useAppStore((s) => s.data.notes);
  const setActiveCard = useAppStore((s) => s.setActiveCard);
  const updateCard = useAppStore((s) => s.updateCard);
  const deleteCard = useAppStore((s) => s.deleteCard);
  const archiveCard = useAppStore((s) => s.archiveCard);
  const unarchiveCard = useAppStore((s) => s.unarchiveCard);
  const toast = useAppStore((s) => s.toast);

  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(card?.title ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: `card-${cardId}`,
    data: { type: 'card', cardId, fromColumnId: card?.columnId },
    disabled: renaming,
  });

  if (card === undefined) {
    return null;
  }

  const isArchived = card.archived === true;

  const commitRename = () => {
    const value = title.trim();
    if (value !== card.title) {
      updateCard(card.id, { title: value });
      toast('success', 'Titre de la carte mis à jour');
    }
    setRenaming(false);
  };

  const cardMenuItems: ContextMenuItem[] = [
    {
      label: 'Modifier le titre',
      icon: <Pencil size={13} />,
      onClick: () => {
        setTitle(card.title);
        setRenaming(true);
      },
    },
    {
      label: isArchived ? 'Désarchiver la carte' : 'Archiver la carte',
      icon: isArchived ? <ArchiveRestore size={13} /> : <Archive size={13} />,
      onClick: () => {
        if (isArchived) {
          unarchiveCard(card.id);
          toast('success', 'Carte désarchivée');
        } else {
          archiveCard(card.id);
          toast('info', 'Carte archivée');
        }
      },
    },
    {
      label: 'Supprimer la carte',
      icon: <Trash2 size={13} />,
      danger: true,
      divider: true,
      onClick: () => setConfirmDelete(true),
    },
  ];

  const cardLabels = card.labelIds
    .map((id) => labels.find((l) => l.id === id))
    .filter((l): l is NonNullable<typeof l> => l !== undefined);
  const linkedNote =
    card.linkedNoteId !== null
      ? notes.find((n) => n.id === card.linkedNoteId)
      : undefined;
  const priority = PRIORITY_META[card.priority];
  const done = card.checklist.filter((it) => it.done).length;
  const dueStatus = card.dueDate !== null ? getDueDateStatus(card.dueDate) : null;

  return (
    <ContextMenu items={cardMenuItems}>
      <div
        ref={setNodeRef}
        style={{ transform: CSS.Transform.toString(transform), transition }}
        {...attributes}
        {...listeners}
        onClick={() => {
          if (!renaming) {
            setActiveCard(card.id);
          }
        }}
        className={cn(
          'group relative cursor-grab select-none rounded-lg border border-zinc-200 bg-white p-3 shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing dark:border-zinc-700/80 dark:bg-zinc-900',
          isDragging && 'opacity-40',
          renaming && 'cursor-default',
        )}
      >
        <div className="flex items-start justify-between gap-1">
          {renaming ? (
            <input
              autoFocus
              className="field h-6 flex-1 px-1.5 text-sm font-medium"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={commitRename}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') {
                  setTitle(card.title);
                  setRenaming(false);
                }
              }}
            />
          ) : (
            <p
              className="flex-1 text-sm font-medium leading-snug"
              onDoubleClick={(e) => {
                e.stopPropagation();
                setTitle(card.title);
                setRenaming(true);
              }}
            >
              {card.title || 'Sans titre'}
            </p>
          )}
          <div
            className="opacity-0 transition-opacity group-hover:opacity-100"
            onClick={(e) => e.stopPropagation()}
          >
            <Menu
              align="right"
              trigger={
                <IconButton
                  label="Actions de la carte"
                  icon={<MoreHorizontal size={13} />}
                  className="h-5 w-5"
                />
              }
              items={cardMenuItems}
            />
          </div>
        </div>

        {cardLabels.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {cardLabels.map((label) => (
              <span
                key={label.id}
                className="inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-medium"
                style={{
                  backgroundColor: `${label.color}1f`,
                  color: label.color,
                }}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: label.color }}
                />
                {label.name}
              </span>
            ))}
          </div>
        )}

        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          <span
            className="inline-flex items-center gap-1 font-medium"
            style={{ color: priority.color }}
            title={`Priorité : ${priority.label}`}
          >
            <Flag size={11} />
            {priority.label}
          </span>
          {card.dueDate !== null && dueStatus !== null && (
            <span className={cn('inline-flex items-center gap-1', DUE_STYLES[dueStatus])}>
              <Calendar size={11} />
              {formatDueDate(card.dueDate)}
            </span>
          )}
          {card.checklist.length > 0 && (
            <span className="inline-flex items-center gap-1 text-zinc-400 dark:text-zinc-500">
              <ListTodo size={11} />
              {done}/{card.checklist.length}
            </span>
          )}
          {linkedNote !== undefined && (
            <span
              className="inline-flex items-center gap-1 text-zinc-400 dark:text-zinc-500"
              title={linkedNote.title || 'Sans titre'}
            >
              <Link2 size={11} />
              note
            </span>
          )}
        </div>
      </div>

      <ConfirmModal
        open={confirmDelete}
        title="Supprimer la carte"
        message={`Es-tu sûr de vouloir supprimer définitivement la carte « ${card.title || 'Sans titre'} » ?`}
        confirmLabel="Supprimer"
        onConfirm={() => {
          deleteCard(card.id);
          toast('info', 'Carte supprimée');
          setConfirmDelete(false);
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </ContextMenu>
  );
}
