/**
 * Soul — personnalisation de l'assistante IA (accueil « soul »).
 * --------------------------------------------------------------
 * Centralise les valeurs par défaut, les préréglages de personnalité, la
 * fusion robuste des réglages persistés et la construction du préfixe de
 * prompt système ainsi que du message d'accueil du Copilote.
 */
import type { AssistantSoul, AppSettings, Formality } from '@/types';

/** Nom par défaut de l'assistante, proposé à l'accueil. */
export const DEFAULT_ASSISTANT_NAME = 'SIA';

/** Longueur maximale (caractères) du nom de l'assistante et du prénom utilisateur. */
export const SOUL_NAME_MAX_LENGTH = 40;

/** Longueur maximale (caractères) de la précision libre de personnalité. */
export const SOUL_NOTE_MAX_LENGTH = 300;

/** Valeurs par défaut de la personnalisation, avant toute réponse de l'utilisateur. */
export const DEFAULT_SOUL: AssistantSoul = {
  assistantName: DEFAULT_ASSISTANT_NAME,
  userName: '',
  personality: 'chaleureuse',
  personalityNote: '',
  formality: 'tu',
  completedAt: null,
};

/** Préréglage rapide de personnalité proposé à l'écran 3 de l'accueil. */
export interface PersonalityPreset {
  id: string;
  /** Libellé affiché sur le bouton de choix. */
  label: string;
  /** Courte description sous le libellé. */
  description: string;
  /** Consigne injectée dans le prompt système quand ce préréglage est actif. */
  instruction: string;
}

/** Préréglages de personnalité proposés à l'utilisateur. */
export const PERSONALITY_PRESETS: PersonalityPreset[] = [
  {
    id: 'chaleureuse',
    label: 'Chaleureuse',
    description: 'Bienveillante, encourageante, prend le temps.',
    instruction: 'Adopte un ton chaleureux, bienveillant et encourageant.',
  },
  {
    id: 'directe',
    label: 'Directe et concise',
    description: 'Réponses courtes, droit au but.',
    instruction: 'Sois directe, concise et va droit au but, sans détour inutile.',
  },
  {
    id: 'pedagogue',
    label: 'Pédagogue',
    description: 'Explique les choses pas à pas.',
    instruction: 'Adopte un ton pédagogue : explique clairement, étape par étape, sans jargon inutile.',
  },
  {
    id: 'taquine',
    label: 'Taquine',
    description: 'Un peu d’humour, jamais au détriment du fond.',
    instruction: 'Ajoute une touche d’humour léger et taquin, sans jamais nuire à la clarté ou au sérieux des réponses.',
  },
];

/** Index des préréglages par identifiant, pour accès rapide. */
const PRESETS_BY_ID: ReadonlyMap<string, PersonalityPreset> = new Map(
  PERSONALITY_PRESETS.map((preset) => [preset.id, preset]),
);

/** Préréglage de personnalité correspondant à un id, avec repli sur le défaut. */
export function getPersonalityPreset(id: string): PersonalityPreset {
  return PRESETS_BY_ID.get(id) ?? PRESETS_BY_ID.get(DEFAULT_SOUL.personality)!;
}

/**
 * Neutralise un texte libre destiné au prompt système : borne sa longueur,
 * réduit les retours à la ligne multiples à un espace et retire les
 * caractères de contrôle. Protège contre l'injection de nouvelles
 * instructions via de longs blocs multi-lignes.
 */
function sanitizeFreeText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  const collapsed = value
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  return collapsed.slice(0, maxLength);
}

/** Nom (assistante ou utilisateur) : borné, non vide, sans retours ligne. */
function sanitizeName(value: unknown, fallback: string): string {
  const cleaned = sanitizeFreeText(value, SOUL_NAME_MAX_LENGTH);
  return cleaned === '' ? fallback : cleaned;
}

function sanitizeFormality(value: unknown): Formality {
  return value === 'vous' ? 'vous' : 'tu';
}

function sanitizePersonality(value: unknown): string {
  const id = typeof value === 'string' ? value : '';
  return PRESETS_BY_ID.has(id) ? id : DEFAULT_SOUL.personality;
}

function sanitizeCompletedAt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Fusionne la personnalisation persistée (potentiellement absente, partielle
 * ou invalide — ex. après une migration ou une écriture externe) avec les
 * défauts. Toujours exploitable sans vérification supplémentaire côté appelant.
 */
export function getSoul(settings: Pick<AppSettings, 'soul'> | undefined | null): AssistantSoul {
  const raw = settings?.soul;
  return {
    assistantName: sanitizeName(raw?.assistantName, DEFAULT_SOUL.assistantName),
    userName: sanitizeName(raw?.userName, DEFAULT_SOUL.userName),
    personality: sanitizePersonality(raw?.personality),
    personalityNote: sanitizeFreeText(raw?.personalityNote, SOUL_NOTE_MAX_LENGTH),
    formality: sanitizeFormality(raw?.formality),
    completedAt: sanitizeCompletedAt(raw?.completedAt),
  };
}

/**
 * true si l'accueil « soul » doit être proposé : jamais vu (pas de `soul`
 * persisté) ou jamais complété (« Plus tard » marque aussi completedAt).
 */
export function needsSoulOnboarding(settings: Pick<AppSettings, 'soul'> | undefined | null): boolean {
  const soul = settings?.soul;
  return !soul || soul.completedAt === null || soul.completedAt === undefined;
}

/**
 * Bloc de consignes en français à préfixer au prompt système existant du
 * Copilote. Reste court et ne doit jamais contredire les consignes métier
 * déjà présentes dans le prompt (outils, contexte notes/Kanban…).
 */
export function buildSoulPrompt(soul: AssistantSoul): string {
  const preset = getPersonalityPreset(soul.personality);
  const lines: string[] = [];
  lines.push(`Tu t'appelles « ${soul.assistantName} ».`);
  lines.push('Utilise ce nom choisi par l’utilisateur pour te présenter. Il remplace tout ancien nom présent dans l’historique de la conversation.');
  if (soul.userName !== '') {
    lines.push(`Appelle l'utilisateur « ${soul.userName} ».`);
  }
  lines.push(
    soul.formality === 'vous'
      ? "Vouvoie toujours l'utilisateur."
      : "Tutoie toujours l'utilisateur.",
  );
  lines.push(preset.instruction);
  if (soul.personalityNote !== '') {
    lines.push(`Précision supplémentaire sur ta personnalité : ${soul.personalityNote}`);
  }
  return lines.join(' ');
}

/**
 * Message d'accueil Markdown affiché dans une nouvelle conversation,
 * remplaçant INITIAL_WELCOME_CONTENT (src/lib/chat-storage.ts) en tenant
 * compte du nom choisi, du tu/vous et du prénom de l'utilisateur.
 */
export function buildWelcomeMessage(soul: AssistantSoul): string {
  const name = soul.assistantName;
  const vous = soul.formality === 'vous';
  const greeting = soul.userName !== ''
    ? (vous ? `Bonjour ${soul.userName} ! ` : `Salut ${soul.userName} ! `)
    : (vous ? 'Bonjour ! ' : 'Salut ! ');
  const possessiveSing = vous ? 'votre' : 'ton';
  const possessivePluralF = vous ? 'vos' : 'tes';
  const possessiveSingF = vous ? 'votre' : 'ta';
  const verb1 = vous ? 'Posez-moi' : 'Pose-moi';
  const verb2 = vous ? 'demandez-moi' : 'demande-moi';
  return (
    `👋 ${greeting}Je suis **${name}**, ${possessiveSing} assistante IA personnelle et copilote de productivité.\n\n` +
    `Je suis directement connectée à toutes ${possessivePluralF} **notes**, ${possessivePluralF} **tâches Kanban** et ${possessiveSingF} **note active**.\n\n` +
    `${verb1} une question, ${verb2} de rédiger, d’ajouter à une note, de corriger ou de planifier ${possessivePluralF} actions !`
  );
}
