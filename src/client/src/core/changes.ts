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

const classify = (original: string, replacement: string): ChangeKind => (original && replacement ? 'altered' : replacement ? 'added' : 'deleted');

/** Lengths of the whitespace prefix and suffix that both strings share exactly. */
function sharedWhitespace(a: string, b: string): [number, number] {
  let lead = 0;
  while (lead < a.length && lead < b.length && a[lead] === b[lead] && /\s/.test(a[lead])) lead++;
  let trail = 0;
  while (
    trail < a.length - lead &&
    trail < b.length - lead &&
    a[a.length - 1 - trail] === b[b.length - 1 - trail] &&
    /\s/.test(a[a.length - 1 - trail])
  )
    trail++;
  return [lead, trail];
}

/**
 * Change-group boundaries: whitespace that the original and the replacement share at a group's start or end
 * belongs to the unchanged text around it, and each group is classified from what remains (so ", the kind of day"
 * inserted before a kept space is Added, not an alteration of that space). Only the segmentation changes: the text
 * on each side, the group ids and their order stay the same, so accepted text and every pop are exactly as before.
 * Whitespace that differs is a real edit and stays in its group. Idempotent; also applied to saved versions.
 */
export function normalizeDiff(diff: CandidateDiff): CandidateDiff {
  const byId = new Map(diff.groups.map((g) => [g.id, g]));
  const pieces: Piece[] = [];
  const groups: ChangeGroup[] = [];
  const same = (text: string) => {
    if (!text) return;
    const last = pieces[pieces.length - 1];
    if (last?.kind === 'same') pieces[pieces.length - 1] = { kind: 'same', text: last.text + text };
    else pieces.push({ kind: 'same', text });
  };
  for (const piece of diff.pieces) {
    if (piece.kind === 'same') {
      same(piece.text);
      continue;
    }
    const g = byId.get(piece.id)!;
    const [lead, trail] = g.original === g.replacement ? [0, 0] : sharedWhitespace(g.original, g.replacement);
    const original = g.original.slice(lead, g.original.length - trail);
    const replacement = g.replacement.slice(lead, g.replacement.length - trail);
    same(g.original.slice(0, lead));
    const srcFrom = g.srcFrom + lead;
    groups.push({ ...g, kind: classify(original, replacement), srcFrom, srcTo: srcFrom + original.length, original, replacement });
    pieces.push({ kind: 'change', id: g.id });
    same(g.original.slice(g.original.length - trail));
  }
  return { pieces, groups };
}

/**
 * Deterministic token-level diff of captured source vs. candidate. Adjacent removed/added portions form one
 * 'altered' group; groups separated only by a single whitespace token are merged so a rewritten phrase reads
 * as one change, then boundaries are normalized (normalizeDiff). Group ids (c1, c2, …) follow document order and
 * are stable for the candidate version.
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
    const kind = classify(run.original, run.replacement);
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
  return normalizeDiff({ pieces, groups });
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

/**
 * Textual no-change test shared with the server: runs of spaces/tabs within a line and trailing whitespace are
 * ignored; newlines, Markdown syntax and an intentionally empty replacement still count as changes. This proves
 * only that the text did or did not change, never that it improved.
 */
export function normalizeForCompare(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trimEnd())
    .join('\n')
    .trimEnd();
}

export function isUnchanged(baseline: string, result: string): boolean {
  if (result.trim() === '' && baseline.trim() !== '') return false;
  return normalizeForCompare(baseline) === normalizeForCompare(result);
}

const clipQuote = (s: string) => (s.length > 40 ? `${s.slice(0, 39)}…` : s);

/** Flag kept original wording that disappeared, or rejected additions that came back, in a new candidate. */
export function keepOriginalChecks(replacement: string, keep: readonly { original: string; proposed: string }[]): string[] {
  const checks: string[] = [];
  for (const k of keep) {
    const original = k.original.trim();
    const proposed = k.proposed.trim();
    if (original.length >= 3 && !replacement.includes(original)) checks.push(`Changed wording you kept: “${clipQuote(original)}”`);
    else if (!original && proposed.length >= 6 && replacement.includes(proposed)) checks.push(`Re-added text you removed: “${clipQuote(proposed)}”`);
  }
  return checks;
}

const SINGLE_BREAK_RUN = /^[ \t]*\n[ \t]*$/;

/**
 * Inline selections only: drop a leading or trailing whitespace run that holds exactly one line break the selected
 * source does not have at that boundary. That is a model artifact which, accepted mid-paragraph, renders as a line
 * break. Blank-line paragraph breaks, internal newlines, horizontal spacing and empty replacements are left as is.
 */
export function stripAccidentalBoundaryBreaks(source: string, replacement: string): string {
  if (!replacement.trim()) return replacement;
  let out = replacement;
  const lead = /^\s*/.exec(out)![0];
  const srcLead = /^\s*/.exec(source)![0];
  if (lead && SINGLE_BREAK_RUN.test(lead) && !srcLead.includes('\n')) out = srcLead + out.slice(lead.length);
  const trail = /\s*$/.exec(out)![0];
  const srcTrail = /\s*$/.exec(source)![0];
  if (trail && SINGLE_BREAK_RUN.test(trail) && !srcTrail.includes('\n')) out = out.slice(0, out.length - trail.length) + srcTrail;
  return out;
}
