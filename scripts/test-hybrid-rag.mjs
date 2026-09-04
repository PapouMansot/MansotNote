/**
 * Vérifie le RAG hybride avec un faux endpoint OpenAI-compatible :
 * URL /embeddings, batching/cache, récupération sémantique et fallback BM25.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { transformSync } from 'esbuild';

mkdirSync('.tmp-test', { recursive: true });
const transpile = (path) => transformSync(readFileSync(path, 'utf8'), {
  loader: 'ts', format: 'esm', target: 'es2022',
}).code;

// Modules réels, imports d'alias réécrits localement.
let constants = readFileSync('src/constants/index.ts', 'utf8')
  .replace("import.meta.env.VITE_AI_ENDPOINT ?? ''", "''")
  .replace("import.meta.env.VITE_AI_MODEL ?? ''", "''")
  .replace("import.meta.env.VITE_AI_EMBEDDING_MODEL ?? ''", "''");
constants = transformSync(constants, { loader: 'ts', format: 'esm', target: 'es2022' }).code
  .replace(/from ['"]@\/types['"];?/g, ';');
writeFileSync('.tmp-test/constants.mjs', constants);
let ai = transpile('src/lib/ai.ts')
  .replace(/from ['"]@\/types['"];?/g, ';')
  .replace(/from ['"]@\/constants['"]/g, "from './constants.mjs'");
writeFileSync('.tmp-test/ai.mjs', ai);
let search = transpile('src/lib/search.ts').replace(/from ['"]@\/types['"];?/g, ';');
writeFileSync('.tmp-test/search.mjs', search);
let retrieval = transpile('src/lib/retrieval.ts')
  .replace(/from ['"]@\/types['"];?/g, ';')
  .replace(/from ['"]@\/lib\/ai['"]/g, "from './ai.mjs'")
  .replace(/from ['"]@\/lib\/search['"]/g, "from './search.mjs'");
writeFileSync('.tmp-test/retrieval.mjs', retrieval);

const { embedTexts, clearEmbeddingCache } = await import('../.tmp-test/ai.mjs');
const { retrieveContextHybrid, cosineSimilarity } = await import('../.tmp-test/retrieval.mjs');

let fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' -> ' + detail : ''}`);
  if (!ok) fail++;
};

const config = { endpoint: 'http://localhost:11434/v1', apiKey: '', model: 'qwen3-embedding:0.6b-8k' };
let calls = 0;
let lastUrl = '';
let lastBody;
const originalFetch = globalThis.fetch;

// Vecteurs déterministes : le sens "automobile/voiture" partage l'axe 1,
// la cuisine l'axe 2.
const vectorFor = (text) => {
  const s = text.toLowerCase();
  if (/automobile|voiture|moteur|garage/.test(s)) return [1, 0, 0];
  if (/cuisine|tarte|pomme/.test(s)) return [0, 1, 0];
  return [0, 0, 1];
};

globalThis.fetch = async (url, init) => {
  calls++;
  lastUrl = String(url);
  lastBody = JSON.parse(String(init.body));
  return {
    ok: true,
    status: 200,
    async json() {
      return { data: lastBody.input.map((text, index) => ({ index, embedding: vectorFor(text) })) };
    },
    async text() { return ''; },
  };
};

clearEmbeddingCache();
const first = await embedTexts(config, ['voiture', 'tarte']);
check('endpoint /v1/embeddings', lastUrl === 'http://localhost:11434/v1/embeddings', lastUrl);
check('modèle envoyé', lastBody.model === 'qwen3-embedding:0.6b-8k', lastBody.model);
check('batch input envoyé', lastBody.input.length === 2);
check('vecteurs reçus', first[0][0] === 1 && first[1][1] === 1);

// Cache : deuxième appel identique, aucun fetch supplémentaire.
const beforeCache = calls;
await embedTexts(config, ['voiture', 'tarte']);
check('cache mémoire évite le réseau', calls === beforeCache, `${calls} appels`);
check('cosinus identique = 1', Math.abs(cosineSimilarity([1, 0], [1, 0]) - 1) < 1e-9);
check('cosinus orthogonal = 0', cosineSimilarity([1, 0], [0, 1]) === 0);

const note = (id, title, content) => ({
  id, title, content, folderId: null, tagIds: [], pinned: false,
  archived: false, createdAt: 1, updatedAt: 2,
});
const notes = [
  note('n-car', 'Entretien du véhicule', 'Le moteur doit être contrôlé au garage.'),
  note('n-food', 'Recette', 'Préparer une tarte aux pommes dans la cuisine.'),
];

// "automobile" n'apparaît dans aucune note : BM25 seul renverrait zéro,
// l'embedding doit retrouver le passage véhicule.
const hybrid = await retrieveContextHybrid(notes, 'automobile', { embeddingConfig: config });
check('mode hybride actif', hybrid.mode === 'hybrid', hybrid.mode);
check('recherche sémantique retrouve véhicule', hybrid.sources[0]?.noteId === 'n-car', hybrid.sources[0]?.noteId);
check('contexte cite la source', hybrid.context.includes('[1]'));

// API embeddings en panne : le RAG doit continuer en BM25.
clearEmbeddingCache();
globalThis.fetch = async () => { throw new TypeError('offline'); };
const fallback = await retrieveContextHybrid(notes, 'tarte pommes', { embeddingConfig: config });
check('fallback BM25', fallback.mode === 'bm25', fallback.mode);
check('fallback garde résultat exact', fallback.sources[0]?.noteId === 'n-food', fallback.sources[0]?.noteId);
check('erreur embedding diagnostiquée', typeof fallback.embeddingError === 'string');

globalThis.fetch = originalFetch;
console.log(fail === 0 ? '\n✅ RAG hybride fonctionnel.' : `\n❌ ${fail} échec(s).`);
process.exit(fail === 0 ? 0 : 1);
