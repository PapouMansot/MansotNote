/**
 * Diff ligne par ligne entre deux textes, au format « git diff » : hunks avec trois lignes de contexte.
 * Calcul par plus longue sous-suite commune, après retrait du début et de la fin identiques. Au-delà de
 * MAX_CELLS comparaisons, on renvoie « tout supprimé puis tout ajouté » plutôt que de saturer le serveur.
 */
export interface Op { t: ' ' | '+' | '-'; s: string }
export interface Hunk { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: Op[] }
export interface Diff { added: number; removed: number; hunks: Hunk[] }

const MAX_CELLS = 4_000_000;

export const splitLines = (text: string): string[] => (text === '' ? [] : text.replace(/\r\n/g, '\n').split('\n'));

function lcsOps(a: string[], b: string[]): Op[] {
  if (a.length === 0) return b.map((s) => ({ t: '+', s }));
  if (b.length === 0) return a.map((s) => ({ t: '-', s }));
  if (a.length * b.length > MAX_CELLS) return [...a.map((s): Op => ({ t: '-', s })), ...b.map((s): Op => ({ t: '+', s }))];
  const n = a.length;
  const m = b.length;
  const w = m + 1;
  const dp = new Uint32Array((n + 1) * w); // dp[i*w+j] = longueur de la sous-suite commune de a[i..] et b[j..]
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = a[i] === b[j] ? dp[(i + 1) * w + j + 1]! + 1 : Math.max(dp[(i + 1) * w + j]!, dp[i * w + j + 1]!);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ t: ' ', s: a[i]! }); i++; j++; }
    else if (dp[(i + 1) * w + j]! >= dp[i * w + j + 1]!) { ops.push({ t: '-', s: a[i]! }); i++; }
    else { ops.push({ t: '+', s: b[j]! }); j++; }
  }
  while (i < n) ops.push({ t: '-', s: a[i++]! });
  while (j < m) ops.push({ t: '+', s: b[j++]! });
  return ops;
}

export function diffLines(a: string[], b: string[]): Op[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  return [
    ...a.slice(0, start).map((s): Op => ({ t: ' ', s })),
    ...lcsOps(a.slice(start, endA), b.slice(start, endB)),
    ...a.slice(endA).map((s): Op => ({ t: ' ', s })),
  ];
}

export function makeDiff(oldText: string, newText: string, context = 3): Diff {
  const ops = diffLines(splitLines(oldText), splitLines(newText));
  const changed: number[] = [];
  let added = 0;
  let removed = 0;
  ops.forEach((op, index) => {
    if (op.t === ' ') return;
    changed.push(index);
    if (op.t === '+') added++; else removed++;
  });
  const hunks: Hunk[] = [];
  if (changed.length === 0) return { added, removed, hunks };

  const oldAt: number[] = [];
  const newAt: number[] = [];
  let o = 1;
  let n = 1;
  for (const op of ops) {
    oldAt.push(o);
    newAt.push(n);
    if (op.t !== '+') o++;
    if (op.t !== '-') n++;
  }
  let i = 0;
  while (i < changed.length) {
    const from = Math.max(0, changed[i]! - context);
    let last = changed[i]!;
    let k = i + 1;
    while (k < changed.length && changed[k]! - last - 1 <= 2 * context) { last = changed[k]!; k++; }
    const lines = ops.slice(from, Math.min(ops.length, last + context + 1));
    hunks.push({
      oldStart: oldAt[from]!,
      newStart: newAt[from]!,
      oldLines: lines.filter((l) => l.t !== '+').length,
      newLines: lines.filter((l) => l.t !== '-').length,
      lines,
    });
    i = k;
  }
  return { added, removed, hunks };
}

/** Texte « diff unifié », celui que produirait git diff. */
export function toUnified(diff: Diff, oldName: string, newName: string, maxLines = 4000): string {
  if (diff.hunks.length === 0) return '(aucune différence de contenu)';
  const out = ['--- ' + oldName, '+++ ' + newName];
  for (const hunk of diff.hunks) {
    out.push('@@ -' + hunk.oldStart + ',' + hunk.oldLines + ' +' + hunk.newStart + ',' + hunk.newLines + ' @@');
    for (const line of hunk.lines) out.push(line.t + line.s);
    if (out.length > maxLines) { out.push('… diff tronquée (' + diff.added + ' lignes ajoutées, ' + diff.removed + ' supprimées au total)'); break; }
  }
  return out.join('\n');
}
