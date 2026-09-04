/**
 * AuthLockScreen — Écran de verrouillage / Déverrouillage sécurisé
 * -----------------------------------------------------------------
 * Protection anti-brute-force avec temporisation, support login & clé de secours.
 */
import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Eye,
  EyeOff,
  KeyRound,
  LifeBuoy,
  Loader2,
  Lock,
  ShieldAlert,
  ShieldCheck,
  Unlock,
  User,
} from 'lucide-react';
import { useAppStore } from '@/store/app-store';
import {
  getAuthConfig,
  getThrottleStatus,
  unlockWithPassword,
  unlockWithRecoveryKey,
  saveAuthConfig,
} from '@/storage/auth-manager';
import { Button } from '@/components/ui/Button';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { createLocalStorageAdapter, hasExistingLocalWorkspace } from '@/storage/local-storage';
import { isWorkspaceEmpty, isLegacyDemoWorkspace } from '@/storage/migration';

export function AuthLockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const bootstrap = useAppStore((s) => s.bootstrap);
  const resetAll = useAppStore((s) => s.resetAll);
  const toast = useAppStore((s) => s.toast);

  const authConfig = getAuthConfig();
  const hasUsername = Boolean(authConfig?.username);

  const [username, setUsername] = useState(authConfig?.username ?? '');
  const [password, setPassword] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  // Rate-limiting throttle state
  const [lockoutSeconds, setLockoutSeconds] = useState(0);

  useEffect(() => {
    const checkThrottle = () => {
      const status = getThrottleStatus();
      if (status.isLockedOut) {
        setLockoutSeconds(status.remainingSeconds);
      } else {
        setLockoutSeconds(0);
      }
    };
    checkThrottle();
    const interval = setInterval(checkThrottle, 1000);
    return () => clearInterval(interval);
  }, []);

  const migrateUnlockedVault = async () => {
    const store = useAppStore.getState();
    if (store.storage.id !== 'remote') return;
    const remoteState = await store.storage.load();
    if (!isWorkspaceEmpty(remoteState)) {
      throw new Error('Le serveur contient déjà des données. Le coffre local a été conservé pour éviter tout écrasement.');
    }
    if (!hasExistingLocalWorkspace()) {
      throw new Error('Aucun coffre local à importer. Aucune donnée locale n’a été supprimée.');
    }
    const localState = await createLocalStorageAdapter().load();
    if (!localState) throw new Error('Impossible de lire le coffre local. Il a été conservé.');
    if (isLegacyDemoWorkspace(localState)) {
      throw new Error('Seules les données de démonstration ont été trouvées. Aucun seed n’a été envoyé au serveur.');
    }
    await store.storage.save(localState);
    // Uniquement après confirmation de la sauvegarde distante.
    saveAuthConfig(null);
  };

  const handleUnlock = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (lockoutSeconds > 0 || loading) return;

    setError(null);
    setLoading(true);

    try {
      if (useRecovery) {
        if (!recoveryKey.trim()) {
          setError('Veuillez saisir votre clé de secours.');
          setLoading(false);
          return;
        }
        const res = await unlockWithRecoveryKey(recoveryKey);
        if (res.success) {
          await migrateUnlockedVault();
          await bootstrap(true);
          onUnlocked();
          toast('success', 'Coffre déverrouillé et synchronisé !');
        } else {
          setError(res.error || 'Clé de secours invalide.');
        }
      } else {
        if (!password) {
          setError('Veuillez saisir votre mot de passe.');
          setLoading(false);
          return;
        }
        const res = await unlockWithPassword(password, hasUsername ? username : undefined);
        if (res.success) {
          await migrateUnlockedVault();
          await bootstrap(true);
          onUnlocked();
          toast('success', 'Espace local importé et synchronisé !');
        } else {
          setError(res.error || 'Mot de passe incorrect.');
          const status = getThrottleStatus();
          if (status.isLockedOut) {
            setLockoutSeconds(status.remainingSeconds);
          }
        }
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Erreur lors du déchiffrement du coffre.',
      );
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    localStorage.clear();
    await resetAll();
    window.location.reload();
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-zinc-950 px-4 text-zinc-100">
      {/* Fond avec léger dégradé */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-900/20 via-zinc-950 to-zinc-950 pointer-events-none" />

      <div className="relative w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900/90 p-6 shadow-2xl backdrop-blur-xl sm:p-8">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600/20 text-indigo-400 ring-1 ring-indigo-500/30 shadow-lg shadow-indigo-500/10">
            {useRecovery ? <LifeBuoy size={26} /> : <Lock size={26} />}
          </div>
          <h1 className="text-xl font-bold tracking-tight text-white">
            {useRecovery ? 'Récupération d\'urgence' : 'Coffre-fort verrouillé'}
          </h1>
          <p className="mt-1 text-xs text-zinc-400">
            {useRecovery
              ? 'Saisis ta clé de secours (MN-XXXX-XXXX-XXXX).'
              : 'Saisis tes identifiants pour déchiffrer ton espace.'}
          </p>
          <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-indigo-500/10 px-2.5 py-0.5 text-[10px] font-medium text-indigo-300">
            <ShieldCheck size={11} />
            Chiffrement AES-GCM 256 + Anti Brute-Force
          </div>
        </div>

        {lockoutSeconds > 0 && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-500/40 bg-red-950/40 p-3 text-xs text-red-300">
            <ShieldAlert size={16} className="shrink-0 text-red-400" />
            <div>
              <p className="font-semibold">Temporisation de sécurité active</p>
              <p className="text-[11px] text-red-300/80">
                Trop d'échecs. Réessaie dans <strong>{lockoutSeconds}s</strong>.
              </p>
            </div>
          </div>
        )}

        <form onSubmit={handleUnlock} className="space-y-3.5">
          {!useRecovery ? (
            <>
              {hasUsername && (
                <div>
                  <label className="block text-xs font-semibold text-zinc-400 mb-1">
                    Identifiant
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      disabled={loading || lockoutSeconds > 0}
                      className="field h-10 w-full bg-zinc-800/80 px-3.5 pl-9 text-sm text-zinc-100 placeholder-zinc-500"
                      placeholder="Nom d'utilisateur ou login…"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                    />
                    <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-zinc-400 mb-1">
                  Mot de passe maître
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    autoFocus={!hasUsername || username.length > 0}
                    disabled={loading || lockoutSeconds > 0}
                    className="field h-10 w-full bg-zinc-800/80 px-3.5 pr-10 text-sm text-zinc-100 placeholder-zinc-500 transition-all focus:border-indigo-500 focus:bg-zinc-800 focus:ring-2 focus:ring-indigo-500/20"
                    placeholder="Mot de passe maître…"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (error) setError(null);
                    }}
                  />
                  <button
                    type="button"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200"
                    onClick={() => setShowPassword((v) => !v)}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1">
                Clé de secours (Recovery Key)
              </label>
              <div className="relative">
                <input
                  type="text"
                  autoFocus
                  disabled={loading || lockoutSeconds > 0}
                  className="field h-10 w-full bg-zinc-800/80 px-3.5 pl-9 font-mono text-xs text-zinc-100 placeholder-zinc-500"
                  placeholder="MN-XXXX-XXXX-XXXX-XXXX…"
                  value={recoveryKey}
                  onChange={(e) => {
                    setRecoveryKey(e.target.value.toUpperCase());
                    if (error) setError(null);
                  }}
                />
                <KeyRound size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
              </div>
            </div>
          )}

          {error && (
            <p className="flex items-center gap-1.5 text-xs font-medium text-red-400">
              <AlertTriangle size={13} className="shrink-0" />
              {error}
            </p>
          )}

          <Button
            type="submit"
            variant="primary"
            disabled={loading || lockoutSeconds > 0 || (!useRecovery && password === '') || (useRecovery && recoveryKey === '')}
            className="h-10 w-full justify-center text-sm font-semibold shadow-lg shadow-indigo-600/25"
            icon={
              loading ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Unlock size={15} />
              )
            }
          >
            {loading ? 'Déchiffrement en cours…' : useRecovery ? 'Déverrouiller avec la clé' : 'Déverrouiller'}
          </Button>
        </form>

        <div className="mt-5 flex items-center justify-between border-t border-zinc-800 pt-3 text-[11px]">
          <button
            type="button"
            className="text-indigo-400 hover:text-indigo-300 transition-colors"
            onClick={() => {
              setError(null);
              setUseRecovery((v) => !v);
            }}
          >
            {useRecovery ? '← Utiliser le mot de passe' : 'Clé de secours d\'urgence'}
          </button>

          <button
            type="button"
            className="text-zinc-500 hover:text-zinc-400 transition-colors"
            onClick={() => setConfirmReset(true)}
          >
            Réinitialiser
          </button>
        </div>
      </div>

      <ConfirmModal
        open={confirmReset}
        title="Réinitialiser l'application"
        message="En cas de perte du mot de passe maître et de la clé de secours, les données chiffrées ne peuvent pas être récupérées. La réinitialisation effacera toutes les données locales."
        confirmLabel="Réinitialiser tout"
        onConfirm={handleReset}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  );
}
