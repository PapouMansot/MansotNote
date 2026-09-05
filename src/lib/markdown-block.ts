/**
 * Utilitaires d'analyse et de manipulation de blocs Markdown.
 * Permet d'identifier, modifier, transformer ou supprimer des blocs
 * (paragraphes, titres, listes, tâches, citations) directement depuis la vue d'aperçu.
 */

export interface MarkdownBlock {
  id: string;
  type: 'heading' | 'paragraph' | 'list_item' | 'task_item' | 'quote' | 'code' | 'table' | 'other';
  level?: number;
  startLine: number;
  endLine: number;
  rawText: string;
  cleanText: string;
}

/** Découpe un texte Markdown en blocs logiques ordonnés. */
export function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.split('\n');
  const blocks: MarkdownBlock[] = [];
  let i = 0;
  let blockIndex = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i++;
      continue;
    }

    // Bloc de code (```)
    if (line.trim().startsWith('```')) {
      const start = i;
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        i++;
      }
      if (i < lines.length) i++;
      const raw = lines.slice(start, i).join('\n');
      blocks.push({
        id: `block_${blockIndex++}`,
        type: 'code',
        startLine: start,
        endLine: i - 1,
        rawText: raw,
        cleanText: raw,
      });
      continue;
    }

    // Titres (# Heading)
    const hMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (hMatch) {
      blocks.push({
        id: `block_${blockIndex++}`,
        type: 'heading',
        level: hMatch[1].length,
        startLine: i,
        endLine: i,
        rawText: line,
        cleanText: hMatch[2].trim(),
      });
      i++;
      continue;
    }

    // Tâche (- [ ] ou - [x])
    const taskMatch = line.match(/^(\s*[-*+]\s+\[[ xX]\])\s+(.*)$/);
    if (taskMatch) {
      blocks.push({
        id: `block_${blockIndex++}`,
        type: 'task_item',
        startLine: i,
        endLine: i,
        rawText: line,
        cleanText: taskMatch[2].trim(),
      });
      i++;
      continue;
    }

    // Élément de liste (- ou 1.)
    const listMatch = line.match(/^(\s*(?:[-*+]|\d+\.))\s+(.*)$/);
    if (listMatch) {
      blocks.push({
        id: `block_${blockIndex++}`,
        type: 'list_item',
        startLine: i,
        endLine: i,
        rawText: line,
        cleanText: listMatch[2].trim(),
      });
      i++;
      continue;
    }

    // Citation (> quote)
    if (line.startsWith('>')) {
      const start = i;
      while (i < lines.length && lines[i].startsWith('>')) {
        i++;
      }
      const raw = lines.slice(start, i).join('\n');
      const clean = lines.slice(start, i).map((l) => l.replace(/^>\s?/, '')).join('\n');
      blocks.push({
        id: `block_${blockIndex++}`,
        type: 'quote',
        startLine: start,
        endLine: i - 1,
        rawText: raw,
        cleanText: clean,
      });
      continue;
    }

    // Paragraphe classique (regroupe les lignes consécutives non vides)
    const start = i;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].match(/^(#{1,6})\s+/) &&
      !lines[i].trim().startsWith('```') &&
      !lines[i].match(/^(\s*(?:[-*+]|\d+\.))\s+/) &&
      !lines[i].startsWith('>')
    ) {
      i++;
    }
    const raw = lines.slice(start, i).join('\n');
    blocks.push({
      id: `block_${blockIndex++}`,
      type: 'paragraph',
      startLine: start,
      endLine: i - 1,
      rawText: raw,
      cleanText: raw,
    });
  }

  return blocks;
}

/** Nettoie un texte en supprimant le formatage Markdown de base pour comparaison. */
function stripMarkdownSymbols(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^\s*[-*+]\s+(\[[ xX]\]\s+)?/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim();
}

/**
 * Trouve le bloc Markdown correspondant au texte d'un élément HTML rendu.
 */
export function findBlockByText(markdown: string, elementText: string): MarkdownBlock | null {
  const blocks = parseMarkdownBlocks(markdown);
  const target = elementText.trim();
  if (!target || blocks.length === 0) return null;

  // 1. Correspondance exacte sur cleanText
  const exact = blocks.find((b) => b.cleanText === target);
  if (exact) return exact;

  // 2. Correspondance exacte sur rawText
  const exactRaw = blocks.find((b) => b.rawText === target);
  if (exactRaw) return exactRaw;

  // 3. Correspondance nettoyée (sans balises Markdown)
  const strippedTarget = stripMarkdownSymbols(target);
  const strippedMatch = blocks.find((b) => stripMarkdownSymbols(b.cleanText) === strippedTarget);
  if (strippedMatch) return strippedMatch;

  // 4. Correspondance par inclusion (début ou contenu significatif)
  const partial = blocks.find(
    (b) =>
      b.cleanText.includes(target) ||
      target.includes(b.cleanText) ||
      stripMarkdownSymbols(b.cleanText).includes(strippedTarget),
  );
  if (partial) return partial;

  return null;
}

/** Remplace un bloc spécifique par un nouveau contenu Markdown. */
export function updateBlock(
  markdown: string,
  block: MarkdownBlock,
  newContent: string,
): string {
  const lines = markdown.split('\n');
  lines.splice(block.startLine, block.endLine - block.startLine + 1, newContent);
  return lines.join('\n');
}

export type BlockTransformType = 'h1' | 'h2' | 'h3' | 'list' | 'task' | 'quote' | 'paragraph';

/**
 * Transforme la nature structurelle d'un bloc (ex: paragraphe -> titre, liste -> tâche).
 */
export function transformBlockType(
  markdown: string,
  block: MarkdownBlock,
  targetType: BlockTransformType,
): string {
  const baseText = block.cleanText.trim();
  let replacement = baseText;

  switch (targetType) {
    case 'h1':
      replacement = `# ${baseText}`;
      break;
    case 'h2':
      replacement = `## ${baseText}`;
      break;
    case 'h3':
      replacement = `### ${baseText}`;
      break;
    case 'list':
      replacement = `- ${baseText}`;
      break;
    case 'task':
      replacement = `- [ ] ${baseText}`;
      break;
    case 'quote':
      replacement = baseText
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');
      break;
    case 'paragraph':
      replacement = baseText;
      break;
  }

  return updateBlock(markdown, block, replacement);
}

/** Duplique un bloc en l'insérant immédiatement après. */
export function duplicateBlock(markdown: string, block: MarkdownBlock): string {
  const lines = markdown.split('\n');
  lines.splice(block.endLine + 1, 0, '', block.rawText);
  return lines.join('\n');
}

/** Supprime un bloc du Markdown. */
export function deleteBlock(markdown: string, block: MarkdownBlock): string {
  const lines = markdown.split('\n');
  lines.splice(block.startLine, block.endLine - block.startLine + 1);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

/** Insère un nouveau contenu immédiatement après un bloc. */
export function insertAfterBlock(
  markdown: string,
  block: MarkdownBlock,
  contentToInsert: string,
): string {
  const lines = markdown.split('\n');
  lines.splice(block.endLine + 1, 0, '', contentToInsert);
  return lines.join('\n');
}

/** Remplace une portion sélectionnée de texte dans le Markdown. */
export function replaceSelectionInMarkdown(
  markdown: string,
  selectedText: string,
  replacement: string,
): string {
  const trimmedSel = selectedText.trim();
  if (!trimmedSel) return markdown;

  // Remplacement exact si trouvé directement
  if (markdown.includes(trimmedSel)) {
    return markdown.replace(trimmedSel, replacement);
  }

  // Remplacement tolérant sur les retours à la ligne
  const normalizedTarget = trimmedSel.replace(/\r\n/g, '\n');
  const normalizedMd = markdown.replace(/\r\n/g, '\n');
  if (normalizedMd.includes(normalizedTarget)) {
    return normalizedMd.replace(normalizedTarget, replacement);
  }

  return markdown;
}

