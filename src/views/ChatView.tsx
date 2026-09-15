/**
 * ChatView — Interface de Chat Copilote IA Plein Écran (Full-Page View).
 * Permet d'interagir avec l'ensemble de l'espace de travail (notes, tâches, RAG hybride)
 * dans une interface spacieuse, fluide et moderne avec gestion de conversations persistantes.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Bot,
  Check,
  Compass,
  FileEdit,
  Lightbulb,
  ListTodo,
  Loader2,
  MessageSquare,
  PanelLeft,
  PanelLeftClose,
  Pencil,
  Plus,
  RotateCcw,
  Send,
  Settings2,
  Sparkles,
  SquareKanban,
  StickyNote,
  Trash2,
  User,
} from 'lucide-react';
import { useAppStore } from '@/store/app-store';
import {
  chatStream,
  isAiConfigured,
  resolveAiSettings,
  sanitizeHistoryContent,
  type AiConfig,
  type ChatMessage,
} from '@/lib/ai';
import { retrieveContextHybrid } from '@/lib/retrieval';
import { MarkdownRenderer } from '@/components/markdown/MarkdownRenderer';
import { Button } from '@/components/ui/Button';
import { AiSettingsFields } from '@/components/ai/AiSettingsFields';
import { isDeleteAllCardsRequest, type ActionProposal } from '@/components/ai/AiChatDrawer';
import { ReasoningBlock } from '@/components/ai/ReasoningBlock';
import { cn } from '@/lib/utils';
import { formatTime } from '@/lib/dates';
import {
  createNewConversation,
  deriveConversationTitle,
  loadActiveConversationId,
  loadSavedConversations,
  saveActiveConversationId,
  saveConversationsToStorage,
  type ChatConversation,
  type ChatTurn,
} from '@/lib/chat-storage';

const HERO_PROMPTS = [
  {
    icon: <Sparkles className="text-amber-500" size={18} />,
    title: 'Corriger la note active',
    desc: 'Corrige l’orthographe et le style sans créer de nouvelle note',
    prompt: 'Corrige l’orthographe et améliore le style de ma note activement ouverte.',
  },
  {
    icon: <ListTodo className="text-emerald-500" size={18} />,
    title: 'Découper en tâches Kanban',
    desc: 'Transforme un objectif ou projet en cartes avec checklist',
    prompt: 'Découpe mes priorités actuelles en tâches Kanban structurées et actionnables.',
  },
  {
    icon: <Lightbulb className="text-indigo-500" size={18} />,
    title: 'Planifier ma journée',
    desc: 'Analyse mes notes et mes tâches pour recommander un plan d’action',
    prompt: 'Que devrais-je faire en priorité aujourd’hui en fonction de mes notes et de mon Kanban ?',
  },
  {
    icon: <Compass className="text-purple-500" size={18} />,
    title: 'Bilan de mes projets',
    desc: 'Synthèse globale de mon espace de travail',
    prompt: 'Fais le point et le bilan synthétique de toutes mes notes et tâches en cours.',
  },
];

export function ChatView() {
  const state = useAppStore();
  const settings = state.data.settings;
  const updateSettings = state.updateSettings;
  const notes = state.data.notes;
  const cards = state.data.cards;
  const columns = state.data.columns;
  const noteDraft = state.ui.noteDraft;

  const [showSettings, setShowSettings] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Conversations persistantes enregistrées dans localStorage
  const [conversations, setConversations] = useState<ChatConversation[]>(() => {
    const saved = loadSavedConversations();
    if (saved.length > 0) return saved;
    const initial = createNewConversation('Discussion principale');
    saveConversationsToStorage([initial]);
    return [initial];
  });

  const [activeConvId, setActiveConvId] = useState<string>(() => {
    const savedId = loadActiveConversationId();
    const saved = loadSavedConversations();
    if (savedId && saved.some((c) => c.id === savedId)) return savedId;
    return saved[0]?.id || '';
  });

  const activeConv = useMemo(() => {
    return conversations.find((c) => c.id === activeConvId) || conversations[0];
  }, [conversations, activeConvId]);

  const messages = activeConv?.messages || [];

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const aiValues = resolveAiSettings(settings);
  const [ragMode, setRagMode] = useState<'hybrid' | 'bm25'>(
    aiValues.aiEmbeddingModel.trim() !== '' ? 'hybrid' : 'bm25',
  );

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const aiConfig: AiConfig = {
    endpoint: aiValues.aiEndpoint,
    apiKey: aiValues.aiApiKey,
    model: aiValues.aiModel,
    keepAlive: aiValues.aiKeepAlive,
  };

  const configured = isAiConfigured(aiConfig);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [activeConvId]);

  useEffect(() => {
    if (activeConvId) {
      saveActiveConversationId(activeConvId);
    }
  }, [activeConvId]);

  const updateActiveMessages = (
    updater: (prev: ChatTurn[]) => ChatTurn[],
    newTitle?: string,
    persist = true,
  ) => {
    setConversations((prev) => {
      const targetId = activeConvId || prev[0]?.id;
      const updated = prev.map((c) => {
        if (c.id === targetId) {
          const nextMessages = updater(c.messages);
          return {
            ...c,
            title: newTitle !== undefined ? newTitle : c.title,
            updatedAt: Date.now(),
            messages: nextMessages,
          };
        }
        return c;
      });
      if (persist) {
        saveConversationsToStorage(updated);
      }
      return updated;
    });
  };

  const handleNewConversation = () => {
    const fresh = createNewConversation(`Conversation ${conversations.length + 1}`);
    const nextList = [fresh, ...conversations];
    setConversations(nextList);
    setActiveConvId(fresh.id);
    saveConversationsToStorage(nextList);
    saveActiveConversationId(fresh.id);
  };

  const handleDeleteConversation = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (conversations.length <= 1) {
      const fresh = createNewConversation('Discussion principale');
      setConversations([fresh]);
      setActiveConvId(fresh.id);
      saveConversationsToStorage([fresh]);
      saveActiveConversationId(fresh.id);
      return;
    }
    const filtered = conversations.filter((c) => c.id !== id);
    setConversations(filtered);
    saveConversationsToStorage(filtered);
    if (activeConvId === id) {
      const nextActive = filtered[0].id;
      setActiveConvId(nextActive);
      saveActiveConversationId(nextActive);
    }
  };

  const buildWorkspaceContext = (): string => {
    const activeNote = noteDraft?.noteId ? notes.find((n) => n.id === noteDraft.noteId) : undefined;
    const activeNoteContext = noteDraft?.noteId
      ? [
          '=== NOTE ACTUELLEMENT OUVERTE DANS L’ÉDITEUR ===',
          `ID: "${noteDraft.noteId}"`,
          `Titre: "${noteDraft.title || activeNote?.title || 'Sans titre'}"`,
          'Contenu actuel :',
          noteDraft.content.slice(0, 4000) + (noteDraft.content.length > 4000 ? '\n… [tronqué]' : ''),
          '',
        ].join('\n')
      : '';

    const notesSummary = notes
      .slice(0, 15)
      .map((n) => `- Note "${n.title || 'Sans titre'}" (ID: "${n.id}", ${n.content.slice(0, 80).replace(/\n/g, ' ')}...)`)
      .join('\n');

    const cardsSummary = columns
      .map((col) => {
        const colCards = cards.filter((c) => c.columnId === col.id).slice(0, 10);
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
      '=== NOTES DISPONIBLES ===',
      notesSummary || '(aucune note)',
      '',
      '=== TÂCHES KANBAN ===',
      cardsSummary || '(aucune tâche)',
      '',
      'RÈGLES CRUCIALES POUR LES ACTIONS SUR LES NOTES :',
      '- Pour CRÉER une NOUVELLE note : ajoute TOUJOURS en fin de réponse le bloc :',
      '```action:create_note',
      '{ "title": "Titre clair et précis", "content": "Contenu complet en Markdown..." }',
      '```',
      '- Pour AJOUTER ou COMPLÉTER du contenu à une note (active ou désignée par son titre/ID) : ajoute TOUJOURS :',
      '```action:append_note',
      `{ "title": "${noteDraft?.title || ''}", "noteId": "${noteDraft?.noteId || ''}", "content": "Contenu exact à ajouter à la fin de la note..." }`,
      '```',
      '- Pour CORRIGER ou MODIFIER entièrement la note activement ouverte, tu DOIS proposer :',
      '```action:update_note',
      `{ "noteId": "${noteDraft?.noteId || ''}", "title": "${noteDraft?.title || ''}", "content": "Contenu complet corrigé..." }`,
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
      '- Ne dis jamais qu\'une action est indisponible : propose systématiquement le bloc d\'action approprié pour que l\'utilisateur puisse l\'appliquer en 1 clic.',
      '- RÈGLE IMPORTANTE : Lorsque tu ajoutes, crées ou modifies une note, l\'application l\'enregistre directement et automatiquement dans les notes de l\'utilisateur. Tu peux donc lui confirmer clairement que sa note est créée ou mise à jour.',
    ].filter(Boolean).join('\n');
  };

  const parseActionsFromResponse = (
    text: string,
  ): { cleanContent: string; action?: ActionProposal } => {
    const deleteAllCardsMatch = text.match(/\`\`\`action:delete_all_cards\s*([\s\S]*?)\s*\`\`\`/);
    if (deleteAllCardsMatch) {
      try {
        const payload = JSON.parse(deleteAllCardsMatch[1]);
        const cleanContent = text.replace(/\`\`\`action:delete_all_cards[\s\S]*?\`\`\`/, '').trim();
        return { cleanContent, action: { type: 'delete_all_cards', payload } };
      } catch {}
    }

    const updateMatch = text.match(/\`\`\`action:update_note\s*([\s\S]*?)\s*\`\`\`/);
    if (updateMatch) {
      try {
        const payload = JSON.parse(updateMatch[1]);
        const cleanContent = text.replace(/\`\`\`action:update_note[\s\S]*?\`\`\`/, '').trim();
        return { cleanContent, action: { type: 'update_note', payload } };
      } catch {}
    }

    const appendMatch = text.match(/\`\`\`action:append_note\s*([\s\S]*?)\s*\`\`\`/);
    if (appendMatch) {
      try {
        const payload = JSON.parse(appendMatch[1]);
        const cleanContent = text.replace(/\`\`\`action:append_note[\s\S]*?\`\`\`/, '').trim();
        return { cleanContent, action: { type: 'append_note', payload } };
      } catch {}
    }

    const deleteMatch = text.match(/\`\`\`action:delete_note\s*([\s\S]*?)\s*\`\`\`/);
    if (deleteMatch) {
      try {
        const payload = JSON.parse(deleteMatch[1]);
        const cleanContent = text.replace(/\`\`\`action:delete_note[\s\S]*?\`\`\`/, '').trim();
        return { cleanContent, action: { type: 'delete_note', payload } };
      } catch {}
    }

    const noteMatch = text.match(/\`\`\`action:create_note\s*([\s\S]*?)\s*\`\`\`/);
    if (noteMatch) {
      try {
        const payload = JSON.parse(noteMatch[1]);
        const cleanContent = text.replace(/\`\`\`action:create_note[\s\S]*?\`\`\`/, '').trim();
        return { cleanContent, action: { type: 'create_note', payload } };
      } catch {}
    }

    const cardsMatch = text.match(/\`\`\`action:create_cards\s*([\s\S]*?)\s*\`\`\`/);
    if (cardsMatch) {
      try {
        const payload = JSON.parse(cardsMatch[1]);
        const cleanContent = text.replace(/\`\`\`action:create_cards[\s\S]*?\`\`\`/, '').trim();
        return { cleanContent, action: { type: 'create_cards', payload } };
      } catch {}
    }

    return { cleanContent: text };
  };

  const handleSend = async (textToSend = input) => {
    if (!textToSend.trim() || loading) return;

    if (!configured) {
      setShowSettings(true);
      state.toast('info', 'Configure d’abord ton serveur IA (Ollama, LM Studio ou OpenAI).');
      return;
    }

    const userTurn: ChatTurn = {
      id: String(Date.now()),
      role: 'user',
      content: textToSend.trim(),
    };

    const isFirstUserTurn = messages.filter((m) => m.role === 'user').length === 0;
    const shouldUpdateTitle =
      isFirstUserTurn ||
      activeConv?.title.startsWith('Conversation') ||
      activeConv?.title === 'Discussion principale';
    const nextTitle = shouldUpdateTitle ? deriveConversationTitle(textToSend) : activeConv?.title;

    updateActiveMessages((prev) => [...prev, userTurn], nextTitle);
    setInput('');
    setLoading(true);

    try {
      const isCorrectionIntent = /corrig|correct|faute|orthograph|grammair|accent|reformul|amelior|amélior|style/i.test(textToSend);
      const isAppendIntent = /(?:ajoute|rajoute|insère|insere|mets?)\s+(?:dans|à|sur)\s+(?:la|ma|cette)?\s*note/i.test(textToSend);
      const isCreateNoteIntent = /(?:crée|cree|créer|creer|nouvelle\s+note|ajoute\s+une\s+note|rédige\s+une\s+note|prends?\s+note|note\s+que)/i.test(textToSend);

      // Optimisation majeure de rapidité : pour une correction ou ajout de note,
      // on évite l'indexation RAG par embeddings qui provoque un déchargement/rechargement GPU de modèle lourd
      const skipRagEmbeddings = isCorrectionIntent || isAppendIntent || !aiValues.aiEmbeddingModel.trim();

      const rag = await retrieveContextHybrid(notes, textToSend, {
        tags: state.data.tags,
        folders: state.data.folders,
        embeddingConfig: skipRagEmbeddings
          ? undefined
          : {
              endpoint: aiValues.aiEndpoint,
              apiKey: aiValues.aiApiKey,
              model: aiValues.aiEmbeddingModel,
              keepAlive: aiValues.aiKeepAlive,
            },
      });
      setRagMode(rag.mode);

      const historyForAi: ChatMessage[] = [
        {
          role: 'system',
          content: [buildWorkspaceContext(), rag.context].filter(Boolean).join('\n\n'),
        },
        ...messages
          .filter((m) => !m.id.startsWith('welcome'))
          .slice(-10)
          .map((m) => ({ role: m.role, content: sanitizeHistoryContent(m.content) })),
        { role: 'user', content: textToSend },
      ];

      const assistantTurnId = `ai-${Date.now()}`;
      const initialAssistantTurn: ChatTurn = {
        id: assistantTurnId,
        role: 'assistant',
        content: '',
        reasoning: '',
        isStreaming: true,
      };
      updateActiveMessages((prev) => [...prev, initialAssistantTurn]);

      let raw = '';
      let streamedReasoning = '';
      let truncated = false;
      let streamError: Error | null = null;

      try {
        const streamed = await chatStream(aiConfig, historyForAi, {
          temperature: isCorrectionIntent ? 0.1 : 0.7,
          maxTokens: 2048,
          onReasoning: (partialReasoning) => {
            streamedReasoning = partialReasoning;
            updateActiveMessages((prev) =>
              prev.map((t) =>
                t.id === assistantTurnId
                  ? { ...t, reasoning: partialReasoning }
                  : t,
              ),
              undefined,
              false,
            );
          },
          onText: (partialText) => {
            updateActiveMessages((prev) =>
              prev.map((t) =>
                t.id === assistantTurnId
                  ? {
                      ...t,
                      content: partialText.replace(/```action:[a-z_]+[\s\S]*$/, ''),
                    }
                  : t,
              ),
              undefined,
              false,
            );
          },
        });
        raw = streamed.text;
        streamedReasoning = streamed.reasoning;
        truncated = streamed.truncated;
      } catch (err) {
        streamError = err instanceof Error ? err : new Error("La communication avec l'IA a échoué.");
      }

      if (streamError) {
        updateActiveMessages((prev) =>
          prev.map((t) =>
            t.id === assistantTurnId
              ? {
                  ...t,
                  content: `⚠️ **Erreur** : ${streamError!.message}\n\n*Astuce : clique sur « Paramètres IA » en haut à droite pour vérifier la configuration.*`,
                  isStreaming: false,
                }
              : t,
          ),
        );
        return;
      }

      const parsed = parseActionsFromResponse(raw);
      const wantsDeleteAllCards = isDeleteAllCardsRequest(textToSend);
      const activeDraft = useAppStore.getState().ui.noteDraft;

      let action = parsed.action;
      const cleanContent = parsed.cleanContent;

      if (wantsDeleteAllCards) {
        action = {
          type: 'delete_all_cards' as const,
          payload: { count: cards.length },
        };
      } else if (isCorrectionIntent && activeDraft?.noteId && (!action || action.type === 'create_note')) {
        action = {
          type: 'update_note' as const,
          payload: {
            noteId: activeDraft.noteId,
            title: activeDraft.title,
            content: action?.payload?.content || cleanContent,
          },
        };
      } else if (!action) {
        if (isAppendIntent && (activeDraft?.noteId || notes.length > 0)) {
          const targetNote = notes.find((n) =>
            n.title && n.title.trim().length > 2 && textToSend.toLowerCase().includes(n.title.toLowerCase()),
          ) || (activeDraft?.noteId ? notes.find(n => n.id === activeDraft.noteId) : notes[0]);

          if (targetNote) {
            action = {
              type: 'append_note' as const,
              payload: {
                noteId: targetNote.id,
                title: targetNote.title,
                content: cleanContent,
              },
            };
          }
        } else if (isCreateNoteIntent) {
          const firstHeading = cleanContent.match(/^#\s+(.+)$/m);
          const derivedTitle = firstHeading
            ? firstHeading[1].trim()
            : textToSend.replace(/(?:crée|cree|créer|creer|nouvelle\s+note|ajoute\s+une\s+note|rédige\s+une\s+note|prends?\s+note|note\s+que|pour|de|d'|d’)\s*/gi, '').trim().slice(0, 40) || 'Note IA';

          action = {
            type: 'create_note' as const,
            payload: {
              title: derivedTitle,
              content: cleanContent,
            },
          };
        }
      }

      // Exécution automatique immédiate pour la création / modification de note
      if (action && (action.type === 'create_note' || action.type === 'append_note' || action.type === 'update_note')) {
        action = executeActionDirectly(action);
      }

      const finalContent = [cleanContent, truncated ? '\n\n_— réponse coupée, contenu partiel —_' : ''].join('');
      updateActiveMessages((prev) =>
        prev.map((t) =>
          t.id === assistantTurnId
            ? {
                ...t,
                content: finalContent,
                reasoning: streamedReasoning,
                action,
                isStreaming: false,
              }
            : t,
        ),
      );
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'La communication avec l\'IA a échoué.';
      const errorTurn: ChatTurn = {
        id: String(Date.now() + 1),
        role: 'assistant',
        content: `⚠️ **Erreur** : ${errorMsg}\n\n*Astuce : clique sur « Paramètres IA » en haut à droite pour vérifier la configuration.*`,
      };
      updateActiveMessages((prev) => [...prev, errorTurn]);
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
      // Suppression = action destructive : on n'accepte QUE l'identifiant
      // exact ou le titre exact. Une correspondance approximative pouvait
      // viser une note homonyme et la supprimer par erreur.
      const targetNote = notes.find(
        (n) =>
          (action.payload?.id && n.id === action.payload.id) ||
          (targetTitle !== '' && n.title.toLowerCase().trim() === targetTitle),
      );
      const ambiguous =
        targetTitle !== '' &&
        notes.filter((n) => n.title.toLowerCase().trim() === targetTitle).length > 1;
      if (ambiguous) {
        state.toast('error', 'Plusieurs notes portent ce titre : supprime-la manuellement.');
      } else if (targetNote) {
        state.deleteNote(targetNote.id);
        state.toast('info', `Note « ${targetNote.title} » supprimée !`);
      } else {
        state.toast('error', 'Note introuvable : aucune suppression effectuée.');
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
        state.toast('success', `Ajouté à la note « ${targetNote.title} » !`);
      } else {
        const newId = state.createNote({
          title: title || 'Nouvelle note',
          content: String(content || '').trim(),
        });
        state.openNote(newId);
        state.toast('success', `Note « ${title || 'Nouvelle note'} » créée avec le contenu !`);
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
        state.toast('success', `Note « ${targetNote.title} » mise à jour avec succès !`);
      } else {
        state.toast('error', 'Aucune note correspondante à mettre à jour.');
      }
    } else if (action.type === 'create_note') {
      const { title, content } = action.payload;
      const noteId = state.createNote({
        title: title || 'Note IA',
        content: content || '',
      });
      state.openNote(noteId);
      state.toast('success', `Note « ${title || 'Note IA'} » créée !`);
    } else if (action.type === 'create_cards') {
      const { columnTitle, cards: newCards } = action.payload;
      let col = columns.find(
        (c) => c.title.toLowerCase() === String(columnTitle || '').toLowerCase(),
      );
      if (!col) col = columns[0];
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
        state.toast('success', `${newCards.length} tâche(s) ajoutée(s) au Kanban !`);
      }
    }

    updateActiveMessages((prev) =>
      prev.map((t) =>
        t.id === turnId && t.action ? { ...t, action: { ...t.action, executed: true } } : t,
      ),
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  return (
    <div className="flex h-full bg-zinc-50 dark:bg-zinc-950">
      {/* ------------------- Volet latéral Conversations ------------------- */}
      {sidebarOpen && (
        <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-200 bg-zinc-100/80 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/60">
          <div className="flex h-14 items-center justify-between border-b border-zinc-200/80 px-3.5 dark:border-zinc-800/80">
            <span className="flex items-center gap-2 text-xs font-bold text-zinc-700 dark:text-zinc-300">
              <MessageSquare size={15} className="text-indigo-600 dark:text-indigo-400" />
              Conversations
            </span>
            <Button
              size="sm"
              variant="primary"
              className="h-7 px-2 text-xs"
              icon={<Plus size={13} />}
              onClick={handleNewConversation}
              title="Nouvelle conversation"
            >
              Nouveau
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {conversations.map((conv) => {
              const isActive = conv.id === activeConvId;
              return (
                <div
                  key={conv.id}
                  onClick={() => setActiveConvId(conv.id)}
                  className={cn(
                    'group flex cursor-pointer items-center justify-between rounded-xl px-2.5 py-2 text-xs transition-all',
                    isActive
                      ? 'bg-white font-semibold text-indigo-900 shadow-sm dark:bg-zinc-800 dark:text-indigo-200'
                      : 'text-zinc-600 hover:bg-zinc-200/60 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-zinc-200',
                  )}
                >
                  <div className="min-w-0 flex-1 pr-1.5">
                    <p className="truncate">{conv.title}</p>
                    <p className="text-[10px] font-normal text-zinc-400 dark:text-zinc-500">
                      {formatTime(conv.updatedAt)} · {conv.messages.filter((m) => m.role === 'user').length} msg
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => handleDeleteConversation(conv.id, e)}
                    className="opacity-0 transition-opacity group-hover:opacity-100 p-1 text-zinc-400 hover:text-red-500 dark:text-zinc-500 dark:hover:text-red-400"
                    title="Supprimer cette conversation"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        </aside>
      )}

      {/* ------------------------- Zone Principale ------------------------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* ----------------------------- En-tête ----------------------------- */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-200 bg-white/80 px-4 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/80">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSidebarOpen((v) => !v)}
              className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              title={sidebarOpen ? 'Masquer les conversations' : 'Afficher les conversations'}
            >
              {sidebarOpen ? <PanelLeftClose size={17} /> : <PanelLeft size={17} />}
            </button>

            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-600 to-indigo-500 text-white shadow-md shadow-indigo-500/20">
              <Sparkles size={17} />
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-bold tracking-tight text-zinc-900 dark:text-zinc-100 truncate max-w-[200px] sm:max-w-xs">
                  {activeConv?.title || 'SIA'}
                </h1>
                <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-[10px] font-semibold text-indigo-600 dark:bg-indigo-400/10 dark:text-indigo-300">
                  Copilote IA
                </span>
              </div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                {configured ? `Modèle : ${settings.aiModel}` : 'Non configuré'}
                {configured && (
                  <span className="ml-1.5 font-medium text-zinc-400 dark:text-zinc-500">
                    · RAG {ragMode === 'hybrid' ? 'sémantique & mots-clés' : 'mots-clés'}
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {noteDraft?.noteId && (
              <div className="hidden items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50/50 px-2.5 py-1 text-xs text-indigo-700 dark:border-indigo-900/50 dark:bg-indigo-950/40 dark:text-indigo-300 sm:flex">
                <FileEdit size={13} />
                <span className="max-w-[140px] truncate">Note active : {noteDraft.title || 'Sans titre'}</span>
              </div>
            )}
            <Button
              size="sm"
              variant="ghost"
              icon={<Settings2 size={14} />}
              onClick={() => setShowSettings((v) => !v)}
            >
              Paramètres IA
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<RotateCcw size={14} />}
              onClick={handleNewConversation}
              title="Créer une nouvelle conversation"
            >
              Nouveau chat
            </Button>
          </div>
        </header>

        {/* --------------------------- Panneau réglages IA ----------------------- */}
        {showSettings && (
          <div className="border-b border-indigo-200 bg-indigo-50/60 p-4 dark:border-indigo-900/60 dark:bg-indigo-950/40">
            <div className="mx-auto max-w-2xl">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-indigo-900 dark:text-indigo-200">
                  Configuration de l’IA (Ollama, LM Studio, OpenAI…)
                </span>
                <button
                  type="button"
                  className="text-xs text-indigo-600 hover:underline dark:text-indigo-400"
                  onClick={() => setShowSettings(false)}
                >
                  Masquer
                </button>
              </div>
              <AiSettingsFields
                values={aiValues}
                onChange={(patch) => updateSettings(patch)}
              />
            </div>
          </div>
        )}

        {/* ------------------------ Flux de conversation ------------------------ */}
        <div className="flex-1 overflow-y-auto px-4 py-6">
          <div className="mx-auto max-w-3xl space-y-6">
            {messages.length === 1 && (
              <div className="my-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {HERO_PROMPTS.map((item, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => void handleSend(item.prompt)}
                    className="flex flex-col items-start rounded-2xl border border-zinc-200/80 bg-white p-4 text-left shadow-sm transition-all hover:border-indigo-300 hover:shadow-md hover:shadow-indigo-500/5 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-indigo-700"
                  >
                    <div className="mb-2.5 rounded-xl bg-zinc-100 p-2 dark:bg-zinc-800">
                      {item.icon}
                    </div>
                    <h3 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                      {item.title}
                    </h3>
                    <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                      {item.desc}
                    </p>
                  </button>
                ))}
              </div>
            )}

            {messages.map((turn) => (
              <div
                key={turn.id}
                className={cn(
                  'flex flex-col gap-1.5',
                  turn.role === 'user' ? 'items-end' : 'items-start',
                )}
              >
                <div className="flex items-center gap-1.5 px-1 text-[11px] font-semibold text-zinc-400 dark:text-zinc-500">
                  {turn.role === 'user' ? (
                    <>
                      <span>Vous</span>
                      <User size={12} />
                    </>
                  ) : (
                    <>
                      <Bot size={12} className="text-indigo-500" />
                      <span>SIA</span>
                    </>
                  )}
                </div>

                <div
                  className={cn(
                    'rounded-2xl px-5 py-3.5 text-sm leading-relaxed shadow-sm',
                    turn.role === 'user'
                      ? 'max-w-[85%] bg-indigo-600 text-white shadow-indigo-600/10'
                      : 'max-w-[95%] border border-zinc-200 bg-white text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200',
                  )}
                >
                  {turn.role === 'user' ? (
                    <p className="whitespace-pre-wrap">{turn.content}</p>
                  ) : (
                    <div>
                      {turn.role === 'assistant' && (turn.reasoning || (turn.isStreaming && !turn.content)) && (
                        <ReasoningBlock
                          reasoning={turn.reasoning || ''}
                          isStreaming={turn.isStreaming && !turn.content}
                        />
                      )}
                      {turn.content ? (
                        <div>
                          <MarkdownRenderer markdown={turn.content} />
                          {turn.isStreaming && (
                            <span className="inline-block animate-pulse text-indigo-500 font-mono text-sm ml-0.5">▋</span>
                          )}
                        </div>
                      ) : turn.isStreaming ? (
                        <div className="flex items-center gap-2 text-xs text-zinc-400 py-1">
                          <Loader2 size={14} className="animate-spin text-indigo-500" />
                          <span>Le Copilote prépare sa réponse…</span>
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>

                {/* Carte d'action 1-clic */}
                {turn.action && (
                  <div className={cn(
                    'mt-1.5 w-full max-w-lg rounded-xl border p-3.5 shadow-sm transition-all',
                    turn.action.executed
                      ? 'border-emerald-500/40 bg-emerald-50/70 dark:border-emerald-500/30 dark:bg-emerald-950/40'
                      : 'border-indigo-200/90 bg-indigo-50/70 dark:border-indigo-900/70 dark:bg-indigo-950/50',
                  )}>
                    <div className={cn(
                      'mb-2.5 flex items-center justify-between text-xs font-semibold',
                      turn.action.executed ? 'text-emerald-950 dark:text-emerald-200' : 'text-indigo-950 dark:text-indigo-200',
                    )}>
                      <span className="inline-flex items-center gap-2">
                        {turn.action.executed ? (
                          <Check size={15} className="text-emerald-600 dark:text-emerald-400" />
                        ) : turn.action.type === 'create_note' ? (
                          <StickyNote size={15} className="text-indigo-600" />
                        ) : turn.action.type === 'append_note' ? (
                          <StickyNote size={15} className="text-emerald-600" />
                        ) : turn.action.type === 'update_note' ? (
                          <Pencil size={15} className="text-indigo-600" />
                        ) : turn.action.type === 'delete_note' ||
                          turn.action.type === 'delete_all_cards' ? (
                          <Trash2 size={15} className="text-red-500" />
                        ) : (
                          <SquareKanban size={15} className="text-indigo-600" />
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
                          }}
                        >
                          Ouvrir la note dans l’éditeur
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" className="w-full text-xs" disabled icon={<Check size={13} />}>
                          Action enregistrée dans votre espace
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
                        className="w-full text-xs font-medium"
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

            {loading && !messages.some((m) => m.isStreaming) && (
              <div className="flex items-center gap-2 text-xs font-medium text-indigo-600 dark:text-indigo-400">
                <Loader2 size={16} className="animate-spin" />
                <span>Le Copilote réfléchit et prépare sa réponse…</span>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* ------------------------- Zone de saisie -------------------------- */}
        <div className="shrink-0 border-t border-zinc-200 bg-white/90 p-4 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/90">
          <div className="mx-auto max-w-3xl">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleSend();
              }}
              className="relative flex items-end rounded-2xl border border-zinc-200 bg-zinc-50 p-2 shadow-inner transition-all focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-950"
            >
              <textarea
                ref={textareaRef}
                rows={2}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Posez une question, demandez une note, des tâches Kanban, ou une correction..."
                className="max-h-40 min-h-[48px] flex-1 resize-none bg-transparent px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none dark:text-zinc-100 dark:placeholder:text-zinc-500"
              />
              <div className="flex items-center gap-1.5 pb-1 pr-1">
                <Button
                  type="submit"
                  size="sm"
                  variant="primary"
                  disabled={!input.trim() || loading}
                  icon={loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                >
                  Envoyer
                </Button>
              </div>
            </form>
            <div className="mt-2 flex items-center justify-between text-[11px] text-zinc-400 dark:text-zinc-500">
              <span><kbd className="font-mono">Entrée</kbd> pour envoyer · <kbd className="font-mono">Maj + Entrée</kbd> pour un saut de ligne</span>
              <span>Raccourci Copilote : <kbd className="font-mono">Ctrl + 3</kbd></span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
