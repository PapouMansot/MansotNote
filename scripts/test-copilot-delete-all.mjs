/**
 * Vérifie le bouton « supprimer toutes les cartes » du Copilote principal.
 * Le garde-fou doit fonctionner même si le modèle refuse ou oublie le bloc.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { transformSync } from 'esbuild';

const source = readFileSync('src/components/ai/AiChatDrawer.tsx', 'utf8');

// Extrait la vraie fonction de détection depuis le composant TSX.
const start = source.indexOf('export function isDeleteAllCardsRequest');
const end = source.indexOf('\n\nexport function AiChatDrawer', start);
mkdirSync('.tmp-test', { recursive: true });
writeFileSync(
  '.tmp-test/copilot-delete.mjs',
  transformSync(source.slice(start, end), { loader: 'tsx', format: 'esm' }).code,
);
const { isDeleteAllCardsRequest } = await import('../.tmp-test/copilot-delete.mjs');

let fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' -> ' + detail : ''}`);
  if (!ok) fail++;
};

/* --- 1. Formulations positives --- */
for (const phrase of [
  'delete toute les carte stp',
  'supprime toutes les cartes stp',
  'Supprimer tout le Kanban',
  'vide le kanban',
  'efface toutes les tâches',
  'clear all cards',
  'delete all cards please',
  'suppré tout le board',
]) {
  check(`détecte: ${phrase}`, isDeleteAllCardsRequest(phrase));
}

/* --- 2. Ne pas proposer une suppression globale par erreur --- */
for (const phrase of [
  'crée une carte',
  'supprime la carte projet',
  'montre toutes les cartes',
  'archive les cartes terminées',
  'delete la note réunion',
]) {
  check(`ignore: ${phrase}`, !isDeleteAllCardsRequest(phrase));
}

/* --- 3. Protocole IA + fallback déterministe --- */
check('type delete_all_cards déclaré', source.includes("| 'delete_all_cards';"));
check('system prompt documente action', source.includes('```action:delete_all_cards'));
check('parseur action présent', source.includes('action: { type: \'delete_all_cards\''));
check('fallback utilise détecteur', source.includes('isDeleteAllCardsRequest(textToSend)'));
check('fallback crée action sans modèle', source.includes("type: 'delete_all_cards' as const"));

/* --- 4. Exécution et bouton rouge --- */
check('exécution supprime chaque carte', source.includes('ids.forEach((id) => useAppStore.getState().deleteCard(id))'));
check('bouton affiche nombre cartes', source.includes('Supprimer toutes les cartes (${cards.length})'));
check('variante danger', source.includes("turn.action.type === 'delete_all_cards'"));
check('texte confirmation', source.includes('Confirmer la suppression'));
check('rien supprimé avant clic', source.indexOf("if (action.type === 'delete_all_cards')") > source.indexOf('const executeAction'));

console.log(fail === 0 ? '\n✅ Confirmation Copilote fonctionnelle.' : `\n❌ ${fail} échec(s).`);
process.exit(fail === 0 ? 0 : 1);
