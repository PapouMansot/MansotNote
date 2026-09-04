/**
 * Adaptateur localStorage — implémentation de StorageAdapter.
 *
 * Comportements :
 *  - `load()`  : installe le jeu de données d'exemple au premier
 *                lancement (aucun état), et récupère d'un état corrompu
 *                (JSON invalide ou forme inattendue) en repartant du seed ;
 *  - `save()`  : remplacement atomique de l'état, `savedAt` ressynchronisé ;
 *  - `clear()` : suppression de l'état (la prochaine `load()` recrée le seed).
 */
import type { PersistedState, StorageAdapter } from '@/types';
import { STORAGE_KEYS } from '@/constants';
import { createSeedState } from '@/lib/seed';
import {
  isAuthEnabled,
  loadEncryptedState,
  saveEncryptedState,
} from './auth-manager';

const STATE_KEY = STORAGE_KEYS.state;

/** Indique si ce navigateur possède réellement un ancien espace à migrer. */
export function hasExistingLocalWorkspace(): boolean {
  try {
    return window.localStorage.getItem(STATE_KEY) !== null ||
      window.localStorage.getItem(STORAGE_KEYS.vault) !== null;
  } catch {
    return false;
  }
}

/**
 * Validation et réparation automatique de l'état persisté.
 * Préserve les données de l'utilisateur (notes, cartes, configs) même
 * si un champ a évolué ou est manquant.
 */
function repairPersistedState(value: unknown): PersistedState | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const v = value as Record<string, unknown>;
  const seed = createSeedState();

  const notes = Array.isArray(v.notes) ? v.notes : seed.notes;
  const folders = Array.isArray(v.folders) ? v.folders : seed.folders;
  const tags = Array.isArray(v.tags) ? v.tags : seed.tags;
  const columns = Array.isArray(v.columns) ? v.columns : seed.columns;
  const cards = Array.isArray(v.cards) ? v.cards : seed.cards;
  const labels = Array.isArray(v.labels) ? v.labels : seed.labels;
  const settings =
    typeof v.settings === 'object' && v.settings !== null
      ? { ...seed.settings, ...v.settings }
      : seed.settings;

  return {
    schemaVersion: typeof v.schemaVersion === 'number' ? v.schemaVersion : seed.schemaVersion,
    savedAt: typeof v.savedAt === 'number' ? v.savedAt : Date.now(),
    seed: typeof v.seed === 'object' && v.seed !== null ? (v.seed as any) : null,
    notes,
    folders,
    tags,
    columns,
    cards,
    labels,
    settings,
  };
}

export class LocalStorageAdapter implements StorageAdapter {
  readonly id = 'local-storage' as const;

  /**
   * Sonde avec une écriture réelle : certains navigateurs (mode privé,
   * contexte restreint) acceptent `typeof localStorage` mais lèvent à
   * l'écriture.
   */
  isAvailable(): boolean {
    try {
      const probe = `${STATE_KEY}:probe`;
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Charge l'état persisté (chiffré si l'auth est active, ou en clair sinon).
   */
  async load(): Promise<PersistedState | null> {
    if (!this.isAvailable()) {
      return null;
    }

    if (isAuthEnabled()) {
      const decrypted = await loadEncryptedState();
      if (decrypted) {
        return repairPersistedState(decrypted);
      }
      // Si l'app est verrouillée, load renvoie null et l'UI affichera le déverrouillage
      return null;
    }

    const raw = window.localStorage.getItem(STATE_KEY);

    if (raw !== null) {
      try {
        const parsed: unknown = JSON.parse(raw);
        const repaired = repairPersistedState(parsed);
        if (repaired !== null) {
          return repaired;
        }
      } catch (error) {
        console.error(
          '[storage] état localStorage corrompu — chargement des données par défaut.',
          error,
        );
      }
    }

    const state = createSeedState();
    await this.save(state);
    return state;
  }

  /** Sauvegarde l'état complet (chiffré si l'auth est active, ou en clair sinon). */
  async save(state: PersistedState): Promise<void> {
    if (!this.isAvailable()) {
      throw new Error('[storage] localStorage indisponible.');
    }
    const stamped: PersistedState = { ...state, savedAt: Date.now() };

    if (isAuthEnabled()) {
      await saveEncryptedState(stamped);
      return;
    }

    window.localStorage.setItem(STATE_KEY, JSON.stringify(stamped));
  }

  /** Supprime l'état persisté (réinitialisation). */
  async clear(): Promise<void> {
    if (!this.isAvailable()) {
      return;
    }
    window.localStorage.removeItem(STATE_KEY);
    window.localStorage.removeItem(STORAGE_KEYS.vault);
  }
}

/** Fabrique de l'adaptateur localStorage. */
export function createLocalStorageAdapter(): StorageAdapter {
  return new LocalStorageAdapter();
}
