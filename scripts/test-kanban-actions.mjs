/**
 * Vérifie que le Copilote peut désormais supprimer/archiver/déplacer :
 *  - les actions existent dans le protocole distant ;
 *  - le système prompt du plugin documente ces capacités ;
 *  - les regex correspondent aux balises documentées ;
 *  - les actions sont routées vers les bonnes méthodes métier.
 */
import { readFileSync } from 'node:fs';

const remote = readFileSync('src/lib/remote-api.ts', 'utf8');
const plugin = readFileSync('src/components/tools/BookmarkletModal.tsx', 'utf8');

let fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' -> ' + detail : ''}`);
  if (!ok) fail++;
};

/* --- 1. Actions dans le protocole distant --- */
for (const a of ['delete_card', 'archive_card', 'move_card', 'clear_kanban']) {
  check(`protocole: ${a}`, remote.includes(`case '${a}':`));
}
check('union de types inclut les 4',
  remote.includes("'delete_card'") && remote.includes("'archive_card'") &&
  remote.includes("'move_card'") && remote.includes("'clear_kanban'"));

/* --- 2. Routage vers les bonnes méthodes store --- */
check('delete -> deleteCard', remote.includes('state.deleteCard(cardId)'));
check('archive -> archiveCard', remote.includes('state.archiveCard(cardId)'));
check('move -> moveCard', remote.includes('state.moveCard(cardId, target, -1)'));
check('move resout la colonne', remote.includes('resolveColumnId(req.payload?.toColumnId)'));
check('clear boucle sur deleteCard', remote.includes('for (const id of allIds)'));

/* --- 3. Carte introuvable gérée --- */
check('delete verifie existence', /Carte introuvable/.test(remote));
check('3 verifications existence', (remote.match(/Carte introuvable/g) || []).length >= 3);

/* --- 4. Le systeme prompt documente les nouvelles capacites --- */
check('system: DELETE_TASK', plugin.includes('[ACTION:DELETE_TASK|idDeLaTache]'));
check('system: ARCHIVE_TASK', plugin.includes('[ACTION:ARCHIVE_TASK|idDeLaTache]'));
check('system: MOVE_TASK', plugin.includes('[ACTION:MOVE_TASK|idDeLaTache|vers:colonne_cible]'));
check('system: rappelle l id reel', plugin.includes('id réel de la tâche'));

/* --- 5. Regex des balises --- */
check('parse DELETE', plugin.includes('ACTION:DELETE_TASK\\\\|([^|\\\\]]+)'));
check('parse ARCHIVE', plugin.includes('ACTION:ARCHIVE_TASK\\\\|([^|\\\\]]+)'));
check('parse MOVE', plugin.includes('ACTION:MOVE_TASK\\\\|([^|\\\\]]+)\\\\|vers:([^|\\\\]]+)\\\\'));
check('cleanup des 4 balises',
  plugin.includes('ACTION:DELETE_TASK[^\\\\]]*') &&
  plugin.includes('ACTION:ARCHIVE_TASK[^\\\\]]*') &&
  plugin.includes('ACTION:MOVE_TASK[^\\\\]]*'));

/* --- 6. Handlers invoquent le transport --- */
check('delete -> callRemote', plugin.includes("callRemote('delete_card'"));
check('archive -> callRemote', plugin.includes("callRemote('archive_card'"));
check('move -> callRemote', plugin.includes("callRemote('move_card'"));

/* --- 9. Bouton de vidage --- */
check('boutons chat clear_kanban', plugin.includes("callRemote('clear_kanban'"));
check('bouton dans l onglet Kanban', plugin.includes('_btn_clear_kanban'));
check('CSS danger present', plugin.includes('.mn-btn-danger {'));
check('confirmation avant vidage', plugin.includes("window.confirm('Supprimer TOUTES les cartes"));

/* --- 7. Le contexte Kanban fournit l id reel --- */
check('contexte id', plugin.includes("'id:' + c.id"));

/* --- 8. addKanbanTask conserve le contrat booleen --- */
check('addKanbanTask renvoie booleen', plugin.includes('return false;') && plugin.includes('return true;'));

console.log(fail === 0 ? '\n✅ Actions de gestion Kanban completes.' : `\n❌ ${fail} échec(s).`);
process.exit(fail === 0 ? 0 : 1);