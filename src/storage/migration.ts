import type { PersistedState } from '@/types';

/** Un workspace neuf peut déjà contenir les colonnes Kanban par défaut. */
export function isWorkspaceEmpty(state: PersistedState | null): boolean {
  return state === null || (
    state.notes.length === 0 &&
    state.folders.length === 0 &&
    state.tags.length === 0 &&
    state.cards.length === 0 &&
    state.labels.length === 0
  );
}

const DEMO_NOTE_IDS = ['note-docker', 'note-idees', 'note-sql'];
const DEMO_CARD_IDS = ['card-api', 'card-docker', 'card-model', 'card-perf', 'card-readme', 'card-scaffold', 'card-sql'];
const DEMO_FOLDER_IDS = ['fold-personnel', 'fold-projets', 'fold-recettes'];
const DEMO_TAG_IDS = ['tag-apprendre', 'tag-important', 'tag-travail'];

function exactIds(items: Array<{ id: string }>, expected: string[]): boolean {
  return items.length === expected.length &&
    items.map((item) => item.id).sort().every((id, index) => id === expected[index]);
}

/** Seed de démonstration historique, à ne jamais migrer vers PostgreSQL. */
export function isLegacyDemoWorkspace(state: PersistedState | null): boolean {
  if (!state) return false;
  return exactIds(state.notes, DEMO_NOTE_IDS) &&
    exactIds(state.cards, DEMO_CARD_IDS) &&
    exactIds(state.folders, DEMO_FOLDER_IDS) &&
    exactIds(state.tags, DEMO_TAG_IDS) &&
    state.labels.length === 3;
}

export function shouldImportLocalWorkspace(remote: PersistedState | null, local: PersistedState | null): local is PersistedState {
  return isWorkspaceEmpty(remote) && local !== null && !isLegacyDemoWorkspace(local);
}
