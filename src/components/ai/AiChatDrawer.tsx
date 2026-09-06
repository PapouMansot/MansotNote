/**
 * AiChatDrawer — assistant conversationnel (Copilote IA) intégré à MansotNote.
 * Connecté à l'espace de travail (notes, tâches, colonnes) pour faire avancer
 * concrètement les projets :
 *  - Rédaction & création de notes en 1 clic
 *  - Génération & ajout de tâches Kanban avec checklists
 *  - Planification & analyse des priorités
 */
import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Bot,
  Check,
  Loader2,
  Maximize2,
  Pencil,
  RotateCcw,
  Send,
  Settings2,
  Sparkles,
  SquareKanban,
  StickyNote,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { useAppStore } from '@/store/app-store';
import {
  chatComplete,
  isAiConfigured,
  resolveAiSettings,
  type AiConfig,
  type ChatMessage,
} from '@/lib/ai';
import { retrieveContextHybrid } from '@/lib/retrieval';
import { MarkdownRenderer } from '@/components/markdown/MarkdownRenderer';
import { IconButton } from '@/components/ui/IconButton';
import { Button } from '@/components/ui/Button';
import { AiSettingsFields } from './AiSettingsFields';
import { cn } from '@/lib/utils';

export interface ActionProposal {
  type:
    | 'create_note'
    | 'update_note'
    | 'append_note'
    | 'create_cards'
    | 'add_checklist'
    | 'delete_note'
    | 'archive_note'
    | 'delete_all_cards';
  payload: any;
  executed?: boolean;
}

interface AssistantTurn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  action?: ActionProposal;
}

const QUICK_PROMPTS = [
  '🚀 Que devrais-je faire aujourd’hui ?',
  '📋 Découpe mon projet en tâches Kanban',
  '📝 Rédige un plan d’action structuré',
  '🔍 Fais le bilan de mes tâches et notes',
];

/**
 * Détecte une demande explicite de vidage complet du Kanban.
 * Tolère le français approximatif et les formulations mixtes comme
 * « delete toute les carte stp ».
 */
export function isDeleteAllCardsRequest(text: string): boolean {
  return (
    // Suppression : exige un quantificateur global pour ne jamais confondre
    // « supprime la carte X » avec « supprime toutes les cartes ».
    /(?:suppr(?:ime|imer|ession|é)|delete|efface)[\s\S]{0,25}(?:tout(?:e|es)?|all)[\s\S]{0,20}(?:cartes?|tâches?|cards?|tasks?|kanban|board)/i.test(text) ||
    // « vider le Kanban » implique déjà la totalité.
    /(?:vide|vider)[\s\S]{0,20}(?:kanban|board|tout(?:e|es)?[\s\S]{0,12}(?:cartes?|tâches?))/i.test(text) ||
    // Formulations anglaises de vidage global.
    /clear[\s\S]{0,20}(?:(?:all|the)[\s\S]{0,10})?(?:cards?|tasks?|kanban|board)/i.test(text)
  );
}

export function AiChatDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const state = useAppStore();
  const settings = state.data.settings;
  const updateSettings = state.updateSettings;
  const notes = state.data.notes;
  const cards = state.data.cards;
  const columns = state.data.columns;

  const [showSettings, setShowSettings] = useState(false);
  const [messages, setMessages] = useState<AssistantTurn[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        'Salut ! Je suis ton **Copilote IA** 🚀.\n\nJe peux analyser tes notes, découper tes projets en tâches Kanban, rédiger du contenu ou planifier tes prochaines actions.\n\nComment puis-je t\'aider à avancer aujourd\'hui ?',
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const aiValues = resolveAiSettings(settings);
  const [ragMode, setRagMode] = useState<'hybrid' | 'bm25'>(
    aiValues.aiEmbeddingModel.trim() !== '' ? 'hybrid' : 'bm25',
  );
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const aiConfig: AiConfig = {
    endpoint: aiValues.aiEndpoint,
    apiKey: aiValues.aiApiKey,
    model: aiValues.aiModel,
  };

  const configured = isAiConfigured(aiConfig);

  useEffect(() => {
    if (open) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, open]);

  const buildWorkspaceContext = (): string => {
    const activeDraft = state.ui.noteDraft;
    const activeNote = activeDraft?.noteId ? notes.find((n) => n.id === activeDraft.noteId) : undefined;
    const activeNoteContext = activeDraft?.noteId
      ? [
          '=== NOTE ACTUELLEMENT OUVERTE DANS L’ÉDITEUR ===',
          `ID: "${activeDraft.noteId}"`,
          `Titre: "${activeDraft.title || activeNote?.title || 'Sans titre'}"`,
          'Contenu actuel :',
          activeDraft.content.slice(0, 4000) + (activeDraft.content.length > 4000 ? '\n… [tronqué]' : ''),
          '',
        ].join('\n')
      : '';

    const notesSummary = notes
      .slice(0, 10)
      .map((n) => `- Note "${n.title || 'Sans titre'}" (${n.content.slice(0, 70).replace(/\n/g, ' ')}...)`)
      .join('\n');

    const cardsSummary = columns
      .map((col) => {
        const colCards = cards.filter((c) => c.columnId === col.id).slice(0, 8);
        const cardLines = colCards
          .map((c) => `  * [${c.priority}] ${c.title}`)
          .join('\n');
        return `Colonne "${col.title}" :\n${cardLines || '  (aucune carte)'}`;
      })
      .join('\n');

    return [
      'Tu es SIA, l\'assistante IA personnelle et le copilote de productivité de MansotNote.',
      'Aide l\'utilisateur à organiser ses projets, structurer ses idées, rédiger du contenu, corriger ses textes et planifier ses prochaines étapes.',
      '',
      activeNoteContext,
      'Espace de travail :',
      '=== NOTES ===',
      notesSummary || '(aucune note)',
      '',
      '=== TÂCHES KANBAN ===',
      cardsSummary || '(aucune tâche)',
      '',
      'RÈGLES CRUCIALES POUR LES ACTIONS SUR LES NOTES ET LE WORKSPACE :',
      '- Pour CRÉER une NOUVELLE note : ajoute TOUJOURS en fin de réponse le bloc :',
      '```action:create_note',
      '{ "title": "Titre clair et précis", "content": "Contenu complet en Markdown..." }',
      '```',
      '- Pour AJOUTER ou COMPLÉTER du contenu à une note (active ou désignée par son titre) : ajoute TOUJOURS :',
      '```action:append_note',
      `{ "title": "${activeDraft?.title || ''}", "noteId": "${activeDraft?.noteId || ''}", "content": "Contenu exact à ajouter à la fin de la note..." }`,
      '```',
      '- Pour CORRIGER ou MODIFIER entièrement la note activement ouverte, tu DOIS proposer :',
      '```action:update_note',
      `{ "noteId": "${activeDraft?.noteId || ''}", "title": "${activeDraft?.title || ''}", "content": "Contenu complet corrigé..." }`,
      '```',
      '- Règle stricte : N’utilise JAMAIS create_note pour modifier ou corriger une note existante.',
      '- Si l\'utilisateur te demande de supprimer une note, indique son titre dans ce bloc en fin de message :',
      '```action:delete_note',
      '{ "title": "Titre exact de la note" }',
      '```',
      '- Si tu proposes des tâches Kanban, tu peux ajouter en fin de message :',
      '```action:create_cards',
      '{ "columnTitle": "À faire", "cards": [ { "title": "Titre", "description": "Détails", "priority": "medium", "checklist": ["Étape 1"] } ] }',
      '```',
      '- Si l’utilisateur demande de supprimer ou vider TOUTES les cartes Kanban, tu DOIS ajouter ce bloc en fin de message :',
      '```action:delete_all_cards',
      `{ "count": ${cards.length} }`,
      '```',
      '- Ne dis jamais que la suppression de toutes les cartes est indisponible : l’application affiche un bouton de confirmation avant de l’exécuter.',
    ].filter(Boolean).join('\n');
  };

  const parseActionsFromResponse = (
    text: string,
  ): { cleanContent: string; action?: ActionProposal } => {
    // Suppression de toutes les cartes Kanban : action destructive, qui sera
    // présentée sous forme de bouton de confirmation avant exécution.
    const deleteAllCardsMatch = text.match(
      /```action:delete_all_cards\s*([\s\S]*?)\s*```/,
    );
    if (deleteAllCardsMatch) {
      try {
        const payload = JSON.parse(deleteAllCardsMatch[1]);
        const cleanContent = text
          .replace(/```action:delete_all_cards[\s\S]*?```/, '')
          .trim();
        return {
          cleanContent,
          action: { type: 'delete_all_cards', payload },
        };
      } catch {
        // Même si le modèle produit un JSON imparfait, le bouton peut être
        // recréé par le garde-fou déterministe dans handleSend.
      }
    }

    // Check for note update / correction block
    const updateMatch = text.match(/```action:update_note\s*([\s\S]*?)\s*```/);
    if (updateMatch) {
      try {
        const payload = JSON.parse(updateMatch[1]);
        const cleanContent = text.replace(/```action:update_note[\s\S]*?```/, '').trim();
        return {
          cleanContent,
          action: { type: 'update_note', payload },
        };
      } catch {
        // ignore JSON parse error
      }
    }

    // Check for note append block
    const appendMatch = text.match(/```action:append_note\s*([\s\S]*?)\s*```/);
    if (appendMatch) {
      try {
        const payload = JSON.parse(appendMatch[1]);
        const cleanContent = text.replace(/```action:append_note[\s\S]*?```/, '').trim();
        return {
          cleanContent,
          action: { type: 'append_note', payload },
        };
      } catch {
        // ignore JSON parse error
      }
    }

    // Check for note deletion block
    const deleteMatch = text.match(/```action:delete_note\s*([\s\S]*?)\s*```/);
    if (deleteMatch) {
      try {
        const payload = JSON.parse(deleteMatch[1]);
        const cleanContent = text.replace(/```action:delete_note[\s\S]*?```/, '').trim();
        return {
          cleanContent,
          action: { type: 'delete_note', payload },
        };
      } catch {
        // ignore JSON parse error
      }
    }

    // Check for note creation block
    const noteMatch = text.match(/```action:create_note\s*([\s\S]*?)\s*```/);
    if (noteMatch) {
      try {
        const payload = JSON.parse(noteMatch[1]);
        const cleanContent = text.replace(/```action:create_note[\s\S]*?```/, '').trim();
        return {
          cleanContent,
          action: { type: 'create_note', payload },
        };
      } catch {
        // ignore JSON parse error
      }
    }

    // Check for cards creation block
    const cardsMatch = text.match(/```action:create_cards\s*([\s\S]*?)\s*```/);
    if (cardsMatch) {
      try {
        const payload = JSON.parse(cardsMatch[1]);
        const cleanContent = text.replace(/```action:create_cards[\s\S]*?```/, '').trim();
        return {
          cleanContent,
          action: { type: 'create_cards', payload },
        };
      } catch {
        // ignore JSON parse error
      }
    }

    return { cleanContent: text };
  };

  const handleSend = async (customPrompt?: string) => {
    const textToSend = (customPrompt ?? input).trim();
    if (textToSend === '' || loading) return;

    if (!configured) {
      state.toast('error', "L'IA n'est pas configurée (ajoute endpoint et modèle dans les réglages).");
      return;
    }

    const userTurn: AssistantTurn = {
      id: String(Date.now()),
      role: 'user',
      content: textToSend,
    };

    setMessages((prev) => [...prev, userTurn]);
    setInput('');
    setLoading(true);

    try {
      const rag = await retrieveContextHybrid(notes, textToSend, {
        tags: state.data.tags,
        folders: state.data.folders,
        embeddingConfig:
          aiValues.aiEmbeddingModel.trim() !== ''
            ? {
                endpoint: aiValues.aiEndpoint,
                apiKey: aiValues.aiApiKey,
                model: aiValues.aiEmbeddingModel,
              }
            : undefined,
      });
      setRagMode(rag.mode);
      // Le repli BM25 est volontairement silencieux : le chat continue même
      // si le serveur d'embeddings est momentanément indisponible.

      const historyForAi: ChatMessage[] = [
        {
          role: 'system',
          content: [buildWorkspaceContext(), rag.context]
            .filter((part) => part !== '')
            .join('\n\n'),
        },
        ...messages
          .filter((m) => m.id !== 'welcome')
          .slice(-8)
          .map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: textToSend },
      ];

      const response = await chatComplete(aiConfig, historyForAi, {
        temperature: 0.7,
      });

      const parsed = parseActionsFromResponse(response);

    // Garde-fou déterministe pour la suppression globale
    const wantsDeleteAllCards = isDeleteAllCardsRequest(textToSend);
    // Garde-fou déterministe pour la correction : si l'utilisateur demande de corriger
    // et qu'une note est ouverte, transformer tout create_note en update_note ciblé
    const isCorrectionIntent = /corrig|correct|faute|orthograph|grammair|accent|reformul|amelior|amélior|style/i.test(textToSend);
    const isAppendIntent = /(?:ajoute|rajoute|insère|insere|mets?)\s+(?:dans|à|sur)\s+(?:la|ma|cette)?\s*note/i.test(textToSend);
    const isCreateNoteIntent = /(?:crée|cree|créer|creer|nouvelle\s+note|ajoute\s+une\s+note|rédige\s+une\s+note|prends?\s+note|note\s+que)/i.test(textToSend);
    const activeDraft = useAppStore.getState().ui.noteDraft;

    let action = parsed.action;
    if (wantsDeleteAllCards) {
      action = {
        type: 'delete_all_cards' as const,
        payload: { count: cards.length },
      };
    } else if (isCorrectionIntent && activeDraft?.noteId && action?.type === 'create_note') {
      action = {
        type: 'update_note' as const,
        payload: {
          noteId: activeDraft.noteId,
          title: activeDraft.title,
          content: action.payload?.content || '',
        },
      };
    } else if (!action) {
      if (isAppendIntent && (activeDraft?.noteId || notes.length > 0)) {
        const targetNote = notes.find((n) =>
          n.title && n.title.trim().length > 2 && textToSend.toLowerCase().includes(n.title.toLowerCase()),
        ) || (activeDraft?.noteId ? notes.find((n) => n.id === activeDraft.noteId) : notes[0]);
        if (targetNote) {
          action = {
            type: 'append_note' as const,
            payload: {
              noteId: targetNote.id,
              title: targetNote.title,
              content: parsed.cleanContent,
            },
          };
        }
      } else if (isCreateNoteIntent) {
        const firstHeading = parsed.cleanContent.match(/^#\s+(.+)$/m);
        const derivedTitle = firstHeading
          ? firstHeading[1].trim()
          : textToSend.replace(/(?:crée|cree|créer|creer|nouvelle\s+note|ajoute\s+une\s+note|rédige\s+une\s+note|prends?\s+note|note\s+que|pour|de|d'|d’)\s*/gi, '').trim().slice(0, 40) || 'Note IA';
        action = {
          type: 'create_note' as const,
          payload: {
            title: derivedTitle,
            content: parsed.cleanContent,
          },
        };
      }
    }

    // Exécution automatique immédiate pour la création / modification de note
    if (action && (action.type === 'create_note' || action.type === 'append_note' || action.type === 'update_note')) {
      action = executeActionDirectly(action);
    }

    const assistantTurn: AssistantTurn = {
        id: String(Date.now() + 1),
        role: 'assistant',
        content: parsed.cleanContent,
        action,
      };

      setMessages((prev) => [...prev, assistantTurn]);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'La communication avec l\'IA a échoué.';
      const errorTurn: AssistantTurn = {
        id: String(Date.now() + 1),
        role: 'assistant',
        content: `⚠️ **Erreur** : ${errorMsg}\n\n*Astuce : clique sur l'icône ⚙️ en haut à droite pour vérifier ton endpoint (OpenAI, OpenRouter, Ollama ou LM Studio) et sélectionner un modèle valide.*`,
      };
      setMessages((prev) => [...prev, errorTurn]);
    } finally {
      setLoading(false);
    }
  };

  const executeActionDirectly = (act: ActionProposal): ActionProposal => {
    const currentNotes = useAppStore.getState().data.notes;
    const currentDraft = useAppStore.getState().ui.noteDraft;

    if (act.type === 'create_note') {
      const { title, content } = act.payload;
      const noteId = state.createNote({
        title: title || 'Note IA',
        content: content || '',
        preserveView: true,
      });
      void state.saveDraftNow();
      state.toast('success', `Note « ${title || 'Note IA'} » créée dans vos notes !`);
      return {
        ...act,
        payload: { ...act.payload, noteId },
        executed: true,
      };
    } else if (act.type === 'append_note') {
      const { noteId, content, title } = act.payload;
      const targetTitle = String(title || '').toLowerCase().trim();
      const targetNote = currentNotes.find(
        (n) =>
          (noteId && n.id === noteId) ||
          (targetTitle && n.title.toLowerCase().trim() === targetTitle) ||
          (targetTitle && n.title.toLowerCase().includes(targetTitle)),
      ) || (state.ui.activeNoteId ? currentNotes.find((n) => n.id === state.ui.activeNoteId) : undefined)
        || (currentDraft?.noteId ? currentNotes.find((n) => n.id === currentDraft.noteId) : undefined);

      if (targetNote) {
        const pad = targetNote.content.endsWith('\n\n') ? '' : targetNote.content.endsWith('\n') ? '\n' : '\n\n';
        const newContent = targetNote.content + pad + String(content || '').trim();
        state.updateNote(targetNote.id, { content: newContent });
        if (currentDraft?.noteId === targetNote.id) {
          state.setDraft({ content: newContent });
        }
        void state.saveDraftNow();
        state.toast('success', `Ajouté à la note « ${targetNote.title} » !`);
        return {
          ...act,
          payload: { ...act.payload, noteId: targetNote.id, title: targetNote.title },
          executed: true,
        };
      } else {
        const newId = state.createNote({
          title: title || 'Nouvelle note',
          content: String(content || '').trim(),
          preserveView: true,
        });
        void state.saveDraftNow();
        state.toast('success', `Note « ${title || 'Nouvelle note'} » créée avec le contenu !`);
        return {
          ...act,
          payload: { ...act.payload, noteId: newId },
          executed: true,
        };
      }
    } else if (act.type === 'update_note') {
      const { noteId, content, title } = act.payload;
      const targetTitle = String(title || '').toLowerCase().trim();
      const targetNote = currentNotes.find(
        (n) =>
          (noteId && n.id === noteId) ||
          (targetTitle && n.title.toLowerCase().trim() === targetTitle) ||
          (targetTitle && n.title.toLowerCase().includes(targetTitle)),
      ) || (state.ui.activeNoteId ? currentNotes.find((n) => n.id === state.ui.activeNoteId) : undefined)
        || (currentDraft?.noteId ? currentNotes.find((n) => n.id === currentDraft.noteId) : undefined);

      if (targetNote) {
        state.updateNote(targetNote.id, {
          ...(content !== undefined ? { content } : {}),
          ...(title !== undefined ? { title } : {}),
        });
        if (currentDraft?.noteId === targetNote.id) {
          state.setDraft({
            ...(content !== undefined ? { content } : {}),
            ...(title !== undefined ? { title } : {}),
          });
        }
        void state.saveDraftNow();
        state.toast('success', `Note « ${targetNote.title} » mise à jour avec succès !`);
        return {
          ...act,
          payload: { ...act.payload, noteId: targetNote.id, title: targetNote.title },
          executed: true,
        };
      }
    }
    return act;
  };

  const executeAction = (turnId: string, action: ActionProposal) => {
    if (action.type === 'delete_all_cards') {
      // Copie des ids avant la boucle : chaque suppression modifie le store.
      const ids = useAppStore.getState().data.cards.map((card) => card.id);
      ids.forEach((id) => useAppStore.getState().deleteCard(id));
      state.toast(
        'info',
        ids.length > 0
          ? `${ids.length} carte(s) Kanban supprimée(s).`
          : 'Le Kanban est déjà vide.',
      );
    } else if (action.type === 'delete_note') {
      const targetTitle = String(action.payload?.title || '').toLowerCase().trim();
      const targetNote = notes.find(
        (n) =>
          n.id === action.payload?.id ||
          n.title.toLowerCase().trim() === targetTitle ||
          n.title.toLowerCase().includes(targetTitle),
      );
      if (targetNote) {
        state.deleteNote(targetNote.id);
        state.toast('info', `Note « ${targetNote.title} » supprimée !`);
      } else {
        state.toast('error', `Note introuvable.`);
      }
    } else if (action.type === 'update_note') {
      const { noteId, content, title } = action.payload;
      const targetTitle = String(title || '').toLowerCase().trim();
      const targetNote = notes.find(
        (n) =>
          (noteId && n.id === noteId) ||
          (targetTitle && n.title.toLowerCase().trim() === targetTitle) ||
          (targetTitle && n.title.toLowerCase().includes(targetTitle)),
      ) || (state.ui.activeNoteId ? notes.find((n) => n.id === state.ui.activeNoteId) : undefined)
        || (state.ui.noteDraft?.noteId ? notes.find((n) => n.id === state.ui.noteDraft?.noteId) : undefined);
      if (targetNote) {
        state.updateNote(targetNote.id, {
          ...(content !== undefined ? { content } : {}),
          ...(title !== undefined ? { title } : {}),
        });
        if (state.ui.noteDraft?.noteId === targetNote.id) {
          state.setDraft({
            ...(content !== undefined ? { content } : {}),
            ...(title !== undefined ? { title } : {}),
          });
        }
        state.setView('notes');
        state.toast('success', `Note « ${targetNote.title} » mise à jour avec succès !`);
      } else {
        state.toast('error', 'Aucune note correspondante à mettre à jour.');
      }
    } else if (action.type === 'append_note') {
      const { noteId, content, title } = action.payload;
      const targetTitle = String(title || '').toLowerCase().trim();
      const targetNote = notes.find(
        (n) =>
          (noteId && n.id === noteId) ||
          (targetTitle && n.title.toLowerCase().trim() === targetTitle) ||
          (targetTitle && n.title.toLowerCase().includes(targetTitle)),
      ) || (state.ui.activeNoteId ? notes.find((n) => n.id === state.ui.activeNoteId) : undefined)
        || (state.ui.noteDraft?.noteId ? notes.find((n) => n.id === state.ui.noteDraft?.noteId) : undefined);
      if (targetNote) {
        const pad = targetNote.content.endsWith('\n\n') ? '' : targetNote.content.endsWith('\n') ? '\n' : '\n\n';
        const newContent = targetNote.content + pad + String(content || '').trim();
        state.updateNote(targetNote.id, { content: newContent });
        if (state.ui.noteDraft?.noteId === targetNote.id) {
          state.setDraft({ content: newContent });
        }
        state.setView('notes');
        state.toast('success', `Ajouté à la note « ${targetNote.title} » !`);
      } else {
        const newId = state.createNote({
          title: title || 'Nouvelle note',
          content: String(content || '').trim(),
        });
        state.openNote(newId);
        state.setView('notes');
        state.toast('success', `Note « ${title || 'Nouvelle note'} » créée avec le contenu !`);
      }
    } else if (action.type === 'create_note') {
      const { title, content } = action.payload;
      const noteId = state.createNote({
        title: title || 'Note IA',
        content: content || '',
      });
      state.openNote(noteId);
      state.setView('notes');
      state.toast('success', `Note « ${title || 'Note IA'} » créée !`);
    } else if (action.type === 'create_cards') {
      const { columnTitle, cards: newCards } = action.payload;
      // Trouver la colonne ou prendre la première
      let col = columns.find(
        (c) => c.title.toLowerCase() === String(columnTitle || '').toLowerCase(),
      );
      if (!col) {
        col = columns[0];
      }
      if (col && Array.isArray(newCards)) {
        newCards.forEach((c: any) => {
          const cardId = state.createCard(col.id, {
            title: c.title || 'Tâche',
            description: c.description || '',
            priority: c.priority || 'medium',
          });
          if (Array.isArray(c.checklist)) {
            c.checklist.forEach((item: string) => {
              state.addChecklistItem(cardId, item);
            });
          }
        });
        state.setView('kanban');
        state.toast('success', `${newCards.length} tâche(s) ajoutée(s) à « ${col.title} » !`);
      }
    }

    // Marquer l'action comme exécutée
    setMessages((prev) =>
      prev.map((m) => (m.id === turnId && m.action ? { ...m, action: { ...m.action, executed: true } } : m)),
    );
  };

  if (!open) {
    return null;
  }

  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-zinc-200 bg-white shadow-2xl transition-transform dark:border-zinc-800 dark:bg-zinc-950 sm:w-[420px]">
      {/* ------------------------------ En-tête ------------------------------ */}
      <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-sm">
            <Sparkles size={15} />
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-tight">SIA · Copilote</h2>
            <p className="text-[10px] text-zinc-400 dark:text-zinc-500">
              {configured ? `Modèle : ${settings.aiModel}` : 'Non configuré'}
              {configured && (
                <span className="ml-1.5" title={ragMode === 'hybrid' ? `Embedding : ${aiValues.aiEmbeddingModel}` : 'Recherche par mots-clés'}>
                  · RAG {ragMode === 'hybrid' ? 'hybride' : 'BM25'}
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <IconButton
            label={showSettings ? 'Masquer les réglages' : 'Configuration IA'}
            icon={<Settings2 size={15} />}
            active={showSettings}
            onClick={() => setShowSettings((v) => !v)}
          />
          <IconButton
            label="Effacer la conversation"
            icon={<RotateCcw size={14} />}
            onClick={() =>
              setMessages([
                {
                  id: 'welcome',
                  role: 'assistant',
                  content:
                    'Conversation réinitialisée ! Comment puis-je t\'aider à avancer ?',
                },
              ])
            }
          />
          <IconButton
            label="Plein écran (Ctrl+3)"
            icon={<Maximize2 size={14} />}
            onClick={() => {
              onClose();
              state.setView('chat');
            }}
          />
          <IconButton label="Fermer" icon={<X size={16} />} onClick={onClose} />
        </div>
      </header>

      {/* --------------------------- Panneau réglages IA ----------------------- */}
      {showSettings && (
        <div className="border-b border-indigo-200 bg-indigo-50/40 p-3.5 dark:border-indigo-900/60 dark:bg-indigo-950/30">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-indigo-900 dark:text-indigo-200">
              Paramètres IA & Fournisseur
            </span>
            <button
              type="button"
              className="text-xs text-indigo-600 hover:underline dark:text-indigo-400"
              onClick={() => setShowSettings(false)}
            >
              Fermer
            </button>
          </div>
          <AiSettingsFields
            values={aiValues}
            onChange={(patch) => updateSettings(patch)}
          />
        </div>
      )}

      {/* ---------------------------- Messages ------------------------------ */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((turn) => (
          <div
            key={turn.id}
            className={`flex flex-col ${turn.role === 'user' ? 'items-end' : 'items-start'}`}
          >
            <div className="mb-1 flex items-center gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              {turn.role === 'user' ? (
                <>
                  <span>Moi</span>
                  <User size={11} />
                </>
              ) : (
                <>
                  <Bot size={11} className="text-indigo-500" />
                  <span>SIA</span>
                </>
              )}
            </div>

            <div
              className={`rounded-xl px-3.5 py-2.5 text-xs leading-relaxed ${
                turn.role === 'user'
                  ? 'max-w-[85%] bg-indigo-600 text-white'
                  : 'max-w-[95%] border border-zinc-200 bg-zinc-50/80 text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-200'
              }`}
            >
              {turn.role === 'user' ? (
                <p className="whitespace-pre-wrap">{turn.content}</p>
              ) : (
                <MarkdownRenderer markdown={turn.content} />
              )}
            </div>

            {/* Carte d'action 1-clic */}
            {turn.action && (
              <div className={cn(
                'mt-2 w-[95%] rounded-lg border p-2.5 transition-all',
                turn.action.executed
                  ? 'border-emerald-500/40 bg-emerald-50/70 dark:border-emerald-500/30 dark:bg-emerald-950/40'
                  : 'border-indigo-200 bg-indigo-50/60 dark:border-indigo-900/60 dark:bg-indigo-950/40',
              )}>
                <div className={cn(
                  'mb-2 flex items-center justify-between text-xs font-semibold',
                  turn.action.executed ? 'text-emerald-950 dark:text-emerald-200' : 'text-indigo-900 dark:text-indigo-200',
                )}>
                  <span className="inline-flex items-center gap-1.5">
                    {turn.action.executed ? (
                      <Check size={14} className="text-emerald-600 dark:text-emerald-400" />
                    ) : turn.action.type === 'create_note' ? (
                      <StickyNote size={14} className="text-indigo-600" />
                    ) : turn.action.type === 'append_note' ? (
                      <StickyNote size={14} className="text-emerald-600" />
                    ) : turn.action.type === 'update_note' ? (
                      <Pencil size={14} className="text-indigo-600" />
                    ) : turn.action.type === 'delete_note' ||
                      turn.action.type === 'delete_all_cards' ? (
                      <Trash2 size={14} className="text-red-500" />
                    ) : (
                      <SquareKanban size={14} className="text-indigo-600" />
                    )}
                    {turn.action.type === 'create_note'
                      ? turn.action.executed
                        ? `Note enregistrée : « ${turn.action.payload.title || 'Note'} »`
                        : `Créer la note : « ${turn.action.payload.title || 'Sans titre'} »`
                      : turn.action.type === 'append_note'
                        ? turn.action.executed
                          ? `Ajouté à la note : « ${turn.action.payload.title || 'Note'} »`
                          : `Ajouter à la note : « ${turn.action.payload.title || 'Note'} »`
                      : turn.action.type === 'update_note'
                        ? turn.action.executed
                          ? `Note mise à jour : « ${turn.action.payload.title || 'Note'} »`
                          : `Mettre à jour la note : « ${turn.action.payload.title || 'Note active'} »`
                        : turn.action.type === 'delete_note'
                          ? `Supprimer la note : « ${turn.action.payload.title || 'Sans titre'} »`
                          : turn.action.type === 'delete_all_cards'
                            ? `Supprimer toutes les cartes (${cards.length})`
                            : `Ajouter ${turn.action.payload.cards?.length || 0} tâche(s) au Kanban`}
                  </span>
                </div>

                {turn.action.executed ? (
                  (turn.action.type === 'create_note' ||
                    turn.action.type === 'append_note' ||
                    turn.action.type === 'update_note') &&
                  turn.action.payload?.noteId ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="w-full text-xs font-semibold text-emerald-800 border-emerald-300 hover:bg-emerald-100 dark:border-emerald-800 dark:text-emerald-200 dark:hover:bg-emerald-950/60"
                      icon={<ArrowRight size={13} />}
                      onClick={() => {
                        state.openNote(turn.action!.payload.noteId);
                        state.setView('notes');
                        onClose();
                      }}
                    >
                      Ouvrir la note dans l’éditeur
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" className="w-full text-xs" disabled icon={<Check size={13} />}>
                      Action enregistrée
                    </Button>
                  )
                ) : (
                  <Button
                    size="sm"
                    variant={
                      turn.action.type === 'delete_note' ||
                      turn.action.type === 'delete_all_cards'
                        ? 'danger'
                        : 'primary'
                    }
                    className="w-full text-xs"
                    icon={<ArrowRight size={13} />}
                    onClick={() => executeAction(turn.id, turn.action!)}
                  >
                    {turn.action.type === 'delete_all_cards'
                      ? 'Confirmer la suppression complète'
                      : 'Appliquer cette action'}
                  </Button>
                )}
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
            <Loader2 size={14} className="animate-spin text-indigo-500" />
            <span>Le copilote réfléchit et prépare l'action…</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ------------------------ Suggestions rapides ----------------------- */}
      {messages.length <= 2 && (
        <div className="border-t border-zinc-100 px-3 py-2 dark:border-zinc-900">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            Idées rapides :
          </p>
          <div className="flex flex-wrap gap-1">
            {QUICK_PROMPTS.map((prompt, i) => (
              <button
                key={i}
                type="button"
                onClick={() => handleSend(prompt)}
                className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] text-zinc-600 transition-colors hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-indigo-700 dark:hover:bg-indigo-950/50"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ------------------------------ Saisie ------------------------------ */}
      <footer className="border-t border-zinc-200 p-3 dark:border-zinc-800">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="flex items-center gap-2"
        >
          <input
            className="field h-9 flex-1 px-3 text-xs"
            placeholder="Demande une action, un plan, une note…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading}
          />
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={loading || input.trim() === ''}
            className="h-9 px-3"
            icon={loading ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
          >
            Envoyer
          </Button>
        </form>
      </footer>
    </aside>
  );
}
