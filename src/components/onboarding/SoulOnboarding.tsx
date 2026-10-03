/**
 * SoulOnboarding — accueil « soul » de l'assistante IA.
 * -------------------------------------------------------
 * Court questionnaire (4 écrans) affiché à la première utilisation de
 * l'assistante par un compte, et réutilisable ensuite pour modifier ces
 * réglages depuis les paramètres (mode « edit »).
 */
import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  MessageCircleHeart,
  Sparkles,
} from 'lucide-react';
import type { AssistantSoul } from '@/types';
import { PERSONALITY_PRESETS, SOUL_NAME_MAX_LENGTH, SOUL_NOTE_MAX_LENGTH, buildWelcomeMessage } from '@/lib/soul';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';

export interface SoulOnboardingProps {
  initial: AssistantSoul;
  onSave: (soul: AssistantSoul) => void;
  onSkip: () => void;
  mode: 'first-run' | 'edit';
}

const STEP_COUNT = 4;

/** Aperçu : seul le gras (**…**) du message d'accueil est interprété. */
function PreviewText({ text }: { text: string }) {
  return (
    <>
      {text.split(/\*\*(.+?)\*\*/g).map((part, index) =>
        index % 2 === 1 ? <strong key={index}>{part}</strong> : <span key={index}>{part}</span>,
      )}
    </>
  );
}

export function SoulOnboarding({ initial, onSave, onSkip, mode }: SoulOnboardingProps) {
  const [step, setStep] = useState(0);
  const [assistantName, setAssistantName] = useState(initial.assistantName);
  const [userName, setUserName] = useState(initial.userName);
  const [personality, setPersonality] = useState(initial.personality);
  const [personalityNote, setPersonalityNote] = useState(initial.personalityNote);
  const [formality, setFormality] = useState<AssistantSoul['formality']>(initial.formality);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Focus automatique sur le champ principal de chaque écran.
    firstFieldRef.current?.focus();
  }, [step]);

  const goNext = () => {
    if (step < STEP_COUNT - 1) {
      setStep(step + 1);
    } else {
      finish();
    }
  };

  const goPrev = () => {
    if (step > 0) setStep(step - 1);
  };

  const finish = () => {
    const soul: AssistantSoul = {
      assistantName: assistantName.trim() === '' ? initial.assistantName : assistantName.trim().slice(0, SOUL_NAME_MAX_LENGTH),
      userName: userName.trim().slice(0, SOUL_NAME_MAX_LENGTH),
      personality,
      personalityNote: personalityNote.trim().slice(0, SOUL_NOTE_MAX_LENGTH),
      formality,
      completedAt: Date.now(),
    };
    onSave(soul);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      const target = event.target as HTMLElement;
      // Ne pas intercepter Entrée dans une zone de texte multi-lignes.
      if (target.tagName === 'TEXTAREA') return;
      event.preventDefault();
      goNext();
    }
  };

  const previewSoul: AssistantSoul = {
    assistantName: assistantName.trim() === '' ? initial.assistantName : assistantName.trim(),
    userName: userName.trim(),
    personality,
    personalityNote: personalityNote.trim(),
    formality,
    completedAt: Date.now(),
  };

  const title = mode === 'first-run' ? 'Faisons connaissance' : 'Personnaliser l’assistante';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center sm:p-4" onKeyDown={onKeyDown}>
      <div className="absolute inset-0 bg-black/50" aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'relative flex h-full w-full flex-col bg-white dark:bg-zinc-900',
          'sm:h-auto sm:max-h-[90vh] sm:w-full sm:max-w-md sm:rounded-2xl sm:border sm:border-zinc-200 sm:shadow-2xl sm:dark:border-zinc-800',
        )}
      >
        <div className="shrink-0 border-b border-zinc-200 px-5 pt-5 dark:border-zinc-800">
          <div className="mb-3 flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
            <Sparkles size={18} />
            <h1 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{title}</h1>
          </div>
          <div className="flex gap-1.5 pb-4" role="progressbar" aria-valuemin={1} aria-valuemax={STEP_COUNT} aria-valuenow={step + 1}>
            {Array.from({ length: STEP_COUNT }, (_, index) => (
              <div
                key={index}
                className={cn(
                  'h-1.5 flex-1 rounded-full transition-colors',
                  index <= step ? 'bg-indigo-500' : 'bg-zinc-200 dark:bg-zinc-700',
                )}
              />
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {step === 0 && (
            <div className="space-y-3">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Comment veux-tu que ton assistante s’appelle ?
              </p>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Nom de l’assistante</span>
                <input
                  ref={firstFieldRef}
                  className="field h-11 w-full px-3 text-base"
                  maxLength={SOUL_NAME_MAX_LENGTH}
                  placeholder="Choisissez un nom"
                  value={assistantName}
                  onChange={(e) => setAssistantName(e.target.value)}
                />
              </label>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-3">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Et comment {assistantName.trim() || 'elle'} doit-elle t’appeler ?
              </p>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Ton prénom ou surnom (optionnel)</span>
                <input
                  ref={firstFieldRef}
                  className="field h-11 w-full px-3 text-base"
                  maxLength={SOUL_NAME_MAX_LENGTH}
                  placeholder="Alex"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                />
              </label>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Quelle personnalité pour {assistantName.trim() || 'ton assistante'} ?</p>
              <div className="grid grid-cols-2 gap-2">
                {PERSONALITY_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setPersonality(preset.id)}
                    className={cn(
                      'min-h-[44px] rounded-lg border px-3 py-2 text-left transition-colors',
                      personality === preset.id
                        ? 'border-indigo-400/70 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300'
                        : 'border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800',
                    )}
                  >
                    <span className="block text-sm font-medium">{preset.label}</span>
                    <span className="mt-0.5 block text-[11px] text-zinc-400 dark:text-zinc-500">{preset.description}</span>
                  </button>
                ))}
              </div>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Précision (optionnel)</span>
                <input
                  ref={firstFieldRef}
                  className="field h-11 w-full px-3 text-base"
                  maxLength={SOUL_NOTE_MAX_LENGTH}
                  placeholder="Ex. toujours proposer un exemple concret"
                  value={personalityNote}
                  onChange={(e) => setPersonalityNote(e.target.value)}
                />
              </label>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Dernier détail : tu ou vous ?</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setFormality('tu')}
                  className={cn(
                    'min-h-[44px] rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                    formality === 'tu'
                      ? 'border-indigo-400/70 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300'
                      : 'border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800',
                  )}
                >
                  Tutoiement
                  <span className="block text-[11px] font-normal text-zinc-400 dark:text-zinc-500">« tu »</span>
                </button>
                <button
                  type="button"
                  onClick={() => setFormality('vous')}
                  className={cn(
                    'min-h-[44px] rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                    formality === 'vous'
                      ? 'border-indigo-400/70 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300'
                      : 'border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800',
                  )}
                >
                  Vouvoiement
                  <span className="block text-[11px] font-normal text-zinc-400 dark:text-zinc-500">« vous »</span>
                </button>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-800/50">
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  <MessageCircleHeart size={13} />
                  Aperçu du message d’accueil
                </div>
                <p className="whitespace-pre-line text-sm text-zinc-700 dark:text-zinc-200">
                  <PreviewText text={buildWelcomeMessage(previewSoul)} />
                </p>
              </div>
            </div>
          )}
        </div>

        <div
          className={cn(
            'flex shrink-0 items-center justify-between gap-2 border-t border-zinc-200 px-5 py-4 dark:border-zinc-800',
            'pb-[calc(env(safe-area-inset-bottom)+1rem)]',
          )}
        >
          <div>
            {step > 0 && (
              <Button variant="ghost" onClick={goPrev} icon={<ArrowLeft size={15} />}>
                Précédent
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onSkip}>
              {mode === 'first-run' ? 'Plus tard' : 'Annuler'}
            </Button>
            <Button
              variant="primary"
              onClick={goNext}
              icon={step === STEP_COUNT - 1 ? <Check size={15} /> : <ArrowRight size={15} />}
            >
              {step === STEP_COUNT - 1 ? 'Terminer' : 'Suivant'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
