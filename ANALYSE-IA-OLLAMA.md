# MansotNote — Analyse IA / Ollama & mise en mémoire persistante des modèles

Date : analyse statique du dépôt `D:\Application\MansotNote` (aucun accès réseau au serveur Ollama n'a été fait).
Objectif : comprendre comment l'app parle à l'IA, puis résoudre « le modèle ne reste pas chargé » (cold start à chaque requête).

---

## 1. Cartographie du code IA

### 1.1 Point d'entrée unique côté navigateur — `src/lib/ai.ts`

| Fonction | Route appelée | Payload | Timeout |
|---|---|---|---|
| `chatComplete()` | `${normalizeEndpoint(endpoint)}/chat/completions` | `{ model, messages, temperature: 0.7, max_tokens? }` | 180 s (`AbortController`) |
| `embedTexts()` | `${...}/embeddings` (batch de 24) | `{ model, input: string[] }` | 120 s |
| `listModels()` | `${...}/models` (GET) | — | 15 s |

Points notables :

* `normalizeEndpoint()` (l.73) force un suffixe `/v\d+` → **le client ne peut physiquement pas appeler les routes natives Ollama `/api/chat` / `/api/generate` / `/api/ps`** : toute requête passe par la couche de compatibilité OpenAI.
* **Aucun champ `keep_alive`, aucun `stream`, aucun `options.num_ctx` nulle part dans le dépôt** (grep `keep_alive|OLLAMA|11434|num_ctx|stream` : 0 occurrence dans `src/`, `server/`, `deploy/`, hormis les URL). C'est la cause racine côté code.
* Repli CORS « requête simple » (l.290-306) : si le 1ᵉʳ `fetch` lève un `TypeError`, on retente en `Content-Type: text/plain` **sans l'en-tête `Authorization`**. Efficace contre LM Studio, mais cela masque une vraie panne réseau et casse silencieusement un fournisseur qui exige une clé.
* Post-traitement adapté aux modèles locaux : `stripReasoning()` (blocs `<think>` ouverts/fermés), `unwrapFences()`, refus si le modèle n'a produit que du raisonnement.
* Cache d'embeddings en mémoire, 1200 entrées, clé = FNV(endpoint, model, texte) — volatil (purge à chaque rechargement de page), donc inefficace sur plusieurs sessions.

### 1.2 Qui appelle l'IA (8 sites)

| Consommateur | Fichier | Ce qui est envoyé |
|---|---|---|
| Copilote (chat) | `src/components/ai/AiChatDrawer.tsx:298` | system = contexte workspace (10 notes + 8 cartes/colonne) **+** RAG (`CONTEXT_BUDGET` 6000 car.) + 8 tours d'historique, `temperature 0.7`, **sans `max_tokens`** |
| Génération de note | `src/components/ai/AiNoteModal.tsx:72` → `generateNote()` | 2 messages, pas de limites |
| Résumé / reformulation / traduction | `src/components/notes/NoteEditor.tsx:333` → `transformNote()` | note entière dans le prompt |
| Tâches Kanban | `src/components/kanban/AiTaskModal.tsx:67` → `generateTasksFromGoal()`, `CardModal.tsx:58` → `generateTaskChecklist()` / `generateTaskDescription()` | consignes JSON strictes |
| API distante (extensions, bookmarklet) | `src/lib/remote-api.ts:260` (action `chat`) | contexte workspace + RAG hybride |
| Bookmarklet en appel direct | `src/components/tools/BookmarkletModal.tsx:455-477` | `POST {endpoint}/chat/completions`, `temperature 0.3` |
| RAG hybride navigateur | `src/lib/retrieval.ts:241` → `embedTexts()` | **re-embed de TOUS les chunks à chaque recherche** (coût énorme, non persisté) |
| RAG serveur (pgvector) | `server/rag.ts:32-44` | `POST {OLLAMA_URL}/embeddings`, batch 24, timeout 180 s |

### 1.3 Configuration et valeurs par défaut

* `src/types/index.ts` `AppSettings` : `aiEndpoint`, `aiApiKey`, `aiModel`, `aiEmbeddingModel` (persistés dans le coffre / le workspace PG).
* `src/constants/index.ts` : injection au build via `VITE_AI_ENDPOINT`, `VITE_AI_MODEL`, `VITE_AI_EMBEDDING_MODEL` → `DEFAULT_SETTINGS` ; `AI_PRESETS` (OpenAI, OpenRouter, LM Studio, Ollama `http://localhost:11434/v1` + `llama3.1`).
* `resolveAiSettings()` (`ai.ts:24`) : un champ vide retombe sur la valeur de build, **et** l'endpoint `http://192.168.1.47:11434/v1` est considéré comme obsolète et remplacé par celui du build. Même logique dupliquée dans `src/store/app-store.ts:63-75`. → IP LAN codée en dur à 3 endroits (`ai.ts`, `app-store.ts`, `server/rag.ts`, `deploy/nginx.conf`, `compose.yaml`).
* `AiSettingsFields.tsx` : endpoint / clé / modèle (avec « Charger » → `GET /v1/models`) / modèle d'embedding. **Aucun réglage de perf** : ni `keep_alive`, ni `num_ctx`, ni `max_tokens`, ni streaming, ni « épingler le modèle ». Le composant est monté dans `AiChatDrawer` et `AiNoteModal` seulement.

### 1.4 Chaîne réseau de production (le point aveugle)

```
navigateur ──HTTPS──> nginx (container mansotnote:8793→8080)
                        ├─ /api/*     → mansotnote-api:3000   (proxy_read_timeout 120 s)
                        │                 └─ PUT /workspace → indexWorkspace() en arrière-plan
                        │                       └─ POST http://192.168.1.47:11434/v1/embeddings
                        └─ /ollama/*  → auth_request /_auth → http://192.168.1.47:11434/
                                         (proxy_read_timeout 600 s, proxy_buffering off)
```

* `compose.yaml:70` construit le front avec `VITE_AI_ENDPOINT=/ollama/v1`, `VITE_AI_MODEL=qwen3.8:9b-q6-32k`, `VITE_AI_EMBEDDING_MODEL=qwen3-embedding:0.6b-8k`.
* `compose.yaml:56` donne à l'API `OLLAMA_URL=http://192.168.1.47:11434/v1`.
* **Ollama n'est pas un service du compose** : il tourne hors stack (binaire systemd ou conteneur séparé) → la variable `OLLAMA_KEEP_ALIVE` n'est définie nulle part dans le dépôt.
* `vite.config.ts` n'a **aucun proxy** : en dev (`:5173`), l'endpoint `http://localhost:11434/v1` suppose que l'API réponde en CORS (`OLLAMA_ORIGINS`) ou déclenche le repli `text/plain`.
* Le relay `/ollama/` expose **toute** l'API Ollama (`/api/pull`, `/api/delete`, `/api/generate`, `/api/ps`, …) à toute session authentifiée — à restreindre par allowlist.

---

## 2. Diagnostic : pourquoi le modèle est déchargé

Par ordre de probabilité, à vérifier dans cet ordre.

### R1 — Défaut Ollama jamais surchargé (cause la plus probable)
`keep_alive` par défaut = **5 min** après la dernière requête, et le code ne l'envoie jamais ; `OLLAMA_KEEP_ALIVE` n'est posée nulle part côté serveur. Conséquence : toute pause > 5 min ⇒ rechargement complet (~5–15 s sur GPU pour un 9 B q6, 60–300 s si partiellement CPU) payé avant le premier token.

### R2 — Éviction croisée chat ⇄ embeddings (cause n° 2, spécifique à MansotNote)
Deux modèles résidents : `qwen3.8:9b-q6-32k` (~9–10 Go) + `qwen3-embedding:0.6b-8k` (~0.6 Go + KV).

* `OLLAMA_MAX_LOADED_MODELS` vaut **1 par défaut en setup CPU** (et l'eviction « LRU pour faire de la place » annule `keep_alive`, même `-1`).
* Chaque sauvegarde (`AUTOSAVE_DELAY_MS = 1500`) déclenche `PUT /api/workspace` → `indexWorkspace()` → `POST /v1/embeddings` (batch 24) : **une simple frappe dans une note réveille le modèle d'embedding et peut virer le modèle de chat**. Le RAG navigateur (`searchChunksHybrid`) re-embarque en plus tous les chunks à chaque question.
* Symptôme type : « le premier message du chat est très lent, les suivants aussi alors que je viens de parler ».

### R3 — Contexte sur-dimensionné / `num_ctx` par défaut
Le prompt du Copilote (workspace + 6000 car. de RAG + historique) peut dépasser la fenêtre allouée par défaut ; côté OpenAI-compat, `max_tokens` borne la sortie mais **rien ne pilote `num_ctx`**. Selon la version, Ollama tronque (les instructions JSON du Kanban disparaissent → réponses hors-format, puis fallback « parsing ligne à ligne » dans `ai.ts:512`) ou préalloue un KV énorme (→ evicted → cold start → on revient en R1/R2). Le tag `…-32k` du modèle ne suffit pas : la taille allouée est décidée à la charge.

### R4 — Perception : aucune diffusion en continu
`chatComplete` attend le JSON complet. L'utilisateur ne voit donc **ni le chargement du modèle, ni les tokens** : le « temps d'attente » additionne chargement + génération complète. Un 300-token de sortie à 15 tok/s = 20 s, plus 10 s de chargement = 30 s de spinner, alors qu'en streaming la réponse serait lisible en ~2 s.

### R5 — Timeout qui aggrave (et message trompeur)
180 s d'expiration côté chat, 120 s par batch d'embedding, 120 s côté nginx `/api/` : en cold start CPU, l'abort tire et l'utilisateur relance → chaque relance recharge à zéro. Le message d'erreur « vérifie que le modèle est bien chargé » ne dit pas comment le savoir.

### R6 — Redémarrages / swap
`mlock` non demandé, swap possible, ou `systemctl restart ollama` (deploy, mise à jour) ⇒ toute la pinning est perdue.

**Vérification en 3 commandes (la source de vérité, avant de toucher au code)**

```bash
ollama ps                      # colonne UNTIL : "5 minutes from now" ⇒ R1 confirmé ; "Forever" ⇒ keep_alive OK
curl -s localhost:11434/api/ps | jq '.models[]'   # champs selon la version : model, expire_at / expiration_at, size_vram, size
journalctl -u ollama -n 200 | egrep -i "unload|keep.?alive|parallel|ctx|memory|offload"
nvidia-smi --query-gpu=memory.used,memory.total --format=csv   # ou free -h si CPU
```

Si `UNTIL` redevient court juste après un `PUT /api/workspace`, R2 est confirmé.

---

## 3. Plan d'action serveur Linux (à faire en premier)

### 3.1 Unité systemd — `/etc/systemd/system/ollama.service.d/override.conf`

```ini
[Service]
# Modèle de chat épinglé : -1 = ne jamais décharger pour inactivité.
Environment="OLLAMA_KEEP_ALIVE=-1"
# Les deux modèles (chat + embedding) doivent pouvoir coexister, sinon evictions.
Environment="OLLAMA_MAX_LOADED_MODELS=2"
# Attention : parallel et context multiplient le KV cache (voir 3.3).
Environment="OLLAMA_NUM_PARALLEL=1"
Environment="OLLAMA_CONTEXT_LENGTH=32768"
# Réduit fortement l'empreinte KV (q8_0) ; flash-attn si supporté par le backend.
Environment="OLLAMA_FLASH_ATTENTION=1"
Environment="OLLAMA_KV_CACHE_TYPE=q8_0"
# Accès distant depuis le navigateur / le conteneur API.
Environment="OLLAMA_HOST=0.0.0.0:11434"
# En prod, seul le serveur nginx doit joindre Ollama → ne PAS mettre *.
Environment="OLLAMA_ORIGINS=http://192.168.1.47 http://localhost"
```

```bash
sudo systemctl daemon-reload && sudo systemctl restart ollama && sleep 3 && ollama ps
```

### 3.2 Préchargement + réveil périodique

```bash
# Épingler explicitement les deux modèles (keep_alive=-1 au niveau requête) :
curl -s localhost:11434/api/generate  -d '{"model":"qwen3.8:9b-q6-32k","prompt":"","keep_alive":-1}'
curl -s localhost:11434/api/embeddings -d '{"model":"qwen3-embedding:0.6b-8k","prompt":"warm","keep_alive":-1}'
```

Unité `oneshot` + timer (assure le retour après un reboot ou une eviction) :

```ini
# /etc/systemd/system/ollama-warm.service
[Unit]
Description=MansotNote: keep Ollama models warm
[Service]
Type=oneshot
ExecStart=/usr/bin/curl -sf http://127.0.0.1:11434/api/generate -d '{"model":"qwen3.8:9b-q6-32k","prompt":"hi","keep_alive":-1}'
ExecStart=/usr/bin/curl -sf http://127.0.0.1:11434/api/embeddings -d '{"model":"qwen3-embedding:0.6b-8k","prompt":"hi","keep_alive":-1}'
```

```ini
# /etc/systemd/system/ollama-warm.timer
[Unit]
[Timer]
OnBootSec=2min
OnUnitActiveSec=15min
AccuracySec=1min
[Install]
WantedBy=timers.target
```

`sudo systemctl enable --now ollama-warm.timer`. Si Ollama n'est pas installé en systemd (`screen`/`tmux`), un cron `*/15 * * * *` avec les deux `curl` donne le même résultat.

### 3.3 Si Ollama tourne en Docker

```yaml
  ollama:
    image: ollama/ollama:0.13.x          # épingler une version
    container_name: ollama
    restart: unless-stopped
    ports: ["127.0.0.1:11434:11434"]     # n'exposer que via nginx/hôte
    volumes: ["ollama_models:/root/.ollama"]
    environment:
      OLLAMA_KEEP_ALIVE: "-1"
      OLLAMA_MAX_LOADED_MODELS: "2"
      OLLAMA_NUM_PARALLEL: "1"
      OLLAMA_CONTEXT_LENGTH: "32768"
      OLLAMA_FLASH_ATTENTION: "1"
      OLLAMA_KV_CACHE_TYPE: "q8_0"
```

Puis, dans `compose.yaml`, remplacer `http://192.168.1.47:11434/v1` par `http://ollama:11434/v1` (et `OLLAMA_URL` côté API, `proxy_pass` côté nginx) : le dépôt est en `network_mode: bridge` + `links`, donc prévoir un réseau nommé si Ollama rejoint la stack.

### 3.4 Arbitrages mémoire (à décider une fois, avec les chiffres réels)

Budget : `poids (≈10 Go pour 9 B q6) + KV(32k, ×OLLAMA_NUM_PARALLEL) + poids embedding (≈0.6 Go)` par modèle, ×2 si `MAX_LOADED_MODELS=2`.

| VRAM dispo | Recommandation |
|---|---|
| ≥ 24 Go | tout épingler (`-1`, `MAX_LOADED_MODELS=2`, `32k`, `parallel=2`) |
| 16 Go | `32k` + `q8_0` + `parallel=1`, épingler chat, embedding en `keep_alive=10m` (il se recharge vite) |
| 8–12 Go | `OLLAMA_CONTEXT_LENGTH=16384`, chat épinglé, **RAG en BM25 serveur** (`aiEmbeddingModel` vide) ou embedding quantisé |
| CPU seul | accepter `keep_alive=-1` + désactiver le RAG vectoriel ; sinon 60–300 s par tour |

Pièges : `OLLAMA_KEEP_ALIVE=-1` **n'empêche pas** l'eviction par pression mémoire ; `OLLAMA_NUM_PARALLEL` et `num_ctx` multiplient le KV ; l'override d'environnement ne prend effet qu'au (re)chargement du modèle → `ollama stop <model>` ou `systemctl restart ollama` après changement ; `mlock:true` dans un Modelfile évite le swap mais fait échouer le chargement en cas de manque de RAM au lieu de dégrader.

---

## 4. Plan d'action côté code MansotNote

### P0 — `keep_alive` dans tous les payloads (30 min, sans risque)

`src/lib/ai.ts` :

```ts
/** Durée de rétention Ollama ("10m", "24h", -1 = infini). Non Ollama : inoffensif. */
export type KeepAlive = string | number;
export const OLLAMA_KEEP_ALIVE_CHAT: KeepAlive = -1;      // modèle de rédaction épinglé
export const OLLAMA_KEEP_ALIVE_EMBED: KeepAlive = '10m';  // embedding : réveil court

export function isOllamaEndpoint(endpoint: string): boolean {
  const e = asText(endpoint).toLowerCase();
  return e.includes('11434') || /(^|[/])ollama([/]|$)/.test(e);
}
```

Dans `chatComplete` (l.270) et `embedTexts` (l.135) :

```ts
const body = JSON.stringify({
  model: asText(config.model).trim(),
  messages,
  temperature: options.temperature ?? 0.7,
  ...(options.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
  ...(isOllama ? { keep_alive: keepAlive } : {}),
});
```

> ⚠️ À valider sur la version déployée : `keep_alive` est **documenté** sur `/api/chat`, `/api/generate`, `/api/embeddings`, et n'est **pas garanti** sur la route de compatibilité `/v1/chat/completions` selon les versions (beaucoup de fournisseurs OpenAI-like l'ignorent silencieusement, ce qui est inoffensif — mais cela peut ne rien faire). Test décisif : payload avec `keep_alive` → `ollama ps` doit afficher `UNTIL Forever`. Si rien ne change : passer P1.

### P1 — Route native Ollama (si `keep_alive` est ignoré en `/v1`)

Ajouter un mode natif dans `ai.ts` (l'URL de base est récupérée en retirant le `/v1` ajouté par `normalizeEndpoint`) :

```ts
/** URL « API native Ollama » à partir de n'importe quelle base (/v1 inclus ou non). */
export function ollamaNativeUrl(endpoint: string, route: 'chat' | 'embeddings' | 'ps' | 'generate'): string {
  const base = asText(endpoint).trim().replace(/\/+$/, '').replace(/\/v\d+$/, '');
  return `${base}/api/${route}`;
}
```

Payload `/api/chat` :

```json
{ "model": "qwen3.8:9b-q6-32k", "messages": [...], "stream": false,
  "keep_alive": -1, "options": { "num_ctx": 32768, "temperature": 0.7 } }
```

Lectures : réponse native = `{ message: { content, thinking? }, done, done_reason }` au lieu de `choices[0].message` → une fonction `readChatPayload(json, native)` unique à brancher dans `chatComplete`, les 8 appelants inchangés. Ajouter un `provider: 'openai' | 'ollama' | 'auto'` dans `AiConfig` (auto = `isOllamaEndpoint`) pour ne pas imposer le format natif à OpenAI/OpenRouter.

### P2 — Streaming (le vrai gain de latence perçue)

`/v1/chat/completions` avec `stream: true` renvoie du SSE `data: {...delta.content...}` ; `/api/chat` avec `stream: true` renvoie du NDJSON (`{"message":{"content":"…"},"done":false}`). Nouveau `chatStream(config, messages, onToken)` avec accumulateur + repli `chatComplete`. À câbler dans `AiChatDrawer` (le spinner actuel ne montre rien pendant la génération) et `AiNoteModal`. Bénéfice collatéral : un ping SSE pendant le chargement empêche nginx (`proxy_read_timeout 600 s`, `proxy_buffering off` — déjà corrects) de sembler mort.

### P3 — Finitions serveur Node (`server/rag.ts`)

```ts
const body = JSON.stringify({
  model: process.env.EMBEDDING_MODEL || 'qwen3-embedding:0.6b-8k',
  input: texts,
  keep_alive: process.env.OLLAMA_KEEP_ALIVE || '10m',
});
```

* **Regrouper** : batch de 24 OK ; ajouter `OLLAMA_KEEP_ALIVE=10m` dans l'env de `mansotnote-api` (`compose.yaml:49-57`).
* **Limiter les burst** : `PUT /workspace` (autosave 1,5 s) indexe en tâche de fond à chaque frappe → garder un debounce « dernière modif + 60 s » et un verrou global (le `pg_advisory_lock` par user existe déjà), sinon le modèle d'embedding est réveillé en permanence et évince le chat.
* **RAG navigateur** : `searchChunksHybrid` re-embed *tous* les chunks à chaque question (`retrieval.ts:241`) — à remplacer par le chemin serveur (pgvector) dès que l'auth est active, ou par un index persisté (IndexedDB) ; c'est aujourd'hui le plus gros gaspillage d'embeddings du projet.

### P4 — Réglages exposés (UX)

Dans `AiSettingsFields.tsx`, ajouter (uniquement visibles si `isOllamaEndpoint`, ou en section « Avancé ») : `keep_alive` (défaut « ∞ »), `num_ctx` (8192/16384/32768), `max_tokens` par défaut (ex. 2048), cases « streaming » et « API native Ollama (/api/chat) ». Bouton **« Maintenir le modèle éveillé »** = `POST /api/generate {prompt:"", keep_alive:-1}` + bouton **« État du serveur »** = `GET /api/ps` (affiche taille, `UNTIL`, VRAM/CPU). Ces deux boutons donnent à l'utilisateur la preuve visuelle que le réglage est effectif.

### P5 — Hygiène

* Retirer l'IP `192.168.1.47` codée en dur (`ai.ts:35`, `app-store.ts:67`, `rag.ts:34`, `nginx.conf:54`, `compose.yaml:56,70`) au profit d'une variable (`VITE_AI_ENDPOINT`, `OLLAMA_URL`) + d'une migration générique des anciens endpoints.
* Timeout : remonter `AbortError` en distinguant « pas de réponse du serveur (chargement ?) » (avant le 1ᵉʳ byte) de « génération interrompue » (P2) ; aligner 180 s côté client avec 600 s nginx `/ollama` et 120 s nginx `/api`.
* Allowlist nginx `/ollama/` aux seuls chemins utilisés (`/v1/chat/completions`, `/v1/embeddings`, `/v1/models`, `/api/chat`, `/api/ps`) pour ne pas exposer `/api/pull` ou `/api/delete` aux sessions.
* Dev proxy dans `vite.config.ts` (`/ollama` → `http://127.0.0.1:11434`) pour que dev et prod partagent le même chemin (et tester sans dépendre de `OLLAMA_ORIGINS`).
* Ne pas envoyer `Authorization` dans le repli `text/plain` : documenter ou conserver la clé si le serveur l'exige.

### P6 — Tests (le dépôt a déjà 20 scripts `scripts/test-*.mjs`)

```js
// scripts/test-ai-keep-alive.mjs — serveur http qui capture le corps et renvoie /api/ps
assert(body.keep_alive === -1, "keep_alive absent du payload chat");
// smoke-pass1 : ajouter « embed batch 2 + keep_alive » et « ollamaNativeUrl(…) »
```

Et un test d'intégration manuel documenté dans le README : `ollama ps` → taper une note (déclenche l'indexation) → `ollama ps` doit encore montrer le modèle de chat avec `UNTIL Forever`.

---

## 5. Ordre d'exécution proposé

1. **Ce soir, sans toucher au code** : override systemd (`OLLAMA_KEEP_ALIVE=-1`, `OLLAMA_MAX_LOADED_MODELS=2`, `OLLAMA_CONTEXT_LENGTH`, flash-attn/q8_0 si GPU serré) + `curl /api/generate keep_alive:-1` + timer de réveil → `ollama ps` pour preuve.
2. **Semaine 1 (code, faible risque)** : P0 (`keep_alive` client + `server/rag.ts`), P3 debounce d'indexation, P5 timeouts/allowlist nginx, P6 tests.
3. **Semaine 2** : P1 route native (si nécessaire) + P4 réglages exposés et boutons d'état.
4. **Ensuite** : P2 streaming (le plus gros changement, mais la vraie réponse à « j'attends »), P5 refactor des endpoints codés en dur.

Indicateur de succès à relever avant/après : délai entre l'envoi et le premier token, mesuré avec

```bash
time curl -s https://notes.mansotfamily.fr/ollama/v1/chat/completions \
  -H 'Content-Type: application/json' -b 'mansot_session=…' \
  -d '{"model":"qwen3.8:9b-q6-32k","messages":[{"role":"user","content":"ok"}]}'
```

plus `ollama ps` qui doit rester `Forever` après 30 min d'inactivité.
