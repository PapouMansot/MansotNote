/**
 * Actions du module Kanban — colonnes, cartes (déménagement + ordre),
 * étiquettes, checklists et filtres du board.
 *
 * L'ordre est normalisé après chaque mutation : les `order` d'une
 * colonne sont toujours 0..n-1, sans trous.
 */
import type {
  ChecklistItem,
  ID,
  KanbanCard,
  KanbanColumn,
  KanbanFilterState,
  KanbanLabel,
  PersistedState,
  Priority,
} from '@/types';
import {
  newCardId,
  newChecklistItemId,
  newColumnId,
  newLabelId,
} from '@/lib/id';
import { clamp } from '@/lib/utils';
import type { StoreGet, StoreSet } from './types';
import { schedulePersist } from './persist';

/** Paramètres de création d'une carte. */
export interface CreateCardInput {
  title?: string;
  description?: string;
  priority?: Priority;
  dueDate?: string | null;
  labelIds?: ID[];
  linkedNoteId?: ID | null;
}

export interface KanbanActions {
  /* --- Colonnes --- */
  addColumn: (title: string) => ID;
  renameColumn: (id: ID, title: string) => void;
  deleteColumn: (id: ID) => void;
  reorderColumns: (orderedIds: ID[]) => void;

  /* --- Cartes --- */
  createCard: (columnId: ID, input?: CreateCardInput) => ID;
  updateCard: (
    id: ID,
    patch: Partial<
      Pick<KanbanCard, 'title' | 'description' | 'priority' | 'dueDate' | 'linkedNoteId'>
    >,
  ) => void;
  deleteCard: (id: ID) => void;
  archiveCard: (id: ID) => void;
  unarchiveCard: (id: ID) => void;
  /** Déplace la carte dans `toColumnId` à la position `toIndex`. */
  moveCard: (cardId: ID, toColumnId: ID, toIndex: number) => void;
  toggleCardLabel: (cardId: ID, labelId: ID) => void;

  /* --- Étiquettes --- */
  createLabel: (name: string, color: string) => ID;
  deleteLabel: (id: ID) => void;

  /* --- Checklist --- */
  addChecklistItem: (cardId: ID, title: string) => void;
  toggleChecklistItem: (cardId: ID, itemId: ID) => void;
  editChecklistItem: (cardId: ID, itemId: ID, title: string) => void;
  removeChecklistItem: (cardId: ID, itemId: ID) => void;

  /* --- Filtres --- */
  setKanbanFilter: (patch: Partial<KanbanFilterState>) => void;
}

/** Applique `fn` à la carte `id`. */
function mapCard(
  data: PersistedState,
  id: ID,
  fn: (card: KanbanCard) => KanbanCard,
): PersistedState {
  return { ...data, cards: data.cards.map((c) => (c.id === id ? fn(c) : c)) };
}

export function createKanbanActions(set: StoreSet, get: StoreGet) {
  return {
    /* ------------------------------ Colonnes --------------------------- */

    addColumn: (title: string): ID => {
      const id = newColumnId();
      const now = Date.now();
      set((s) => {
        const order =
          s.data.columns.length > 0
            ? Math.max(...s.data.columns.map((c) => c.order)) + 1
            : 0;
        const column: KanbanColumn = { id, title, order, createdAt: now };
        return { data: { ...s.data, columns: [...s.data.columns, column] } };
      });
      schedulePersist(set, get);
      return id;
    },

    renameColumn: (id: ID, title: string) => {
      set((s) => ({
        data: {
          ...s.data,
          columns: s.data.columns.map((c) => (c.id === id ? { ...c, title } : c)),
        },
      }));
      schedulePersist(set, get);
    },

    deleteColumn: (id: ID) => {
      set((s) => ({
        data: {
          ...s.data,
          columns: s.data.columns.filter((c) => c.id !== id),
          // Les cartes de la colonne sont supprimées avec elle.
          cards: s.data.cards.filter((c) => c.columnId !== id),
        },
        ui:
          s.ui.openColumnMenuId === id
            ? { ...s.ui, openColumnMenuId: null }
            : s.ui,
      }));
      schedulePersist(set, get);
    },

    reorderColumns: (orderedIds: ID[]) => {
      set((s) => {
        const columns = orderedIds
          .map((columnId, index) => {
            const column = s.data.columns.find((c) => c.id === columnId);
            return column === undefined ? null : { ...column, order: index };
          })
          .filter((c): c is KanbanColumn => c !== null);
        return { data: { ...s.data, columns } };
      });
      schedulePersist(set, get);
    },

    /* ------------------------------- Cartes ----------------------------- */

    createCard: (columnId: ID, input?: CreateCardInput): ID => {
      const id = newCardId();
      const now = Date.now();
      set((s) => {
        const card: KanbanCard = {
          id,
          columnId,
          order: s.data.cards.filter((c) => c.columnId === columnId).length,
          title: input?.title ?? '',
          description: input?.description ?? '',
          labelIds: input?.labelIds ?? [],
          priority: input?.priority ?? 'medium',
          dueDate: input?.dueDate ?? null,
          checklist: [],
          linkedNoteId: input?.linkedNoteId ?? null,
          createdAt: now,
          updatedAt: now,
        };
        return {
          data: { ...s.data, cards: [...s.data.cards, card] },
          ui: { ...s.ui, activeCardId: id },
        };
      });
      schedulePersist(set, get);
      return id;
    },

    updateCard: (
      id: ID,
      patch: Partial<
        Pick<KanbanCard, 'title' | 'description' | 'priority' | 'dueDate' | 'linkedNoteId'>
      >,
    ) => {
      const now = Date.now();
      set((s) => ({
        data: mapCard(s.data, id, (c) => ({ ...c, ...patch, updatedAt: now })),
      }));
      schedulePersist(set, get);
    },

    deleteCard: (id: ID) => {
      set((s) => ({
        data: { ...s.data, cards: s.data.cards.filter((c) => c.id !== id) },
        ui: s.ui.activeCardId === id ? { ...s.ui, activeCardId: null } : s.ui,
      }));
      schedulePersist(set, get);
    },

    archiveCard: (id: ID) => {
      const now = Date.now();
      set((s) => ({
        data: mapCard(s.data, id, (c) => ({
          ...c,
          archived: true,
          archivedAt: now,
          updatedAt: now,
        })),
        ui: s.ui.activeCardId === id ? { ...s.ui, activeCardId: null } : s.ui,
      }));
      schedulePersist(set, get);
    },

    unarchiveCard: (id: ID) => {
      const now = Date.now();
      set((s) => ({
        data: mapCard(s.data, id, (c) => ({
          ...c,
          archived: false,
          archivedAt: null,
          updatedAt: now,
        })),
      }));
      schedulePersist(set, get);
    },

    moveCard: (cardId: ID, toColumnId: ID, toIndex: number) => {
      set((s) => {
        const card = s.data.cards.find((c) => c.id === cardId);
        if (card === undefined) {
          return {};
        }
        const now = Date.now();
        const sourceColumnId = card.columnId;

        // Colonne cible : insertion à la position demandée, puis
        // normalisation des ordres (0..n-1).
        const targetCards = s.data.cards
          .filter((c) => c.columnId === toColumnId && c.id !== cardId)
          .sort((a, b) => a.order - b.order);
        const index = clamp(toIndex, 0, targetCards.length);
        targetCards.splice(index, 0, {
          ...card,
          columnId: toColumnId,
          updatedAt: now,
        });
        const orderedTarget = targetCards.map((c, i) => ({ ...c, order: i }));

        // Colonne source (si différente) : renormalisée sans la carte.
        const sourceCards =
          sourceColumnId === toColumnId
            ? []
            : s.data.cards
                .filter(
                  (c) =>
                    c.columnId === sourceColumnId && c.id !== cardId,
                )
                .sort((a, b) => a.order - b.order)
                .map((c, i) => ({ ...c, order: i }));

        // Les autres colonnes ne changent pas.
        const others = s.data.cards.filter(
          (c) =>
            c.id !== cardId &&
            c.columnId !== toColumnId &&
            c.columnId !== sourceColumnId,
        );

        return {
          data: {
            ...s.data,
            cards: [...orderedTarget, ...sourceCards, ...others],
          },
        };
      });
      schedulePersist(set, get);
    },

    toggleCardLabel: (cardId: ID, labelId: ID) => {
      const now = Date.now();
      set((s) => ({
        data: mapCard(s.data, cardId, (c) => {
          const has = c.labelIds.includes(labelId);
          return {
            ...c,
            labelIds: has
              ? c.labelIds.filter((l) => l !== labelId)
              : [...c.labelIds, labelId],
            updatedAt: now,
          };
        }),
      }));
      schedulePersist(set, get);
    },

    /* ----------------------------- Étiquettes --------------------------- */

    createLabel: (name: string, color: string): ID => {
      const id = newLabelId();
      const now = Date.now();
      const label: KanbanLabel = { id, name, color, createdAt: now };
      set((s) => ({
        data: { ...s.data, labels: [...s.data.labels, label] },
      }));
      schedulePersist(set, get);
      return id;
    },

    deleteLabel: (id: ID) => {
      set((s) => ({
        data: {
          ...s.data,
          labels: s.data.labels.filter((l) => l.id !== id),
          cards: s.data.cards.map((c) =>
            c.labelIds.includes(id)
              ? { ...c, labelIds: c.labelIds.filter((l) => l !== id) }
              : c,
          ),
        },
      }));
      schedulePersist(set, get);
    },

    /* ------------------------------ Checklist --------------------------- */

    addChecklistItem: (cardId: ID, title: string) => {
      const id = newChecklistItemId();
      const now = Date.now();
      set((s) => ({
        data: mapCard(s.data, cardId, (c) => {
          const item: ChecklistItem = {
            id,
            title,
            done: false,
            order: c.checklist.length,
          };
          return { ...c, checklist: [...c.checklist, item], updatedAt: now };
        }),
      }));
      schedulePersist(set, get);
    },

    toggleChecklistItem: (cardId: ID, itemId: ID) => {
      const now = Date.now();
      set((s) => ({
        data: mapCard(s.data, cardId, (c) => ({
          ...c,
          checklist: c.checklist.map((it) =>
            it.id === itemId ? { ...it, done: !it.done } : it,
          ),
          updatedAt: now,
        })),
      }));
      schedulePersist(set, get);
    },

    editChecklistItem: (cardId: ID, itemId: ID, title: string) => {
      const now = Date.now();
      set((s) => ({
        data: mapCard(s.data, cardId, (c) => ({
          ...c,
          checklist: c.checklist.map((it) =>
            it.id === itemId ? { ...it, title } : it,
          ),
          updatedAt: now,
        })),
      }));
      schedulePersist(set, get);
    },

    removeChecklistItem: (cardId: ID, itemId: ID) => {
      const now = Date.now();
      set((s) => ({
        data: mapCard(s.data, cardId, (c) => {
          const checklist = c.checklist
            .filter((it) => it.id !== itemId)
            .map((it, i) => ({ ...it, order: i }));
          return { ...c, checklist, updatedAt: now };
        }),
      }));
      schedulePersist(set, get);
    },

    /* ------------------------------- Filtres ---------------------------- */

    setKanbanFilter: (patch: Partial<KanbanFilterState>) => {
      set((s) => ({
        ui: { ...s.ui, kanbanFilter: { ...s.ui.kanbanFilter, ...patch } },
      }));
    },
  };
}
