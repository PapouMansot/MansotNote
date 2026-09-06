#!/usr/bin/env node
/**
 * Smoke test — passe 1 (hooks + export + autosave)
 * -------------------------------------------------
 * Prérequis (bundling esbuild, alias @ → ./src) :
 *   npx esbuild src/lib/export.ts src/lib/ai.ts src/store/app-store.ts \
 *     src/store/persist.ts src/hooks/useKeyboardShortcuts.ts \
 *     --bundle --format=esm --platform=node \
 *     "--alias:@=./src" --outdir=node_modules/.cache/smoke
 *
 * (esbuild garde la structure du projet dans l'out-dir : lib/, store/,
 * hooks/ — les chemins d'import ci-dessous en tiennent compte.)
 *
 * Exécution :
 *   node scripts/smoke-pass1.mjs
 *
 * Couvre :
 *  1. lib/export   : documents MD, front matter, YAML escaping,
 *     slug de filename, export combiné, no-op downloadText (Node) ;
 *  2. store        : autosave (commit brouillon → persistance),
 *     saveDraftNow, closeNote, flushPending, bootstrap ;
 *  3. hooks        : matchesShortcut (modificateurs exacts + touche) ;
 *  4. lib/ai       : helpers purs (endpoint, clôtures, prompts, config).
 */
import assert from 'node:assert/strict';

/* ------------------------------------------------------------------ */
/* Shim DOM minimal : le store crée son adapter à la portée du module  */
/* (getStorageAdapter) et a besoin d'une fenêtre localStorage.         */
/* ------------------------------------------------------------------ */
class MemStorage {
  constructor() {
    this.m = new Map();
  }
  getItem(k) {
    return this.m.has(k) ? this.m.get(k) : null;
  }
  setItem(k, v) {
    this.m.set(k, String(v));
  }
  removeItem(k) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
  key(i) {
    return [...this.m.keys()][i] ?? null;
  }
  get length() {
    return this.m.size;
  }
}
if (typeof globalThis.window === 'undefined') {
  globalThis.window = {
    localStorage: new MemStorage(),
    matchMedia: () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }),
    addEventListener() {},
    removeEventListener() {},
  };
}

const BASE = new URL('../node_modules/.cache/smoke/', import.meta.url);

let pass = 0;
let fail = 0;
const lines = [];

async function test(name, fn) {
  try {
    await fn();
    pass += 1;
    lines.push(`  ok   ${name}`);
  } catch (error) {
    fail += 1;
    lines.push(`  FAIL ${name}\n       ${error && error.message ? error.message : error}`);
  }
}

/* ------------------------------------------------------------------ */
/* 1. lib/export                                                       */
/* ------------------------------------------------------------------ */

const {
  noteToMarkdown,
  notesToMarkdown,
  toFrontMatter,
  slugifyBase,
  exportNoteFileName,
  downloadText,
} = await import(new URL('lib/export.js', BASE));

const note = {
  id: 'note_test',
  title: 'Ma note "projet" / final',
  content: 'Contenu **markdown** ici.\n',
  folderId: 'fold_1',
  tagIds: ['tag_a', 'tag_b'],
  pinned: true,
  createdAt: Date.parse('2025-01-15T10:30:00Z'),
  updatedAt: Date.parse('2025-02-01T09:00:00Z'),
};

await test('noteToMarkdown : front matter + # titre + contenu', () => {
  const md = noteToMarkdown(note, { folderName: 'Projets', tagNames: ['a', 'b'] });
  assert.ok(md.startsWith('---\n'), 'commence par ---');
  assert.ok(md.includes('title: "Ma note \\"projet\\" / final"'), 'titre échappé');
  assert.ok(md.includes('created: 2025-01-15T10:30:00.000Z'), 'created ISO');
  assert.ok(md.includes('updated: 2025-02-01T09:00:00.000Z'), 'updated ISO');
  assert.ok(md.includes('folder: "Projets"'), 'folder présent');
  assert.ok(md.includes('tags: ["a", "b"]'), 'tags présents');
  assert.ok(md.includes('# Ma note "projet" / final'), 'heading de titre');
  assert.ok(md.includes('Contenu **markdown** ici.'), 'contenu conservé');
  assert.ok(md.endsWith('ici.\n') && !md.endsWith('\n\n'), 'une seule fin de ligne');
});

await test('noteToMarkdown : front matter désactivé', () => {
  const md = noteToMarkdown(note, { includeFrontMatter: false });
  assert.ok(md.startsWith('# Ma note'), 'commence par le heading');
  assert.ok(!md.startsWith('---'), 'pas de front matter');
});

await test('noteToMarkdown : titre/contenu vides → front matter seul', () => {
  const empty = { ...note, title: '   ', content: '' };
  const md = noteToMarkdown(empty);
  const fm = toFrontMatter(empty, {});
  assert.equal(md, `${fm}\n`, 'front matter + une fin de ligne');
});

await test('slugifyBase : accents, ponctuation, repli, longueur', () => {
  assert.equal(slugifyBase('Ma note / Projet (final) !'), 'ma-note-projet-final');
  assert.equal(slugifyBase('éàù'), 'eau');
  assert.equal(slugifyBase(''), 'note');
  assert.equal(slugifyBase('!!!'), 'note');
  assert.equal(slugifyBase('a'.repeat(120)).length, 80);
});

await test('exportNoteFileName : .md inclus, repli note.md', () => {
  assert.equal(exportNoteFileName({ ...note, title: 'Ma note / x' }), 'ma-note-x.md');
  assert.equal(exportNoteFileName({ ...note, title: '   ' }), 'note.md');
});

await test('notesToMarkdown : en-tête, compteur, séparateurs', () => {
  const n2 = { ...note, id: 'note_b', title: 'Deuxième', content: 'Corps 2' };
  const n3 = { ...note, id: 'note_c', title: 'Troisième', content: 'Corps 3' };
  const md = notesToMarkdown([note, n2, n3], { title: 'Export test' });
  assert.ok(
    md.startsWith('# Export test\n\n> 3 notes — export du '),
    'en-tête + compteur pluriel',
  );
  // L'en-tête est collé à la première section (pas de séparateur avant),
  // puis un trait horizontal entre chaque note : 3 notes → 2 séparateurs.
  const parts = md.split('\n\n---\n\n');
  assert.equal(parts.length, 3, 'en-tête+note1 / note2 / note3');
  assert.ok(parts[0].startsWith('# Export test'), 'en-tête dans la partie 1');
  assert.ok(parts[0].includes('# Ma note'), 'note 1 présente');
  assert.ok(parts[1].includes('# Deuxième'), 'note 2 présente');
  assert.ok(parts[2].includes('# Troisième'), 'note 3 présente');
  const one = notesToMarkdown([note]);
  assert.ok(one.includes('> 1 note — export du '), 'compteur singulier');
  assert.equal(one.split('\n\n---\n\n').length, 1, '1 note → 0 séparateur');
});

await test('downloadText : no-op sans DOM (Node)', () => {
  downloadText('test.md', 'contenu'); // ne doit pas lever
});

/* ------------------------------------------------------------------ */
/* 2. store — autosave / brouillon                                     */
/* ------------------------------------------------------------------ */

const { useAppStore } = await import(new URL('store/app-store.js', BASE));
const { flushPending } = await import(new URL('store/persist.js', BASE));

const saves = [];
const fakeStorage = {
  id: 'local-storage',
  isAvailable: () => true,
  load: async () => null,
  save: async (state) => {
    saves.push(JSON.parse(JSON.stringify(state)));
  },
  clear: async () => {},
};
useAppStore.setState({ storage: fakeStorage });

await test('bootstrap : état vide, hydrated, adapter remplacé', async () => {
  await useAppStore.getState().bootstrap();
  const s = useAppStore.getState();
  assert.equal(s.hydrated, true);
  assert.equal(s.data.notes.length, 3, 'le backend local historique conserve son seed');
  assert.equal(s.storage.id, 'local-storage');
});

await test('autosave : brouillon sale commité puis persisté', async () => {
  const st = useAppStore.getState();
  st.updateSettings({ autosaveDelayMs: 40, autosaveEnabled: true });
  const id = st.createNote({ title: 'Titre A', content: 'contenu initial' });
  st.setDraft({ content: 'contenu édité' });
  assert.equal(useAppStore.getState().ui.saveStatus, 'dirty');
  await new Promise((r) => setTimeout(r, 150));
  const s = useAppStore.getState();
  const live = s.data.notes.find((n) => n.id === id);
  assert.equal(live.content, 'contenu édité', 'brouillon commité dans data');
  assert.equal(live.title, 'Titre A', 'titre intact');
  assert.equal(s.ui.noteDraft.dirty, false, 'brouillon marqué propre');
  assert.equal(s.ui.saveStatus, 'saved');
  assert.ok(saves.length >= 1, 'au moins une écriture');
  const savedNote = saves[saves.length - 1].notes.find((n) => n.id === id);
  assert.equal(savedNote.content, 'contenu édité', 'écrit dans le stockage');
});

await test('saveDraftNow : commit + écriture immédiate', async () => {
  const id = useAppStore.getState().data.notes[0].id;
  useAppStore.getState().openNote(id);
  useAppStore.getState().setDraft({ title: 'Titre modifié' });
  const before = saves.length;
  await useAppStore.getState().saveDraftNow();
  const s = useAppStore.getState();
  assert.equal(s.data.notes.find((n) => n.id === id).title, 'Titre modifié');
  assert.equal(s.ui.noteDraft.dirty, false);
  assert.equal(s.ui.saveStatus, 'saved');
  assert.ok(saves.length > before, 'écriture déclenchée');
});

await test('closeNote : commit du brouillon + persistance programmée', async () => {
  const id = useAppStore.getState().data.notes[0].id;
  useAppStore.getState().openNote(id);
  useAppStore.getState().setDraft({ content: 'dernière ligne' });
  useAppStore.getState().closeNote();
  const s = useAppStore.getState();
  assert.equal(s.ui.noteDraft, null);
  assert.equal(s.ui.activeNoteId, null);
  assert.equal(
    s.data.notes.find((n) => n.id === id).content,
    'dernière ligne',
    'édition conservée malgré la fermeture',
  );
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(useAppStore.getState().ui.saveStatus, 'saved');
});

await test('flushPending : écriture malgré un long debounce', async () => {
  const st = useAppStore.getState();
  st.updateSettings({ autosaveDelayMs: 5000 }); // volontairement long
  const id = st.data.notes[0].id;
  st.openNote(id);
  st.setDraft({ content: 'flush me' });
  const before = saves.length;
  flushPending(useAppStore.setState, useAppStore.getState);
  await new Promise((r) => setTimeout(r, 20)); // microtasks
  const s = useAppStore.getState();
  assert.equal(s.data.notes.find((n) => n.id === id).content, 'flush me');
  assert.ok(saves.length > before, 'écriture sans attendre le debounce');
  // Rétablit un délai court pour la suite.
  st.updateSettings({ autosaveDelayMs: 40 });
});

await test('createNote : le brouillon précédent est commité', async () => {
  const st = useAppStore.getState();
  const id = st.data.notes[0].id;
  st.openNote(id);
  st.setDraft({ content: 'édition orpheline' });
  const newId = st.createNote({ title: 'Nouvelle', content: '' });
  const s = useAppStore.getState();
  assert.equal(
    s.data.notes.find((n) => n.id === id).content,
    'édition orpheline',
    'la note précédente a conservé ses éditions',
  );
  assert.equal(s.ui.activeNoteId, newId, 'la nouvelle note est active');
  st.closeNote();
});

await test('bootstrap : aucune note utilisateur supprimée au chargement', async () => {
  // Régression : un filtre de nettoyage du seed portait sur le TITRE et
  // supprimait silencieusement toute note contenant « mansot », « pâtes »…
  const userNotes = [
    { id: 'note_user_1', title: 'Réunion Mansot famille', content: 'a', folderId: null, tagIds: [], pinned: false, createdAt: 1, updatedAt: 1 },
    { id: 'note_user_2', title: 'Recette de pâtes du dimanche', content: 'b', folderId: null, tagIds: [], pinned: false, createdAt: 1, updatedAt: 1 },
    { id: 'note_user_3', title: 'Carbonara maison', content: 'c', folderId: null, tagIds: [], pinned: false, createdAt: 1, updatedAt: 1 },
    { id: 'note-welcome', title: 'Bienvenue (seed démo)', content: 'd', folderId: null, tagIds: [], pinned: false, createdAt: 1, updatedAt: 1 },
  ];
  useAppStore.setState({
    hydrated: false,
    storage: {
      id: 'remote',
      isAvailable: () => true,
      load: async () => ({
        schemaVersion: 1,
        savedAt: Date.now(),
        seed: null,
        notes: userNotes,
        folders: [],
        tags: [],
        columns: [],
        cards: [],
        labels: [],
        settings: {},
      }),
      save: async () => {},
      clear: async () => {},
    },
  });
  await useAppStore.getState().bootstrap(true);
  const ids = useAppStore.getState().data.notes.map((n) => n.id);
  assert.ok(ids.includes('note_user_1'), 'une note « Mansot » doit être conservée');
  assert.ok(ids.includes('note_user_2'), 'une note « pâtes » doit être conservée');
  assert.ok(ids.includes('note_user_3'), 'une note « Carbonara » doit être conservée');
  assert.ok(!ids.includes('note-welcome'), 'la note de démo du seed reste retirée');
  useAppStore.setState({ storage: fakeStorage });
});

/* ------------------------------------------------------------------ */
/* 3. hooks — matchesShortcut (logique pure)                           */
/* ------------------------------------------------------------------ */

const { matchesShortcut } = await import(new URL('hooks/useKeyboardShortcuts.js', BASE));

function fakeEvent(overrides = {}) {
  return {
    key: 'a',
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    target: null,
    preventDefault() {},
    ...overrides,
  };
}

const S = {
  'note.new': { id: 'note.new', keys: ['mod', 'n'] },
  'note.save': { id: 'note.save', keys: ['mod', 's'] },
  'editor.cycle-mode': { id: 'editor.cycle-mode', keys: ['mod', 'shift', 'e'] },
  'search.focus': { id: 'search.focus', keys: ['mod', 'k'] },
  'card.new': { id: 'card.new', keys: ['mod', 'shift', 'k'] },
  'view.notes': { id: 'view.notes', keys: ['mod', '1'] },
  'theme.toggle': { id: 'theme.toggle', keys: ['mod', 'shift', 't'] },
};

await test('matchesShortcut : Ctrl OU ⌘ + touche principale', () => {
  assert.ok(matchesShortcut(fakeEvent({ key: 'n', ctrlKey: true }), S['note.new']));
  assert.ok(matchesShortcut(fakeEvent({ key: 'n', metaKey: true }), S['note.new']));
  assert.ok(!matchesShortcut(fakeEvent({ key: 'n' }), S['note.new']));
  assert.ok(
    !matchesShortcut(
      fakeEvent({ key: 'n', ctrlKey: true, shiftKey: true }),
      S['note.new'],
    ),
    'shift non attendu → pas de match',
  );
});

await test('matchesShortcut : mod+k vs mod+shift+k distingués', () => {
  assert.ok(
    matchesShortcut(fakeEvent({ key: 'k', ctrlKey: true, shiftKey: true }), S['card.new']),
  );
  assert.ok(
    !matchesShortcut(
      fakeEvent({ key: 'k', ctrlKey: true, shiftKey: true }),
      S['search.focus'],
    ),
  );
  assert.ok(matchesShortcut(fakeEvent({ key: 'k', ctrlKey: true }), S['search.focus']));
});

await test('matchesShortcut : chiffres, cycle éditeur, thème', () => {
  assert.ok(matchesShortcut(fakeEvent({ key: '1', ctrlKey: true }), S['view.notes']));
  assert.ok(
    matchesShortcut(fakeEvent({ key: 'e', ctrlKey: true, shiftKey: true }), S['editor.cycle-mode']),
  );
  assert.ok(
    matchesShortcut(fakeEvent({ key: 't', ctrlKey: true, shiftKey: true }), S['theme.toggle']),
  );
});

await test('matchesShortcut : champ de saisie + raccourci sans mod', () => {
  const bare = { id: 'bare', keys: ['k'] };
  assert.ok(!matchesShortcut(fakeEvent({ key: 'k', target: { tagName: 'INPUT' } }), bare));
  assert.ok(!matchesShortcut(fakeEvent({ key: 'k', target: { tagName: 'TEXTAREA' } }), bare));
  assert.ok(matchesShortcut(fakeEvent({ key: 'k', target: { tagName: 'DIV' } }), bare));
  assert.ok(matchesShortcut(fakeEvent({ key: 'k', target: null }), bare));
});

/* ------------------------------------------------------------------ */
/* 4. lib/ai — helpers purs (le réseau n'est pas testé ici)            */
/* ------------------------------------------------------------------ */

const {
  isAiConfigured,
  normalizeEndpoint,
  unwrapFences,
  buildNotePrompt,
  buildTransformPrompt,
  parseModelList,
} = await import(new URL('lib/ai.js', BASE));

await test('ai : normalizeEndpoint ajoute /v1 et nettoie les barres', () => {
  assert.equal(normalizeEndpoint('http://localhost:11434'), 'http://localhost:11434/v1');
  assert.equal(normalizeEndpoint('https://api.openai.com/v1/'), 'https://api.openai.com/v1');
  assert.equal(normalizeEndpoint('https://openrouter.ai/api/v1'), 'https://openrouter.ai/api/v1');
  assert.equal(normalizeEndpoint('  '), '');
});

await test('ai : unwrapFences retire la clôture ```markdown```', () => {
  assert.equal(unwrapFences('```markdown\n# A\n\nbody\n```'), '# A\n\nbody');
  assert.equal(unwrapFences('```md\nx\n```\n'), 'x');
  assert.equal(unwrapFences('# Simple\n\npas de clôture'), '# Simple\n\npas de clôture');
});

await test('ai : isAiConfigured exige endpoint + modèle', () => {
  assert.equal(isAiConfigured({ endpoint: 'x', apiKey: '', model: '' }), false);
  assert.equal(isAiConfigured({ endpoint: ' ', apiKey: 'k', model: 'm' }), false);
  assert.equal(
    isAiConfigured({ endpoint: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini' }),
    true,
  );
});

await test('ai : isAiConfigured tolère des champs undefined (état ancien)', () => {
  assert.equal(isAiConfigured({ endpoint: undefined, apiKey: undefined, model: undefined }), false);
  assert.equal(isAiConfigured({ endpoint: undefined, apiKey: '', model: 'm' }), false);
});

await test('ai : prompts de génération et de transformation', () => {
  const p = buildNotePrompt('Mon titre', 'une recette');
  assert.ok(p.includes('Mon titre'), 'titre demandé présent');
  assert.ok(p.includes('une recette'), 'demande présente');
  const r = buildTransformPrompt('resume', '# Note\ncontenu');
  assert.ok(r.includes('# Note'), 'contenu transmis');
  assert.ok(r.includes('Résume'), 'consigne de résumé');
});

await test('ai : parseModelList gère {data:[{id}]}, tableau brut et bruit', () => {
  assert.deepEqual(parseModelList({ data: [{ id: 'a' }, { id: 'b' }, 'c'] }), ['a', 'b', 'c']);
  assert.deepEqual(parseModelList(['x', 42, { id: 'y' }]), ['x', 'y']);
  assert.deepEqual(parseModelList(null), []);
  assert.deepEqual(parseModelList({ data: 'nope' }), []);
  assert.deepEqual(parseModelList('nope'), []);
});

/* ------------------------------------------------------------------ */
/* Synthèse                                                            */
/* ------------------------------------------------------------------ */

console.log(lines.join('\n'));
console.log(`\nSmoke passe 1 : ${pass} ok, ${fail} échec(s)\n`);
process.exit(fail === 0 ? 0 : 1);
