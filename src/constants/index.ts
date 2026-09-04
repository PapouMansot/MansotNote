/**
 * Constantes applicatives — MansotNote
 * -------------------------------------
 * Clés de stockage, réglages par défaut, filtres initiaux et
 * table des raccourcis clavier.
 */
import type {
  AppSettings,
  KanbanFilterState,
  NotesFilterState,
  UIState,
} from '@/types';

/* ------------------------------------------------------------------ */
/* Clés de stockage                                                    */
/* ------------------------------------------------------------------ */

/**
 * Clés localStorage de l'application.
 *
 * ⚠️ `STORAGE_KEYS.theme` est lue par le script inline d'index.html
 * (anti-flash de thème) : ne pas la renommer sans mettre à jour ce
 * fichier.
 */
export const STORAGE_KEYS = {
  /** État persisté complet (PersistedState sérialisé en JSON). */
  state: 'mansotnote.state',
  /** Configuration d'authentification et chiffrement. */
  auth: 'mansotnote.auth',
  /** Coffre chiffré AES-GCM (quand l'auth est active). */
  vault: 'mansotnote.vault',
  /** Préférence de thème ('dark' | 'light' | 'system'). */
  theme: 'mansotnote.theme',
  /** Conversations du Copilote IA (historique persistant). */
  chat: 'mansotnote.chat_conversations',
  /** Identifiant de la conversation active. */
  activeChat: 'mansotnote.active_chat_id',
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

/* ------------------------------------------------------------------ */
/* Réglages par défaut                                                 */
/* ------------------------------------------------------------------ */

/** Débounce de la sauvegarde automatique (ms). */
export const AUTOSAVE_DELAY_MS = 1500;

/**
 * Valeurs IA injectables au build de production. Un navigateur ayant déjà des
 * réglages persistés les conserve ; ces valeurs servent aux nouvelles sessions.
 */
const BUILD_AI_ENDPOINT = import.meta.env.VITE_AI_ENDPOINT ?? '/api/v1/ai';
const BUILD_AI_MODEL = import.meta.env.VITE_AI_MODEL ?? '';
const BUILD_EMBEDDING_MODEL = import.meta.env.VITE_AI_EMBEDDING_MODEL ?? '';

/** Réglages par défaut (thème sombre, éditeur split, autosave activée). */
export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  editorMode: 'split',
  autosaveEnabled: true,
  autosaveDelayMs: AUTOSAVE_DELAY_MS,
  defaultFolderId: null,
  language: 'fr',
  initialView: 'notes',
  aiEndpoint: BUILD_AI_ENDPOINT,
  aiApiKey: '',
  aiModel: BUILD_AI_MODEL,
  aiEmbeddingModel: BUILD_EMBEDDING_MODEL,
  aiKeepAlive: '-1',
};

/** Préréglages IA (endpoint + modèle) pour le formulaire de configuration. */
export const AI_PRESETS: Array<{ id: string; label: string; endpoint: string; model: string; hint: string }> = [
  { id: 'openai', label: 'OpenAI', endpoint: 'https://api.openai.com/v1', model: 'gpt-4o-mini', hint: 'Clé API requise (sk-…)' },
  { id: 'openrouter', label: 'OpenRouter', endpoint: 'https://openrouter.ai/api/v1', model: 'openrouter/auto', hint: 'Clé API requise (sk-or-…)' },
  { id: 'lmstudio', label: 'LM Studio', endpoint: 'http://localhost:1234/v1', model: '', hint: 'Local, gratuit, aucune clé — serveur LM Studio sur le port 1234, puis « Charger les modèles »' },
  { id: 'ollama', label: 'Ollama', endpoint: 'http://localhost:11434/v1', model: 'llama3.1', hint: 'Local, gratuit, aucune clé (ollama serve + modèle installé)' },
];

/** Filtres + tri par défaut de la liste des notes (plus récentes d'abord). */
export const DEFAULT_NOTES_FILTER: NotesFilterState = {
  search: '',
  folderId: 'all',
  tagId: 'all',
  pinnedOnly: false,
  archivedOnly: false,
  sortField: 'updatedAt',
  sortDirection: 'desc',
};

/** Filtres par défaut du board Kanban (rien de sélectionné = tout). */
export const DEFAULT_KANBAN_FILTER: KanbanFilterState = {
  search: '',
  labelIds: [],
  priorities: [],
  showArchived: false,
};

/** État UI initial du store (aucune note ouverte, aucun toast). */
export const DEFAULT_UI_STATE: UIState = {
  view: 'notes',
  sidebarCollapsed: false,
  activeNoteId: null,
  noteDraft: null,
  saveStatus: 'idle',
  saveError: null,
  notesFilter: DEFAULT_NOTES_FILTER,
  kanbanFilter: DEFAULT_KANBAN_FILTER,
  activeCardId: null,
  openColumnMenuId: null,
  collapsedFolderIds: [],
  toasts: [],
};

/* ------------------------------------------------------------------ */
/* Divers                                                              */
/* ------------------------------------------------------------------ */

/** Longueur maximale (caractères) de l'extrait affiché dans la liste des notes. */
export const EXCERPT_MAX_LENGTH = 140;

/** Nombre maximal de toasts affichés simultanément. */
export const MAX_TOASTS = 3;

/* ------------------------------------------------------------------ */
/* Raccourcis clavier                                                  */
/* ------------------------------------------------------------------ */

/**
 * Définition d'un raccourci clavier.
 *
 * `keys` est lu dans l'ordre : modificateurs puis touche principale
 * (lettre minuscule ou chiffre). `mod` = Ctrl sur Windows/Linux,
 * ⌘ (Meta) sur macOS. `shift` / `alt` s'ajoutent comme modificateurs.
 */
export interface KeyboardShortcut {
  /** Identifiant stable — utilisé par useKeyboardShortcuts pour brancher le handler. */
  id: string;
  /** Touches pressées, ex. ['mod', 'n'] ou ['mod', 'shift', 'k']. */
  keys: string[];
  /** Description courte, affichée dans le panneau d'aide. */
  description: string;
}

/** Raccourcis disponibles dans l'application. */
export const KEYBOARD_SHORTCUTS: KeyboardShortcut[] = [
  { id: 'note.new', keys: ['mod', 'n'], description: 'Nouvelle note' },
  { id: 'note.save', keys: ['mod', 's'], description: 'Sauvegarde forcée de la note en cours' },
  { id: 'editor.cycle-mode', keys: ['mod', 'shift', 'e'], description: 'Basculer le mode éditeur (écriture / aperçu / split)' },
  { id: 'search.focus', keys: ['mod', 'k'], description: 'Rechercher' },
  { id: 'card.new', keys: ['mod', 'shift', 'k'], description: 'Nouvelle carte Kanban' },
  { id: 'view.notes', keys: ['mod', '1'], description: 'Aller aux notes' },
  { id: 'view.kanban', keys: ['mod', '2'], description: 'Aller au Kanban' },
  { id: 'view.chat', keys: ['mod', '3'], description: 'Aller au Copilote IA' },
  { id: 'note.correct', keys: ['mod', 'shift', 'c'], description: 'Corriger l’orthographe & style' },
  { id: 'theme.toggle', keys: ['mod', 'shift', 't'], description: 'Basculer le thème clair / sombre' },
];

/** Index des raccourcis par identifiant. */
export const SHORTCUTS_BY_ID: ReadonlyMap<string, KeyboardShortcut> = new Map(
  KEYBOARD_SHORTCUTS.map((shortcut) => [shortcut.id, shortcut]),
);
