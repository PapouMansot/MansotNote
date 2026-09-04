/**
 * Jeu de données d'exemple — installé au premier lancement.
 *
 * Contenu :
 *  - 3 dossiers (dont un imbriqué), 4 tags ;
 *  - 5 notes Markdown, dont des blocs de code Bash / YAML / SQL / Python ;
 *  - 3 colonnes par défaut, 4 étiquettes, 7 cartes avec checklists,
 *    priorités, échéances (dont une en retard) et notes liées.
 *
 * Les ids sont lisibles (stables) pour faciliter le debug ; les
 * horodatages sont relatifs à l'installation, donc toujours « frais ».
 */
import type {
  Folder,
  KanbanCard,
  KanbanColumn,
  KanbanLabel,
  Note,
  PersistedState,
  Tag,
  Timestamp,
} from '@/types';
import { SCHEMA_VERSION } from '@/types';
import { DEFAULT_SETTINGS } from '@/constants';
import { shiftISODate, toISODate } from '@/lib/dates';

/** Version du jeu de données (permet de proposer une mise à jour plus tard). */
export const SEED_VERSION = 1;

/* ------------------------------------------------------------------ */
/* Blocs de code de démonstration (assemblés pour éviter les échappements) */
/* ------------------------------------------------------------------ */

const DEMO_YAML = [
  '```yaml',
  'services:',
  '  web:',
  '    build: .',
  '    ports:',
  '      - "3080:80"',
  '    environment:',
  '      - TZ=Europe/Paris',
  '    restart: unless-stopped',
  '```',
].join('\n');

const DEMO_DOCKER_BASH = [
  '```bash',
  '# 1. Construire et démarrer la stack',
  'docker compose up -d --build',
  '',
  '# 2. Vérifier l\'état des conteneurs',
  'docker compose ps',
  '',
  '# 3. Suivre les logs en direct',
  'docker compose logs -f web',
  '```',
].join('\n');

const DEMO_BACKUP_BASH = [
  '```bash',
  '# Sauvegarder la base SQLite',
  'docker compose exec api sqlite3 mansotnote.db ".backup /backups/mansotnote-$(date +%F).db"',
  '',
  '# Restaurer',
  'docker compose exec -T api sqlite3 mansotnote.db ".restore /backups/mansotnote.db"',
  '```',
].join('\n');

const DEMO_SQL = [
  '```sql',
  '-- 1. Index de tri par date de modification',
  'CREATE INDEX IF NOT EXISTS idx_notes_updated_at',
  '  ON notes (updated_at DESC);',
  '',
  '-- 2. Contrainte d\'intégrité sur le dossier',
  'ALTER TABLE notes',
  '  ADD CONSTRAINT fk_notes_folder',
  '  FOREIGN KEY (folder_id) REFERENCES folders (id)',
  '  ON DELETE SET NULL;',
  '',
  '-- 3. Backfill des titres vides',
  "UPDATE notes SET title = 'Sans titre' WHERE title IS NULL OR title = '';",
  '',
  '-- 4. Vérification',
  'SELECT id, title, folder_id, updated_at',
  'FROM notes',
  'ORDER BY updated_at DESC',
  'LIMIT 10;',
  '```',
].join('\n');

const DEMO_PYTHON = [
  '```python',
  'import sqlite3',
  '',
  '',
  'def check(conn: sqlite3.Connection) -> dict[str, int]:',
  '    """Nombre de notes après migration."""',
  '    cur = conn.execute("SELECT COUNT(*) FROM notes")',
  '    return {"notes": cur.fetchone()[0]}',
  '',
  '',
  'if __name__ == "__main__":',
  '    conn = sqlite3.connect("mansotnote.db")',
  '    print(check(conn))',
  '    conn.close()',
  '```',
].join('\n');

/* ------------------------------------------------------------------ */
/* Contenu des notes                                                   */
/* ------------------------------------------------------------------ */

const DOCKER_MD = `# Déploiement Docker — guide

Procédure de déploiement auto-hébergé (front + API optionnelle).

## Stack

- **Front** : Vite + React, servi par Nginx
- **API (optionnelle)** : Node.js + SQLite

## Compose de référence

${DEMO_YAML}

## Procédure

${DEMO_DOCKER_BASH}

## Sauvegarde / restauration

${DEMO_BACKUP_BASH}

## Dépannage

| Symptôme | Cause probable | Action |
| --- | --- | --- |
| Port 3080 occupé | Autre service | Changer le port dans \`docker-compose.yml\` |
| Page blanche | Cache navigateur | Ctrl+Shift+R |
`;

const SQL_MD = `# Migration SQL v2 — notes

Plan de migration du schéma \`notes\` (v1 → v2) pour la version serveur Node + SQLite.

## Objectifs

- Index de tri par date de modification
- Contrainte d'intégrité sur la référence de dossier
- Backfill des titres vides

## Script de migration

${DEMO_SQL}

## Vérification côté applicatif

${DEMO_PYTHON}

> ⚠️ Toujours tester sur une copie de la base avant production.
`;

const IDEES_MD = `# Idées de projets

- [ ] Mode « journal » : notes datées avec timeline
- [ ] Command palette sur toute l'application
- [ ] Export PDF des notes
- [ ] Synchronisation P2P entre machines (CRDT)

## À creuser

- \`shiki\` dans un Web Worker pour débloquer le rendu des gros documents
- Migrer vers IndexedDB quand localStorage plafonne (~5 Mo)
- Import de fichiers \`.md\` existants
`;

/* ------------------------------------------------------------------ */
/* État seed                                                           */
/* ------------------------------------------------------------------ */

/**
 * Construit l'état persisté complet du premier lancement.
 *
 * @param now Horodatage de référence (injectable pour les tests).
 */
export function createSeedState(now: number = Date.now()): PersistedState {
  const hoursAgo = (n: number): Timestamp => now - n * 3_600_000;
  const daysAgo = (n: number): Timestamp => now - n * 86_400_000;

  const today = toISODate(new Date(now));
  const dueIn = (days: number): string => shiftISODate(today, days);

  const folders: Folder[] = [
    { id: 'fold-projets', name: 'Projets', parentId: null, order: 0, createdAt: daysAgo(14) },
    { id: 'fold-personnel', name: 'Personnel', parentId: null, order: 1, createdAt: daysAgo(14) },
    { id: 'fold-recettes', name: 'Recettes', parentId: 'fold-personnel', order: 0, createdAt: daysAgo(14) },
  ];

  const tags: Tag[] = [
    { id: 'tag-important', name: 'important', color: '#ef4444', createdAt: daysAgo(14) },
    { id: 'tag-travail', name: 'travail', color: '#3b82f6', createdAt: daysAgo(14) },
    { id: 'tag-apprendre', name: 'à apprendre', color: '#8b5cf6', createdAt: daysAgo(14) },
    { id: 'tag-perso', name: 'perso', color: '#10b981', createdAt: daysAgo(14) },
  ];

  const notes: Note[] = [
    {
      id: 'note-docker',
      title: 'Déploiement Docker — guide',
      content: DOCKER_MD,
      folderId: 'fold-projets',
      tagIds: ['tag-travail'],
      pinned: false,
      createdAt: daysAgo(12),
      updatedAt: hoursAgo(3),
    },
    {
      id: 'note-sql',
      title: 'Migration SQL v2 — notes',
      content: SQL_MD,
      folderId: 'fold-projets',
      tagIds: ['tag-travail', 'tag-important'],
      pinned: false,
      createdAt: daysAgo(8),
      updatedAt: hoursAgo(1),
    },
    {
      id: 'note-idees',
      title: 'Idées de projets',
      content: IDEES_MD,
      folderId: null,
      tagIds: ['tag-apprendre'],
      pinned: false,
      createdAt: daysAgo(5),
      updatedAt: daysAgo(2),
    },
  ];

  const labels: KanbanLabel[] = [
    { id: 'lbl-bug', name: 'Bug', color: '#ef4444', createdAt: daysAgo(12) },
    { id: 'lbl-feature', name: 'Fonctionnalité', color: '#3b82f6', createdAt: daysAgo(12) },
    { id: 'lbl-docs', name: 'Documentation', color: '#f59e0b', createdAt: daysAgo(12) },
    { id: 'lbl-perf', name: 'Performance', color: '#8b5cf6', createdAt: daysAgo(12) },
  ];

  const columns: KanbanColumn[] = [
    { id: 'col-todo', title: 'À faire', order: 0, createdAt: daysAgo(14) },
    { id: 'col-doing', title: 'En cours', order: 1, createdAt: daysAgo(14) },
    { id: 'col-done', title: 'Terminé', order: 2, createdAt: daysAgo(14) },
  ];

  const cards: KanbanCard[] = [
    {
      id: 'card-api',
      columnId: 'col-todo',
      order: 0,
      title: "Brancher l'API REST sur le module Notes",
      description: [
        "Connecter `storage/remote.ts` à l'API Express + SQLite.",
        '',
        '- Endpoint `GET /state`',
        '- Endpoint `PUT /state`',
        '- Repli automatique sur localStorage si hors ligne',
      ].join('\n'),
      labelIds: ['lbl-feature'],
      priority: 'high',
      dueDate: dueIn(3),
      checklist: [
        { id: 'task-api-1', title: 'Client HTTP + retry', done: true, order: 0 },
        { id: 'task-api-2', title: 'Tester le repli hors ligne', done: false, order: 1 },
        { id: 'task-api-3', title: 'Réconciliation des conflits', done: false, order: 2 },
      ],
      linkedNoteId: null,
      createdAt: daysAgo(2),
      updatedAt: hoursAgo(5),
    },
    {
      id: 'card-readme',
      columnId: 'col-todo',
      order: 1,
      title: "Écrire la doc d'installation (README)",
      description: 'Prévoir les sections : prérequis, build, Docker, dépannage.',
      labelIds: ['lbl-docs'],
      priority: 'low',
      dueDate: dueIn(-1), // en retard — visible dans la démo
      checklist: [
        { id: 'task-readme-1', title: 'Structure du README', done: false, order: 0 },
        { id: 'task-readme-2', title: 'Section Docker', done: false, order: 1 },
      ],
      linkedNoteId: null,
      createdAt: daysAgo(6),
      updatedAt: daysAgo(1),
    },
    {
      id: 'card-perf',
      columnId: 'col-todo',
      order: 2,
      title: 'Optimiser le rendu des gros documents Markdown',
      description: [
        "Au-delà de 50 Ko, le rendu bloque l'interface.",
        '',
        'Idées :',
        '- Shiki dans un Web Worker',
        '- Pagination des blocs de code',
      ].join('\n'),
      labelIds: ['lbl-perf'],
      priority: 'medium',
      dueDate: null,
      checklist: [
        { id: 'task-perf-1', title: 'Mesurer le temps de rendu', done: true, order: 0 },
        { id: 'task-perf-2', title: 'Prototyper le worker Shiki', done: false, order: 1 },
      ],
      linkedNoteId: null,
      createdAt: daysAgo(4),
      updatedAt: daysAgo(2),
    },
    {
      id: 'card-docker',
      columnId: 'col-doing',
      order: 0,
      title: 'Finaliser le guide de déploiement Docker',
      description:
        'Compléter la note liée : section sauvegarde / restauration de la base SQLite.',
      labelIds: ['lbl-docs', 'lbl-feature'],
      priority: 'high',
      dueDate: dueIn(1),
      checklist: [
        { id: 'task-docker-1', title: 'Dockerfile multi-stages', done: true, order: 0 },
        { id: 'task-docker-2', title: 'docker-compose.yml', done: true, order: 1 },
        { id: 'task-docker-3', title: 'Section sauvegarde / restauration', done: false, order: 2 },
      ],
      linkedNoteId: 'note-docker',
      createdAt: daysAgo(5),
      updatedAt: hoursAgo(3),
    },
    {
      id: 'card-sql',
      columnId: 'col-doing',
      order: 1,
      title: 'Migration SQL v2 (index + contraintes)',
      description:
        'Script complet dans la note liée. Attention au backfill sur les grosses bases.',
      labelIds: ['lbl-feature', 'lbl-bug'],
      priority: 'urgent',
      dueDate: dueIn(0), // aujourd'hui
      checklist: [
        { id: 'task-sql-1', title: 'Script de migration', done: true, order: 0 },
        { id: 'task-sql-2', title: 'Script de rollback', done: false, order: 1 },
        { id: 'task-sql-3', title: 'Vérification post-migration', done: false, order: 2 },
      ],
      linkedNoteId: 'note-sql',
      createdAt: daysAgo(3),
      updatedAt: hoursAgo(1),
    },
    {
      id: 'card-scaffold',
      columnId: 'col-done',
      order: 0,
      title: 'Scaffolder le projet (Vite + Tailwind + TS)',
      description: 'Socle du projet : configs, alias, palette, thème sombre par défaut.',
      labelIds: ['lbl-feature'],
      priority: 'medium',
      dueDate: null,
      checklist: [
        { id: 'task-scaffold-1', title: 'package.json + scripts', done: true, order: 0 },
        { id: 'task-scaffold-2', title: 'tsconfig strict + alias @/', done: true, order: 1 },
        { id: 'task-scaffold-3', title: 'Tailwind (darkMode class + typography)', done: true, order: 2 },
        { id: 'task-scaffold-4', title: 'index.html avec anti-flash de thème', done: true, order: 3 },
      ],
      linkedNoteId: null,
      createdAt: daysAgo(14),
      updatedAt: daysAgo(3),
    },
    {
      id: 'card-model',
      columnId: 'col-done',
      order: 1,
      title: 'Modèle de données v1 (types)',
      description: 'Source unique de vérité : Notes, Kanban, persistance, état UI.',
      labelIds: ['lbl-feature', 'lbl-docs'],
      priority: 'high',
      dueDate: null,
      checklist: [
        { id: 'task-model-1', title: 'Types Notes (note, dossier, tag)', done: true, order: 0 },
        { id: 'task-model-2', title: 'Types Kanban (colonne, carte, checklist)', done: true, order: 1 },
        { id: 'task-model-3', title: 'PersistedState + StorageAdapter', done: true, order: 2 },
      ],
      linkedNoteId: null,
      createdAt: daysAgo(13),
      updatedAt: daysAgo(4),
    },
  ];

  return {
    schemaVersion: SCHEMA_VERSION,
    savedAt: now,
    seed: { installedAt: now, seedVersion: SEED_VERSION },
    notes,
    folders,
    tags,
    columns,
    cards,
    labels,
    settings: { ...DEFAULT_SETTINGS },
  };
}

/* ------------------------------------------------------------------ */
/* État vide (réinitialisation)                                        */
/* ------------------------------------------------------------------ */

/**
 * État persisté « propre » : aucune donnée, mais les 3 colonnes
 * par défaut du board (À faire / En cours / Terminé).
 */
export function createEmptyState(now: number = Date.now()): PersistedState {
  const columns: KanbanColumn[] = [
    { id: 'col-todo', title: 'À faire', order: 0, createdAt: now },
    { id: 'col-doing', title: 'En cours', order: 1, createdAt: now },
    { id: 'col-done', title: 'Terminé', order: 2, createdAt: now },
  ];

  return {
    schemaVersion: SCHEMA_VERSION,
    savedAt: now,
    seed: null,
    notes: [],
    folders: [],
    tags: [],
    columns,
    cards: [],
    labels: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}
