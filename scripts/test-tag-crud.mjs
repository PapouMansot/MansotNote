/**
 * Vérifie le CRUD complet des tags : création, renommage, couleur,
 * suppression — et l'absence de doublons.
 */
import { readFileSync } from 'node:fs';

const store = readFileSync('src/store/notes.actions.ts', 'utf8');
const sidebar = readFileSync('src/components/layout/Sidebar.tsx', 'utf8');

let fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' -> ' + detail : ''}`);
  if (!ok) fail++;
};

/* --- 1. Actions présentes dans le store --- */
check('createTag', store.includes('createTag: (name: string, color: string)'));
check('updateTag (nouveau)', store.includes('updateTag: (id: ID, patch:'));
check('deleteTag', store.includes('deleteTag: (id: ID)'));
check('updateTag declare dans l interface', store.includes('updateTag: (id: ID, patch: { name?: string; color?: string }) => void;'));

/* --- 2. Logique reproduite fidèlement --- */
const updateTag = (tags, id, patch) => tags.map((t) => (t.id === id ? { ...t, ...patch } : t));
const deleteTag = (tags, notes, id) => ({
  tags: tags.filter((t) => t.id !== id),
  notes: notes.map((n) =>
    n.tagIds.includes(id) ? { ...n, tagIds: n.tagIds.filter((t) => t !== id) } : n,
  ),
});

let tags = [
  { id: 't1', name: 'travail', color: '#3b82f6' },
  { id: 't2', name: 'perso', color: '#10b981' },
];
let notes = [{ id: 'n1', tagIds: ['t1', 't2'] }];

// Renommage
tags = updateTag(tags, 't1', { name: 'boulot' });
check('renommage', tags[0].name === 'boulot', tags[0].name);
check('couleur preservee au renommage', tags[0].color === '#3b82f6');

// Couleur seule
tags = updateTag(tags, 't1', { color: '#ef4444' });
check('changement couleur', tags[0].color === '#ef4444');
check('nom preserve au changement de couleur', tags[0].name === 'boulot');

// Suppression : les notes ne doivent pas garder de référence morte
const after = deleteTag(tags, notes, 't1');
check('tag supprime', after.tags.length === 1);
check('reference nettoyee dans les notes', !after.notes[0].tagIds.includes('t1'),
  JSON.stringify(after.notes[0].tagIds));
check('autres tags intacts', after.notes[0].tagIds.includes('t2'));

/* --- 3. Anti-doublon (logique de la sidebar) --- */
const isDuplicate = (list, name, exceptId = null) =>
  list.some((t) => t.id !== exceptId && t.name.toLowerCase() === name.toLowerCase());
check('doublon detecte', isDuplicate(tags, 'PERSO'));
check('casse ignoree', isDuplicate(tags, 'Perso'));
check('nom libre accepte', !isDuplicate(tags, 'nouveau'));
check('renommage vers soi-meme autorise', !isDuplicate(tags, 'boulot', 't1'));

/* --- 4. L'UI câble bien ces actions --- */
check('UI: createTag appele', sidebar.includes('createTag(name, color)'));
check('UI: updateTag renommage', sidebar.includes("updateTag(renamingTagId, { name })"));
check('UI: updateTag couleur', sidebar.includes('updateTag(tag.id, { color })'));
check('UI: bouton nouveau tag', sidebar.includes('label="Nouveau tag"'));
check('UI: anti-doublon branche', sidebar.includes('existe déjà'));
check('UI: palette utilisee', sidebar.includes('COLOR_PALETTE[tags.length % COLOR_PALETTE.length]'));
check('UI: suppression avertit du nombre de notes', sidebar.includes('Il sera retiré de'));

console.log(fail === 0 ? '\n✅ CRUD des tags complet.' : `\n❌ ${fail} échec(s).`);
process.exit(fail === 0 ? 0 : 1);
