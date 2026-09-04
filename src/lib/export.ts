/**
 * Export Markdown — fonctions pures (testables en Node) + helper
 * de téléchargement navigateur.
 *
 *  - `noteToMarkdown`    : 1 note → document Markdown (front matter
 *    YAML optionnel, compatible Obsidian) ;
 *  - `notesToMarkdown`   : export combiné (1 document, 1 section par note) ;
 *  - `slugifyBase`       : nom de fichier ASCII sûr (accents retirés) ;
 *  - `downloadText`      : Blob + `<a download>` (navigateur uniquement,
 *    no-op en Node — la couche logique reste 100 % testable).
 *
 * Aucune dépendance React ni DOM obligatoire : ce module est importé
 * par les hooks, la modale de réglages et le menu « Exporter ».
 */
import type { Note } from '@/types';

/* ------------------------------------------------------------------ */
/* Front matter YAML                                                     */
/* ------------------------------------------------------------------ */

/** Échappe une chaîne dans un scalaire YAML double-quotes. */
function yamlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export interface NoteExportOptions {
  /** Bloc front matter YAML (titre, dates, dossier, tags). Défaut : true. */
  includeFrontMatter?: boolean;
  /** Nom du dossier contenant (front matter) ; null/omis = absent. */
  folderName?: string | null;
  /** Noms des tags appliqués (front matter) ; omis = vides. */
  tagNames?: string[];
}

/** Front matter YAML d'une note (ou '' si désactivé). */
export function toFrontMatter(note: Note, options: NoteExportOptions): string {
  const lines = ['---'];
  lines.push(`title: ${yamlString(note.title.trim() === '' ? 'Sans titre' : note.title.trim())}`);
  lines.push(`created: ${new Date(note.createdAt).toISOString()}`);
  lines.push(`updated: ${new Date(note.updatedAt).toISOString()}`);
  const folderName = options.folderName?.trim() ?? '';
  if (folderName !== '') {
    lines.push(`folder: ${yamlString(folderName)}`);
  }
  const tagNames = (options.tagNames ?? []).filter((t) => t.trim() !== '');
  if (tagNames.length > 0) {
    lines.push(`tags: [${tagNames.map(yamlString).join(', ')}]`);
  }
  lines.push('---');
  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/* Export de notes                                                       */
/* ------------------------------------------------------------------ */

/**
 * Une note → document Markdown autonome.
 *
 * Structure : front matter (optionnel), `# titre` (si titre non vide),
 * contenu. Une seule fin de ligne, aucun espace de fin superflu.
 */
export function noteToMarkdown(note: Note, options: NoteExportOptions = {}): string {
  const parts: string[] = [];
  if (options.includeFrontMatter ?? true) {
    parts.push(toFrontMatter(note, options));
  }
  const title = note.title.trim();
  if (title !== '') {
    parts.push(`# ${title}`);
  }
  const body = note.content.replace(/\s+$/, '');
  if (body !== '') {
    parts.push(body);
  }
  return parts.join('\n\n') + '\n';
}

export interface NotesExportOptions extends NoteExportOptions {
  /** Titre du document combiné. Défaut : 'MansotNote'. */
  title?: string;
}

/**
 * Plusieurs notes → un seul document, une section par note.
 * Les notes sont séparées par un trait horizontal (`---`).
 */
export function notesToMarkdown(notes: Note[], options: NotesExportOptions = {}): string {
  const date = new Date().toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const plural = notes.length > 1 ? 's' : '';
  const header = `# ${options.title?.trim() === '' ? 'MansotNote' : options.title ?? 'MansotNote'}\n\n> ${notes.length} note${plural} — export du ${date}`;
  const sections = notes.map((note) => noteToMarkdown(note, options).trimEnd());
  return `${header}\n\n${sections.join('\n\n---\n\n')}\n`;
}

/* ------------------------------------------------------------------ */
/* Noms de fichiers + téléchargement                                     */
/* ------------------------------------------------------------------ */

const FILENAME_SLUG_RE = /[^\p{L}\p{N}]+/gu;

/**
 * Nom de fichier sûr à partir d'un titre : accents retirés, minuscules,
 * séparateurs → tirets, 80 caractères max. Repli : `fallback`.
 */
export function slugifyBase(name: string, fallback = 'note'): string {
  const slug = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(FILENAME_SLUG_RE, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug === '') {
    return fallback;
  }
  return slug.length > 80 ? slug.slice(0, 80).replace(/-+$/g, '') : slug;
}

/** Nom de fichier recommandé pour l'export d'une note (`.md` inclus). */
export function exportNoteFileName(note: Note): string {
  return `${slugifyBase(note.title.trim(), 'note')}.md`;
}

/**
 * Déclenche le téléchargement d'un texte dans le navigateur
 * (Blob + `<a download>`). No-op hors navigateur (Node, tests).
 */
export function downloadText(filename: string, text: string, mime = 'text/markdown'): void {
  if (typeof document === 'undefined' || typeof Blob === 'undefined') {
    return;
  }
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename.endsWith('.md') ? filename : `${filename}.md`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
