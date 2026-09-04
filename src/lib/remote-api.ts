/**
 * Remote API Router & PostMessage Bridge pour MansotNote
 * --------------------------------------------------------
 * Permet aux extensions, bookmarklets et clients distants d'interagir
 * de façon sécurisée avec l'application MansotNote :
 *  - Relais / Proxy IA (avec injection du contexte Notes & Kanban si disponible)
 *  - Création de note et ajout de tâches Kanban
 *  - Recherche et consultation des todos / Kanban à distance
 */
import { useAppStore } from '@/store/app-store';
import { chatComplete, type ChatMessage } from '@/lib/ai';
import {
  getAuthConfig,
  isAppLocked,
  unlockWithRecoveryKey,
  unlockWithPassword,
} from '@/storage/auth-manager';
import { computePasswordHash, timingSafeEqual } from '@/lib/crypto';
import { retrieveContextHybrid } from '@/lib/retrieval';
import type { KanbanCard, Priority } from '@/types';

export interface RemoteApiRequest {
  id: string;
  action:
    | 'ping'
    | 'chat'
    | 'create_note'
    | 'update_note'
    | 'create_card'
    | 'delete_card'
    | 'archive_card'
    | 'move_card'
    | 'clear_kanban'
    | 'get_kanban'
    | 'get_notes';
  key?: string;
  payload?: {
    messages?: ChatMessage[];
    systemPrompt?: string;
    userPrompt?: string;
    noteId?: string;
    title?: string;
    content?: string;
    description?: string;
    columnId?: string;
    priority?: Priority;
    /** Id retourné par `create_card` — utilisé pour cibler une carte. */
    cardId?: string;
    /** Colonne de destination pour `move_card`. */
    toColumnId?: string;
  };
}

export interface RemoteApiResponse {
  id: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

/** Vérifie si la clé fournie correspond au mot de passe, à la clé de secours ou si l'auth est désactivée */
export async function verifyRemoteKey(key?: string): Promise<boolean> {
  const auth = getAuthConfig();
  if (!auth || !auth.enabled) return true;

  // Sans clé : on autorise uniquement si le coffre est déjà déverrouillé dans cet
  // onglet. `hydrated` ne reflète PAS le verrouillage (le store peut être hydraté
  // et verrouillé), d'où l'usage de l'état d'authentification réel.
  if (!key || key.trim() === '') {
    return !isAppLocked();
  }

  const trimmedKey = key.trim();

  // Clé de secours formatée (MN-XXXX...)
  if (auth.recoverySalt && (trimmedKey.startsWith('MN-') || trimmedKey.toUpperCase().startsWith('MN-'))) {
    const res = await unlockWithRecoveryKey(trimmedKey);
    if (res.success) return true;
  }

  // Mot de passe maître
  try {
    const hashWithUser = await computePasswordHash(trimmedKey, auth.salt, auth.username);
    if (timingSafeEqual(hashWithUser, auth.passwordHash)) {
      await unlockWithPassword(trimmedKey, auth.username);
      return true;
    }

    const hashWithoutUser = await computePasswordHash(trimmedKey, auth.salt);
    if (timingSafeEqual(hashWithoutUser, auth.passwordHash)) {
      await unlockWithPassword(trimmedKey);
      return true;
    }
  } catch {}

  // NOTE SÉCURITÉ : aucune comparaison avec un préfixe de `auth.passwordHash` ici.
  // Accepter un préfixe du hash stocké permettrait à quiconque lit le hash
  // (localStorage, sauvegarde, export) d'obtenir un accès complet à l'API.
  return false;
}

/**
 * Résout un identifiant de colonne fourni par un client distant.
 * Les clients envoient des alias logiques ('todo', 'in_progress'…) alors que le
 * board utilise de vrais ids ('col-todo', 'col-doing'…). Sans cette résolution,
 * la carte est créée sur une colonne inexistante et devient invisible.
 */
export function resolveColumnId(requested?: string): string {
  const columns = useAppStore.getState().data.columns;
  if (columns.length === 0) return 'col-todo';

  // 1. Id réel déjà valide
  if (requested && columns.some((c) => c.id === requested)) return requested;

  // 2. Alias logiques → titre de colonne
  const aliases: Record<string, RegExp> = {
    todo: /à\s*faire|todo/i,
    in_progress: /en\s*cours|progress|doing/i,
    done: /termin|done|fini/i,
    backlog: /backlog|id[ée]e/i,
  };
  const pattern = requested ? aliases[requested.toLowerCase()] : undefined;
  if (pattern) {
    const match = columns.find((c) => pattern.test(c.title) || pattern.test(c.id));
    if (match) return match.id;
  }

  // 3. Repli : première colonne du board
  return columns[0].id;
}

/** Construit un contexte textuel synthétique du Kanban et des notes pour l'IA */
export function buildWorkspaceContext(): string {
  const state = useAppStore.getState();
  const cards = state.data.cards || [];
  const notes = state.data.notes || [];

  // Les noms de colonnes proviennent du board réel, pas d'une table figée.
  const columnsMap = new Map(state.data.columns.map((c) => [c.id, c.title]));

  const tasksSummary = cards.slice(0, 30).map((c: KanbanCard) => {
    const col = columnsMap.get(c.columnId) || c.columnId;
    const desc = c.description ? ` (${c.description})` : '';
    const prio = c.priority !== 'medium' ? ` [${c.priority.toUpperCase()}]` : '';
    // L'id réel est indispensable au Copilote pour viser une carte lors
    // d'une suppression/archivage/déplacement. Sans lui, il ne peut pas
    // émettre une balise d'action et préfère refuser poliment.
    return `- [${col}] (id: ${c.id}) ${c.title}${prio}${desc}`;
  }).join('\n');

  const notesSummary = notes.slice(0, 15).map((n) => `- Note: "${n.title}"`).join('\n');

  return [
    '=== CONTEXTE ACTUEL DU WORKSPACE MANSOTNOTE ===',
    '--- TÂCHES DU TABLEAU KANBAN ---',
    tasksSummary || '(Aucune tâche dans le Kanban pour le moment)',
    '--- NOTES RÉCENTES ---',
    notesSummary || '(Aucune note récente)',
    '================================================'
  ].join('\n');
}

/** Exécute une requête API distante au sein du moteur MansotNote */
export async function handleRemoteApiRequest(req: RemoteApiRequest): Promise<RemoteApiResponse> {
  try {
    // 1. Authentification
    const isAuthorized = await verifyRemoteKey(req.key);
    if (!isAuthorized) {
      return {
        id: req.id,
        success: false,
        error: 'Clé de déchiffrement ou mot de passe incorrect. Vérifiez vos réglages dans ⚙️.',
      };
    }

    // verifyRemoteKey peut déverrouiller le coffre et re-hydrater le store :
    // on relit l'état APRÈS l'await, sinon on travaille sur un instantané périmé.
    const state = useAppStore.getState();

    // 2. Traitement selon l'action
    switch (req.action) {
      case 'ping': {
        return {
          id: req.id,
          success: true,
          data: {
            appName: 'MansotNote',
            version: '0.1.0',
            aiConfigured: Boolean(state.data.settings.aiEndpoint && state.data.settings.aiModel),
            notesCount: state.data.notes.length,
            cardsCount: state.data.cards.length,
          },
        };
      }

      case 'get_kanban': {
        return {
          id: req.id,
          success: true,
          data: {
            cards: state.data.cards,
            columns: state.data.columns,
          },
        };
      }

      case 'get_notes': {
        return {
          id: req.id,
          success: true,
          data: {
            notes: state.data.notes.map((n) => ({ id: n.id, title: n.title, updatedAt: n.updatedAt })),
          },
        };
      }

      case 'chat': {
        const settings = state.data.settings;
        if (!settings.aiEndpoint || !settings.aiModel) {
          throw new Error("L'IA n'est pas encore configurée dans MansotNote (Paramètres > IA).");
        }

        const workspaceContext = buildWorkspaceContext();
        const baseSystem = req.payload?.systemPrompt || 'Tu es le Copilote IA de MansotNote.';

        // RAG local : on récupère les passages de notes pertinents pour la
        // question. Auparavant seuls les TITRES étaient transmis, donc le
        // modèle ne pouvait rien citer du contenu réel des notes.
        const question = req.payload?.userPrompt ?? '';
        const rag = question.trim() !== ''
          ? await retrieveContextHybrid(state.data.notes, question, {
              tags: state.data.tags,
              folders: state.data.folders,
              embeddingConfig:
                typeof settings.aiEmbeddingModel === 'string' &&
                settings.aiEmbeddingModel.trim() !== ''
                  ? {
                      endpoint: settings.aiEndpoint,
                      apiKey: settings.aiApiKey || '',
                      model: settings.aiEmbeddingModel,
                    }
                  : undefined,
            })
          : { context: '', sources: [], mode: 'bm25' as const };
        const ragContext = rag.context;
        const sources = rag.sources;

        const enrichedSystem = [
          baseSystem,
          `Tu as un accès direct au workspace de l'utilisateur :\n${workspaceContext}`,
          ragContext,
        ].filter((s) => s !== '').join('\n\n');

        const messages: ChatMessage[] = req.payload?.messages || [];
        if (messages.length === 0) {
          messages.push({ role: 'system', content: enrichedSystem });
          if (req.payload?.userPrompt) {
            messages.push({ role: 'user', content: req.payload.userPrompt });
          }
        }

        const result = await chatComplete(
          {
            endpoint: settings.aiEndpoint,
            model: settings.aiModel,
            apiKey: settings.aiApiKey || '',
          },
          messages,
        );

        return {
          id: req.id,
          success: true,
          // `sources` permet à l'appelant d'afficher les notes citées.
          data: {
            content: result,
            ragMode: rag.mode,
            sources: sources.map((s) => ({
              noteId: s.noteId,
              noteTitle: s.noteTitle,
              heading: s.heading,
            })),
          },
        };
      }

      case 'create_note': {
        const title = req.payload?.title || 'Note distante';
        const content = req.payload?.content || '';
        const noteId = state.createNote({ title, content });
        state.openNote(noteId);
        state.setView('notes');
        state.toast('success', `Note « ${title} » importée depuis l'API !`);

        return {
          id: req.id,
          success: true,
          data: { noteId, title },
        };
      }

      case 'update_note': {
        const noteId = req.payload?.noteId || state.ui.activeNoteId || state.ui.noteDraft?.noteId;
        if (!noteId) {
          return {
            id: req.id,
            success: false,
            error: 'Aucune note spécifiée pour la mise à jour.',
          };
        }
        const patch: { title?: string; content?: string } = {};
        if (req.payload?.title !== undefined) patch.title = req.payload.title;
        if (req.payload?.content !== undefined) patch.content = req.payload.content;
        state.updateNote(noteId, patch);
        state.toast('success', 'Note mise à jour avec succès !');

        return {
          id: req.id,
          success: true,
          data: { noteId, ...patch },
        };
      }

      case 'create_card': {
        const title = req.payload?.title || 'Nouvelle tâche';
        const description = req.payload?.description || '';
        const targetColumnId = resolveColumnId(req.payload?.columnId);
        const priority = req.payload?.priority || 'medium';

        const cardId = state.createCard(targetColumnId, {
          title,
          description,
          priority,
        });

        state.toast('success', `Tâche Kanban « ${title} » ajoutée !`);

        return {
          id: req.id,
          success: true,
          data: { cardId, title, columnId: targetColumnId },
        };
      }

      case 'delete_card': {
        const cardId = req.payload?.cardId;
        if (!cardId) {
          return {
            id: req.id,
            success: false,
            error: 'Aucun cardId fourni pour la suppression.',
          };
        }
        const card = state.data.cards.find((c) => c.id === cardId);
        if (!card) {
          return {
            id: req.id,
            success: false,
            error: `Carte introuvable : ${cardId}.`,
          };
        }
        state.deleteCard(cardId);
        state.toast('info', `Tâche « ${card.title} » supprimée.`);
        return { id: req.id, success: true, data: { deleted: cardId } };
      }

      case 'archive_card': {
        const cardId = req.payload?.cardId;
        if (!cardId) {
          return {
            id: req.id,
            success: false,
            error: 'Aucun cardId fourni pour l\'archivage.',
          };
        }
        const card = state.data.cards.find((c) => c.id === cardId);
        if (!card) {
          return {
            id: req.id,
            success: false,
            error: `Carte introuvable : ${cardId}.`,
          };
        }
        state.archiveCard(cardId);
        state.toast('info', `Tâche « ${card.title} » archivée.`);
        return { id: req.id, success: true, data: { archived: cardId } };
      }

      case 'move_card': {
        const cardId = req.payload?.cardId;
        const target = resolveColumnId(req.payload?.toColumnId);
        if (!cardId) {
          return {
            id: req.id,
            success: false,
            error: 'Aucun cardId fourni pour le déplacement.',
          };
        }
        const card = state.data.cards.find((c) => c.id === cardId);
        if (!card) {
          return {
            id: req.id,
            success: false,
            error: `Carte introuvable : ${cardId}.`,
          };
        }
        // Déplace en fin de colonne cible (index par défaut -1).
        state.moveCard(cardId, target, -1);
        state.toast('success', `Tâche « ${card.title} » déplacée.`);
        return { id: req.id, success: true, data: { moved: cardId, to: target } };
      }

      case 'clear_kanban': {
        // Supprime toutes les cartes en un appel : fiable et indépendant du
        // modèle (pas besoin qu'il émette un id exact). Les ids sont copiés
        // avant la boucle, car chaque `deleteCard` modifie l'état.
        const allIds = state.data.cards.map((c) => c.id);
        if (allIds.length === 0) {
          return {
            id: req.id,
            success: true,
            data: { deleted: 0 },
          };
        }
        for (const id of allIds) {
          state.deleteCard(id);
        }
        state.toast('info', `${allIds.length} tâche(s) supprimée(s).`);
        return { id: req.id, success: true, data: { deleted: allIds.length } };
      }

      default:
        return {
          id: req.id,
          success: false,
          error: `Action inconnue : ${String(req.action)}`,
        };
    }
  } catch (err) {
    return {
      id: req.id,
      success: false,
      error: err instanceof Error ? err.message : 'Erreur interne lors de la requête',
    };
  }
}

