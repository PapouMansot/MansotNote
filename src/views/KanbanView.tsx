/**
 * KanbanView — board drag & drop (dnd-kit) :
 *  - cartes réordonnables dans une colonne, déplaçables entre colonnes ;
 *  - colonnes réordonnables par l'en-tête ;
 *  - filtres (recherche, priorité, étiquettes) dans la barre supérieure ;
 *  - la carte active s'ouvre dans CardModal (createCard l'ouvre aussi).
 */
import { useState } from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { Archive, Flag, Plus, RotateCcw, Sparkles, SquareKanban, Wrench } from 'lucide-react';
import type { KanbanDragPayload, Priority } from '@/types';
import { DEFAULT_KANBAN_FILTER } from '@/constants';
import { selectKanbanFiltersActive, selectColumnsWithCards } from '@/store/selectors';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app-store';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { SearchInput } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { KanbanColumn } from '@/components/kanban/KanbanColumn';
import { CardModal } from '@/components/kanban/CardModal';
import { AiTaskModal } from '@/components/kanban/AiTaskModal';
import { PRIORITY_META, PRIORITY_ORDER } from '@/components/kanban/priority';

type ActiveDrag = KanbanDragPayload | null;

export function KanbanView() {
  const state = useAppStore();
  const [activeDrag, setActiveDrag] = useState<ActiveDrag>(null);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [newColumnTitle, setNewColumnTitle] = useState('');
  const [addingColumn, setAddingColumn] = useState(false);

  const columns = selectColumnsWithCards(state);
  const filters = state.ui.kanbanFilter;
  const filtersActive = selectKanbanFiltersActive(state);

  useKeyboardShortcuts({
    'card.new': () => {
      const st = useAppStore.getState();
      const first = [...st.data.columns].sort((a, b) => a.order - b.order)[0];
      if (first === undefined) {
        return;
      }
      st.createCard(first.id);
      st.toast('success', 'Nouvelle carte créée');
    },
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  /* ---------------------------- Logique de drag ---------------------------- */
  const handleDragStart = (event: DragStartEvent) => {
    const payload = event.active.data.current as KanbanDragPayload | undefined;
    if (payload !== undefined) {
      setActiveDrag(payload);
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (over === null) {
      return;
    }
    const payload = active.data.current as KanbanDragPayload | undefined;
    if (payload?.type !== 'card' || String(over.id) === String(active.id)) {
      return;
    }
    const st = useAppStore.getState();
    const overId = String(over.id);
    const overIsColumn = overId.startsWith('col-');
    const overColumnId = overIsColumn
      ? overId.slice(4)
      : st.data.cards.find((c) => c.id === overId.slice(4))?.columnId;
    if (overColumnId === undefined || overColumnId === payload.fromColumnId) {
      return;
    }
    // Changement de colonne : on déplace la carte en direct (aperçu vivant).
    const targetCards = st.data.cards
      .filter((c) => c.columnId === overColumnId && c.id !== payload.cardId);
    const index = overIsColumn
      ? targetCards.length
      : Math.max(
          0,
          targetCards.findIndex((c) => c.id === overId.slice(4)),
        );
    st.moveCard(payload.cardId, overColumnId, index);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDrag(null);
    const { active, over } = event;
    if (over === null) {
      return;
    }
    const st = useAppStore.getState();
    const payload = active.data.current as KanbanDragPayload | undefined;
    if (payload === undefined) {
      return;
    }

    /* ------- Réordonnancement des colonnes ------- */
    if (payload.type === 'column') {
      const overPayload = over.data.current as KanbanDragPayload | undefined;
      if (overPayload?.type !== 'column' || overPayload.columnId === payload.columnId) {
        return;
      }
      const ordered = columns.map((entry) => entry.column.id);
      const from = ordered.indexOf(payload.columnId);
      const to = ordered.indexOf(overPayload.columnId);
      if (from === -1 || to === -1) {
        return;
      }
      ordered.splice(from, 1);
      ordered.splice(to, 0, payload.columnId);
      st.reorderColumns(ordered);
      return;
    }

    /* ------- Réordonnancement / dépôt de la carte ------- */
    const card = st.data.cards.find((c) => c.id === payload.cardId);
    if (card === undefined) {
      return;
    }
    const overId = String(over.id);
    const overIsColumn = overId.startsWith('col-');
    const overColumnId = overIsColumn
      ? overId.slice(4)
      : st.data.cards.find((c) => c.id === overId.slice(4))?.columnId;
    if (overColumnId === undefined) {
      return;
    }

    if (overIsColumn) {
      // Dépôt sur le corps de la colonne : fin de liste.
      const index = st.data.cards
        .filter((c) => c.columnId === overColumnId && c.id !== card.id)
        .length;
      st.moveCard(card.id, overColumnId, index);
      return;
    }

    const overCard = st.data.cards.find((c) => c.id === overId.slice(4));
    if (overCard === undefined || overCard.id === card.id) {
      return;
    }
    const colCards = st.data.cards
      .filter((c) => c.columnId === overCard.columnId)
      .sort((a, b) => a.order - b.order);
    const overIndex = colCards.findIndex((c) => c.id === overCard.id);
    const fromIndex = colCards.findIndex((c) => c.id === card.id);
    // `moveCard` insère la carte dans la liste sans elle :
    // si on arrive depuis le bas, on prend l'index de `over` moins un.
    const index =
      fromIndex !== -1 && fromIndex < overIndex ? overIndex - 1 : overIndex;
    st.moveCard(card.id, overCard.columnId, index);
  };

  const addColumn = (title = newColumnTitle) => {
    const value = title.trim();
    if (value === '') return;
    state.addColumn(value);
    state.toast('success', `Colonne « ${value} » créée`);
    setNewColumnTitle('');
    setAddingColumn(false);
  };

  const restoreDefaultColumns = () => {
    const normalized = new Set(columns.map(({ column }) => column.title.trim().toLocaleLowerCase('fr')));
    const missing = ['À faire', 'En cours', 'Terminé'].filter(
      (title) => !normalized.has(title.toLocaleLowerCase('fr')),
    );
    missing.forEach((title) => state.addColumn(title));
    state.toast(
      missing.length > 0 ? 'success' : 'info',
      missing.length > 0 ? `${missing.length} colonne${missing.length > 1 ? 's' : ''} restaurée${missing.length > 1 ? 's' : ''}` : 'Les trois colonnes par défaut existent déjà',
    );
  };

  /* ------------------------------- Rendu ---------------------------------- */
  if (columns.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <BoardHeader filters={filters} filtersActive={filtersActive} />
        <div className="flex-1">
          <EmptyState
            icon={<SquareKanban size={22} />}
            title="Aucune colonne"
            description="Crée une colonne pour commencer à organiser tes cartes."
            action={
              <Button
                variant="primary"
                icon={<SquareKanban size={15} />}
                onClick={() => {
                  state.addColumn('À faire');
                  state.toast('success', 'Colonne « À faire » créée');
                }}
              >
                Créer une colonne
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <BoardHeader
        filters={filters}
        filtersActive={filtersActive}
        onOpenAiTasks={() => setAiModalOpen(true)}
        onAddColumn={() => setAddingColumn(true)}
        onRestoreDefaults={restoreDefaultColumns}
      />
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveDrag(null)}
      >
        <SortableContext
          items={columns.map((entry) => `col-${entry.column.id}`)}
          strategy={horizontalListSortingStrategy}
        >
          <div className="flex min-h-0 flex-1 items-start gap-3 overflow-x-auto p-4">
            {columns.map(({ column, cards }) => (
              <KanbanColumn key={column.id} column={column} cards={cards} />
            ))}
            <div className="w-72 shrink-0">
              {addingColumn ? (
                <form
                  className="rounded-xl border border-zinc-200 bg-zinc-100/80 p-3 dark:border-zinc-800 dark:bg-zinc-900/50"
                  onSubmit={(event) => {
                    event.preventDefault();
                    addColumn();
                  }}
                >
                  <input
                    autoFocus
                    className="field w-full"
                    value={newColumnTitle}
                    onChange={(event) => setNewColumnTitle(event.target.value)}
                    placeholder="Nom de la colonne"
                    maxLength={80}
                  />
                  <div className="mt-2 flex gap-2">
                    <Button type="submit" variant="primary" size="sm" disabled={newColumnTitle.trim() === ''}>
                      Ajouter
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setAddingColumn(false)}>
                      Annuler
                    </Button>
                  </div>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setAddingColumn(true)}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 px-4 py-3 text-sm font-medium text-zinc-500 transition-colors hover:border-indigo-400 hover:bg-indigo-50 hover:text-indigo-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-indigo-500 dark:hover:bg-indigo-950/30 dark:hover:text-indigo-300"
                >
                  <Plus size={16} />
                  Ajouter une colonne
                </button>
              )}
            </div>
          </div>
        </SortableContext>
      </DndContext>
      {activeDrag !== null && activeDrag.type === 'card' && (
        <span className="sr-only">Carte en cours de déplacement</span>
      )}
      {state.ui.activeCardId !== null && (
        <CardModal cardId={state.ui.activeCardId} />
      )}
      {aiModalOpen && (
        <AiTaskModal onClose={() => setAiModalOpen(false)} />
      )}
    </div>
  );
}

/* --------------------------- Barre d'en-tête ---------------------------- */
interface BoardHeaderProps {
  filters: {
    search: string;
    priorities: Priority[];
    labelIds: string[];
    showArchived?: boolean;
  };
  filtersActive: boolean;
  onOpenAiTasks?: () => void;
  onAddColumn?: () => void;
  onRestoreDefaults?: () => void;
}

function BoardHeader({ filters, filtersActive, onOpenAiTasks, onAddColumn, onRestoreDefaults }: BoardHeaderProps) {
  const state = useAppStore();

  return (
    <header className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
      <h1 className="mr-1 text-sm font-semibold tracking-tight">Kanban</h1>
      {onOpenAiTasks !== undefined && (
        <Button
          variant="primary"
          size="sm"
          icon={<Sparkles size={14} />}
          onClick={onOpenAiTasks}
        >
          Tâches IA
        </Button>
      )}
      {onAddColumn !== undefined && (
        <Button variant="secondary" size="sm" icon={<Plus size={14} />} onClick={onAddColumn}>
          Colonne
        </Button>
      )}
      {onRestoreDefaults !== undefined && (
        <Button
          variant="ghost"
          size="sm"
          icon={<Wrench size={14} />}
          onClick={onRestoreDefaults}
          title="Restaurer les colonnes À faire, En cours et Terminé sans toucher aux cartes"
        >
          Réparer
        </Button>
      )}
      <SearchInput
        value={filters.search}
        onChange={(value) => state.setKanbanFilter({ search: value })}
        placeholder="Rechercher une carte…"
        className="w-52"
      />
      <span className="hidden items-center gap-1 text-[11px] text-zinc-400 dark:text-zinc-500 sm:inline-flex">
        <Flag size={11} />
        Priorité :
      </span>
      {PRIORITY_ORDER.map((p) => (
        <Badge
          key={p}
          label={PRIORITY_META[p].label}
          active={filters.priorities.includes(p)}
          onClick={() => {
            const active = filters.priorities.includes(p);
            state.setKanbanFilter({
              priorities: active
                ? filters.priorities.filter((id) => id !== p)
                : [...filters.priorities, p],
            });
          }}
        />
      ))}
      {state.data.labels.map((label) => (
        <Badge
          key={label.id}
          color={label.color}
          label={label.name}
          active={filters.labelIds.includes(label.id)}
          onClick={() => {
            const active = filters.labelIds.includes(label.id);
            state.setKanbanFilter({
              labelIds: active
                ? filters.labelIds.filter((id) => id !== label.id)
                : [...filters.labelIds, label.id],
            });
          }}
        />
      ))}
      <button
        type="button"
        title="Afficher les cartes archivées"
        aria-pressed={filters.showArchived}
        onClick={() => state.setKanbanFilter({ showArchived: !filters.showArchived })}
        className={cn(
          'flex h-7 items-center gap-1 rounded-lg border px-2 text-xs font-medium transition-colors',
          filters.showArchived
            ? 'border-amber-400/60 bg-amber-500/10 text-amber-700 dark:text-amber-300'
            : 'border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800',
        )}
      >
        <Archive size={12} />
        <span>Archives</span>
      </button>
      {filtersActive && (
        <Button
          size="sm"
          variant="ghost"
          icon={<RotateCcw size={13} />}
          className={cn('text-xs')}
          onClick={() => state.setKanbanFilter(DEFAULT_KANBAN_FILTER)}
        >
          Réinitialiser
        </Button>
      )}
    </header>
  );
}
