/**
 * Utilitaire de calcul de diff au niveau des mots / tokens (sans dépendance externe).
 * Utilisé pour prévisualiser les corrections et améliorations IA.
 */

export interface DiffPart {
  type: 'eq' | 'ins' | 'del';
  text: string;
}

/** Découpe un texte en tokens (mots, ponctuation, espaces, retours à la ligne). */
function tokenize(text: string): string[] {
  if (!text) return [];
  const tokens = text.match(/[\w\u00C0-\u017F]+|[^\w\s\u00C0-\u017F]+|\s+/g);
  return tokens ?? [text];
}

/** Calcule le diff au niveau des mots entre deux textes via l'algorithme LCS (Longest Common Subsequence). */
export function diffWords(oldText: string, newText: string): DiffPart[] {
  if (oldText === newText) {
    return [{ type: 'eq', text: oldText }];
  }
  if (!oldText) {
    return [{ type: 'ins', text: newText }];
  }
  if (!newText) {
    return [{ type: 'del', text: oldText }];
  }

  const oldTokens = tokenize(oldText);
  const newTokens = tokenize(newText);

  // Pour les textes très longs (> 2500 tokens), fallback sur un découpage ligne par ligne pour la performance
  if (oldTokens.length * newTokens.length > 4_000_000) {
    return [
      { type: 'del', text: oldText },
      { type: 'ins', text: newText },
    ];
  }

  const n = oldTokens.length;
  const m = newTokens.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (oldTokens[i - 1] === newTokens[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const parts: DiffPart[] = [];
  let i = n;
  let j = m;

  const stack: DiffPart[] = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldTokens[i - 1] === newTokens[j - 1]) {
      stack.push({ type: 'eq', text: oldTokens[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      stack.push({ type: 'ins', text: newTokens[j - 1] });
      j--;
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      stack.push({ type: 'del', text: oldTokens[i - 1] });
      i--;
    }
  }

  stack.reverse();

  // Fusion des blocs contigus de même type
  for (const item of stack) {
    if (parts.length > 0 && parts[parts.length - 1].type === item.type) {
      parts[parts.length - 1].text += item.text;
    } else {
      parts.push({ ...item });
    }
  }

  return parts;
}
