/**
 * Fabrique de StorageAdapter.
 *
 * L'application ne connaît que l'interface `StorageAdapter` (voir
 * src/types) : la fabrique choisit une implémentation enregistrée,
 * avec repli automatique sur localStorage si le backend demandé est
 * inconnu ou indisponible.
 *
 * Pour ajouter un backend (IndexedDB, API distante Node + SQLite),
 * écrire son fichier dans src/storage/ puis l'enregistrer dans
 * BACKENDS ci-dessous — le reste de l'application ne change pas.
 */
import type { StorageAdapter } from '@/types';
import { createLocalStorageAdapter } from '@/storage/local-storage';
import { createRemoteStorageAdapter } from '@/storage/remote-storage';

/** Backends enregistrés (clé = identifiant `StorageAdapter.id`). */
const BACKENDS: Readonly<Record<string, () => StorageAdapter>> = {
  'local-storage': createLocalStorageAdapter,
  remote: createRemoteStorageAdapter,
};

export interface CreateStorageAdapterOptions {
  /**
   * Backend souhaité. S'il n'est pas enregistré ou indisponible,
   * repli sur localStorage (avec avertissement console).
   */
  preferred?: 'local-storage' | 'indexed-db' | 'remote';
}

/**
 * Crée l'adaptateur de stockage pour la session courante.
 *
 * @throws si aucun backend n'est utilisable (contexte sans localStorage).
 */
export function createStorageAdapter(
  options: CreateStorageAdapterOptions = {},
): StorageAdapter {
  // En production le backend distant est la source de vérité. Le stockage
  // local reste disponible explicitement pour importer un ancien espace.
  const preferred = options.preferred ?? 'remote';

  const factory = BACKENDS[preferred];
  if (factory !== undefined) {
    const adapter = factory();
    if (adapter.isAvailable()) {
      return adapter;
    }
  }

  const fallback = createLocalStorageAdapter();
  if (fallback.isAvailable()) {
    if (preferred !== 'local-storage') {
      console.warn(
        `[storage] backend "${preferred}" indisponible — repli sur localStorage.`,
      );
    }
    return fallback;
  }

  throw new Error(
    '[storage] aucun backend de stockage disponible (localStorage inaccessible dans ce contexte).',
  );
}

let singleton: StorageAdapter | undefined;

/**
 * Version singleton : un adaptateur partagé par toute l'application
 * (le store l'utilise au démarrage et à chaque sauvegarde).
 */
export function getStorageAdapter(
  options?: CreateStorageAdapterOptions,
): StorageAdapter {
  if (singleton === undefined) {
    singleton = createStorageAdapter(options);
  }
  return singleton;
}

export type { StorageAdapter } from '@/types';
