import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Download, Loader2, X } from 'lucide-react';
import { STORAGE_KEYS } from '@/constants';
import { Button } from '@/components/ui/Button';

const LEGACY_ORIGIN = 'http://192.168.1.47:8793';
const LEGACY_URL = `${LEGACY_ORIGIN}/?action=local_migration_source`;

interface MigrationPayload {
  type: 'mansotnote:local-migration';
  values: Partial<Record<(typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS], string>>;
}

export function LegacyBrowserImport({ onClose }: { onClose: () => void }) {
  const popupRef = useRef<Window | null>(null);
  const [status, setStatus] = useState<'idle' | 'waiting' | 'error'>('idle');
  const [error, setError] = useState('');

  const installValues = (values: MigrationPayload['values']) => {
    let imported = 0;
    for (const key of [STORAGE_KEYS.state, STORAGE_KEYS.auth, STORAGE_KEYS.vault] as const) {
      const value = values[key];
      if (typeof value === 'string') { localStorage.setItem(key, value); imported++; }
    }
    if (imported === 0) {
      setStatus('error');
      setError('Aucune ancienne donnée MansotNote trouvée.');
      return;
    }
    window.location.reload();
  };

  useEffect(() => {
    const receive = (event: MessageEvent<MigrationPayload>) => {
      if (event.origin !== LEGACY_ORIGIN || event.source !== popupRef.current) return;
      if (event.data?.type !== 'mansotnote:local-migration' || !event.data.values) return;
      popupRef.current?.close();
      installValues(event.data.values);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, []);

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as { type?: string; version?: number; values?: MigrationPayload['values'] };
      if (parsed.type !== 'mansotnote:local-migration-file' || parsed.version !== 1 || !parsed.values || typeof parsed.values !== 'object') {
        throw new Error('Format de migration invalide');
      }
      installValues(parsed.values);
    } catch (cause) {
      setStatus('error');
      setError(cause instanceof Error ? cause.message : 'Fichier de migration invalide');
    } finally { event.target.value = ''; }
  };

  const start = () => {
    setError(''); setStatus('waiting');
    popupRef.current = window.open(LEGACY_URL, '_mn_local_migration', 'popup=yes,width=520,height=420,left=40,top=40');
    if (!popupRef.current) {
      setStatus('error');
      setError('Fenêtre bloquée : autorise temporairement les popups pour MansotNote.');
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 px-4">
      <div className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 p-6 text-zinc-100 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div><h2 className="font-semibold">Importer les anciennes notes</h2><p className="mt-1 text-xs text-zinc-400">Depuis l’ancienne adresse locale vers PostgreSQL.</p></div>
          <button onClick={onClose} aria-label="Fermer"><X size={17} /></button>
        </div>
        <p className="mt-4 text-sm text-zinc-300">Clique ci-dessous depuis le navigateur qui contient les anciennes notes. Une petite fenêtre locale s’ouvrira et transférera uniquement les données MansotNote vers cette page HTTPS.</p>
        {error && <p className="mt-3 rounded-lg bg-red-950/60 p-2.5 text-xs text-red-300">{error}</p>}
        <div className="mt-5 space-y-2">
          <Button className="w-full" onClick={start} disabled={status === 'waiting'} icon={status === 'waiting' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}>
            {status === 'waiting' ? 'En attente de l’ancienne fenêtre…' : 'Importer depuis l’ancienne adresse'}
          </Button>
          <label className="block cursor-pointer rounded-lg border border-zinc-700 px-3 py-2 text-center text-xs text-zinc-300 hover:bg-zinc-800">
            Importer un fichier mansotnote-migration.json
            <input type="file" accept="application/json,.json" onChange={importFile} className="hidden" />
          </label>
          <div className="text-right"><Button variant="ghost" onClick={onClose}>Plus tard</Button></div>
        </div>
      </div>
    </div>
  );
}
