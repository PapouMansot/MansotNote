/**
 * Debounce générique — utilisé par la sauvegarde automatique du store.
 *
 * Un seul timer par debouncer : appeler `schedule` de nouveau avant
 * l'échéance réarme le délai (dernière écritation gagnante).
 */
export interface Debouncer {
  /** Programme `fn` après `ms` ms (remplace tout appel antérieur). */
  schedule: (fn: () => void, ms: number) => void;
  /** Annule un éventuel appel en attente. */
  cancel: () => void;
  /** true si un appel est en attente. */
  isPending: () => boolean;
}

export function createDebouncer(): Debouncer {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingFn: (() => void) | null = null;

  return {
    schedule(fn: () => void, ms: number) {
      pendingFn = fn;
      if (timer !== null) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = null;
        const fnToRun = pendingFn;
        pendingFn = null;
        if (fnToRun !== null) {
          fnToRun();
        }
      }, ms);
    },

    cancel() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      pendingFn = null;
    },

    isPending() {
      return timer !== null;
    },
  };
}
