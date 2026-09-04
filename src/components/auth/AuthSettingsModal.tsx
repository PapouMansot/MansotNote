/**
 * AuthSettingsModal — Configuration avancée de la sécurité & du coffre-fort
 */
import { useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  ShieldCheck,
  Unlock,
  User,
} from 'lucide-react';
import { useAppStore } from '@/store/app-store';
import {
  changePassword,
  disableAuth,
  getAuthConfig,
  isAuthEnabled,
  saveAuthConfig,
  setupAuth,
} from '@/storage/auth-manager';
import { evaluatePasswordStrength } from '@/lib/crypto';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Input';

const AUTO_LOCK_OPTIONS = [
  { value: '0', label: 'Jamais' },
  { value: '5', label: 'Après 5 minutes d\'inactivité' },
  { value: '15', label: 'Après 15 minutes d\'inactivité' },
  { value: '30', label: 'Après 30 minutes d\'inactivité' },
  { value: '60', label: 'Après 1 heure d\'inactivité' },
];

export function AuthSettingsModal({ onClose }: { onClose: () => void }) {
  const state = useAppStore();
  const authConfig = getAuthConfig();
  const enabled = isAuthEnabled();

  const [mode, setMode] = useState<'status' | 'setup' | 'change' | 'disable' | 'recovery_success'>(
    enabled ? 'status' : 'setup',
  );

  // Form states
  const [username, setUsername] = useState(authConfig?.username ?? '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [autoLockMinutes, setAutoLockMinutes] = useState(
    String(authConfig?.autoLockMinutes ?? 15),
  );
  const [generatedRecoveryKey, setGeneratedRecoveryKey] = useState('');
  const [copiedKey, setCopiedKey] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const strength = evaluatePasswordStrength(password);

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      setError('Le mot de passe doit comporter au moins 8 caractères.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Les deux mots de passe ne correspondent pas.');
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const res = await setupAuth(password, state.data, {
        username: username.trim() || undefined,
        autoLockMinutes: parseInt(autoLockMinutes, 10),
      });
      setGeneratedRecoveryKey(res.recoveryKey);
      setMode('recovery_success');
      state.toast('success', 'Chiffrement activé avec succès !');
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Erreur lors de l'activation de l'authentification.",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      setError('Le nouveau mot de passe doit comporter au moins 8 caractères.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Les nouveaux mots de passe ne correspondent pas.');
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const ok = await changePassword(currentPassword, password, state.data, username.trim() || undefined);
      if (ok) {
        state.toast('success', 'Identifiants modifiés avec succès !');
        onClose();
      } else {
        setError('Le mot de passe actuel est incorrect.');
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Erreur lors de la modification.',
      );
    } finally {
      setLoading(false);
    }
  };

  const handleDisable = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const ok = await disableAuth(currentPassword, state.data, authConfig?.username);
      if (ok) {
        state.toast('info', 'Authentification et chiffrement désactivés.');
        onClose();
      } else {
        setError('Mot de passe incorrect.');
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Erreur lors de la désactivation.',
      );
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateAutoLock = (val: string) => {
    setAutoLockMinutes(val);
    if (authConfig) {
      saveAuthConfig({
        ...authConfig,
        autoLockMinutes: parseInt(val, 10),
      });
      state.toast('success', 'Délai de verrouillage mis à jour');
    }
  };

  const copyRecoveryKey = () => {
    navigator.clipboard.writeText(generatedRecoveryKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  return (
    <Modal title="Sécurité, Authentification & Chiffrement" onClose={onClose}>
      <div className="space-y-5">
        {/* ------------------------------ Statut ------------------------------ */}
        {mode === 'status' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-xl border border-indigo-200 bg-indigo-50/50 p-4 dark:border-indigo-900/60 dark:bg-indigo-950/30">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
                <ShieldCheck size={22} />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Coffre-fort chiffré actif
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {authConfig?.username
                    ? `Protégé par identifiant (${authConfig.username}) & mot de passe maître.`
                    : 'Protégé par mot de passe maître et chiffrement AES-GCM 256 bits.'}
                </p>
              </div>
            </div>

            {/* Protections actives */}
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3.5 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-300">
              <div className="font-semibold text-zinc-800 dark:text-zinc-100 mb-2">
                Protections contre les attaques actives :
              </div>
              <ul className="space-y-1.5 text-[11px]">
                <li className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                  <Check size={13} />
                  <span><strong>Anti-Brute Force :</strong> Temporisation progressive après échecs répétés</span>
                </li>
                <li className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                  <Check size={13} />
                  <span><strong>Anti-Timing Attacks :</strong> Vérification en temps constant (Constant-Time)</span>
                </li>
                <li className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                  <Check size={13} />
                  <span><strong>Dérivation PBKDF2 :</strong> 100 000 itérations HMAC-SHA-256 avec sel aléatoire</span>
                </li>
              </ul>
            </div>

            <div>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  Verrouillage automatique
                </span>
                <Select
                  className="w-full"
                  value={autoLockMinutes}
                  options={AUTO_LOCK_OPTIONS}
                  onChange={(e) => handleUpdateAutoLock(e.target.value)}
                />
              </label>
            </div>

            <div className="flex flex-col gap-2 pt-2 sm:flex-row">
              <Button
                variant="secondary"
                size="sm"
                className="flex-1"
                icon={<KeyRound size={14} />}
                onClick={() => {
                  setError(null);
                  setPassword('');
                  setConfirmPassword('');
                  setCurrentPassword('');
                  setMode('change');
                }}
              >
                Modifier mes identifiants
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/40"
                icon={<Unlock size={14} />}
                onClick={() => {
                  setError(null);
                  setCurrentPassword('');
                  setMode('disable');
                }}
              >
                Désactiver le chiffrement
              </Button>
            </div>
          </div>
        )}

        {/* ------------------------------ Activation ------------------------------ */}
        {mode === 'setup' && (
          <form onSubmit={handleSetup} className="space-y-4">
            <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-3.5 text-xs leading-relaxed text-indigo-900 dark:border-indigo-900/60 dark:bg-indigo-950/30 dark:text-indigo-200">
              <p className="font-semibold">
                🔒 Coffre-fort Zéro-Connaissance (AES-GCM 256 bits)
              </p>
              <p className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-300">
                Protégez vos notes, tâches et clés API contre tout accès non autorisé. Une clé de secours vous sera également fournie.
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  Identifiant / Login (facultatif)
                </label>
                <div className="relative mt-1">
                  <input
                    type="text"
                    className="field h-9 w-full pl-8 text-sm"
                    placeholder="ex: admin ou prenom…"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                  <User size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  Mot de passe maître
                </label>
                <div className="relative mt-1">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className="field h-9 w-full pr-10 text-sm"
                    placeholder="Au moins 8 caractères…"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200"
                    onClick={() => setShowPassword((v) => !v)}
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>

                {/* Indicateur de robustesse */}
                {password.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                      <div
                        className={`h-full transition-all duration-300 ${
                          strength.score <= 1
                            ? 'w-1/4 bg-red-500'
                            : strength.score === 2
                              ? 'w-2/4 bg-amber-500'
                              : strength.score === 3
                                ? 'w-3/4 bg-indigo-500'
                                : 'w-full bg-emerald-500'
                        }`}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-zinc-500">
                      <span>Robustesse : {strength.feedback}</span>
                      <span className="text-[10px]">
                        {strength.hasMinLength ? '✓ 8+ car.' : '✗ 8+ car.'} ·{' '}
                        {strength.hasNumbers ? '✓ chiffres' : '✗ chiffres'} ·{' '}
                        {strength.hasSymbols ? '✓ symboles' : '✗ symboles'}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  Confirmer le mot de passe
                </label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="field mt-1 h-9 w-full text-sm"
                  placeholder="Répète ton mot de passe…"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  Verrouillage automatique
                </label>
                <Select
                  className="mt-1 w-full"
                  value={autoLockMinutes}
                  options={AUTO_LOCK_OPTIONS}
                  onChange={(e) => setAutoLockMinutes(e.target.value)}
                />
              </div>
            </div>

            {error && (
              <p className="flex items-center gap-1.5 text-xs font-medium text-red-500">
                <AlertTriangle size={13} className="shrink-0" />
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={onClose}>
                Annuler
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={loading || password.length < 8 || password !== confirmPassword}
                icon={<Lock size={13} />}
              >
                {loading ? 'Chiffrement en cours…' : 'Activer le chiffrement'}
              </Button>
            </div>
          </form>
        )}

        {/* ------------------------------ Clé de secours générée ------------------------------ */}
        {mode === 'recovery_success' && (
          <div className="space-y-4">
            <div className="rounded-xl border border-emerald-300 bg-emerald-50/60 p-4 text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">
              <div className="flex items-center gap-2 font-semibold">
                <Check size={18} className="text-emerald-600 dark:text-emerald-400" />
                <span>Coffre chiffré activé avec succès !</span>
              </div>
              <p className="mt-1.5 text-xs text-zinc-600 dark:text-zinc-300">
                Conservez précieusement votre <strong>clé de secours</strong> ci-dessous. Elle vous permettra de déverrouiller votre espace en cas d'oubli de mot de passe.
              </p>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-center dark:border-zinc-800 dark:bg-zinc-900">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 mb-1">
                Votre clé de récupération d'urgence
              </p>
              <div className="font-mono text-base font-bold tracking-widest text-indigo-600 dark:text-indigo-400 select-all">
                {generatedRecoveryKey}
              </div>
            </div>

            <div className="flex justify-between items-center pt-2">
              <Button
                size="sm"
                variant="secondary"
                icon={copiedKey ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                onClick={copyRecoveryKey}
              >
                {copiedKey ? 'Clé copiée !' : 'Copier la clé'}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={onClose}
              >
                Terminer
              </Button>
            </div>
          </div>
        )}

        {/* ------------------------------ Modification ------------------------------ */}
        {mode === 'change' && (
          <form onSubmit={handleChange} className="space-y-3.5">
            <div>
              <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                Identifiant / Login (facultatif)
              </label>
              <input
                type="text"
                className="field mt-1 h-9 w-full text-sm"
                placeholder="Identifiant ou login…"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                Mot de passe maître actuel
              </label>
              <input
                type="password"
                className="field mt-1 h-9 w-full text-sm"
                placeholder="Mot de passe actuel…"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoFocus
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                Nouveau mot de passe maître
              </label>
              <input
                type="password"
                className="field mt-1 h-9 w-full text-sm"
                placeholder="Nouveau mot de passe (8+ car.)…"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                Confirmer le nouveau mot de passe
              </label>
              <input
                type="password"
                className="field mt-1 h-9 w-full text-sm"
                placeholder="Confirmer le nouveau mot de passe…"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>

            {error && (
              <p className="flex items-center gap-1.5 text-xs font-medium text-red-500">
                <AlertTriangle size={13} className="shrink-0" />
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => setMode('status')}>
                Retour
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={loading || !currentPassword || password.length < 8 || password !== confirmPassword}
                icon={<KeyRound size={13} />}
              >
                {loading ? 'Modification…' : 'Enregistrer'}
              </Button>
            </div>
          </form>
        )}

        {/* ------------------------------ Désactivation ------------------------------ */}
        {mode === 'disable' && (
          <form onSubmit={handleDisable} className="space-y-4">
            <div className="rounded-xl border border-red-200 bg-red-50/50 p-3 text-xs text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
              <p className="font-semibold">⚠️ Désactiver le chiffrement</p>
              <p className="mt-0.5 text-[11px] text-zinc-600 dark:text-zinc-300">
                Vos notes et tâches seront désormais stockées en clair dans le stockage local de ce navigateur.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                Confirme avec ton mot de passe maître actuel
              </label>
              <input
                type="password"
                className="field mt-1 h-9 w-full text-sm"
                placeholder="Mot de passe actuel…"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoFocus
              />
            </div>

            {error && (
              <p className="flex items-center gap-1.5 text-xs font-medium text-red-500">
                <AlertTriangle size={13} className="shrink-0" />
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => setMode('status')}>
                Annuler
              </Button>
              <Button
                type="submit"
                variant="danger"
                size="sm"
                disabled={loading || !currentPassword}
                icon={<Unlock size={13} />}
              >
                {loading ? 'Désactivation…' : 'Désactiver le chiffrement'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}
