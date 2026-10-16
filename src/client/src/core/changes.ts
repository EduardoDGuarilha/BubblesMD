import { diffArrays } from 'diff';

export type ChangeKind = 'altered' | 'added' | 'deleted';

/** One stable change group of a candidate version. Offsets are relative to the captured source / full candidate. */
export interface ChangeGroup {
  id: string;
  kind: ChangeKind;
  srcFrom: number;
  srcTo: number;
  original: string;
  replacement: string;
}

export type Piece = { kind: 'same'; text: string } | { kind: 'change'; id: string };

export interface CandidateDiff {
  pieces: Piece[];
  groups: ChangeGroup[];
}

const TOKEN = /\s+|[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*|([*_~`#])\1*|[^\s\p{L}\p{N}]/gu;

export function tokenize(text: string): string[] {
  return text.match(TOKEN) ?? [];
}

type Part = { kind: 'same' | 'removed' | 'added'; text: string };

/**
 * Deterministic token-level diff of captured source vs. candidate. Adjacent removed/added portions form one
 * 'altered' group; groups separated only by a single whitespace token are merged so a rewritten phrase reads
 * as one change. Group ids (c1, c2, …) follow document order and are stable for the candidate version.
 */
export function diffCandidate(source: string, candidate: string): CandidateDiff {
  const parts: Part[] = [];
  for (const p of diffArrays(tokenize(source), tokenize(candidate))) {
    const kind = p.added ? 'added' : p.removed ? 'removed' : 'same';
    const text = p.value.join('');
    const last = parts[parts.length - 1];
    if (last && last.kind === kind) last.text += text;
    else parts.push({ kind, text });
  }

  // Merge change runs separated only by whitespace into a single change run.
  type Run = { kind: 'same'; text: string } | { kind: 'change'; original: string; replacement: string };
  const runs: Run[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const prev = runs[runs.length - 1];
    if (p.kind === 'same') {
      const next = parts[i + 1];
      if (prev?.kind === 'change' && next && next.kind !== 'same' && /^\s+$/.test(p.text) && !p.text.includes('\n\n')) {
        prev.original += p.text;
        prev.replacement += p.text;
        continue;
      }
      runs.push({ kind: 'same', text: p.text });
      continue;
    }
    if (prev?.kind === 'change') {
      if (p.kind === 'removed') prev.original += p.text;
      else prev.replacement += p.text;
    } else {
      runs.push({
        kind: 'change',
        original: p.kind === 'removed' ? p.text : '',
        replacement: p.kind === 'added' ? p.text : '',
      });
    }
  }

  const pieces: Piece[] = [];
  const groups: ChangeGroup[] = [];
  let srcPos = 0;
  for (const run of runs) {
    if (run.kind === 'same') {
      pieces.push({ kind: 'same', text: run.text });
      srcPos += run.text.length;
      continue;
    }
    const id = `c${groups.length + 1}`;
    const kind: ChangeKind = run.original && run.replacement ? 'altered' : run.replacement ? 'added' : 'deleted';
    groups.push({
      id,
      kind,
      srcFrom: srcPos,
      srcTo: srcPos + run.original.length,
      original: run.original,
      replacement: run.replacement,
    });
    pieces.push({ kind: 'change', id });
    srcPos += run.original.length;
  }
  return { pieces, groups };
}

/** Candidate text after the writer's pops: a popped group keeps the original wording. */
export function effectiveText(diff: CandidateDiff, popped: readonly string[]): string {
  const byId = new Map(diff.groups.map((g) => [g.id, g]));
  let out = '';
  for (const piece of diff.pieces) {
    if (piece.kind === 'same') out += piece.text;
    else {
      const g = byId.get(piece.id)!;
      out += popped.includes(g.id) ? g.original : g.replacement;
    }
  }
  return out;
}
