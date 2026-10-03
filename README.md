# MansotNote 📝✨

MansotNote est une application web moderne de prise de notes et de productivité personnelle, combinant un éditeur Markdown enrichi, un tableau Kanban structuré et un **Copilote IA (SIA)** directement connecté à votre espace de travail.

Conçu pour un usage auto-hébergé respectueux de la vie privée (Zero-Knowledge, modèle local Ollama ou API OpenAI-compatible).

---

## 🚀 Fonctionnalités clés

### ✍️ Édition Markdown & Organisation
- **Éditeur Markdown puissant** : modes écriture, aperçu et vue partagée (split) avec coloration syntaxique.
- **Organisation fluide** : hiérarchie de dossiers, tags personnalisés avec palette de couleurs, épinglage et archivage.
- **Sauvegarde automatique débouncée** : synchronisation immédiate et détection de modifications non enregistrées.
- **Raccourcis clavier productifs** (`Ctrl+N`, `Ctrl+S`, `Ctrl+1/2/3`, `Ctrl+Shift+C` pour corriger, etc.).

### 🤖 Copilote IA (SIA) & Conversations Persistantes
- **Assistant conversationnel dédié** connecté en direct à toutes vos notes, vos tâches Kanban et votre note active.
- **Gestion multi-conversations persistante** : historique de discussions stocké localement, volet latéral rétractable, titrage automatique des sujets et reprise instantanée du contexte.
- **Actions 1-clic intelligentes** :
  - Création de notes (`action:create_note`)
  - Ajout et enrichissement de notes existantes (`action:append_note`) sans écraser le contenu
  - Mise à jour et restructuration complète (`action:update_note`)
  - Découpage automatique d'objectifs en tâches Kanban avec checklists
- **Correction orthographique & stylistique ultra-rapide** : consigne anti-réflexion, bornage dynamique des tokens et bypass de l'indexation lourde pour un temps de réponse instantané.
- **RAG hybride (BM25 + Embeddings vectoriels)** : recherche contextuelle sémantique dans vos notes via `pgvector` ou modèle d'embedding local.

### 📋 Tableau Kanban Agile
- Colonnes configurables (`À faire`, `En cours`, `Terminé`).
- Cartes avec checklists interactives, priorités (`Faible`, `Moyenne`, `Haute`, `Urgente`), dates d'échéances et étiquettes.
- Liens directs entre cartes Kanban et notes associées.

### 🔒 Sécurité & Auto-Hébergement
- Plusieurs comptes personnels : notes, Kanban, réglages IA, historique et jetons API propres à chaque utilisateur.
- Gestion des comptes dans **Compte & Accès distant → Utilisateurs** (administrateurs uniquement) : création, choix du rôle, désactivation/réactivation et réinitialisation du mot de passe.
- Une désactivation conserve les données, déconnecte les sessions et bloque les jetons. Une réinitialisation du mot de passe déconnecte les sessions et conserve les jetons API.
- Les conversations SIA restent dans le navigateur, avec un historique distinct par compte. La reprise de l'ancien coffre et des conversations historiques est réservée au premier compte.
- Les images sont servies uniquement à leur propriétaire connecté. La migration `010_private_media.sql` rend privé le bucket Supabase `mansotnote-media` ; Nginx conserve la compatibilité des anciennes adresses d'images.
- Déploiement conteneurisé Docker Compose (Base de données PostgreSQL 16 + `pgvector`, API backend Node.js, Frontend statique Nginx).
- Sauvegarde automatisée de la base de données.
- Support du reverse proxy avec terminaison SSL Let's Encrypt.

---

## 🛠️ Stack Technique

- **Frontend** : React 18, TypeScript, Vite, Tailwind CSS, Lucide Icons, Zustand
- **Backend API** : Node.js, Express, PostgreSQL 16 (`pgvector`), Scrypt / WebCrypto
- **IA** : Ollama (Qwen 3.8 / 2.5, DeepSeek), OpenAI, LM Studio, Groq
- **Infra** : Docker Compose, Nginx, Alpine Linux

---

## 📦 Installation & Déploiement

### Prérequis
- Docker & Docker Compose
- Serveur d'inférence IA (ex. Ollama local ou clé API distante)

### Variables d'environnement (`.env`)
```bash
cp .env.example .env
```

Renseigner les variables nécessaires :
- `POSTGRES_PASSWORD` : mot de passe sécurisé pour la base de données
- `INITIAL_ADMIN_USERNAME` : identifiant administrateur initial
- `INITIAL_ADMIN_PASSWORD` : mot de passe initial

La migration `008_user_roles.sql` attribue une seule fois le rôle administrateur au plus ancien compte actif existant. Sur une installation neuve, le compte créé par les variables `INITIAL_ADMIN_*` est administrateur. Les mots de passe des nouveaux comptes doivent contenir au moins 12 caractères ; il n'y a pas d'inscription publique. Un administrateur ne peut pas désactiver son propre compte ni retirer son propre rôle. Les comptes ont des espaces indépendants ; le partage de notes entre comptes n'est pas inclus.

### Lancement via Docker Compose
```bash
docker compose up -d --build
```

L'application est disponible par défaut sur le port `8793` (HTTP).

---

## 💻 Développement local

```bash
# Installation des dépendances
pnpm install

# Démarrage du serveur de dev
pnpm dev

# Vérification des types et tests smoke
pnpm typecheck
pnpm smoke
pnpm test:multiuser

# Build de production
pnpm build
```

---

## 📄 Licence

Projet personnel sous licence MIT.

