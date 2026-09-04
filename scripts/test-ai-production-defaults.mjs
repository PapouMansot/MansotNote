/** Vérifie le fallback de production pour un ancien coffre aux champs IA vides. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { transformSync } from 'esbuild';

mkdirSync('.tmp-test', { recursive: true });
let constants = readFileSync('src/constants/index.ts', 'utf8')
  .replace("import.meta.env.VITE_AI_ENDPOINT ?? ''", "'http://192.168.1.47:11434/v1'")
  .replace("import.meta.env.VITE_AI_MODEL ?? ''", "'qwen3.8:9b-q6-32k'")
  .replace("import.meta.env.VITE_AI_EMBEDDING_MODEL ?? ''", "'qwen3-embedding:0.6b-8k'");
constants = transformSync(constants, { loader: 'ts', format: 'esm', target: 'es2022' }).code
  .replace(/from ['"]@\/types['"];?/g, ';');
writeFileSync('.tmp-test/constants.mjs', constants);

let ai = transformSync(readFileSync('src/lib/ai.ts', 'utf8'), {
  loader: 'ts', format: 'esm', target: 'es2022',
}).code
  .replace(/from ['"]@\/types['"];?/g, ';')
  .replace(/from ['"]@\/constants['"]/g, "from './constants.mjs'");
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
check('endpoint production repris', oldVault.aiEndpoint === 'http://192.168.1.47:11434/v1', oldVault.aiEndpoint);
check('chat Qwen repris', oldVault.aiModel === 'qwen3.8:9b-q6-32k', oldVault.aiModel);
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
