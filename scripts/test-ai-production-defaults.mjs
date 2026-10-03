/** Vérifie le fallback de production pour un ancien coffre aux champs IA vides. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { transformSync } from 'esbuild';

mkdirSync('.tmp-test', { recursive: true });
let constants = readFileSync('src/constants/index.ts', 'utf8')
  .replace("import.meta.env.VITE_AI_ENDPOINT ?? '/api/v1/ai'", "'/api/v1/ai'")
  .replace("import.meta.env.VITE_AI_MODEL ?? ''", "'gemma4:e4b'")
  .replace("import.meta.env.VITE_AI_EMBEDDING_MODEL ?? ''", "'qwen3-embedding:0.6b-8k'");
constants = transformSync(constants, { loader: 'ts', format: 'esm', target: 'es2022' }).code
  .replace(/from ['"]@\/types['"];?/g, ';');
writeFileSync('.tmp-test/constants.mjs', constants);

let ai = transformSync(readFileSync('src/lib/ai.ts', 'utf8'), {
  loader: 'ts', format: 'esm', target: 'es2022',
}).code
  .replace(/from ['"]@\/types['"];?/g, ';')
  .replace(/from ['"]@\/constants['"]/g, "from './constants.mjs'")
  .replace(/from ['"]@\/lib\/browser-user['"]/g, "from './browser-user.mjs'");
writeFileSync('.tmp-test/browser-user.mjs', 'export const accountFetch = (...args) => fetch(...args);');
writeFileSync('.tmp-test/ai.mjs', ai);

const { resolveAiSettings, isAiConfigured } = await import('../.tmp-test/ai.mjs');
let fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' -> ' + detail : ''}`);
  if (!ok) fail++;
};

const oldVault = resolveAiSettings({
  aiEndpoint: '', aiApiKey: '', aiModel: '', aiEmbeddingModel: '',
});
check('endpoint production authentifié repris', oldVault.aiEndpoint === '/api/v1/ai', oldVault.aiEndpoint);
check('chat Gemma 4 repris', oldVault.aiModel === 'gemma4:e4b', oldVault.aiModel);
check('embedding Qwen repris', oldVault.aiEmbeddingModel === 'qwen3-embedding:0.6b-8k', oldVault.aiEmbeddingModel);
check('IA déclarée configurée', isAiConfigured({ endpoint: oldVault.aiEndpoint, apiKey: '', model: oldVault.aiModel }));

const custom = resolveAiSettings({
  aiEndpoint: 'https://custom.test/v1', aiApiKey: 'secret',
  aiModel: 'custom-chat', aiEmbeddingModel: 'custom-embed',
});
check('endpoint personnalisé conservé', custom.aiEndpoint === 'https://custom.test/v1');
check('modèle personnalisé conservé', custom.aiModel === 'custom-chat');
check('embedding personnalisé conservé', custom.aiEmbeddingModel === 'custom-embed');
check('clé personnalisée conservée', custom.aiApiKey === 'secret');

console.log(fail === 0 ? '\n✅ Configuration IA de production effective.' : `\n❌ ${fail} échec(s).`);
process.exit(fail === 0 ? 0 : 1);
