/**
 * IA — client « chat completions » compatible OpenAI.
 *
 * Fonctionne avec tout endpoint exposant `/chat/completions` :
 * OpenAI, OpenRouter, Groq, Ollama (http://localhost:11434/v1)…
 * Les fonctions de construction de prompt sont pures (testées au smoke) ;
 * `chatComplete` est l'unique point d'accès réseau.
 */

import type { AppSettings } from '@/types';
import { DEFAULT_SETTINGS } from '@/constants';

export interface AiConfig {
  endpoint: string;
  apiKey: string;
  model: string;
  keepAlive?: string | number;
}

/**
 * Résout la configuration réellement utilisable : une valeur utilisateur non
 * vide reste prioritaire, sinon on reprend la valeur injectée au build. Cela
 * couvre aussi les coffres anciens contenant explicitement des chaînes vides.
 */
export function resolveAiSettings(settings: Partial<AppSettings>): {
  aiEndpoint: string;
  aiApiKey: string;
  aiModel: string;
  aiEmbeddingModel: string;
  aiKeepAlive: string;
} {
  const valueOrDefault = (value: unknown, fallback: string): string =>
    typeof value === 'string' && value.trim() !== '' ? value : fallback;
  const endpoint = valueOrDefault(settings.aiEndpoint, DEFAULT_SETTINGS.aiEndpoint);
  return {
    aiEndpoint:
      endpoint === 'http://192.168.1.47:11434/v1' && DEFAULT_SETTINGS.aiEndpoint !== ''
        ? DEFAULT_SETTINGS.aiEndpoint
        : endpoint,
    aiApiKey: typeof settings.aiApiKey === 'string' ? settings.aiApiKey : '',
    aiModel: valueOrDefault(settings.aiModel, DEFAULT_SETTINGS.aiModel),
    aiEmbeddingModel: valueOrDefault(
      settings.aiEmbeddingModel,
      DEFAULT_SETTINGS.aiEmbeddingModel,
    ),
    aiKeepAlive: valueOrDefault(settings.aiKeepAlive, DEFAULT_SETTINGS.aiKeepAlive ?? '-1'),
  };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  /** Activer ou désactiver la réflexion interne (ex: qwen3.8). false par défaut pour la vitesse de correction. */
  think?: boolean;
  /** Durée de vie maximale de la requête (ms). Défaut 90 s. */
  timeoutMs?: number;
  /** Signal d'annulation optionnel. */
  signal?: AbortSignal;
}

/** Tolère un champ absent/undefined (état ancien) — ne peut pas lever. */
function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** L'IA est utilisable dès qu'un endpoint ET un modèle sont renseignés. */
export function isAiConfigured(config: AiConfig): boolean {
  return asText(config.endpoint).trim() !== '' && asText(config.model).trim() !== '';
}

/**
 * Normalise l'endpoint : espace(s) de fin retirés, barre oblique finale
 * retirée, et `/v1` ajouté s'il manque (Ollama, OpenAI, OpenRouter…).
 */
export function normalizeEndpoint(endpoint: string): string {
  let base = asText(endpoint).trim().replace(/\/+$/, '');
  if (base !== '' && !/\/v\d+$/.test(base) && !/\/api\/v\d+\/ai$/.test(base)) {
    base += '/v1';
  }
  return base;
}

/** Vecteurs gardés en mémoire uniquement (jamais persistés en clair). */
const embeddingCache = new Map<string, number[]>();
const MAX_EMBEDDING_CACHE = 1200;

/** Hash rapide et déterministe pour la clé du cache (pas un usage sécurité). */
function embeddingCacheKey(config: AiConfig, text: string): string {
  let hash = 2166136261;
  const value = `${normalizeEndpoint(config.endpoint)}\u0000${config.model}\u0000${text}`;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${hash >>> 0}:${text.length}`;
}

/**
 * Calcule des embeddings via l'API OpenAI-compatible `/v1/embeddings`.
 * Fonctionne notamment avec Ollama + `qwen3-embedding:0.6b-8k`.
 * Les textes déjà vus sont servis depuis un cache mémoire borné.
 */
export async function embedTexts(
  config: AiConfig,
  texts: string[],
  options: { timeoutMs?: number; batchSize?: number } = {},
): Promise<number[][]> {
  if (!isAiConfigured(config)) {
    throw new Error('Embeddings non configurés (endpoint et modèle requis)');
  }
  if (texts.length === 0) return [];

  const result: Array<number[] | undefined> = new Array(texts.length);
  const missing: Array<{ index: number; text: string; key: string }> = [];
  texts.forEach((text, index) => {
    const key = embeddingCacheKey(config, text);
    const cached = embeddingCache.get(key);
    if (cached) result[index] = cached;
    else missing.push({ index, text, key });
  });

  const batchSize = Math.max(1, options.batchSize ?? 24);
  const key = asText(config.apiKey).trim();
  const normalizedEndpoint = normalizeEndpoint(config.endpoint);
  const url = `${normalizedEndpoint}/embeddings`;
  const keepAliveVal = config.keepAlive ?? '-1';
  const parsedKeepAlive = /^-?\d+$/.test(String(keepAliveVal)) ? Number(keepAliveVal) : keepAliveVal;

  for (let start = 0; start < missing.length; start += batchSize) {
    const batch = missing.slice(start, start + batchSize);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs ?? 120000);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(key !== '' ? { Authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify({
          model: asText(config.model).trim(),
          input: batch.map((item) => item.text),
          ...(parsedKeepAlive !== undefined ? { keep_alive: parsedKeepAlive } : {}),
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 300);
        throw new Error(`Embeddings HTTP ${response.status}${detail ? ` — ${detail}` : ''}`);
      }
      const payload = await response.json() as {
        data?: Array<{ index?: number; embedding?: unknown }>;
      };
      if (!Array.isArray(payload.data) || payload.data.length !== batch.length) {
        throw new Error('Réponse embeddings invalide ou incomplète');
      }
      // Certains serveurs trient par index, d'autres conservent simplement
      // l'ordre : les deux formats sont acceptés.
      payload.data.forEach((item, position) => {
        const target = batch[item.index ?? position];
        if (!target || !Array.isArray(item.embedding)) {
          throw new Error('Vecteur embedding manquant dans la réponse');
        }
        const vector = item.embedding.map(Number);
        if (vector.length === 0 || vector.some((n) => !Number.isFinite(n))) {
          throw new Error('Vecteur embedding invalide');
        }
        result[target.index] = vector;
        embeddingCache.set(target.key, vector);
      });
      while (embeddingCache.size > MAX_EMBEDDING_CACHE) {
        const oldest = embeddingCache.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        embeddingCache.delete(oldest);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error('Le calcul des embeddings a expiré');
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  if (result.some((vector) => vector === undefined)) {
    throw new Error('Certains embeddings n’ont pas été calculés');
  }
  return result as number[][];
}

/** Vide le cache mémoire, utile après un changement de modèle/endpoint. */
export function clearEmbeddingCache(): void {
  embeddingCache.clear();
}

/**
 * Retire la clôture ```markdown … ``` si le modèle a emboîté la réponse
 * dans un bloc de code (comportement courant avec GPT).
 */
export function unwrapFences(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```[a-zA-Z0-9+-]*[ \t]*\r?\n([\s\S]*)\r?\n```\s*$/);
  return match !== null ? match[1].trim() : trimmed;
}

const ACTION_BLOCK_RE = /```action:[a-z_]+\s*[\s\S]*?```/g;

/**
 * Nettoie un message d'historique avant de le renvoyer au modèle :
 *  - les blocs ```action:…``` sont retirés — leur JSON (contenu complet de
 *    notes) a servi à l'action 1-clic et ne sert à rien dans le contexte ;
 *  - la longueur est bornée pour ne pas gonfler le préfill des petits
 *    modèles locaux (un 9B perd 1-3 s par 1000 tokens de préfill inutile).
 */
export function sanitizeHistoryContent(content: string, maxChars = 2000): string {
  let out = content.replace(ACTION_BLOCK_RE, '').trim();
  if (out.length > maxChars) out = `${out.slice(0, maxChars)}…`;
  return out;
}

/**
 * Retire le raisonnement interne des modèles « thinking » (Qwen, DeepSeek-R1,
 * QwQ…), qui exposent leur délibération dans la réponse au lieu d'un champ
 * séparé. Gère aussi le cas d'un bloc <think> jamais refermé (réponse tronquée
 * par une limite de tokens).
 */
export function stripReasoning(text: string): string {
  let out = text.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '');

  // Bloc ouvert mais non refermé : tout ce qui suit est du raisonnement.
  const dangling = out.search(/<think(?:ing)?>/i);
  if (dangling !== -1) out = out.slice(0, dangling);

  // Balise fermante orpheline : le raisonnement précède la réponse.
  const closing = out.match(/<\/think(?:ing)?>/i);
  if (closing?.index !== undefined) {
    out = out.slice(closing.index + closing[0].length);
  }

  return out.trim();
}

const NOTE_SYSTEM_PROMPT = [
  "Tu es l'assistant de rédaction de MansotNote, une application de prise de notes personnelle.",
  'Tu rédiges des notes claires, concrètes et bien structurées en Markdown.',
  'Règles strictes :',
  '- Réponds UNIQUEMENT avec le Markdown de la note : aucun commentaire, aucun préambule.',
  '- N\'entoure jamais la réponse d\'un bloc ```markdown.',
  '- Structure : un titre de niveau 1 si pertinent, des sous-titres, des listes, du gras pour les points clés, des tableaux quand c\'est utile.',
  '- Écris dans la langue du prompt (français par défaut).',
  '- IMPORTANT : Ne produis AUCUNE réflexion interne, aucune balise <think>, aucun commentaire. Réponds UNIQUEMENT avec le contenu de la note.',
].join('\n');

/** Construit le message « user » pour la génération d'une nouvelle note. */
export function buildNotePrompt(title: string, prompt: string): string {
  const titlePart =
    title.trim() === '' ? '' : `Titre souhaité pour la note : « ${title.trim()} »\n\n`;
  return `${titlePart}Rédige la note suivante à partir de cette demande :\n${prompt.trim()}`;
}

export type AiTransformAction = 'resume' | 'rewrite' | 'translate' | 'correct' | 'style';

const TRANSFORM_PROMPTS: Record<AiTransformAction, string> = {
  resume:
    'Résume la note ci-dessous en 5 points clés maximum, sans perdre le sens. Markdown, aucun préambule.',
  rewrite:
    'Reformule la note ci-dessous pour la rendre plus claire et plus fluide, sans changer le fond. Markdown, aucun préambule.',
  translate:
    'Traduis la note ci-dessous : en anglais si elle est en français, en français sinon. Garde la structure Markdown. Aucun préambule.',
  correct:
    'Tu es un correcteur orthographique et grammatical expert. Corrige UNIQUEMENT les fautes d\'orthographe, de grammaire, d\'accords, de conjugaison, de typographie et de ponctuation du texte ci-dessous. Ne change ni le sens, ni le vocabulaire, ni la structure. Conserve STRICTEMENT la syntaxe Markdown (listes, titres, liens, blocs). IMPORTANT : Ne produis aucune réflexion interne ni balise <think>. Ne traduis pas, ne résume pas, n\'ajoute aucun commentaire, aucun préambule ni bloc englobant. Réponds DIRECTEMENT par le texte corrigé. Si le texte ne contient aucune faute, renvoie-le strictement à l\'identique.',
  style:
    'Améliore le style et la fluidité de la note ci-dessous tout en conservant son sens exact et sa structure Markdown. Aucun commentaire, aucun préambule.',
};

/** Construit le message « user » pour une transformation de note existante. */
export function buildTransformPrompt(action: AiTransformAction, content: string): string {
  return `${TRANSFORM_PROMPTS[action]}\n\nNote :\n${content.trim()}`;
}

/**
 * Appel l'endpoint et retourne le texte de la réponse.
 * Lève une Error lisible (statut + extrait du corps) en cas d'échec.
 */
export async function chatComplete(
  config: AiConfig,
  messages: ChatMessage[],
  options: ChatOptions = {},
): Promise<string> {
  if (!isAiConfigured(config)) {
    throw new Error('IA non configurée (endpoint et modèle requis)');
  }
  const normalizedEndpoint = normalizeEndpoint(config.endpoint);
  const url = /\/api\/v\d+\/ai$/.test(normalizedEndpoint)
    ? `${normalizedEndpoint}/chat`
    : `${normalizedEndpoint}/chat/completions`;
  const key = asText(config.apiKey).trim();
  const keepAliveVal = config.keepAlive ?? '-1';
  const parsedKeepAlive = /^-?\d+$/.test(String(keepAliveVal)) ? Number(keepAliveVal) : keepAliveVal;
  const body = JSON.stringify({
    model: asText(config.model).trim(),
    messages,
    temperature: options.temperature ?? 0.7,
   ...(options.think !== undefined ? { think: options.think } : {}),
   ...(options.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
    ...(parsedKeepAlive !== undefined ? { keep_alive: parsedKeepAlive } : {}),
 });
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs ?? 180000);
  if (options.signal) {
    options.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  try {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(key !== '' ? { Authorization: `Bearer ${key}` } : {}),
        },
        body,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof TypeError) {
        // Blocage CORS / réseau (cas typique : LM Studio, qui ne répond
        // pas aux préflights OPTIONS). On retente en requête « simple » :
        // aucun en-tête personnalisé, Content-Type text/plain — le serveur
        // parse le corps JSON quand même, et sans préflight il n'y a pas
        // de CORS.
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
          body,
          signal: controller.signal,
        });
      } else {
        throw error;
      }
    }
    if (!response.ok) {
      const raw = await response.text().catch(() => '');
      let detail = '';
      try {
        const errJson = JSON.parse(raw);
        detail = errJson.error?.message || errJson.message || errJson.detail || '';
      } catch {
        detail = raw.slice(0, 200).trim();
      }
      throw new Error(
        `Erreur IA (${response.status} ${response.statusText})${detail !== '' ? ` : ${detail}` : ''}`,
      );
    }
    const payload = (await response.json().catch(() => null)) as {
      choices?: Array<{
        message?: { content?: string; refusal?: string; reasoning_content?: string };
        text?: string;
      }>;
      error?: { message?: string };
    } | null;

    if (payload?.error?.message) {
      throw new Error(`Erreur serveur IA : ${payload.error.message}`);
    }

    const firstChoice = payload?.choices?.[0];
    if (firstChoice?.message?.refusal) {
      throw new Error(`Le modèle a refusé la demande : ${firstChoice.message.refusal}`);
    }

    const content = firstChoice?.message?.content ?? firstChoice?.text;
    if (typeof content !== 'string' || content.trim() === '') {
      throw new Error('L\'IA a renvoyé une réponse vide ou inattendue');
    }

    // Modèles de raisonnement (Qwen, DeepSeek-R1, LM Studio…) : le champ
    // `reasoning_content` est ignoré, et les blocs <think> inline sont retirés
    // pour ne conserver que la réponse finale.
    const cleaned = stripReasoning(content);
    if (cleaned === '') {
      throw new Error(
        "Le modèle n'a produit que du raisonnement, sans réponse finale. Réessaie ou choisis un modèle non-raisonnant.",
      );
    }
    return unwrapFences(cleaned);
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(
        "L'IA a mis trop de temps à répondre (> 3 min). Vérifie que ton serveur IA (Ollama / LM Studio / OpenAI) est actif et que le modèle sélectionné est bien chargé.",
      );
    }
    if (error instanceof TypeError) {
      throw new Error(
        "Connexion impossible au serveur IA (CORS ou réseau). Vérifie qu'il tourne et que l'URL est exacte (ex. http://localhost:1234/v1 pour LM Studio ou http://localhost:11434/v1 pour Ollama).",
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function isAbortError(error: unknown): boolean {
  return (
    typeof DOMException !== 'undefined' &&
    error instanceof DOMException &&
    error.name === 'AbortError'
  );
}

/** Résultat d'un streaming : texte final nettoyé + drapeau de coupure. */
export interface ChatStreamResult {
  text: string;
  /** Texte de réflexion interne / raisonnement capturé en direct. */
  reasoning: string;
  /** true si le flux s'est interrompu après réception d'un contenu partiel. */
  truncated: boolean;
}

export interface ChatStreamOptions extends ChatOptions {
  onText?: (text: string) => void;
  onReasoning?: (reasoning: string) => void;
}

export interface ReasoningExtraction {
  reasoning: string;
  content: string;
  isThinking: boolean;
}

/** Extrait le raisonnement inline (<think>...</think>) et le contenu utile d'un flux. */
export function extractReasoningAndContent(raw: string): ReasoningExtraction {
  const thinkMatch = raw.match(/<think(?:ing)?>([\s\S]*?)(?:<\/think(?:ing)?>|$)/i);
  if (!thinkMatch) {
    return { reasoning: '', content: raw, isThinking: false };
  }
  const hasClosing = /<\/think(?:ing)?>/i.test(raw);
  const reasoning = thinkMatch[1] ?? '';
  let content = '';
  if (hasClosing) {
    content = raw.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').trimStart();
  }
  return { reasoning, content, isThinking: !hasClosing };
}

/**
 * Version streaming de `chatComplete` (SSE `data: {choices:[{delta}]}` +
 * `[DONE]`, comme `/chat/completions` OpenAI et le relais serveur).
 *
 * `onText` reçoit le texte accumulé à chaque delta pour affichage incrémental.
 * Le texte final renvoyé est nettoyé (stripReasoning + unwrapFences), identique
 * à ce que produit `chatComplete` en mode complet. Si le flux casse alors
 * qu'une partie du texte est déjà arrivée, on la renvoie avec `truncated`
 * plutôt que de jeter tout le travail du modèle.
 */
export async function chatStream(
  config: AiConfig,
  messages: ChatMessage[],
  options: ChatStreamOptions = {},
): Promise<ChatStreamResult> {
  if (!isAiConfigured(config)) {
    throw new Error('IA non configurée (endpoint et modèle requis)');
  }
  const normalizedEndpoint = normalizeEndpoint(config.endpoint);
  const url = /\/api\/v\d+\/ai$/.test(normalizedEndpoint)
    ? `${normalizedEndpoint}/chat`
    : `${normalizedEndpoint}/chat/completions`;
  const key = asText(config.apiKey).trim();
  const parsedKeepAlive = /^-?\d+$/.test(String(config.keepAlive ?? '-1')) ? Number(config.keepAlive) : (config.keepAlive ?? '-1');
  const body = JSON.stringify({
    model: asText(config.model).trim(),
    messages,
    stream: true,
    temperature: options.temperature ?? 0.7,
    ...(options.think !== undefined ? { think: options.think } : {}),
    ...(options.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
    ...(parsedKeepAlive !== undefined ? { keep_alive: parsedKeepAlive } : {}),
  });
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs ?? 180000);
  if (options.signal) {
    options.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  let response: Response;
  let collectedContent = '';
  let collectedReasoning = '';
  let explicitReasoning = '';
  try {
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(key !== '' ? { Authorization: `Bearer ${key}` } : {}),
        },
        body,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof TypeError) {
        // Même repli « requête simple » que chatComplete (LM Studio & co).
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
          body,
          signal: controller.signal,
        });
      } else {
        throw error;
      }
    }
    if (!response.ok) {
      const raw = await response.text().catch(() => '');
      let detail = '';
      try {
        const errJson = JSON.parse(raw);
        detail = errJson.error?.message || errJson.message || errJson.detail || '';
      } catch {
        detail = raw.slice(0, 200).trim();
      }
      throw new Error(`Erreur IA (${response.status} ${response.statusText})${detail !== '' ? ` : ${detail}` : ''}`);
    }

    // Fournisseur qui ignore stream:true : réponse complète en JSON.
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const payload = (await response.json().catch(() => null)) as {
        choices?: Array<{
          message?: { content?: string; reasoning_content?: string; thinking?: string };
          text?: string;
        }>;
        error?: { message?: string };
      } | null;
      if (payload?.error?.message) throw new Error(`Erreur serveur IA : ${payload.error.message}`);
      const raw = payload?.choices?.[0]?.message?.content ?? payload?.choices?.[0]?.text ?? '';
      const explicitReasoning = payload?.choices?.[0]?.message?.reasoning_content ?? payload?.choices?.[0]?.message?.thinking ?? '';
      const parsed = extractReasoningAndContent(raw);
      const reasoning = explicitReasoning || parsed.reasoning;
      const content = explicitReasoning ? raw : parsed.content;
      if (reasoning) options.onReasoning?.(reasoning);
      options.onText?.(content);
      const cleaned = unwrapFences(stripReasoning(content));
      if (cleaned === '' && raw.trim() === '') throw new Error('L\'IA a renvoyé une réponse vide ou inattendue');
      return {
        text: cleaned === '' ? content.trim() : cleaned,
        reasoning: reasoning.trim(),
        truncated: false,
      };
    }

    if (!response.body) throw new Error('Flux de réponse indisponible (corps vide)');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let rawContent = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line === '' || !line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        let payload: {
          error?: { message?: string };
          choices?: Array<{
            delta?: {
              content?: string;
              reasoning_content?: string;
              thinking?: string;
            };
          }>;
        };
        try { payload = JSON.parse(data); } catch { continue; }
        if (payload.error?.message) throw new Error(`Erreur serveur IA : ${payload.error.message}`);
        const delta = payload.choices?.[0]?.delta;
        const reasoningDelta = delta?.reasoning_content ?? delta?.thinking;
        const contentDelta = delta?.content;

        if (typeof reasoningDelta === 'string' && reasoningDelta !== '') {
          explicitReasoning += reasoningDelta;
          collectedReasoning = explicitReasoning;
          options.onReasoning?.(explicitReasoning);
        }

        if (typeof contentDelta === 'string' && contentDelta !== '') {
          rawContent += contentDelta;
          collectedContent = rawContent;
          if (explicitReasoning !== '') {
            options.onText?.(rawContent);
          } else {
            const parsed = extractReasoningAndContent(rawContent);
            collectedReasoning = parsed.reasoning;
            if (parsed.reasoning !== '') {
              options.onReasoning?.(parsed.reasoning);
            }
            options.onText?.(parsed.content);
          }
        }
      }
    }
    const finalReasoning = explicitReasoning || extractReasoningAndContent(rawContent).reasoning;
    const finalContent = explicitReasoning ? rawContent : extractReasoningAndContent(rawContent).content;
    const cleaned = unwrapFences(stripReasoning(finalContent));
    if (cleaned === '' && rawContent.trim() === '') {
      throw new Error('L\'IA a renvoyé une réponse vide ou inattendue');
    }
    return {
      text: cleaned === '' ? finalContent.trim() : cleaned,
      reasoning: finalReasoning.trim(),
      truncated: false,
    };
  } catch (error) {
    // Flux coupé après réception d'une partie du texte : on conserve le
    // contenu déjà arrivé plutôt que de jeter tout le travail du modèle.
    if (collectedContent.trim() !== '' || collectedReasoning.trim() !== '') {
      const finalReasoning = explicitReasoning || extractReasoningAndContent(collectedContent).reasoning;
      const finalContent = explicitReasoning ? collectedContent : extractReasoningAndContent(collectedContent).content;
      const cleaned = unwrapFences(stripReasoning(finalContent));
      return {
        text: cleaned === '' ? finalContent.trim() : cleaned,
        reasoning: finalReasoning.trim(),
        truncated: true,
      };
    }
    if (isAbortError(error)) {
      throw new Error(
        "L'IA a mis trop de temps à répondre (> 3 min). Vérifie que ton serveur IA (Ollama / LM Studio / OpenAI) est actif et que le modèle sélectionné est bien chargé.",
      );
    }
    if (error instanceof TypeError) {
      throw new Error(
        "Connexion impossible au serveur IA (CORS ou réseau). Vérifie qu'il tourne et que l'URL est exacte (ex. http://localhost:1234/v1 pour LM Studio ou http://localhost:11434/v1 pour Ollama).",
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/* ------------------------------------------------------------------ */
/* Liste des modèles (GET /models)                                     */
/* ------------------------------------------------------------------ */

/** Extrait les identifiants de modèles d'une réponse `/models` (pure, testée). */
export function parseModelList(payload: unknown): string[] {
  const collect = (source: unknown[]): string[] =>
    source
      .map((item) => {
        if (typeof item === 'string') {
          return item;
        }
        if (item !== null && typeof item === 'object') {
          const id = (item as { id?: unknown }).id;
          if (typeof id === 'string') {
            return id;
          }
        }
        return undefined;
      })
      .filter((id): id is string => typeof id === 'string');
  if (Array.isArray(payload)) {
    return collect(payload);
  }
  if (payload !== null && typeof payload === 'object') {
    const data = (payload as { data?: unknown }).data;
    if (Array.isArray(data)) {
      return collect(data);
    }
  }
  return [];
}

/** Récupère la liste des modèles exposés par l'endpoint (`GET /models`). */
export async function listModels(config: AiConfig, timeoutMs = 15000): Promise<string[]> {
  if (asText(config.endpoint).trim() === '') {
    throw new Error('Endpoint manquant pour charger la liste des modèles');
  }
  const url = `${normalizeEndpoint(config.endpoint)}/models`;
  const key = asText(config.apiKey).trim();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: key !== '' ? { Authorization: `Bearer ${key}` } : {},
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof TypeError && key !== '') {
        // Préflight bloquée : on retente sans en-tête d'authentification.
        response = await fetch(url, { signal: controller.signal });
      } else {
        throw error;
      }
    }
    if (!response.ok) {
      throw new Error(`Impossible de lister les modèles (${response.status} ${response.statusText})`);
    }
    const payload = (await response.json().catch(() => null)) as unknown;
    return [...new Set(parseModelList(payload))].sort((a, b) => a.localeCompare(b));
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error('Délai dépassé pendant la récupération des modèles');
    }
    if (error instanceof TypeError) {
      throw new Error('Connexion impossible au serveur (CORS ou réseau) pour lister les modèles');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export interface GeneratedTask {
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  checklist: string[];
}

/** Découpe un objectif ou projet en plusieurs tâches Kanban structurées. */
export async function generateTasksFromGoal(
  config: AiConfig,
  goal: string,
  count = 4,
): Promise<GeneratedTask[]> {
  const prompt = [
    `Découpe cet objectif en ${count} tâches concrètes, ordonnées et directement actionnables pour un tableau Kanban.`,
    `Objectif : « ${goal.trim()} »`,
    '',
    'Réponds STRICTEMENT sous forme de JSON valide (tableau d\'objets) avec cette structure exacte :',
    '[',
    '  {',
    '    "title": "Titre clair et concis de la tâche",',
    '    "description": "Brève explication du travail à effectuer",',
    '    "priority": "low" | "medium" | "high" | "urgent",',
    '    "checklist": ["Étape 1", "Étape 2", "Étape 3"]',
    '  }',
    ']',
    'Aucun texte avant ou après le JSON.',
  ].join('\n');

  const raw = await chatComplete(config, [
    {
      role: 'system',
      content:
        'Tu es un expert en gestion de projet agile et en productivité. Tu réponds exclusivement avec du JSON valide sans texte superflu.',
    },
    { role: 'user', content: prompt },
  ]);

  try {
    const cleaned = unwrapFences(raw).replace(/^[^{[]*/, '').replace(/[^}\]]*$/, '');
    const parsed = JSON.parse(cleaned) as Array<Record<string, unknown>>;
    if (Array.isArray(parsed)) {
      return parsed.map((item) => {
        const priorityVal = typeof item.priority === 'string' ? item.priority.toLowerCase() : 'medium';
        const priority = (['low', 'medium', 'high', 'urgent'].includes(priorityVal)
          ? priorityVal
          : 'medium') as 'low' | 'medium' | 'high' | 'urgent';

        const checklist = Array.isArray(item.checklist)
          ? item.checklist.map((s) => String(s).trim()).filter((s) => s !== '')
          : [];

        return {
          title: String(item.title || 'Nouvelle tâche').trim(),
          description: String(item.description || '').trim(),
          priority,
          checklist,
        };
      });
    }
  } catch {
    // Fallback par parsing ligne à ligne
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    return lines.slice(0, count).map((line) => ({
      title: line.replace(/^[-*0-9.)\s]+/, '').slice(0, 60),
      description: '',
      priority: 'medium' as const,
      checklist: [],
    }));
  }
  return [];
}

/** Génère des sous-tâches concrètes (checklist) pour une tâche Kanban existante. */
export async function generateTaskChecklist(
  config: AiConfig,
  taskTitle: string,
  taskDescription = '',
): Promise<string[]> {
  const prompt = [
    `Décompose cette tâche en 3 à 6 sous-tâches concrètes, précises et ordonnées pour une checklist.`,
    `Tâche : « ${taskTitle.trim()} »`,
    taskDescription ? `Contexte / Description : ${taskDescription.trim()}` : '',
    '',
    'Réponds STRICTEMENT sous forme de tableau JSON de chaînes de caractères :',
    '["Sous-tâche 1", "Sous-tâche 2", "Sous-tâche 3"]',
    'Aucun autre texte.',
  ]
    .filter(Boolean)
    .join('\n');

  const raw = await chatComplete(config, [
    {
      role: 'system',
      content: 'Tu es un assistant de productivité. Tu réponds exclusivement en JSON valide.',
    },
    { role: 'user', content: prompt },
  ]);

  try {
    const cleaned = unwrapFences(raw).replace(/^[^{[]*/, '').replace(/[^}\]]*$/, '');
    const parsed = JSON.parse(cleaned) as unknown[];
    if (Array.isArray(parsed)) {
      return parsed.map((s) => String(s).trim()).filter((s) => s.length > 0);
    }
  } catch {
    return raw
      .split('\n')
      .map((l) => l.replace(/^[-*0-9.)\s[\]]+/, '').trim())
      .filter((l) => l.length > 0);
  }
  return [];
}

/** Rédige ou améliore la description détaillée d'une tâche. */
export function generateTaskDescription(
  config: AiConfig,
  taskTitle: string,
  currentDesc = '',
): Promise<string> {
  const prompt = [
    `Rédige une description claire, concise et structurée en Markdown pour cette tâche Kanban.`,
    `Titre de la tâche : « ${taskTitle.trim()} »`,
    currentDesc ? `Description actuelle / contexte : ${currentDesc.trim()}` : '',
    '',
    'Structure la réponse ainsi :',
    '- **Objectif** : but recherché',
    '- **Détails** : points clés et instructions',
    '- **Critères de fin** : ce qui valide la complétion',
    '',
    'Réponds UNIQUEMENT en Markdown sans préambule.',
  ]
    .filter(Boolean)
    .join('\n');

  return chatComplete(config, [
    {
      role: 'system',
      content: 'Tu es un expert en gestion de projet. Réponds directement en Markdown.',
    },
    { role: 'user', content: prompt },
  ]);
}

/** Génère le Markdown d'une nouvelle note à partir d'un prompt. */
export function generateNote(config: AiConfig, prompt: string, title = ''): Promise<string> {
  return chatComplete(config, [
    { role: 'system', content: NOTE_SYSTEM_PROMPT },
    { role: 'user', content: buildNotePrompt(title, prompt) },
  ]);
}

/** Transforme le Markdown d'une note existante (résumé / reformulation / traduction / correction). */
export function transformNote(
  config: AiConfig,
  action: AiTransformAction,
  content: string,
): Promise<string> {
  return chatComplete(
    config,
    [
      {
        role: 'system',
        content:
          'Tu es l\'assistant de MansotNote. Tu retourns UNIQUEMENT du Markdown, sans préambule ni bloc de code global.',
      },
      { role: 'user', content: buildTransformPrompt(action, content) },
    ],
    { temperature: action === 'correct' ? 0.1 : 0.7 },
  );
}

/** Corrige l'orthographe et la grammaire d'un texte ou d'une sélection en préservant le Markdown. */
export async function correctText(
  config: AiConfig,
  text: string,
  options?: { signal?: AbortSignal },
): Promise<string> {
  const estimatedTokens = Math.min(4096, Math.max(128, Math.ceil(text.length * 1.5) + 64));
  const raw = await chatComplete(
    config,
    [
      {
        role: 'system',
        content:
          'Tu es un correcteur orthographique et grammatical expert ultra-rapide. Corrige uniquement les fautes d\'orthographe, de grammaire, d\'accords, de conjugaison et de ponctuation du texte fourni. Conserve STRICTEMENT la syntaxe Markdown originale (titres, listes, gras, liens). IMPORTANT : Ne produis AUCUNE réflexion interne, aucune balise <think>, aucun commentaire, aucun préambule. Réponds DIRECTEMENT et EXCLUSIVEMENT par le texte corrigé. Si aucune faute, renvoie le texte exact.',
      },
      {
        role: 'user',
        content: `Corrige l'orthographe et la grammaire de ce texte en préservant le format Markdown (réponse directe sans réflexion) :\n\n${text}`,
      },
    ],
    {
      temperature: 0.05,
      think: false,
      maxTokens: estimatedTokens,
      signal: options?.signal,
    },
  );
  return unwrapFences(stripReasoning(raw));
}

/** Vérifie si deux textes sont identiques (hors retours chariots insignifiants). */
export function isTextUnchanged(original: string, updated: string): boolean {
  return original.trim().replace(/\r\n/g, '\n') === updated.trim().replace(/\r\n/g, '\n');
}
