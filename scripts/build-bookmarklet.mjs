/**
 * Génère `public/bookmarklet.js` à partir du script du BookmarkletModal.
 *
 * Le favori « chargeur » télécharge ce fichier à chaque clic : le code exécuté
 * est donc toujours la version déployée, et un correctif ne demande plus de
 * recopier le favori dans le navigateur.
 *
 * Les valeurs interpolées côté React (réglages IA, cartes) ne sont pas connues
 * ici : elles sont remplacées par des valeurs neutres. Le script les relit de
 * toute façon depuis `localStorage` (`_mn_hub_cfg`) et rafraîchit ses cartes
 * via `get_kanban`, donc rien n'est perdu.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const SOURCE = 'src/components/tools/BookmarkletModal.tsx';
const OUTPUT = 'public/bookmarklet.js';
const file = readFileSync(SOURCE, 'utf8');

const START = 'const scriptContent = `';
const startIdx = file.indexOf(START);
if (startIdx === -1) {
  console.error('❌ scriptContent introuvable dans', SOURCE);
  process.exit(1);
}

const bodyStart = startIdx + START.length;
let end = -1;
for (let i = bodyStart; i < file.length; i++) {
  if (file[i] === '`' && file[i - 1] !== '\\') { end = i; break; }
}
if (end === -1) {
  console.error('❌ Template literal non terminé.');
  process.exit(1);
}

// Chaque interpolation est remplacée par la valeur adaptée au chargement
// distant : l'adresse de l'app est déduite du script lui-même, les réglages
// proviennent de localStorage, et les cartes sont récupérées à la demande.
const REPLACEMENTS = {
  appUrl: 'document.currentScript ? new URL(document.currentScript.src).origin : location.origin',
  defaultEndpoint: '(window.__MN_ENDPOINT__ || "")',
  defaultModel: '(window.__MN_MODEL__ || "")',
  defaultApiKey: '(window.__MN_KEY__ || "")',
  tasksSnapshot: '[]',
};

let templateBody = file.slice(bodyStart, end);
templateBody = templateBody.replace(/\$\{JSON\.stringify\(([^)]*)\)\}/g, (match, expr) => {
  const key = expr.trim();
  return REPLACEMENTS[key] ?? '""';
});
templateBody = templateBody.replace(/\$\{[^}]*\}/g, '""');

let script;
try {
  script = Function(`return \`${templateBody}\``)();
} catch (err) {
  console.error('❌ Template literal invalide :', err.message);
  process.exit(1);
}

try {
  new Function(script);
} catch (err) {
  console.error('❌ Script généré syntaxiquement invalide :', err.message);
  process.exit(1);
}

mkdirSync('public', { recursive: true });
writeFileSync(OUTPUT, script, 'utf8');
console.log(`✅ ${OUTPUT} généré (${script.length} caractères).`);
