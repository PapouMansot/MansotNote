/**
 * Actions du module Notes — CRUD notes/dossiers/tags, brouillon
 * d'édition (autosave) et filtres de la liste.
 */
import type {
  Folder,
  ID,
  Note,
  NotesFilterState,
  PersistedState,
  Tag,
} from '@/types';
import { newFolderId, newNoteId, newTagId } from '@/lib/id';
import type { StoreGet, StoreSet } from './types';
import {
  cancelPersist,
  commitNoteDraft,
  persistNow,
  schedulePersist,
} from './persist';

/** Paramètres de création d'une note. */
export interface CreateNoteInput {
  title?: string;
  content?: string;
  folderId?: ID | null;
  tagIds?: ID[];
  preserveView?: boolean;
}

export interface NotesActions {
  /* --- CRUD notes --- */
  createNote: (input?: CreateNoteInput) => ID;
  updateNote: (id: ID, patch: { title?: string; content?: string }) => void;
  setNoteTitle: (id: ID, title: string) => void;
  togglePin: (id: ID) => void;
  archiveNote: (id: ID) => void;
  unarchiveNote: (id: ID) => void;
  moveNoteToFolder: (id: ID, folderId: ID | null) => void;
  toggleNoteTag: (id: ID, tagId: ID) => void;
  deleteNote: (id: ID) => void;
  duplicateNote: (id: ID) => ID | null;

  /* --- Dossiers --- */
  createFolder: (name: string, parentId?: ID | null) => ID;
  renameFolder: (id: ID, name: string) => void;
  deleteFolder: (id: ID) => void;

  /* --- Tags --- */
  createTag: (name: string, color: string) => ID;
  /** Renomme un tag et/ou change sa couleur. */
  updateTag: (id: ID, patch: { name?: string; color?: string }) => void;
  deleteTag: (id: ID) => void;

  /* --- Édition (brouillon + autosave) --- */
  openNote: (id: ID) => void;
  closeNote: () => void;
  setDraft: (patch: { title?: string; content?: string }) => void;
  saveDraftNow: () => Promise<void>;
  discardDraft: () => void;

  /* --- Filtres de la liste --- */
  setNotesFilter: (patch: Partial<NotesFilterState>) => void;
}

/** Applique `fn` à la note `id` dans les données. */
function mapNote(
  data: PersistedState,
  id: ID,
  fn: (note: Note) => Note,
): PersistedState {
  return { ...data, notes: data.notes.map((n) => (n.id === id ? fn(n) : n)) };
}

export function createNotesActions(set: StoreSet, get: StoreGet) {
  return {
    /* ------------------------------ Notes ------------------------------ */

    createNote: (input?: CreateNoteInput): ID => {
      // Le brouillon actif (s'il est sale) est commité avant le
      // basculement : aucune édition perdue au changement de note.
      commitNoteDraft(set, get);
      const id = newNoteId();
      const now = Date.now();
      const { data, ui } = get();
      const folderId =
        input?.folderId !== undefined
          ? input.folderId
          : data.settings.defaultFolderId ?? null;
      const note: Note = {
        id,
        title: input?.title ?? '',
        content: input?.content ?? '',
        folderId,
        tagIds: input?.tagIds ?? [],
        pinned: false,
        createdAt: now,
        updatedAt: now,
      };
      set({
        data: { ...data, notes: [note, ...data.notes] },
        ui: {
          ...ui,
          view: input?.preserveView ? ui.view : 'notes',
          activeNoteId: id,
          notesFilter: {
            ...ui.notesFilter,
            folderId: 'all',
            tagId: 'all',
            search: '',
            archivedOnly: false,
          },
          noteDraft: {
            noteId: id,
            title: note.title,
            content: note.content,
            dirty: false,
            savedAt: now,
          },
          saveStatus: 'saved',
        },
      });
      schedulePersist(set, get);
      return id;
    },

    updateNote: (id: ID, patch: { title?: string; content?: string }) => {
      const now = Date.now();
      const { ui } = get();
      const isDraftTarget = ui.activeNoteId === id && ui.noteDraft !== null;
      set((s) => ({
        data: mapNote(s.data, id, (n) => ({
          ...n,
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.content !== undefined ? { content: patch.content } : {}),
          updatedAt: now,
        })),
        ui: isDraftTarget
          ? {
              ...s.ui,
              noteDraft: {
                ...s.ui.noteDraft!,
                ...(patch.title !== undefined ? { title: patch.title } : {}),
                ...(patch.content !== undefined ? { content: patch.content } : {}),
                dirty: false,
                savedAt: now,
              },
            }
          : s.ui,
      }));
      schedulePersist(set, get);
    },

    setNoteTitle: (id: ID, title: string) => {
      const now = Date.now();
      const { ui } = get();
      const draft = ui.activeNoteId === id ? ui.noteDraft : null;
      set((s) => ({
        data: mapNote(s.data, id, (n) => ({ ...n, title, updatedAt: now })),
        ui:
          draft !== null
            ? { ...s.ui, noteDraft: { ...draft, title, dirty: true } }
            : s.ui,
      }));
      schedulePersist(set, get);
    },

    togglePin: (id: ID) => {
      const now = Date.now();
      set((s) => ({
        data: mapNote(s.data, id, (n) => ({ ...n, pinned: !n.pinned, updatedAt: now })),
      }));
      schedulePersist(set, get);
    },

    archiveNote: (id: ID) => {
      const now = Date.now();
      set((s) => ({
        data: mapNote(s.data, id, (n) => ({
          ...n,
          archived: true,
          archivedAt: now,
          pinned: false,
          updatedAt: now,
        })),
        ui:
          s.ui.activeNoteId === id && !s.ui.notesFilter.archivedOnly
            ? { ...s.ui, activeNoteId: null, noteDraft: null, saveStatus: 'idle' }
            : s.ui,
      }));
      schedulePersist(set, get);
    },

    unarchiveNote: (id: ID) => {
      const now = Date.now();
      set((s) => ({
        data: mapNote(s.data, id, (n) => ({
          ...n,
          archived: false,
          archivedAt: null,
          updatedAt: now,
        })),
      }));
      schedulePersist(set, get);
    },

    moveNoteToFolder: (id: ID, folderId: ID | null) => {
      const now = Date.now();
      set((s) => ({
        data: mapNote(s.data, id, (n) => ({ ...n, folderId, updatedAt: now })),
      }));
      schedulePersist(set, get);
    },

    toggleNoteTag: (id: ID, tagId: ID) => {
      const now = Date.now();
      set((s) => ({
        data: mapNote(s.data, id, (n) => {
          const has = n.tagIds.includes(tagId);
          return {
            ...n,
            tagIds: has
              ? n.tagIds.filter((t) => t !== tagId)
              : [...n.tagIds, tagId],
            updatedAt: now,
          };
        }),
      }));
      schedulePersist(set, get);
    },

    deleteNote: (id: ID) => {
      set((s) => ({
        data: {
          ...s.data,
          notes: s.data.notes.filter((n) => n.id !== id),
          // Délie les cartes Kanban qui pointaient vers cette note.
          cards: s.data.cards.map((c) =>
            c.linkedNoteId === id ? { ...c, linkedNoteId: null } : c,
          ),
        },
        ui:
          s.ui.activeNoteId === id
            ? { ...s.ui, activeNoteId: null, noteDraft: null, saveStatus: 'idle' }
            : s.ui,
      }));
      schedulePersist(set, get);
    },

    duplicateNote: (id: ID): ID | null => {
      const { data } = get();
      const src = data.notes.find((n) => n.id === id);
      if (src === undefined) {
        return null;
      }
      const now = Date.now();
      const newId = newNoteId();
      const copy: Note = {
        ...src,
        id: newId,
        title: `${src.title} (copie)`,
        pinned: false,
        createdAt: now,
        updatedAt: now,
      };
      set((s) => {
        const idx = s.data.notes.findIndex((n) => n.id === id);
        const notes = [...s.data.notes];
        notes.splice(idx + 1, 0, copy);
        return { data: { ...s.data, notes } };
      });
      schedulePersist(set, get);
      return newId;
    },

    /* ------------------------------ Dossiers --------------------------- */

    createFolder: (name: string, parentId?: ID | null): ID => {
      const id = newFolderId();
      const now = Date.now();
      set((s) => {
        const parent = parentId ?? null;
        const siblings = s.data.folders.filter((f) => f.parentId === parent);
        const order =
          siblings.length > 0 ? Math.max(...siblings.map((f) => f.order)) + 1 : 0;
        const folder: Folder = { id, name, parentId: parent, order, createdAt: now };
        return { data: { ...s.data, folders: [...s.data.folders, folder] } };
      });
      schedulePersist(set, get);
      return id;
    },

    renameFolder: (id: ID, name: string) => {
      set((s) => ({
        data: {
          ...s.data,
          folders: s.data.folders.map((f) => (f.id === id ? { ...f, name } : f)),
        },
      }));
      schedulePersist(set, get);
    },

    deleteFolder: (id: ID) => {
      set((s) => {
        // Les sous-dossiers remontent à la racine, les notes passent « sans dossier ».
        const folders = s.data.folders
          .filter((f) => f.id !== id)
          .map((f) => (f.parentId === id ? { ...f, parentId: null } : f));
        const notes = s.data.notes.map((n) =>
          n.folderId === id ? { ...n, folderId: null } : n,
        );
        return { data: { ...s.data, folders, notes } };
      });
      schedulePersist(set, get);
    },

    /* ------------------------------- Tags ------------------------------ */

    createTag: (name: string, color: string): ID => {
      const id = newTagId();
      const now = Date.now();
      const tag: Tag = { id, name, color, createdAt: now };
      set((s) => ({
        data: { ...s.data, tags: [...s.data.tags, tag] },
      }));
      schedulePersist(set, get);
      return id;
    },

    updateTag: (id: ID, patch: { name?: string; color?: string }) => {
      set((s) => ({
        data: {
          ...s.data,
          tags: s.data.tags.map((t) => (t.id === id ? { ...t, ...patch } : t)),
        },
      }));
      schedulePersist(set, get);
    },

    deleteTag: (id: ID) => {
      set((s) => ({
        data: {
          ...s.data,
          tags: s.data.tags.filter((t) => t.id !== id),
          notes: s.data.notes.map((n) =>
            n.tagIds.includes(id)
              ? { ...n, tagIds: n.tagIds.filter((t) => t !== id) }
              : n,
          ),
        },
      }));
      schedulePersist(set, get);
    },

    /* --------------------------- Édition (draft) ------------------------ */

    openNote: (id: ID) => {
      // Committe le brouillon de la note précédente (si sale).
      commitNoteDraft(set, get);
      const { data, ui } = get();
      const note = data.notes.find((n) => n.id === id);
      if (note === undefined) {
        return;
      }
      set({
        ui: {
          ...ui,
          view: 'notes',
          activeNoteId: id,
          noteDraft: {
            noteId: id,
            // Une note persistée sans champ (ancien format) ne doit pas
            // faire entrer undefined dans le brouillon.
            title: typeof note.title === 'string' ? note.title : '',
            content: typeof note.content === 'string' ? note.content : '',
            dirty: false,
            savedAt: note.updatedAt,
          },
          saveStatus: 'saved',
        },
      });
    },

    closeNote: () => {
      // L'autosave n'a pas à « perdre » la note au moment de la fermer :
      // on commite le brouillon (s'il est sale) puis on programme
      // l'écriture (respecte autosaveEnabled).
      commitNoteDraft(set, get);
      const { ui } = get();
      set({ ui: { ...ui, activeNoteId: null, noteDraft: null, saveStatus: 'idle' } });
      schedulePersist(set, get);
    },

    setDraft: (patch: { title?: string; content?: string }) => {
      const current = get().ui.noteDraft;
      if (current === null) {
        return;
      }
      // Même règle qu'en réglages : une clé undefined ne doit pas écraser
      // la valeur existante du brouillon.
      const safe: { title?: string; content?: string } = {};
      if (patch.title !== undefined) {
        safe.title = patch.title;
      }
      if (patch.content !== undefined) {
        safe.content = patch.content;
      }
      set((s) => ({
        ui: {
          ...s.ui,
          noteDraft: { ...current, ...safe, dirty: true },
          saveStatus: 'dirty',
        },
      }));
      schedulePersist(set, get);
    },

    saveDraftNow: async () => {
      const draft = get().ui.noteDraft;
      if (draft === null || draft.noteId === null) {
        return;
      }
      cancelPersist();
      // persistNow commite le brouillon (commitNoteDraft) puis écrit.
      await persistNow(set, get);
    },

    discardDraft: () => {
      const { data, ui } = get();
      const draft = ui.noteDraft;
      if (draft === null) {
        return;
      }
      const note =
        draft.noteId !== null
          ? data.notes.find((n) => n.id === draft.noteId)
          : undefined;
      if (note === undefined) {
        set((s) => ({ ui: { ...s.ui, noteDraft: null } }));
        return;
      }
      set((s) => ({
        ui: {
          ...s.ui,
          noteDraft: {
            noteId: note.id,
            title: note.title,
            content: note.content,
            dirty: false,
            savedAt: note.updatedAt,
          },
          saveStatus: 'saved',
        },
      }));
    },

    /* ----------------------------- Filtres ----------------------------- */

    setNotesFilter: (patch: Partial<NotesFilterState>) => {
      set((s) => ({
        ui: { ...s.ui, notesFilter: { ...s.ui.notesFilter, ...patch } },
      }));
    },
  };
}
