/**
 * Test bout-en-bout du relais Kanban du bookmarklet.
 *
 * Reproduit fidèlement le scénario réel : une page tierce ouvre la fenêtre
 * `?action=api_relay` de MansotNote et attend la réponse `postMessage`.
 * Le serveur seul ne peut pas prouver ce comportement : la réponse circule
 * uniquement entre deux fenêtres du navigateur.
 *
 * Usage : node e2e-relay-check.mjs <baseUrl> <utilisateur> <motDePasse>
 */
import { chromium } from 'playwright-core';

const [baseUrl, username, password] = process.argv.slice(2);
if (!baseUrl || !username || !password) {
  console.error('usage: node e2e-relay-check.mjs <baseUrl> <user> <password>');
  process.exit(2);
}

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await context.newPage();

const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

// 1. Authentification native, comme un utilisateur.
await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
await page.fill('input[autocomplete="username"]', username);
await page.fill('input[autocomplete="current-password"]', password);
await page.click('button[type="submit"]');
await page.waitForTimeout(4000);
const loggedIn = await page.evaluate(() => !document.querySelector('input[type="password"]'));
console.log(`connexion            : ${loggedIn ? 'OK' : 'ECHEC'}`);
if (!loggedIn) { await browser.close(); process.exit(1); }

// 2. Page tierce : c'est depuis un autre site que le bookmarklet s'exécute.
const third = await context.newPage();
await third.goto('https://example.com', { waitUntil: 'domcontentloaded' });

// 3. Reproduction exacte de callRemote() du bookmarklet.
const result = await third.evaluate(async (app) => {
  const reqId = 'get_kanban_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  const request = { id: reqId, action: 'get_kanban', key: '', payload: {} };
  const appOrigin = new URL(app).origin;
  const relayUrl = app.replace(/\/$/, '') + '/?action=api_relay&req=' + encodeURIComponent(JSON.stringify(request));
  const popup = window.open(relayUrl, '_mn_api_relay_' + reqId, 'popup=yes,width=480,height=640');
  if (!popup) return { ok: false, reason: 'popup bloquee' };

  return await new Promise((resolve) => {
    const onMessage = (ev) => {
      if (ev.origin !== appOrigin) return;
      if (!ev.data || !ev.data.__mansot_remote_res || ev.data.id !== reqId) return;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      try { popup.close(); } catch {}
      resolve({ ok: true, success: ev.data.success, error: ev.data.error, cards: ev.data.data?.cards?.length ?? null, columns: ev.data.data?.columns?.length ?? null });
    };
    window.addEventListener('message', onMessage);
    const timer = setTimeout(() => {
      window.removeEventListener('message', onMessage);
      resolve({ ok: false, reason: 'aucune reponse avant 15s' });
    }, 15000);
  });
}, baseUrl);

console.log(`reponse recue        : ${result.ok ? 'OUI' : 'NON (' + result.reason + ')'}`);
if (result.ok) {
  console.log(`succes               : ${result.success}`);
  if (result.error) console.log(`erreur               : ${result.error}`);
  console.log(`cartes / colonnes    : ${result.cards} / ${result.columns}`);
}
if (consoleErrors.length) console.log('erreurs console      :\n  ' + consoleErrors.slice(0, 5).join('\n  '));

await browser.close();
process.exit(result.ok && result.success ? 0 : 1);
