/**
 * Module Cryptographique WebCrypto & Sécurité Avancée
 * ---------------------------------------------------
 * Fournit un chiffrement robuste de bout en bout (AES-GCM 256 bits + PBKDF2).
 *  - PBKDF2-HMAC-SHA-256 avec 100 000 itérations pour la dérivation de clé.
 *  - AES-GCM 256 bits avec IV de 96 bits (12 octets) unique par chiffrement.
 *  - Hash SHA-256 avec sel pour la vérification rapide du mot de passe.
 *  - Comparaison en temps constant (Anti-Timing Attacks).
 *  - Génération de clé de secours cryptographique (Recovery Key).
 */

const PBKDF2_ITERATIONS = 100_000;
const KEY_LENGTH_BITS = 256;
const SALT_BYTE_LENGTH = 16;
const IV_BYTE_LENGTH = 12;

/**
 * WebCrypto `subtle` n'est exposé que dans un contexte sécurisé (HTTPS ou
 * localhost). Sur une IP LAN en HTTP, `window.crypto` peut exister sans
 * `subtle`, ce qui produisait l'obscur « reading digest of undefined ».
 */
function requireSubtleCrypto(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error(
      'Le coffre chiffré nécessite HTTPS. Ouvre MansotNote avec son adresse HTTPS (ou via localhost), pas avec une adresse IP en HTTP.',
    );
  }
  return subtle;
}

function requireCrypto(): Crypto {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi) {
    throw new Error('WebCrypto est indisponible dans ce navigateur. Utilise une version récente via HTTPS.');
  }
  return cryptoApi;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export function generateRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  requireCrypto().getRandomValues(bytes);
  return bytes;
}

export function generateSalt(): string {
  return arrayBufferToBase64(generateRandomBytes(SALT_BYTE_LENGTH).buffer);
}

/** Génère une clé de secours formatée (ex: MN-8F2A-99B1-C4E2-77D0-3B1F) */
export function generateRecoveryKey(): string {
  const bytes = generateRandomBytes(12);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join('');
  const chunks = hex.match(/.{1,4}/g) ?? [hex];
  return `MN-${chunks.join('-')}`;
}

/** Comparaison en temps constant de deux chaînes pour parer aux attaques temporelles (Timing Attacks) */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Évite le court-circuit immédiat
    let mismatch = 1;
    for (let i = 0; i < a.length; i++) {
      mismatch |= a.charCodeAt(i) ^ (b.charCodeAt(i % b.length) || 0);
    }
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/** Dérive une clé cryptographique AES-GCM à partir d'un mot de passe et d'un sel */
export async function deriveKeyFromPassword(
  password: string,
  saltBase64: string,
  username?: string,
): Promise<CryptoKey> {
  const enc = new TextEncoder();
  // Inclut l'identifiant dans le secret si fourni pour renforcer la résistance au dictionnaire
  const keyMaterial = username ? `${username.trim().toLowerCase()}::${password}` : password;
  const passwordKey = await requireSubtleCrypto().importKey(
    'raw',
    enc.encode(keyMaterial),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );

  const salt = base64ToArrayBuffer(saltBase64);

  return requireSubtleCrypto().deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    passwordKey,
    { name: 'AES-GCM', length: KEY_LENGTH_BITS },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Calcule l'empreinte de vérification (hash) du mot de passe maître */
export async function computePasswordHash(
  password: string,
  saltBase64: string,
  username?: string,
): Promise<string> {
  const enc = new TextEncoder();
  const salt = base64ToArrayBuffer(saltBase64);
  const secret = username ? `${username.trim().toLowerCase()}::${password}` : password;
  const passBytes = enc.encode(secret);

  const combined = new Uint8Array(salt.byteLength + passBytes.length);
  combined.set(new Uint8Array(salt), 0);
  combined.set(passBytes, salt.byteLength);

  const hashBuffer = await requireSubtleCrypto().digest('SHA-256', combined);
  return arrayBufferToBase64(hashBuffer);
}

export interface EncryptedPayload {
  version: 1;
  iv: string; // Base64
  ciphertext: string; // Base64
}

/** Chiffre une chaîne de caractères en AES-GCM 256 bits */
export async function encryptText(
  plainText: string,
  key: CryptoKey,
): Promise<EncryptedPayload> {
  const iv = generateRandomBytes(IV_BYTE_LENGTH);
  const enc = new TextEncoder();
  const data = enc.encode(plainText);

  const encryptedBuffer = await requireSubtleCrypto().encrypt(
    {
      name: 'AES-GCM',
      iv,
    },
    key,
    data,
  );

  return {
    version: 1,
    iv: arrayBufferToBase64(iv.buffer),
    ciphertext: arrayBufferToBase64(encryptedBuffer),
  };
}

/** Déchiffre un payload chiffré en AES-GCM 256 bits */
export async function decryptText(
  payload: EncryptedPayload,
  key: CryptoKey,
): Promise<string> {
  const iv = base64ToArrayBuffer(payload.iv);
  const ciphertext = base64ToArrayBuffer(payload.ciphertext);

  const decryptedBuffer = await requireSubtleCrypto().decrypt(
    {
      name: 'AES-GCM',
      iv: new Uint8Array(iv),
    },
    key,
    ciphertext,
  );

  const dec = new TextDecoder();
  return dec.decode(decryptedBuffer);
}

/** Calcule un score de robustesse de mot de passe (0-4) et des retours utiles */
export function evaluatePasswordStrength(password: string): {
  score: number; // 0 à 4
  feedback: string;
  hasMinLength: boolean;
  hasNumbers: boolean;
  hasSymbols: boolean;
  hasUppercase: boolean;
  hasLowercase: boolean;
} {
  const hasMinLength = password.length >= 8;
  const hasNumbers = /\d/.test(password);
  const hasSymbols = /[^A-Za-z0-9]/.test(password);
  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);

  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (hasUppercase && hasLowercase) score++;
  if (hasNumbers && hasSymbols) score++;

  let feedback = 'Trop court';
  if (score === 1) feedback = 'Faible';
  else if (score === 2) feedback = 'Moyen';
  else if (score === 3) feedback = 'Robuste';
  else if (score === 4) feedback = 'Très robuste 🔒';

  return {
    score,
    feedback,
    hasMinLength,
    hasNumbers,
    hasSymbols,
    hasUppercase,
    hasLowercase,
  };
}
