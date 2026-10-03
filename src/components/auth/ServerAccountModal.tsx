import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import {
  Bot,
  Check,
  Copy,
  Folder as FolderIcon,
  Key,
  Loader2,
  Pencil,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  Tag as TagIcon,
  Trash2,
  X,
  Users,
} from 'lucide-react';
import { changeServerPassword } from '@/lib/server-auth';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useAppStore } from '@/store/app-store';
import { NoteTrashPanel } from '@/components/notes/NoteTrashPanel';
import type { Folder, Tag } from '@/types';
import { getBrowserUser, accountFetch as fetch } from '@/lib/browser-user';
import { UsersPanel } from './UsersPanel';
import { McpConnectPanel } from './McpConnectPanel';

interface ApiToken {
  id: string;
  name: string;
  permissions?: { read?: boolean; write?: boolean; delete?: boolean; manage?: boolean };
  allowedFolderIds?: string[];
  deniedTagIds?: string[];
  autoTagId?: string | null;
  allowedIps?: string[];
  createdByTokenId?: string | null;
  createdByName?: string | null;
  created_at: string;
  last_used_at: string | null;
}

/** Réglages d'un jeton, tels qu'ils sont édités dans le formulaire. */
interface TokenDraft {
  name: string;
  /** false = tous les dossiers ; true = seulement allowedFolderIds. */
  limitFolders: boolean;
  write: boolean;
  delete: boolean;
  manage: boolean;
  allowedFolderIds: string[];
  deniedTagIds: string[];
  autoTagId: string;
  /** Adresses publiques autorisées, séparées par des virgules. */
  allowedIps: string;
}

const EMPTY_DRAFT: TokenDraft = {
  name: '',
  limitFolders: false,
  write: true,
  delete: false,
  manage: false,
  allowedFolderIds: [],
  deniedTagIds: [],
  autoTagId: '',
  allowedIps: '',
};

function draftFromToken(token: ApiToken): TokenDraft {
  return {
    name: token.name,
    limitFolders: (token.allowedFolderIds ?? []).length > 0,
    write: token.permissions?.write !== false,
    delete: token.permissions?.delete === true,
    manage: token.permissions?.manage === true,
    allowedFolderIds: token.allowedFolderIds ?? [],
    deniedTagIds: token.deniedTagIds ?? [],
    autoTagId: token.autoTagId ?? '',
    allowedIps: (token.allowedIps ?? []).join(', '),
  };
}

function policyBody(draft: TokenDraft, withRead: boolean) {
  return {
    name: draft.name.trim(),
    permissions: { ...(withRead ? { read: true } : {}), write: draft.write, delete: draft.delete, manage: draft.manage },
    allowedFolderIds: draft.limitFolders ? draft.allowedFolderIds : [],
    deniedTagIds: draft.deniedTagIds,
    autoTagId: draft.autoTagId || null,
    allowedIps: draft.allowedIps.split(/[\s,;]+/).filter(Boolean),
  };
}

function toggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
}

/** Chemin lisible d'un dossier (« Clients / 2026 »). */
function makeFolderLabel(folders: Folder[]): (id: string) => string {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  return (id) => {
    const parts: string[] = [];
    const seen = new Set<string>();
    let current = byId.get(id);
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      parts.unshift(current.name);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return parts.length > 0 ? parts.join(' / ') : id;
  };
}

interface FieldsProps {
  draft: TokenDraft;
  onChange: (next: TokenDraft) => void;
  folders: Folder[];
  tags: Tag[];
  folderLabel: (id: string) => string;
}

/** Droits, dossiers, tags : le même formulaire sert à la création et à la modification. */
function TokenPolicyFields({ draft, onChange, folders, tags, folderLabel }: FieldsProps) {
  const set = (patch: Partial<TokenDraft>) => onChange({ ...draft, ...patch });
  const [ipHint, setIpHint] = useState('');
  const fillMyIp = async () => {
    setIpHint('');
    try {
      const res = await fetch('/api/client-ip');
      const data = await res.json();
      if (data.ip) {
        const current = draft.allowedIps.split(/[\s,;]+/).filter(Boolean);
        if (!current.includes(data.ip)) set({ allowedIps: [...current, data.ip].join(', ') });
      } else if (data.private) {
        setIpHint('Vous êtes sur le réseau privé : aucune adresse publique à ajouter pour cet accès.');
      } else {
        setIpHint('Adresse publique non déterminée depuis cet accès.');
      }
    } catch {
      setIpHint('Impossible de lire votre adresse.');
    }
  };
  const chipBase = 'flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors';
  const chipOff = 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400';

  return (
    <div className="space-y-3 border-t border-zinc-200 pt-2 text-xs dark:border-zinc-800">
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        <label className="flex cursor-pointer items-center gap-2">
          <input type="checkbox" checked={draft.write} onChange={(e) => set({ write: e.target.checked })} className="rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500" />
          <span className="text-zinc-700 dark:text-zinc-300">Écriture (création / modification)</span>
        </label>
        <label className="flex cursor-pointer items-center gap-2">
          <input type="checkbox" checked={draft.delete} onChange={(e) => set({ delete: e.target.checked })} className="rounded border-zinc-300 text-red-600 focus:ring-red-500" />
          <span className="text-zinc-700 dark:text-zinc-300">Suppression de notes</span>
        </label>
        <label className="flex cursor-pointer items-center gap-2">
          <input type="checkbox" checked={draft.manage} onChange={(e) => set({ manage: e.target.checked })} className="rounded border-zinc-300 text-amber-600 focus:ring-amber-500" />
          <span className="text-zinc-700 dark:text-zinc-300">Gère les jetons</span>
        </label>
      </div>
      {draft.manage && (
        <p className="rounded-md bg-amber-50 p-2 text-[11px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          Ce jeton pourra créer, modifier et révoquer des jetons, mais seulement avec des droits égaux ou inférieurs aux siens
          (mêmes dossiers ou moins). Ses tags interdits sont repris automatiquement chez ses jetons, même s'il ne les voit pas.
          Il ne voit que les jetons qu'il a créés. Révoquer ce jeton révoque aussi ceux qu'il a créés.
        </p>
      )}

      <div className="space-y-1.5">
        <div className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">Dossiers accessibles</div>
        <div className="flex flex-col gap-1">
          <label className="flex cursor-pointer items-center gap-2">
            <input type="radio" checked={!draft.limitFolders} onChange={() => set({ limitFolders: false })} className="text-indigo-600 focus:ring-indigo-500" />
            <span className="text-zinc-700 dark:text-zinc-300">Tous les dossiers (notes sans dossier et futurs dossiers compris)</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input type="radio" checked={draft.limitFolders} onChange={() => set({ limitFolders: true })} className="text-indigo-600 focus:ring-indigo-500" />
            <span className="text-zinc-700 dark:text-zinc-300">Seulement certains dossiers</span>
          </label>
        </div>
        {draft.limitFolders && (
          <>
            {folders.length === 0 ? (
              <p className="text-[11px] italic text-zinc-400">Aucun dossier créé dans le workspace.</p>
            ) : (
              <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
                {folders.map((folder) => {
                  const selected = draft.allowedFolderIds.includes(folder.id);
                  return (
                    <button
                      type="button"
                      key={folder.id}
                      onClick={() => set({ allowedFolderIds: toggle(draft.allowedFolderIds, folder.id) })}
                      className={clsx(chipBase, selected ? 'border-indigo-300 bg-indigo-50 font-medium text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300' : chipOff)}
                    >
                      <FolderIcon size={11} />
                      <span>{folderLabel(folder.id)}</span>
                    </button>
                  );
                })}
              </div>
            )}
            <p className="text-[11px] text-zinc-500">Les sous-dossiers sont inclus. Avec cette limite, les notes sans dossier ne sont pas visibles.</p>
            {draft.allowedFolderIds.length === 0 && (
              <p className="text-[11px] text-red-600 dark:text-red-400">Choisissez au moins un dossier.</p>
            )}
          </>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">
          <span>Tags à masquer au bot (laisser vide pour tout autoriser) :</span>
          <span className="font-normal text-zinc-400">
            {draft.deniedTagIds.length === 0 ? 'Aucun : tous les tags sont visibles' : draft.deniedTagIds.length + ' tag(s) masqué(s)'}
          </span>
        </div>
        {tags.length === 0 ? (
          <p className="text-[11px] italic text-zinc-400">Aucun tag créé dans le workspace.</p>
        ) : (
          <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
            {tags.map((tag) => {
              const denied = draft.deniedTagIds.includes(tag.id);
              return (
                <button
                  type="button"
                  key={tag.id}
                  onClick={() => set({ deniedTagIds: toggle(draft.deniedTagIds, tag.id), autoTagId: draft.autoTagId === tag.id ? '' : draft.autoTagId })}
                  className={clsx(chipBase, denied ? 'border-red-300 bg-red-50 font-medium text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300' : chipOff)}
                >
                  <TagIcon size={11} />
                  <span>{denied ? '⛔ ' : ''}#{tag.name}</span>
                </button>
              );
            })}
          </div>
        )}
        <p className="text-[11px] text-zinc-500">Un tag rouge est invisible pour le bot, ainsi que toutes les notes qui le portent. Ne cochez que ce qu'il ne doit pas voir.</p>
        {tags.length > 0 && draft.deniedTagIds.length >= tags.length && (
          <p className="rounded-md bg-red-50 p-2 text-[11px] text-red-700 dark:bg-red-950/40 dark:text-red-300">
            ⚠️ Tous les tags sont masqués : le bot ne verra aucun tag ni aucune note qui en porte un.
          </p>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <label className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">
          Tag appliqué automatiquement aux notes de ce bot :
          <select value={draft.autoTagId} onChange={(e) => set({ autoTagId: e.target.value })} className="field ml-2 h-8 px-2 text-xs font-normal">
            <option value="">Aucun</option>
            {tags.filter((tag) => !draft.deniedTagIds.includes(tag.id)).map((tag) => (
              <option key={tag.id} value={tag.id}>#{tag.name}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="space-y-1.5">
        <div className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">Accès depuis Internet (en plus du réseau privé / VPN)</div>
        <div className="flex gap-2">
          <input
            type="text"
            value={draft.allowedIps}
            onChange={(e) => set({ allowedIps: e.target.value })}
            placeholder="ex. 86.208.132.174 ou 86.208.0.0/16"
            className="field h-8 flex-1 px-2 font-mono text-xs"
          />
          <Button type="button" size="sm" variant="secondary" onClick={fillMyIp}>Mon IP actuelle</Button>
        </div>
        <p className="text-[11px] text-zinc-500">
          Sans adresse, ce jeton ne fonctionne que depuis le réseau privé ou le VPN. Séparez plusieurs adresses par une virgule ;
          les plages sont acceptées (/16 minimum).
        </p>
        {ipHint && <p className="text-[11px] text-amber-700 dark:text-amber-300">{ipHint}</p>}
      </div>
    </div>
  );
}

export function ServerAccountModal({ onClose }: { onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<'mcp' | 'security' | 'tokens' | 'trash' | 'users'>('mcp');
  const user = getBrowserUser();

  const folders = useAppStore((s) => s.data.folders);
  const tags = useAppStore((s) => s.data.tags);
  const folderLabel = useMemo(() => makeFolderLabel(folders), [folders]);
  const tagName = (id: string) => tags.find((tag) => tag.id === id)?.name ?? id;

  // Password state
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  // Tokens state
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [errorText, setErrorText] = useState('');

  const [newDraft, setNewDraft] = useState<TokenDraft>(EMPTY_DRAFT);
  const [showRestrictions, setShowRestrictions] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<TokenDraft>(EMPTY_DRAFT);

  // Adresse publique d'où vous êtes connecté (null sur le réseau privé) : préremplit les nouveaux jetons.
  const [myIp, setMyIp] = useState<string | null>(null);
  useEffect(() => {
    fetch('/api/client-ip')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setMyIp(typeof data?.ip === 'string' ? data.ip : null))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (myIp) setNewDraft((draft) => (draft.allowedIps ? draft : { ...draft, allowedIps: myIp }));
  }, [myIp]);

  const fetchTokens = async () => {
    try {
      const res = await fetch('/api/tokens');
      if (res.ok) {
        const data = await res.json();
        setTokens(data.tokens || []);
      }
    } catch {}
  };

  useEffect(() => {
    void fetchTokens();
  }, []);

  const submitPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage('');
    if (next.length < 12) return setMessage('Le nouveau mot de passe doit contenir au moins 12 caractères.');
    if (next !== confirm) return setMessage('La confirmation ne correspond pas.');
    setLoading(true);
    try {
      await changeServerPassword(current, next);
      setCurrent('');
      setNext('');
      setConfirm('');
      setMessage('Mot de passe modifié. Les autres sessions ont été déconnectées.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Modification impossible');
    } finally {
      setLoading(false);
    }
  };

  const createToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDraft.name.trim() || tokenLoading) return;
    setTokenLoading(true);
    setCreatedToken(null);
    setErrorText('');
    try {
      const res = await fetch('/api/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(policyBody(newDraft, true)),
      });
      if (res.ok) {
        const data = await res.json();
        setCreatedToken(data.token);
        setNewDraft({ ...EMPTY_DRAFT, allowedIps: myIp ?? '' });
        setShowRestrictions(false);
        await fetchTokens();
      } else {
        const err = await res.json().catch(() => ({}));
        setErrorText(err.error || 'Erreur (' + res.status + ')');
      }
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : 'Échec de connexion réseau');
    } finally {
      setTokenLoading(false);
    }
  };

  const startEdit = (token: ApiToken) => {
    setEditingId(token.id);
    setEditDraft(draftFromToken(token));
    setErrorText('');
  };

  const saveEdit = async () => {
    if (!editingId || !editDraft.name.trim() || tokenLoading) return;
    setTokenLoading(true);
    setErrorText('');
    try {
      const res = await fetch('/api/tokens/' + editingId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(policyBody(editDraft, false)),
      });
      if (res.ok) {
        setEditingId(null);
        await fetchTokens();
      } else {
        const err = await res.json().catch(() => ({}));
        setErrorText(err.error || 'Erreur (' + res.status + ')');
      }
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : 'Échec de connexion réseau');
    } finally {
      setTokenLoading(false);
    }
  };

  const deleteToken = async (token: ApiToken) => {
    const children = tokens.filter((other) => other.createdByTokenId === token.id).length;
    const question = children > 0
      ? 'Révoquer « ' + token.name + ' » révoquera aussi les ' + children + ' jeton(s) qu\'il a créés. Continuer ?'
      : 'Révoquer le jeton « ' + token.name + ' » ?';
    if (!window.confirm(question)) return;
    try {
      await fetch('/api/tokens/' + token.id, { method: 'DELETE' });
      if (editingId === token.id) setEditingId(null);
      await fetchTokens();
    } catch {}
  };

  const copyToClipboard = () => {
    if (!createdToken) return;
    navigator.clipboard.writeText(createdToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const tabClass = (tab: 'mcp' | 'tokens' | 'security' | 'trash' | 'users') =>
    clsx(
      'flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-semibold',
      activeTab === tab
        ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
        : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300',
    );

  return (
    <Modal title={`Compte & Accès distant${user ? ' · ' + user.username : ''}`} onClose={onClose} wide={activeTab === 'users'}>
      <div className="mb-4 flex flex-wrap border-b border-zinc-200 dark:border-zinc-800">
        <button type="button" onClick={() => setActiveTab('mcp')} className={tabClass('mcp')}>
          <Bot size={14} />
          <span>Connecter une IA</span>
        </button>
        <button type="button" onClick={() => setActiveTab('tokens')} className={tabClass('tokens')}>
          <Key size={14} />
          <span>Jetons API & Bots (Hermès / Mia)</span>
        </button>
        <button type="button" onClick={() => setActiveTab('security')} className={tabClass('security')}>
          <ShieldCheck size={14} />
          <span>Sécurité du mot de passe</span>
        </button>
        <button type="button" onClick={() => setActiveTab('trash')} className={tabClass('trash')}>
          <Trash2 size={14} />
          <span>Corbeille</span>
        </button>
        {user?.role === 'admin' && <button type="button" onClick={() => setActiveTab('users')} className={tabClass('users')}><Users size={14} /><span>Utilisateurs</span></button>}
      </div>

      {activeTab === 'mcp' ? (
        <McpConnectPanel
          folders={folders}
          folderLabel={folderLabel}
          myIp={myIp}
          onTokensChanged={() => void fetchTokens()}
          onOpenTokens={() => setActiveTab('tokens')}
        />
      ) : activeTab === 'tokens' ? (
        <div className="space-y-4">
          <p className="text-xs text-zinc-500">
            Un jeton par bot ou service (Hermès, Mia, extension). Choisissez les dossiers accessibles, les tags interdits et le tag
            de traçabilité ; vous pouvez les modifier à tout moment avec le crayon.
          </p>

          <form onSubmit={createToken} className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50/50 p-3 dark:border-zinc-800 dark:bg-zinc-900/50">
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Nom du bot / jeton (ex: Mia - Micro-entreprise, Hermès Dev)"
                value={newDraft.name}
                onChange={(e) => setNewDraft({ ...newDraft, name: e.target.value })}
                className="field h-9 flex-1 px-3 text-xs"
              />
              <Button
                type="submit"
                size="sm"
                variant="primary"
                disabled={!newDraft.name.trim() || tokenLoading || (newDraft.limitFolders && newDraft.allowedFolderIds.length === 0)}
                icon={tokenLoading && editingId === null ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
              >
                Créer
              </Button>
            </div>

            <button
              type="button"
              onClick={() => setShowRestrictions(!showRestrictions)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
            >
              <SlidersHorizontal size={13} />
              <span>{showRestrictions ? 'Masquer les restrictions du bot' : "Configurer les restrictions d'accès & tags"}</span>
            </button>

            {!showRestrictions && newDraft.allowedIps && (
              <p className="text-[11px] text-zinc-500">
                🌐 Accessible depuis Internet pour : <span className="font-mono">{newDraft.allowedIps}</span> (votre IP actuelle, modifiable dans
                les restrictions) · réseau privé / VPN dans tous les cas.
              </p>
            )}

            {showRestrictions && (
              <TokenPolicyFields draft={newDraft} onChange={setNewDraft} folders={folders} tags={tags} folderLabel={folderLabel} />
            )}
          </form>

          {errorText && (
            <div className="rounded-lg bg-red-50 p-2.5 text-xs text-red-600 dark:bg-red-950/40 dark:text-red-300">⚠️ {errorText}</div>
          )}

          {createdToken && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/40">
              <span className="text-[11px] font-semibold text-amber-900 dark:text-amber-200">
                Copiez ce jeton maintenant (il ne sera plus jamais réaffiché) :
              </span>
              <div className="mt-1 flex items-center gap-2">
                <input type="text" readOnly value={createdToken} className="field h-8 flex-1 font-mono text-xs text-amber-900 dark:text-amber-100" />
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={copyToClipboard}
                  icon={copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                >
                  {copied ? 'Copié' : 'Copier'}
                </Button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              Jetons et Bots actifs ({tokens.length})
            </span>
            {tokens.length === 0 ? (
              <p className="text-xs italic text-zinc-400">Aucun jeton API créé.</p>
            ) : (
              <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                {tokens.map((t) => {
                  const canWrite = t.permissions?.write !== false;
                  const folderNames = (t.allowedFolderIds ?? []).map(folderLabel);
                  const deniedNames = (t.deniedTagIds ?? []).map(tagName);
                  const autoName = t.autoTagId ? tagName(t.autoTagId) : null;
                  const editing = editingId === t.id;

                  return (
                    <div key={t.id} className="flex flex-col gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50/50 p-2.5 dark:border-zinc-800 dark:bg-zinc-900/50">
                      <div className="flex items-center justify-between">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">{t.name}</span>
                          <span
                            className={clsx(
                              'rounded px-1.5 py-0.5 text-[10px] font-medium',
                              canWrite
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                                : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
                            )}
                          >
                            {canWrite ? 'Lecture + Écriture' : 'Lecture seule'}
                          </span>
                          {t.permissions?.delete === true && (
                            <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-800 dark:bg-red-950/60 dark:text-red-300">Suppression</span>
                          )}
                          {t.permissions?.manage === true && (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">🔑 Gère les jetons</span>
                          )}
                        </div>
                        <div className="flex items-center gap-0.5">
                          <button
                            type="button"
                            onClick={() => (editing ? setEditingId(null) : startEdit(t))}
                            title={editing ? 'Annuler la modification' : 'Modifier les droits de ce jeton'}
                            className="rounded p-1 text-zinc-400 hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-indigo-950/40"
                          >
                            {editing ? <X size={13} /> : <Pencil size={13} />}
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteToken(t)}
                            title="Révoquer ce jeton"
                            className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                        {folderNames.length > 0 ? (
                          <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">📁 {folderNames.join(', ')}</span>
                        ) : (
                          <span className="text-zinc-400">📁 Tous dossiers</span>
                        )}
                        {deniedNames.length > 0 && (
                          <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-700 dark:bg-red-950/50 dark:text-red-300">⛔ {deniedNames.map((n) => '#' + n).join(', ')}</span>
                        )}
                        {autoName && (
                          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">🏷️ #{autoName}</span>
                        )}
                        {(t.allowedIps ?? []).length > 0 ? (
                          <span className="rounded bg-sky-50 px-1.5 py-0.5 font-mono text-sky-700 dark:bg-sky-950/50 dark:text-sky-300">🌐 {(t.allowedIps ?? []).join(', ')}</span>
                        ) : (
                          <span className="text-zinc-400">🔒 Réseau privé / VPN seulement</span>
                        )}
                        {t.createdByTokenId && (
                          <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">créé par {t.createdByName ?? 'un jeton'}</span>
                        )}
                      </div>

                      <div className="text-[10px] text-zinc-400">
                        Créé le {new Date(t.created_at).toLocaleDateString('fr-FR')}
                        {t.last_used_at && ' · Utilisé le ' + new Date(t.last_used_at).toLocaleDateString('fr-FR')}
                      </div>

                      {editing && (
                        <div className="space-y-2 pt-1">
                          <input
                            type="text"
                            value={editDraft.name}
                            onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                            className="field h-8 w-full px-3 text-xs"
                          />
                          <TokenPolicyFields draft={editDraft} onChange={setEditDraft} folders={folders} tags={tags} folderLabel={folderLabel} />
                          <div className="flex justify-end gap-2">
                            <Button size="sm" variant="secondary" onClick={() => setEditingId(null)}>Annuler</Button>
                            <Button
                              size="sm"
                              variant="primary"
                              onClick={saveEdit}
                              disabled={!editDraft.name.trim() || tokenLoading || (editDraft.limitFolders && editDraft.allowedFolderIds.length === 0)}
                              icon={tokenLoading ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                            >
                              Enregistrer
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : activeTab === 'users' ? (
        <UsersPanel />
      ) : activeTab === 'trash' ? (
        <NoteTrashPanel />
      ) : (
        <form onSubmit={submitPassword} className="space-y-3">
          <div className="flex items-start gap-2 rounded-lg bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-300">
            <ShieldCheck size={16} className="shrink-0" />
            <span>Compte serveur protégé par scrypt et session HTTPS HttpOnly. Les notes sont synchronisées dans PostgreSQL.</span>
          </div>
          {[
            ['Mot de passe actuel', current, setCurrent],
            ['Nouveau mot de passe', next, setNext],
            ['Confirmer', confirm, setConfirm],
          ].map(([label, value, setter]) => (
            <label key={label as string} className="block text-xs text-zinc-500">
              {label as string}
              <input
                type="password"
                autoComplete={label === 'Mot de passe actuel' ? 'current-password' : 'new-password'}
                className="field mt-1 h-9 w-full px-3 text-sm"
                value={value as string}
                onChange={(e) => (setter as (v: string) => void)(e.target.value)}
              />
            </label>
          ))}
          {message && <p className="rounded-lg bg-zinc-100 p-2.5 text-xs dark:bg-zinc-800">{message}</p>}
          <Button
            type="submit"
            disabled={loading}
            icon={loading ? <Loader2 size={14} className="animate-spin" /> : <Key size={14} />}
          >
            Modifier le mot de passe
          </Button>
        </form>
      )}
    </Modal>
  );
}
