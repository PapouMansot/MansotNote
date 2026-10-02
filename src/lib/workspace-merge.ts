/**
 * Fusion entre l'onglet et le serveur après un conflit de version.
 *
 * Un bot (jeton API) peut créer, modifier ou supprimer des notes, et créer des
 * dossiers et des tags, pendant que l'onglet est ouvert. Sans fusion, la sauvegarde
 * suivante de l'onglet renverrait son ancien état et la synchro relationnelle
 * effacerait ce que le bot vient d'écrire. On compare donc, élément par élément,
 * trois versions :
 *  - base   : les ids connus lors du dernier chargement / sauvegarde réussi ;
 *  - local  : l'état de l'onglet ;
 *  - remote : l'état actuel du serveur.
 */
import type { Folder, Note, Tag } from '@/types';

type WithId = { id: string };

function mergeById<T extends WithId>(
  local: T[],
  remote: T[],
  baseIds: ReadonlySet<string>,
  pick: (mine: T, theirs: T) => T,
): T[] {
  const localIds = new Set(local.map((item) => item.id));
  const remoteById = new Map(remote.map((item) => [item.id, item]));
  const merged: T[] = [];

  for (const mine of local) {
    const theirs = remoteById.get(mine.id);
    if (theirs) {
      merged.push(pick(mine, theirs)); // présent des deux côtés
    } else if (!baseIds.has(mine.id)) {
      merged.push(mine); // créé dans l'onglet depuis la dernière synchro
    }
    // sinon : supprimé côté serveur depuis la dernière synchro
  }
  for (const theirs of remote) {
    if (!localIds.has(theirs.id) && !baseIds.has(theirs.id)) {
      merged.push(theirs); // créé côté serveur (bot) depuis la dernière synchro
    }
    // présent au serveur, absent localement mais connu : supprimé dans l'onglet
  }
  return merged;
}

/** Notes : si les deux côtés l'ont modifiée, la plus récente gagne. */
export function mergeNotes(local: Note[], remote: Note[], baseIds: ReadonlySet<string>): Note[] {
  return mergeById(local, remote, baseIds, (mine, theirs) =>
    (theirs.updatedAt ?? 0) > (mine.updatedAt ?? 0) ? theirs : mine);
}

/** Dossiers : l'organisation de l'onglet (nom, ordre) prime sur celle du serveur. */
export function mergeFolders(local: Folder[], remote: Folder[], baseIds: ReadonlySet<string>): Folder[] {
  return mergeById(local, remote, baseIds, (mine) => mine);
}

/** Tags : comme les dossiers, la version de l'onglet prime (nom, couleur). */
export function mergeTags(local: Tag[], remote: Tag[], baseIds: ReadonlySet<string>): Tag[] {
  return mergeById(local, remote, baseIds, (mine) => mine);
}

/**
 * Une note ne peut pas pointer vers un dossier qui n'existe plus (clé étrangère
 * côté serveur) : par exemple un dossier supprimé dans l'onglet pendant qu'un bot
 * y écrivait. Elle repasse alors « sans dossier » au lieu de faire échouer la sauvegarde.
 */
export function detachMissingFolders(notes: Note[], folders: Folder[]): Note[] {
  const known = new Set(folders.map((folder) => folder.id));
  return notes.map((note) => (note.folderId && !known.has(note.folderId) ? { ...note, folderId: null } : note));
}

/**
 * Applique le résultat d'une sauvegarde fusionnée au store sans perdre ce
 * que l'utilisateur a fait pendant l'aller-retour réseau.
 *  - saved   : éléments réellement enregistrés (après fusion) ;
 *  - sent    : éléments envoyés au début de la sauvegarde ;
 *  - current : éléments du store au retour de la sauvegarde.
 */
export function rebaseLocalChanges<T extends WithId>(saved: T[], sent: T[], current: T[]): T[] {
  const sentById = new Map(sent.map((item) => [item.id, item]));
  const currentById = new Map(current.map((item) => [item.id, item]));
  const result: T[] = [];
  const seen = new Set<string>();

  for (const item of saved) {
    const before = sentById.get(item.id);
    const now = currentById.get(item.id);
    if (before && !now) continue; // supprimé pendant la sauvegarde
    result.push(before && now && now !== before ? now : item); // modifié pendant la sauvegarde
    seen.add(item.id);
  }
  for (const item of current) {
    if (!seen.has(item.id) && !sentById.has(item.id)) result.push(item); // créé pendant la sauvegarde
  }
  return result;
}
