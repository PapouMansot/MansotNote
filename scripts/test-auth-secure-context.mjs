/** Vérifie que l'auth explique HTTPS au lieu de planter sur crypto.subtle.digest. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { transformSync } from 'esbuild';

mkdirSync('.tmp-test', { recursive: true });
const source = readFileSync('src/lib/crypto.ts', 'utf8');
const js = transformSync(source, { loader: 'ts', format: 'esm', target: 'es2022' }).code;
writeFileSync('.tmp-test/crypto.mjs', js);
const cryptoModule = await import('../.tmp-test/crypto.mjs');

let fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' -> ' + detail : ''}`);
  if (!ok) fail++;
};

const originalCrypto = globalThis.crypto;
try {
  // Reproduit Chrome sur une IP HTTP : crypto/getRandomValues peut être exposé,
  // mais l'API sensible subtle ne l'est pas.
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: { getRandomValues: (bytes) => bytes },
  });
  let message = '';
  try {
    await cryptoModule.computePasswordHash('secret', btoa('0123456789abcdef'));
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  check('pas de TypeError digest', !message.includes("reading 'digest'"), message);
  check('message HTTPS explicite', message.includes('HTTPS'), message);
} finally {
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: originalCrypto });
}

check('aucun accès direct window.crypto.subtle', !source.includes('window.crypto.subtle'));
check('garde subtle centralisée', source.includes('function requireSubtleCrypto'));

console.log(fail === 0 ? '\n✅ Authentification HTTP diagnostiquée proprement.' : `\n❌ ${fail} échec(s).`);
process.exit(fail === 0 ? 0 : 1);
