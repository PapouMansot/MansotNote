/**
 * useAutosave — sauvegarde automatique de la note active.
 *
 *  - expose l'état du brouillon (`dirty`, `saveStatus`, `saveError`)
 *    pour la barre d'état de l'éditeur, et `saveNow` (Ctrl+S) ;
 *  - garantit un flush à la fermeture de la page (`pagehide` +
 *    `beforeunload`) : commit du brouillon + écriture immédiate —
 *    le backend localStorage écrit de façon synchrone, donc les
 *    modifications survivent à la fermeture du onglet même si le
 *    debounce de 1,5 s n'a pas encore expiré.
 *
 * Le scheduling débouncé lui-même est déjà fait par les actions du
 * store (schedulePersist) — ce hook ne le duplique pas.
 */
import { useEffect } from 'react';
import type { SaveStatus } from '@/types';
import { useAppStore } from '@/store/app-store';
import { flushPending } from '@/store/persist';

export interface UseAutosaveResult {
  /** true si le brouillon actif a des modifications non sauvées. */
  dirty: boolean;
  saveStatus: SaveStatus;
  saveError: string | null;
  /** Sauvegarde immédiate (commit + écriture). */
  saveNow: () => Promise<void>;
}

export function useAutosave(): UseAutosaveResult {
  const dirty = useAppStore(
    (s) => s.ui.noteDraft !== null && s.ui.noteDraft.dirty === true,
  );
  const saveStatus = useAppStore((s) => s.ui.saveStatus);
  const saveError = useAppStore((s) => s.ui.saveError);
  const saveDraftNow = useAppStore((s) => s.saveDraftNow);

  useEffect(() => {
    const flush = () => {
      const { setState, getState } = useAppStore;
      flushPending(setState, getState);
    };
    // 'pagehide' d'abord (PWA / navigation), 'beforeunload' en renfort.
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
    };
  }, []);

  return { dirty, saveStatus, saveError, saveNow: saveDraftNow };
}
