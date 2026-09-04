/**
 * Point d'entrée — montage React + bootstrap du store.
 *
 * L'anti-flash de thème est déjà fait par le script inline d'index.html ;
 * le bootstrap (load/seed) est déclenché ici, avant le premier rendu
 * utile, et l'état hydraté pilote l'affichage via le store.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import '@/index.css';

const rootElement = document.getElementById('root');
if (rootElement === null) {
  throw new Error('Conteneur #root introuvable');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
