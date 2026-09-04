/**
 * Génération d'identifiants uniques (nanoid).
 *
 * Alphabet : alphanumérique sans caractères ambigus (0/O, 1/I/L),
 * lisible dans l'URL, les logs et les exports.
 */
import { customAlphabet } from 'nanoid';
import type { ID } from '@/types';

const ALPHABET =
  '23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';

const generate = customAlphabet(ALPHABET, 10);

/**
 * Génère un identifiant unique de 10 caractères.
 *
 * @param prefix Préfixe optionnel par type d'entité (utile pour le debug).
 */
export function uid(prefix?: string): ID {
  const raw = generate();
  return prefix === undefined ? raw : `${prefix}_${raw}`;
}

/* Raccourcis par entité — préfixes lisibles dans la base. */

export function newNoteId(): ID {
  return uid('note');
}

export function newFolderId(): ID {
  return uid('fold');
}

export function newTagId(): ID {
  return uid('tag');
}

export function newColumnId(): ID {
  return uid('col');
}

export function newCardId(): ID {
  return uid('card');
}

export function newLabelId(): ID {
  return uid('lbl');
}

export function newChecklistItemId(): ID {
  return uid('task');
}
