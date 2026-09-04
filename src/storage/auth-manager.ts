/**
 * AuthManager — Gestionnaire d'authentification robuste & Coffre-fort
 * -------------------------------------------------------------------
 *  - Vérifie login + mot de passe maître via hash salé PBKDF2 / SHA-256.
 *  - Protection anti-brute-force : temporisation progressive et verrouillage après échecs.
 *  - Clé de secours d'urgence (Emergency Recovery Key).
 *  - Conserve la CryptoKey AES-GCM uniquement en mémoire de session.
 *  - Chiffre et déchiffre automatiquement le coffre dans localStorage.
 *  - Verrouillage automatique configurable sur inactivité.
 */
import { STORAGE_KEYS } from '@/constants';
import {
  computePasswordHash,
  decryptText,
  deriveKeyFromPassword,
  encryptText,
  generateRecoveryKey,
  generateSalt,
  timingSafeEqual,
  type EncryptedPayload,
} from '@/lib/crypto';
import type { PersistedState } from '@/types';

export interface AuthConfig {
  enabled: boolean;
  username?: string;
  salt: string;
  passwordHash: string;
  recoveryKeyHash?: string;
  recoverySalt?: string;
  autoLockMinutes: number; // 0 = jamais
}

interface SecurityThrottle {
  failedAttempts: number;
  lockedUntil: number; // timestamp
}

const THROTTLE_KEY = 'mansotnote.auth_throttle';

let activeSessionKey: CryptoKey | null = null;
let lockListeners: Array<(locked: boolean) => void> = [];
let inactivityTimer: number | null = null;

/* --------------------------- Gestion du Brute-Force ----------------------- */

export function getThrottleStatus(): {
  isLockedOut: boolean;
  remainingSeconds: number;
  failedAttempts: number;
} {
  try {
    const raw = window.localStorage.getItem(THROTTLE_KEY);
    if (!raw) return { isLockedOut: false, remainingSeconds: 0, failedAttempts: 0 };
    const parsed: SecurityThrottle = JSON.parse(raw);
    const now = Date.now();
    if (parsed.lockedUntil && parsed.lockedUntil > now) {
      const remainingSeconds = Math.ceil((parsed.lockedUntil - now) / 1000);
      return { isLockedOut: true, remainingSeconds, failedAttempts: parsed.failedAttempts };
    }
    return { isLockedOut: false, remainingSeconds: 0, failedAttempts: parsed.failedAttempts };
  } catch {
    return { isLockedOut: false, remainingSeconds: 0, failedAttempts: 0 };
  }
}

export function recordFailedAttempt(): { isLockedOut: boolean; remainingSeconds: number } {
  const current = getThrottleStatus();
  const nextAttempts = current.failedAttempts + 1;
  let lockDurationMs = 0;

  // Temporisation progressive
  if (nextAttempts >= 6) {
    lockDurationMs = 120_000; // 2 minutes
  } else if (nextAttempts >= 4) {
    lockDurationMs = 30_000; // 30 secondes
  } else if (nextAttempts >= 3) {
    lockDurationMs = 5_000; // 5 secondes
  }

  const payload: SecurityThrottle = {
    failedAttempts: nextAttempts,
    lockedUntil: lockDurationMs > 0 ? Date.now() + lockDurationMs : 0,
  };

  try {
    window.localStorage.setItem(THROTTLE_KEY, JSON.stringify(payload));
  } catch {}

  return {
    isLockedOut: lockDurationMs > 0,
    remainingSeconds: Math.ceil(lockDurationMs / 1000),
  };
}

export function resetFailedAttempts(): void {
  try {
    window.localStorage.removeItem(THROTTLE_KEY);
  } catch {}
}

/* --------------------------- Configuration Auth --------------------------- */

export function getAuthConfig(): AuthConfig | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.auth);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.salt === 'string' && typeof parsed.passwordHash === 'string') {
      return {
        enabled: Boolean(parsed.enabled),
        username: typeof parsed.username === 'string' ? parsed.username : undefined,
        salt: parsed.salt,
        passwordHash: parsed.passwordHash,
        recoveryKeyHash: typeof parsed.recoveryKeyHash === 'string' ? parsed.recoveryKeyHash : undefined,
        recoverySalt: typeof parsed.recoverySalt === 'string' ? parsed.recoverySalt : undefined,
        autoLockMinutes: typeof parsed.autoLockMinutes === 'number' ? parsed.autoLockMinutes : 15,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveAuthConfig(config: AuthConfig | null) {
  if (config === null) {
    window.localStorage.removeItem(STORAGE_KEYS.auth);
    window.localStorage.removeItem(STORAGE_KEYS.vault);
    resetFailedAttempts();
  } else {
    window.localStorage.setItem(STORAGE_KEYS.auth, JSON.stringify(config));
  }
}

export function isAuthEnabled(): boolean {
  const config = getAuthConfig();
  return Boolean(config && config.enabled);
}

export function isAppLocked(): boolean {
  const config = getAuthConfig();
  if (!config || !config.enabled) {
    return false;
  }
  return activeSessionKey === null;
}

export function getSessionKey(): CryptoKey | null {
  return activeSessionKey;
}

export function onLockStateChange(callback: (locked: boolean) => void): () => void {
  lockListeners.push(callback);
  return () => {
    lockListeners = lockListeners.filter((l) => l !== callback);
  };
}

function notifyLockState(locked: boolean) {
  lockListeners.forEach((fn) => fn(locked));
}

/** Verrouille l'application en purgeant la clé en mémoire */
export function lockApp() {
  activeSessionKey = null;
  if (inactivityTimer !== null) {
    window.clearTimeout(inactivityTimer);
    inactivityTimer = null;
  }
  notifyLockState(true);
}

/** Réinitialise le timer d'inactivité */
export function recordActivity() {
  if (!isAuthEnabled() || isAppLocked()) return;
  const config = getAuthConfig();
  if (!config || config.autoLockMinutes <= 0) return;

  if (inactivityTimer !== null) {
    window.clearTimeout(inactivityTimer);
  }

  inactivityTimer = window.setTimeout(() => {
    lockApp();
  }, config.autoLockMinutes * 60_000);
}

// Initialisation des écouteurs globaux d'activité
if (typeof window !== 'undefined') {
  const events = ['mousedown', 'keydown', 'touchstart', 'scroll'];
  events.forEach((ev) => {
    window.addEventListener(ev, () => recordActivity(), { passive: true });
  });
}

/** Déverrouille l'application avec l'identifiant et le mot de passe */
export async function unlockWithPassword(
  password: string,
  username?: string,
): Promise<{ success: boolean; error?: string }> {
  const config = getAuthConfig();
  if (!config || !config.enabled) {
    return { success: true };
  }

  // Vérification de la temporisation anti-brute-force
  const throttle = getThrottleStatus();
  if (throttle.isLockedOut) {
    return {
      success: false,
      error: `Trop de tentatives. Veuillez patienter ${throttle.remainingSeconds}s avant de réessayer.`,
    };
  }

  // Vérification du nom d'utilisateur si configuré
  if (config.username && username !== undefined) {
    if (config.username.trim().toLowerCase() !== username.trim().toLowerCase()) {
      recordFailedAttempt();
      return { success: false, error: 'Identifiant ou mot de passe incorrect.' };
    }
  }

  const hash = await computePasswordHash(password, config.salt, config.username);
  if (!timingSafeEqual(hash, config.passwordHash)) {
    const res = recordFailedAttempt();
    if (res.isLockedOut) {
      return {
        success: false,
        error: `Mot de passe incorrect. Temporisation de sécurité de ${res.remainingSeconds}s activée.`,
      };
    }
    return { success: false, error: 'Mot de passe incorrect.' };
  }

  // Dérivation de la clé de déchiffrement
  try {
    activeSessionKey = await deriveKeyFromPassword(password, config.salt, config.username);
    resetFailedAttempts();
    recordActivity();
    notifyLockState(false);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Erreur de dérivation cryptographique.',
    };
  }
}

/** Déverrouille avec la clé de récupération d'urgence */
export async function unlockWithRecoveryKey(
  recoveryKey: string,
): Promise<{ success: boolean; error?: string }> {
  const config = getAuthConfig();
  if (!config || !config.enabled || !config.recoveryKeyHash || !config.recoverySalt) {
    return { success: false, error: 'Aucune clé de secours configurée pour cet espace.' };
  }

  const cleanKey = recoveryKey.trim().toUpperCase();
  const hash = await computePasswordHash(cleanKey, config.recoverySalt);

  if (!timingSafeEqual(hash, config.recoveryKeyHash)) {
    recordFailedAttempt();
    return { success: false, error: 'Clé de secours invalide.' };
  }

  // La clé de secours dérive la même CryptoKey pour déverrouiller
  try {
    activeSessionKey = await deriveKeyFromPassword(cleanKey, config.recoverySalt);
    resetFailedAttempts();
    recordActivity();
    notifyLockState(false);
    return { success: true };
  } catch (err) {
    return { success: false, error: 'Erreur lors du déchiffrement via clé de secours.' };
  }
}

/** Active l'authentification et génère la clé de secours */
export async function setupAuth(
  password: string,
  currentState: PersistedState,
  options: {
    username?: string;
    autoLockMinutes?: number;
  } = {},
): Promise<{ recoveryKey: string }> {
  const salt = generateSalt();
  const username = options.username?.trim() || undefined;
  const autoLockMinutes = options.autoLockMinutes ?? 15;

  const passwordHash = await computePasswordHash(password, salt, username);
  const key = await deriveKeyFromPassword(password, salt, username);

  // Génération de la clé de secours
  const recoveryKey = generateRecoveryKey();
  const recoverySalt = generateSalt();
  const recoveryKeyHash = await computePasswordHash(recoveryKey, recoverySalt);

  const payload = await encryptText(JSON.stringify(currentState), key);
  window.localStorage.setItem(STORAGE_KEYS.vault, JSON.stringify(payload));
  // Supprime l'état en clair pour sécurité maximale
  window.localStorage.removeItem(STORAGE_KEYS.state);

  const config: AuthConfig = {
    enabled: true,
    username,
    salt,
    passwordHash,
    recoveryKeyHash,
    recoverySalt,
    autoLockMinutes,
  };

  saveAuthConfig(config);
  activeSessionKey = key;
  resetFailedAttempts();
  recordActivity();
  notifyLockState(false);

  return { recoveryKey };
}

/** Modifie le mot de passe maître */
export async function changePassword(
  oldPassword: string,
  newPassword: string,
  currentState: PersistedState,
  username?: string,
): Promise<boolean> {
  const result = await unlockWithPassword(oldPassword, username);
  if (!result.success) return false;

  const config = getAuthConfig();
  await setupAuth(newPassword, currentState, {
    username: username ?? config?.username,
    autoLockMinutes: config?.autoLockMinutes ?? 15,
  });
  return true;
}

/** Désactive l'authentification et rétablit le stockage en clair */
export async function disableAuth(
  password: string,
  currentState: PersistedState,
  username?: string,
): Promise<boolean> {
  const result = await unlockWithPassword(password, username);
  if (!result.success) return false;

  window.localStorage.setItem(STORAGE_KEYS.state, JSON.stringify(currentState));
  saveAuthConfig(null);
  activeSessionKey = null;
  resetFailedAttempts();
  notifyLockState(false);
  return true;
}

/** Sauvegarde chiffrée de l'état si l'authentification est active */
export async function saveEncryptedState(state: PersistedState): Promise<boolean> {
  if (!isAuthEnabled()) return false;
  if (!activeSessionKey) {
    throw new Error("L'application est verrouillée : impossible de sauvegarder.");
  }

  const payload = await encryptText(JSON.stringify(state), activeSessionKey);
  window.localStorage.setItem(STORAGE_KEYS.vault, JSON.stringify(payload));
  return true;
}

/** Charge et déchiffre l'état depuis le coffre chiffré */
export async function loadEncryptedState(): Promise<PersistedState | null> {
  if (!isAuthEnabled()) return null;
  if (!activeSessionKey) return null;

  const rawVault = window.localStorage.getItem(STORAGE_KEYS.vault);
  if (!rawVault) return null;

  try {
    const payload: EncryptedPayload = JSON.parse(rawVault);
    const jsonStr = await decryptText(payload, activeSessionKey);
    return JSON.parse(jsonStr);
  } catch (err) {
    console.error('[auth] Échec de déchiffrement du coffre', err);
    return null;
  }
}
