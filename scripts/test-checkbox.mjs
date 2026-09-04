/**
 * Vérifie que les cases à cocher sont réellement cochables :
 * bascule correcte dans le Markdown source, et concordance stricte entre
 * la numérotation du rendu (marked) et celle du texte.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { marked } from 'marked';
import { transformSync } from 'esbuild';

mkdirSync('.tmp-test', { recursive: true });

// On extrait les fonctions testées sans embarquer marked/DOMPurify.
const src = readFileSync('src/lib/markdown.ts', 'utf8');
const start = src.indexOf('const TASK_LINE');
const end = src.indexOf('export function markdownToPlainText');
writeFileSync(
  '.tmp-test/task.mjs',
  transformSync(src.slice(start, end), { loader: 'ts', format: 'esm' }).code,
);
const { toggleTaskCheckbox, countTaskCheckboxes } = await import('../.tmp-test/task.mjs');

marked.setOptions({ gfm: true, breaks: false });

let fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' -> ' + detail : ''}`);
  if (!ok) fail++;
};

/* --- 1. Bascule simple --- */
check('coche une case vide',
  toggleTaskCheckbox('- [ ] A', 0) === '- [x] A',
  toggleTaskCheckbox('- [ ] A', 0));
check('decoche une case cochee',
  toggleTaskCheckbox('- [x] A', 0) === '- [ ] A');
check('accepte le X majuscule',
  toggleTaskCheckbox('- [X] A', 0) === '- [ ] A');

/* --- 2. Bonne case ciblee --- */
const md = '- [ ] A\n- [ ] B\n- [ ] C';
check('cible la 2e case',
  toggleTaskCheckbox(md, 1) === '- [ ] A\n- [x] B\n- [ ] C',
  JSON.stringify(toggleTaskCheckbox(md, 1)));
check('les autres restent intactes',
  toggleTaskCheckbox(md, 1).split('\n').filter((l) => l.includes('[x]')).length === 1);

/* --- 3. Puces et indentation variees --- */
check('puce *', toggleTaskCheckbox('* [ ] A', 0) === '* [x] A');
check('puce +', toggleTaskCheckbox('+ [ ] A', 0) === '+ [x] A');
check('sous-liste indentee',
  toggleTaskCheckbox('  - [ ] A', 0) === '  - [x] A',
  JSON.stringify(toggleTaskCheckbox('  - [ ] A', 0)));
check('liste numerotee', toggleTaskCheckbox('1. [ ] A', 0) === '1. [x] A');

/* --- 4. Le contenu de la ligne n'est pas altere --- */
const rich = '- [ ] Appeler **Marc** [lien](http://x.fr) `code`';
check('contenu preserve',
  toggleTaskCheckbox(rich, 0) === rich.replace('[ ]', '[x]'),
  toggleTaskCheckbox(rich, 0));

/* --- 5. Blocs de code ignores (piege principal) --- */
const withCode = '- [ ] Reel A\n\n```\n- [ ] Exemple dans du code\n```\n\n- [ ] Reel B';
check('bloc de code non compte', countTaskCheckboxes(withCode.split('```')[0]) === 1);
const toggled = toggleTaskCheckbox(withCode, 1);
check('case 1 = "Reel B", pas la ligne du bloc',
  toggled.includes('- [x] Reel B') && toggled.includes('- [ ] Exemple dans du code'),
  toggled.includes('- [x] Exemple dans du code') ? 'BUG: a modifie le bloc de code' : 'correct');

/* --- 6. CONCORDANCE avec le rendu : le point critique --- */
for (const sample of [
  '- [ ] A\n- [x] B\n- [ ] C',
  '- [ ] A\n\n```\n- [ ] code\n```\n\n- [ ] B',
  'Texte\n\n- [ ] A\n  - [ ] Sous-tache\n- [x] B',
]) {
  const rendered = (marked.parse(sample, { async: false }).match(/<input[^>]*type="checkbox"/g) || []).length;
  const counted = countTaskCheckboxes(sample);
  check(`concordance rendu/source (${rendered} cases)`, rendered === counted,
    `rendu=${rendered} source=${counted}`);
}

/* --- 7. Robustesse --- */
check('index hors limites sans effet', toggleTaskCheckbox('- [ ] A', 9) === '- [ ] A');
check('markdown sans case inchange', toggleTaskCheckbox('Just text', 0) === 'Just text');
check('forcage explicite a true', toggleTaskCheckbox('- [ ] A', 0, true) === '- [x] A');
check('forcage explicite a false', toggleTaskCheckbox('- [x] A', 0, false) === '- [ ] A');
check('idempotent si deja dans l etat', toggleTaskCheckbox('- [x] A', 0, true) === '- [x] A');

/* --- 8. Cablage UI --- */
const md_ = readFileSync('src/lib/markdown.ts', 'utf8');
const renderer = readFileSync('src/components/markdown/MarkdownRenderer.tsx', 'utf8');
const editor = readFileSync('src/components/notes/NoteEditor.tsx', 'utf8');
check('disabled retire au rendu', md_.includes("node.removeAttribute('disabled')"));
check('clic intercepte', renderer.includes('onClick={handleClick}'));
check('editeur branche', editor.includes('onMarkdownChange={pushHistory}'));

console.log(fail === 0 ? '\n✅ Cases à cocher fonctionnelles.' : `\n❌ ${fail} échec(s).`);
process.exit(fail === 0 ? 0 : 1);
