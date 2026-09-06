/**
 * Sidebar — navigation (Notes / Kanban), arborescence de dossiers,
 * tags, création rapide et bascule de thème. Repliable en rail.
 */
import { useMemo, useState, type ReactNode } from 'react';
import {
  Bookmark,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderPlus,
  Inbox,
  LogOut,
  Monitor,
  Moon,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeft,
  Pencil,
  Plus,
  ShieldCheck,
  Sparkles,
  SquareKanban,
  StickyNote,
  Sun,
  Trash2,
} from 'lucide-react';
import { COLOR_PALETTE, colorName, type Folder as FolderType, type ThemeMode } from '@/types';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app-store';
import { useTheme } from '@/hooks/useTheme';

import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { ContextMenu, type ContextMenuItem } from '@/components/ui/ContextMenu';
import { Menu } from '@/components/ui/Menu';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { ServerAccountModal } from '@/components/auth/ServerAccountModal';
import { BookmarkletModal } from '@/components/tools/BookmarkletModal';
import { logoutServer } from '@/lib/server-auth';

const THEME_NEXT: Record<ThemeMode, ThemeMode> = {
  dark: 'light',
  light: 'system',
  system: 'dark',
};

const THEME_ICONS: Record<ThemeMode, typeof Moon> = {
  dark: Moon,
  light: Sun,
  system: Monitor,
};

const THEME_LABELS: Record<ThemeMode, string> = {
  dark: 'Sombre',
  light: 'Clair',
  system: 'Système',
};

interface NavItemProps {
  icon: ReactNode;
  label: string;
  active: boolean;
  hint: string;
  onClick: () => void;
}

function NavItem({ icon, label, active, hint, onClick }: NavItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors',
        active
          ? 'bg-indigo-500/15 text-indigo-700 dark:bg-indigo-400/15 dark:text-indigo-300'
          : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100',
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span className="flex-1 truncate text-left">{label}</span>
      <span className="hidden rounded border border-zinc-200 px-1 text-[10px] font-normal text-zinc-400 dark:border-zinc-700 dark:text-zinc-500 lg:inline">
        {hint}
      </span>
    </button>
  );
}

function FolderNode({
  folder,
  depth,
  childrenOf,
  activeFolderId,
  noteCount,
  collapsedIds,
  onToggleCollapse,
  onSelect,
}: {
  folder: FolderType;
  depth: number;
  childrenOf: (id: string) => FolderType[];
  activeFolderId: string;
  noteCount: (id: string) => number;
  collapsedIds: string[];
  onToggleCollapse: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const renameFolder = useAppStore((s) => s.renameFolder);
  const deleteFolder = useAppStore((s) => s.deleteFolder);
  const createFolder = useAppStore((s) => s.createFolder);
  const toast = useAppStore((s) => s.toast);

  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(folder.name);
  const [newSubfolderOpen, setNewSubfolderOpen] = useState(false);
  const [subfolderName, setSubfolderName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const children = childrenOf(folder.id);
  const collapsed = collapsedIds.includes(folder.id);
  const active = activeFolderId === folder.id;

  const commitRename = () => {
    const value = name.trim();
    if (value !== '' && value !== folder.name) {
      renameFolder(folder.id, value);
      toast('success', 'Dossier renommé');
    } else {
      setName(folder.name);
    }
    setRenaming(false);
  };

  const commitAddSubfolder = () => {
    const value = subfolderName.trim();
    if (value !== '') {
      createFolder(value, folder.id);
      toast('success', `Sous-dossier « ${value} » créé`);
      if (collapsed) {
        onToggleCollapse(folder.id);
      }
    }
    setSubfolderName('');
    setNewSubfolderOpen(false);
  };

  const folderMenuItems: ContextMenuItem[] = [
    {
      label: 'Modifier le nom',
      icon: <Pencil size={13} />,
      onClick: () => {
        setName(folder.name);
        setRenaming(true);
      },
    },
    {
      label: 'Nouveau sous-dossier',
      icon: <FolderPlus size={13} />,
      onClick: () => {
        setNewSubfolderOpen(true);
        if (collapsed) {
          onToggleCollapse(folder.id);
        }
      },
    },
    {
      label: 'Supprimer le dossier',
      icon: <Trash2 size={13} />,
      danger: true,
      divider: true,
      onClick: () => setConfirmDelete(true),
    },
  ];

  return (
    <div>
      <ContextMenu items={folderMenuItems}>
        <div
          className={cn(
            'group flex w-full items-center gap-1 rounded-lg pr-1.5 text-[13px] transition-colors',
            active
              ? 'bg-indigo-500/15 font-medium text-indigo-700 dark:bg-indigo-400/15 dark:text-indigo-300'
              : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800',
          )}
          style={{ paddingLeft: `${8 + depth * 14}px` }}
        >
          <button
            type="button"
            aria-label={collapsed ? 'Déplier le dossier' : 'Replier le dossier'}
            className={cn(
              'flex h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200',
              children.length === 0 && 'invisible',
            )}
            onClick={() => onToggleCollapse(folder.id)}
          >
            {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
          </button>
          {renaming ? (
            <input
              autoFocus
              className="field h-6 flex-1 px-1.5 text-xs"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={commitRename}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') {
                  setName(folder.name);
                  setRenaming(false);
                }
              }}
            />
          ) : (
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
              onClick={() => onSelect(folder.id)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setName(folder.name);
                setRenaming(true);
              }}
            >
              <Folder size={15} className="shrink-0 text-zinc-400 dark:text-zinc-500" />
              <span className="truncate">{folder.name}</span>
              <span className="ml-auto text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500">
                {noteCount(folder.id)}
              </span>
            </button>
          )}
          <div
            className="opacity-0 transition-opacity group-hover:opacity-100"
            onClick={(e) => e.stopPropagation()}
          >
            <Menu
              align="right"
              trigger={
                <IconButton
                  label="Actions du dossier"
                  icon={<MoreHorizontal size={13} />}
                  className="h-5 w-5"
                />
              }
              items={folderMenuItems}
            />
          </div>
        </div>
      </ContextMenu>

      {newSubfolderOpen && (
        <div style={{ paddingLeft: `${8 + (depth + 1) * 14}px` }} className="pr-2 py-1">
          <input
            autoFocus
            className="field h-7 w-full px-2 text-xs"
            placeholder="Nom du sous-dossier…"
            value={subfolderName}
            onChange={(e) => setSubfolderName(e.target.value)}
            onBlur={commitAddSubfolder}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitAddSubfolder();
              if (e.key === 'Escape') {
                setSubfolderName('');
                setNewSubfolderOpen(false);
              }
            }}
          />
        </div>
      )}

      {!collapsed &&
        children.map((child) => (
          <FolderNode
            key={child.id}
            folder={child}
            depth={depth + 1}
            childrenOf={childrenOf}
            activeFolderId={activeFolderId}
            noteCount={noteCount}
            collapsedIds={collapsedIds}
            onToggleCollapse={onToggleCollapse}
            onSelect={onSelect}
          />
        ))}

      <ConfirmModal
        open={confirmDelete}
        title="Supprimer le dossier"
        message={`Es-tu sûr de vouloir supprimer définitivement le dossier « ${folder.name} » et ses sous-dossiers ? Les notes contenues ne seront pas supprimées (elles deviendront sans dossier).`}
        confirmLabel="Supprimer"
        onConfirm={() => {
          deleteFolder(folder.id);
          toast('info', 'Dossier supprimé');
          setConfirmDelete(false);
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

export interface SidebarProps {
  onOpenChat?: () => void;
}

export function Sidebar({ onOpenChat: _onOpenChat }: SidebarProps = {}) {
  const view = useAppStore((s) => s.ui.view);
  const collapsed = useAppStore((s) => s.ui.sidebarCollapsed);
  const folders = useAppStore((s) => s.data.folders);
  const tags = useAppStore((s) => s.data.tags);
  const notes = useAppStore((s) => s.data.notes);
  const cards = useAppStore((s) => s.data.cards);
  const filter = useAppStore((s) => s.ui.notesFilter);
  const collapsedFolderIds = useAppStore((s) => s.ui.collapsedFolderIds);
  const setView = useAppStore((s) => s.setView);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const setNotesFilter = useAppStore((s) => s.setNotesFilter);
  const toggleFolderCollapsed = useAppStore((s) => s.toggleFolderCollapsed);
  const createNote = useAppStore((s) => s.createNote);
  const createFolder = useAppStore((s) => s.createFolder);
  const createTag = useAppStore((s) => s.createTag);
  const updateTag = useAppStore((s) => s.updateTag);
  const deleteTag = useAppStore((s) => s.deleteTag);
  const toast = useAppStore((s) => s.toast);
  const { theme, setTheme } = useTheme();

  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newTagOpen, setNewTagOpen] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  /** Id du tag en cours de renommage (null = aucun). */
  const [renamingTagId, setRenamingTagId] = useState<string | null>(null);
  const [renamingTagName, setRenamingTagName] = useState('');
  /** Id du tag dont la palette de couleurs est ouverte (null = aucune). */
  const [paletteTagId, setPaletteTagId] = useState<string | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [bookmarkletModalOpen, setBookmarkletModalOpen] = useState(false);



  const roots = useMemo(
    () =>
      folders
        .filter((f) => f.parentId === null)
        .sort((a, b) => a.order - b.order),
    [folders],
  );

  const childrenOf = (id: string) =>
    folders.filter((f) => f.parentId === id).sort((a, b) => a.order - b.order);

  const noteCount = (folderId: string) =>
    notes.filter((n) => n.folderId === folderId).length;

  const tagCount = (tagId: string) => notes.filter((n) => n.tagIds.includes(tagId)).length;

  const addFolder = () => {
    const name = newFolderName.trim();
    if (name !== '') {
      createFolder(name, null);
      toast('success', `Dossier « ${name} » créé`);
    }
    setNewFolderName('');
    setNewFolderOpen(false);
  };

  const addTag = () => {
    const name = newTagName.trim();
    if (name !== '') {
      // Refus des doublons : deux tags de même nom seraient indiscernables
      // dans les menus de classement.
      const exists = tags.some((t) => t.name.toLowerCase() === name.toLowerCase());
      if (exists) {
        toast('info', `Le tag « ${name} » existe déjà`);
      } else {
        // Couleur choisie dans la palette, en tournant pour éviter que tous
        // les tags aient la même.
        const color = COLOR_PALETTE[tags.length % COLOR_PALETTE.length];
        createTag(name, color);
        // On annonce la couleur attribuée : elle est choisie automatiquement,
        // et reste modifiable via « Changer la couleur ».
        toast('success', `Tag « ${name} » créé (${colorName(color).toLowerCase()})`);
      }
    }
    setNewTagName('');
    setNewTagOpen(false);
  };

  const commitTagRename = () => {
    if (renamingTagId === null) return;
    const name = renamingTagName.trim();
    const current = tags.find((t) => t.id === renamingTagId);
    if (name !== '' && current !== undefined && name !== current.name) {
      const exists = tags.some(
        (t) => t.id !== renamingTagId && t.name.toLowerCase() === name.toLowerCase(),
      );
      if (exists) {
        toast('info', `Le tag « ${name} » existe déjà`);
      } else {
        updateTag(renamingTagId, { name });
        toast('success', 'Tag renommé');
      }
    }
    setRenamingTagId(null);
    setRenamingTagName('');
  };

  const ThemeIcon = THEME_ICONS[theme];
  const themeLabel = `Thème : ${THEME_LABELS[theme]} — cliquer pour ${THEME_LABELS[THEME_NEXT[theme]]}`;

  /* ------------------------------ Rail replié ------------------------------ */
  if (collapsed) {
    return (
      <aside className="flex w-14 shrink-0 flex-col items-center gap-2 border-r border-zinc-200 bg-zinc-50 py-3 dark:border-zinc-800 dark:bg-zinc-900/60">
        <IconButton label="Déplier la barre latérale" icon={<PanelLeft size={17} />} onClick={toggleSidebar} />
        <div className="h-px w-8 bg-zinc-200 dark:bg-zinc-800" />
        <IconButton
          label="Notes (Ctrl+1)"
          icon={<StickyNote size={17} />}
          active={view === 'notes'}
          onClick={() => setView('notes')}
        />
        <IconButton
          label="Kanban (Ctrl+2)"
          icon={<SquareKanban size={17} />}
          active={view === 'kanban'}
          onClick={() => setView('kanban')}
        />
        <IconButton
          label="Copilote IA (Ctrl+3)"
          icon={<Sparkles size={17} className="text-indigo-600 dark:text-indigo-400" />}
          active={view === 'chat'}
          onClick={() => setView('chat')}
        />
        <div className="flex-1" />
        <IconButton
          label="Plugin Favoris (Web Clipper & Injecteur)"
          icon={<Bookmark size={17} className="text-indigo-600 dark:text-indigo-400" />}
          onClick={() => setBookmarkletModalOpen(true)}
        />
        <IconButton
          label="Sécurité du compte"
          icon={<ShieldCheck size={17} className="text-emerald-500" />}
          onClick={() => setAuthModalOpen(true)}
        />
        <IconButton
          label="Se déconnecter"
          icon={<LogOut size={17} className="text-red-500" />}
          onClick={() => void logoutServer().finally(() => window.location.reload())}
        />
        <IconButton
          label={themeLabel}
          icon={<ThemeIcon size={17} />}
          onClick={() => setTheme(THEME_NEXT[theme])}
        />
        {authModalOpen && (
          <ServerAccountModal onClose={() => setAuthModalOpen(false)} />
        )}
        {bookmarkletModalOpen && (
          <BookmarkletModal onClose={() => setBookmarkletModalOpen(false)} />
        )}
      </aside>
    );
  }

  /* ------------------------------- Barre large ------------------------------ */
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60">
      <div className="flex items-center gap-2.5 px-4 pb-2 pt-4">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-500 text-sm font-bold text-white">
          M
        </div>
        <span className="flex-1 truncate text-sm font-semibold tracking-tight">
          MansotNote
        </span>
        <IconButton
          label="Replier la barre latérale"
          icon={<PanelLeftClose size={16} />}
          onClick={toggleSidebar}
        />
      </div>

      <div className="space-y-1 px-3 pb-3">
        <Button
          className="w-full"
          icon={<Plus size={15} />}
          onClick={() => {
            createNote();
            setView('notes');
            toast('success', 'Nouvelle note créée');
          }}
        >
          Nouvelle note
        </Button>
      </div>

      <nav className="space-y-0.5 px-3">
      <NavItem
        icon={<StickyNote size={16} />}
        label="Notes"
        hint="Ctrl+1"
        active={view === 'notes'}
        onClick={() => {
          setView('notes');
          setNotesFilter({ folderId: 'all', tagId: 'all', search: '', archivedOnly: false });
        }}
      />
        <NavItem
          icon={<SquareKanban size={16} />}
          label="Kanban"
          hint="Ctrl+2"
          active={view === 'kanban'}
          onClick={() => setView('kanban')}
        />
        <NavItem
          icon={<Sparkles size={16} className="text-indigo-600 dark:text-indigo-400" />}
          label="SIA · Copilote"
          hint="Ctrl+3"
          active={view === 'chat'}
          onClick={() => setView('chat')}
        />
      </nav>

      <div className="mt-4 flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-3">
        {/* Dossiers */}
        <div className="mb-1 flex items-center justify-between px-2.5 pt-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            Dossiers
          </span>
          <IconButton
            label="Nouveau dossier"
            icon={<Plus size={14} />}
            className="h-6 w-6"
            onClick={() => setNewFolderOpen((value) => !value)}
          />
        </div>

        <div className="space-y-0.5">
          <button
            type="button"
            onClick={() => setNotesFilter({ folderId: 'all', tagId: 'all' })}
            className={cn(
              'flex w-full items-center gap-2 rounded-lg px-2.5 py-1 text-[13px] transition-colors',
              filter.folderId === 'all'
                ? 'bg-indigo-500/15 font-medium text-indigo-700 dark:bg-indigo-400/15 dark:text-indigo-300'
                : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800',
            )}
          >
            <Inbox size={15} className="shrink-0 text-zinc-400 dark:text-zinc-500" />
            <span className="flex-1 truncate text-left">Toutes les notes</span>
            <span className="text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500">
              {notes.length}
            </span>
          </button>

          {roots.map((folder) => (
            <FolderNode
              key={folder.id}
              folder={folder}
              depth={0}
              childrenOf={childrenOf}
              activeFolderId={filter.folderId}
              noteCount={noteCount}
              collapsedIds={collapsedFolderIds}
              onToggleCollapse={toggleFolderCollapsed}
              onSelect={(id) =>
                setNotesFilter({ folderId: id === filter.folderId ? 'all' : id, tagId: 'all' })
              }
            />
          ))}

          <button
            type="button"
            onClick={() => setNotesFilter({ folderId: 'none', tagId: 'all' })}
            className={cn(
              'flex w-full items-center gap-2 rounded-lg px-2.5 py-1 text-[13px] transition-colors',
              filter.folderId === 'none'
                ? 'bg-indigo-500/15 font-medium text-indigo-700 dark:bg-indigo-400/15 dark:text-indigo-300'
                : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800',
            )}
          >
            <Inbox size={15} className="shrink-0 text-zinc-400 dark:text-zinc-500" />
            <span className="flex-1 truncate text-left">Sans dossier</span>
            <span className="text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500">
              {notes.filter((n) => n.folderId === null).length}
            </span>
          </button>

          {newFolderOpen && (
            <div className="px-1 pb-1 pt-1">
              <input
                autoFocus
                className="field h-8 w-full px-2.5 text-sm"
                placeholder="Nom du dossier…"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addFolder();
                  if (e.key === 'Escape') {
                    setNewFolderOpen(false);
                    setNewFolderName('');
                  }
                }}
                onBlur={addFolder}
              />
            </div>
          )}
        </div>

        {/* Tags */}
        <div className="mb-1 flex items-center justify-between px-2.5 pt-4">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            Tags
          </span>
          <IconButton
            label="Nouveau tag"
            icon={<Plus size={13} />}
            className="h-5 w-5"
            onClick={() => {
              setNewTagOpen(true);
              setNewTagName('');
            }}
          />
        </div>
        <div className="space-y-0.5">
          {tags.length === 0 && !newTagOpen && (
            <p className="px-2.5 py-1 text-xs text-zinc-400 dark:text-zinc-500">
              Aucun tag.
            </p>
          )}
          {newTagOpen && (
            <div className="px-2.5 py-1">
              <input
                autoFocus
                className="field h-7 w-full px-2 text-xs"
                placeholder="Nom du tag…"
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addTag();
                  if (e.key === 'Escape') {
                    setNewTagOpen(false);
                    setNewTagName('');
                  }
                }}
                onBlur={addTag}
              />
            </div>
          )}
          {tags.map((tag) => {
            const tagMenuItems: ContextMenuItem[] = [
              {
                label: 'Renommer le tag',
                icon: <Pencil size={13} />,
                onClick: () => {
                  setRenamingTagId(tag.id);
                  setRenamingTagName(tag.name);
                },
              },
              {
                label: 'Changer la couleur',
                icon: (
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: tag.color }}
                  />
                ),
                divider: true,
                onClick: () => setPaletteTagId(tag.id),
              },
              {
                label: 'Supprimer le tag',
                icon: <Trash2 size={13} />,
                danger: true,
                divider: true,
                onClick: () => {
                  const used = tagCount(tag.id);
                  const message =
                    used > 0
                      ? `Supprimer le tag « ${tag.name} » ? Il sera retiré de ${used} note${used > 1 ? 's' : ''}.`
                      : `Supprimer le tag « ${tag.name} » ?`;
                  if (window.confirm(message)) {
                    deleteTag(tag.id);
                    toast('info', 'Tag supprimé');
                  }
                },
              },
            ];

            // Renommage en ligne : remplace la ligne du tag par un champ.
            if (renamingTagId === tag.id) {
              return (
                <div key={tag.id} className="px-2.5 py-1">
                  <input
                    autoFocus
                    className="field h-7 w-full px-2 text-xs"
                    value={renamingTagName}
                    onChange={(e) => setRenamingTagName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitTagRename();
                      if (e.key === 'Escape') {
                        setRenamingTagId(null);
                        setRenamingTagName('');
                      }
                    }}
                    onBlur={commitTagRename}
                  />
                </div>
              );
            }

            return (
              <div key={tag.id}>
              <ContextMenu items={tagMenuItems}>
                <div
                  className={cn(
                    'group flex w-full items-center gap-2 rounded-lg px-2.5 py-1 text-[13px] transition-colors',
                    filter.tagId === tag.id
                      ? 'bg-indigo-500/15 font-medium text-indigo-700 dark:bg-indigo-400/15 dark:text-indigo-300'
                      : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800',
                  )}
                >
                  <button
                    type="button"
                    onClick={() =>
                      setNotesFilter({
                        tagId: filter.tagId === tag.id ? 'all' : tag.id,
                      })
                    }
                    onDoubleClick={() => {
                      setRenamingTagId(tag.id);
                      setRenamingTagName(tag.name);
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: tag.color }}
                    />
                    <span className="flex-1 truncate">{tag.name}</span>
                    <span className="text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500">
                      {tagCount(tag.id)}
                    </span>
                  </button>
                  <div
                    className="opacity-0 transition-opacity group-hover:opacity-100"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Menu
                      align="right"
                      trigger={
                        <IconButton
                          label="Actions du tag"
                          icon={<MoreHorizontal size={13} />}
                          className="h-5 w-5"
                        />
                      }
                      items={tagMenuItems}
                    />
                  </div>
                </div>
              </ContextMenu>
              {/* Palette : une grille de pastilles se lit d'un coup d'œil,
                  là où dix libellés textuels noyaient le menu. */}
              {paletteTagId === tag.id && (
                <div className="mt-1 flex flex-wrap gap-1 rounded-lg bg-zinc-100 p-1.5 dark:bg-zinc-800/70">
                  {COLOR_PALETTE.map((color) => (
                    <button
                      key={color}
                      type="button"
                      title={colorName(color)}
                      aria-label={colorName(color)}
                      onClick={() => {
                        updateTag(tag.id, { color });
                        setPaletteTagId(null);
                        toast('success', `Couleur : ${colorName(color)}`);
                      }}
                      className={cn(
                        'h-5 w-5 rounded-full transition-transform hover:scale-110',
                        color === tag.color
                          ? 'ring-2 ring-zinc-900 ring-offset-1 dark:ring-zinc-100 dark:ring-offset-zinc-800'
                          : 'ring-1 ring-black/10 dark:ring-white/15',
                      )}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Pied : thème + sécurité + compteurs */}
      <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-1">
            <IconButton
              label={themeLabel}
              icon={<ThemeIcon size={16} />}
              onClick={() => setTheme(THEME_NEXT[theme])}
            />
            <IconButton
              label="Plugin Favoris (Web Clipper)"
              icon={<Bookmark size={16} className="text-indigo-600 dark:text-indigo-400" />}
              onClick={() => setBookmarkletModalOpen(true)}
            />
            <IconButton
              label="Sécurité du compte serveur"
              icon={<ShieldCheck size={16} className="text-emerald-500" />}
              onClick={() => setAuthModalOpen(true)}
            />
            <IconButton
              label="Se déconnecter"
              icon={<LogOut size={15} className="text-red-500" />}
              onClick={() => void logoutServer().finally(() => window.location.reload())}
            />
          </div>
          <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
            {notes.length} notes · {cards.length} cartes
          </span>
        </div>
      </div>

      {authModalOpen && (
        <ServerAccountModal onClose={() => setAuthModalOpen(false)} />
      )}
      {bookmarkletModalOpen && (
        <BookmarkletModal onClose={() => setBookmarkletModalOpen(false)} />
      )}
    </aside>
  );
}
