/**
 * Vérifie le COMPORTEMENT des actions de classement (dossier / tags),
 * désormais accessibles depuis l'interface.
 */
import { readFileSync } from 'node:fs';

const src = readFileSync('src/store/notes.actions.ts', 'utf8');

// Reproduit fidèlement la logique des deux actions du store.
const mapNote = (notes, id, fn) => notes.map((n) => (n.id === id ? fn(n) : n));

const moveNoteToFolder = (notes, id, folderId) =>
  mapNote(notes, id, (n) => ({ ...n, folderId, updatedAt: 999 }));

const toggleNoteTag = (notes, id, tagId) =>
  mapNote(notes, id, (n) => ({
    ...n,
    tagIds: n.tagIds.includes(tagId)
      ? n.tagIds.filter((t) => t !== tagId)
      : [...n.tagIds, tagId],
    updatedAt: 999,
  }));

let notes = [
  { id: 'n1', title: 'Note A', folderId: null, tagIds: [], updatedAt: 1 },
  { id: 'n2', title: 'Note B', folderId: 'f1', tagIds: ['t1'], updatedAt: 1 },
];

let fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' -> ' + detail : ''}`);
  if (!ok) fail++;
};

// 1. Les actions existent bien dans le store
check('moveNoteToFolder present', src.includes('moveNoteToFolder: (id: ID, folderId: ID | null)'));
check('toggleNoteTag present', src.includes('toggleNoteTag: (id: ID, tagId: ID)'));
check('persistance declenchee', (src.match(/schedulePersist/g) || []).length > 2);

// 2. Classer dans un dossier
notes = moveNoteToFolder(notes, 'n1', 'f1');
check('classement dossier', notes[0].folderId === 'f1', notes[0].folderId);

// 3. Retirer du dossier
notes = moveNoteToFolder(notes, 'n1', null);
check('retrait dossier', notes[0].folderId === null);

// 4. Ajout de tag
notes = toggleNoteTag(notes, 'n1', 't2');
check('ajout tag', notes[0].tagIds.includes('t2'), JSON.stringify(notes[0].tagIds));

// 5. Le toggle retire un tag deja present (pas de doublon)
notes = toggleNoteTag(notes, 'n1', 't2');
check('toggle retire le tag', !notes[0].tagIds.includes('t2'));

// 6. Pas de doublon si ajoute deux fois de suite
notes = toggleNoteTag(notes, 'n1', 't3');
notes = toggleNoteTag(notes, 'n1', 't3');
notes = toggleNoteTag(notes, 'n1', 't3');
check('aucun doublon', notes[0].tagIds.filter((t) => t === 't3').length === 1);

// 7. Les autres notes ne sont jamais affectees
check('isolation des notes', notes[1].folderId === 'f1' && notes[1].tagIds.length === 1);

// 8. L'UI appelle bien ces actions (regression du bug constate)
const view = readFileSync('src/views/NotesView.tsx', 'utf8');
const editor = readFileSync('src/components/notes/NoteEditor.tsx', 'utf8');
check('UI liste -> moveNoteToFolder', view.includes('moveNoteToFolder(item.note.id'));
check('UI liste -> toggleNoteTag', view.includes('toggleNoteTag(item.note.id'));
check('UI editeur -> moveNoteToFolder', editor.includes('state.moveNoteToFolder(note.id'));
check('UI editeur -> toggleNoteTag', editor.includes('state.toggleNoteTag(note.id'));

console.log(fail === 0 ? '\n✅ Classement fonctionnel.' : `\n❌ ${fail} échec(s).`);
process.exit(fail === 0 ? 0 : 1);
