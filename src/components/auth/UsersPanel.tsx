import { useEffect, useState } from 'react';
import { Loader2, Plus, Users } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { getBrowserUser } from '@/lib/browser-user';
import { createServerUser, listServerUsers, resetServerUserPassword, updateServerUser, type ManagedUser } from '@/lib/server-auth';

export function UsersPanel() {
  const currentUser = getBrowserUser();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<ManagedUser['role']>('user');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [resetId, setResetId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState('');

  const refresh = async () => setUsers(await listServerUsers());
  useEffect(() => {
    void refresh().catch((e: Error) => setError(e.message)).finally(() => setLoading(false));
  }, []);

  const perform = async (action: () => Promise<void>, success: string) => {
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try { await action(); await refresh(); setMessage(success); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Opération impossible'); }
    finally { setBusy(false); }
  };

  const create = (event: React.FormEvent) => {
    event.preventDefault();
    void perform(async () => {
      await createServerUser(username.trim(), password, role);
      setUsername(''); setPassword(''); setRole('user');
    }, 'Compte créé. Transmettez les identifiants à son propriétaire.');
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-500">Chaque compte possède ses propres notes, tâches, réglages IA et jetons. Les administrateurs gèrent les comptes.</p>
      <form onSubmit={create} className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50/50 p-3 dark:border-zinc-800 dark:bg-zinc-900/50">
        <div className="flex items-center gap-2 text-xs font-semibold"><Users size={14} /> Nouveau compte</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-zinc-500">Identifiant
            <input required maxLength={80} autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} className="field mt-1 h-9 w-full px-3 text-sm" />
          </label>
          <label className="text-xs text-zinc-500">Mot de passe initial
            <input required type="password" minLength={12} maxLength={512} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className="field mt-1 h-9 w-full px-3 text-sm" />
          </label>
        </div>
        <div className="flex items-end justify-between gap-3">
          <label className="text-xs text-zinc-500">Rôle
            <select value={role} onChange={(e) => setRole(e.target.value as ManagedUser['role'])} className="field mt-1 block h-9 px-2 text-xs">
              <option value="user">Utilisateur</option><option value="admin">Administrateur</option>
            </select>
          </label>
          <Button type="submit" size="sm" disabled={busy || loading || !username.trim() || password.length < 12} icon={busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}>Créer le compte</Button>
        </div>
        <p className="text-[11px] text-zinc-500">12 caractères minimum. Le propriétaire peut ensuite changer son mot de passe dans Sécurité.</p>
      </form>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-2.5 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      {message && <p role="status" className="rounded-lg bg-emerald-50 p-2.5 text-xs text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">{message}</p>}
      {loading ? <p className="text-xs text-zinc-500">Chargement des comptes…</p> : (
        <div className="space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Comptes ({users.length})</div>
          {users.map((user) => {
            const self = user.id === currentUser?.id;
            return (
              <div key={user.id} className="space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div><span className="text-sm font-semibold">{user.username}</span>{self && <span className="ml-2 text-[11px] text-zinc-400">Vous</span>}
                    <p className="mt-0.5 text-[11px] text-zinc-500">{user.disabledAt ? 'Désactivé' : 'Actif'} · Créé le {new Date(user.createdAt).toLocaleDateString('fr-FR')}</p>
                  </div>
                  <select aria-label={`Rôle de ${user.username}`} value={user.role} disabled={busy || self} onChange={(e) => {
                    const nextRole = e.target.value as ManagedUser['role'];
                    if (window.confirm(`Modifier le rôle de « ${user.username} » ? Ses sessions seront déconnectées.`)) {
                      void perform(() => updateServerUser(user.id, { role: nextRole }), 'Rôle mis à jour.');
                    }
                  }} className="field h-8 px-2 text-xs"><option value="user">Utilisateur</option><option value="admin">Administrateur</option></select>
                </div>
                {!self && <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => { setResetId(resetId === user.id ? null : user.id); setResetPassword(''); }}>Réinitialiser le mot de passe</Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => {
                    const disabled = !user.disabledAt;
                    if (!disabled || window.confirm(`Désactiver « ${user.username} » ? Ses sessions et ses bots perdront l’accès. Ses données seront conservées.`)) {
                      void perform(() => updateServerUser(user.id, { disabled }), disabled ? 'Compte désactivé. Données conservées.' : 'Compte réactivé.');
                    }
                  }}>{user.disabledAt ? 'Réactiver' : 'Désactiver'}</Button>
                </div>}
                {resetId === user.id && <form className="space-y-2 border-t border-zinc-200 pt-2 dark:border-zinc-800" onSubmit={(e) => {
                  e.preventDefault();
                  void perform(async () => { await resetServerUserPassword(user.id, resetPassword); setResetId(null); setResetPassword(''); }, 'Mot de passe réinitialisé. Toutes les sessions de ce compte ont été déconnectées.');
                }}>
                  <label className="block text-xs text-zinc-500">Nouveau mot de passe pour {user.username}<input required type="password" minLength={12} maxLength={512} autoComplete="new-password" value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} className="field mt-1 h-9 w-full px-3 text-sm" /></label>
                  <p className="text-[11px] text-zinc-500">Toutes les sessions seront déconnectées. Les jetons API existants sont conservés.</p>
                  <Button type="submit" size="sm" disabled={busy || resetPassword.length < 12}>Enregistrer le mot de passe</Button>
                </form>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
