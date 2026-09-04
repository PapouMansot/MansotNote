/**
 * Vérifie la PERTINENCE du classement BM25 (pas seulement la compilation).
 * Le code TS est transpilé à la volée : on teste la vraie implémentation.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

// Transpilation TS -> JS (suppression des annotations de type via esbuild).
const { transformSync } = await import('esbuild');

function load(path) {
  const ts = readFileSync(path, 'utf8');
  return transformSync(ts, { loader: 'ts', format: 'esm' }).code;
}

mkdirSync('.tmp-test', { recursive: true });
// `retrieval.ts` importe `@/lib/search` : on réécrit vers un chemin relatif.
const search = load('src/lib/search.ts').replace(/from ['"]@\/types['"];?/g, ';');
writeFileSync('.tmp-test/search.mjs', search);
let constants = readFileSync('src/constants/index.ts', 'utf8')
  .replace("import.meta.env.VITE_AI_ENDPOINT ?? ''", "''")
  .replace("import.meta.env.VITE_AI_MODEL ?? ''", "''")
  .replace("import.meta.env.VITE_AI_EMBEDDING_MODEL ?? ''", "''");
constants = transformSync(constants, { loader: 'ts', format: 'esm' }).code
  .replace(/from ['"]@\/types['"];?/g, ';');
writeFileSync('.tmp-test/constants.mjs', constants);
const ai = load('src/lib/ai.ts')
  .replace(/from ['"]@\/types['"];?/g, ';')
  .replace(/from ['"]@\/constants['"]/g, "from './constants.mjs'");
writeFileSync('.tmp-test/ai.mjs', ai);
const retrieval = load('src/lib/retrieval.ts')
  .replace(/from ['"]@\/types['"];?/g, ';')
  .replace(/from ['"]@\/lib\/ai['"]/g, "from './ai.mjs'")
  .replace(/from ['"]@\/lib\/search['"]/g, "from './search.mjs'");
writeFileSync('.tmp-test/retrieval.mjs', retrieval);

const { chunkNote, searchChunks, buildChunks, retrieveContext, tokenize } =
  await import('../.tmp-test/retrieval.mjs');

const note = (id, title, content, tagIds = [], folderId = null) => ({
  id, title, content, tagIds, folderId, pinned: false,
  archived: false, createdAt: 0, updatedAt: 1000,
});

const notes = [
  note('n1', 'Déploiement production', `## Procédure de déploiement
Lancer la migration de la base avant le déploiement. Vérifier les sauvegardes.

## Rollback
En cas d'échec, restaurer le snapshot PostgreSQL.`, ['t-ops']),
  note('n2', 'Recette de cuisine', `## Tarte aux pommes
Mélanger la farine et le beurre. Cuire 40 minutes.`, ['t-perso']),
  note('n3', 'Notes de réunion', `## Réunion du 12 mars
Marc propose de repousser le déploiement à mardi.
Budget validé pour le serveur.`, ['t-ops']),
];

let fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' -> ' + detail : ''}`);
  if (!ok) fail++;
};

// 1. Chunking par titres
const chunks = chunkNote(notes[0]);
check('chunking par heading', chunks.length === 2, `${chunks.length} passages`);
check('heading conservé', chunks[0].heading === 'Procédure de déploiement', chunks[0].heading);
check('métadonnées propagées', chunks[0].tagIds[0] === 't-ops');

// 2. Pertinence : la bonne note doit sortir en tête
const all = buildChunks(notes);
const top = searchChunks(all, 'comment faire un rollback de la base ?', 3);
check('rollback -> bonne note', top[0]?.noteId === 'n1', top[0]?.heading);

const top2 = searchChunks(all, 'tarte pommes', 3);
check('cuisine -> bonne note', top2[0]?.noteId === 'n2', top2[0]?.heading);

// 3. Le terme rare doit primer sur le terme fréquent
const top3 = searchChunks(all, 'déploiement mardi', 3);
check('terme rare prioritaire (mardi)', top3[0]?.noteId === 'n3', top3[0]?.heading);

// 4. Filtrage par métadonnées (tags)
const opsOnly = buildChunks(notes, { tagIds: ['t-ops'] });
check('filtre tag', opsOnly.every((c) => c.tagIds.includes('t-ops')), `${opsOnly.length} passages`);
const persoHit = searchChunks(opsOnly, 'tarte pommes', 3);
check('tag exclut le hors-scope', persoHit.length === 0);

// 5. Requête sans correspondance -> aucun résultat (pas de bruit)
check('aucun faux positif', searchChunks(all, 'quantique astrophysique', 3).length === 0);

// 6. Mots vides ignorés
check('stop-words filtrés', !tokenize('le la les de des').includes('le'));

// 7. Contexte cité
const { context, sources } = retrieveContext(notes, 'rollback base', {
  tags: [{ id: 't-ops', name: 'Ops' }],
});
check('contexte cite [1]', context.includes('[1]'));
check('métadonnée tag dans le contexte', context.includes('Ops'));
check('sources retournées', sources.length > 0, `${sources.length} source(s)`);

console.log(fail === 0 ? '\n✅ Pertinence validée.' : `\n❌ ${fail} échec(s).`);
process.exit(fail === 0 ? 0 : 1);
