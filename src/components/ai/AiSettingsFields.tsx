/**
 * AiSettingsFields — configuration de l'IA (compatible OpenAI) :
 * endpoint, clé API, modèle + préréglages (OpenAI / OpenRouter / Ollama).
 * Les valeurs vivent dans les réglages persistés du store.
 */
import { useState } from 'react';
import { Download, LoaderCircle } from 'lucide-react';
import { AI_PRESETS } from '@/constants';
import { listModels, type AiConfig } from '@/lib/ai';
import { useAppStore } from '@/store/app-store';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';

/** Sous-ensemble des réglages persistés (mêmes noms que `AppSettings`). */
export interface AiValues {
  aiEndpoint: string;
  aiApiKey: string;
  aiModel: string;
  /** Vide = RAG mots-clés BM25 uniquement. */
  aiEmbeddingModel: string;
  /** Rétention mémoire Ollama. */
  aiKeepAlive?: string;
}

export interface AiSettingsFieldsProps {
  values: AiValues;
  onChange: (patch: Partial<AiValues>) => void;
  className?: string;
}

export function AiSettingsFields({ values, onChange, className }: AiSettingsFieldsProps) {
  const toast = useAppStore((s) => s.toast);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  // Force des chaînes vides si un champ est absent/undefined : aucun
  // `.trim()` ne peut alors lever, et les inputs restent contrôlés.
  const v: AiValues = {
    aiEndpoint: typeof values.aiEndpoint === 'string' ? values.aiEndpoint : '',
    aiApiKey: typeof values.aiApiKey === 'string' ? values.aiApiKey : '',
    aiModel: typeof values.aiModel === 'string' ? values.aiModel : '',
    aiEmbeddingModel:
      typeof values.aiEmbeddingModel === 'string' ? values.aiEmbeddingModel : '',
    aiKeepAlive: typeof values.aiKeepAlive === 'string' ? values.aiKeepAlive : '-1',
  };

  const loadModels = () => {
    if (loadingModels) {
      return;
    }
    setLoadingModels(true);
    const config: AiConfig = {
      endpoint: v.aiEndpoint,
      apiKey: v.aiApiKey,
      model: v.aiModel,
    };
    listModels(config)
      .then((list) => {
        setModels(list);
        const patch: Partial<AiValues> = {};
        // Un modèle d'embedding ne doit jamais devenir le modèle de chat.
        const chatModels = list.filter((model) => !/embed/i.test(model));
        if (
          chatModels.length > 0 &&
          (v.aiModel === '' || !list.includes(v.aiModel) || /embed/i.test(v.aiModel))
        ) {
          patch.aiModel = chatModels[0];
        }
        // Détection automatique : qwen3-embedding:0.6b-8k ou tout modèle
        // explicitement nommé "embedding/embed" est proposé pour le RAG.
        const embeddingModel = list.find((model) => /embed/i.test(model));
        if (v.aiEmbeddingModel === '' && embeddingModel) {
          patch.aiEmbeddingModel = embeddingModel;
        }
        if (Object.keys(patch).length > 0) onChange(patch);
        if (list.length === 0) {
          toast('info', 'Aucun modèle renvoyé par le serveur.');
        }
      })
      .catch((err: unknown) => {
        setModels([]);
        toast('error', err instanceof Error ? err.message : 'Modèles indisponibles');
      })
      .finally(() => setLoadingModels(false));
  };

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs text-zinc-500 dark:text-zinc-400">Préréglage :</span>
        {AI_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            title={preset.hint}
            className={cn(
              'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
              v.aiEndpoint === preset.endpoint
                ? 'border-indigo-400/70 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300'
                : 'border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800',
            )}
            onClick={() => onChange({ aiEndpoint: preset.endpoint, aiModel: preset.model })}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Endpoint (compatible OpenAI)
          </span>
          <input
            className="field h-9 w-full px-3 text-sm"
            placeholder="https://api.openai.com/v1 ou http://localhost:11434/v1"
            value={v.aiEndpoint}
            onChange={(e) => onChange({ aiEndpoint: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Clé API (vide pour LM Studio / Ollama)
          </span>
          <input
            type="password"
            className="field h-9 w-full px-3 text-sm"
            placeholder="sk-…"
            value={v.aiApiKey}
            onChange={(e) => onChange({ aiApiKey: e.target.value })}
          />
        </label>
        <div>
          <span
            id="ai-model-label"
            className="mb-1 block cursor-default text-xs font-medium text-zinc-500 dark:text-zinc-400"
            onClick={() => document.getElementById('ai-model-input')?.focus()}
          >
            Modèle
          </span>
          <div className="flex items-center gap-1.5">
            <input
              id="ai-model-input"
              list="mansotnote-ai-models"
              className="field h-9 w-full min-w-0 px-3 text-sm"
              placeholder="qwen/qwen3.8-27b, gpt-4o-mini, llama3.1…"
              value={v.aiModel}
              onChange={(e) => onChange({ aiModel: e.target.value })}
            />
            <datalist id="mansotnote-ai-models">
              {models.map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
            <Button
              size="sm"
              variant="ghost"
              className="shrink-0"
              icon={
                loadingModels ? (
                  <LoaderCircle size={13} className="animate-spin" />
                ) : (
                  <Download size={13} />
                )
              }
              onClick={loadModels}
              disabled={v.aiEndpoint.trim() === ''}
            >
              Charger
            </Button>
          </div>
          <span className="mt-1 block text-[11px] text-zinc-400 dark:text-zinc-500">
            « Charger » liste les modèles du serveur — ou tape le nom directement.
          </span>
        </div>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Modèle d’embedding pour le RAG
          </span>
          <input
            list="mansotnote-ai-models"
            className="field h-9 w-full px-3 text-sm"
            placeholder="qwen3-embedding:0.6b-8k (vide = BM25 uniquement)"
            value={v.aiEmbeddingModel}
            onChange={(e) => onChange({ aiEmbeddingModel: e.target.value })}
          />
          <span className="mt-1 block text-[11px] text-zinc-400 dark:text-zinc-500">
            S’il est renseigné, MansotNote combine recherche sémantique et mots-clés. Les notes passent uniquement par l’endpoint configuré ci-dessus.
          </span>
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Rétention mémoire Ollama (Keep-Alive)
          </span>
          <select
            className="field h-9 w-full px-3 text-sm bg-transparent"
            value={v.aiKeepAlive}
            onChange={(e) => onChange({ aiKeepAlive: e.target.value })}
          >
            <option value="-1">Toujours chargé en mémoire (Recommandé - Zéro temps d’attente)</option>
            <option value="24h">24 heures</option>
            <option value="1h">1 heure</option>
            <option value="5m">5 minutes (Défaut Ollama)</option>
          </select>
          <span className="mt-1 block text-[11px] text-zinc-400 dark:text-zinc-500">
            Garde le modèle en mémoire RAM/VRAM sur votre serveur pour éviter d'attendre son rechargement.
          </span>
        </label>
      </div>
    </div>
  );
}
