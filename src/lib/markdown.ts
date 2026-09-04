/**
 * Pipeline Markdown → HTML sécurisé + coloration Shiki.
 *
 *  - `renderMarkdown` : synchrone (marked → DOMPurify), prêt à injecter ;
 *  - `highlightCode`  : asynchrone (Shiki), pour la coloration des blocs ;
 *  - helpers d'extraction à partir des nœuds rendus (utilisés par le
 *    composant de preview pour remplacer chaque `<pre><code>`).
 *
 * Les liens sortants sont forcés sur `target="_blank" rel="noopener"`
 * pour ne jamais naviguer hors de l'application.
 */
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { BundledLanguage, Highlighter } from 'shiki';
import type { CodeLanguage } from '@/types';
import { CODE_LANGUAGES } from '@/types';

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

marked.setOptions({
  gfm: true,
  breaks: false,
});

let domPurifyConfigured = false;

/** Force target=_blank sur les liens (ajouté une seule fois). */
function ensureDomPurifyConfig(): void {
  if (domPurifyConfigured) {
    return;
  }
  domPurifyConfigured = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node: Element) => {
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
    // `marked` rend les cases à cocher GFM avec `disabled` : elles
    // s'affichent mais restent inertes. On les réactive et on les numérote
    // pour pouvoir répercuter un clic dans le Markdown source.
    if (node.tagName === 'INPUT' && node.getAttribute('type') === 'checkbox') {
      node.removeAttribute('disabled');
      node.setAttribute('data-task-checkbox', '');
    }
  });
}

/* ------------------------------------------------------------------ */
/* Rendu synchrone                                                     */
/* ------------------------------------------------------------------ */

/**
 * Rend Markdown → HTML sécurisé.
 * Les blocs de code sortent en `<pre><code class="language-xxx">`,
 * prêts à être colorés via `highlightCode`.
 */
export function renderMarkdown(markdown: string): string {
  if (!markdown) {
    return '';
  }
  ensureDomPurifyConfig();
  const html = marked.parse(markdown, { async: false }) as string;
  return DOMPurify.sanitize(html);
}

/**
 * Motif d'une case à cocher GFM en début de ligne de liste.
 * Couvre les puces `-`, `*`, `+` et l'indentation des sous-listes.
 */
const TASK_LINE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/;

/**
 * Nombre de cases à cocher rendues par le Markdown.
 * Les blocs de code sont exclus, exactement comme le fait `marked` : sans
 * cela, la numérotation du texte et celle du rendu se désynchronisent.
 */
export function countTaskCheckboxes(markdown: string): number {
  let count = 0;
  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && TASK_LINE.test(line)) count += 1;
  }
  return count;
}

/**
 * Bascule la n-ième case à cocher (index 0) du Markdown source.
 *
 * On travaille sur le texte plutôt que sur le HTML rendu : c'est la note
 * qui fait foi, et l'ordre des cases dans le source correspond exactement
 * à leur ordre de rendu. Les blocs de code sont ignorés, sinon une ligne
 * `- [ ]` citée en exemple décalerait toute la numérotation.
 */
export function toggleTaskCheckbox(
  markdown: string,
  index: number,
  checked?: boolean,
): string {
  const lines = markdown.split('\n');
  let current = -1;
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    // Suivi des blocs de code (``` ou ~~~).
    if (/^\s*(```|~~~)/.test(lines[i])) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const match = lines[i].match(TASK_LINE);
    if (match === null) continue;

    current += 1;
    if (current !== index) continue;

    const isChecked = match[2].toLowerCase() === 'x';
    const next = checked ?? !isChecked;
    lines[i] = lines[i].replace(TASK_LINE, `$1${next ? 'x' : ' '}$3`);
    return lines.join('\n');
  }

  // Index hors limites : on renvoie le texte inchangé plutôt que de risquer
  // une modification erronée.
  return markdown;
}

/**
 * Extrait texte court (Markdown retiré) — pour l'extrait de la liste
 * des notes (NoteListItem.excerpt).
 */
export function markdownToPlainText(markdown: string): string {
  if (!markdown) {
    return '';
  }
  return markdown
    .replace(/```[\s\S]*?```/g, ' ') // blocs de code
    .replace(/`([^`]*)`/g, '$1') // code inline
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // liens
    .replace(/^\s{0,3}#{1,6}\s+/gm, '') // titres
    .replace(/^\s{0,3}>\s?/gm, '') // citations
    .replace(/^\s*[-*+]\s+(\[[ xX]\]\s*)?/gm, '') // listes
    .replace(/^\s*\d+\.\s+/gm, '') // listes ordonnées
    .replace(/^\s*[-|:]+\s*$/gm, ' ') // séparateurs de tableaux
    .replace(/[*_~#>|]/g, ' ') // ponctuation de formatage
    .replace(/\s+/g, ' ')
    .trim();
}

/** Nombre de mots d'un texte (séparés par des espaces). Tolère undefined. */
export function countWords(text: string): number {
  const trimmed = (typeof text === 'string' ? text : '').trim();
  const matches = trimmed.match(/\S+/g);
  return matches === null ? 0 : matches.length;
}

/* ------------------------------------------------------------------ */
/* Coloration Shiki (asynchrone)                                       */
/* ------------------------------------------------------------------ */

/** Langues chargées dans le highlighter partagé. */
const SHIKI_LANGUAGE_IDS: string[] = [...CODE_LANGUAGES];

let highlighterPromise: Promise<Highlighter> | null = null;

/** Highlighter partagé (une seule instance pour toute l'app). */
function getHighlighter(): Promise<Highlighter> {
  if (highlighterPromise === null) {
    highlighterPromise = import('shiki')
      .then(({ createHighlighter }) =>
        createHighlighter({
          themes: ['github-dark', 'github-light'],
          langs: SHIKI_LANGUAGE_IDS as BundledLanguage[],
        }),
      )
      .catch(async () => {
        // Repli : le jeu de langues complet a échoué à charger.
        const { createHighlighter } = await import('shiki');
        return createHighlighter({
          themes: ['github-dark', 'github-light'],
          langs: ['javascript', 'typescript', 'json', 'plaintext'],
        });
      });
  }
  return highlighterPromise;
}

/** Mappe un langage inconnu vers un id Shiki sûr. */
function resolveShikiLang(lang: string): string {
  const normalized = lang.toLowerCase();
  return SHIKI_LANGUAGE_IDS.includes(normalized) ? normalized : 'plaintext';
}

function themeName(theme: 'dark' | 'light'): string {
  return theme === 'dark' ? 'github-dark' : 'github-light';
}

/**
 * Colore un extrait de code et renvoie le HTML Shiki complet
 * (`<pre class="shiki" ...>`). Repli sur plaintext en cas d'erreur.
 */
export async function highlightCode(
  code: string,
  lang: string,
  theme: 'dark' | 'light' = 'dark',
): Promise<string> {
  const highlighter = await getHighlighter();
  const resolved = resolveShikiLang(lang);
  try {
    return highlighter.codeToHtml(code, {
      lang: resolved,
      theme: themeName(theme),
    });
  } catch {
    return highlighter.codeToHtml(code, {
      lang: 'plaintext',
      theme: themeName(theme),
    });
  }
}

/* ------------------------------------------------------------------ */
/* Helpers d'extraction (côté rendu)                                   */
/* ------------------------------------------------------------------ */

/** Langue d'un bloc `<pre><code class="language-xxx">`. */
export function codeLangFromElement(container: HTMLElement): string {
  const code = container.querySelector('code');
  const cls = code?.className ?? '';
  const match = cls.match(/language-([\w+-]+)/);
  return match?.[1] ?? 'plaintext';
}

/** Texte brut du code dans un bloc rendu. */
export function codeTextFromElement(container: HTMLElement): string {
  return (
    container.querySelector('code')?.textContent ??
    container.textContent ??
    ''
  );
}

export { CODE_LANGUAGES };
export type { CodeLanguage };
