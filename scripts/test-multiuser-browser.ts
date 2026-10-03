import assert from 'node:assert/strict';
import { createEmptyState } from '../src/lib/seed';
import { getBrowserUser, setBrowserUser, accountHeaders, accountStorageKey } from '../src/lib/browser-user';
import { loadSavedConversations, saveConversationsToStorage, loadActiveConversationId, saveActiveConversationId, createNewConversation } from '../src/lib/chat-storage';
import { getAuthConfig } from '../src/storage/auth-manager';
import { STORAGE_KEYS } from '../src/constants';
import { useAppStore } from '../src/store/app-store';
import { RemoteStorageAdapter } from '../src/storage/remote-storage';

const values = new Map<string, string>();
Object.assign(globalThis, { window: { location: { href: 'http://localhost:5173/', origin: 'http://localhost:5173' },
  localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } } });
const admin = { id: 'admin', username: 'Admin', role: 'admin' as const, legacyOwner: true };
const alice = { id: 'alice', username: 'Alice', role: 'user' as const, legacyOwner: false };
const first = createEmptyState();
const second = createEmptyState();
assert.equal(first.columns.length, 3);
assert.ok(first.columns.every((column) => !second.columns.some((c) => c.id === column.id)));
console.log('OK Colonnes Kanban distinctes pour chaque nouvel espace');

const legacy = createNewConversation('Ancienne conversation privée');
values.set(STORAGE_KEYS.chat, JSON.stringify([legacy]));
values.set(STORAGE_KEYS.activeChat, legacy.id);
values.set(STORAGE_KEYS.auth, JSON.stringify({ enabled: true, salt: 'legacy', passwordHash: 'private' }));
setBrowserUser(alice);
assert.deepEqual(loadSavedConversations(), []);
assert.equal(loadActiveConversationId(), null);
assert.equal(getAuthConfig(), null);
assert.ok(values.has(STORAGE_KEYS.chat));
const conversation = createNewConversation('Alice privée');
saveConversationsToStorage([conversation]); saveActiveConversationId(conversation.id);
setBrowserUser(admin);
assert.equal(loadSavedConversations()[0].title, legacy.title);
assert.equal(loadActiveConversationId(), legacy.id);
assert.ok(getAuthConfig());
assert.ok(!values.has(STORAGE_KEYS.chat));
setBrowserUser(alice);
assert.equal(loadSavedConversations()[0].title, 'Alice privée');
assert.equal(loadActiveConversationId(), conversation.id);
assert.equal(getBrowserUser()?.id, 'alice');
assert.equal(accountStorageKey('history'), 'history:alice');
assert.deepEqual(accountHeaders('/api/workspace'), { 'X-Mansot-User': 'alice' });
assert.deepEqual(accountHeaders('https://api.openai.com/v1/chat/completions'), {});
console.log('OK Conversations et ancien coffre isolés ; en-tête de compte limité à l’API locale');

const ownState = { ...createEmptyState(),
  settings: { ...createEmptyState().settings, defaultFolderId: 'folder', autosaveEnabled: false },
  folders: [{ id: 'folder', name: 'Dossier', parentId: null, order: 0, createdAt: 1 }],
  tags: [{ id: 'tag', name: 'Tag', color: '#64748b', createdAt: 1 }],
  notes: [{ id: 'note', title: 'Note', content: 'Privé', folderId: 'folder', tagIds: ['tag'], pinned: false, createdAt: 1, updatedAt: 1 }],
  cards: [{ id: 'card', columnId: 'column', order: 0, title: 'Carte', description: '', labelIds: [], priority: 'medium' as const, dueDate: null, checklist: [], linkedNoteId: 'note', createdAt: 1, updatedAt: 1 }],
};
useAppStore.setState({ data: ownState, hydrated: true });
useAppStore.getState().deleteFolder('folder');
assert.equal(useAppStore.getState().data.settings.defaultFolderId, null);
assert.equal(useAppStore.getState().data.notes[0].folderId, null);
console.log('OK Supprimer le dossier par défaut conserve une sauvegarde valide');

const originalFetch = globalThis.fetch;
try {
  let reads = 0; let writes = 0;
  const remote = new RemoteStorageAdapter();
  globalThis.fetch = async (_url, init) => {
    if (init?.method === 'PUT') {
      writes++;
      if (writes === 1) return Response.json({ error: 'Conflit', version: 2 }, { status: 409 });
      const sent = JSON.parse(String(init.body)).state;
      assert.deepEqual(sent.notes, []);
      assert.deepEqual(sent.tags, []);
      assert.equal(sent.cards[0].linkedNoteId, null);
      assert.equal(sent.settings.defaultFolderId, null);
      return Response.json({ version: 3 });
    }
    reads++;
    return Response.json({ version: reads === 1 ? 1 : 2, state: reads === 1 ? ownState : { ...ownState, notes: [], folders: [], tags: [] } });
  };
  await remote.load();
  await remote.save(ownState);
  assert.equal(writes, 2);
  let requests = 0;
  globalThis.fetch = async () => { requests++; return Response.json({ error: 'Le compte connecté a changé' }, { status: 409 }); };
  await assert.rejects(remote.save(ownState), /compte connecté a changé/);
  assert.equal(requests, 1);
  console.log('OK Fusion après suppression par un bot ; aucun rechargement-fusion après changement de compte');
} finally { globalThis.fetch = originalFetch; }
