/**
 * AiNoteModal — « Note IA » : décrire en langage naturel ce que l'on
 * veut dans la note, l'IA rédige le Markdown, aperçu, puis insertion
 * dans l'éditeur comme nouvelle note (modifiable ensuite librement).
 */
import { useState } from 'react';
import {
  AlertTriangle,
  Copy,
  LoaderCircle,
  RefreshCw,
  Settings2,
  Sparkles,
} from 'lucide-react';
import { useAppStore } from '@/store/app-store';
import { generateNote, isAiConfigured, resolveAiSettings, type AiConfig } from '@/lib/ai';
import { copyText } from '@/lib/clipboard';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { MarkdownRenderer } from '@/components/markdown/MarkdownRenderer';
import { AiSettingsFields } from './AiSettingsFields';

/** Titre final : celui demandé, sinon le premier # de la réponse, sinon la 1re ligne. */
function deriveTitle(requested: string, markdown: string): string {
  if (requested.trim() !== '') {
    return requested.trim().slice(0, 80);
  }
  for (const line of markdown.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') {
      continue;
    }
    const heading = trimmed.match(/^#\s+(.+)$/);
    const clean = (heading !== null ? heading[1] : trimmed)
      .replace(/[*_`~[\]#>]/g, '')
      .trim();
    return clean.slice(0, 80) || 'Note IA';
  }
  return 'Note IA';
}

export function AiNoteModal({ onClose }: { onClose: () => void }) {
  const settings = useAppStore((s) => s.data.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const createNote = useAppStore((s) => s.createNote);
  const toast = useAppStore((s) => s.toast);

  // Les anciens coffres peuvent contenir des champs IA explicitement vides :
  // dans ce cas, la configuration injectée au build reste utilisable.
  const aiValues = resolveAiSettings(settings);
  const config: AiConfig = {
    endpoint: aiValues.aiEndpoint,
    apiKey: aiValues.aiApiKey,
    model: aiValues.aiModel,
  };
  const configured = isAiConfigured(config);

  const [phase, setPhase] = useState<'form' | 'generating' | 'result'>('form');
  const [prompt, setPrompt] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState('');
  const [showSettings, setShowSettings] = useState(!configured);

  const handleGenerate = () => {
    if (prompt.trim() === '') {
      setError('Décris d\'abord ce que la note doit contenir.');
      return;
    }
    setError(null);
    setPhase('generating');
    generateNote(config, prompt, title)
      .then((markdown) => {
        setResult(markdown);
        setPhase('result');
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Erreur inconnue lors de la génération');
        setPhase('form');
      });
  };

  const handleInsert = () => {
    createNote({ title: deriveTitle(title, result), content: result });
    toast('success', 'Note IA créée — modifie-la librement');
    onClose();
  };

  if (phase === 'generating') {
    return (
      <Modal title="Note IA" onClose={onClose}>
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <LoaderCircle size={26} className="animate-spin text-indigo-500" />
          <p className="text-sm font-medium">L'IA rédige ta note…</p>
          <p className="max-w-sm text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            Quelques secondes selon le modèle et la longueur demandée.
          </p>
        </div>
      </Modal>
    );
  }

  if (phase === 'result') {
    return (
      <Modal
        title="Note IA — aperçu"
        wide
        onClose={onClose}
        footer={
          <>
            <Button
              size="sm"
              icon={<RefreshCw size={13} />}
              onClick={() => setPhase('form')}
            >
              Régénérer
            </Button>
            <Button
              size="sm"
              icon={<Copy size={13} />}
              onClick={() => {
                void copyText(result).then((ok) =>
                  toast(ok ? 'success' : 'error', ok ? 'Markdown copié' : 'Copie impossible'),
                );
              }}
            >
              Copier
            </Button>
            <Button size="sm" variant="primary" icon={<Sparkles size={13} />} onClick={handleInsert}>
              Insérer dans mes notes
            </Button>
          </>
        }
      >
        <MarkdownRenderer markdown={result} />
      </Modal>
    );
  }

  return (
    <Modal
      title={
        <span className="inline-flex items-center gap-2">
          <Sparkles size={15} className="text-indigo-500" />
          Note IA
        </span>
      }
      onClose={onClose}
      footer={
        <>
          <Button size="sm" onClick={onClose}>
            Annuler
          </Button>
          <Button size="sm" variant="primary" icon={<Sparkles size={13} />} onClick={handleGenerate}>
            Générer
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
          Décris simplement ce que tu veux — l'IA s'occupe du Markdown (structure, listes,
          tableaux…). Tu gardes la main : tout reste modifiable ensuite.
        </p>

        <textarea
          autoFocus
          className="field min-h-28 w-full resize-y p-3 text-sm leading-relaxed"
          placeholder="Ex. : un guide pour installer une imprimante réseau, avec les étapes, les points d'attention et un tableau des pilotes par système…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <input
          className="field h-9 w-full px-3 text-sm"
          placeholder="Titre (optionnel — sinon l'IA en propose un)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        {error !== null && (
          <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/50 dark:text-red-300">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span className="break-words">{error}</span>
          </div>
        )}

        {!configured && (
          <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-3">
            <p className="mb-2 text-xs font-medium text-indigo-700 dark:text-indigo-300">
              Configure d'abord l'IA (une seule fois, stocké localement) :
            </p>
            <AiSettingsFields values={aiValues} onChange={(patch) => updateSettings(patch)} />
          </div>
        )}
        {configured && (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
            onClick={() => setShowSettings((value) => !value)}
          >
            <Settings2 size={12} />
            {showSettings ? 'Masquer la configuration' : `Configuration IA — ${config.model}`}
          </button>
        )}
        {configured && showSettings && (
          <AiSettingsFields values={aiValues} onChange={(patch) => updateSettings(patch)} />
        )}
      </div>
    </Modal>
  );
}
