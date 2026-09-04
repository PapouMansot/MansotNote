/**
 * Persistance du store — sauvegarde immédiate + débouncée (autosave).
 *
 *  - `commitNoteDraft` : écrit le brouillon actif (si sale) dans
 *    `data.notes` — sans déclencher d'écriture stockage ;
 *  - `persistNow`      : committe le brouillon, puis écrit immédiatement,
 *    met à jour SaveStatus (saving → saved | error) dans l'UI ;
 *  - `schedulePersist` : programme une sauvegarde après le délai
 *    configuré (data.settings.autosaveDelayMs) ; un appel suivant
 *    réarme le timer ;
 *  - `flushPending`    : commit + écriture immédiate sans attendre la
 *    promesse (fermeture de page : le backend localStorage écrit de
 *    façon synchrone, l'écriture survit donc à la fermeture de l'onglet) ;
 *  - `cancelPersist`   : annule l'écriture en attente.
 *
 * Un seul debouncer est partagé (le store est un singleton).
 */
import { createDebouncer } from '@/lib/debounce';
import { isAppLocked } from '@/storage/auth-manager';
import type { StoreGet, StoreSet } from './types';

const debouncer = createDebouncer();

/**
 * Commite le brouillon actif dans `data.notes`.
 * No-op s'il n'y a pas de brouillon, qu'il est propre, ou sans id encore.
 */
export function commitNoteDraft(set: StoreSet, get: StoreGet): void {
  const draft = get().ui.noteDraft;
  if (draft === null || draft.dirty !== true || draft.noteId === null) {
    return;
  }
  const noteId = draft.noteId;
  const now = Date.now();
  set((s) => ({
    data: {
      ...s.data,
      notes: s.data.notes.map((note) =>
        note.id === noteId
          ? { ...note, title: draft.title, content: draft.content, updatedAt: now }
          : note,
      ),
    },
    ui: {
      ...s.ui,
      noteDraft: { ...draft, dirty: false, savedAt: now },
    },
  }));
}

/** Sauvegarde immédiate de l'état persisté (committe d'abord le brouillon). */
export async function persistNow(set: StoreSet, get: StoreGet): Promise<void> {
  if (!get().hydrated || (get().storage.id !== 'remote' && isAppLocked())) {
    return;
  }
  commitNoteDraft(set, get);
  const { storage, data, ui } = get();
  set({ ui: { ...ui, saveStatus: 'saving', saveError: null } });
  try {
    await storage.save(data);
    const after = get();
    set({
      data: { ...after.data, savedAt: Date.now() },
      ui: { ...after.ui, saveStatus: 'saved', saveError: null },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const after = get();
    set({ ui: { ...after.ui, saveStatus: 'error', saveError: message } });
  }
}

/**
 * Programme la sauvegarde automatique.
 * Sans effet si l'autosave est désactivé ou qu'une écriture est en cours.
 */
export function schedulePersist(set: StoreSet, get: StoreGet): void {
  if (!get().hydrated || (get().storage.id !== 'remote' && isAppLocked())) {
    return;
  }
  const { data, ui } = get();
  if (!data.settings.autosaveEnabled) {
    return;
  }
  if (ui.saveStatus === 'saving') {
    return;
  }
  debouncer.schedule(() => {
    void persistNow(set, get);
  }, data.settings.autosaveDelayMs);
}

/**
 * Flush forcé (fermeture de page) : committe le brouillon et lance
 * l'écriture sans attendre — voir l'en-tête pour le contrat synchrone.
 */
export function flushPending(set: StoreSet, get: StoreGet): void {
  commitNoteDraft(set, get);
  void persistNow(set, get);
}

/** Annule la sauvegarde en attente (ex. avant une écriture forcée). */
export function cancelPersist(): void {
  debouncer.cancel();
}
