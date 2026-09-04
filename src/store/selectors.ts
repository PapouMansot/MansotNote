/**
 * Sélecteurs — dérivent les structures d'affichage (types « dérivés »
 * de src/types) à partir de l'état complet du store.
 *
 * Ils sont purs : à état donné, ils renvoient toujours le même résultat
 * (les composants peuvent les appeler à chaque rendu).
 */
import type {
  AppState,
  CardWithRelations,
  ColumnWithCards,
  ID,
  KanbanLabel,
  Note,
  NoteListItem,
  Tag,
} from '@/types';
import { EXCERPT_MAX_LENGTH } from '@/constants';
import { countWords, markdownToPlainText } from '@/lib/markdown';
import { filterAndSortNotes, filterCards } from '@/lib/search';

/** Liste des notes affichable (filtrée, triée, enrichie). */
export function selectNoteList(state: AppState): NoteListItem[] {
  const { folders, notes, tags } = state.data;
  const folderById = new Map(folders.map((f) => [f.id, f]));
  const tagById = new Map(tags.map((t) => [t.id, t]));

  return filterAndSortNotes(notes, state.ui.notesFilter).map((note) => {
    const folder =
      note.folderId !== null ? (folderById.get(note.folderId) ?? null) : null;
    const noteTags = note.tagIds
      .map((tagId) => tagById.get(tagId))
      .filter((t): t is Tag => t !== undefined);
    return {
      note,
      folder,
      tags: noteTags,
      wordCount: countWords(note.content),
      excerpt: markdownToPlainText(note.content).slice(0, EXCERPT_MAX_LENGTH),
    };
  });
}

/**
 * Colonnes du board (dans l'ordre), avec compteur total et cartes
 * visibles après filtrage — alimente l'affichage du board.
 */
export function selectColumnsWithCards(state: AppState): ColumnWithCards[] {
  const { cards, columns } = state.data;
  const filtered = filterCards(cards, state.ui.kanbanFilter);

  return [...columns]
    .sort((a, b) => a.order - b.order)
    .map((column) => {
      const allInColumn = cards.filter((c) => c.columnId === column.id);
      const visible = filtered
        .filter((c) => c.columnId === column.id)
        .sort((a, b) => a.order - b.order);
      return {
        column,
        cardCount: allInColumn.length,
        cards: visible,
      };
    });
}

/** Carte + relations (étiquettes, note liée, progression de la checklist). */
export function selectCardWithRelations(
  state: AppState,
  cardId: ID | null,
): CardWithRelations | null {
  if (cardId === null) {
    return null;
  }
  const { cards, labels, notes } = state.data;
  const card = cards.find((c) => c.id === cardId);
  if (card === undefined) {
    return null;
  }
  const labelById = new Map(labels.map((l) => [l.id, l]));
  const cardLabels = card.labelIds
    .map((labelId) => labelById.get(labelId))
    .filter((l): l is KanbanLabel => l !== undefined);
  return {
    card,
    labels: cardLabels,
    linkedNote:
      card.linkedNoteId !== null
        ? (notes.find((n) => n.id === card.linkedNoteId) ?? null)
        : null,
    checklistDone: card.checklist.filter((it) => it.done).length,
    checklistTotal: card.checklist.length,
  };
}

/** Note par id (null si absente). */
export function selectNoteById(
  state: AppState,
  id: ID | null,
): Note | null {
  if (id === null) {
    return null;
  }
  return state.data.notes.find((n) => n.id === id) ?? null;
}

/** Vrai si la recherche/filtres du board sont inactifs. */
export function selectKanbanFiltersActive(state: AppState): boolean {
  const { kanbanFilter } = state.ui;
  return (
    kanbanFilter.search.trim().length > 0 ||
    kanbanFilter.labelIds.length > 0 ||
    kanbanFilter.priorities.length > 0
  );
}
