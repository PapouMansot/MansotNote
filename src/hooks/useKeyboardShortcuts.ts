/**
 * useKeyboardShortcuts — branchement global des raccourcis définis
 * dans KEYBOARD_SHORTCUTS (src/constants).
 *
 *  - `matchesShortcut` : correspondance exacte des modificateurs
 *    (`mod` = Ctrl ou ⌘, `shift`, `alt`) + touche principale ;
 *    les raccourcis sans modificateur sont ignorés dans les champs
 *    de saisie (input/textarea/select/contentEditable) ;
 *  - `useKeyboardShortcuts(handlers)` : un seul listener `keydown`
 *    global, dispatch sur l'id du raccourci. Le handler matchant
 *    reçoit l'événement APRÈS `preventDefault` (pas de double action) ;
 *  - `useAppShortcuts` : câblage par défaut des raccourcis qui ne
 *    dépendent d'aucun composant (actions store uniquement).
 *    `search.focus` et `card.new` sont branchés par les composants
 *    qui possèdent le champ de recherche / le board.
 *
 * Les handlers sont lus via une ref : l'effet ne se re-subscribe pas
 * à chaque rendu (l'objet `handlers` est généralement récréé).
 */
import { useEffect, useRef } from 'react';
import type { KeyboardShortcut } from '@/constants';
import { KEYBOARD_SHORTCUTS } from '@/constants';
import { useAppStore } from '@/store/app-store';

export type ShortcutHandler = (event: KeyboardEvent) => void;

/** Handlers indexés par id de raccourci (ex. 'note.save'). */
export type ShortcutHandlers = Partial<Record<string, ShortcutHandler>>;

/** Correspondance exacte : modificateurs attendus + touche principale. */
export function matchesShortcut(
  event: KeyboardEvent,
  shortcut: KeyboardShortcut,
): boolean {
  const main = shortcut.keys[shortcut.keys.length - 1];
  const modifiers = shortcut.keys.slice(0, -1);
  const wantsMod = modifiers.includes('mod');
  const wantsShift = modifiers.includes('shift');
  const wantsAlt = modifiers.includes('alt');

  // `mod` = Ctrl (Windows/Linux) ou ⌘ (macOS) — l'un ou l'autre suffit.
  if ((event.ctrlKey || event.metaKey) !== wantsMod) {
    return false;
  }
  if (event.shiftKey !== wantsShift) {
    return false;
  }
  if (event.altKey !== wantsAlt) {
    return false;
  }

  // Sans modificateur, ne pas intercepter la saisie dans un champ.
  if (!wantsMod) {
    const target = event.target as HTMLElement | null;
    const inField =
      target !== null &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable);
    if (inField) {
      return false;
    }
  }

  return event.key.toLowerCase() === main.toLowerCase();
}

/**
 * Brancher un handler par id de raccourci (voir KEYBOARD_SHORTCUTS).
 * Aucun des ids non branchés n'est intercepté (pas de preventDefault).
 */
export function useKeyboardShortcuts(handlers: ShortcutHandlers): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      for (const shortcut of KEYBOARD_SHORTCUTS) {
        if (!matchesShortcut(event, shortcut)) {
          continue;
        }
        const handler = handlersRef.current[shortcut.id];
        if (handler !== undefined) {
          event.preventDefault();
          handler(event);
        }
        return; // correspondance unique : on ne tente pas les suivants
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

/**
 * Câblage par défaut (actions store, sans contexte composant).
 * À appeler une seule fois (ex. dans App). Les ids restants
 * (`search.focus`, `card.new`) se branchent via `useKeyboardShortcuts`
 * là où vivent le champ et le board.
 */
export function useAppShortcuts(): void {
  useKeyboardShortcuts({
    'note.new': () => {
      useAppStore.getState().createNote();
    },
    'note.save': () => {
      void useAppStore.getState().saveDraftNow();
    },
    'editor.cycle-mode': () => {
      useAppStore.getState().cycleEditorMode();
    },
    'view.notes': () => {
      useAppStore.getState().setView('notes');
    },
    'view.kanban': () => {
      useAppStore.getState().setView('kanban');
    },
    'view.chat': () => {
      useAppStore.getState().setView('chat');
    },
    'theme.toggle': () => {
      useAppStore.getState().toggleTheme();
    },
  });
}
