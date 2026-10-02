/**
 * NoteHistoryModal : historique d'une note, à la manière de Git.
 * Liste des versions (auteur, date, message), diff ligne par ligne avec la version précédente ou la version actuelle,
 * et restauration d'une ancienne version (qui crée elle-même une version, donc s'annule).
 */
import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import { Loader2, RotateCcw } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { useAppStore } from '@/store/app-store';

interface VersionInfo {
  seq: number;
  actor: string;
  message: string | null;
  createdAt: string;
  title: string;
  deleted: boolean;
  added: number;
  removed: number;
}
interface DiffLine { t: ' ' | '+' | '-'; s: string }
interface Hunk { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: DiffLine[] }
interface DiffResult {
  from: VersionInfo | null;
  to: VersionInfo;
  titleChange: { from: string | null; to: string } | null;
  added: number;
  removed: number;
  hunks: Hunk[];
}

/** Auteur lisible : « vous », un bot, ou une modification faite hors de l'application. */
export function actorLabel(actor: string): string {
  if (actor === 'navigateur') return 'Vous (navigateur)';
  if (actor === 'initial') return 'État initial';
  if (actor === 'externe') return 'Modification externe';
  if (actor.startsWith('bot:')) return '🤖 ' + actor.slice(4);
  return actor;
}

const formatDate = (iso: string) => new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

async function readJson(res: Response): Promise<any> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Erreur (' + res.status + ')');
  return data;
}

function HunkView({ hunk }: { hunk: Hunk }) {
  let oldNo = hunk.oldStart;
  let newNo = hunk.newStart;
  return (
    <div className="mb-3 overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800">
      <div className="bg-zinc-100 px-2 py-1 font-mono text-[11px] text-zinc-500 dark:bg-zinc-900">
        @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
      </div>
      {hunk.lines.map((line, index) => {
        const left = line.t === '+' ? '' : oldNo++;
        const right = line.t === '-' ? '' : newNo++;
        return (
          <div
            key={index}
            className={clsx(
              'flex font-mono text-xs',
              line.t === '+' && 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200',
              line.t === '-' && 'bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200',
            )}
          >
            <span className="w-9 shrink-0 select-none px-1 text-right text-zinc-400">{left}</span>
            <span className="w-9 shrink-0 select-none px-1 text-right text-zinc-400">{right}</span>
            <span className="w-4 shrink-0 select-none text-center">{line.t === ' ' ? '' : line.t}</span>
            <span className="min-w-0 whitespace-pre-wrap break-words pr-2">{line.s || ' '}</span>
          </div>
        );
      })}
    </div>
  );
}

export function NoteHistoryModal({ noteId, noteTitle, onClose }: { noteId: string; noteTitle: string; onClose: () => void }) {
  const toast = useAppStore((s) => s.toast);
  const updateNote = useAppStore((s) => s.updateNote);
  const base = '/api/v1/notes/' + encodeURIComponent(noteId);

  const [versions, setVersions] = useState<VersionInfo[] | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const [compare, setCompare] = useState<'previous' | 'current'>('previous');
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [confirmSeq, setConfirmSeq] = useState<number | null>(null);
  const [restoring, setRestoring] = useState(false);

  const loadVersions = useCallback(async () => {
    try {
      const data = await readJson(await fetch(base + '/versions?limit=100'));
      setVersions(data.versions);
      setSelected((current) => current ?? data.versions[0]?.seq ?? null);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Historique indisponible');
    }
  }, [base]);

  useEffect(() => {
    void loadVersions();
  }, [loadVersions]);

  const latest = versions?.[0]?.seq ?? null;
  const sameAsCurrent = compare === 'current' && selected !== null && selected === latest;

  useEffect(() => {
    if (selected === null || latest === null || sameAsCurrent) {
      setDiff(null);
      return;
    }
    const from = compare === 'previous' ? selected - 1 : selected;
    const to = compare === 'previous' ? selected : latest;
    let cancelled = false;
    setDiffLoading(true);
    fetch(base + '/diff?from=' + from + '&to=' + to)
      .then(readJson)
      .then((data) => { if (!cancelled) { setDiff(data); setError(''); } })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Diff indisponible'); })
      .finally(() => { if (!cancelled) setDiffLoading(false); });
    return () => { cancelled = true; };
  }, [base, selected, latest, compare, sameAsCurrent]);

  const restore = async (seq: number) => {
    setRestoring(true);
    try {
      const note = await readJson(await fetch(base + '/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seq }),
      }));
      // Le serveur a créé la version ; on aligne la note affichée (et son brouillon) sur le texte restauré.
      updateNote(noteId, { title: note.title, content: note.content });
      toast('success', 'Version ' + seq + ' restaurée');
      setSelected(null);
      await loadVersions();
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Restauration impossible');
    } finally {
      setRestoring(false);
      setConfirmSeq(null);
    }
  };

  const current = versions?.find((v) => v.seq === selected);

  return (
    <Modal title={'Historique : ' + (noteTitle || 'Sans titre')} onClose={onClose} wide>
      {versions === null && !error && (
        <div className="flex items-center gap-2 p-4 text-xs text-zinc-500"><Loader2 size={14} className="animate-spin" /> Chargement…</div>
      )}
      {error && <div className="mb-2 rounded-lg bg-red-50 p-2.5 text-xs text-red-600 dark:bg-red-950/40 dark:text-red-300">⚠️ {error}</div>}

      {versions && (
        <div className="flex h-[60vh] gap-3">
          <div className="w-64 shrink-0 space-y-1 overflow-y-auto border-r border-zinc-200 pr-2 dark:border-zinc-800">
            {versions.map((v, index) => (
              <button
                key={v.seq}
                type="button"
                onClick={() => setSelected(v.seq)}
                className={clsx(
                  'w-full rounded-lg border p-2 text-left text-xs transition-colors',
                  v.seq === selected
                    ? 'border-indigo-300 bg-indigo-50 dark:border-indigo-800 dark:bg-indigo-950/40'
                    : 'border-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800/60',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                    v{v.seq}{index === 0 && <span className="ml-1 font-normal text-zinc-400">(actuelle)</span>}
                  </span>
                  <span className="font-mono text-[10px]">
                    <span className="text-emerald-600">+{v.added}</span> <span className="text-red-600">−{v.removed}</span>
                  </span>
                </div>
                <div className="truncate text-[11px] text-zinc-600 dark:text-zinc-400">{actorLabel(v.actor)}</div>
                <div className="text-[10px] text-zinc-400">{formatDate(v.createdAt)}</div>
                {v.message && <div className="mt-0.5 truncate text-[11px] italic text-zinc-500">« {v.message} »</div>}
              </button>
            ))}
          </div>

          <div className="min-w-0 flex-1 overflow-y-auto">
            {current && (
              <div className="mb-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                      Version {current.seq} · {actorLabel(current.actor)}
                    </div>
                    <div className="text-[11px] text-zinc-500">
                      {formatDate(current.createdAt)}
                      {current.message && ' · « ' + current.message + ' »'}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={current.seq === latest || restoring}
                    onClick={() => setConfirmSeq(current.seq)}
                    icon={restoring ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                  >
                    Restaurer cette version
                  </Button>
                </div>
                <div className="flex gap-1.5 text-[11px]">
                  {([['previous', 'Avec la version précédente'], ['current', 'Avec la version actuelle']] as const).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setCompare(id)}
                      className={clsx(
                        'rounded-md border px-2 py-1',
                        compare === id
                          ? 'border-indigo-300 bg-indigo-50 font-medium text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300'
                          : 'border-zinc-200 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {diffLoading && <div className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 size={14} className="animate-spin" /> Calcul de la diff…</div>}
            {sameAsCurrent && <p className="text-xs text-zinc-500">C'est la version actuelle : rien à comparer.</p>}
            {diff && !diffLoading && !sameAsCurrent && (
              <>
                <div className="mb-2 text-[11px] text-zinc-500">
                  {diff.from ? 'v' + diff.from.seq : 'création'} → v{diff.to.seq} ·{' '}
                  <span className="text-emerald-600">+{diff.added}</span> <span className="text-red-600">−{diff.removed}</span> lignes
                </div>
                {diff.titleChange && (
                  <div className="mb-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs dark:border-amber-900 dark:bg-amber-950/30">
                    Titre : <span className="line-through opacity-70">{diff.titleChange.from ?? '(aucun)'}</span> → <strong>{diff.titleChange.to}</strong>
                  </div>
                )}
                {diff.hunks.length === 0 ? (
                  <p className="text-xs text-zinc-500">Aucune différence de contenu{diff.titleChange ? ' (seul le titre ou le classement a changé).' : '.'}</p>
                ) : (
                  diff.hunks.map((hunk, index) => <HunkView key={index} hunk={hunk} />)
                )}
              </>
            )}
          </div>
        </div>
      )}

      <ConfirmModal
        open={confirmSeq !== null}
        title="Restaurer cette version"
        message={'Le titre et le contenu de la note reprendront ceux de la version ' + confirmSeq + '.'}
        confirmLabel="Restaurer"
        variant="primary"
        hint="La version actuelle reste dans l'historique : la restauration peut elle-même être annulée."
        onConfirm={() => { if (confirmSeq !== null) void restore(confirmSeq); }}
        onCancel={() => setConfirmSeq(null)}
      />
    </Modal>
  );
}
