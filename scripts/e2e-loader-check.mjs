/**
 * Test bout-en-bout du favori « chargeur ».
 *
 * Reproduit le clic réel : depuis un site tiers, le favori injecte
 * `/bookmarklet.js` servi par MansotNote, puis le plugin doit démarrer et
 * récupérer le Kanban via la fenêtre relais.
 *
 * Usage : node e2e-loader-check.mjs <baseUrl> <utilisateur> <motDePasse>
 */
import { chromium } from 'playwright-core';

const [baseUrl, username, password] = process.argv.slice(2);
if (!baseUrl || !username || !password) {
  console.error('usage: node e2e-loader-check.mjs <baseUrl> <user> <password>');
  process.exit(2);
}

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await context.newPage();

// 1. Connexion, comme l'utilisateur.
await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
await page.fill('input[autocomplete="username"]', username);
await page.fill('input[autocomplete="current-password"]', password);
await page.click('button[type="submit"]');
await page.waitForTimeout(4000);
const loggedIn = await page.evaluate(() => !document.querySelector('input[type="password"]'));
console.log(`connexion              : ${loggedIn ? 'OK' : 'ECHEC'}`);
if (!loggedIn) { await browser.close(); process.exit(1); }

// 2. Site tiers, puis exécution du favori chargeur.
const third = await context.newPage();
const errors = [];
third.on('pageerror', (e) => errors.push(e.message));
third.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await third.goto('https://example.com', { waitUntil: 'domcontentloaded' });

const injected = await third.evaluate(async (app) => {
  return await new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = app.replace(/\/$/, '') + '/bookmarklet.js?v=' + Date.now();
    s.onload = () => resolve({ loaded: true });
    s.onerror = () => resolve({ loaded: false });
    document.body.appendChild(s);
  });
}, baseUrl);
console.log(`script distant chargé  : ${injected.loaded ? 'OUI' : 'NON'}`);

// 3. L'interface du plugin doit apparaître dans la page tierce.
await third.waitForTimeout(3000);
const hostPresent = await third.evaluate(() => Boolean(document.getElementById('_mansot_host')));
console.log(`interface du plugin    : ${hostPresent ? 'AFFICHEE' : 'ABSENTE'}`);

// 4. Ouvrir l'onglet Kanban, comme l'utilisateur, puis lancer « Actualiser ».
await third.evaluate(() => {
  const host = document.getElementById('_mansot_host');
  host?.shadowRoot?.getElementById('_t_kanban')?.click();
});
await third.waitForTimeout(500);
const refreshed = await third.evaluate(() => {
  const root = document.getElementById('_mansot_host')?.shadowRoot;
  if (!root) return false;
  const btn = [...root.querySelectorAll('button')].find((b) => /actualis/i.test(b.textContent || ''));
  if (!btn) return false;
  btn.click();
  return true;
});
console.log(`bouton Actualiser      : ${refreshed ? 'CLIQUE' : 'INTROUVABLE'}`);

let cards = 0;
for (let i = 0; i < 12; i++) {
  cards = await third.evaluate(() => {
    const host = document.getElementById('_mansot_host');
    if (!host || !host.shadowRoot) return -1;
    return host.shadowRoot.querySelectorAll('.mn-kanban-item').length;
  });
  if (cards > 0) break;
  await third.waitForTimeout(1000);
}
console.log(`cartes Kanban rendues  : ${cards}`);

if (errors.length) console.log('erreurs page tierce    :\n  ' + errors.slice(0, 5).join('\n  '));

await browser.close();
process.exit(injected.loaded && hostPresent ? 0 : 1);
