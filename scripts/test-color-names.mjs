/**
 * Vérifie que le choix de couleur est lisible :
 * noms explicites, aucune collision de clés React, palette exhaustive.
 */
import { readFileSync } from 'node:fs';

const types = readFileSync('src/types/index.ts', 'utf8');
const sidebar = readFileSync('src/components/layout/Sidebar.tsx', 'utf8');
const menu = readFileSync('src/components/ui/Menu.tsx', 'utf8');

let fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' -> ' + detail : ''}`);
  if (!ok) fail++;
};

/* --- 1. Chaque couleur de la palette a un nom --- */
const palette = [...types.matchAll(/'(#[0-9a-f]{6})',\s*\/\//g)].map((m) => m[1]);
const namesBlock = types.slice(types.indexOf('COLOR_NAMES'));
const named = [...namesBlock.matchAll(/'(#[0-9a-f]{6})':\s*'([^']+)'/g)];
const nameMap = new Map(named.map((m) => [m[1], m[2]]));

check('palette lue', palette.length === 10, `${palette.length} couleurs`);
check('chaque couleur est nommee',
  palette.every((c) => nameMap.has(c)),
  palette.filter((c) => !nameMap.has(c)).join(', ') || 'toutes');

/* --- 2. Les noms sont distincts (sinon on retombe sur le probleme) --- */
const uniqueNames = new Set(nameMap.values());
check('noms tous distincts', uniqueNames.size === nameMap.size,
  `${uniqueNames.size}/${nameMap.size}`);
check('aucun nom generique "Couleur"',
  ![...uniqueNames].some((n) => n.toLowerCase() === 'couleur'),
  [...uniqueNames].join(', '));

/* --- 3. Plus de 10 items "Couleur" dans le menu --- */
check('menu ne repete plus "Couleur"',
  !sidebar.includes("label: color === tag.color ? `✓ ${colorName(color)}`"),
  'remplace par une grille');
check('entree unique "Changer la couleur"',
  (sidebar.match(/label: 'Changer la couleur'/g) || []).length === 1);
check('grille de pastilles presente', sidebar.includes('COLOR_PALETTE.map((color)'));
check('pastille = bouton accessible', sidebar.includes('aria-label={colorName(color)}'));
check('couleur active mise en evidence', sidebar.includes('ring-2 ring-zinc-900'));
check('palette se referme apres choix', sidebar.includes('setPaletteTagId(null)'));

/* --- 4. Bug de cle React corrige --- */
check('Menu: cle incluant l index', menu.includes('key={`${item.label}-${index}`}'),
  'libelles identiques ne collisionnent plus');

/* --- 5. Repli si couleur hors palette --- */
const colorNameFn = types.slice(types.indexOf('export function colorName'));
check('repli sur le code hex', colorNameFn.includes('?? color'));

/* --- 6. Le toast de creation annonce la couleur --- */
check('creation annonce la couleur', sidebar.includes('colorName(color).toLowerCase()'));

console.log('\nCouleurs nommees :');
for (const [hex, n] of nameMap) console.log(`  ${hex}  ${n}`);

console.log(fail === 0 ? '\n✅ Choix de couleur lisible.' : `\n❌ ${fail} échec(s).`);
process.exit(fail === 0 ? 0 : 1);
