/**
 * AiTaskModal — modale de génération de tâches Kanban par IA.
 * Découpe un objectif en cartes structurées (titre, description, priorité, sous-tâches).
 */
import { useState } from 'react';
import {
  Flag,
  ListTodo,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useAppStore } from '@/store/app-store';
import {
  generateTasksFromGoal,
  isAiConfigured,
  type AiConfig,
  type GeneratedTask,
} from '@/lib/ai';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Input';
import { PRIORITY_META } from './priority';

export interface AiTaskModalProps {
  onClose: () => void;
  defaultColumnId?: string;
}

export function AiTaskModal({ onClose, defaultColumnId }: AiTaskModalProps) {
  const state = useAppStore();
  const settings = state.data.settings;
  const columns = state.data.columns;

  const aiConfig: AiConfig = {
    endpoint: settings.aiEndpoint ?? '',
    apiKey: settings.aiApiKey ?? '',
    model: settings.aiModel ?? '',
  };

  const configured = isAiConfigured(aiConfig);
  const firstColId = defaultColumnId || columns[0]?.id || '';

  const [goal, setGoal] = useState('');
  const [taskCount, setTaskCount] = useState(4);
  const [targetColumnId, setTargetColumnId] = useState(firstColId);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedTasks, setGeneratedTasks] = useState<GeneratedTask[]>([]);
  const [selectedTasks, setSelectedTasks] = useState<number[]>([]);

  const handleGenerate = async () => {
    if (!configured) {
      setError("L'IA n'est pas configurée. Renseigne l'endpoint et le modèle dans les réglages.");
      return;
    }
    if (goal.trim() === '') {
      setError('Décris ton objectif ou ton projet.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const tasks = await generateTasksFromGoal(aiConfig, goal, taskCount);
      if (tasks.length === 0) {
        throw new Error('Aucune tâche générée. Réessaie avec une description plus détaillée.');
      }
      setGeneratedTasks(tasks);
      setSelectedTasks(tasks.map((_, i) => i));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la génération');
    } finally {
      setLoading(false);
    }
  };

  const handleImport = () => {
    if (generatedTasks.length === 0 || !targetColumnId) return;

    let addedCount = 0;
    generatedTasks.forEach((t, i) => {
      if (selectedTasks.includes(i)) {
        const cardId = state.createCard(targetColumnId, {
          title: t.title,
          description: t.description,
          priority: t.priority,
        });

        // Ajouter les sous-tâches
        t.checklist.forEach((itemTitle) => {
          state.addChecklistItem(cardId, itemTitle);
        });
        addedCount++;
      }
    });

    state.toast('success', `${addedCount} tâche${addedCount > 1 ? 's' : ''} ajoutée${addedCount > 1 ? 's' : ''} au Kanban !`);
    onClose();
  };

  const toggleSelectTask = (index: number) => {
    setSelectedTasks((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index],
    );
  };

  const removeGeneratedTask = (index: number) => {
    setGeneratedTasks((prev) => prev.filter((_, i) => i !== index));
    setSelectedTasks((prev) => prev.filter((i) => i !== index).map((i) => (i > index ? i - 1 : i)));
  };

  return (
    <Modal
      title={
        <span className="inline-flex items-center gap-2">
          <Sparkles size={16} className="text-indigo-500" />
          <span>Générer des tâches avec l'IA</span>
        </span>
      }
      wide
      onClose={onClose}
      footer={
        generatedTasks.length > 0 ? (
          <>
            <Button size="sm" onClick={() => setGeneratedTasks([])}>
              Recommencer
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={selectedTasks.length === 0}
              icon={<Plus size={14} />}
              onClick={handleImport}
            >
              Ajouter {selectedTasks.length} tâche{selectedTasks.length > 1 ? 's' : ''} au Kanban
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" onClick={onClose}>
              Annuler
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={loading || goal.trim() === ''}
              icon={loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              onClick={handleGenerate}
            >
              {loading ? 'Génération en cours…' : 'Générer le plan de tâches'}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4">
        {generatedTasks.length === 0 ? (
          <>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Objectif ou projet à découper
              </label>
              <textarea
                autoFocus
                className="field min-h-24 w-full p-3 text-sm leading-relaxed"
                placeholder="Exemple : Mettre en place un système d'authentification sécurisé avec JWT, refresh tokens, pages de connexion/inscription et réinitialisation de mot de passe..."
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                disabled={loading}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Colonne de destination
                </label>
                <Select
                  className="w-full"
                  value={targetColumnId}
                  options={columns.map((c) => ({
                    value: c.id,
                    label: c.title,
                  }))}
                  onChange={(e) => setTargetColumnId(e.target.value)}
                  disabled={loading}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Nombre de tâches souhaité
                </label>
                <Select
                  className="w-full"
                  value={String(taskCount)}
                  options={[
                    { value: '3', label: '3 tâches principales' },
                    { value: '4', label: '4 tâches' },
                    { value: '5', label: '5 tâches détaillées' },
                    { value: '7', label: '7 tâches complètes' },
                  ]}
                  onChange={(e) => setTaskCount(Number(e.target.value))}
                  disabled={loading}
                />
              </div>
            </div>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
                {error}
              </div>
            )}
          </>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Sélectionne et vérifie les tâches générées avant de les ajouter à la colonne{' '}
              <strong>{columns.find((c) => c.id === targetColumnId)?.title}</strong> :
            </p>

            <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
              {generatedTasks.map((task, idx) => {
                const selected = selectedTasks.includes(idx);
                const priority = PRIORITY_META[task.priority];

                return (
                  <div
                    key={idx}
                    className={`rounded-lg border p-3 transition-colors ${
                      selected
                        ? 'border-indigo-300 bg-indigo-50/40 dark:border-indigo-800 dark:bg-indigo-950/20'
                        : 'border-zinc-200 opacity-60 dark:border-zinc-800'
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleSelectTask(idx)}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-indigo-600"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <input
                            className="flex-1 bg-transparent text-sm font-semibold tracking-tight focus:outline-none"
                            value={task.title}
                            onChange={(e) => {
                              const newTitle = e.target.value;
                              setGeneratedTasks((prev) =>
                                prev.map((t, i) => (i === idx ? { ...t, title: newTitle } : t)),
                              );
                            }}
                          />
                          <span
                            className="inline-flex items-center gap-1 text-[11px] font-medium"
                            style={{ color: priority.color }}
                          >
                            <Flag size={11} />
                            {priority.label}
                          </span>
                          <button
                            type="button"
                            aria-label="Supprimer la tâche"
                            className="text-zinc-400 hover:text-red-500"
                            onClick={() => removeGeneratedTask(idx)}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>

                        {task.description && (
                          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
                            {task.description}
                          </p>
                        )}

                        {task.checklist.length > 0 && (
                          <div className="mt-2 space-y-1 rounded-md bg-white/70 p-2 text-xs dark:bg-zinc-900/60">
                            <div className="flex items-center gap-1 font-medium text-zinc-500 dark:text-zinc-400">
                              <ListTodo size={12} />
                              <span>Sous-tâches ({task.checklist.length}) :</span>
                            </div>
                            <ul className="list-inside list-disc space-y-0.5 pl-1 text-zinc-600 dark:text-zinc-300">
                              {task.checklist.map((item, itemIdx) => (
                                <li key={itemIdx}>{item}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
