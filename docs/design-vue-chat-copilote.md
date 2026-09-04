# Conception — Vue Chat Copilote plein écran (`MainView = 'chat'`)

> Analyse architectural de l'existant et plan d'implémentation détaillé pour
> transformer le Copilote IA (aujourd'hui simple tiroir `AiChatDrawer`) en une
> **vue plein écran** de type ChatGPT/Claude, **sans perdre** l'usage du
> tiroir contextuel pendant l'édition de notes ou du Kanban.

---

## 1. Diagnostic de l'existant

### 1.1 Chaîne de navigation actuelle

```
App.tsx
 ├─ useState(chatOpen)  ──────────────► AiChatDrawer (fixed, z-40, max-w-md)
 ├─ <Sidebar onOpenChat={…} />        ──► icône Sparkles = OUVRE LE TIROIR (pas une vue)
 ├─ FAB "Copilote IA" (bas droite)    ──► idem : tiroir
 └─ main : view === 'notes' ? NotesView : KanbanView   (view: MainView)
```

### 1.2 Constats structurants

| Constat | Preuve | Conséquence pour la conception |
|---|---|---|
| `MainView = 'notes' \| 'kanban'` — union fermée | `src/types/index.ts:84` | Ajouter `'chat'` ⇒ point d'unique vérité ; `setView` accepte déjà n'importe quel `MainView` |
| `chatOpen` vit dans un `useState` local de `App.tsx` | `App.tsx:40` | Inaccessible au store ⇒ **duplicable dans `UIState`** pour que Sidebar, FAB, ChatView et deep-link `?action=chat` pilotent le tiroir |
| L'état de la conversation (messages, input, loading) vit dans `useState` local du drawer | `AiChatDrawer.tsx:97–106` | Une bascule drawer ↔ plein écran **perdrait** la conversation si les deux étaient deux composants distincts ⇒ **remonter la conversation dans le store persisté** |
| `AiChatDrawer` est monolithique : logique métier (prompt système, parsing ```` ```action:* ```` , exécution des actions, RAG) + UI (bulles, composer, réglages) dans 627 lignes | tout le fichier | Extraire un **moteur headless** (`useCopilotChat`) + **composants UI partagés** réutilisables par le drawer ET la vue plein écran |
| Persistance = un seul objet `PersistedState` via `StorageAdapter`, `ui` est transitoire | `store/persist.ts`, `types/index.ts:293` | L'historique des conversations est une **donnée utilisateur** ⇒ il doit vivre dans `data` (persisté, synchronisé remote/SQLite), pas dans `ui` |
| Lecture tolérante : `repairPersistedState` normalise les champs manquants (`local-storage.ts:37`) | idem | **Pas de migration cassante nécessaire** pour ajouter `conversations` ; on normalise `?? []` |
| `bootstrap` valide `initialView` avec un simple `typeof === 'string'` | `app-store.ts:76–79` | Durcir en whitelist ; un utilisateur ayant `initialView:'chat'` retombera sur la nouvelle vue |
| Raccourcis `Ctrl+1` / `Ctrl+2` dans `KEYBOARD_SHORTCUTS` | `constants/index.ts:148–149` | Ajouter `view.chat = Ctrl+3` et `chat.toggleDrawer` |
| Actions 1-clic (`create_note`, `create_cards`, `delete_note`, `delete_all_cards`) appellent `setView('notes'/'kanban')` après exécution | `AiChatDrawer.tsx:371, 395` | Depuis la vue chat plein écran, « Ouvrir la note créée » doit rester cohérent : quitter `chat` → `notes` est le bon comportement (l'utilisateur voit le résultat de l'action) |
| `messagesEndRef.scrollIntoView` n'exécute pas si le drawer est fermé (`open` false ⇒ `return null` mais composant **resté monté**) | `AiChatDrawer.tsx:121–125, 406` | Avec un moteur découplé du rendu, la conversation survit aux fermetures **et** traverse un rechargement (grâce à la persistance) |

### 1.3 Contraintes à ne pas casser

- `isDeleteAllCardsRequest` est **exportée** depuis `AiChatDrawer.tsx` (probablement testée/réutilisée ailleurs) ⇒ la déplacer dans un module `lib` et **ré-exporter** depuis le drawer pour compat.
- Le pont distant `remote-api` (BroadcastChannel/postMessage) et l'action URL `?action=chat` ouvrent actuellement le tiroir ⇒ conserver ce comportement (peut devenir `?action=chat&full=1` pour la vue plein écran, optionnel).
- Thème dark `dark:` partout, classes utilitaires existantes (`field`, `cn`, `Button size/variant`, `IconButton label/icon/active`) ⇒ la nouvelle UI doit les réutiliser.
- `MAX_TOASTS`, `uid(prefix)` (`lib/id.ts`) sont les conventions pour id et toasts.

---

## 2. Architecture cible — principe directeur

> **Un moteur, deux surfaces.**
> La conversation (données) vit dans le **store persisté** ; la logique
> d'envoi/RAG/parsing/exécution vit dans un **hook headless** ; drawer et vue
> plein écran ne sont que deux **habillages** de la même surface de chat.

```
                         ┌────────────────────────────────────────┐
                         │  useAppStore                           │
                         │  data.conversations: ChatConversation[]│  ← persisté (notes/cards style)
                         │  ui.chatDrawerOpen / ui.activeChatId   │  ← transitoire
                         │  chat.actions (createConversation,     │
                         │    appendTurn, executeAction…)         │
                         └───────────────┬────────────────────────┘
                                         │ select/subscribe
                         ┌───────────────▼────────────────────────┐
                         │  useCopilotChat(conversationId)        │  ← moteur headless
                         │  input/loading/ragMode, send(),        │
                         │  buildWorkspaceContext(), parseActions │
                         │  (lib/copilot.ts = fonctions pures)    │
                         └───────┬───────────────────┬────────────┘
                                 │                   │
                    ┌────────────▼──────────┐  ┌─────▼─────────────────────┐
                    │ AiChatDrawer (mince)  │  │ views/ChatView.tsx        │
                    │ aside fixed max-w-md  │  │ plein écran dans <main>   │
                    │ ┌───────────────────┐ │  │ ┌─────────┬─────────────┐ │
                    │ │ CopilotSurface    │ │  │ │Historique│ Copilot     │ │
                    │ │ (variant=drawer)  │◄┼──┼─┤ (w-64)  │ Surface     │ │
                    │ └───────────────────┘ │  │ └─────────┴─────────────┘ │
                    └───────────────────────┘  └───────────────────────────┘
        components/ai/chat/* = briques UI partagées (bulles, composer,
        cartes d'action, suggestions, panneau réglages)
```

**Parcours utilisateur :**

1. **Édition en cours** → FAB ou `Ctrl+Shift+C` → tiroir contextuel (jamais perdu si on le referme ; l'historique est persisté). Bouton « Agrandir » (⤢) dans l'en-tête du tiroir → `setView('chat')` + ferme le tiroir.
2. **Sidebar** → l'entrée « Copilote IA » (Sparkles) devient une **vraie vue** : `setView('chat')` (Ctrl+3). Le tiroir reste accessible via FAB/rail secondaire.
3. **Vue plein écran** → historique des conversations à gauche (comme ChatGPT), colonne de chat centrée, nouvelle conversation, renommage, suppression, recherche dans l'historique ; bouton « Revenir en mode tiroir » dans l'en-tête.

---

## 3. Évolutions des types — `src/types/index.ts`

### 3.1 `MainView`

```ts
/** Vue principale (sidebar gauche). */
export type MainView = 'notes' | 'kanban' | 'chat';
```

`UIState.view: MainView` et `AppSettings.initialView: MainView` **suivent automatiquement** (aucune autre signature à changer — `setView(view: MainView)` est déjà générique).

### 3.2 Types de conversation (nouveaux, section « 3bis. Copilote »)

```ts
/* ============================================================ */
/* 3bis. Copilote IA (conversations persistées)                  */
/* ============================================================ */

/** Proposition d'action générée par le copilote, exécutable en 1 clic. */
export interface CopilotAction {
  type:
    | 'create_note'
    | 'create_cards'
    | 'add_checklist'
    | 'delete_note'
    | 'archive_note'
    | 'delete_all_cards';
  payload: Record<string, unknown>;
  /** true une fois appliquée dans l'espace de travail. */
  executed?: boolean;
}

/** Un tour de conversation (message utilisateur ou assistant). */
export interface ChatTurn {
  id: ID;
  role: 'user' | 'assistant';
  /** Markdown ; bulle utilisateur rendue en texte brut (comme aujourd'hui). */
  content: string;
  /** Action 1-clic attachée à la réponse (drawer + vue plein écran). */
  action?: CopilotAction;
  createdAt: Timestamp;
}

/** Conversation du copilote (équivalent d'une note pour l'IA). */
export interface ChatConversation {
  id: ID;
  /** Titre auto = 40 premiers caractères du 1er message user, sinon « Nouvelle conversation ». */
  title: string;
  turns: ChatTurn[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
  /** Épinglée en tête de l'historique (optionnel, phase 2). */
  pinned?: boolean;
}
```

### 3.3 `PersistedState`

```ts
export interface PersistedState {
  // …existant…
  // Module Copilote
  /** Historique des conversations IA (nouveau champ — normalisé à [] si absent). */
  conversations: ChatConversation[];
}
```

> On **peut** monter `SCHEMA_VERSION` à 2, mais comme `repairPersistedState`
> est tolérant (et le serveur remote renvoie du JSON brut), le vrai travail de
> compat est la normalisation `?? []` — voir §4.5. Monter la version reste
> recommandé pour la lisibilité du schéma.

---

## 4. Évolutions du store

### 4.1 `src/store/types.ts`

Rien à changer (`StoreSet`/`StoreGet` sont typés sur `AppStore`, qui s'étend).

### 4.2 `src/store/ui.actions.ts` — piloter le tiroir + navigation

```ts
import type { ChatConversation, MainView } from '@/types'; // etc.

export interface UiActions {
  setView: (view: MainView) => void;          // inchangé, accepte 'chat'
  // …existant…

  /* ---------- Copilote : tiroir contextuel ---------- */
  openChatDrawer: () => void;
  closeChatDrawer: () => void;
  toggleChatDrawer: () => void;
  /** Bascule drawer ⇄ vue plein écran (garde la même conversation active). */
  expandChatToPage: () => void;
  collapseChatToDrawer: () => void;
}
```

Implémentation (mêmes motifs que `toggleSidebar`) :

```ts
openChatDrawer: () => set((s) => ({ ui: { ...s.ui, chatDrawerOpen: true } })),
closeChatDrawer: () => set((s) => ({ ui: { ...s.ui, chatDrawerOpen: false } })),
toggleChatDrawer: () => set((s) => ({ ui: { ...s.ui, chatDrawerOpen: !s.ui.chatDrawerOpen } })),

expandChatToPage: () => set((s) => ({
  ui: {
    ...s.ui,
    view: 'chat',
    chatDrawerOpen: false,
    // Mémorise la vue d'origine pour le bouton « retour » de ChatView :
    chatReturnView: s.ui.view === 'chat' ? s.ui.chatReturnView : s.ui.view,
  },
})),

collapseChatToDrawer: () => set((s) => {
  const back = s.ui.chatReturnView ?? 'notes';
  return { ui: { ...s.ui, view: back, chatDrawerOpen: true } };
}),
```

### 4.3 `UIState` — nouveaux champs transitoires

```ts
export interface UIState {
  view: MainView;
  // …existant…

  /* --- Module Copilote --- */
  /** Tiroir IA ouvert (déplacé depuis useState App.tsx:40). */
  chatDrawerOpen: boolean;
  /** Conversation active (partagée drawer ⇄ plein écran). */
  activeConversationId: ID | null;
  /** Vue à restaurer quand on replie le plein écran dans le tiroir. */
  chatReturnView: MainView | null;
  /** Panneau d'historique des conversations visible dans ChatView. */
  chatHistoryOpen: boolean;
}
```

`DEFAULT_UI_STATE` (`src/constants/index.ts`) :

```ts
chatDrawerOpen: false,
activeConversationId: null,
chatReturnView: null,
chatHistoryOpen: true,
```

### 4.4 Nouveau fichier — `src/store/chat.actions.ts`

Calqué sur `createNotesActions` / `createKanbanActions` (même fabrique, `schedulePersist` après mutation de `data`) :

```ts
export interface ChatActions {
  /** Crée une conversation vide et la rend active ; retourne son id. */
  createConversation: () => ID;
  /** Supprime définitivement (ConfirmModal côté UI). */
  deleteConversation: (id: ID) => void;
  renameConversation: (id: ID, title: string) => void;
  setActiveConversation: (id: ID | null) => void;
  /** Vide les tours sans supprimer la conversation (= « Réinitialiser » du drawer). */
  clearConversation: (id: ID) => void;
  /** Ajoute un tour ; auto-titre si 1er message user ; bump updatedAt. */
  appendTurn: (conversationId: ID, turn: Omit<ChatTurn, 'createdAt'>) => void;
  /** Marque action.executed = true après application dans l'espace de travail. */
  markTurnActionExecuted: (conversationId: ID, turnId: ID) => void;
}

export function createChatActions(set: StoreSet, get: StoreGet): ChatActions {
  return {
    createConversation: () => {
      const id = uid('conv');
      const now = Date.now();
      const conv: ChatConversation = {
        id,
        title: 'Nouvelle conversation',
        turns: [{
          id: uid('turn'),
          role: 'assistant',
          content: WELCOME_MESSAGE,           // constant déplacée dans lib/copilot.ts
          createdAt: now,
        }],
        createdAt: now,
        updatedAt: now,
      };
      set((s) => ({
        data: { ...s.data, conversations: [conv, ...s.data.conversations] },
        ui: { ...s.ui, activeConversationId: id },
      }));
      schedulePersist(set, get);
      return id;
    },
    // … delete/rename/appendTurn sur le même modèle (map/filter sur data.conversations)
  };
}
```

> **NB — message de bienvenue** : aujourd'hui identifié par `id: 'welcome'` et
> filtré avec `messages.filter((m) => m.id !== 'welcome')` avant l'appel IA
> (`AiChatDrawer.tsx:292`). Avec la persistance, on garde la convention : le
> tour `role:'assistant'` **créé par `createConversation`** porte un flag
>implicite (premier tour assistant) et le filtre devient
> `turns.filter((t) => !(t.role === 'assistant' && t.id === turns[0].id))`.
> Plus simple : ajouter `ChatTurn.system?: boolean` (non envoyé à l'IA, non
> compté pour le titre). Recommandé.

Branchement dans `src/store/app-store.ts` :

```ts
import { createChatActions, type ChatActions } from './chat.actions';

export interface AppStore extends AppState, NotesActions, KanbanActions, UiActions, ChatActions { … }

// dans create():
...createNotesActions(set, get),
...createKanbanActions(set, get),
...createUiActions(set, get),
...createChatActions(set, get),   // ← nouveau
```

### 4.5 Compat de chargement (3 points précis)

`src/storage/local-storage.ts` → `repairPersistedState` :

```ts
const conversations = Array.isArray(v.conversations) ? v.conversations : [];
// …
return { …, conversations, settings };
```

`src/store/app-store.ts` → `bootstrap` :

```ts
// validation stricte de initialView (avant : simple typeof string)
const VALID_VIEWS: readonly MainView[] = ['notes', 'kanban', 'chat'];
const initialView = VALID_VIEWS.includes(loaded.settings?.initialView as MainView)
  ? (loaded.settings.initialView as MainView)
  : DEFAULT_UI_STATE.view;

set({
  data: { ...loaded, conversations: loaded.conversations ?? [], notes: cleanedNotes, settings: … },
  ui: { ...DEFAULT_UI_STATE, view: initialView },
  // …
});
```

`src/lib/seed.ts` → `createEmptyState()` (et `createSeedState()` si pertinent) : ajouter `conversations: []`.

### 4.6 Raccourcis — `src/constants/index.ts` + `hooks/useKeyboardShortcuts.ts`

```ts
{ id: 'view.chat', keys: ['mod', '3'], description: 'Ouvrir le Copilote IA (vue plein écran)' },
{ id: 'chat.toggleDrawer', keys: ['mod', 'shift', 'c'], description: 'Ouvrir/fermer le tiroir Copilote' },
```

Dans `useAppShortcuts()` :

```ts
'view.chat': () => useAppStore.getState().setView('chat'),
'chat.toggleDrawer': () => useAppStore.getState().toggleChatDrawer(),
```

---

## 5. Le moteur : extraction hors du drawer

### 5.1 `src/lib/copilot.ts` — fonctions pures (déplacées depuis `AiChatDrawer.tsx`)

À déplacer telles quelles (aucune dépendance React) :

| Symbole actuel | Nouvelle maison |
|---|---|
| `isDeleteAllCardsRequest` (`AiChatDrawer.tsx:70`) | `lib/copilot.ts` — **ré-exporté** depuis `AiChatDrawer.tsx` pour ne casser aucun import existant |
| `QUICK_PROMPTS` | `lib/copilot.ts` |
| Message de bienvenue (`:102`) | `WELCOME_MESSAGE` dans `lib/copilot.ts` |
| `buildWorkspaceContext` (méthode locale, dépend notes/cards/columns) | `buildCopilotSystemPrompt(notes, columns, cards, ragContext: string)` — **pur**, passe les données en arguments |
| `parseActionsFromResponse` | `parseCopilotAction(text): { cleanContent: string; action?: CopilotAction }` |
| Types `ActionProposal` / `AssistantTurn` | remplacés par `CopilotAction` / `ChatTurn` de `@/types` (plus de doublon) |

Bénéfice : testable avec le script `smoke` d'esbuild existant (`package.json` inclut déjà `src/lib/ai.ts` dans le bundle de smoke — `copilot.ts` s'y ajoute naturellement).

### 5.2 `src/hooks/useCopilotChat.ts` — hook headless partagé

```ts
export interface CopilotChatApi {
  conversation: ChatConversation | null;
  input: string;
  setInput: (v: string) => void;
  loading: boolean;
  configured: boolean;
  ragMode: 'hybrid' | 'bm25';
  aiValues: ReturnType<typeof resolveAiSettings>;
  showSettings: boolean;
  setShowSettings: (v: boolean) => void;
  /** Envoie `customPrompt ?? input` à l'IA dans la conversation active. */
  send: (customPrompt?: string) => Promise<void>;
  stop: () => void;                        // AbortController (voir §9 extensions)
  reset: () => void;                       // clearConversation + nouveau fil
  executeAction: (turnId: string, action: CopilotAction) => void;
  newConversation: () => void;
}

export function useCopilotChat(): CopilotChatApi { … }
```

Contenu : reprise directe de `handleSend` (`AiChatDrawer.tsx:248–337`) et
`executeAction` (`:339–404`) — **une seule écriture de ces ~150 lignes**,
mais :

- `setMessages(...)` local → `appendTurn(activeId, …)` / `markTurnActionExecuted` (store) ;
- `messages` local → sélecteur `data.conversations.find(c => c.id === ui.activeConversationId)` ;
- Lazy-init : au premier usage (drawer ouvert ou ChatView monté), si
  `activeConversationId === null` ou conversation absente/vide → `createConversation()` (le drawer « rouvre » donc toujours sur la même conversation, **y compris après rechargement de page** — amélioration gratuite par rapport à l'existant) ;
- Historique envoyé à l'IA : `conversation.turns.filter(t => !t.system).slice(-8)` (mêmes sémantiques qu'actuellement) ;
- `executeAction` garde les `state.setView('notes' | 'kanban')` (`:371`, `:395`) — depuis ChatView cela éjecte vers la vue cible, ce qui est le comportement souhaité (« j'ai créé la note, regarde-la »). Pour un mode « rester dans le chat », prévoir dans la carte d'action un lien secondaire « Ouvrir » distinct du bouton « Appliquer » (phase 2).

---

## 6. Briques UI partagées — nouveau dossier `src/components/ai/chat/`

Découpage de l'actuel JSX du drawer en composants **présentationnels**, pilotés par un `variant: 'drawer' | 'page'` :

| Composant | Extraite de | Rôle / diffs drawer ⇄ page |
|---|---|---|
| `CopilotHeader.tsx` | drawer `:413–453` | Logo Sparkles, badge `Modèle… · RAG…`, boutons réglages / reset. **Props additionnelles selon variant** : drawer → `Maximize2` (« Vue plein écran »), page → `PanelLeftClose` (« Retour à la vue ») + `History` (toggle historique). `onClose` : drawer → `closeChatDrawer`, page → `setView(chatReturnView)` |
| `AiSettingsPanel.tsx` | drawer `:456–475` | Enveloppe existante de `AiSettingsFields` (déjà partagé avec `AiNoteModal`/`AiTransformModal` — ne pas toucher à `AiSettingsFields`) |
| `ChatMessagesList.tsx` | drawer `:478–574` | Scroll + auto-scroll (`messagesEndRef` → ici), rend `ChatTurnBubble` par tour + indicateur `loading` |
| `ChatTurnBubble.tsx` | drawer `:479–563` | Label « Moi / Copilote », bulle user (`bg-indigo-600`) ou assistant (`MarkdownRenderer`), `ActionProposalCard` en dessous. **Variant page** : `text-sm` (au lieu de `text-xs`), `max-w-2xl`, avatars `Bot`/`User` 24px, espace vertical `space-y-6` |
| `ActionProposalCard.tsx` | drawer `:513–562` | Carte indigo « Créer la note : « … » » + Button Appliquer/Confirmer/« Action appliquée » (réutilise `Button variant danger/primary size sm`) |
| `ChatComposer.tsx` | drawer `:598–624` | **Drawer** : `<input>` 1 ligne tel quel. **Page** : `<textarea>` auto-grow (1→6 lignes, `rows` via scrollHeight), `Enter` = envoyer, `Shift+Enter` = newline, compteur de tokens approximatif, bouton `Square` stop pendant `loading`, hints « Markdown pris en charge » |
| `ChatSuggestions.tsx` | drawer `:577–595` | `QUICK_PROMPTS`. **Drawer** : chips compactes visibles si ≤ 2 tours. **Page** : **state vide en hero** — grille 2×2 de cartes cliquables (icônes `Rocket`/`ListChecks`/`PenLine`/`ChartNoAxesCombined`) + « réviser les suggestions » tant que la conversation n'a qu'un tour |

Ces composants ne touchent **jamais** le store directement (sauf sélecteurs
de lecture) : ils reçoivent `chat: CopilotChatApi` en prop — un seul point de
câblage par surface.

---

## 7. `src/views/ChatView.tsx` — la vue plein écran

### 7.1 Layout (3 zones, responsive)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Sidebar │ Historique     │            Colonne chat centrée               │
│ (exist.)│ (w-60, toggled │  ┌────────────────────────────────────────┐   │
│         │  via ui.       │  │ CopilotHeader (variant="page")         │   │
│         │ chatHistoryOpen)│  ├────────────────────────────────────────┤   │
│         │                │  │  max-w-2xl mx-auto                     │   │
│         │ ┌────────────┐ │  │  Nouv. conversation (bouton)           │   │
│         │ │ [+ Nouvelle│ │  │  ChatMessagesList                      │   │
│         │ │ │  conv.]  │ │  │   [avatar] bulle…                      │   │
│         │ │ conv. 1    │ │  │   [avatar] bulle… + ActionCard         │   │
│         │ │ conv. 2 ←act│ │  │  (state vide → ChatSuggestions hero)  │   │
│         │ │ …          │ │  ├────────────────────────────────────────┤   │
│         │ │ (recherche)│ │  │  AiSettingsPanel (si showSettings)     │   │
│         │ └────────────┘ │  │  ChatComposer (textarea auto-grow)     │   │
│         │                │  └────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Squelette

```tsx
export function ChatView() {
  const chat = useCopilotChat();
  const conversations = useAppStore((s) => s.data.conversations);
  const activeId = useAppStore((s) => s.ui.activeConversationId);
  const historyOpen = useAppStore((s) => s.ui.chatHistoryOpen);
  const setView = useAppStore((s) => s.setView);
  const collapse = useAppStore((s) => s.collapseChatToDrawer);
  const returnView = useAppStore((s) => s.ui.chatReturnView);

  return (
    <div className="flex h-full min-w-0">
      {historyOpen && <ChatHistoryPanel conversations={conversations} activeId={activeId} />}

      <div className="flex min-w-0 flex-1 flex-col">
        <CopilotHeader
          variant="page"
          chat={chat}
          onToggleHistory={() => toggleChatHistory()}
          onReturn={() => setView(returnView ?? 'notes')}   // flèche ← en-tête
          onCollapseToDrawer={collapse}                     // bouton « Mode tiroir »
        />
        <ChatMessagesList chat={chat} variant="page" />
        {chat.showSettings && <AiSettingsPanel chat={chat} />}
        <ChatComposer chat={chat} variant="page" />
      </div>
    </div>
  );
}
```

### 7.3 `ChatHistoryPanel.tsx` (nouveau, `src/components/ai/chat/`)

- Liste triée par `updatedAt desc`, lignes : titre + `formatRelative(updatedAt)` (`lib/dates.ts`, déjà utilisé par NotesView) + nb de tours.
- Ligne active : mêmes classes que `NavItem` (`bg-indigo-500/15 …`), **réutilisation des patterns Sidebar** :
  - double-clic → renommage inline (`<input className="field …">`, `Enter`/`Escape`/`onBlur` → `renameConversation`) — copier le motif `FolderNode` (`Sidebar.tsx:198–214`) ;
  - `Menu` (`components/ui/Menu`) avec ⋯ au survol : « Renommer », « Supprimer » (`danger` → `ConfirmModal`, motif `Sidebar.tsx:287–298`).
- Bouton « Nouvelle conversation » (`Plus`, `Button className="w-full"` comme « Nouvelle note » `Sidebar.tsx:486`).
- `SearchInput` (`components/ui/Input`) filtrant sur les titres **et** le contenu des tours (client-side, dataset petit) + recherche plein texte des conversations : phase 2, réutiliser l'inverted index BM25 de `lib/retrieval.ts` en indexant `turns` si besoin.
- Responsive : sous `lg`, le panneau devient un overlay `absolute inset-y-0 left-0 z-20 w-64 shadow-xl` fermé au clic sur une conversation.

---

## 8. Refonte du drawer + intégrations

### 8.1 `AiChatDrawer.tsx` après refactor (~90 lignes restantes)

```tsx
export { isDeleteAllCardsRequest } from '@/lib/copilot'; // compat imports existants

export function AiChatDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const chat = useCopilotChat();
  const expand = useAppStore((s) => s.expandChatToPage);
  // auto-scroll conservé via ChatMessagesList (ref interne)
  if (!open) return null;
  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l … sm:w-[420px]">
      <CopilotHeader variant="drawer" chat={chat} onClose={onClose} onExpand={expand} />
      {chat.showSettings && <AiSettingsPanel chat={chat} />}
      <ChatMessagesList chat={chat} variant="drawer" />
      {chat.conversation && chat.conversation.turns.length <= 2 && <ChatSuggestions chat={chat} variant="drawer" />}
      <ChatComposer chat={chat} variant="drawer" />
    </aside>
  );
}
```

L'en-tête du drawer gagne le bouton `Maximize2` (« Vue plein écran ») —
`onClick={onExpand}`. `onClose` passe à `closeChatDrawer`.

### 8.2 `App.tsx`

```tsx
// supprimer : const [chatOpen, setChatOpen] = useState(false);
const chatDrawerOpen = useAppStore((s) => s.ui.chatDrawerOpen);
const openChatDrawer = useAppStore((s) => s.openChatDrawer);
const closeChatDrawer = useAppStore((s) => s.closeChatDrawer);

// deep-link : action === 'chat' → openChatDrawer()  (comportement inchangé)

<main className="min-w-0 flex-1">
  <ErrorBoundary label="Vue principale">
    {view === 'notes' && <NotesView />}
    {view === 'kanban' && <KanbanView />}
    {view === 'chat' && <ChatView />}
  </ErrorBoundary>
</main>

{/* FAB : caché si tiroir ouvert OU si on est déjà dans la vue plein écran */}
{!chatDrawerOpen && view !== 'chat' && (
  <button onClick={openChatDrawer} …>Copilote IA</button>
)}

<AiChatDrawer open={chatDrawerOpen} onClose={closeChatDrawer} />
```

Optionnel (fortement recommandé pour l'UX) : le tiroir est **désactivé** quand
`view === 'chat'` (double chat = confusion). `openChatDrawer()` ne fait rien
si `ui.view === 'chat'`, ou mieux : dans ChatView, le FAB est remplacé par
rien et `?action=chat` ouvre aussi `setView('chat')`.

### 8.3 `Sidebar.tsx`

**Barre large** — transformer le bouton actuel (`:514–526`, `onClick={onOpenChat}`) :

```tsx
<NavItem
  icon={<Sparkles size={16} className="text-indigo-600 dark:text-indigo-400" />}
  label="Copilote IA"
  hint="Ctrl+3"
  active={view === 'chat'}
  onClick={() => setView('chat')}        // ← VUE PLEIN ÉCRAN
/>
{/* Option : petit déclencheur tiroir collé à droite de la ligne au survol */}
```

Idéalement, un IconButton discret `MessageSquare` (tooltip « Chat contextuel (tiroir) »)
apparaît à droite de la ligne au `group-hover` et appelle `onOpenChat` — deux
entrées, deux modes, aucune ambiguïté.

**Rail replié** — l'`IconButton` `:430–436` (`label="Copilote IA (Chat)"`, `onClick={onOpenChat}`) devient `active={view === 'chat'}` + `onClick={() => setView('chat')}`.

**Contrat de prop** : `onOpenChat` reste (ouvre le tiroir, piloté par le store)
mais devient optionnel — `SidebarProps.onOpenChat?: () => void` existe déjà.
À terme, `onOpenChat` peut être supprimé au profit de `useAppStore(s => s.openChatDrawer)` directement dans Sidebar (moins de plumbing dans App).

---

## 9. Extensions prévues (hors périmètre phase 1, mais architecture prête)

1. **Interruption du stream** : `chatComplete` (`lib/ai.ts:65+`) accepte une option `signal?: AbortSignal` à ajouter dans `ChatOptions` → `chat.stop()` dans le composer (bouton carré rouge).
2. **Streaming des tokens** : ajouter `onDelta` dans `lib/ai.ts` + `appendTurnDelta` dans le store (buffer local d'abord, commit store en fin de stream pour éviter 500 persist).
3. **Persistance des actions proposées** : déjà fait (`ChatTurn.action`) — bouton « Rejouer » si `executed` mais note supprimée.
4. **Recherche sémantique dans l'historique** : indexer `conversations` avec `retrieveContextHybrid` (le RAG notes est déjà hybride embeddings+BM25 — `lib/retrieval.ts`).
5. **Contexte « note active »** : le composer plein écran pourrait afficher une puce « 📎 Note en cours : X » injectée dans le prompt système (donnée déjà dispo : `ui.activeNoteId`).
6. **Deep link** `?action=chat&view=full` → `setView('chat')`.

---

## 10. Plan d'implémentation séquencé

| Étape | Fichiers | Contenu | Verif. |
|---|---|---|---|
| **P1. Types & store** | `types/index.ts`, `constants/index.ts`, `store/ui.actions.ts`, `store/chat.actions.ts` (new), `store/app-store.ts`, `storage/local-storage.ts`, `lib/seed.ts` | `MainView +'chat'`, UIState champs, ChatActions, repair `conversations ?? []`, validation `initialView` | `pnpm typecheck` ; bootstrap d'un état v1 existant ne casse pas |
| **P2. Moteur** | `lib/copilot.ts` (new), `hooks/useCopilotChat.ts` (new), `AiChatDrawer.tsx` | Déplacement pur des fonctions + hook ; drawer **provisoirement** branché sur `useCopilotChat` avec ses anciennes props | Le drawer fonctionne exactement comme avant, mais les messages survivent à un reload (persist) |
| **P3. Briques UI** | `components/ai/chat/*` (7 fichiers) | Extraction JSX incrémentale, `variant` | Capture des diffs visuelles drawer |
| **P4. ChatView** | `views/ChatView.tsx`, `components/ai/chat/ChatHistoryPanel.tsx` | Layout §7, historique, composer page | Ctrl+3 ; bascule ⤢ ; retour ; nouveau chat |
| **P5. Intégration** | `App.tsx`, `Sidebar.tsx`, `useKeyboardShortcuts.ts`, `constants` (raccourcis) | `chatDrawerOpen` store, FAB, nav, raccourcis | Parcours complets §2 |
| **P6. Polissage** | — | Focus piège drawer, `Escape` ferme tiroir, aria-labels, responsive `lg` overlay historique, garde « no-op si view==='chat' » | Test mobile + dark/light |

**Estimation de taille** : ≈ 1 200 lignes déplacées/créées, ≈ 250 lignes
supprimées du monolithe `AiChatDrawer` (627 → ~90).

---

## 11. Risques & mitigations

| Risque | Mitigation |
|---|---|
| Perte de l'auto-scroll au montage du drawer (`open` gate actuel) | `ChatMessagesList` gère son propre `scrollIntoView` sur `[messages.length, loading]` + un `scrollTo` effectif quand la surface passe de masquée à visible (le drawer retourne `null` fermé ⇒ remontage = effet de montage naturel) |
| `schedulePersist` sur chaque tour → écritures fréquentes du `data` complet (remote PUT) | Le debouncer partagé (`persist.ts`) lisse déjà ; optionnel : ne persister les tours qu'en fin de réponse assistant (pas à chaque keystroke — l'input reste local au hook, jamais dans `data`) |
| Deux conversations « actives » si on ouvre le tiroir pendant que ChatView montre une autre conversation | **Conçu comme un feature** : c'est *la même* conversation partagée (single active id) ; le tiroir affiche simplement ce que voit ChatView. Si indésirable, phase 2 : « conversation détachée » par surface |
| Imports existants de `ActionProposal`/`AssistantTurn` ailleurs dans la base (vérifier via grep) | Ré-export type-only depuis `AiChatDrawer.tsx` le temps d'une release |
| `repairPersistedState` côté serveur remote (`server/` renvoie le JSON stocké sans repair) | La normalisation est aussi faite dans `bootstrap` (défensif, double filet) |
| Régression `?action=chat` Web Clipper | Le branchement ne change que la source d'état (useState → store), pas la sémantique |

---

## 12. Arborescence finale des fichiers impactés

```
src/
├─ types/index.ts                    ± MainView, CopilotAction, ChatTurn, ChatConversation, PersistedState, UIState
├─ constants/index.ts                ± DEFAULT_UI_STATE, KEYBOARD_SHORTCUTS (+Ctrl+3, Ctrl+Shift+C), WELCOME_MESSAGE?
├─ lib/
│  ├─ copilot.ts                     ★ nouveau (prompts purs, parse, quick prompts, isDeleteAllCardsRequest)
│  └─ seed.ts                        ± conversations: []
├─ storage/local-storage.ts          ± repair : conversations ?? []
├─ store/
│  ├─ ui.actions.ts                  ± chatDrawer/expand/collapse + UIState
│  ├─ chat.actions.ts                ★ nouveau
│  └─ app-store.ts                   ± wiring ChatActions + validation initialView
├─ hooks/
│  ├─ useCopilotChat.ts              ★ nouveau (moteur partagé)
│  └─ useKeyboardShortcuts.ts        ± view.chat, chat.toggleDrawer
├─ components/ai/
│  ├─ AiChatDrawer.tsx               − refactor 627 → ~90 lignes
│  └─ chat/                          ★ nouveau dossier
│     ├─ CopilotHeader.tsx           ★
│     ├─ AiSettingsPanel.tsx         ★
│     ├─ ChatMessagesList.tsx        ★
│     ├─ ChatTurnBubble.tsx          ★
│     ├─ ActionProposalCard.tsx      ★
│     ├─ ChatComposer.tsx            ★
│     ├─ ChatSuggestions.tsx         ★
│     └─ ChatHistoryPanel.tsx        ★
├─ views/
│  └─ ChatView.tsx                   ★ nouveau
├─ components/layout/Sidebar.tsx     ± NavItem/Rail → setView('chat'), + déclencheur tiroir optionnel
└─ App.tsx                           ± chatOpen→store, render ChatView, FAB gating
```

(★ = nouveau · ± = modifié · − = refactor majeur)
