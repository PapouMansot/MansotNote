# MansotNote Web Clipper — Extension de navigateur Manifest V3

> Document de conception (analyse de l'existant + architecture cible + plan).
> Périmètre : Chrome, Edge, Brave, Firefox. Remplace le bookmarklet
> « Copilote Actif ».
>
> Fichiers analysés : `scripts/build-bookmarklet.mjs`,
> `scripts/validate-bookmarklet.mjs`, `src/components/tools/BookmarkletModal.tsx`,
> `public/bookmarklet.js`, `src/lib/remote-api.ts`, `src/App.tsx`,
> `server/index.ts`, `server/security.ts`, `server/migrations/001_initial.sql`,
> `src/storage/{adapter,remote-storage,auth-manager}.ts`, `src/store/{persist,app-store}.ts`,
> `deploy/nginx.conf`, `deploy/security-headers.conf`, `compose.yaml`.

---

## 1. Résumé exécutif

| Constat | Conséquence |
|---|---|
| **Il n'existe aucune API distante d'écriture.** `server/index.ts` n'expose que `/auth/*`, `/workspace` (blob JSONB entier) et `/rag/search`. | Le « backend » du bookmarklet est en réalité **un onglet MansotNote ouvert** : `src/lib/remote-api.ts` exécute les mutations dans le store Zustand du navigateur. |
| Le bookmarklet (47 Ko, `public/bookmarklet.js`) s'injecte **dans la page tierce** et y construit son UI (`innerHTML` + Shadow DOM). | Mort sur tout site qui applique une CSP `script-src` stricte, ou `require-trusted-types-for 'script'` (GitHub, Notion, X, Medium…). **C'est la cause n°1 de la panne.** |
| Transport cross-origin = `window.open(relay)` + `postMessage` + `?action=api_relay&req=` | Popup bloquées, redirection HTTP→HTTPS qui casse `event.source`, contenu et **secret maître transitant dans l'URL** (historique, logs nginx, referrer). |
| `verifyRemoteKey()` accepte une clé vide dès que l'onglet est déverrouillé, et le pont `BroadcastChannel('mansotnote_remote_api')` est ouvert à **tout script de l'origine MansotNote**. | Pont non authentifié en usage courant → surface XSS/CSRF à corriger de toute façon. |
| Cookie de session `httpOnly`, `SameSite=Strict`. | Une extension (origine `chrome-extension://`) **ne peut pas** réutiliser la session : il faut un jeton d'API dédié. |

**Décision structurante** : l'extension ne doit **jamais** dépendre d'un onglet MansotNote ouvert.
Elle parle au **serveur** via une **API REST dédiée + Bearer token**, et l'UI est **native**
(popup / side panel / menus contextuels / page d'options) — aucune injection dans le DOM des sites.

---

## 2. Fonctionnement actuel (état des lieux)

### 2.1 Chaîne de génération du bookmarklet

```
src/components/tools/BookmarkletModal.tsx
   └─ const scriptContent = `…1151 lignes de JS vanilla dans un template literal…`
        ├─ scripts/validate-bookmarklet.mjs   → découpe le template, évalue, new Function(), checks
        └─ scripts/build-bookmarklet.mjs      → découpe + remplace les ${} par des valeurs neutres
                                              → public/bookmarklet.js (47 296 octets, 916 lignes)
```

- Extraction par `indexOf('const scriptContent = \`')` + recherche de la backtick non échappée,
  puis substitution **par regex** des interpolations (`REPLACEMENTS`), puis `Function()` + `new Function()`.
- Aucun bundler, aucun tree-shaking, aucun source map, aucune vérification de typage :
  `tsc` ne regarde pas l'intérieur d'un template literal (d'où le script `validate-*` maison).
- Deux favories livrés : le **script complet** embarqué dans le `href` (limité à 64 Ko par les
  navigateurs — d'où `encodeBookmarklet()` qui n'encode que `% # \r \n \t`), et le **« chargeur »**
  qui télécharge `<appUrl>/bookmarklet.js` via `document.createElement('script')`.

### 2.2 Les deux transports « API »

| Transport | Portée | Utilisé par |
|---|---|---|
| `BroadcastChannel('mansotnote_remote_api')` | **même origine uniquement** (règle du standard) | exécution du bookmarklet depuis l'onglet MansotNote lui-même (cas quasi inexistant en pratique) |
| `window.open('<app>/?action=api_relay&req=<JSON>')` + `postMessage` | cross-origin | tous les autres cas (Gmail, GitHub, n'importe quel site) |
| `<app>/?action=new_note&title=…&content=…` (`window.open`, GET) | cross-origin | envoi d'une note depuis le panneau Note (ligne 753‑759) |

Côté app (`App.tsx:107‑146`) : lecture des query params après `hydrated && !locked`,
appel de `handleRemoteApiRequest()`, réponse à `window.opener` puis `window.close()` après 300 ms.

### 2.3 Où vivent réellement les mutations

`handleRemoteApiRequest()` (`remote-api.ts:162`) → actions du store Zustand
(`createNote`, `createCard`, `moveCard`, `deleteCard`, `archiveCard`, `clearKanban`)
→ `schedulePersist()` → `RemoteStorageAdapter.save()` → **`PUT /workspace` du blob JSONB entier**
avec verrouillage optimiste (`expectedVersion`, 409 en cas de conflit).

Autrement dit : *l'API d'écriture distante, c'est un onglet du navigateur de l'utilisateur*.
Le serveur ne sait pas créer une note ni une carte.

### 2.4 Ce qui est déjà bien (à conserver)

- Le **contrat d'actions** (`ping`, `chat`, `create_note`, `create_card`, `get_kanban`, `get_notes`,
  `move_card`, `archive_card`, `delete_card`, `clear_kanban`) est cohérent : c'est le bon vocabulaire
  pour l'API REST à créer.
- `resolveColumnId()` (`remote-api.ts:106`) gère déjà les alias logiques (`todo`, `in_progress`,
  `done`, `backlog`) → vrais ids de colonnes. **À déplacer dans un paquet partagé**, c'est pile ce
  dont l'extension aura besoin pour son sélecteur de colonne.
- Le pipeline Markdown→HTML est déjà sécurisé (`marked` + **DOMPurify**, `src/lib/markdown.ts`) :
  le contenu clippé, non fiable par nature, est déjà Sanitisé à l'affichage.
- Les types (`src/types/index.ts`) sont une source unique propre → base idéale d'un
  `packages/shared` consommé par l'app, le serveur **et** l'extension.

---

## 3. Pourquoi le bookmarklet échoue (matrice technique)

| # | Mécanisme de blocage | Où ça casse dans le code actuel | Sites touchés |
|---|---|---|---|
| 1 | **CSP de la page hôte**, directive `script-src` : le bookmarklet `javascript:` lui-même est évalué hors CSP, **mais** toute *charge de ressource* déclenchée depuis la page est soumise à la CSP de la page. Le chargeur fait `s.src = '<app>/bookmarklet.js'`. | `BookmarkletModal.tsx:985‑988` | GitHub, Notion, X, Medium, LinkedIn (CSP `script-src` avec nonces/hashes, ou `default-src 'self'`) |
| 2 | **Trusted Types** (`require-trusted-types-for 'script'`) : tout `innerHTML = …` dans le monde principal lève un `TypeError`. | `win.innerHTML = [...]` (l.137), `box.innerHTML = html` (l.289), `aiDiv.innerHTML = renderMd(...)` (l.809) | GitHub, X, environnements d'entreprise |
| 3 | **CSP `connect-src`** : `fetch()` vers un endpoint externe (OpenAI/Ollama) depuis la page. | `executeAi()` `fetch(ep, …)` (l.477) | la plupart des sites « sérieux » |
| 4 | **Mixed content** : page HTTPS → `http://127.0.0.1:3080` ou `http://192.168.1.47:8793` bloqué (script, fetch, navigation de popup active). | contourné « maison » par la réécriture HTTP→HTTPS (l.66‑74) ; un dev local en HTTP clair reste mort depuis un site HTTPS | tous les sites HTTPS, instance locale |
| 5 | **Bloqueur de popups / user activation** : `window.open()` n'est autorisé que de façon synchrone dans le geste utilisateur. Dès qu'un `await` le précède, l'activation est perdue. | `callRemote()` (l.536) — message d'erreur déjà écrit pour ce cas : *« Fenêtre relais bloquée par le navigateur. »* | tous les navigateurs, profils avec protections renforcées |
| 6 | **postMessage fragile** : `event.source` devient caduc après redirection/rechargement de la fenêtre relais ; `targetOrigin:'*'` côté app ; réponse perdue si l'app affiche l'écran de login (session absente ou cookie `SameSite=Strict` non joint à la navigation cross-site). | l.549‑560, `App.tsx:131`, `App.tsx:176‑187` | production HTTPS + instance locale en // |
| 7 | **URL trop longue** : une page entière en Markdown passe par la query string (`?action=new_note&content=…`) → limites pratiques de taille, et **fuite dans l'historique / logs serveur / `Referer`**. | `BookmarkletModal.tsx:753‑758` | structurel |
| 8 | **Configuration par origine** : `localStorage['_mn_hub_cfg']` (URL app, clé API IA, **mot de passe maître**) est stocké… dans l'origine du site où l'on clique. Config recréée pour chaque site, et lisible par tout XSS de *n'importe quel* site. | l.60, l.72 | structurel |
| 9 | **Pages interdites** : `chrome://`, `about:`, `view-source:`, Web Store, visionneuse PDF, iframe `sandbox`. | tout le script (`document.getElementById`, `document.body.appendChild`) | natifs du navigateur |
| 10 | **Omnibox** : Chrome/Firefox suppriment le préfixe `javascript:` au collage → impossible de créer le favori en collant le code copié par « Copier le code » ; seul le glisser-déposer marche. | `copyBookmarklet()` (l.1000) | tous les navigateurs modernes |
| 11 | **Conflits d'UI** : `z-index: 2147483647` + Shadow DOM sur des pages qui en font autant, `backdrop-filter`, scroll traps, SPA qui re-render. | tout le CSS injecté | SPAs riches |
| 12 | **Fonctionnalités impossibles** : pas de raccourci clavier global, pas de menu contextuel, pas de persistance offline, pas d'icône d'état, pas de permissions fines, pas de mise à jour silencieuse (le « chargeur » est précisément ce que la CSP bloque). | — | — |

> **Diagnostic** : les points 1 et 2 expliquent à eux seuls « ça ne fonctionne pas sur
> GitHub/Notion/X/Medium ». Le bookmarklet complet (47 Ko inline) peut encore démarrer là où le
> chargeur échoue, mais il meurt au premier `innerHTML` sous Trusted Types, et son transport
> reste bloqué aux points 4‑7.

> **Précision normative (à confirmer par le spike de phase 0).** L'évaluation initiale d'une URL
> `javascript:` déclenchée par l'utilisateur échappe généralement à la `script-src` de la page —
> c'est pourquoi des bookmarklets entièrement autonomes fonctionnent encore sur beaucoup de sites.
> En revanche, **toute ressource chargée ou tout DOM modifié depuis le monde principal de la page
> y reste soumis** : injection de `<script src>` (point 1), `innerHTML` sous Trusted Types (point 2),
> `fetch` sous `connect-src` (point 3). Le cas d'usage de MansotNote combine les trois, d'où l'échec.
> Par sécurité, l'architecture cible **ne repose sur aucune de ces zones grises** : le code
> d'extraction est injecté par l'extension (monde isolé, ressource `chrome-extension://`, hors CSP
> de la page) et l'UI est rendue hors de la page. Le spike de phase 0 consigne les résultats
> réels par site (GitHub, Notion, X, Medium, Cloudflare-gated) dans `docs/`, plutôt que de les
> supposer.
> Règle conservatrice appliquée partout : **jamais `innerHTML` avec du contenu issu de la page**
> — `textContent`, `createElement`, et `DOMPurify` côté document de l'extension uniquement.
> Les mondes isolés échappent à `script-src`/`connect-src` de la page, mais l'application de
> **Trusted Types aux scripts de contenu a varié selon les versions de Chrome** : le spike de
> phase 0 le vérifie explicitement (une fixture avec `require-trusted-types-for 'script'`), et
> de toute façon l'implémentation n'utilise aucun sink de chaîne non typée.



### 3.1 Ce que le navigateur *n'autorise pas* non plus côté extension (à intégrer au design)

- **`frame-ancestors 'none'`** + `X-Frame-Options: SAMEORIGIN` de MansotNote
  (`deploy/security-headers.conf:7,9`) → **impossible d'afficher MansotNote dans un `<iframe>`
  du side panel**. L'UI du clipper doit être **native** (HTML de l'extension). C'est un choix,
  pas une régression : aucune dépendance au DOM de l'app.
- **`connect-src 'self'`** de la page app (même fichier) → l'onglet MansotNote ne peut pas
  servir d'agrégateur réseau vers une origine tierce arbitraire. (Le relais Ollama est déjà
  proxifié same-origin par nginx : `/ollama/`.)
- **`sameSite: 'strict'` + `httpOnly`** du cookie (`server/index.ts:111`) → une extension ne peut
  pas s'authentifier par cookie. **Il faut un Bearer token.**

---

### 3.2 Cause racine probable côté *transport* (à trancher par le diagnostic de phase 0)

Le bookmarklet a deux portes d'entrée vers MansotNote, et **toutes deux sont structurellement
fragiles en production HTTPS** :

1. `BroadcastChannel('mansotnote_remote_api')` n'est utilisable que si `appOrigin ===
   window.location.origin` (`BookmarkletModal.tsx:507`). Depuis n'importe quel site, la condition est
   **toujours fausse** : ce chemin n'est jamais pris. (Il ne l'est que si l'on clique le favori
   *dans* l'onglet MansotNote.)
2. Le relais `window.open('<app>/?action=api_relay&req=…')` ouvre une **navigation cross-site** vers
   l'app. Or le cookie `mansot_session` est `SameSite=Strict` (`server/index.ts:111`) : il n'est **pas
   attaché** à cette navigation. La fenêtre relais se retrouve donc sans session →
   `getServerSession()` échoue → la branche `!serverUser` de `App.tsx:173‑187` répond
   « Connecte-toi à MansotNote dans ce navigateur pour utiliser le Kanban. » et le bookmarklet
   affiche exactement ce message d'échec, y compris pour un utilisateur pourtant connecté.

**Vérification en 2 minutes** : `scripts/e2e-relay-check.mjs` rejoue ce scénario dans Chrome (page
tierce → popup relais). Le faire tourner contre l'instance de prod ; si `succes` est `false` avec
l'erreur ci-dessus, l'hypothèse est confirmée. Test complémentaire : passer temporairement le cookie
en `sameSite: 'lax'` et relancer le même script.

Même cause pour le bouton « 🚀 Envoyer vers MansotNote » du panneau Note
(`BookmarkletModal.tsx:753‑759`, `?action=new_note`) : la popup ouverte depuis un site tiers
transporte le `?key=` **sans** le cookie, donc arrive sur l'écran de connexion — et le toast
« Note envoyée à MansotNote ! » est affiché de façon purement optimistique (`window.open` ne renvoie
aucune confirmation). C'est cohérent avec le symptôme « ça ne fonctionne pas, sans message d'erreur ».

**Conséquence pour le design** : il ne faut surtout **pas** « réparer » cela en passant le cookie en
`Lax` et en exposant `api_relay` à des origines arbitraires — ce serait ouvrir la fuite décrite en
§4.4 (tout site pourrait lire le Kanban via la fenêtre relais). La bonne réponse est de sortir
l'authentification du navigateur (jeton Bearer, §9.4) et de supprimer ce transport.

---

## 4. Constats de sécurité (indépendants de la migration)

À traiter même si l'extension arrive — le bookmarklet actuel les expose toutes.

1. **Le mot de passe maître / la clé de secours transite en clair** dans `?req=` et `?key=`
   (URL de la fenêtre relais) → historique, journaux nginx, et éventuel `Referer`.
2. **`verifyRemoteKey('') === true` dès que l'onglet est déverrouillé** (`remote-api.ts:67‑69`) :
   le pont n'est pas authentifié dans le cas d'usage normal.
3. **`BroadcastChannel('mansotnote_remote_api')` est une API publique de l'origine** :
   n'importe quel script exécuté sur l'origine MansotNote (XSS, dépendance compromise) peut lire/écrire
   notes et cartes *et* piloter l'IA (exfiltration du contexte de workspace + RAG).
   Aggravé par `script-src 'unsafe-inline'` dans la CSP de l'app.
4. **`App.tsx:131` répond à `window.opener` avec `targetOrigin: '*'`** sans whitelist d'origine
   appelante : toute page qui réussit à ouvrir la fenêtre relais obtient la réponse.
   Mitigé *en pratique* par le cookie `SameSite=Strict` (la fenêtre relais n'est pas authentifiée),
   mais c'est une dépendance implicite fragile.
5. **`clear_kanban`** est un point d'effacement total accessible via le pont, sans confirmation
   ni portée restreinte.
6. **Saisie du mot de passe maître dans un champ injecté dans une page tierce** : appât de phishing
   parfait (« colle ton mot de passe ici, sur ton écran, sur n'importe quel site »).

**Corrections apportées par la cible** : jeton d'API scoped + révocable, transport HTTPS sans
secret dans l'URL, UI hors page, et suppression du pont `api_relay`/`BroadcastChannel` (ou sa
réduction à `new_note` avec whitelist d'origines + confirmation utilisateur).

---

## 5. Architecture cible

### 5.1 Principes directeurs

1. **L'extension parle au serveur, jamais à un onglet.** Tout ce qui dépend d'un onglet ouvert,
   déverrouillé et non bloqué par une popup est structurellement fragile.
2. **Aucune UI injectée dans les pages.** Popup, side panel, options, menus, notifications :
   tout est rendu dans des documents de l'extension, hors CSP de la page, avec la CSP stricte MV3
   (`script-src 'self'`). Fini les 1 200 lignes de CSS dans un template literal.
3. **Le réseau vit dans le contexte extension** (service worker / popup / options), **jamais dans le
   content script** : c'est ce qui neutralise `connect-src`, mixed content, CORS de la page hôte.
4. **Extraction en monde isolé** (`chrome.scripting` / content script) : les scripts de contenu ne
   sont pas soumis à la CSP de la page, et n'ont pas besoin d'injection inline → immune aux points 1‑3.
5. **Source unique de vérité inchangée** : l'onglet MansotNote reste *l'unique rédacteur* du blob
   `workspaces.state`. L'extension dépose dans une **boîte d'arrivée (inbox)** ; l'app la draine.
   Zéro conflit d'optimistic-lock, zéro risque d'écrasement de données.
6. **Offline-first et idempotent** : file d'attente locale + `Idempotency-Key`, badge d'état,
   relances par alarmes.
7. **Build reproductible, deux manifestes** (chrome / firefox) depuis une source unique,
   sans `eval` (interdit par la CSP MV3).

### 5.2 Flux cible

```
┌───────────────────────────── Site tiers (GitHub / Notion / X / Medium…) ─────────────────────────┐
│                                                                                                  │
│  [monde isolé] content-script clipper.js                                                         │
│    · window.getSelection() → texte + HTML fragment                                               │
│    · document.documentElement.outerHTML → Readability (article, byline, site, date, photo)       │
│    · métadonnées : title, canonical, og:/twitter:, JSON-LD, favicon, lang, meta author           │
│    · Turndown (+ GFM) → Markdown                                                                 │
│    · renvoie { markdown, html, text, meta }  ← JAMAIS de fetch ici                               │
│                         │                                                                        │
└─────────────────────────┼────────────────────────────────────────────────────────────────────────┘
                          │ chrome.runtime.sendMessage / scripting.executeScript
                          ▼
        ┌────────────── Service Worker (MV3) ──────────────┐
        │ router · file d'attente offline · badge · alarms │
        │ idempotency · retry/backoff · contexte onglet    │
        └───────────┬──────────────────────────────────────┘
                    │ fetch(https://instance/api/v1/…)   Bearer msn_pat_…   ← pas de CSP page,
                    ▼                                     pas de cookie requis   pas de mixed content
   ┌───────────────────────────── server/index.ts (+ routes/clips.ts) ─────────────────────────────┐
   │ POST /api/v1/clips            201 {clipId, status:'pending'}                                   │
   │ GET  /api/v1/clips?status=…   file d'attente                                                   │
   │ POST /api/v1/clips/:id/ack    marquage appliqué                                                │
   │ GET  /api/v1/destinations     colonnes + alias logiques (resolveColumnId partagé)              │
   │ POST /api/v1/tokens …         cycle de vie des jetons (auth cookie, côté app)                 │
   └───────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                   │ workspaces.state (JSONB) + api_tokens + clips
                                                   ▼
                          Onglet MansotNote (si ouvert) : sonde / dépose
                          → createNote()/createCard() du store → autosave PUT /workspace
                          → notification « 3 clippings importés » + `chrome.tabs.sendMessage`
```

**Résolution du problème de concurrence** (crucial) : le serveur ne fusionne pas dans le blob tant
qu'un client est susceptible d'écraser la version. Deux modes, selon la configuration :

| Mode | Quand | Comportement |
|---|---|---|
| **A — Inbox drainée par le client** *(défaut, sans risque)* | toujours disponible | `POST /clips` écrit dans la table `clips`. L'app (onglet ouvert ou prochain chargement) les lit et les applique via les actions du store, puis `ack`. Aucune écriture concurrente du blob. |
| **B — Fusion serveur directe** *(option, « je clippe sans ouvrir MansotNote »)* | workspace non chiffré (mode remote) et aucune session active récente | `POST /clips?apply=direct` charge le blob `FOR UPDATE`, ajoute la note/carte, incrémente `version`. L'app doit alors gérer le 409 par un **rebase** (voir §12.3), sinon elle écraserait le clipping à sa prochaine autosave. |

Le mode A est le chemin par défaut ; le mode B est une optimisation de phase 2, activable par
jeton scope `clip:apply` et conditionné par l'absence d'écriture client de moins de 60 s
(`last_seen_at` du workspace).

---

## 6. Arborescence

Choix : **`packages/extension/`** (et `packages/shared/`) dans le dépôt existant, activé en vrai
workspace pnpm (`pnpm-workspace.yaml` ne contient aujourd'hui que `allowBuilds`).
L'app garde son bundling Vite inchangé ; l'extension a son propre `vite.config.ts`
multi-entrées, et réutilise `packages/shared` (zod + types).

```
packages/
├── shared/                              # contrat commun app ↔ serveur ↔ extension
│   ├── package.json                     #   "mansotnote-shared", exports "." + "./schemas"
│   ├── src/
│   │   ├── types.ts                     # Note, KanbanCard, Priority, PersistedState (extraits de src/types)
│   │   ├── clip.ts                      # ClipPayload, ClipResult, ClipMode, DestinationKind
│   │   ├── api-actions.ts               # ping|create_note|create_card|get_kanban|… (vocabulaire actuel)
│   │   ├── column-alias.ts              # resolveColumnId() déplacé ici, pur et testable
│   │   ├── markdown-template.ts         # gabarit « # Titre / > 🔗 Source / > 📅 Capturé le »
│   │   └── sanitize.ts                  # garde-fous (taille max, suppression \u0000, bornes title/content)
│   └── tsconfig.json
│
└── extension/
    ├── package.json                     # scripts dev/build/package/build:firefox/package:firefox
    ├── vite.config.ts                   # entrées multiples, build sans minify-agressive, CSP-safe
    ├── tsconfig.json
    ├── manifest/
    │   ├── base.json                    # source commune (placeholders {{APP_URL}} {{VERSION}})
    │   ├── chrome.json.patch            # action/service_worker/sidePanel/optional_host_permissions
    │   └── firefox.json.patch           # background.scripts, browser_specific_settings.gecko, sidebar_action
    ├── src/
    │   ├── background/
    │   │   ├── service-worker.ts        # cycle de vie, onInstalled, onStartup, router messages
    │   │   ├── context-menus.ts         # menus + sous-menu colonnes dynamiques
    │   │   ├── commands.ts              # Alt+Shift+C / K / O
    │   │   ├── badge.ts                 # état connectée / en attente / erreur
    │   │   ├── queue.ts                 # file offline chrome.storage.local + retry + alarms
    │   │   └── clipboard-inpage.ts      # option : réécrire un champ de la page active
    │   ├── popup/
    │   │   ├── index.html
    │   │   ├── Popup.tsx                # capture rapide : sélection | page | tâche kanban
    │   │   └── components/              # DestinationPicker, ColumnPicker, Preview, ShortcutHints
    │   ├── sidepanel/                   # Chrome only ; repli = popup si non supporté
    │   │   ├── index.html
    │   │   └── SidePanel.tsx            # revue complète, édition avant envoi, lot de clippings
    │   ├── options/
    │   │   ├── index.html
    │   │   ├── Options.tsx              # URL instance, jeton, préférences, raccourcis, diagnostics
    │   │   └── components/…             # ConnectionCard, TokenList, ClipDefaults, Exclusions, Logs
    │   ├── content/
    │   │   ├── extract.ts               # exécuté via scripting.executeScript (monde isolé)
    │   │   ├── selection.ts             # sélection + ancêtre sémantique + citation
    │   │   ├── readability.ts           # wrapper @mozilla/readability sur un Document cloné
    │   │   ├── to-markdown.ts           # turndown + gfm + règles (code, img→lien, tableaux)
    │   │   └── metadata.ts              # JSON-LD, og:, byline, canonical, favicon, date, site
    │   ├── lib/
    │   │   ├── api-client.ts            # fetch, Bearer, timeout, retry, erreurs typées
    │   │   ├── storage.ts               # chrome.storage.local/session + schéma versionné + migration
    │   │   ├── settings.ts              # defaults : folderId, tagIds, columnId, priority, template
    │   │   ├── browser.ts               # shim chrome.* / browser.* minimal
    │   │   └── logger.ts                # anneau de logs consultable depuis Options (sans contenu)
    │   ├── messages.ts                  # types des messages runtime (discriminated union)
    │   └── styles/                      # tokens partagés (dark/light), importés par popup/side/options
    ├── public/
    │   ├── icons/ (16/32/48/128, on/off/error)
    │   ├── _locales/{fr,en}/messages.json
    │   └── vendor/ (readability.license.txt, turndown.license.txt)
    ├── scripts/
    │   ├── build.mjs                    # orchestration : shared → entries → manifest → dist/<target>
    │   ├── manifest.mjs                 # merging base + patch, injection version, validation de schéma
    │   ├── validate.mjs                 # équivalent de validate-bookmarklet.mjs : permissions minimales,
    │   │                                #   aucune URL distante, pas d'eval/inline script, tailles
    │   └── package.mjs                  # zip (CWS/Edge) et xpi (web-ext), checksums + notes de version
    ├── tests/
    │   ├── unit/…                       # vitest : metadata, to-markdown, queue, api-client (msw)
    │   └── e2e/clipper.spec.ts          # playwright + Chrome chargé en unpacked
    └── README.md                        # installation développeur par navigateur + revue de permissions
```

Suppression à terme (phase 5) : `scripts/build-bookmarklet.mjs`, `scripts/validate-bookmarklet.mjs`,
`scripts/test-bookmarklet-sync.mjs`, `scripts/e2e-relay-check.mjs`, `scripts/e2e-loader-check.mjs`,
`public/bookmarklet.js`, `BookmarkletModal.tsx` (remplacé par `ExtensionModal.tsx`).

---

## 7. `manifest.json` (V3)

Version émise pour Chrome (générée depuis `base.json` + `chrome.json.patch`) :

```json
{
  "manifest_version": 3,
  "name": "MansotNote Web Clipper",
  "version": "1.0.0",
  "description": "Capture une sélection ou une page entière en Markdown, et envoie-la vers ton instance MansotNote (Note ou tâche Kanban).",
  "default_locale": "fr",
  "minimum_chrome_version": "116",
  "icons": { "16": "icons/icon-16.png", "32": "icons/icon-32.png", "48": "icons/icon-48.png", "128": "icons/icon-128.png" },

  "action": {
    "default_title": "Clipping MansotNote",
    "default_popup": "popup/index.html",
    "default_icon": { "16": "icons/icon-16.png", "32": "icons/icon-32.png" }
  },

  "background": { "service_worker": "background.js", "type": "module" },

  "options_page": "options/index.html",
  "side_panel": { "default_path": "sidepanel/index.html" },

  "permissions": [
    "activeTab", "storage", "contextMenus", "scripting", "commands", "alarms", "notifications", "sidePanel"
  ],
  "optional_permissions": [],
  "optional_host_permissions": ["*://*/*"],
  "host_permissions": [],

  "commands": {
    "_execute_action":        { "suggested_key": { "default": "Alt+Shift+C" } },
    "clip_selection_note":    { "suggested_key": { "default": "Alt+Shift+S" }, "description": "Cliper la sélection en note" },
    "clip_page_note":         { "suggested_key": { "default": "Alt+Shift+D" }, "description": "Cliper la page en note" },
    "clip_page_task":         { "suggested_key": { "default": "Alt+Shift+K" }, "description": "Cliper la page en tâche Kanban" },
    "open_sidepanel":         { "description": "Ouvrir le panneau de clipping" }
  },

  "content_security_policy": { "extension_pages": "script-src 'self'; object-src 'none'" },
  "storage_version": "3"
}
```

`content_scripts` et `web_accessible_resources` sont **absents** du manifeste : l'extraction est
injectée à la demande (`scripting.executeScript`), ce qui évite tout script permanent sur les sites.

**Justification permission par permission (pour la fiche de store)**

| Permission | Pourquoi indispensable | Alternative rejetée |
|---|---|---|
| `activeTab` | accord implicite par le geste (popup, menu, raccourci) : lit titre/URL et injecte le script d'extraction sur l'onglet actif seulement | — |
| `scripting` | injection à la demande du script d'extraction en monde isolé | `content_scripts` permanents sur `<all_urls>` → bien plus intrusif |
| `contextMenus` | « Ajouter la sélection… », « Créer une tâche… » | raccourci seulement |
| `storage` | réglages + file d'attente locale | — |
| `commands` | raccourcis globaux configurables | — |
| `alarms` | relance des clippings en attente au-delà du cycle de vie du SW (30 s) | `setInterval` (tue à l'inactivité) |
| `notifications` | confirmation discrète hors-écran (désactivable) | badge seul |
| `sidePanel` | vue « revue avant envoi » (Chrome 114+) ; repli popup auto | iframe de l'app → **impossible** (`frame-ancestors 'none'`) |
| `optional_host_permissions: ["*://*/*"]` | demandée **uniquement** si l'utilisateur veut clippager depuis n'importe quel site sans re-clic (mode « bouton flottant » / raccourci hors-geste) | `<all_urls>` par défaut → refus probable en revue CWS |
| `host_permissions` **aucun** par défaut | la requête réseau part du SW vers **l'URL de l'instance saisie par l'utilisateur** ; l'origine de l'instance est ajoutée par `chrome.permissions.request` depuis Options | `<all_urls>` permanent |

Aucune de ces permissions n'exige de lire le contenu d'un site sans geste utilisateur :
c'est l'argument « privacy » de la fiche. `tabs` **n'est pas** requis
(les URL/titres viennent du geste `activeTab` et de `tabs.query({active:true,currentWindow:true})`
avec `activeTab`).

### 7.1 Variante Firefox

Émise par `scripts/manifest.mjs` à partir des mêmes sources :

```json
{
  "manifest_version": 3,
  "browser_specific_settings": {
    "gecko": { "id": "clipper@mansotnote", "strict_min_version": "128.0" }
  },
  "background": { "scripts": ["background.js"] },
  "sidebar_action": {
    "default_title": "MansotNote",
    "default_panel": "sidepanel/index.html",
    "default_icon": { "32": "icons/icon-32.png" },
    "open_at_install": false
  }
}
```

- `side_panel` (Chrome) et `sidebar_action` (Firefox) pointent sur **le même document** : une seule
  UI, deux déclarations. Repli `action.default_popup` partout.
- `optional_host_permissions` → `optional_permissions: ["<all_urls>"]` côté Firefox (clé MV3
  `optional_permissions` acceptée pour les hôtes).
- `commands._execute_action` : supported ; les `suggested_key` peuvent nécessiter un réglage manuel
  (`about:addons` → roue dentée → Raccourcis d'extension).
- `notifications` : OK. `alarms` : OK. `contextMenus` : OK. `scripting` : OK ≥ 128 (sinon `executeScript`
  via `tabs.executeScript` dans le shim `lib/browser.ts`).
- Le service worker est évité au profit d'une **event page** (`background.scripts`) : `lib/browser.ts`
  n'utilise que des APIs communes ; aucun `window` dans le background (le Markdown est converti
  dans le document content ou dans popup/sidepanel, qui ont un DOM).

### 7.2 Matrice de compatibilité

| Capacite | Chrome/Edge/Brave | Firefox | Arbitrage |
|---|---|---|---|
| `action` popup | ✅ | ✅ | socle |
| `contextMenus` | ✅ | ✅ | socle |
| `scripting.executeScript` (isolated) | ✅ | ✅ (128+) | socle, shim fallback |
| Side panel | ✅ 114+ | `sidebar_action` | **dégradé → popup** |
| `commands` | ✅ | ✅ | socle |
| `offscreen` (DOM dans le background) | ✅ | ❌ | **non utilisé** (conversion côté content) |
| `chrome.storage.local` | ✅ | ✅ | socle (jamais `.sync` : fuite vers le compte Google) |
| `tabs` (lecture d'URL sans geste) | optionnel | optionnel | non requis |
| Service worker vs event page | SW | event page | deux manifestes, un seul code |
| Store | CWS + Edge Add-ons | AMO (`web-ext sign`) | pipeline §10 |

---

## 8. Spécification des fonctionnalités

### 8.1 Popup — capture rapide (< 2 s)

Ouverte par l'icône ou `Alt+Shift+C`. États : `non configuré → connexion → prêt`.

```
┌ MansotNote ──────────────────────────── ⚙ ─────┐
│  github.com/microsoft/Playwright  ·  12k mots  │
│  ○ Sélection (312 mots)   ● Page   ○ Lien      │
│ ┌ Destination ───────────────────────────────┐ │
│ │ [ 📝 Note      |  📋 Tâche Kanban  |  🔗 ]  │ │
│ └────────────────────────────────────────────┘ │
│  Dossier ▾ Sans dossier    Étiquettes ▾ +web   │  ← mode Note
│  Colonne ▾ À faire (todo)  Priorité ▾ Moyenne  │  ← mode Tâche
│  ☑ Inclure le corps  ☑ Métadonnées  ☐ Copier   │
│ ┌ Aperçu Markdown ────────────────────────────┐ │
│ │ # Playwright …                              │ │
│ │ > 🔗 Source : [title](url) — 21/07/2026     │ │
│ └─────────────────────────────────────────────┘ │
│  [ ⌘↵ Cliper ]        [ Ouvrir dans MansotNote ]│
└─────────────────────────────────────────────────┘
```

- **Le raccourci `⌘↵` clippe sans rouvrir la popup** (file d'attente + toast + badge).
- Aperçu = rendu `marked`+`DOMPurify` local (déjà disponible via `packages/shared`), jamais de HTML
  de page brute injecté sans assainissement.
- « Envoyer et continuer à clippager » garde la popup ouverte (batch, utile aux revues de veille).
- **Repli offline** : si l'instance est injoignable, mise en file et notification « 3 en attente » ;
  la revue des éléments en attente est dans Options (jamais le contenu dans les logs).
- **IA (option, phase 4)** : cases « Résumé IA », « Tags suggérés », « Reformuler en tâche »
  → exécutées **côté serveur** (`POST /api/v1/ai/summarize`), avec la clé IA du workspace :
  aucune clé API n'entre dans l'extension (contrairement au bookmarklet actuel qui les met dans
  `localStorage` du site visité).

### 8.2 Menus contextuels

```
MansotNote ▸
  ├ Ajouter la sélection à MansotNote…       (contexts: ["selection"])
  ├ Créer une note depuis cette page         (contexts: ["page","link","image"])
  ├ Créer une tâche Kanban… ▸ (liste des colonnes, rafraîchie à l'ouverture)
  ├ Copier le Markdown de la sélection        (contexts: ["selection"])
  └ (Image) Cliper l'image avec sa source     (contexts: ["image"])
```

- Enregistrements créés dans `onInstalled` + `menus.update()` pour l'activation/désactivation selon
  l'exclusion de domaine (`options.excludedHosts`) — pas de reconstruction du menu à chaque clic.
- Les colonnes du sous-menu viennent de `GET /api/v1/destinations` (cache 5 min + alias logiques).
- Clic sans popup : envoi direct avec notification native (comportement « clip and forget »),
  configurable pour ouvrir la popup de confirmation à la place.

### 8.3 Page d'options

Sections :
1. **Connexion** — URL de l'instance (validation : `new URL()`, protocole https recommandé, http
  localhost/LAN explicitement autorisé avec avertissement), bouton *Tester* (`GET /api/v1/whoami`),
   génération/collage du **jeton** (jamais le mot de passe), liste des jetons actifs côté serveur,
   révocation, indicateur « dernière synchronisation ».
2. **Comportement par défaut** — destination par défaut, dossier, étiquettes auto (`web-clip`),
   colonne + priorité par défaut, gabarit de note (avec variables `{{title}} {{url}} {{byline}}
   {{date}} {{excerpt}} {{content}}`), seuil de longueur avant troncature.
3. **Raccourcis** — lien `chrome://extensions/shortcuts` (lecture seule : non réglable par l'extension)
   + tableau des commandes.
4. **Exclusions** — hôtes où ne pas proposer le clic (banque, webmail pro…), pattern list.
5. **File d'attente** — clippings non partis (titre + domaine + état), rejeu, purge.
6. **Diagnostics** — version, cible de build, dernier code HTTP, logs techniques (sans contenu).
7. **Confidentialité** — phrase explicite : *l'extension ne transmet que vers l'instance MansotNote
   configurée ; aucune télémétrie*.

Stockage : `chrome.storage.local` (jamais `sync`), schéma versionné avec migration explicite.

### 8.4 Extraction Markdown (le cœur)

`content/extract.ts`, exécuté dans le **monde isolé** via `scripting.executeScript({func})`,
retourne un objet plat (sériable) :

```ts
interface ClipCandidate {
  mode: 'selection' | 'page' | 'link' | 'image';
  title: string;                 // og:title → <title> → H1
  url: string;                   // canonical ? location.href
  siteName: string | null;       // og:site_name
  byline: string | null;         // meta author / JSON-LD author / Readability byline
  publishedAt: string | null;    // article:published_time / JSON-LD datePublished
  description: string | null;    // og:description / meta description
  markdown: string;              // corps converti (Readability → Turndown GFM)
  text: string;                  // extraction texte brut (repli + recherche)
  wordCount: number;
  faviconUrl: string | null;
  selectionText: string | null;  // sélection courante, si existante
  selectionHtml: string | null;  // fragment sérialisé (assaini avant rendu)
  lang: string | null;
  truncated: boolean;
}
```

Règles de conception :

- **Readability sur un `Document` cloné** (`new DOMParser().parseFromString(outerHTML, 'text/html')`)
  pour ne jamais muter le DOM de la page ; repli systématique sur `<article>`/`main`/`[role=main]`
  puis sur le corps complet si le score est trop bas (`wordCount < 120`).
- **Turndown + GFM** : tableaux, listes de tâches, code fenced avec langue, images →
  `![alt](src)` avec résolution des `src` relatifs (`url.resolve`), suppression des
  `<script>/<style>/<nav>/<footer>/<aside>` et des `aria-hidden`.
- **Liens internes** réécrits en absolus ; `data:` URLs tronquées.
- **Sélection** : `Range.cloneContents()` plutôt que `.toString()` pour conserver le Markdown de la
  zone surlignée + contexte (heading le plus proche, pour la citation).
- **Budget** : plafond dur (ex. 200 000 caractères) avec `truncated: true` et note dans le gabarit ;
  le serveur impose sa propre limite (taille de payload) — cohérente avec `express.json({limit:'15mb'})`
  mais beaucoup plus raisonnable (`z.string().max(400_000)`).
- **Anti-injection** : le contenu clippé est inséré *comme texte* dans du Markdown ; jamais de HTML
  brut dans le corps (`escapeHtml` sur les métadonnées, `turndown` `escape` activé). L'affichage côté
  app est déjà DOMPurify-és.

### 8.5 Panneau latéral, notifications, file d'attente

**Side panel (`sidepanel/index.html`)** — même document que celui du « side panel » Firefox
(`sidebar_action`). Contenu : aperçu Markdown rendu (DOMPurify), champs éditables (titre, dossier,
étiquettes, colonne, priorité, échéance), modèles de clipping, sélection multiple d'onglets à clippager,
historique des 20 derniers clippings et bouton « rouvrir dans MansotNote ». Ouverture par
`chrome.sidePanel.setPanelAction({ tabId, action: 'openPanel' })` relié à la commande
`open_sidepanel`. Repli Firefox : `sidebar_action` natif. Repli total (Chrome < 114) : la popup.

**Notifications** — `chrome.notifications` basic (icône + « Note « X » créée — Ouvrir »),
désactivable (`options.notificationsEnabled`), et **silencieuse si une popup/panneau est ouvert**
(pas de doublon). Actions : `Ouvrir`, `Annuler le clipping`, `Réessayer`.

**File d'attente (`background/queue.ts`)**

```ts
interface QueuedClip {
  id: string;              // clientClipId, aussi Idempotency-Key
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;   // backoff exponentiel + jitter (1s, 2s, 5s, 15s, 60s, puis alarmes)
  payload: ClipPayload;    // sans contenu si options.redactQueuedContent = true
  lastError?: { code: string; message: string };
}
```

- Persistance `chrome.storage.local` (`queue.v1`), **plafond 50 entrées** puis rejet avec message.
- Réveil par `chrome.alarms.create('mn-queue-flush', { periodInMinutes: 1 })` — le SW est éphémère,
  aucune tentative ne doit reposer sur un `setTimeout`.
- Le badge affiche `pending` ; un clic sur l'icône avec badge > 0 ouvre directement la section
  « File d'attente » d'Options.
- Le contenu n'est **jamais** écrit dans `chrome.storage.sync` (synchronisation via le compte
  Google = fuite vers un tiers de confiance non choisi).

### 8.6 Module IA (hors chemin critique)

Aucune clé API ne vit dans l'extension. Trois options, par ordre de préférence :

1. **Aucune IA au MVP** : le clipping est déterministe (Readability + Turndown). C'est le comportement
   actuel du bookmarklet qui a le plus de surface de panne.
2. **Résumé/taggage côté serveur** : `POST /v1/ai/summarize` (scope `ai:read`) qui réutilise
   l'endpoint et la clé **déjà stockés dans le workspace** (`settings.aiEndpoint`/`aiApiKey`) ou le
   relais `/ollama/` de nginx. L'extension n'envoie que le Markdown, reçoit un résumé.
   Avantage : mixité de confidentialité identique à l'app, et pas de CSP `connect-src` à contourner.
3. **Relais par l'app ouverte** (`?action=chat`) : supprimé — c'est précisément le pont non
   authentifié décrit en §4.2‑4.3.

### 8.7 Backend : que faire de `remote-api.ts`

`remote-api.ts` n'est **pas** jeté : il reste le moteur des actions du workspace et l'API de
`createNote/createCard`. On y ajoute :

- `applyClip(state, clip)` extrait dans `packages/shared` (même code côté app et, si mode B activé,
  côté serveur Node) → garantit que note/carte créées par l'une ou l'autre voie soient identiques
  (ids `note_xxx`, `card_xxx`, colonnes résolues, `updatedAt`, `order` normalisé).
- Le pont `BroadcastChannel`/`postMessage` est **restreint** : suppression de l'action `chat`,
  suppression de `clear_kanban` du pont, exigence d'une origine dans une whitelist explicite
  (l'origine de l'extension) + confirmation utilisateur. À terme (phase 5), transport supprimé
  complètement.

---

## 9. Contrat d'API distante (serveur)

### 9.1 Nouvelles routes

Montées sur le serveur existant (`server/index.ts`), donc automatiquement exposées par nginx sous
`/api/…` (le préfixe est retiré par `proxy_pass`).

| Méthode | Route | Auth | Rôle |
|---|---|---|---|
| `GET` | `/v1/whoami` | PAT | `{ user, version, capabilities[] }` — test de connexion de l'extension |
| `GET` | `/v1/capabilities` | PAT | actions supportées + limites (taille max, modes) |
| `GET` | `/v1/destinations` | PAT | colonnes (+alias), dossiers, étiquettes — remplace `get_kanban`/`get_notes` côté pont |
| `POST` | `/v1/clips` | PAT scope `clip:write` | dépôt d'un clipping (note, tâche, ou les deux) |
| `GET` | `/v1/clips?status=pending&limit=50` | PAT `clip:read` ou session | file d'attente lue par l'app |
| `POST` | `/v1/clips/:id/ack` | idem | l'app confirme l'application (→ `applied`) |
| `POST` | `/v1/clips/:id/fail` | idem | rapport d'échec côté app (message, code) |
| `GET`/`POST`/`DELETE` | `/v1/tokens…` | **session cookie uniquement** | création/liste/révocation des jetons depuis l'app |
| `GET` | `/v1/pending-count` | session (HEAD/ETag) | signal léger pour l'app : « quelque chose t'attend » |

Pas d'`/ai/chat` au MVP (garder la conversation IA dans l'app) ; la route `/v1/ai/*` est réservée
au namespace pour la phase 4.

### 9.2 Schéma de requête (zod, `packages/shared`)

```ts
export const clipDestination = z.object({
  kind: z.enum(['note', 'card']),
  folderId: z.string().max(64).nullish(),
  tagIds: z.array(z.string().max(64)).max(20).optional(),
  columnAlias: z.enum(['todo','in_progress','done','backlog']).or(z.string().max(64)).optional(),
  priority: z.enum(['low','medium','high','urgent']).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const clipPayload = z.object({
  mode: z.enum(['selection','page','link','image']),
  destination: clipDestination,
  title: z.string().trim().min(1).max(500),
  url: z.string().url().max(2048),
  siteName: z.string().max(200).nullish(),
  byline: z.string().max(200).nullish(),
  publishedAt: z.string().datetime({ offset: true }).nullish(),
  markdown: z.string().max(400_000),
  excerpt: z.string().max(4000).optional(),
  template: z.enum(['default','raw','reading']).optional(),
  apply: z.enum(['inbox','direct']).default('inbox'),
  clientClipId: z.string().min(8).max(64),      // idempotence (voir 9.3)
});
export type ClipPayload = z.infer<typeof clipPayload>;

export const clipResponse = z.object({
  clipId: z.string(),
  status: z.enum(['pending','applied']),
  applyMode: z.enum(['inbox','direct']),
  entities: z.array(z.object({ kind: z.enum(['note','card']), id: z.string(), title: z.string() })),
  workspaceVersion: z.number().nullable(),
  openUrl: z.string().url().nullable(),          // lien profond vers la note/carte créée
});
```

### 9.3 Migration SQL (`server/migrations/002_clips_tokens.sql`)

```sql
CREATE TABLE IF NOT EXISTS api_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  token_hash char(64) NOT NULL UNIQUE,          -- sha256(base32/64url secret)
  token_prefix text NOT NULL,                   -- 'msn_pat_4f2a…' affiché dans l'UI
  scopes text[] NOT NULL DEFAULT '{clip:write,clip:read,destinations:read}',
  created_from inet,
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS api_tokens_user_idx ON api_tokens(user_id);

CREATE TABLE IF NOT EXISTS clips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_clip_id text NOT NULL,
  idempotent_key text GENERATED ALWAYS AS (user_id::text || ':' || client_clip_id) STORED UNIQUE,
  payload jsonb NOT NULL,
  apply_mode text NOT NULL DEFAULT 'inbox',
  status text NOT NULL DEFAULT 'pending',       -- pending | applied | failed | discarded
  entities jsonb NOT NULL DEFAULT '[]'::jsonb,
  workspace_version bigint,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  CHECK (status IN ('pending','applied','failed','discarded'))
);
CREATE INDEX IF NOT EXISTS clips_pending_idx ON clips(user_id, created_at) WHERE status='pending';
```

L'index **unique** sur `idempotent_key` rend le rejeu de l'extension sans effet de bord
(`ON CONFLICT (idempotent_key) DO UPDATE … RETURNING id` renvoie le clipping déjà connu,
avec `status` inchangé → l'extension affiche « déjà envoyé »).

### 9.4 Authentification & CORS

```ts
const PAT_PREFIX = 'msn_pat_';

async function authenticateAny(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.get('authorization');
  if (header?.startsWith(`Bearer ${''}`) || header?.startsWith('Bearer ')) {
    const secret = header.slice(7).trim();
    if (secret.length < 20) return res.status(401).json({ error: 'Jeton invalide' });
    const r = await pool.query(
      `SELECT u.id, u.username, t.id AS token_id, t.scopes
         FROM api_tokens t JOIN users u ON u.id=t.user_id
        WHERE t.token_hash=$1 AND t.revoked_at IS NULL
          AND (t.expires_at IS NULL OR t.expires_at>now())`,
      [hashSessionToken(secret)]);
    if (!r.rowCount) return res.status(401).json({ error: 'Jeton révoqué ou expiré' });
    req.user = { id: r.rows[0].id, username: r.rows[0].username };
    req.scopes = r.rows[0].scopes; req.tokenId = r.rows[0].token_id;
    void pool.query('UPDATE api_tokens SET last_used_at=now() WHERE id=$1', [req.tokenId]);
    return next();
  }
  return authenticate(req, res, next);              // session cookie : inchangée
}
```

- Les jetons sont créés **uniquement** derrière la session cookie (jamais auto-générés par l'extension),
  avec affichage du secret **une seule fois**, et révocation depuis Options.
- `requireScope('clip:write')` sur `POST /v1/clips` ; `clear_kanban` **n'est pas** exposé au PAT.
- **CORS** : requis parce que la popup (document `chrome-extension://…`) effectue un fetch cross-origin
  lorsque l'extension n'a pas d'`host_permissions`. Politique :

```ts
const ALLOWED_EXT_ORIGINS = (process.env.ALLOWED_EXTENSION_ORIGINS ?? '').split(',').filter(Boolean);
app.use('/v1/', (req, res, next) => {
  const origin = req.get('origin');
  if (origin && (ALLOWED_EXT_ORIGINS.includes(origin) || /^chrome-extension:\/\/[a-p]{32}$/.test(origin)
                 || /^moz-extension:\/\/[0-9a-f-]{36}$/.test(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type, idempotency-key');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});
```

  L'en-tête `crossOriginResourcePolicy: same-origin` posé globalement par `helmet()` doit rester
  sans effet sur le chemin `Authorization` (il ne s'applique qu'aux chargements de ressources
  cross-origin, type `<img>`/`<script>`/`fetch` en mode `no-cors`) ; on le laisse donc tel quel pour
  `/v1/*`, et on n'ajoute que les en-têtes CORS ci-dessus. À vérifier au spike : si un appel depuis le
  **content script** (et non depuis le service worker) est un jour nécessaire, il faudra alors passer
  cette route à `crossOriginResourcePolicy: { policy: 'cross-origin' }`.
  Les routes `/auth/*` et `/workspace` gardent `same-origin`.
  *En dev, `vite.config.ts` ne proxifie pas `/api`* : les appels `fetch('/api/…')` de
  `remote-storage.ts` ne fonctionnent que derrière nginx (instance Docker sur `:8793`). L'extension
  doit donc être pointée vers l'instance complète (`http://192.168.1.47:8793/api` en local,
  `https://notes.mansotfamily.fr/api` en prod) — ou ajouter un `server.proxy` côté Vite pour la
  parité dev/prod.
  *Note* : si l'utilisateur accorde l'hôte de son instance (`host_permissions`), Chrome autorise le
  fetch sans pré-vol. On implémente donc **les deux** : whitelist CORS + host permission optionnelle.
- **Rate limit** dédié : `clipLimiter = rateLimit({ windowMs: 60_000, limit: 60 })` et
  `loginLimiter` inchangé. Les routes `/v1/*` sont hors du `dataLimiter` de 240/min.
- Le CSP global du serveur (`default-src 'none'`) reste valide : ces réponses sont du JSON.

### 9.5 Côté app : drainer la boîte d'arrivée

Nouveau module `src/lib/clip-inbox.ts` :

- `GET /api/v1/pending-count` (ETag) toutes les 45 s quand l'onglet est visible (et jamais
  en arrière-plan, pour ne pas consommer de batterie) → si changé, tirage + application.
- Application par lot : pour chaque clip, `applyClip()` → `createNote`/`createCard` (comportement
  identique au pont actuel), puis `ack`. `flushPending()`/`persistNow()` une seule fois par lot
  (pas par entité) pour éviter 10 PUT.
- `toast('success', 'N clippings importés')` + lien « Ouvrir la note ».
- `chrome.tabs.sendMessage` : si l'extension détecte une onglet de l'instance ouvert, elle envoie
  `{type:'clip:created'}` → drain immédiat (nécessite un mini content script sur la seule origine de
  l'instance, ajouté à `host_permissions` une fois configurée — c'est le *seul* endroit où l'extension
  injecte dans l'app, jamais dans les sites tiers).

---

## 10. Build & packaging

### 10.1 Outillage

- **Vite** en multi-entrées (pas `@crxjs/vite-plugin`, dont l'accouplement HMR/SW est source de
  casse sur Firefox) : `rollupOptions.input = { popup, options, sidepanel, background, content.extract }`,
  `output.entryFileNames` fixes pour que le manifest pointe des noms stables (`background.js`, …).
- `esbuild` est déjà la solution de bundling du serveur (`build:server`) : alternative plus minimale
  (une invocation par entrée, `--bundle --format=esm --platform=browser`) si on veut éviter une
  deuxième chaîne. Recommandation : **Vite** pour les documents avec JSX (popup/options/sidepanel),
  et `esbuild` pour les deux entrées sans DOM (`background`, `content/extract`).
- `@mozilla/readability` + `joplin/turndown` + `turndown-plugin-gfm` : seuls ajouts runtime de
  l'extension, bundlés (**aucune ressource distante** — exigence CSP MV3 et exigence de store).
- `webextension-polyfill` dans `lib/browser.ts` (promises + compatibilité `browser.*`/`chrome.*`).
- Alias `@shared` → `packages/shared/src` ; l'extension ne dépend jamais de `src/` de l'app.

### 10.2 Scripts (`package.json` racine)

```jsonc
{
  "dev:ext":            "pnpm --filter mansotnote-extension dev",
  "build:ext:chrome":   "pnpm --filter mansotnote-extension build --target=chrome",
  "build:ext:firefox":  "pnpm --filter mansotnote-extension build --target=firefox",
  "package:ext:chrome": "pnpm --filter mansotnote-extension package --target=chrome",   // zip CWS/Edge
  "package:ext:firefox":"pnpm --filter mansotnote-extension package --target=firefox",  // web-ext build/sign → xpi
  "validate:ext":       "pnpm --filter mansotnote-extension node scripts/validate.mjs", // garde-fous de manifeste
  "test:ext":           "pnpm --filter mansotnote-extension test",
  "e2e:ext":            "pnpm --filter mansotnote-extension test:e2e"
}
```

Sorties :

```
dist/extension/chrome/     ← chargeable en « Charger l'extraction non empaquetée »
dist/extension/firefox/    ← about:debugging → charger un module d'extension temporaire
release/mansotnote-clipper-1.0.0-chrome.zip
release/mansotnote-clipper-1.0.0-firefox.xpi
release/SHA256SUMS.txt  +  release/notes-1.0.0.md
```

- `package.mjs` construit le zip **sans le dossier `src/`**, sans `.map` (réduit la surface d'analyse
  et la taille), avec un `manifest.json` finalisé et une clé d'identification stable pour Chrome
  (`--pack-extension` ou clé stockée en secret de CI) → **identité d'extension fixe**, donc whitelist
  CORS et URL profondes stables.
- Firefox : `web-ext build` puis `web-ext sign --api-key … --api-secret …` (AMO), avec
  `browser_specific_settings.gecko.id` pour les mises à jour canalisées.
- Intégration Docker optionnelle : `Dockerfile.ext` (build → artefacts dans un volume) pour
  publier les zips sur l'instance auto-hébergée (« Télécharger l'extension » depuis Options).
- **CI** (à ajouter) : `typecheck` + `validate:ext` (manifeste, permissions minimales, absence de
  ressources distantes, absence d'`eval`/`new Function`) + `test:ext` + build des deux cibles en artefacts.
  `validate:ext` remplace `validate-bookmarklet.mjs` dans le pipeline et bloque les régressions
  typiques (clé manquante, taille d'icône, `default_locale` sans `_locales`).

### 10.3 Versionnage

- Une seule source de version : `packages/extension/package.json` → injectée dans le manifeste et
  dans `GET /v1/whoami` (l'app peut afficher « extension ≥ 1.0 requise » si l'API évolue).
- Compatibilité API : en-tête `X-Mn-Client: clipper/1.0.0` + `capabilities` → l'appareille
  « extended → repli ». Le serveur accepte N-1 versions d'extension.

---

## 11. Sécurité, confidentialité, robustesse

| Risque | Mesure |
|---|---|
| Fuite du jeton | `Authorization: Bearer` en HTTPS uniquement ; `storage.local` (non synchronisé) ; masque dans Options ; révocation ; TTL + rotation conseillés ; le jeton ne permet **pas** `workspace:delete` ni `clear_kanban` |
| L'extension vole le DOM d'un site sensible | extraction **uniquement** déclenchée par un geste (`activeTab`) ; pas de `content_scripts` permanents ; liste d'exclusion dans Options ; aucune lecture de `input[type=password]`, aucun `MutationObserver` |
| Contenu de page hostile → XSS dans l'UI de l'extension | `DOMPurify` sur tout HTML avant rendu ; CSP `script-src 'self'` ; aucune injection de HTML distant ; les métadonnées sont rendues en texte |
| Rejeu/double clipping | `clientClipId` + index unique `idempotent_key` |
| Écrasement du workspace par l'autosave | mode A (inbox) par défaut ; mode B conditionné à l'absence d'écriture récente + rebase 409 (§12.3) |
| Perte de clipping (SW tué, réseau KO) | file `chrome.storage.local` + `alarms` + badge + revue dans Options ; notification d'échec définitif après 5 tentatives exponentielles |
| Surfacing d'URL dans l'historique (défaut du bookmarklet) | plus aucune donnée applicative dans une query string ; navigation éventuelle vers `openUrl` **après** la réponse, avec `URL.createObjectURL`/`#/` non persistant |
| Télémétrie | aucune ; `optional-analytics: off` ; politique de confidentialité CWS/AMO : « aucune donnée collectée » |
| Chaîne d'approvisionnement | dépendances lockées, `allowBuilds` pnpm déjà restrictif, SRI des artefacts publiés via `SHA256SUMS.txt` |
| Instances auto-hébergées en HTTP LAN | avertissement explicite dans Options + détection `http:` ≠ localhost ; le jeton est alors exposé au réseau local (documenté) |

---

## 12. Points de conception critiques (et leurs réponses)

### 12.1 « L'extension peut-elle réutiliser la session existante ? »
Non. `SameSite=Strict` + `httpOnly` + origine `chrome-extension://` = requêtes cross-site, cookie
non joint (et une popup n'a pas de top-site au sens cookie). Un jeton dédié est la seule voie propre —
et il règle au passage la fraude au mot de passe maître (§4.1, §4.6).

### 12.2 « Peut-on éviter de toucher au serveur ? »
Théoriquement en gardant un onglet app ouvert + pont `BroadcastChannel` (le SW ne peut pas : il est
dans son propre univers d'origine). En pratique non : dépendance à un onglet ouvert, déverrouillé,
et pont non authentifié (§4.2‑4.3). **Un endpoint serveur minimum (`POST /v1/clips`) est requis.**
Coût estimé : ~350 lignes (migration + routes + tests), réutilisation totale de l'`authenticate`
existant.

### 12.3 « Et si l'utilisateur ne veut jamais ouvrir MansotNote ? »
Mode B (fusion serveur directe). Nécessite au préalable le **rebase du client** dans
`remote-storage.ts` — aujourd'hui un 409 ne fait qu'afficher une erreur ; il faut :
`GET /workspace` → fusion entité-par-entité (union par `id`, gagnant = `updatedAt` le plus récent,
ajout des entités créées côté serveur) → `PUT` avec la nouvelle version. C'est un prérequis de
sûreté **indépendant** de l'extension (multi-appareils actuels).

### 12.4 Coffre chiffré (`storage.id === 'local-storage'` + auth active)
Le serveur ne peut pas créer la note (le blob est chiffré AES-GCM côté client). Comportement :
le clipping reste en `pending` dans `clips` et n'est appliqué qu'au prochain déverrouillage d'un
onglet ; l'extension affiche « en attente de MansotNote » et propose d'ouvrir l'app. C'est cohérent,
et nettement mieux que le comportement actuel (échec silencieux après timeout de 4 s).

### 12.5 Pages non clippables
`chrome://`, `about:`, `chrome.google.com/webstore`, visionneuse PDF/intégrée,
`devtools://`, et le Web Store : `scripting.executeScript` échoue → l'UI doit afficher
« Capture impossible sur cette page — utilise “Cliper le lien” » au lieu de rester muette
(c'était l'un des modes de panne du bookmarklet).

### 12.6 « Le favori doit-il disparaître ? »
Non : une **version minimale** est conservée (uniquement `window.open(app + '/new?url=' + …)`
sans aucune donnée dans la query string, ni secret) pour les gens qui refusent d'installer une
extension. Le panneau Note du bookmarklet, l'injection dans les champs et le chat IA sortent du
périmètre. `BookmarkletModal` devient un écran « Installe l'extension » (CTA store + repli favori
+ QR de configuration).

---

## 13. Plan global

### Phase 0 — Décisions & gabarit (0,5 j)
- [ ] Valider : `packages/` vs `extension/` ; mode A seul au MVP ; nom/identité visuelle ;
      `minimum_chrome_version: 116` / `firefox 128`.
- [ ] Écrire `packages/shared` (types + `clip.ts` + `column-alias.ts` + `applyClip`) et le faire
      consommer par `src/types` et `remote-api.ts` sans duplication.
- [ ] Activer `packages:` dans `pnpm-workspace.yaml`.
- **Livrable** : squelette qui compile (`pnpm build` vert), contrat figé (openapi/zod).

### Phase 1 — API serveur (1,5 j) — *prérequis bloquant de tout le reste*
- [ ] `002_clips_tokens.sql` (api_tokens, clips, index unique d'idempotence).
- [ ] `authenticateAny` + scopes + `hashSessionToken` réutilisé ; CRUD `/v1/tokens` derrière session.
- [ ] `POST /v1/clips` (mode inbox), `GET /v1/clips`, `ack`/`fail`, `GET /v1/destinations`,
      `GET /v1/whoami`, `/v1/pending-count` (ETag).
- [ ] CORS whitelist + `crossOriginResourcePolicy: cross-origin` sur `/v1/*` ; `clipLimiter`.
- [ ] Tests serveur (`scripts/test-clips-api.mjs` sur le modèle des `test-*.mjs` existants) :
      idempotence, révocation, scope refusé, taille max, 401 sans jeton, CORS.
- **Critère d'acceptation** : `curl -H "Authorization: Bearer …" -d @clip.json /api/v1/clips`
  crée une ligne `pending`, rejoue sans doublon, et `/api/v1/clips?status=pending` la renvoie.

### Phase 2 — Extension MVP Chrome (2,5 j)
- [ ] Chaîne de build (Vite/esbuild + `manifest.mjs` + `validate.mjs`), chargement unpacked.
- [ ] Options : connexion (URL + jeton + test) → `whoami`, réglages par défaut.
- [ ] `api-client.ts` (timeout, retry borné, erreurs typées, `Idempotency-Key`).
- [ ] Extraction : sélection + page (Readability/Turndown GFM) + métadonnées, budget/troncature.
- [ ] Popup : destination Note/Tâche, colonne (alias résolus par `/v1/destinations`), aperçu, `⌘↵`.
- [ ] Menus contextuels + `commands` + badge + notifications.
- [ ] File offline + `alarms`.
- **Critère d'acceptation** : sur `github.com`, `notion.so`, `x.com`, `medium.com`, `developer.mozilla.org`
  et une page locale en `http://127.0.0.1:8793`, la popup s'ouvre, le Markdown est correct,
  le clipping est accepté (`201 pending`), **sans aucune erreur CSP en console**.

### Phase 3 — Drain côté app (1 j)
- [ ] `clip-inbox.ts` (pending-count ETag → tirage → `applyClip` → `ack`, persist groupé).
- [ ] Réception du signal immédiat de l'extension (mini content script sur la seule origine de l'instance).
- [ ] Régression : deux onglets + mode B plus tard → implémente le **rebase 409** de
      `RemoteStorageAdapter` (union par `id`/`updatedAt`) et le test associé.
- [ ] Lien profond `/#/note/:id` (ou `?open=` propre) pour « Ouvrir dans MansotNote »
      — aujourd'hui l'app ne sait pas ouvrir une note depuis l'URL.
- **Critère d'acceptation** : clipping depuis un site → note visible dans l'app ouverte en < 1 s
  (onglet focus) ou au prochain chargement (onglet fermé) ; **aucune perte de données** avec deux
  onglets ouverts.

### Phase 4 — Firefox/Edge/Brave + IA (1,5 j)
- [ ] Manifeste Firefox (`background.scripts`, `sidebar_action`), shim `browser.ts`, `web-ext run`.
- [ ] Parité des fonctions ; écrites documentées dans le README.
- [ ] `POST /v1/ai/summarize` côté serveur (clé IA du workspace, jamais dans l'extension) + cases IA
      dans la popup ; RAG existant réutilisable pour « rattacher à une note existante ».
- [ ] Option « réécrire le champ actif » (l'équivalent propre de l'injection Slack/Gmail du bookmarklet)
      avec validation utilisateur dans le page.

### Phase 5 — Packaging store & dépréciation (1 j)
- [ ] `package.mjs` : zip chrome + xpi signé, `SHA256SUMS.txt`, notes de version.
- [ ] Fiches store : captures, textes FR/EN (`_locales`), politique de confidentialité,
      justification de chaque permission (§7), taille de l'empreinte.
- [ ] `ExtensionModal.tsx` remplace `BookmarkletModal.tsx` (CTA store, lien Options, repli favori minimal).
- [ ] Nettoyage : suppression du bookmarklet chargeur, de `build-bookmarklet.mjs`,
      `validate-bookmarklet.mjs`, `e2e-loader-check.mjs`, `test-bookmarklet-sync.mjs`,
      des actions `chat`/`clear_kanban` du pont, de l'handler `?action=api_relay` (avec page de
      redirection vers l'extension pendant une version).
- **Effort total : ~7,5 j** (1 développeur). Phase 0‑2 seules (3,5 à 4 j) donnent déjà un clipper
  utilisable sur Chrome avec file d'attente et drain au prochain ouverture de l'app.

### 13.1 Risques & mitigations

| Risque | Prob. | Impact | Mitigation |
|---|---|---|---|
| Refus/attente de revue CWS (permissions) | moyenne | faible | `activeTab` + hôtes optionnels, `_locales`, politique de confidentialité, version « unpacked » pour l'usage familial |
| Rebase 409 mal fait → perte de données | élevée si bâclée | **élevé** | mode A par défaut, test de régression multi-onglets, pas de mode B avant validation |
| Readability inefficace sur certaines SPAs (X, YouTube) | élevée | moyen | repli `selection`/`link` + gabarit `reading`/`raw` + règles par site (phase 6) |
| Cycle de vie du SW qui tue les requêtes en vol | moyenne | moyen | envoi depuis la popup quand elle est ouverte, `alarms`+file sinon ; `keepalive` limité |
| Instances auto-hébergées multiples (LAN + prod) | certaine | faible | profils de connexion multiples dans Options (switch rapide) ; le jeton est lié à une origine |

### 13.2 Tests

- **Unit** (`vitest`, `packages/extension`) : `metadata`, `to-markdown` (snapshots sur 6 fixtures HTML :
  article, docs, forum, paywall, code, tableau), `queue` (backoff), `api-client` (mock fetch),
  `column-alias` (déplacé depuis `resolveColumnId`, déjà couvert par `test-kanban-actions.mjs`).
- **Contrat** : schémas zod partagés → un test qui vérifie que `POST /v1/clips` rejette tout payload
  hors schéma et que l'app applique tout payload valide (`applyClip` idempotent).
- **Intégration serveur** : `scripts/test-clips-api.mjs` dans la lignée des tests existants.
- **E2E** : Playwright + Chromium chargé avec `--load-extension=dist/extension/chrome` sur les pages
  fixtures (dont une avec CSP `script-src 'self'` et une `require-trusted-types-for`) → assert
  `201` + note créée. Le test de l'extension remplace `e2e-loader-check.mjs`, qui ne pouvait pas
  simuler ces CSP sans casser le scénario.
- **Manuel (checklist store)** : 12 sites à forte CSP, page PDF, `chrome://`, iframe cross-origin,
  mode offline, 10 clippings en rafale, Firefox ESR/128, profil vierge.

---

## 14. Ce qu'on ne reprend pas du bookmarklet

| Fonction bookmarklet | Devenir |
|---|---|
| Chat IA embarqué dans la page | reste dans l'app ; une version « côté popup » (phase 4) via relais serveur |
| Réécriture de champs de messagerie (Slack/Gmail) | option `clipboard-inpage` (phase 4), avec validation explicite |
| `window.confirm('Supprimer TOUTES les cartes')` | supprimé du pont ; jamais exposé à un jeton d'extension |
| Configuration `_mn_hub_cfg` dans le `localStorage` du site visité | remplacée par `chrome.storage.local` + jeton serveur |
| `public/bookmarklet.js` (47 Ko de JS dans un template literal) | supprimé ; du TypeScript typé, bundlé, testé |
| 1 200 lignes de CSS injectées | styles de l'extension (Tailwind du `tailwind.config.ts` réutilisable, ou CSS dédié) |
```
