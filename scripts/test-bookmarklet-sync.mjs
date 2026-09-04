/**
 * Vérifie la synchronisation cross-origin du favori.
 * BroadcastChannel ne traverse jamais les origines : Gmail/Slack ne peut pas
 * communiquer directement avec MansotNote sur localhost ou en production.
 */
import { readFileSync } from 'node:fs';

const source = readFileSync('src/components/tools/BookmarkletModal.tsx', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');

let fail = 0;
const check = (name, ok) => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}`);
  if (!ok) fail++;
};

check('BroadcastChannel limité à la même origine',
  source.includes("appOrigin === window.location.origin && typeof BroadcastChannel"));
check('relais cross-origin via api_relay',
  source.includes("/?action=api_relay&req="));
check('réponse vérifie origine MansotNote',
  source.includes('if(ev.origin !== appOrigin && ev.origin !== canonicalRelayOrigin) return'));
check('origine canonique dérivée de l’app, jamais arbitraire',
  source.includes("canonicalRelayOrigin = new URL(defaultAppUrl).origin"));
check('adresse HTTP obsolète corrigée automatiquement',
  source.includes("savedOrigin.indexOf('http://') === 0"));
check('relais sans session renvoie une erreur explicite',
  app.includes('isApiRelayRequest') && app.includes('Connecte-toi à MansotNote'));
check('réponse appariée par identifiant unique',
  source.includes('ev.data.id !== reqId) return'));
check('fenêtre relais unique par requête',
  source.includes("'_mn_api_relay_' + reqId"));
check('listener postMessage nettoyé',
  source.includes("window.removeEventListener('message', onRelayMessage)"));
check('popup se ferme', source.includes('popup.close()'));
check('App gère api_relay', app.includes("action === 'api_relay'"));
check('App répond à opener', app.includes('window.opener?.postMessage'));
check('Actualiser passe par callRemote',
  source.includes("callRemote('get_kanban', {}, 5000)"));
check('Actualiser remplace localCards', source.includes('localCards = res.data.cards'));
check('aucun faux succès « Kanban à jour »', !source.includes("toast('Kanban à jour')"));
check('timeout affiche une vraie erreur', source.includes('Actualisation impossible.'));

console.log(fail === 0 ? '\n✅ Synchronisation cross-origin correcte.' : `\n❌ ${fail} échec(s).`);
process.exit(fail === 0 ? 0 : 1);
