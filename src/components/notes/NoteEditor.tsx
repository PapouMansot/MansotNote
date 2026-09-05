/**
 * NoteEditor — éditeur de la note active :
 *  - titre + modes (écriture / aperçu / split, Ctrl+Shift+E pour cycler) ;
 *  - actions : épingler, dupliquer, exporter .md, supprimer ;
 *  - barre d'état : statut d'autosave (useAutosave) + compteurs.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  Check,
  Columns2,
  Copy,
  Download,
  Eye,
  Folder,
  FolderMinus,
  Languages,
  List,
  Pencil,
  Pin,
  Sparkles,
  Tag as TagIcon,
  Trash2,
} from 'lucide-react';
import type { EditorMode, Note } from '@/types';
import { countWords } from '@/lib/markdown';
import {
  downloadText,
  exportNoteFileName,
  noteToMarkdown,
} from '@/lib/export';
import { formatTime } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app-store';
import { useAutosave } from '@/hooks/useAutosave';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import {
  correctText,
  isAiConfigured,
  isTextUnchanged,
  transformNote,
  type AiConfig,
  type AiTransformAction,
} from '@/lib/ai';
import { MarkdownRenderer } from '@/components/markdown/MarkdownRenderer';
import { IconButton } from '@/components/ui/IconButton';
import { Menu } from '@/components/ui/Menu';
import { AiTransformModal } from '@/components/ai/AiTransformModal';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { FormattingToolbar } from './FormattingToolbar';
import { FloatingSelectionMenu } from './FloatingSelectionMenu';
import {
  replaceSelectionInMarkdown,
  updateBlock,
  type MarkdownBlock,
} from '@/lib/markdown-block';

const MODES: Array<{ id: EditorMode; icon: typeof Pencil; label: string }> = [
  { id: 'edit', icon: Pencil, label: 'Écriture' },
  { id: 'preview', icon: Eye, label: 'Aperçu' },
  { id: 'split', icon: Columns2, label: 'Côte à côte' },
];

function SaveIndicator() {
  const { dirty, saveStatus, saveError } = useAutosave();
  let dot = 'bg-zinc-300 dark:bg-zinc-600';
  let label = 'Prêt';
  if (saveStatus === 'saving') {
    dot = 'bg-sky-500 animate-pulse';
    label = 'Enregistrement…';
  } else if (saveStatus === 'error') {
    dot = 'bg-red-500';
    label = saveError ?? 'Erreur de sauvegarde';
  } else if (saveStatus === 'saved' || dirty === false) {
    dot = 'bg-emerald-500';
    label = 'Enregistré';
  } else if (dirty) {
    dot = 'bg-amber-500';
    label = 'Modifications non enregistrées';
  }
  return (
    <span className="inline-flex items-center gap-1.5" title={label}>
      <span className={cn('h-2 w-2 rounded-full', dot)} />
      {saveStatus === 'saved' && label === 'Enregistré' && (
        <Check size={12} className="text-emerald-500" />
      )}
      <span className="truncate">{label}</span>
    </span>
  );
}

export function NoteEditor() {
  const state = useAppStore();
  const draft = state.ui.noteDraft;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiPreview, setAiPreview] = useState<{
    label: string;
    markdown: string;
    original?: string;
    scope?: 'note' | 'selection';
    range?: { start: number; end: number };
  } | null>(null);
  const [floatingPos, setFloatingPos] = useState<{ x: number; y: number } | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  // Historique local pour Annuler / Rétablir
  const [history, setHistory] = useState<string[]>([draft?.content ?? '']);
  const [historyIndex, setHistoryIndex] = useState(0);
  const currentNoteIdRef = useRef(draft?.noteId);

  const note: Note | undefined = useMemo(
    () =>
      draft?.noteId !== null && draft?.noteId !== undefined
        ? state.data.notes.find((n) => n.id === draft.noteId)
        : undefined,
    [state.data.notes, draft],
  );
  const mode = state.data.settings.editorMode;

  const isArchived = note?.archived === true;

  const toggleArchive = () => {
    if (!note) return;
    if (isArchived) {
      state.unarchiveNote(note.id);
      state.toast('success', 'Note désarchivée');
    } else {
      state.archiveNote(note.id);
      state.toast('info', 'Note archivée');
    }
  };

  // Réinitialise l'historique quand on change de note
  useEffect(() => {
    if (draft?.noteId && draft.noteId !== currentNoteIdRef.current) {
      currentNoteIdRef.current = draft.noteId;
      setHistory([draft.content ?? '']);
      setHistoryIndex(0);
    }
  }, [draft?.noteId, draft?.content]);

  if (draft === null || note === undefined) {
    return null;
  }

  const folderName =
    note.folderId !== null
      ? (state.data.folders.find((f) => f.id === note.folderId)?.name ?? null)
      : null;
  const tagNames = note.tagIds
    .map((id) => state.data.tags.find((t) => t.id === id)?.name)
    .filter((name): name is string => name !== undefined);

  /* ------------------------------- Historique ---------------------------- */
  const pushHistory = (newContent: string) => {
    state.setDraft({ content: newContent });
    setHistory((prev) => {
      const branch = prev.slice(0, historyIndex + 1);
      return [...branch, newContent].slice(-50);
    });
    setHistoryIndex((prev) => Math.min(prev + 1, 49));
  };

  const undo = () => {
    if (historyIndex > 0) {
      const nextIndex = historyIndex - 1;
      setHistoryIndex(nextIndex);
      const targetContent = history[nextIndex];
      state.setDraft({ content: targetContent });
    }
  };

  const redo = () => {
    if (historyIndex < history.length - 1) {
      const nextIndex = historyIndex + 1;
      setHistoryIndex(nextIndex);
      const targetContent = history[nextIndex];
      state.setDraft({ content: targetContent });
    }
  };

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  /* ------------------------------- Formatage ----------------------------- */
  const formatInline = (prefix: string, suffix: string, placeholder: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const currentVal = draft.content ?? '';
    const selected = currentVal.slice(start, end);
    const inner = selected || placeholder;
    const rep = `${prefix}${inner}${suffix}`;
    const newContent = currentVal.slice(0, start) + rep + currentVal.slice(end);
    pushHistory(newContent);
    setTimeout(() => {
      el.focus();
      if (selected) {
        el.setSelectionRange(start, start + rep.length);
      } else {
        el.setSelectionRange(start + prefix.length, start + prefix.length + placeholder.length);
      }
    }, 0);
  };

  const formatLinePrefix = (prefix: string, stripHeading = false) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const currentVal = draft.content ?? '';
    const lineStart = currentVal.lastIndexOf('\n', start - 1) + 1;
    const lineEndIdx = currentVal.indexOf('\n', end);
    const lineEnd = lineEndIdx === -1 ? currentVal.length : lineEndIdx;
    const targetChunk = currentVal.slice(lineStart, lineEnd);
    const lines = targetChunk.split('\n');
    const formattedLines = lines.map((line) => {
      let clean = line;
      if (stripHeading) {
        clean = clean.replace(/^#{1,6}\s+/, '');
      }
      return `${prefix}${clean}`;
    });
    const rep = formattedLines.join('\n');
    const newContent = currentVal.slice(0, lineStart) + rep + currentVal.slice(lineEnd);
    pushHistory(newContent);
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(lineStart, lineStart + rep.length);
    }, 0);
  };

  const formatCodeBlock = (lang: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const currentVal = draft.content ?? '';
    const selected = currentVal.slice(start, end);
    const sample =
      selected ||
      (lang === 'bash'
        ? 'npm install\nnpm run dev'
        : lang === 'typescript' || lang === 'javascript'
          ? 'const message = "Hello";\nconsole.log(message);'
          : lang === 'json'
            ? '{\n  "status": "ok"\n}'
            : 'echo "hello"');

    const before = currentVal.slice(0, start);
    const after = currentVal.slice(end);
    const padBefore =
      before.length > 0 && !before.endsWith('\n\n')
        ? before.endsWith('\n')
          ? '\n'
          : '\n\n'
        : '';
    const padAfter =
      after.length > 0 && !after.startsWith('\n\n')
        ? after.startsWith('\n')
          ? '\n'
          : '\n\n'
        : '';

    const rep = `${padBefore}\`\`\`${lang}\n${sample}\n\`\`\`${padAfter}`;
    const newContent = before + rep + after;
    pushHistory(newContent);
    setTimeout(() => {
      el.focus();
      const codeStart = start + padBefore.length + `\`\`\`${lang}\n`.length;
      el.setSelectionRange(codeStart, codeStart + sample.length);
    }, 0);
  };

  const formatLink = () => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const currentVal = draft.content ?? '';
    const selected = currentVal.slice(start, end);
    const text = selected || 'texte du lien';
    const rep = `[${text}](https://)`;
    const newContent = currentVal.slice(0, start) + rep + currentVal.slice(end);
    pushHistory(newContent);
    setTimeout(() => {
      el.focus();
      const urlStart = start + rep.length - 9;
      el.setSelectionRange(urlStart, urlStart + 8);
    }, 0);
  };

  /* ------------------------ Détection de sélection ----------------------- */
  const checkSelection = (clientX?: number, clientY?: number) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (start !== end && el.value.slice(start, end).trim().length > 0) {
      const rect = el.getBoundingClientRect();
      const x =
        clientX !== undefined
          ? Math.min(Math.max(clientX - 100, rect.left + 10), rect.right - 280)
          : Math.max(rect.left + 40, 20);
      const y =
        clientY !== undefined
          ? Math.max(clientY - 46, rect.top + 8)
          : Math.max(rect.top + 40, 40);
      setFloatingPos({ x, y });
    } else {
      setFloatingPos(null);
    }
  };

  const doExport = () => {
    const filename = exportNoteFileName(note);
    downloadText(
      filename,
      noteToMarkdown(note, {
        folderName: folderName ?? null,
        tagNames,
      }),
    );
    state.toast('success', `Exporté dans ${filename}`);
  };

  /* ------------------------------- IA ------------------------------------ */
  const runTransform = (action: AiTransformAction, label: string) => {
    if (draft.content.trim() === '') {
      state.toast('info', 'Rien à transformer : la note est vide.');
      return;
    }
    const st = useAppStore.getState();
    const config: AiConfig = {
      endpoint: st.data.settings.aiEndpoint,
      apiKey: st.data.settings.aiApiKey,
      model: st.data.settings.aiModel,
      keepAlive: st.data.settings.aiKeepAlive,
    };
    if (!isAiConfigured(config)) {
      st.toast('error', 'IA non configurée — ouvre « Note IA » dans la liste des notes.');
      return;
    }
    setAiBusy(true);
    transformNote(config, action, draft.content)
      .then((markdown) =>
        setAiPreview({
          label,
          markdown,
          original: draft.content,
          scope: 'note',
        }),
      )
      .catch((err: unknown) => {
        st.toast(
          'error',
          err instanceof Error ? err.message : 'La transformation a échoué',
        );
      })
      .finally(() => setAiBusy(false));
  };

  const runCorrect = (scope: 'selection' | 'note' = 'selection') => {
    const el = textareaRef.current;
    const currentContent = draft.content ?? '';
    if (currentContent.trim() === '') {
      state.toast('info', 'La note est vide.');
      return;
    }

    const st = useAppStore.getState();
    const config: AiConfig = {
      endpoint: st.data.settings.aiEndpoint,
      apiKey: st.data.settings.aiApiKey,
      model: st.data.settings.aiModel,
      keepAlive: st.data.settings.aiKeepAlive,
    };
    if (!isAiConfigured(config)) {
      state.toast('error', 'IA non configurée — vérifie les paramètres IA.');
      return;
    }

    let targetText = currentContent;
    let start = 0;
    let end = currentContent.length;

    if (scope === 'selection' && el) {
      const s = el.selectionStart;
      const e = el.selectionEnd;
      if (s !== e && s >= 0 && e <= currentContent.length) {
        targetText = currentContent.slice(s, e);
        start = s;
        end = e;
      }
    }

    if (targetText.trim() === '') {
      state.toast('info', 'Sélectionne du texte à corriger ou lance la correction sur toute la note.');
      return;
    }

    setAiBusy(true);
    setFloatingPos(null);
    state.toast('info', 'Correction en cours…');
    correctText(config, targetText)
      .then((corrected) => {
        if (isTextUnchanged(targetText, corrected)) {
          state.toast('success', '✨ Aucune faute détectée !');
          return;
        }

        if (scope === 'selection' && start !== end) {
          const newContent = currentContent.slice(0, start) + corrected + currentContent.slice(end);
          pushHistory(newContent);
          state.toast('success', 'Correction appliquée — Ctrl+Z pour annuler');
          setTimeout(() => {
            if (el) {
              el.focus();
              el.setSelectionRange(start, start + corrected.length);
            }
          }, 0);
        } else {
          setAiPreview({
            label: 'Correction orthographique & grammaticale',
            markdown: corrected,
            original: currentContent,
            scope: 'note',
          });
        }
      })
      .catch((err: unknown) => {
        state.toast('error', err instanceof Error ? err.message : 'Échec de la correction');
      })
      .finally(() => setAiBusy(false));
  };

  const handlePreviewAiAction = (
    action: 'correct' | 'rewrite' | 'style' | 'resume',
    targetText: string,
    block?: MarkdownBlock,
  ) => {
    const config: AiConfig = {
      endpoint: state.data.settings.aiEndpoint,
      apiKey: state.data.settings.aiApiKey,
      model: state.data.settings.aiModel,
      keepAlive: state.data.settings.aiKeepAlive,
    };
    if (!isAiConfigured(config)) {
      state.toast('error', 'IA non configurée — vérifie les paramètres IA.');
      return;
    }
    setAiBusy(true);
    state.toast('info', 'Traitement IA en cours…');
    const promise =
      action === 'correct'
        ? correctText(config, targetText)
        : transformNote(config, action, targetText);

    promise
      .then((result) => {
        if (isTextUnchanged(targetText, result)) {
          state.toast('success', '✨ Aucune modification requise !');
          return;
        }
        const currentContent = draft.content ?? '';
        let updatedMd = currentContent;
        if (block) {
          updatedMd = updateBlock(currentContent, block, result);
        } else {
          updatedMd = replaceSelectionInMarkdown(currentContent, targetText, result);
        }
        pushHistory(updatedMd);
        state.toast('success', 'Action IA appliquée directement sur la note !');
      })
      .catch((err: unknown) => {
        state.toast('error', err instanceof Error ? err.message : 'Échec de l’action IA');
      })
      .finally(() => setAiBusy(false));
  };

  const handleCreateKanbanTask = (text: string) => {
    const cols = state.data.columns;
    if (cols.length === 0) {
      state.toast('error', 'Aucune colonne Kanban disponible.');
      return;
    }
    const targetCol = cols[0];
    const firstLine = text.split('\n')[0].replace(/^[-*0-9.)\s[\]#]+/, '').trim();
    const title = firstLine.slice(0, 60) || 'Nouvelle tâche';
    state.createCard(targetCol.id, {
      title,
      description: text,
      linkedNoteId: note?.id ?? null,
      priority: 'medium',
    });
    state.toast('success', `Tâche « ${title} » ajoutée au Kanban !`);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
    const modKey = isMac ? e.metaKey : e.ctrlKey;

    if (modKey && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      undo();
    } else if (
      (modKey && (e.key === 'y' || e.key === 'Y')) ||
      (modKey && e.shiftKey && (e.key === 'z' || e.key === 'Z'))
    ) {
      e.preventDefault();
      redo();
    } else if (modKey && (e.key === 'b' || e.key === 'B')) {
      e.preventDefault();
      formatInline('**', '**', 'texte en gras');
    } else if (modKey && (e.key === 'i' || e.key === 'I')) {
      e.preventDefault();
      formatInline('*', '*', 'texte en italique');
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const el = textareaRef.current;
      if (!el) return;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const val = draft.content ?? '';
      const rep = '  ';
      const newContent = val.slice(0, start) + rep + val.slice(end);
      pushHistory(newContent);
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start + rep.length, start + rep.length);
      }, 0);
    }
  };

  const words = countWords(draft.content);

  useKeyboardShortcuts({
    'note.correct': () => runCorrect('selection'),
  });

  const textareaClasses =
    'h-full w-full resize-none bg-transparent p-5 text-[15px] leading-relaxed focus:outline-none';

  return (
    <div className="flex h-full min-w-0 flex-col">
      {/* ------------------------------- Barre ------------------------------ */}
      <header className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
        <input
          className="min-w-40 flex-1 bg-transparent text-lg font-semibold tracking-tight focus:outline-none"
          placeholder="Sans titre"
          value={draft.title ?? ''}
          onChange={(e) => state.setDraft({ title: e.target.value })}
        />
        <div className="flex items-center gap-0.5 rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800/80">
          {MODES.map(({ id, icon: Icon, label }) => (
            <IconButton
              key={id}
              label={label}
              icon={<Icon size={15} />}
              active={mode === id}
              className="h-7 w-8"
              onClick={() => state.updateSettings({ editorMode: id })}
            />
          ))}
        </div>
        <Menu
          align="right"
          trigger={
            <IconButton
              label="Assistant IA"
              icon={<Sparkles size={15} />}
              active={aiBusy}
            />
          }
          items={[
            {
              label: aiBusy ? 'En cours…' : 'Corriger l’orthographe & style',
              icon: <Sparkles size={13} className="text-indigo-600 dark:text-indigo-400" />,
              onClick: () => runCorrect('selection'),
            },
            {
              label: aiBusy ? 'En cours…' : 'Corriger toute la note (Diff)',
              icon: <Sparkles size={13} />,
              onClick: () => runCorrect('note'),
            },
            {
              label: aiBusy ? 'En cours…' : 'Reformuler la note',
              icon: <Pencil size={13} />,
              onClick: () => runTransform('rewrite', 'Reformulation'),
            },
            {
              label: aiBusy ? 'En cours…' : 'Améliorer le style',
              icon: <Sparkles size={13} />,
              onClick: () => runTransform('style', 'Style & fluidité'),
            },
            {
              label: aiBusy ? 'En cours…' : 'Résumer la note',
              icon: <List size={13} />,
              onClick: () => runTransform('resume', 'Résumé'),
            },
            {
              label: aiBusy ? 'En cours…' : 'Traduire la note',
              icon: <Languages size={13} />,
              onClick: () => runTransform('translate', 'Traduction'),
            },
          ]}
        />
        {/* Dossier : les actions du store existaient déjà (moveNoteToFolder),
            il ne manquait que ce point d'entrée dans l'interface. */}
        <Menu
          align="right"
          trigger={
            <IconButton
              label={folderName !== null ? `Dossier : ${folderName}` : 'Classer dans un dossier'}
              icon={<Folder size={15} />}
              active={folderName !== null}
            />
          }
          items={[
            {
              label: 'Sans dossier',
              icon: <FolderMinus size={13} />,
              onClick: () => {
                state.moveNoteToFolder(note.id, null);
                state.toast('success', 'Note retirée du dossier');
              },
            },
            ...state.data.folders.map((f) => ({
              label: f.id === note.folderId ? `✓ ${f.name}` : f.name,
              icon: <Folder size={13} />,
              onClick: () => {
                state.moveNoteToFolder(note.id, f.id);
                state.toast('success', `Classée dans « ${f.name} »`);
              },
            })),
          ]}
        />
        {/* Tags : toggleNoteTag existait aussi sans interface associée. */}
        <Menu
          align="right"
          trigger={
            <IconButton
              label={
                tagNames.length > 0 ? `Tags : ${tagNames.join(', ')}` : 'Ajouter un tag'
              }
              icon={<TagIcon size={15} />}
              active={tagNames.length > 0}
            />
          }
          items={
            state.data.tags.length === 0
              ? [{ label: 'Aucun tag — créez-en un dans la sidebar', onClick: () => {} }]
              : state.data.tags.map((t) => ({
                  label: note.tagIds.includes(t.id) ? `✓ ${t.name}` : t.name,
                  icon: <TagIcon size={13} />,
                  onClick: () => {
                    state.toggleNoteTag(note.id, t.id);
                    state.toast(
                      'success',
                      note.tagIds.includes(t.id)
                        ? `Tag « ${t.name} » retiré`
                        : `Tag « ${t.name} » ajouté`,
                    );
                  },
                }))
          }
        />
        <div className="flex items-center gap-0.5">
          <IconButton
            label={isArchived ? 'Désarchiver la note' : 'Archiver la note'}
            icon={isArchived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
            active={isArchived}
            onClick={toggleArchive}
          />
          <IconButton
            label={note.pinned ? 'Désépingler' : 'Épingler'}
            icon={<Pin size={15} />}
            active={note.pinned}
            onClick={() => state.togglePin(note.id)}
          />
          <IconButton
            label="Dupliquer"
            icon={<Copy size={15} />}
            onClick={() => {
              state.duplicateNote(note.id);
              state.toast('success', 'Note dupliquée');
            }}
          />
          <IconButton label="Exporter en .md" icon={<Download size={15} />} onClick={doExport} />
          <IconButton
            label="Supprimer"
            icon={<Trash2 size={15} />}
            danger
            onClick={() => setConfirmDeleteOpen(true)}
          />
        </div>
      </header>

      {/* -------------------- Barre d'outils de formatage ------------------- */}
      {(mode === 'edit' || mode === 'split') && (
        <FormattingToolbar
          textareaRef={textareaRef}
          content={draft.content ?? ''}
          onChange={(newContent) => pushHistory(newContent)}
          onUndo={undo}
          onRedo={redo}
          canUndo={canUndo}
          canRedo={canRedo}
        />
      )}

      {/* ------------------------------ Contenu ------------------------------ */}
      <div className="flex min-h-0 flex-1">
        {(mode === 'edit' || mode === 'split') && (
          <div className={cn('relative flex-1', mode === 'split' && 'w-1/2 border-r border-zinc-200 dark:border-zinc-800')}>
            <textarea
              ref={textareaRef}
              className={textareaClasses}
              placeholder="Écris ton texte ici ou utilise la barre de formatage ci-dessus…"
              spellCheck={false}
              value={draft.content ?? ''}
              onChange={(e) => {
                state.setDraft({ content: e.target.value });
              }}
              onKeyDown={handleKeyDown}
              onMouseUp={(e) => checkSelection(e.clientX, e.clientY)}
              onKeyUp={() => checkSelection()}
              onScroll={() => setFloatingPos(null)}
            />

            {/* Menu bulle flottant sur sélection */}
            <FloatingSelectionMenu
              position={floatingPos}
              onFormatInline={formatInline}
              onFormatLinePrefix={formatLinePrefix}
              onFormatCodeBlock={formatCodeBlock}
              onFormatLink={formatLink}
              onAiAction={(action) => {
                if (action === 'correct') {
                  runCorrect('selection');
                } else {
                  runTransform(action, action === 'rewrite' ? 'Reformulation' : action === 'style' ? 'Style' : 'Traduction');
                }
              }}
              onClose={() => setFloatingPos(null)}
            />
          </div>
        )}
        {(mode === 'preview' || mode === 'split') && (
          <div
            className={cn(
              // `flex-1` : sans cela, en mode Aperçu seul, ce conteneur n'a
              // aucune règle de largeur dans le parent flex et se réduit à la
              // taille de son contenu au lieu d'occuper toute la zone.
              'min-h-0 min-w-0 flex-1 overflow-y-auto px-6 py-4',
              mode === 'split' && 'w-1/2',
            )}
          >
            <MarkdownRenderer
              markdown={draft.content}
              // Cocher une case met à jour le Markdown source, en passant par
              // l'historique afin que Ctrl+Z annule aussi cette action.
              onMarkdownChange={pushHistory}
              onAiAction={handlePreviewAiAction}
              onCreateKanbanTask={handleCreateKanbanTask}
            />
          </div>
        )}
      </div>

      {/* ---------------------------- Barre d'état --------------------------- */}
      <footer className="flex items-center gap-4 border-t border-zinc-200 px-4 py-1.5 text-[11px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        <SaveIndicator />
        <span className="ml-auto tabular-nums">
          {words} mot{words > 1 ? 's' : ''} · {draft.content.length} car.
        </span>
        <span className="tabular-nums" title="Dernière modification">
          modifié {formatTime(note.updatedAt)}
        </span>
      </footer>

      {aiPreview !== null && (
        <AiTransformModal
          actionLabel={aiPreview.label}
          markdown={aiPreview.markdown}
          original={aiPreview.original}
          scope={aiPreview.scope}
          onClose={() => setAiPreview(null)}
          onApply={() => {
            pushHistory(aiPreview.markdown);
            state.toast('success', `${aiPreview.label} appliquée à la note`);
            setAiPreview(null);
          }}
        />
      )}

      <ConfirmModal
        open={confirmDeleteOpen}
        title="Supprimer la note"
        message={`Es-tu sûr de vouloir supprimer définitivement la note « ${note.title || 'Sans titre'} » ?`}
        confirmLabel="Supprimer"
        onConfirm={() => {
          state.deleteNote(note.id);
          state.toast('info', 'Note supprimée');
          setConfirmDeleteOpen(false);
        }}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
    </div>
  );
}
