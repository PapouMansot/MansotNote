// @ts-nocheck
// Outils MCP de MansotNote, partagés par le serveur MCP intégré (route /mcp).
// Ils ne font que relayer l'API REST avec le jeton de l'appelant : les droits réels (dossiers,
// tags interdits, écriture, suppression) sont appliqués par l'API. Le typage est volontairement
// désactivé : les réponses de l'API sont lues dynamiquement, et le comportement est couvert par
// scripts/test-multiuser.mjs. Même définition que le script MCP local (D:/Application/MCP/mansotnote).
import { z } from 'zod';

/** api(méthode, chemin, { body, timeoutMs }) : appelle l'API avec le jeton de l'appelant et renvoie le JSON. */
export function registerMansotTools(server, { api, readOnly = false, manageTokens = false }) {
  const reply = (value) => ({
    content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
  });
  const failure = (message) => ({ isError: true, content: [{ type: "text", text: message }] });

  /** Enveloppe un outil : toute erreur devient une reponse d'erreur lisible, jamais un plantage. */
  function run(fn) {
    return async (args) => {
      try {
        return reply(await fn(args ?? {}));
      } catch (error) {
        return failure(error instanceof Error ? error.message : String(error));
      }
    };
  }

  const iso = (ms) => (typeof ms === "number" || /^\d+$/.test(String(ms ?? "")) ? new Date(Number(ms)).toISOString() : null);
  const snippet = (text, length = 160) => String(text ?? "").replace(/\s+/g, " ").trim().slice(0, length);
  const enc = encodeURIComponent;

  function folderPaths(folders) {
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    return (id) => {
      const parts = [];
      const seen = new Set();
      let current = byId.get(id);
      while (current && !seen.has(current.id)) {
        seen.add(current.id);
        parts.unshift(current.name);
        current = current.parentId ? byId.get(current.parentId) : undefined;
      }
      return parts.length ? parts.join(" / ") : null;
    };
  }

  function presentNote(note) {
    return { ...note, createdAtIso: iso(note.createdAt), updatedAtIso: iso(note.updatedAt) };
  }


  const READ = { readOnlyHint: true, openWorldHint: false };
  const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
  const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };

  function tool(name, title, description, inputSchema, annotations, fn) {
    server.registerTool(name, { title, description, inputSchema, annotations }, run(fn));
  }

  const noteId = z.string().min(1).max(200).describe("Identifiant de la note (obtenu via mansotnote_search ou mansotnote_list_notes).");
  const folderId = z.string().min(1).max(200).describe("Identifiant du dossier (voir mansotnote_list_folders).");
  const commitMessage = z.string().max(200).optional().describe("Message de la version, comme un message de commit (ex. « Ajout du compte rendu du 2 octobre »). Recommandé : il apparaît dans l'historique.");

  // --- Lecture --------------------------------------------------------------

  tool(
    "mansotnote_search",
    "Rechercher dans les notes (sémantique + mots-clés)",
    "Recherche hybride (vecteurs + texte) dans le carnet MansotNote, limitée aux notes que ce jeton a le droit de voir. " +
      "À utiliser en premier pour retrouver une information : renvoie des extraits avec l'identifiant de note, à lire en entier avec mansotnote_get_note.",
    {
      query: z.string().min(1).max(4000).describe("Question ou mots-clés à rechercher."),
      limit: z.number().int().min(1).max(20).optional().describe("Nombre maximal d'extraits (défaut 6)."),
    },
    READ,
    async ({ query, limit }) => {
      const data = await api("POST", "/rag/search", { body: { query, limit: limit ?? 6 }, timeoutMs: 120_000 });
      const results = (data?.results ?? []).map((r) => ({
        noteId: r.note_id,
        titre: r.note_title,
        section: r.heading || undefined,
        extrait: String(r.content ?? "").slice(0, 1200),
        score: typeof r.score === "number" ? Number(r.score.toFixed(4)) : r.score,
      }));
      return results.length ? results : "Aucun résultat dans le périmètre de ce jeton.";
    },
  );

  tool(
    "mansotnote_list_notes",
    "Lister les notes (résumés)",
    "Liste les notes accessibles, les plus récentes d'abord, sans leur contenu complet (titre, dossier, tags, début du texte). " +
      "Utilisez mansotnote_get_note pour lire une note en entier.",
    {
      folderId: folderId.optional().describe("Ne garder que les notes de ce dossier."),
      tagId: z.string().min(1).max(200).optional().describe("Ne garder que les notes portant ce tag."),
      titleContains: z.string().max(200).optional().describe("Filtre sur le titre (insensible à la casse)."),
      includeArchived: z.boolean().optional().describe("Inclure les notes archivées (défaut non)."),
      limit: z.number().int().min(1).max(200).optional().describe("Nombre maximal de notes (défaut 50)."),
    },
    READ,
    async ({ folderId: folder, tagId, titleContains, includeArchived, limit }) => {
      const [notes, folders] = await Promise.all([api("GET", "/v1/notes"), api("GET", "/v1/folders")]);
      const pathOf = folderPaths(folders);
      const needle = titleContains?.toLowerCase();
      const kept = notes
        .filter((n) => includeArchived || !n.archived)
        .filter((n) => !folder || n.folderId === folder)
        .filter((n) => !tagId || (n.tagIds ?? []).includes(tagId))
        .filter((n) => !needle || String(n.title ?? "").toLowerCase().includes(needle));
      return {
        total: kept.length,
        notes: kept.slice(0, limit ?? 50).map((n) => ({
          id: n.id,
          titre: n.title,
          dossier: n.folderId ? pathOf(n.folderId) ?? n.folderId : null,
          folderId: n.folderId,
          tagIds: n.tagIds,
          epinglee: n.pinned || undefined,
          modifieeLe: iso(n.updatedAt),
          longueur: String(n.content ?? "").length,
          debut: snippet(n.content),
        })),
      };
    },
  );

  tool(
    "mansotnote_get_note",
    "Lire une note en entier",
    "Renvoie le contenu Markdown complet d'une note et ses métadonnées. Une note hors du périmètre du jeton répond « introuvable ».",
    { id: noteId },
    READ,
    async ({ id }) => presentNote(await api("GET", "/v1/notes/" + enc(id))),
  );

  tool(
    "mansotnote_list_folders",
    "Lister les dossiers",
    "Liste les dossiers accessibles à ce jeton, avec leur chemin complet. Sert à choisir où ranger une note.",
    {},
    READ,
    async () => {
      const folders = await api("GET", "/v1/folders");
      const pathOf = folderPaths(folders);
      return folders.map((f) => ({ id: f.id, chemin: pathOf(f.id), parentId: f.parentId }));
    },
  );

  tool(
    "mansotnote_list_tags",
    "Lister les tags",
    "Liste les tags disponibles (identifiant et nom). Les tags interdits à ce jeton n'apparaissent pas.",
    {},
    READ,
    async () => (await api("GET", "/v1/tags")).map((t) => ({ id: t.id, nom: t.name })),
  );

  // --- Ecriture ---------------------------------------------------------------

  // --- Historique (versions à la Git) -----------------------------------------

  tool(
    "mansotnote_note_history",
    "Historique d'une note (journal des versions)",
    "Liste les versions d'une note, comme git log : numéro, auteur (navigateur ou bot), date, message, lignes ajoutées et supprimées. " +
      "Les plus récentes d'abord. Limité aux notes que ce jeton peut lire.",
    {
      id: noteId,
      limit: z.number().int().min(1).max(100).optional().describe("Nombre de versions (défaut 50)."),
    },
    READ,
    async ({ id, limit }) => {
      const data = await api("GET", "/v1/notes/" + enc(id) + "/versions" + (limit ? "?limit=" + limit : ""));
      return {
        noteId: data.noteId,
        versions: data.versions.map((v) => ({
          version: v.seq,
          auteur: v.actor,
          date: v.createdAt,
          message: v.message ?? undefined,
          titre: v.title,
          lignesAjoutees: v.added,
          lignesSupprimees: v.removed,
          supprimee: v.deleted || undefined,
        })),
      };
    },
  );

  tool(
    "mansotnote_note_diff",
    "Comparer deux versions d'une note (diff)",
    "Renvoie la différence entre deux versions, au format diff unifié (comme git diff). Sans from ni to : la dernière version contre la précédente. " +
      "from=0 compare une version au vide, c'est-à-dire ce que la création a ajouté.",
    {
      id: noteId,
      from: z.number().int().min(0).optional().describe("Version de départ (défaut : la précédente de « to »)."),
      to: z.number().int().min(1).optional().describe("Version d'arrivée (défaut : la plus récente)."),
    },
    READ,
    async ({ id, from, to }) => {
      const query = [from !== undefined ? "from=" + from : null, to !== undefined ? "to=" + to : null].filter(Boolean).join("&");
      const data = await api("GET", "/v1/notes/" + enc(id) + "/diff" + (query ? "?" + query : ""));
      return {
        de: data.from ? { version: data.from.seq, auteur: data.from.actor, date: data.from.createdAt } : "création",
        vers: { version: data.to.seq, auteur: data.to.actor, date: data.to.createdAt, message: data.to.message ?? undefined },
        titre: data.titleChange ?? undefined,
        lignesAjoutees: data.added,
        lignesSupprimees: data.removed,
        diff: data.unified,
      };
    },
  );

  tool(
    "mansotnote_get_version",
    "Lire une ancienne version d'une note",
    "Renvoie le titre et le contenu complet d'une version donnée (numéro obtenu avec mansotnote_note_history).",
    { id: noteId, version: z.number().int().min(1).describe("Numéro de la version.") },
    READ,
    async ({ id, version }) => {
      const v = await api("GET", "/v1/notes/" + enc(id) + "/versions/" + version);
      return { version: v.seq, auteur: v.actor, date: v.createdAt, message: v.message ?? undefined, titre: v.title, contenu: v.content };
    },
  );

  if (!readOnly) {
    tool(
      "mansotnote_create_note",
      "Créer une note",
      "Crée une note Markdown. Sans dossier, elle est rangée dans le dossier par défaut du jeton ; le tag de traçabilité du bot est ajouté automatiquement s'il est configuré. " +
        "Écrire un titre explicite et un contenu autonome (le contexte de la conversation n'est pas conservé).",
      {
        title: z.string().min(1).max(500).describe("Titre de la note."),
        content: z.string().max(2_000_000).describe("Contenu en Markdown."),
        folderId: folderId.optional(),
        tagIds: z.array(z.string().min(1).max(200)).max(50).optional().describe("Identifiants de tags (voir mansotnote_list_tags)."),
        message: commitMessage,
      },
      WRITE,
      async ({ title, content, folderId: folder, tagIds, message }) =>
        presentNote(await api("POST", "/v1/notes", { body: { title, content, folderId: folder, tagIds, message } })),
    );

    tool(
      "mansotnote_append_note",
      "Ajouter du texte à une note",
      "Ajoute du Markdown à la fin d'une note existante sans toucher au reste. À préférer à mansotnote_update_note pour enrichir une note.",
      { id: noteId, content: z.string().min(1).max(2_000_000).describe("Texte à ajouter à la fin de la note."), message: commitMessage },
      WRITE,
      async ({ id, content, message }) => presentNote(await api("PATCH", "/v1/notes/" + enc(id), { body: { appendContent: content, message } })),
    );

    tool(
      "mansotnote_update_note",
      "Modifier une note (remplace)",
      "Modifie le titre, le contenu, le dossier, les tags, l'épinglage ou l'archivage d'une note. Un contenu fourni REMPLACE l'ancien : relire la note avant, ou utiliser mansotnote_append_note.",
      {
        id: noteId,
        title: z.string().min(1).max(500).optional(),
        content: z.string().max(2_000_000).optional().describe("Nouveau contenu complet (remplace l'existant)."),
        folderId: folderId.nullable().optional().describe("Nouveau dossier (null = sans dossier, si le jeton l'autorise)."),
        tagIds: z.array(z.string().min(1).max(200)).max(50).optional().describe("Liste complète des tags (remplace l'existante)."),
        pinned: z.boolean().optional(),
        archived: z.boolean().optional(),
        message: commitMessage,
      },
      DESTRUCTIVE,
      async ({ id, ...changes }) => presentNote(await api("PATCH", "/v1/notes/" + enc(id), { body: changes })),
    );

    tool(
      "mansotnote_delete_note",
      "Supprimer une note",
      "Supprime une note. Nécessite le droit de suppression sur le jeton, que les bots n'ont pas par défaut. L'état de la note reste récupérable par l'utilisateur depuis la corbeille de MansotNote.",
      { id: noteId, message: commitMessage },
      DESTRUCTIVE,
      async ({ id, message }) => {
        await api("DELETE", "/v1/notes/" + enc(id) + (message ? "?message=" + enc(message) : ""));
        return "Note supprimée.";
      },
    );

    tool(
      "mansotnote_create_folder",
      "Créer un dossier",
      "Crée un dossier. Un jeton limité à des dossiers ne peut en créer que dans son périmètre ; sans parent, le dossier est créé dans son dossier par défaut.",
      {
        name: z.string().min(1).max(120).describe("Nom du dossier."),
        parentId: folderId.nullable().optional().describe("Dossier parent (null = à la racine, si le jeton l'autorise)."),
      },
      WRITE,
      async ({ name, parentId }) => api("POST", "/v1/folders", { body: { name, parentId } }),
    );

    tool(
      "mansotnote_create_tag",
      "Créer un tag",
      "Crée un tag (commun à tout le carnet), par ex. pour tracer les notes d'un nouveau bot. Si un tag de ce nom existe déjà (casse ignorée), il est renvoyé " +
        "au lieu d'être dupliqué. Le tag renvoyé peut ensuite servir de tag automatique ou être ajouté à des notes.",
      {
        name: z.string().min(1).max(60).describe("Nom du tag, sans le #."),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().describe("Couleur hexadécimale, ex. #3b82f6 (défaut : gris)."),
      },
      WRITE,
      async ({ name, color }) => {
        const tag = await api("POST", "/v1/tags", { body: { name, color } });
        return { id: tag.id, nom: tag.name, couleur: tag.color };
      },
    );

    tool(
      "mansotnote_update_folder",
      "Renommer / déplacer un dossier",
      "Modifie le nom d'un dossier et/ou le déplace sous un autre dossier. Un jeton limité à des dossiers ne peut agir que sur les dossiers de son " +
        "périmètre, ni créer de cycle (déplacer un dossier sous son propre descendant est refusé).",
      {
        id: folderId.describe("Identifiant du dossier à modifier."),
        name: z.string().min(1).max(120).optional().describe("Nouveau nom (omis = inchangé)."),
        parentId: folderId.nullable().optional().describe("Nouveau dossier parent (null = à la racine, si le jeton l'autorise ; omis = inchangé)."),
      },
      WRITE,
      async ({ id, name, parentId }) => {
        const body = {};
        if (name !== undefined) body.name = name;
        if (parentId !== undefined) body.parentId = parentId;
        const folder = await api("PATCH", "/v1/folders/" + enc(id), { body });
        return { id: folder.id, nom: folder.name, parentId: folder.parentId };
      },
    );

    tool(
      "mansotnote_delete_folder",
      "Supprimer un dossier vide",
      "Supprime un dossier, uniquement s'il est vide (aucune note, même archivée, aucun sous-dossier) : sinon l'API répond 409 et rien n'est supprimé. " +
        "Nécessite le droit de suppression. Un jeton limité à des dossiers ne peut supprimer que ceux de son périmètre, jamais la racine de ce périmètre.",
      { id: folderId.describe("Identifiant du dossier à supprimer (voir mansotnote_list_folders).") },
      DESTRUCTIVE,
      async ({ id }) => {
        await api("DELETE", "/v1/folders/" + enc(id));
        return "Dossier supprimé.";
      },
    );

    tool(
      "mansotnote_delete_tag",
      "Supprimer un tag",
      "Supprime un tag et le retire de toutes les notes qui le portent (chaque note garde une version dans son historique). Nécessite le droit de suppression. " +
        "Refusé pour un tag interdit à ce jeton, pour un tag que l'interface utilise comme protection (tag interdit d'un autre jeton), " +
        "et, pour un jeton limité à des dossiers, pour un tag utilisé par des notes hors de son périmètre.",
      {
        id: z.string().min(1).max(200).describe("Identifiant du tag (voir mansotnote_list_tags)."),
        message: commitMessage,
      },
      DESTRUCTIVE,
      async ({ id, message }) => {
        await api("DELETE", "/v1/tags/" + enc(id) + (message ? "?message=" + enc(message) : ""));
        return "Tag supprimé et retiré des notes.";
      },
    );

    tool(
      "mansotnote_update_tag",
      "Renommer / recolorer un tag",
      "Modifie le nom et/ou la couleur d'un tag. Si un autre tag porte déjà le nom cible (casse ignorée), le conflit est renvoyé. " +
        "Un tag interdit à ce jeton est inaccessible.",
      {
        id: z.string().min(1).max(200).describe("Identifiant du tag (voir mansotnote_list_tags)."),
        name: z.string().min(1).max(60).optional().describe("Nouveau nom (omis = inchangé)."),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().describe("Nouvelle couleur hexadécimale (omis = inchangée)."),
      },
      WRITE,
      async ({ id, name, color }) => {
        const body = {};
        if (name !== undefined) body.name = name;
        if (color !== undefined) body.color = color;
        const tag = await api("PATCH", "/v1/tags/" + enc(id), { body });
        return { id: tag.id, nom: tag.name, couleur: tag.color };
      },
    );

    tool(
      "mansotnote_restore_version",
      "Restaurer une ancienne version d'une note",
      "Remet le titre et le contenu d'une ancienne version (voir mansotnote_note_history). La restauration crée elle-même une version : " +
        "elle peut être annulée en restaurant la version précédente. Dossier et tags de la note ne changent pas.",
      {
        id: noteId,
        version: z.number().int().min(1).describe("Numéro de la version à restaurer."),
        message: commitMessage,
      },
      WRITE,
      async ({ id, version, message }) => presentNote(await api("POST", "/v1/notes/" + enc(id) + "/restore", { body: { seq: version, message } })),
    );
  }

  // --- Gestion des jetons (jeton gestionnaire uniquement) -----------------------

  if (manageTokens) {
    const presentToken = (t) => ({
      id: t.id,
      nom: t.name,
      droits: t.permissions,
      dossiers: t.allowedFolderIds,
      tagsInterdits: t.deniedTagIds,
      tagAutomatique: t.autoTagId ?? undefined,
      adressesIp: t.allowedIps ?? [],
      creePar: t.createdByName ?? undefined,
      derniereUtilisation: t.last_used_at ?? undefined,
    });
    const tokenFields = {
      canWrite: z.boolean().optional().describe("Droit d'écriture (défaut oui à la création)."),
      canDelete: z.boolean().optional().describe("Droit de suppression de notes (défaut non) ; impossible si ce jeton gestionnaire ne l'a pas."),
      folderIds: z.array(folderId).max(100).optional().describe("Dossiers accessibles (sous-dossiers inclus). Obligatoire si ce jeton gestionnaire est limité à des dossiers, et dans son périmètre."),
      deniedTagIds: z.array(z.string().min(1).max(200)).max(100).optional().describe("Tags à interdire en plus. Ceux déjà interdits à ce jeton gestionnaire sont repris automatiquement (même invisibles pour lui)."),
      autoTagId: z.string().min(1).max(200).nullable().optional().describe("Tag ajouté automatiquement aux notes créées avec ce jeton."),
      allowedIps: z.array(z.string().min(1).max(64)).max(20).optional().describe("Adresses IP publiques (ou plages, /16 minimum) autorisées à utiliser ce jeton via le site public, en plus du réseau privé / VPN. Doivent tenir dans celles de ce jeton gestionnaire ; liste vide = réseau privé / VPN seulement."),
    };
    const tokenBody = ({ canWrite, canDelete, folderIds, deniedTagIds, autoTagId, allowedIps, name }) => ({
      name,
      permissions: { ...(canWrite !== undefined ? { write: canWrite } : {}), ...(canDelete !== undefined ? { delete: canDelete } : {}) },
      allowedFolderIds: folderIds,
      deniedTagIds,
      autoTagId,
      allowedIps,
    });

    tool(
      "mansotnote_list_tokens",
      "Lister les jetons que j'ai créés",
      "Liste les jetons créés par ce jeton gestionnaire (jamais les autres). Les jetons eux-mêmes ne sont jamais renvoyés.",
      {},
      READ,
      async () => (await api("GET", "/tokens")).tokens.map(presentToken),
    );

    if (!readOnly) {
    tool(
      "mansotnote_create_token",
      "Créer un jeton pour un autre bot",
      "Crée un jeton enfant avec des droits égaux ou inférieurs aux siens. Le jeton en clair n'est affiché QU'UNE FOIS dans cette réponse : " +
        "le transmettre directement au bot concerné (variable MANSOTNOTE_TOKEN), sans le recopier ailleurs ni dans une note.",
      { name: z.string().min(1).max(80).describe("Nom du bot (ex. « Mia - micro-entreprise »)."), ...tokenFields },
      WRITE,
      async (args) => {
        const data = await api("POST", "/tokens", { body: tokenBody(args) });
        return { ...presentToken(data.record), jeton: data.token, avertissement: "Jeton affiché une seule fois : à transmettre au bot, puis ne plus le réafficher." };
      },
    );

    tool(
      "mansotnote_update_token",
      "Modifier un jeton que j'ai créé",
      "Change les droits, dossiers ou tags d'un jeton enfant, dans les limites de ce jeton gestionnaire. Les champs fournis remplacent les anciens.",
      { id: z.string().uuid().describe("Identifiant du jeton (mansotnote_list_tokens)."), name: z.string().min(1).max(80).optional(), ...tokenFields },
      DESTRUCTIVE,
      async ({ id, ...rest }) => presentToken((await api("PATCH", "/tokens/" + enc(id), { body: tokenBody(rest) })).record),
    );

    tool(
      "mansotnote_revoke_token",
      "Révoquer un jeton que j'ai créé",
      "Révoque immédiatement un jeton enfant : le bot qui l'utilise perd tout accès.",
      { id: z.string().uuid().describe("Identifiant du jeton (mansotnote_list_tokens).") },
      DESTRUCTIVE,
      async ({ id }) => {
        await api("DELETE", "/tokens/" + enc(id));
        return "Jeton révoqué.";
      },
    );
    }
  }
}
