import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Check, Copy, Folder as FolderIcon, KeyRound, Loader2, Plug, Plus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { accountFetch as fetch } from '@/lib/browser-user';
import type { Folder } from '@/types';

interface Props {
  folders: Folder[];
  folderLabel: (id: string) => string;
  /** Adresse publique de l'utilisateur, null sur le réseau privé / VPN. */
  myIp: string | null;
  onTokensChanged: () => void;
  onOpenTokens: () => void;
}

function CopyBlock({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">{label}</span>
        <Button size="sm" variant="secondary" onClick={copy} icon={copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}>
          {copied ? 'Copié' : 'Copier'}
        </Button>
      </div>
      <pre className={clsx('max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-zinc-200 bg-zinc-50 p-2.5 text-[11px] text-zinc-800 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200', mono && 'font-mono')}>{value}</pre>
    </div>
  );
}

/** Création guidée d'une connexion MCP : un jeton personnel et les réglages à coller dans l'assistant. */
export function McpConnectPanel({ folders, folderLabel, myIp, onTokensChanged, onOpenTokens }: Props) {
  const [name, setName] = useState('Mon assistant IA');
  const [limitFolders, setLimitFolders] = useState(false);
  const [folderIds, setFolderIds] = useState<string[]>([]);
  const [write, setWrite] = useState(false);
  const [ips, setIps] = useState(myIp ?? '');
  // L'adresse publique est lue après l'ouverture de la fenêtre : on la préremplit dès qu'elle arrive.
  useEffect(() => {
    if (myIp) setIps((current) => current || myIp);
  }, [myIp]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<{ token: string; name: string } | null>(null);

  const url = window.location.origin + '/api/mcp';
  const canCreate = name.trim() !== '' && !busy && (!limitFolders || folderIds.length > 0);

  /** Une nouvelle connexion repart toujours des réglages prudents : lecture seule, tous les champs vides. */
  const startOver = () => {
    setCreated(null);
    setName('Mon assistant IA');
    setLimitFolders(false);
    setFolderIds([]);
    setWrite(false);
    setIps(myIp ?? '');
    setError('');
  };

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canCreate) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          permissions: { read: true, write, delete: false, manage: false },
          allowedFolderIds: limitFolders ? folderIds : [],
          deniedTagIds: [],
          autoTagId: null,
          allowedIps: ips.split(/[\s,;]+/).filter(Boolean),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Erreur (' + response.status + ')');
      setCreated({ token: data.token, name: name.trim() });
      onTokensChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Échec de connexion réseau');
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    const bearer = 'Bearer ' + created.token;
    const json = JSON.stringify({ mcpServers: { mansotnote: { url, headers: { Authorization: bearer } } } }, null, 2);
    const curl = `curl -s -X POST ${url} -H "Authorization: ${bearer}" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`;
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <strong>« {created.name} » est créée.</strong> Copiez ces informations maintenant : le jeton ne sera plus jamais réaffiché.
          Gardez-le secret, comme un mot de passe.
        </div>
        <CopyBlock label="1. Adresse du serveur MCP" value={url} />
        <CopyBlock label="2. En-tête d'authentification (Authorization)" value={bearer} />
        <div className="space-y-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Selon votre assistant</p>
          <CopyBlock label="Hermès (puis collez l'en-tête ci-dessus quand il le demande)" value={`hermes mcp add mansotnote --url ${url} --auth header`} />
          <CopyBlock label="Assistant configuré par fichier JSON" value={json} />
          <CopyBlock label="Tester la connexion depuis un terminal" value={curl} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={startOver}>Créer une autre connexion</Button>
          <Button size="sm" variant="ghost" onClick={onOpenTokens}>Voir et régler mes jetons</Button>
        </div>
      </div>
    );
  }

  const chip = 'flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors';
  return (
    <form onSubmit={create} className="space-y-4">
      <div className="flex items-start gap-2 rounded-lg bg-indigo-500/10 p-3 text-xs text-indigo-800 dark:text-indigo-200">
        <Plug size={16} className="mt-0.5 shrink-0" />
        <span>
          Connectez un assistant IA compatible MCP (Hermès, par exemple) à vos notes. Il se connecte avec une adresse et un jeton
          qui vous sont propres : il ne voit que votre carnet, et uniquement ce que vous autorisez ci-dessous.
        </span>
      </div>

      <label className="block text-xs text-zinc-500">
        Nom de la connexion
        <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} className="field mt-1 h-9 w-full px-3 text-sm" />
      </label>

      <div className="space-y-1.5">
        <div className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">Notes accessibles</div>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300">
          <input type="radio" checked={!limitFolders} onChange={() => setLimitFolders(false)} className="text-indigo-600 focus:ring-indigo-500" />
          Toutes mes notes
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300">
          <input type="radio" checked={limitFolders} onChange={() => setLimitFolders(true)} className="text-indigo-600 focus:ring-indigo-500" />
          Seulement certains dossiers
        </label>
        {limitFolders && (folders.length === 0 ? (
          <p className="text-[11px] italic text-zinc-400">Aucun dossier créé : créez-en un dans la barre latérale.</p>
        ) : (
          <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
            {folders.map((folder) => {
              const selected = folderIds.includes(folder.id);
              return (
                <button
                  type="button"
                  key={folder.id}
                  onClick={() => setFolderIds(selected ? folderIds.filter((id) => id !== folder.id) : [...folderIds, folder.id])}
                  className={clsx(chip, selected
                    ? 'border-indigo-300 bg-indigo-50 font-medium text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300'
                    : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400')}
                >
                  <FolderIcon size={11} />
                  <span>{folderLabel(folder.id)}</span>
                </button>
              );
            })}
          </div>
        ))}
        {limitFolders && folderIds.length === 0 && folders.length > 0 && (
          <p className="text-[11px] text-red-600 dark:text-red-400">Choisissez au moins un dossier.</p>
        )}
      </div>

      <label className="flex cursor-pointer items-start gap-2 text-xs text-zinc-700 dark:text-zinc-300">
        <input type="checkbox" checked={write} onChange={(e) => setWrite(e.target.checked)} className="mt-0.5 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500" />
        <span>
          Autoriser l'assistant à créer et modifier des notes
          <span className="block text-[11px] text-zinc-500">Désactivé : lecture seule. Il ne peut jamais supprimer de notes avec cette connexion.</span>
        </span>
      </label>

      <div className="space-y-1">
        <div className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">Accès depuis Internet</div>
        <input
          value={ips}
          onChange={(e) => setIps(e.target.value)}
          placeholder={myIp ? '' : 'ex. 86.208.132.174 (optionnel)'}
          className="field h-8 w-full px-2 font-mono text-xs"
        />
        <p className="text-[11px] text-zinc-500">
          {myIp
            ? 'Votre adresse actuelle est préremplie : la connexion fonctionnera depuis elle, et depuis le réseau privé / VPN.'
            : 'Vous êtes sur le réseau privé / VPN : la connexion fonctionnera depuis ce réseau. Pour l\'utiliser depuis Internet, ajoutez ici l\'adresse de la machine qui fera tourner l\'assistant.'}
          {' '}Sans adresse, la connexion est refusée depuis Internet.
        </p>
      </div>

      {error && <div className="rounded-lg bg-red-50 p-2.5 text-xs text-red-600 dark:bg-red-950/40 dark:text-red-300">⚠️ {error}</div>}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" disabled={!canCreate} icon={busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}>
          Créer ma connexion
        </Button>
        <Button type="button" size="sm" variant="ghost" icon={<KeyRound size={13} />} onClick={onOpenTokens}>
          Réglages avancés : plusieurs jetons, tags interdits…
        </Button>
      </div>
    </form>
  );
}
