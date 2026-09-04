/**
 * NotesView — liste des notes (recherche, filtres, tri) + éditeur.
 * Le raccourci « Rechercher » (Ctrl+K) est branché ici, sur le champ.
 */
import { useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  Copy,
  Folder,
  FolderMinus,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  SearchX,
  Sparkles,
  StickyNote,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import type { Note, NoteListItem } from '@/types';
import { formatRelative } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app-store';
import { selectNoteList } from '@/store/selectors';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { SearchInput, Select } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { ContextMenu, type ContextMenuItem } from '@/components/ui/ContextMenu';
import { Menu } from '@/components/ui/Menu';
import { EmptyState } from '@/components/ui/EmptyState';
import { NoteEditor } from '@/components/notes/NoteEditor';
import { AiNoteModal } from '@/components/ai/AiNoteModal';
import { ConfirmModal } from '@/components/ui/ConfirmModal';

const SORT_OPTIONS = [
  { value: 'updatedAt:desc', label: 'Plus récentes' },
  { value: 'updatedAt:asc', label: 'Moins récentes' },
  { value: 'title:asc', label: 'Titre A → Z' },
  { value: 'title:desc', label: 'Titre Z → A' },
] as const;

function NoteRow({
  item,
  active,
  onOpen,
  onRequestDelete,
}: {
  item: NoteListItem;
  active: boolean;
  onOpen: () => void;
  onRequestDelete: (note: Note) => void;
}) {
  const setNoteTitle = useAppStore((s) => s.setNoteTitle);
  const togglePin = useAppStore((s) => s.togglePin);
  const archiveNote = useAppStore((s) => s.archiveNote);
  const unarchiveNote = useAppStore((s) => s.unarchiveNote);
  const duplicateNote = useAppStore((s) => s.duplicateNote);
  const moveNoteToFolder = useAppStore((s) => s.moveNoteToFolder);
  const toggleNoteTag = useAppStore((s) => s.toggleNoteTag);
  const folders = useAppStore((s) => s.data.folders);
  const tags = useAppStore((s) => s.data.tags);
  const toast = useAppStore((s) => s.toast);

  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(item.note.title);

  const commitRename = () => {
    const value = title.trim();
    if (value !== item.note.title) {
      setNoteTitle(item.note.id, value);
      toast('success', 'Titre de la note mis à jour');
    }
    setRenaming(false);
  };

  const isArchived = item.note.archived === true;

  const menuItems: ContextMenuItem[] = [
    {
      label: 'Modifier le titre',
      icon: <Pencil size={13} />,
      onClick: () => {
        setTitle(item.note.title);
        setRenaming(true);
      },
    },
    {
      label: item.note.pinned ? 'Désépingler' : 'Épingler',
      icon: <Pin size={13} />,
      onClick: () => togglePin(item.note.id),
    },
    {
      label: isArchived ? 'Désarchiver la note' : 'Archiver la note',
      icon: isArchived ? <ArchiveRestore size={13} /> : <Archive size={13} />,
      onClick: () => {
        if (isArchived) {
          unarchiveNote(item.note.id);
          toast('success', 'Note désarchivée');
        } else {
          archiveNote(item.note.id);
          toast('info', 'Note archivée');
        }
      },
    },
    {
      label: 'Dupliquer',
      icon: <Copy size={13} />,
      onClick: () => {
        duplicateNote(item.note.id);
        toast('success', 'Note dupliquée');
      },
    },
    // Classement : `moveNoteToFolder` existait dans le store sans point
    // d'entrée dans l'interface — on l'expose ici, au plus près de la note.
    ...(folders.length > 0
      ? [
          {
            label: 'Sans dossier',
            icon: <FolderMinus size={13} />,
            divider: true,
            onClick: () => {
              moveNoteToFolder(item.note.id, null);
              toast('success', 'Note retirée du dossier');
            },
          },
          ...folders.map((f) => ({
            label: f.id === item.note.folderId ? `✓ ${f.name}` : f.name,
            icon: <Folder size={13} />,
            onClick: () => {
              moveNoteToFolder(item.note.id, f.id);
              toast('success', `Classée dans « ${f.name} »`);
            },
          })),
        ]
      : []),
    // Idem pour `toggleNoteTag`.
    ...(tags.length > 0
      ? tags.map((t, i) => ({
          label: item.note.tagIds.includes(t.id) ? `✓ ${t.name}` : t.name,
          icon: <Tag size={13} />,
          divider: i === 0,
          onClick: () => {
            const had = item.note.tagIds.includes(t.id);
            toggleNoteTag(item.note.id, t.id);
            toast('success', had ? `Tag « ${t.name} » retiré` : `Tag « ${t.name} » ajouté`);
          },
        }))
      : []),
    {
      label: 'Supprimer',
      icon: <Trash2 size={13} />,
      danger: true,
      divider: true,
      onClick: () => onRequestDelete(item.note),
    },
  ];

  return (
    <ContextMenu items={menuItems} className="w-full">
      <div
        role="button"
        tabIndex={0}
        onClick={() => {
          if (!renaming) {
            onOpen();
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !renaming) {
            onOpen();
          }
        }}
        className={cn(
          'group relative w-full cursor-pointer select-none rounded-lg border px-3 py-2.5 text-left transition-colors focus:outline-none',
          active
            ? 'border-indigo-400/50 bg-indigo-500/10 dark:border-indigo-500/40 dark:bg-indigo-400/10'
            : 'border-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800/70',
        )}
      >
        <div className="flex items-center gap-1.5">
          {item.note.pinned && <Pin size={12} className="shrink-0 text-indigo-500" />}
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
                if (e.key === 'Enter') {
                  commitRename();
                } else if (e.key === 'Escape') {
                  setTitle(item.note.title);
                  setRenaming(false);
                }
              }}
            />
          ) : (
            <span
              className="flex-1 truncate text-sm font-medium"
              onDoubleClick={(e) => {
                e.stopPropagation();
                setTitle(item.note.title);
                setRenaming(true);
              }}
            >
              {item.note.title || 'Sans titre'}
            </span>
          )}
          <div
            className="opacity-0 transition-opacity group-hover:opacity-100"
            onClick={(e) => e.stopPropagation()}
          >
            <Menu
              align="right"
              trigger={
                <IconButton
                  label="Actions de la note"
                  icon={<MoreHorizontal size={13} />}
                  className="h-6 w-6"
                />
              }
              items={menuItems}
            />
          </div>
        </div>
        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
          {item.excerpt || 'Note vide'}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
            {formatRelative(item.note.updatedAt)}
          </span>
          <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
            {item.wordCount} mot{item.wordCount > 1 ? 's' : ''}
          </span>
          {item.tags.slice(0, 3).map((tag) => (
            <span
              key={tag.id}
              className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-1.5 py-px text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tag.color }} />
              {tag.name}
            </span>
          ))}
        </div>
      </div>
    </ContextMenu>
  );
}

export function NotesView() {
  const state = useAppStore();
  const { notesFilter: filter, activeNoteId } = state.ui;
  const searchRef = useRef<HTMLInputElement>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [noteToDelete, setNoteToDelete] = useState<Note | null>(null);

  useKeyboardShortcuts({
    'search.focus': () => {
      searchRef.current?.focus();
      searchRef.current?.select();
    },
  });

  const items = useMemo(
    () => selectNoteList(state),
    [state.data.notes, state.data.folders, state.data.tags, state.ui.notesFilter],
  );

  const setFilter = state.setNotesFilter;
  const sortValue = `${filter.sortField}:${filter.sortDirection}`;
  const activeFolder =
    filter.folderId !== 'all' && filter.folderId !== 'none'
      ? state.data.folders.find((f) => f.id === filter.folderId)
      : undefined;
  const activeTag =
    filter.tagId !== 'all' ? state.data.tags.find((t) => t.id === filter.tagId) : undefined;

  return (
    <div className="flex h-full">
      {/* ------------------------------ Liste ------------------------------ */}
      <section className="flex w-80 shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-800">
        <div className="space-y-1.5 border-b border-zinc-200 p-2.5 dark:border-zinc-800">
          <Button
            className="w-full"
            variant="primary"
            size="sm"
            icon={<Sparkles size={13} />}
            onClick={() => setAiOpen(true)}
          >
            Note IA
          </Button>
          <SearchInput
            ref={searchRef}
            inputSize="sm"
            value={filter.search}
            onChange={(value) => setFilter({ search: value })}
            placeholder="Rechercher (Ctrl+K)…"
          />
          <div className="flex items-center gap-1">
            <Select
              // min-w-0 : sans cela, `flex-1` ne peut pas rétrécir sous la
              // largeur de son contenu (min-width:auto), ce qui poussait le
              // bouton « Archives » hors de la sidebar (largeur fixe w-80).
              selectSize="sm"
              className="h-7 min-w-0 flex-1"
              value={sortValue}
              options={[...SORT_OPTIONS]}
              onChange={(e) => {
                const [sortField, sortDirection] = (e.target.value as string).split(':');
                setFilter({
                  sortField: sortField as 'updatedAt' | 'createdAt' | 'title',
                  sortDirection: (sortDirection === 'asc' ? 'asc' : 'desc'),
                });
              }}
            />
            <button
              type="button"
              title="N'afficher que les notes épinglées"
              aria-pressed={filter.pinnedOnly}
              onClick={() => setFilter({ pinnedOnly: !filter.pinnedOnly })}
              className={cn(
                'flex h-7 shrink-0 items-center gap-1 rounded-lg border px-1.5 text-[11px] font-medium transition-colors',
                filter.pinnedOnly
                  ? 'border-indigo-400/60 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300'
                  : 'border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800',
              )}
            >
              <Pin size={11} />
              {/* Pas de `hidden sm:inline` ici : ce breakpoint suit le viewport,
                  alors que la sidebar garde une largeur fixe de 320px. */}
              <span>Épinglées</span>
            </button>
            <button
              type="button"
              title="Afficher les notes archivées"
              aria-pressed={filter.archivedOnly}
              onClick={() => setFilter({ archivedOnly: !filter.archivedOnly })}
              className={cn(
                'flex h-7 shrink-0 items-center gap-1 rounded-lg border px-1.5 text-[11px] font-medium transition-colors',
                filter.archivedOnly
                  ? 'border-amber-400/60 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                  : 'border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800',
              )}
            >
              <Archive size={11} />
              <span>Archives</span>
            </button>
          </div>

          {filter.archivedOnly && (
            <div className="flex items-center justify-between rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              <span className="inline-flex items-center gap-1 font-medium">
                <Archive size={13} />
                Notes archivées
              </span>
              <button
                type="button"
                className="text-[11px] underline hover:no-underline"
                onClick={() => setFilter({ archivedOnly: false })}
              >
                Retour aux actives
              </button>
            </div>
          )}

          {(activeFolder !== undefined || activeTag !== undefined || filter.folderId === 'none') && (
            <div className="flex flex-wrap gap-1.5">
              {filter.folderId === 'none' && (
                <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  <Folder size={11} />
                  Sans dossier
                  <button type="button" onClick={() => setFilter({ folderId: 'all' })} aria-label="Retirer le filtre">
                    <X size={11} />
                  </button>
                </span>
              )}
              {activeFolder !== undefined && (
                <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  <Folder size={11} />
                  {activeFolder.name}
                  <button type="button" onClick={() => setFilter({ folderId: 'all' })} aria-label="Retirer le filtre">
                    <X size={11} />
                  </button>
                </span>
              )}
              {activeTag !== undefined && (
                <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  <Tag size={11} />
                  {activeTag.name}
                  <button type="button" onClick={() => setFilter({ tagId: 'all' })} aria-label="Retirer le filtre">
                    <X size={11} />
                  </button>
                </span>
              )}
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
          {items.length === 0 && (
            <div className="px-2 py-6 text-center">
              <SearchX size={20} className="mx-auto text-zinc-300 dark:text-zinc-600" />
              <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                {filter.archivedOnly ? 'Aucune note archivée.' : 'Aucune note ne correspond.'}
              </p>
            </div>
          )}
          {items.map((item) => (
            <NoteRow
              key={item.note.id}
              item={item}
              active={activeNoteId === item.note.id}
              onOpen={() => state.openNote(item.note.id)}
              onRequestDelete={(note) => setNoteToDelete(note)}
            />
          ))}
        </div>

        <div className="border-t border-zinc-200 p-2 dark:border-zinc-800">
          <Button
            className="w-full"
            size="sm"
            icon={<Plus size={14} />}
            onClick={() => {
              const newId = state.createNote();
              if (filter.archivedOnly) {
                setFilter({ archivedOnly: false });
              }
              state.openNote(newId);
              state.toast('success', 'Nouvelle note créée');
            }}
          >
            Nouvelle note
          </Button>
        </div>
      </section>

      {/* ------------------------------ Éditeur ------------------------------ */}
      <section className="min-w-0 flex-1">
        {activeNoteId !== null && state.ui.noteDraft !== null ? (
          <NoteEditor />
        ) : (
          <EmptyState
            icon={<StickyNote size={22} />}
            title="Aucune note ouverte"
            description="Décris ta note à l'IA et elle la rédige en Markdown, ou écris-la toi-même."
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button
                  variant="primary"
                  icon={<Sparkles size={15} />}
                  onClick={() => setAiOpen(true)}
                >
                  Note IA
                </Button>
                <Button
                  icon={<Plus size={15} />}
                  onClick={() => {
                    state.createNote();
                    state.toast('success', 'Nouvelle note créée');
                  }}
                >
                  Nouvelle note
                </Button>
              </div>
            }
          />
        )}
      </section>

      {aiOpen && <AiNoteModal onClose={() => setAiOpen(false)} />}

      <ConfirmModal
        open={noteToDelete !== null}
        title="Supprimer la note"
        message={`Es-tu sûr de vouloir supprimer définitivement la note « ${noteToDelete?.title || 'Sans titre'} » ?`}
        confirmLabel="Supprimer"
        onConfirm={() => {
          if (noteToDelete) {
            state.deleteNote(noteToDelete.id);
            state.toast('info', 'Note supprimée');
            setNoteToDelete(null);
          }
        }}
        onCancel={() => setNoteToDelete(null)}
      />
    </div>
  );
}
