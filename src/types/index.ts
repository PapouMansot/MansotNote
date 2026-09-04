/**
 * MansotNote — source unique de vérité des types
 * --------------------------------------------------
 * Couvre : Notes (édition, organisation), Kanban (board, cartes),
 * persistance (schéma versionné, adapter) et état applicatif
 * transitoire (UI, brouillon, filtres).
 *
 * Conventions :
 *  - Identifiants : simples strings (générés via nanoid, voir src/lib/id.ts).
 *  - Horodatages  : `Timestamp` = millisecondes epoch (Date.now()) →
 *                   trivials à trier et comparer.
 *  - Échéances    : date seule au format ISO 'YYYY-MM-DD' (pas d'heure).
 *  - Couleurs     : code hex '#RRGGBB' (COLOR_PALETTE fournit la palette
 *                   recommandée pour tags/étiquettes).
 *
 * Ce fichier exporte aussi quelques constantes `as const` qui fondent les
 * unions de types (CODE_LANGUAGES, PRIORITIES, SCHEMA_VERSION…).
 */

/* ============================================================ */
/* 1. Communs                                                    */
/* ============================================================ */

/** Identifiant stable de toute entité (note, dossier, tag, carte…). */
export type ID = string;

/** Horodatage = millisecondes epoch (Date.now()). */
export type Timestamp = number;

/** Sens de tri d'une liste. */
export type SortDirection = 'asc' | 'desc';

/** Jeton de couleur : code hex ou nom de thème. */
export type ColorToken = string;

/** Palette par défaut pour tags et étiquettes Kanban. */
export const COLOR_PALETTE = [
  '#ef4444', // rouge
  '#f97316', // orange
  '#f59e0b', // ambre
  '#84cc16', // vert lime
  '#10b981', // émeraude
  '#06b6d4', // cyan
  '#3b82f6', // bleu
  '#8b5cf6', // violet
  '#ec4899', // rose
  '#64748b', // ardoise
] as const;

/** Couleur de la palette par défaut. */
export type PaletteColor = (typeof COLOR_PALETTE)[number];

/**
 * Nom lisible de chaque couleur de la palette.
 * Les noms n'existaient qu'en commentaires : inexploitables par l'interface,
 * qui affichait donc « Couleur » pour les dix teintes.
 */
export const COLOR_NAMES: Record<string, string> = {
  '#ef4444': 'Rouge',
  '#f97316': 'Orange',
  '#f59e0b': 'Ambre',
  '#84cc16': 'Vert lime',
  '#10b981': 'Émeraude',
  '#06b6d4': 'Cyan',
  '#3b82f6': 'Bleu',
  '#8b5cf6': 'Violet',
  '#ec4899': 'Rose',
  '#64748b': 'Ardoise',
};

/** Nom lisible d'une couleur, avec repli sur le code hex. */
export function colorName(color: string): string {
  return COLOR_NAMES[color.toLowerCase()] ?? color;
}

/* ============================================================ */
/* 2. Affichage & navigation                                     */
/* ============================================================ */

/** Thème de l'interface. 'system' suit la préférence OS. */
export type ThemeMode = 'dark' | 'light' | 'system';

/** Vue principale (sidebar gauche). */
export type MainView = 'notes' | 'kanban' | 'chat';

/** Mode de l'éditeur de notes.
 *  - 'edit'    : source Markdown uniquement ;
 *  - 'preview' : rendu uniquement ;
 *  - 'split'   : côte à côte (mode hybride).
 */
export type EditorMode = 'edit' | 'preview' | 'split';

/* ============================================================ */
/* 3. Notes                                                      */
/* ============================================================ */

/** Dossier d'organisation des notes. Imbrication via `parentId` (null = racine). */
export interface Folder {
  id: ID;
  name: string;
  /** Dossier parent, null si racine. */
  parentId: ID | null;
  /** Position manuelle dans le parent (ordre croissant). */
  order: number;
  createdAt: Timestamp;
}

/** Tag coloré, appliquable à plusieurs notes. */
export interface Tag {
  id: ID;
  name: string;
  color: ColorToken;
  createdAt: Timestamp;
}

/** Note : document Markdown + métadonnées. */
export interface Note {
  id: ID;
  /** Titre affiché (repli : premier heading, sinon « Sans titre »). */
  title: string;
  /** Contenu complet en Markdown (code fences, tableaux, listes…). */
  content: string;
  /** Dossier contenant, null = « sans dossier ». */
  folderId: ID | null;
  /** Ids des tags appliqués (réf. Tag). */
  tagIds: ID[];
  /** Épinglée en haut de la liste. */
  pinned: boolean;
  /** Archivée (masquée par défaut sauf filtre archives). */
  archived?: boolean;
  /** Horodatage d'archivage. */
  archivedAt?: Timestamp | null;
  createdAt: Timestamp;
  /** Dernière modification (contenu ou métadonnées). */
  updatedAt: Timestamp;
}

/** Langues proposées par le sélecteur de blocs de code. */
export const CODE_LANGUAGES = [
  'bash',
  'powershell',
  'python',
  'sql',
  'yaml',
  'javascript',
  'typescript',
  'json',
  'html',
  'css',
  'c',
  'cpp',
  'csharp',
  'go',
  'java',
  'kotlin',
  'ruby',
  'rust',
  'php',
  'toml',
  'ini',
  'markdown',
  'plaintext',
] as const;

export type CodeLanguage = (typeof CODE_LANGUAGES)[number];

/* ============================================================ */
/* 4. Kanban                                                     */
/* ============================================================ */

/** Priorités d'une carte, par poids croissant. */
export const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

export type Priority = (typeof PRIORITIES)[number];

/** Étiquette colorée partagée entre cartes. */
export interface KanbanLabel {
  id: ID;
  name: string;
  color: ColorToken;
  createdAt: Timestamp;
}

/** Sous-tâche d'une checklist de carte. */
export interface ChecklistItem {
  id: ID;
  title: string;
  done: boolean;
  /** Position dans la checklist (ordre croissant). */
  order: number;
}

/** Colonne du board. Colonne par défaut : « À faire / En cours / Terminé ». */
export interface KanbanColumn {
  id: ID;
  title: string;
  /** Position de la colonne sur le board (ordre croissant). */
  order: number;
  createdAt: Timestamp;
}

/** Carte Kanban. */
export interface KanbanCard {
  id: ID;
  /** Colonne contenant la carte. */
  columnId: ID;
  /** Position de la carte dans sa colonne (ordre croissant). */
  order: number;
  title: string;
  /** Description en Markdown. */
  description: string;
  /** Ids des étiquettes appliquées (réf. KanbanLabel). */
  labelIds: ID[];
  priority: Priority;
  /** Date d'échéance 'YYYY-MM-DD', ou null. */
  dueDate: string | null;
  /** Sous-tâches, ordonnées. */
  checklist: ChecklistItem[];
  /** Id de la note liée (lien Notes ↔ Kanban), ou null. */
  linkedNoteId: ID | null;
  /** Archivée (masquée par défaut du board). */
  archived?: boolean;
  /** Horodatage d'archivage. */
  archivedAt?: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Payloads de drag & drop (dnd-kit). */
export interface CardDragPayload {
  type: 'card';
  cardId: ID;
  fromColumnId: ID;
}

export interface ColumnDragPayload {
  type: 'column';
  columnId: ID;
}

export type KanbanDragPayload = CardDragPayload | ColumnDragPayload;

/* ============================================================ */
/* 5. Persistance                                                */
/* ============================================================ */

/** Version courante du schéma — utilisée par les migrations. */
export const SCHEMA_VERSION = 1;

/** Métadonnées du jeu de données d'exemple (premier lancement). */
export interface SeedMeta {
  installedAt: Timestamp;
  /** Version du seed (permet de proposer une mise à jour). */
  seedVersion: number;
}

/** Paramètres globaux de l'application (persistés). */
export interface AppSettings {
  /** Thème de l'interface. */
  theme: ThemeMode;
  /** Mode de l'éditeur appliqué à l'ouverture d'une note. */
  editorMode: EditorMode;
  /** Sauvegarde automatique activée. */
  autosaveEnabled: boolean;
  /** Débounce de la sauvegarde automatique (ms). */
  autosaveDelayMs: number;
  /** Dossier par défaut des nouvelles notes, null pour aucun. */
  defaultFolderId: ID | null;
  /** Langue de l'interface. */
  language: 'fr' | 'en';
  /** Vue ouverte au démarrage. */
  initialView: MainView;
  /**
   * IA (client compatible OpenAI) — `endpoint` est l'URL de base
   * (ex. https://api.openai.com/v1, http://localhost:11434/v1),
   * `apiKey` vide si non requis (Ollama), `model` le modèle utilisé.
   */
  aiEndpoint: string;
  aiApiKey: string;
  aiModel: string;
  /**
   * Modèle d'embedding compatible OpenAI (`/v1/embeddings`). Vide : RAG BM25
   * uniquement. Exemple Ollama : `qwen3-embedding:0.6b-8k`.
   */
  aiEmbeddingModel: string;
  /** Rétention du modèle en mémoire pour Ollama (ex: '-1' pour indéfini, '24h', '1h', '5m'). */
  aiKeepAlive?: string;
}

/**
 * État persisté complet : l'objet unique sérialisé vers le backend
 * (localStorage, IndexedDB ou API distante Node + SQLite).
 * Sa forme est identique quel que soit le backend.
 */
export interface PersistedState {
  /** Version du schéma pour migration (voir SCHEMA_VERSION). */
  schemaVersion: number;
  /** Date de la dernière sauvegarde réussie. */
  savedAt: Timestamp;
  /** Présents si le jeu de données d'exemple a été installé. */
  seed: SeedMeta | null;

  // Module Notes
  notes: Note[];
  folders: Folder[];
  tags: Tag[];

  // Module Kanban
  columns: KanbanColumn[];
  cards: KanbanCard[];
  labels: KanbanLabel[];

  // Réglages globaux
  settings: AppSettings;
}

/**
 * Adapter de stockage : unique frontière entre l'application et le
 * backend (localStorage / IndexedDB / Node+SQLite). Le reste du code ne
 * dépend jamais du choix de persistance, uniquement de cette interface.
 */
export interface StorageAdapter {
  /** Identifiant du backend, pour affichage et diagnostics. */
  readonly id: 'local-storage' | 'indexed-db' | 'remote';
  /** Charge l'état persisté ; null s'il n'existe pas encore. */
  load(): Promise<PersistedState | null>;
  /** Sauvegarde l'état complet (remplacement atomique). */
  save(state: PersistedState): Promise<void>;
  /** Supprime l'état persisté (réinitialisation). */
  clear(): Promise<void>;
  /** true si le backend est utilisable dans le contexte courant. */
  isAvailable(): boolean;
}

/* ============================================================ */
/* 6. État transitoire (UI)                                      */
/* ============================================================ */

/** Statut de sauvegarde du brouillon de note courant. */
export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

/** Note en cours d'édition dans l'éditeur (éventuellement non sauvée). */
export interface NoteDraft {
  /** null = nouvelle note, id pas encore alloué. */
  noteId: ID | null;
  title: string;
  content: string;
  /** true si le brouillon diffère de la dernière version sauvegardée. */
  dirty: boolean;
  savedAt: Timestamp | null;
}

/** Champ par lequel trier la liste des notes. */
export type NoteSortField = 'updatedAt' | 'createdAt' | 'title';

/** Valeur du filtre dossier : un id de dossier, tous, ou « sans dossier ». */
export type FolderFilterValue = ID | 'all' | 'none';

/** Filtres + tri de la liste des notes. */
export interface NotesFilterState {
  /** Recherche plein texte (titre + contenu Markdown). */
  search: string;
  /** 'all' | 'none' | id d'un Folder. */
  folderId: FolderFilterValue;
  /** 'all' ou id d'un Tag. */
  tagId: ID | 'all';
  /** N'afficher que les notes épinglées. */
  pinnedOnly: boolean;
  /** Afficher les notes archivées plutôt que les actives. */
  archivedOnly?: boolean;
  /** Champ de tri de la liste. */
  sortField: NoteSortField;
  /** Sens du tri. */
  sortDirection: SortDirection;
}

/** Filtres du board Kanban. */
export interface KanbanFilterState {
  /** Recherche sur les cartes (titre + description). */
  search: string;
  /** Étiquettes sélectionnées (ET) ; vide = toutes. */
  labelIds: ID[];
  /** Priorités sélectionnées ; vide = toutes. */
  priorities: Priority[];
  /** Afficher les cartes archivées. */
  showArchived?: boolean;
}

/** Notification éphémère. */
export interface Toast {
  id: ID;
  kind: 'success' | 'error' | 'info';
  message: string;
}

/**
 * État transitoire de l'interface — non persisté (à l'exception des
 * réglages qui vivent dans AppSettings).
 */
export interface UIState {
  /** Vue principale active. */
  view: MainView;
  /** Sidebar repliée. */
  sidebarCollapsed: boolean;

  // --- Module Notes ---
  /** Note ouverte dans l'éditeur, ou null. */
  activeNoteId: ID | null;
  /** Brouillon de la note active, ou null. */
  noteDraft: NoteDraft | null;
  /** Statut de sauvegarde du brouillon. */
  saveStatus: SaveStatus;
  /** Message d'erreur de la dernière sauvegarde échouée. */
  saveError: string | null;
  /** Filtres + tri de la liste des notes. */
  notesFilter: NotesFilterState;

  // --- Module Kanban ---
  /** Filtres du board. */
  kanbanFilter: KanbanFilterState;
  /** Carte ouverte dans la modale de détail, ou null. */
  activeCardId: ID | null;
  /** Colonne dont le menu contextuel est ouvert, ou null. */
  openColumnMenuId: ID | null;
  /** Ids des dossiers repliés dans la sidebar. */
  collapsedFolderIds: ID[];

  // --- Notifications ---
  /** Toasts visibles. */
  toasts: Toast[];
}

/**
 * État applicatif global : données persistées + état transitoire.
 * C'est la forme manipulée par le store (Zustand) et par les sélecteurs.
 */
export interface AppState {
  /** Données persistées (source de vérité). */
  data: PersistedState;
  /** État transitoire de l'interface. */
  ui: UIState;
}

/* ============================================================ */
/* 7. Types dérivés (sortie des sélecteurs)                      */
/* ============================================================ */

/** Note enrichie pour l'affichage en liste. */
export interface NoteListItem {
  note: Note;
  folder: Folder | null;
  tags: Tag[];
  /** Nombre de mots du contenu. */
  wordCount: number;
  /** Extrait texte court (Markdown retiré). */
  excerpt: string;
}

/** Carte enrichie de ses relations (étiquettes, note liée, progression). */
export interface CardWithRelations {
  card: KanbanCard;
  labels: KanbanLabel[];
  linkedNote: Note | null;
  /** Sous-tâches cochées. */
  checklistDone: number;
  /** Nombre total de sous-tâches. */
  checklistTotal: number;
}

/** Colonne avec son compteur — alimente le badge « n cartes ». */
export interface ColumnWithCards {
  column: KanbanColumn;
  /** Nombre total de cartes de la colonne (avant filtrage). */
  cardCount: number;
  /** Cartes après filtrage, dans l'ordre d'affichage. */
  cards: KanbanCard[];
}
