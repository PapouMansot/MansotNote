/**
 * Coquille applicative : sidebar + vue active + toasts.
 * Les raccourcis globaux (actions store) sont branchés ici ; les
 * raccourcis contextuels (recherche, carte) le sont dans leurs vues.
 */
import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useAppStore } from '@/store/app-store';
import { useAppShortcuts } from '@/hooks/useKeyboardShortcuts';
import { isAppLocked, onLockStateChange } from '@/storage/auth-manager';
import { Sidebar } from '@/components/layout/Sidebar';
import { NotesView } from '@/views/NotesView';
import { KanbanView } from '@/views/KanbanView';
import { ChatView } from '@/views/ChatView';
import { ToastHost } from '@/components/ui/ToastHost';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { AiChatDrawer } from '@/components/ai/AiChatDrawer';
import { AuthLockScreen } from '@/components/auth/AuthLockScreen';
import { ServerLoginScreen } from '@/components/auth/ServerLoginScreen';
import { getServerSession, type ServerUser } from '@/lib/server-auth';
import { STORAGE_KEYS } from '@/constants';
import { LegacyBrowserImport } from '@/components/auth/LegacyBrowserImport';
import { createLocalStorageAdapter, hasExistingLocalWorkspace } from '@/storage/local-storage';
import { isWorkspaceEmpty, shouldImportLocalWorkspace } from '@/storage/migration';

export default function App() {
  const isLegacyMigrationSource =
    window.location.origin === 'http://192.168.1.47:8793' &&
    new URLSearchParams(window.location.search).get('action') === 'local_migration_source';
  const view = useAppStore((s) => s.ui.view);
  const hydrated = useAppStore((s) => s.hydrated);
  const createNote = useAppStore((s) => s.createNote);
  const createCard = useAppStore((s) => s.createCard);
  const openNote = useAppStore((s) => s.openNote);
  const setView = useAppStore((s) => s.setView);
  const toast = useAppStore((s) => s.toast);
  const data = useAppStore((s) => s.data);

  const [chatOpen, setChatOpen] = useState(false);
  const [legacyImportOpen, setLegacyImportOpen] = useState(false);
  const [locked, setLocked] = useState(() => isAppLocked());
  const [serverUser, setServerUser] = useState<ServerUser | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  useAppShortcuts();

  useEffect(() => {
    if (!isLegacyMigrationSource || !window.opener) return;
    const values: Record<string, string> = {};
    for (const key of [STORAGE_KEYS.state, STORAGE_KEYS.auth, STORAGE_KEYS.vault]) {
      const value = localStorage.getItem(key);
      if (value !== null) values[key] = value;
    }
    window.opener.postMessage(
      { type: 'mansotnote:local-migration', values },
      'https://notes.mansotfamily.fr',
    );
  }, [isLegacyMigrationSource]);

  const initializeAuthenticatedWorkspace = async (user: ServerUser) => {
    setServerUser(user);
    const store = useAppStore.getState();
    // Migration transparente d'un ancien espace local non chiffré vers le
    // serveur. Un coffre chiffré reste protégé et sera importé après son
    // déverrouillage par l'écran historique.
    if (!isAppLocked()) {
      const remoteState = await store.storage.load();
      if (isWorkspaceEmpty(remoteState) && hasExistingLocalWorkspace()) {
        const localState = await createLocalStorageAdapter().load();
        if (shouldImportLocalWorkspace(remoteState, localState)) await store.storage.save(localState);
      }
    }
    await store.bootstrap(true);
  };

  useEffect(() => {
    if (isLegacyMigrationSource) {
      setSessionChecked(true);
      return;
    }
    getServerSession()
      .then(async (user) => {
        if (user) await initializeAuthenticatedWorkspace(user);
      })
      .finally(() => setSessionChecked(true));
    // Initialisation unique au montage : les dépendances sont des singletons
    // stables (store Zustand + fonctions de module).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleServerAuthenticated = async (user: ServerUser) => {
    await initializeAuthenticatedWorkspace(user);
  };

  useEffect(() => {
    return onLockStateChange((newLockState) => {
      setLocked(newLockState);
    });
  }, []);

  // Gestion des actions distantes via paramètres d'URL (Web Clipper / Bookmarklet)
  useEffect(() => {
    if (!hydrated || locked) return;

    try {
      const params = new URLSearchParams(window.location.search);
      const action = params.get('action');

      if (action === 'new_note') {
        const title = params.get('title') || 'Note Web';
        const content = params.get('content') || '';
        const noteId = createNote({ title, content });
        openNote(noteId);
        setView('notes');
        toast('success', `Note « ${title} » importée depuis le Web Clipper !`);

        // Nettoie l'URL sans recharger
        window.history.replaceState({}, document.title, window.location.pathname);
      } else if (action === 'chat') {
        setChatOpen(true);
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    } catch (err) {
      console.error('[App] Erreur lors du traitement des paramètres d\'URL', err);
    }
  }, [hydrated, locked, createNote, openNote, setView, toast]);

  // Drainage automatique de l'Inbox de Clips (depuis l'extension MV3 en tâche de fond)
  useEffect(() => {
    if (!hydrated || locked || !serverUser) return;

    const drainClips = async () => {
      try {
        const res = await fetch('/api/v1/clips/pending');
        if (!res.ok) return;
        const data = await res.json();
        const clips: Array<{
          id: string;
          type: 'note' | 'card';
          title: string;
          content: string;
          url?: string;
          metadata?: Record<string, any>;
        }> = data.clips || [];

        if (clips.length === 0) return;

        const processedIds: string[] = [];
        for (const clip of clips) {
          if (clip.type === 'note') {
            createNote({
              title: clip.title || 'Note Web',
              content: clip.content || '',
            });
          } else if (clip.type === 'card') {
            const columns = useAppStore.getState().data.columns;
            const targetCol = columns[0];
            if (targetCol) {
              createCard(targetCol.id, {
                title: clip.title || 'Tâche Web',
                description: clip.content || '',
                priority: (clip.metadata?.priority as any) || 'medium',
              });
            }
          }
          processedIds.push(clip.id);
        }

        if (processedIds.length > 0) {
          await fetch('/api/v1/clips/ack', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: processedIds }),
          });
          toast(
            'success',
            `${processedIds.length} élément(s) synchronisé(s) depuis l'extension Web Clipper !`,
          );
        }
      } catch {
        // En cas d'erreur réseau, réessayera au prochain intervalle
      }
    };

    void drainClips();
    const interval = setInterval(drainClips, 10_000);
    return () => clearInterval(interval);
  }, [hydrated, locked, serverUser, createNote, createCard, toast]);

  if (isLegacyMigrationSource) {
    const downloadMigration = () => {
      const values: Record<string, string> = {};
      for (const key of [STORAGE_KEYS.state, STORAGE_KEYS.auth, STORAGE_KEYS.vault]) {
        const value = localStorage.getItem(key);
        if (value !== null) values[key] = value;
      }
      const blob = new Blob([JSON.stringify({ type: 'mansotnote:local-migration-file', version: 1, values })], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'mansotnote-migration.json';
      link.click();
      URL.revokeObjectURL(link.href);
    };
    return (
      <div className="flex h-full items-center justify-center bg-zinc-950 px-4 text-center text-zinc-100">
        <div className="max-w-md"><h1 className="text-lg font-semibold">Migration MansotNote</h1><p className="mt-2 text-sm text-zinc-400">Données locales transmises à l’application HTTPS. Si la nouvelle page ne réagit pas, télécharge le fichier puis importe-le depuis la fenêtre HTTPS.</p><button type="button" onClick={downloadMigration} className="mt-5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500">Télécharger le fichier de migration</button></div>
      </div>
    );
  }

  if (!sessionChecked) {
    return <div className="h-full bg-zinc-950" />;
  }

  if (!serverUser) {
    return <ServerLoginScreen onAuthenticated={handleServerAuthenticated} />;
  }

  if (locked) {
    return (
      <div className="relative h-full overflow-hidden">
        <AuthLockScreen onUnlocked={() => setLocked(false)} />
        <ToastHost />
      </div>
    );
  }

  return (
    <div className="relative flex h-full overflow-hidden">
      <Sidebar onOpenChat={() => setChatOpen(true)} />
      {isWorkspaceEmpty(data) && (
        <button
          type="button"
          onClick={() => setLegacyImportOpen(true)}
          className="fixed left-1/2 top-3 z-40 -translate-x-1/2 rounded-full border border-amber-400/40 bg-amber-950/95 px-4 py-2 text-xs font-medium text-amber-200 shadow-xl"
        >
          Importer mes anciennes notes locales
        </button>
      )}
      <main className="min-w-0 flex-1">
        <ErrorBoundary label="Vue principale">
          {view === 'notes' ? <NotesView /> : view === 'kanban' ? <KanbanView /> : <ChatView />}
        </ErrorBoundary>
      </main>

      {/* Bouton d'action flottant pour ouvrir SIA (masqué si déjà sur la page Chat) */}
      {!chatOpen && view !== 'chat' && (
        <button
          type="button"
          onClick={() => setChatOpen(true)}
          title="Ouvrir SIA (Chat interactif)"
          className="fixed bottom-5 right-5 z-30 flex h-11 items-center gap-2 rounded-full bg-gradient-to-r from-indigo-600 to-indigo-700 px-4 text-xs font-semibold text-white shadow-xl shadow-indigo-500/25 transition-all hover:scale-105 hover:shadow-indigo-500/40 active:scale-95 dark:shadow-indigo-950/50"
        >
          <Sparkles size={16} />
          <span>SIA</span>
        </button>
      )}

      {/* Tiroir conversationnel IA */}
      <AiChatDrawer open={chatOpen} onClose={() => setChatOpen(false)} />
      {legacyImportOpen && <LegacyBrowserImport onClose={() => setLegacyImportOpen(false)} />}

      <ToastHost />
    </div>
  );
}
