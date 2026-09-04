/**
 * Actions UI — navigation, sidebar, thème, toasts et réglages globaux.
 */
import type {
  AppSettings,
  EditorMode,
  ID,
  MainView,
  ThemeMode,
  Toast,
} from '@/types';
import { MAX_TOASTS } from '@/constants';
import { uid } from '@/lib/id';
import { applyTheme, persistThemePreference } from '@/lib/theme';
import type { StoreGet, StoreSet } from './types';
import { schedulePersist } from './persist';

/** Ordre du cycle de l'éditeur : écriture → aperçu → split → écriture… */
const EDITOR_MODE_ORDER: EditorMode[] = ['edit', 'preview', 'split'];

export interface UiActions {
  setView: (view: MainView) => void;
  toggleSidebar: () => void;
  setActiveCard: (id: ID | null) => void;
  setOpenColumnMenu: (id: ID | null) => void;
  toggleFolderCollapsed: (folderId: ID) => void;

  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
  updateSettings: (patch: Partial<AppSettings>) => void;
  /** Cycle le mode éditeur : edit → preview → split → edit… */
  cycleEditorMode: () => void;

  toast: (kind: Toast['kind'], message: string) => ID;
  dismissToast: (id: ID) => void;
  clearToasts: () => void;
}

export function createUiActions(set: StoreSet, get: StoreGet) {
  return {
    /* ----------------------------- Navigation --------------------------- */

    setView: (view: MainView) => {
      set((s) => ({ ui: { ...s.ui, view } }));
    },

    toggleSidebar: () => {
      set((s) => ({
        ui: { ...s.ui, sidebarCollapsed: !s.ui.sidebarCollapsed },
      }));
    },

    setActiveCard: (id: ID | null) => {
      set((s) => ({ ui: { ...s.ui, activeCardId: id } }));
    },

    setOpenColumnMenu: (id: ID | null) => {
      set((s) => ({ ui: { ...s.ui, openColumnMenuId: id } }));
    },

    toggleFolderCollapsed: (folderId: ID) => {
      set((s) => {
        const ids = s.ui.collapsedFolderIds;
        const next = ids.includes(folderId)
          ? ids.filter((i) => i !== folderId)
          : [...ids, folderId];
        return { ui: { ...s.ui, collapsedFolderIds: next } };
      });
    },

    /* ------------------------------- Thème ------------------------------ */

    setTheme: (theme: ThemeMode) => {
      set((s) => ({
        data: { ...s.data, settings: { ...s.data.settings, theme } },
      }));
      applyTheme(theme);
      persistThemePreference(theme);
      schedulePersist(set, get);
    },

    toggleTheme: () => {
      const current = get().data.settings.theme;
      const next: ThemeMode = current === 'dark' ? 'light' : 'dark';
      get().setTheme(next);
    },

    updateSettings: (patch: Partial<AppSettings>) => {
      // Un patch avec une clé undefined (ex. champ non renseigné) ne doit
      // PAS écraser la valeur existante : on ne retient que les clés définies.
      const safe: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) {
          safe[key] = value;
        }
      }
      set((s) => ({
        data: { ...s.data, settings: { ...s.data.settings, ...safe } },
      }));
      if (patch.theme !== undefined) {
        applyTheme(patch.theme);
        persistThemePreference(patch.theme);
      }
      schedulePersist(set, get);
    },

    cycleEditorMode: () => {
      const current = get().data.settings.editorMode;
      const index = EDITOR_MODE_ORDER.indexOf(current);
      const next = EDITOR_MODE_ORDER[(index + 1) % EDITOR_MODE_ORDER.length];
      get().updateSettings({ editorMode: next });
    },

    /* ------------------------------- Toasts ----------------------------- */

    toast: (kind: Toast['kind'], message: string): ID => {
      const id = uid('toast');
      set((s) => {
        const toasts = [...s.ui.toasts, { id, kind, message }];
        const trimmed =
          toasts.length > MAX_TOASTS
            ? toasts.slice(toasts.length - MAX_TOASTS)
            : toasts;
        return { ui: { ...s.ui, toasts: trimmed } };
      });
      return id;
    },

    dismissToast: (id: ID) => {
      set((s) => ({
        ui: { ...s.ui, toasts: s.ui.toasts.filter((t) => t.id !== id) },
      }));
    },

    clearToasts: () => {
      set((s) => ({ ui: { ...s.ui, toasts: [] } }));
    },
  };
}
