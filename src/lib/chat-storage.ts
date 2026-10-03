/**
 * Persistance des conversations du Copilote IA (SIA).
 * Permet de conserver plusieurs conversations distinctes dans localStorage,
 * de basculer de l'une à l'autre sans perte d'historique ni de lien contextuel,
 * et de préserver les échanges même après rechargement ou changement de vue.
 */
import { STORAGE_KEYS } from '@/constants';
import { accountStorageKey, getBrowserUser } from '@/lib/browser-user';
import type { ActionProposal } from '@/components/ai/AiChatDrawer';

export interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  isStreaming?: boolean;
  action?: ActionProposal;
}

export interface ChatConversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatTurn[];
}

export const INITIAL_WELCOME_CONTENT =
  '👋 Salut ! Je suis **SIA**, ton assistante IA personnelle et copilote de productivité.\n\nJe suis directement connectée à toutes tes **notes**, tes **tâches Kanban** et ta **note active**.\n\nPose-moi une question, demande-moi de rédiger, d’ajouter à une note, de corriger ou de planifier tes actions !';

export function createNewConversation(title = 'Nouvelle conversation', welcome = INITIAL_WELCOME_CONTENT): ChatConversation {
  const now = Date.now();
  return {
    id: `conv_${now}_${Math.random().toString(36).slice(2, 7)}`,
    title,
    createdAt: now,
    updatedAt: now,
    messages: [
      {
        id: `welcome_${now}`,
        role: 'assistant',
        content: welcome,
      },
    ],
  };
}

export function loadSavedConversations(): ChatConversation[] {
  if (typeof window === 'undefined') return [];
  const key = accountStorageKey(STORAGE_KEYS.chat);
  if (!key) return [];
  try {
    // Reprise de l'historique antérieur uniquement pour son propriétaire.
    let raw = window.localStorage.getItem(key);
    if (raw === null && getBrowserUser()?.legacyOwner) {
      raw = window.localStorage.getItem(STORAGE_KEYS.chat);
      if (raw !== null) {
        window.localStorage.setItem(key, raw);
        window.localStorage.removeItem(STORAGE_KEYS.chat);
      }
    }
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed
        .map((c) => ({
          id: String(c.id || ''),
          title: String(c.title || 'Conversation'),
          createdAt: Number(c.createdAt || Date.now()),
          updatedAt: Number(c.updatedAt || Date.now()),
          messages: Array.isArray(c.messages) && c.messages.length > 0
            ? c.messages
            : [{ id: 'welcome', role: 'assistant' as const, content: INITIAL_WELCOME_CONTENT }],
        }))
        .filter((c) => c.id !== '');
    }
  } catch (err) {
    console.error('[chat-storage] Erreur lors de la lecture des conversations :', err);
  }
  return [];
}

export function saveConversationsToStorage(conversations: ChatConversation[]): void {
  if (typeof window === 'undefined') return;
  const key = accountStorageKey(STORAGE_KEYS.chat);
  if (!key) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(conversations));
  } catch (err) {
    console.error('[chat-storage] Erreur lors de la sauvegarde des conversations :', err);
  }
}

export function loadActiveConversationId(): string | null {
  if (typeof window === 'undefined') return null;
  const key = accountStorageKey(STORAGE_KEYS.activeChat);
  if (!key) return null;
  try {
    let id = window.localStorage.getItem(key);
    if (id === null && getBrowserUser()?.legacyOwner) {
      id = window.localStorage.getItem(STORAGE_KEYS.activeChat);
      if (id !== null) {
        window.localStorage.setItem(key, id);
        window.localStorage.removeItem(STORAGE_KEYS.activeChat);
      }
    }
    return id;
  } catch {
    return null;
  }
}

export function saveActiveConversationId(id: string): void {
  if (typeof window === 'undefined') return;
  const key = accountStorageKey(STORAGE_KEYS.activeChat);
  if (!key) return;
  try {
    window.localStorage.setItem(key, id);
  } catch {}
}

/** Génère un titre court et parlant à partir du premier message utilisateur. */
export function deriveConversationTitle(userPrompt: string): string {
  const cleaned = userPrompt
    .replace(/^[\s\r\n]+|[\s\r\n]+$/g, '')
    .replace(/^(?:peux-tu|pourrais-tu|stp|s'il te plaît|sil te plait|merci de|veuillez|salut|bonjour)\s+/i, '')
    .trim();
  if (!cleaned) return 'Nouvelle conversation';
  const firstLine = cleaned.split('\n')[0].trim();
  if (firstLine.length <= 36) return firstLine;
  return firstLine.slice(0, 35).trim() + '…';
}
