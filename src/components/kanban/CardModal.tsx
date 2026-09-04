/**
 * CardModal — détail/édition d'une carte Kanban :
 * titre, description Markdown (aperçu), priorité, échéance,
 * étiquettes, sous-tâches, note liée, suppression.
 */
import { useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  Check,
  Eye,
  Loader2,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type { Priority } from '@/types';
import { COLOR_PALETTE } from '@/types';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app-store';
import {
  generateTaskChecklist,
  generateTaskDescription,
  isAiConfigured,
  type AiConfig,
} from '@/lib/ai';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Select } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { MarkdownRenderer } from '@/components/markdown/MarkdownRenderer';
import { PRIORITY_META, PRIORITY_ORDER } from './priority';

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
      {children}
    </p>
  );
}

export function CardModal({ cardId }: { cardId: string }) {
  const state = useAppStore();
  const card = state.data.cards.find((c) => c.id === cardId);
  const settings = state.data.settings;

  const [descriptionPreview, setDescriptionPreview] = useState(false);
  const [newChecklistItem, setNewChecklistItem] = useState('');
  const [newLabelName, setNewLabelName] = useState('');
  const [aiDescLoading, setAiDescLoading] = useState(false);
  const [aiChecklistLoading, setAiChecklistLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const aiConfig: AiConfig = {
    endpoint: settings.aiEndpoint ?? '',
    apiKey: settings.aiApiKey ?? '',
    model: settings.aiModel ?? '',
  };

  const configured = isAiConfigured(aiConfig);

  if (card === undefined) {
    return null;
  }

  const isArchived = card.archived === true;

  const toggleArchive = () => {
    if (isArchived) {
      state.unarchiveCard(card.id);
      state.toast('success', 'Carte désarchivée');
    } else {
      state.archiveCard(card.id);
      state.toast('info', 'Carte archivée');
    }
  };

  const close = () => state.setActiveCard(null);

  const handleGenerateDesc = async () => {
    if (!configured) {
      state.toast('error', "L'IA n'est pas configurée (ouvre Note IA ou les réglages).");
      return;
    }
    if (!card.title.trim()) {
      state.toast('info', 'Donne un titre à la tâche avant de générer la description.');
      return;
    }
    setAiDescLoading(true);
    try {
      const generated = await generateTaskDescription(aiConfig, card.title, card.description);
      state.updateCard(card.id, { description: generated });
      setDescriptionPreview(true);
      state.toast('success', 'Description rédigée par l\'IA !');
    } catch (err: unknown) {
      state.toast('error', err instanceof Error ? err.message : 'Erreur IA');
    } finally {
      setAiDescLoading(false);
    }
  };

  const handleGenerateChecklist = async () => {
    if (!configured) {
      state.toast('error', "L'IA n'est pas configurée.");
      return;
    }
    if (!card.title.trim()) {
      state.toast('info', 'Donne un titre à la tâche avant de générer les sous-tâches.');
      return;
    }
    setAiChecklistLoading(true);
    try {
      const items = await generateTaskChecklist(aiConfig, card.title, card.description);
      if (items.length === 0) {
        state.toast('info', 'Aucune sous-tâche générée.');
      } else {
        items.forEach((itemTitle) => {
          state.addChecklistItem(card.id, itemTitle);
        });
        state.toast('success', `${items.length} sous-tâches ajoutées !`);
      }
    } catch (err: unknown) {
      state.toast('error', err instanceof Error ? err.message : 'Erreur IA');
    } finally {
      setAiChecklistLoading(false);
    }
  };

  const addChecklist = () => {
    const title = newChecklistItem.trim();
    if (title !== '') {
      state.addChecklistItem(card.id, title);
      setNewChecklistItem('');
    }
  };

  const addLabel = () => {
    const name = newLabelName.trim();
    if (name !== '') {
      const labelId = state.createLabel(
        name,
        COLOR_PALETTE[state.data.labels.length % COLOR_PALETTE.length],
      );
      state.toggleCardLabel(card.id, labelId);
      setNewLabelName('');
      state.toast('success', `Étiquette « ${name} » créée`);
    }
  };

  const checklist = [...card.checklist].sort((a, b) => a.order - b.order);

  return (
    <Modal
      title="Carte"
      wide
      onClose={close}
      footer={
        <>
          <Button
            variant="ghost"
            size="sm"
            icon={isArchived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
            onClick={toggleArchive}
          >
            {isArchived ? 'Désarchiver' : 'Archiver'}
          </Button>
          <Button
            variant="danger"
            size="sm"
            icon={<Trash2 size={13} />}
            onClick={() => setConfirmDelete(true)}
          >
            Supprimer
          </Button>
          <Button size="sm" onClick={close}>
            Fermer
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {/* ------------------------------ Titre ------------------------------ */}
        <input
          className="w-full bg-transparent text-lg font-semibold tracking-tight focus:outline-none"
          placeholder="Titre de la carte"
          value={card.title}
          onChange={(e) => state.updateCard(card.id, { title: e.target.value })}
        />

        {/* ---------------------------- Description --------------------------- */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <SectionLabel>Description</SectionLabel>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={aiDescLoading}
                className="inline-flex items-center gap-1 text-xs text-indigo-600 transition-colors hover:text-indigo-700 disabled:opacity-50 dark:text-indigo-400 dark:hover:text-indigo-300"
                onClick={handleGenerateDesc}
                title="Rédiger ou enrichir la description avec l'IA"
              >
                {aiDescLoading ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Sparkles size={12} />
                )}
                <span>Rédiger avec l'IA</span>
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                onClick={() => setDescriptionPreview((value) => !value)}
              >
                {descriptionPreview ? <Pencil size={12} /> : <Eye size={12} />}
                {descriptionPreview ? 'Modifier' : 'Aperçu'}
              </button>
            </div>
          </div>
          {descriptionPreview ? (
            <div className="rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-700">
              <MarkdownRenderer markdown={card.description || '_Vide_'} />
            </div>
          ) : (
            <textarea
              className="field min-h-24 w-full resize-y p-3 text-sm leading-relaxed"
              placeholder="Décris la carte (Markdown)…"
              value={card.description}
              onChange={(e) => state.updateCard(card.id, { description: e.target.value })}
            />
          )}
        </div>

        {/* --------------------------- Priorité / date ------------------------ */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <SectionLabel>Priorité</SectionLabel>
            <Select
              className="w-full"
              value={card.priority}
              options={PRIORITY_ORDER.map((p) => ({
                value: p,
                label: PRIORITY_META[p].label,
              }))}
              onChange={(e) =>
                state.updateCard(card.id, { priority: e.target.value as Priority })
              }
            />
          </div>
          <div>
            <SectionLabel>Échéance</SectionLabel>
            <input
              type="date"
              className="field h-9 w-full px-3"
              value={card.dueDate ?? ''}
              onChange={(e) =>
                state.updateCard(card.id, {
                  dueDate: e.target.value === '' ? null : e.target.value,
                })
              }
            />
          </div>
        </div>

        {/* ----------------------------- Étiquettes --------------------------- */}
        <div>
          <SectionLabel>Étiquettes</SectionLabel>
          <div className="flex flex-wrap items-center gap-1.5">
            {state.data.labels.map((label) => {
              const applied = card.labelIds.includes(label.id);
              return (
                <span
                  key={label.id}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition-colors',
                    applied
                      ? ''
                      : 'opacity-50 hover:opacity-90',
                  )}
                  style={{
                    backgroundColor: `${label.color}26`,
                    color: label.color,
                  }}
                >
                  <button
                    type="button"
                    className="flex items-center gap-1.5"
                    onClick={() => state.toggleCardLabel(card.id, label.id)}
                    aria-pressed={applied}
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: label.color }}
                    />
                    {label.name}
                    {applied && <Check size={11} />}
                  </button>
                  <button
                    type="button"
                    aria-label={`Supprimer l'étiquette ${label.name}`}
                    className="rounded p-0.5 opacity-70 hover:opacity-100"
                    onClick={() => {
                      state.deleteLabel(label.id);
                      state.toast('info', `Étiquette « ${label.name} » supprimée`);
                    }}
                  >
                    <X size={11} />
                  </button>
                </span>
              );
            })}
            <span className="inline-flex items-center gap-1">
              <input
                className="h-6 w-28 rounded-md border border-zinc-300 bg-transparent px-2 text-xs focus:outline-none dark:border-zinc-700"
                placeholder="Nouvelle étiquette…"
                value={newLabelName}
                onChange={(e) => setNewLabelName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addLabel();
                }}
              />
              <button
                type="button"
                aria-label="Créer l'étiquette"
                className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                onClick={addLabel}
              >
                <Plus size={13} />
              </button>
            </span>
          </div>
        </div>

        {/* ----------------------------- Sous-tâches -------------------------- */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <SectionLabel>Sous-tâches</SectionLabel>
            <button
              type="button"
              disabled={aiChecklistLoading}
              className="inline-flex items-center gap-1 text-xs text-indigo-600 transition-colors hover:text-indigo-700 disabled:opacity-50 dark:text-indigo-400 dark:hover:text-indigo-300"
              onClick={handleGenerateChecklist}
              title="Générer automatiquement des sous-tâches avec l'IA"
            >
              {aiChecklistLoading ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Sparkles size={12} />
              )}
              <span>Découper avec l'IA</span>
            </button>
          </div>
          <ul className="space-y-1">
            {checklist.map((item) => (
              <li key={item.id} className="group flex items-center gap-2">
                <input
                  type="checkbox"
                  id={`task-${item.id}`}
                  className="h-4 w-4 shrink-0 accent-indigo-600"
                  checked={item.done}
                  onChange={() => state.toggleChecklistItem(card.id, item.id)}
                />
                <input
                  className={cn(
                    'min-w-0 flex-1 bg-transparent text-sm focus:outline-none',
                    item.done && 'text-zinc-400 line-through dark:text-zinc-500',
                  )}
                  value={item.title}
                  onChange={(e) =>
                    state.editChecklistItem(card.id, item.id, e.target.value)
                  }
                />
                <button
                  type="button"
                  aria-label="Supprimer la sous-tâche"
                  className="rounded p-1 text-zinc-400 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
                  onClick={() => state.removeChecklistItem(card.id, item.id)}
                >
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
            {checklist.length === 0 && (
              <li className="text-xs text-zinc-400 dark:text-zinc-500">
                Aucune sous-tâche.
              </li>
            )}
          </ul>
          <div className="mt-2 flex items-center gap-2">
            <input
              className="field h-8 flex-1 px-2.5 text-sm"
              placeholder="Ajouter une sous-tâche (Entrée)…"
              value={newChecklistItem}
              onChange={(e) => setNewChecklistItem(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addChecklist();
              }}
            />
            <IconButton
              label="Ajouter"
              icon={<Plus size={15} />}
              onClick={addChecklist}
            />
          </div>
        </div>

        {/* ------------------------------ Note liée --------------------------- */}
        <div>
          <SectionLabel>Note liée</SectionLabel>
          <Select
            className="w-full"
            value={card.linkedNoteId ?? ''}
            options={[
              { value: '', label: 'Aucune note liée' },
              ...state.data.notes.map((n) => ({
                value: n.id,
                label: n.title || 'Sans titre',
              })),
            ]}
            onChange={(e) =>
              state.updateCard(card.id, {
                linkedNoteId: e.target.value === '' ? null : e.target.value,
              })
            }
          />
        </div>
      </div>

      <ConfirmModal
        open={confirmDelete}
        title="Supprimer la carte"
        message={`Es-tu sûr de vouloir supprimer définitivement la carte « ${card.title || 'Sans titre'} » ?`}
        confirmLabel="Supprimer"
        onConfirm={() => {
          state.deleteCard(card.id);
          state.toast('info', 'Carte supprimée');
          setConfirmDelete(false);
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </Modal>
  );
}
