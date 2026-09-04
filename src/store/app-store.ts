/**
 * Store applicatif (Zustand) — MansotNote
 * ----------------------------------------
 *  - `data`  : PersistedState (source de vérité, persistée) ;
 *  - `ui`    : UIState (transitoire : vue, brouillon, filtres, toasts…) ;
 *  - actions : Notes (notes.actions), Kanban (kanban.actions), UI (ui.actions) ;
 *  - bootstrap : charge l'état via l'adapter de stockage (seed au 1er
 *    lancement, récupération si corrompu — géré dans local-storage.ts).
 */
import { create } from 'zustand';
import type { AppState, PersistedState } from '@/types';
import { DEFAULT_SETTINGS, DEFAULT_UI_STATE } from '@/constants';
import { createEmptyState, createSeedState } from '@/lib/seed';
import { applyTheme } from '@/lib/theme';
import { getStorageAdapter, type StorageAdapter } from '@/storage/adapter';
import { isAppLocked } from '@/storage/auth-manager';
import { cancelPersist } from './persist';
import { createKanbanActions, type KanbanActions } from './kanban.actions';
import { createNotesActions, type NotesActions } from './notes.actions';
import { createUiActions, type UiActions } from './ui.actions';

export interface AppStore
  extends AppState,
    NotesActions,
    KanbanActions,
    UiActions {
  /** true une fois l'état chargé depuis le stockage. */
  hydrated: boolean;
  /** Adapter de stockage actif pour la session. */
  storage: StorageAdapter;
  /** Charge l'état persisté (ou le seed) dans le store. Idempotent sauf si force=true. */
  bootstrap: (force?: boolean) => Promise<void>;
  /** Réinitialise tout (état vide + colonnes par défaut) et persiste. */
  resetAll: () => Promise<void>;
}

export const useAppStore = create<AppStore>()((set, get) => {
  return {
    /* ------------------------------- État ------------------------------- */
    data: createEmptyState(),
    ui: { ...DEFAULT_UI_STATE },
    hydrated: false,
    storage: getStorageAdapter(),

    /* ---------------------------- Cycle de vie -------------------------- */

    bootstrap: async (force = false) => {
      if (get().hydrated && !force) {
        return;
      }
      try {
        const loaded = await get().storage.load();
        if (loaded !== null) {
          const mergedSettings: Record<string, unknown> = { ...DEFAULT_SETTINGS };
          for (const [key, value] of Object.entries(loaded.settings ?? {})) {
            if (value !== undefined) {
              mergedSettings[key] = value;
            }
          }
          // Une ancienne installation possède souvent les champs IA sous forme
          // de chaînes vides. En production préconfigurée, on adopte alors les
          // valeurs injectées au build, sans jamais écraser un choix non vide.
          for (const key of ['aiEndpoint', 'aiModel', 'aiEmbeddingModel'] as const) {
            const loadedValue = loaded.settings?.[key];
            const buildDefault = DEFAULT_SETTINGS[key];
            const obsoleteProductionEndpoint =
              key === 'aiEndpoint' &&
              (loadedValue === 'http://192.168.1.47:11434/v1' || loadedValue === '/ollama/v1');
            if (
              (typeof loadedValue !== 'string' || loadedValue.trim() === '' || obsoleteProductionEndpoint) &&
              typeof buildDefault === 'string' &&
              buildDefault.trim() !== ''
            ) {
              mergedSettings[key] = buildDefault;
            }
          }
          const initialView =
            typeof loaded.settings?.initialView === 'string'
              ? loaded.settings.initialView
              : DEFAULT_UI_STATE.view;

          const cleanedNotes = (loaded.notes ?? []).filter(
            (n) =>
              n.id !== 'note-welcome' &&
              n.id !== 'note-carbonara' &&
              !n.title.toLowerCase().includes('mansot') &&
              !n.title.toLowerCase().includes('carbonara') &&
              !n.title.toLowerCase().includes('pâtes') &&
              !n.title.toLowerCase().includes('pates'),
          );

          set({
            data: {
              ...loaded,
              notes: cleanedNotes,
              settings: mergedSettings as unknown as PersistedState['settings'],
            },
            ui: { ...DEFAULT_UI_STATE, view: initialView },
            hydrated: true,
          });
        } else if (!isAppLocked()) {
          // Un backend distant vide correspond à un nouvel espace utilisateur :
          // on part d'un workspace propre et on le crée immédiatement en base.
          // Le backend local historique conserve son seed de démonstration.
          const initial = get().storage.id === 'remote' ? createEmptyState() : createSeedState();
          set({ data: initial, hydrated: true });
          await get().storage.save(initial);
        }
      } catch (error) {
        console.error('[store] bootstrap en échec', error);
      }
      applyTheme(get().data.settings.theme);
    },

    resetAll: async () => {
      cancelPersist();
      const empty = createEmptyState();
      set({
        data: empty,
        ui: { ...DEFAULT_UI_STATE },
        hydrated: true,
      });
      applyTheme(empty.settings.theme);
      try {
        await get().storage.save(empty);
      } catch (error) {
        console.error('[store] resetAll : persistance en échec', error);
      }
    },

    /* ------------------------------- Actions ---------------------------- */
    ...createNotesActions(set, get),
    ...createKanbanActions(set, get),
    ...createUiActions(set, get),
  };
});

export default useAppStore;
