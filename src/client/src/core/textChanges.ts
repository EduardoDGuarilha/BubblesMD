import { diffChars } from 'diff';

/** One replaced region: old text [fromA, toA) became new text [fromB, toB). Hunks are sorted and non-overlapping. */
export interface Hunk {
  fromA: number;
  toA: number;
  fromB: number;
  toB: number;
}

const SPLIT_THRESHOLD = 64;

/**
 * Text changes between two Markdown strings. `hint` is the old offset where the edit started (from the editor's own
 * transaction), so typing next to identical characters is attributed to the right side of a boundary.
 */
export function diffText(oldText: string, newText: string, hint?: number): Hunk[] {
  if (oldText === newText) return [];
  const minLen = Math.min(oldText.length, newText.length);
  let prefix = 0;
  while (prefix < minLen && oldText.charCodeAt(prefix) === newText.charCodeAt(prefix)) prefix++;
  if (hint !== undefined && hint >= 0 && hint < prefix) prefix = hint;
  let suffix = 0;
  while (
    suffix < minLen - prefix &&
    oldText.charCodeAt(oldText.length - 1 - suffix) === newText.charCodeAt(newText.length - 1 - suffix)
  )
    suffix++;
  const toA = oldText.length - suffix;
  const toB = newText.length - suffix;
  if (toA - prefix > SPLIT_THRESHOLD && toB - prefix > SPLIT_THRESHOLD) {
    return splitMiddle(oldText.slice(prefix, toA), newText.slice(prefix, toB), prefix, prefix);
  }
  return [{ fromA: prefix, toA, fromB: prefix, toB }];
}

/** Break a large changed middle (e.g. syntax normalization in several places) into small local hunks. */
function splitMiddle(a: string, b: string, offA: number, offB: number): Hunk[] {
  const hunks: Hunk[] = [];
  let posA = offA;
  let posB = offB;
  let current: Hunk | null = null;
  for (const part of diffChars(a, b)) {
    const len = part.value.length;
    if (!part.added && !part.removed) {
      if (current) hunks.push(current);
      current = null;
      posA += len;
      posB += len;
      continue;
    }
    if (!current) current = { fromA: posA, toA: posA, fromB: posB, toB: posB };
    if (part.removed) {
      posA += len;
      current.toA = posA;
    } else {
      posB += len;
      current.toB = posB;
    }
  }
  if (current) hunks.push(current);
  return hunks;
}

export interface MappedPos {
  pos: number;
  /** The position was strictly inside replaced text, so its exact counterpart no longer exists. */
  inside: boolean;
}

/** Map an old offset through hunks. assoc < 0 keeps a position before text inserted exactly there; assoc > 0 moves after it. */
export function mapPos(pos: number, hunks: readonly Hunk[], assoc: -1 | 1): MappedPos {
  for (const h of hunks) {
    if (pos < h.fromA) return { pos: pos + (h.fromB - h.fromA), inside: false };
    if (pos <= h.toA) {
      if (h.fromA === h.toA) return { pos: assoc < 0 ? h.fromB : h.toB, inside: false };
      if (pos === h.fromA) return { pos: h.fromB, inside: false };
      if (pos === h.toA) return { pos: h.toB, inside: false };
      return { pos: assoc < 0 ? h.fromB : h.toB, inside: true };
    }
  }
  const last = hunks[hunks.length - 1];
  return { pos: last ? pos + (last.toB - last.toA) : pos, inside: false };
}

export type RangeMapStatus = 'ok' | 'deleted' | 'straddled';

export interface MappedRange {
  from: number;
  to: number;
  status: RangeMapStatus;
}

/**
 * Map a review scope through an edit. Insertions at either boundary stay outside the scope. A scope wholly
 * covered by deleted/replaced text is 'deleted'; an edit that overwrites only one boundary is 'straddled'
 * (the caller blocks the review for retargeting rather than guessing).
 */
export function mapRange(from: number, to: number, hunks: readonly Hunk[]): MappedRange {
  if (hunks.length === 0) return { from, to, status: 'ok' };
  const covering = hunks.find((h) => h.fromA < h.toA && h.fromA <= from && to <= h.toA);
  if (covering && !(covering.fromA === from && covering.toA === to)) {
    const at = covering.fromB + (covering.toB - covering.fromB);
    return { from: at, to: at, status: 'deleted' };
  }
  const a = mapPos(from, hunks, 1);
  const b = mapPos(to, hunks, -1);
  if (from < to && b.pos <= a.pos) return { from: a.pos, to: a.pos, status: 'deleted' };
  if (a.inside || b.inside) return { from: a.pos, to: Math.max(a.pos, b.pos), status: 'straddled' };
  return { from: a.pos, to: b.pos, status: 'ok' };
}

export function applyHunk(text: string, from: number, to: number, insert: string): { text: string; hunk: Hunk } {
  return {
    text: text.slice(0, from) + insert + text.slice(to),
    hunk: { fromA: from, toA: to, fromB: from, toB: from + insert.length },
  };
}
