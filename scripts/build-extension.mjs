/**
 * Script de packaging de l'extension MansotNote Web Clipper (Manifest V3).
 * Copie les fichiers dans `dist-extension/` prêt à être chargé en mode développeur.
 */
import { cpSync, mkdirSync, existsSync, rmSync } from 'node:fs';

const SRC = 'extension';
const DIST = 'dist-extension';

if (existsSync(DIST)) {
  rmSync(DIST, { recursive: true, force: true });
}
mkdirSync(DIST, { recursive: true });

cpSync(SRC, DIST, { recursive: true });
console.log('✅ Extension Web Clipper prête dans le dossier `dist-extension/` !');
console.log('👉 Pour l’installer dans Chrome/Brave/Edge : chrome://extensions → Activer Mode Développeur → Charger l\'extension non empaquetée → Choisir `dist-extension/`');
