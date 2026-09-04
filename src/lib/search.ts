/**
 * Recherche plein texte + filtres/tri des deux modules.
 *
 * Principe : recherche insensible à la casse et aux accents,
 * correspondance par tokens (TOUS les tokens du requête doivent
 * être présents) — comportement type Notion/Obsidian.
 */
import type {
  KanbanCard,
  KanbanFilterState,
  Note,
  NotesFilterState,
} from '@/types';

/** Normalise une chaîne : minuscules + accents retirés. */
export function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** Découpe la requête en tokens non vides (séparés par des espaces). */
function tokens(query: string): string[] {
  return normalize(query)
    .split(/\s+/)
    .filter(Boolean);
}

/** Vrai si la note (titre + contenu) contient tous les tokens. */
export function noteMatches(note: Note, query: string): boolean {
  const qs = tokens(query);
  if (qs.length === 0) {
    return true;
  }
  const haystack = normalize(`${note.title}\n${note.content}`);
  return qs.every((token) => haystack.includes(token));
}

/** Vrai si la carte (titre + description) contient tous les tokens. */
export function cardMatches(card: KanbanCard, query: string): boolean {
  const qs = tokens(query);
  if (qs.length === 0) {
    return true;
  }
  const haystack = normalize(`${card.title}\n${card.description}`);
  return qs.every((token) => haystack.includes(token));
}

/**
 * Filtre + trie la liste des notes.
 * Les notes épinglées sont toujours en tête, puis tri par champ/sens.
 */
export function filterAndSortNotes(
  notes: Note[],
  filter: NotesFilterState,
): Note[] {
  const filtered = notes.filter((note) => {
    const isArchived = note.archived === true;
    if (filter.archivedOnly ? !isArchived : isArchived) {
      return false;
    }
    if (!noteMatches(note, filter.search)) {
      return false;
    }
    if (filter.folderId !== 'all') {
      if (filter.folderId === 'none') {
        if (note.folderId !== null) return false;
      } else if (note.folderId !== filter.folderId) {
        return false;
      }
    }
    if (filter.tagId !== 'all' && !note.tagIds.includes(filter.tagId)) {
      return false;
    }
    if (filter.pinnedOnly && !note.pinned) {
      return false;
    }
    return true;
  });

  const dir = filter.sortDirection === 'asc' ? 1 : -1;
  filtered.sort((a, b) => {
    if (a.pinned !== b.pinned) {
      return a.pinned ? -1 : 1;
    }
    switch (filter.sortField) {
      case 'title':
        return a.title.localeCompare(b.title, 'fr') * dir;
      case 'createdAt':
        return (a.createdAt - b.createdAt) * dir;
      case 'updatedAt':
      default:
        return (a.updatedAt - b.updatedAt) * dir;
    }
  });

  return filtered;
}

/**
 * Filtre les cartes du board : recherche + étiquettes (ET) + priorités (OU).
 * L'ordre d'affichage est appliqué ensuite par colonne.
 */
export function filterCards(
  cards: KanbanCard[],
  filter: KanbanFilterState,
): KanbanCard[] {
  return cards.filter((card) => {
    const isArchived = card.archived === true;
    if (filter.showArchived ? !isArchived : isArchived) {
      return false;
    }
    if (!cardMatches(card, filter.search)) {
      return false;
    }
    if (
      filter.labelIds.length > 0 &&
      !filter.labelIds.every((labelId) => card.labelIds.includes(labelId))
    ) {
      return false;
    }
    if (
      filter.priorities.length > 0 &&
      !filter.priorities.includes(card.priority)
    ) {
      return false;
    }
    return true;
  });
}
