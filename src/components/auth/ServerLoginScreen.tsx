import { useState } from 'react';
import { Loader2, Lock, LogIn } from 'lucide-react';
import { loginServer, type ServerUser } from '@/lib/server-auth';
import { Button } from '@/components/ui/Button';

export function ServerLoginScreen({ onAuthenticated }: { onAuthenticated: (user: ServerUser) => Promise<void> }) {
  const [username, setUsername] = useState('Pinguin');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (loading) return;
    setLoading(true); setError('');
    try {
      const user = await loginServer(username, password);
      await onAuthenticated(user);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Connexion impossible');
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-zinc-950 px-4 text-zinc-100">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-7 shadow-2xl">
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-400"><Lock size={24} /></div>
          <h1 className="text-xl font-bold">Connexion à MansotNote</h1>
          <p className="mt-1 text-xs text-zinc-400">Tes notes sont synchronisées sur tous tes appareils.</p>
        </div>
        <label className="block text-xs text-zinc-400">Identifiant
          <input autoFocus autoComplete="username" className="field mt-1 h-10 w-full px-3 text-sm" value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label className="block text-xs text-zinc-400">Mot de passe
          <input type="password" autoComplete="current-password" className="field mt-1 h-10 w-full px-3 text-sm" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="rounded-lg bg-red-950/50 p-2.5 text-xs text-red-300">{error}</p>}
        <Button type="submit" className="w-full" disabled={loading} icon={loading ? <Loader2 size={15} className="animate-spin" /> : <LogIn size={15} />}>
          {loading ? 'Connexion…' : 'Se connecter'}
        </Button>
      </form>
    </div>
  );
}
