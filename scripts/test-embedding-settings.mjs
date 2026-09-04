/** Vérifie le câblage du modèle d'embedding dans les réglages persistés. */
import { readFileSync } from 'node:fs';

const types = readFileSync('src/types/index.ts', 'utf8');
const constants = readFileSync('src/constants/index.ts', 'utf8');
const fields = readFileSync('src/components/ai/AiSettingsFields.tsx', 'utf8');
const chat = readFileSync('src/components/ai/AiChatDrawer.tsx', 'utf8');
const remote = readFileSync('src/lib/remote-api.ts', 'utf8');
let fail = 0;
const check = (name, ok) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}`); if (!ok) fail++; };

check('AppSettings contient aiEmbeddingModel', types.includes('aiEmbeddingModel: string'));
check('défaut embedding injecté par le build', constants.includes('aiEmbeddingModel: BUILD_EMBEDDING_MODEL'));
check('champ UI présent', fields.includes('Modèle d’embedding pour le RAG'));
check('placeholder Qwen exact', fields.includes('qwen3-embedding:0.6b-8k'));
check('auto-détection embed', fields.includes("list.find((model) => /embed/i.test(model))"));
check('embedding exclu des modèles de chat', fields.includes("list.filter((model) => !/embed/i.test(model))"));
check('ancien modèle chat embedding remplacé', fields.includes("/embed/i.test(v.aiModel)"));
check('Copilote principal utilise hybride', chat.includes('retrieveContextHybrid(notes, textToSend'));
check('API distante utilise hybride', remote.includes('await retrieveContextHybrid(state.data.notes'));
check('modèle embedding distinct du chat', remote.includes('model: settings.aiEmbeddingModel'));
check('mode RAG visible', chat.includes("RAG {ragMode === 'hybrid' ? 'hybride' : 'BM25'}"));

console.log(fail === 0 ? '\n✅ Réglages embeddings câblés.' : `\n❌ ${fail} échec(s).`);
process.exit(fail === 0 ? 0 : 1);
