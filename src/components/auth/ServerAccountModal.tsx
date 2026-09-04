import { useEffect, useState } from 'react';
import { Check, Copy, Key, Loader2, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { changeServerPassword } from '@/lib/server-auth';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

interface ApiToken {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

export function ServerAccountModal({ onClose }: { onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<'security' | 'tokens'>('tokens');

  // Password state
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  // Tokens state
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [newTokenName, setNewTokenName] = useState('');
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const [errorText, setErrorText] = useState('');

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
    if (!newTokenName.trim() || tokenLoading) return;
    setTokenLoading(true);
    setCreatedToken(null);
    setErrorText('');
    try {
      const res = await fetch('/api/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newTokenName.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        setCreatedToken(data.token);
        setNewTokenName('');
        await fetchTokens();
      } else {
        const err = await res.json().catch(() => ({}));
        setErrorText(err.error || `Erreur (${res.status})`);
      }
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : 'Échec de connexion réseau');
    } finally {
      setTokenLoading(false);
    }
  };

  const deleteToken = async (id: string) => {
    try {
      await fetch(`/api/tokens/${id}`, { method: 'DELETE' });
      setTokens((prev) => prev.filter((t) => t.id !== id));
    } catch {}
  };

  const copyToClipboard = () => {
    if (!createdToken) return;
    navigator.clipboard.writeText(createdToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Modal title="Compte & Accès distant" onClose={onClose}>
      <div className="mb-4 flex border-b border-zinc-200 dark:border-zinc-800">
        <button
          type="button"
          onClick={() => setActiveTab('tokens')}
          className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-semibold ${
            activeTab === 'tokens'
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
          }`}
        >
          <Key size={14} />
          <span>Tokens API & Extension</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('security')}
          className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-semibold ${
            activeTab === 'security'
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
          }`}
        >
          <ShieldCheck size={14} />
          <span>Sécurité du mot de passe</span>
        </button>
      </div>

      {activeTab === 'tokens' ? (
        <div className="space-y-4">
          <p className="text-xs text-zinc-500">
            Générez des jetons d'accès Bearer pour connecter l'extension navigateur <strong>MansotNote Web Clipper</strong> sans dépendre d'une session navigateur.
          </p>

          <form onSubmit={createToken} className="flex gap-2">
            <input
              type="text"
              placeholder="Nom du jeton (ex: Clipper Chrome PC)"
              value={newTokenName}
              onChange={(e) => setNewTokenName(e.target.value)}
              className="field h-9 flex-1 px-3 text-xs"
            />
            <Button
              type="submit"
              size="sm"
              variant="primary"
              disabled={!newTokenName.trim() || tokenLoading}
              icon={tokenLoading ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            >
              Créer
            </Button>
          </form>

          {errorText && (
            <div className="rounded-lg bg-red-50 p-2.5 text-xs text-red-600 dark:bg-red-950/40 dark:text-red-300">
              ⚠️ {errorText}
            </div>
          )}

          {createdToken && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/40">
              <span className="text-[11px] font-semibold text-amber-900 dark:text-amber-200">
                Copiez ce jeton maintenant (il ne sera plus jamais réaffiché) :
              </span>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={createdToken}
                  className="field h-8 flex-1 font-mono text-xs text-amber-900 dark:text-amber-100"
                />
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
              Jetons actifs ({tokens.length})
            </span>
            {tokens.length === 0 ? (
              <p className="text-xs text-zinc-400 italic">Aucun jeton API créé.</p>
            ) : (
              <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
                {tokens.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between rounded-lg border border-zinc-200 bg-zinc-50/50 p-2.5 dark:border-zinc-800 dark:bg-zinc-900/50"
                  >
                    <div>
                      <div className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">{t.name}</div>
                      <div className="text-[10px] text-zinc-400">
                        Créé le {new Date(t.created_at).toLocaleDateString('fr-FR')}
                        {t.last_used_at && ` · Utilisé le ${new Date(t.last_used_at).toLocaleDateString('fr-FR')}`}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => deleteToken(t.id)}
                      title="Révoquer ce jeton"
                      className="rounded p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
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
