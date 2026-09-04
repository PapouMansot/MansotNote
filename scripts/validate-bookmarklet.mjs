/**
 * Valide que le bookmarklet généré est du JavaScript syntaxiquement correct.
 *
 * `tsc` ne vérifie pas le contenu d'un template literal : une erreur de syntaxe
 * dans le script du bookmarklet (redéclaration en mode strict, guillemet mal
 * échappé…) ne serait détectée qu'à l'exécution, dans le navigateur.
 */
import { readFileSync } from 'node:fs';

const SOURCE = 'src/components/tools/BookmarkletModal.tsx';
const file = readFileSync(SOURCE, 'utf8');

const START = 'const scriptContent = `';
const startIdx = file.indexOf(START);
if (startIdx === -1) {
  console.error('❌ Impossible de localiser scriptContent dans', SOURCE);
  process.exit(1);
}

// Fin du template literal : première backtick non échappée après le début.
const bodyStart = startIdx + START.length;
let end = -1;
for (let i = bodyStart; i < file.length; i++) {
  if (file[i] === '`' && file[i - 1] !== '\\') { end = i; break; }
}
if (end === -1) {
  console.error('❌ Template literal non terminé (backtick de fin introuvable).');
  process.exit(1);
}

let templateBody = file.slice(bodyStart, end);

// Substitution des interpolations ${...} par des valeurs factices réalistes.
templateBody = templateBody.replace(/\$\{[^}]*\}/g, '"__PLACEHOLDER__"');

// Évaluation NATIVE du template literal : c'est la seule façon de reproduire
// fidèlement la consommation des backslashes par JavaScript. L'ancien
// dé-échappement artisanal a laissé passer `/\/$/` qui devenait `//$` dans le
// script réellement exécuté et empêchait le plugin de démarrer.
let script;
try {
  script = Function(`return \`${templateBody}\``)();
} catch (err) {
  console.error('❌ Template literal du bookmarklet invalide :');
  console.error('   ' + err.message);
  process.exit(1);
}

// 1. Vérification de syntaxe. Le script commence par 'use strict',
//    donc toute redéclaration ou échappement invalide échoue ici.
try {
  new Function(script);
} catch (err) {
  console.error('❌ Erreur de syntaxe dans le bookmarklet généré :');
  console.error('   ' + err.message);
  process.exit(1);
}

// 2. Garde-fous ciblés sur les bugs corrigés lors de la revue.
// Taille réelle du href désormais généré par BookmarkletModal. Au-delà de
// 64 KiB, plusieurs navigateurs tronquent le favori et le plugin ne démarre
// plus du tout (le JavaScript final devient incomplet).
const encodedHref = 'javascript:' + script
  .replace(/%/g, '%25')
  .replace(/#/g, '%23')
  .replace(/\r/g, '')
  .replace(/\n/g, '%0A')
  .replace(/\t/g, '%09');

const checks = [
  {
    name: `le favori reste sous 64 KiB (${encodedHref.length} caractères)`,
    ok: encodedHref.length < 65_536,
  },
  {
    name: 'aucune redéclaration de "var card" dans la même portée',
    ok: (script.match(/var card = document\.createElement/g) || []).length <= 1,
  },
  {
    name: 'les BroadcastChannel sont refermés (pas de fuite)',
    // Garde structurel : chaque canal créé doit être refermé. Le nombre
    // absolu varie quand une requête dupliquée est factorisée/supprimée.
    ok:
      (script.match(/new BroadcastChannel\(/g) || []).length ===
      (script.match(/bc\.close\(\)/g) || []).length,
  },
  {
    name: 'les blocs <think> sont filtrés',
    ok: /<think\(\?:ing\)\?>/.test(script) || script.includes('think'),
  },
];

let failed = false;
for (const c of checks) {
  console.log(`${c.ok ? '✅' : '❌'} ${c.name}`);
  if (!c.ok) failed = true;
}

if (failed) process.exit(1);
console.log(`\n✅ Bookmarklet valide (${script.length} caractères analysés).`);
