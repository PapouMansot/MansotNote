/**
 * NoteTrashPanel : notes supprimées dont l'historique est encore conservé (90 jours). La restauration recrée la note
 * avec son dernier état, puis recharge l'application pour l'afficher.
 */
import { useEffect, useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useAppStore } from '@/store/app-store';
import { actorLabel } from './NoteHistoryModal';

interface TrashNote { noteId: string; title: string; seq: number; actor: string; deletedAt: string; length: number }

export function NoteTrashPanel() {
  const [notes, setNotes] = useState<TrashNote[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/v1/notes/trash')
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Erreur (' + res.status + ')');
        setNotes(data.notes);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Corbeille indisponible'));
  }, []);

  const restore = async (note: TrashNote) => {
    setBusy(note.noteId);
    setError('');
    try {
      const res = await fetch('/api/v1/notes/' + encodeURIComponent(note.noteId) + '/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seq: note.seq, message: 'Restaurée depuis la corbeille' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Erreur (' + res.status + ')');
      useAppStore.getState().toast('success', 'Note « ' + (note.title || 'Sans titre') + ' » restaurée');
      // Recharge l'application : la note recréée côté serveur y apparaît alors.
      await useAppStore.getState().saveDraftNow();
      setTimeout(() => window.location.reload(), 600);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Restauration impossible');
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500">
        Notes supprimées, conservées 90 jours avec tout leur historique. Une note restaurée retrouve son dernier état et son dossier (s'il existe encore).
      </p>
      {error && <div className="rounded-lg bg-red-50 p-2.5 text-xs text-red-600 dark:bg-red-950/40 dark:text-red-300">⚠️ {error}</div>}
      {notes === null && !error && <div className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 size={14} className="animate-spin" /> Chargement…</div>}
      {notes && notes.length === 0 && <p className="text-xs italic text-zinc-400">Aucune note supprimée.</p>}
      <div className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
        {notes?.map((note) => (
          <div key={note.noteId} className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-zinc-50/50 p-2.5 dark:border-zinc-800 dark:bg-zinc-900/50">
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold text-zinc-800 dark:text-zinc-200">{note.title || 'Sans titre'}</div>
              <div className="text-[10px] text-zinc-400">
                Supprimée le {new Date(note.deletedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })} · {actorLabel(note.actor)} · {note.length} caractères
              </div>
            </div>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy !== null}
              onClick={() => restore(note)}
              icon={busy === note.noteId ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
            >
              Restaurer
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
