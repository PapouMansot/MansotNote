/**
 * Types partagés des fabriques d'actions (évite d'importer les types
 * exacts de zustand, et reste compatible avec toute implémentation
 * de `set`/`get` de la forme standard).
 */
import type { AppStore } from './app-store';

// `replace` est typé `false | undefined` pour rester assignable depuis le
// `set` de zustand v5 (overloads `(…, replace?: false) | (state, replace: true)`).
export type StoreSet = (
  partial: Partial<AppStore> | ((state: AppStore) => Partial<AppStore>),
  replace?: false | undefined,
) => void;

export type StoreGet = () => AppStore;
