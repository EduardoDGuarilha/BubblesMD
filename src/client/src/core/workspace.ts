import { mapRange, type Hunk } from './textChanges';
import { effectiveText, type CandidateDiff } from './changes';

export type Mode = 'fast' | 'smart';
export type SuggestAction = 'initial' | 'refine' | 'refresh' | 'revise';
export type ReviewStatus = 'open' | 'accepted' | 'discarded' | 'targetDeleted';

export interface Thought {
  id: string;
  text: string;
}

/** History-tracked review state. `popped` always belongs to `activeVersion`. */
export interface ReviewState {
  id: string;
  status: ReviewStatus;
  from: number;
  to: number;
  /** An edit overwrote only part of the scope; the review needs explicit retargeting. */
  blocked: boolean;
  thoughts: Thought[];
  activeVersion: string | null;
  popped: string[];
  createdAt: number;
}

/** Everything Undo/Redo restores together. */
export interface Tracked {
  md: string;
  reviews: Record<string, ReviewState>;
  order: string[];
}

export interface Usage {
  promptTokens: number | null;
  completionTokens: number | null;
  reasoningTokens: number | null;
  /** Charged cost in USD as returned by the provider; null means unknown, never zero. */
  cost: number | null;
}

export interface KeepOriginal {
  original: string;
  proposed: string;
}

/** Immutable candidate version; cached outside history. */
export interface CandidateVersion {
  id: string;
  reviewId: string;
  requestId: string;
  action: SuggestAction;
  outcome: 'replace' | 'unchanged' | 'cannot_apply';
  reason: string | null;
  source: string;
  nearBefore: string;
  nearAfter: string;
  replacement: string;
  diff: CandidateDiff;
  thoughts: string[];
  keepOriginal: KeepOriginal[];
  mode: Mode;
  model: string;
  provider: string;
  usage: Usage;
  latencyMs: number;
  revision: number;
  createdAt: number;
  /** Provider calls that produced this version (2 when a no-change correction was needed). */
  attempts?: number;
  /** Deterministic checks against the writer's keep-original choices (e.g. kept wording that went missing). */
  checks?: string[];
}

export const NEAR_CONTEXT = 120;

export function emptyTracked(md = ''): Tracked {
  return { md, reviews: {}, order: [] };
}

function withReview(t: Tracked, id: string, patch: Partial<ReviewState>): Tracked {
  const r = t.reviews[id];
  if (!r) return t;
  return { ...t, reviews: { ...t.reviews, [id]: { ...r, ...patch } } };
}

export function openReviews(t: Tracked): ReviewState[] {
  return t.order.map((id) => t.reviews[id]).filter((r) => r && r.status === 'open');
}

export function nearContext(md: string, from: number, to: number) {
  return { nearBefore: md.slice(Math.max(0, from - NEAR_CONTEXT), from), nearAfter: md.slice(to, to + NEAR_CONTEXT) };
}

/** A candidate is actionable only while its captured source and nearby context are unchanged. */
export function isCurrent(t: Tracked, r: ReviewState, v: CandidateVersion): boolean {
  if (r.blocked) return false;
  const near = nearContext(t.md, r.from, r.to);
  return t.md.slice(r.from, r.to) === v.source && near.nearBefore === v.nearBefore && near.nearAfter === v.nearAfter;
}

/** Map open review scopes through a document edit. Returns ids whose targets were completely deleted. */
export function applyEdit(t: Tracked, md: string, hunks: readonly Hunk[]): { next: Tracked; deleted: string[] } {
  const reviews = { ...t.reviews };
  const deleted: string[] = [];
  for (const r of openReviews(t)) {
    const m = mapRange(r.from, r.to, hunks);
    if (m.status === 'deleted') {
      reviews[r.id] = { ...r, status: 'targetDeleted', from: m.from, to: m.to };
      deleted.push(r.id);
    } else if (m.from !== r.from || m.to !== r.to || m.status === 'straddled') {
      reviews[r.id] = { ...r, from: m.from, to: m.to, blocked: r.blocked || m.status === 'straddled' };
    }
  }
  return { next: { ...t, md, reviews }, deleted };
}

export function createReview(t: Tracked, id: string, from: number, to: number, now = Date.now()): Tracked {
  const review: ReviewState = {
    id,
    status: 'open',
    from,
    to,
    blocked: false,
    thoughts: [],
    activeVersion: null,
    popped: [],
    createdAt: now,
  };
  return { ...t, reviews: { ...t.reviews, [id]: review }, order: [...t.order, id] };
}

/** Add (thoughtId null) or edit a reflection. Blank edits remove it. Unchanged input returns `t` itself. */
export function commitThought(t: Tracked, reviewId: string, thoughtId: string | null, text: string, newId: string): Tracked {
  const r = t.reviews[reviewId];
  if (!r) return t;
  const clean = text.replace(/\s+$/, '');
  if (thoughtId === null) {
    if (!clean.trim()) return t;
    return withReview(t, reviewId, { thoughts: [...r.thoughts, { id: newId, text: clean }] });
  }
  const existing = r.thoughts.find((x) => x.id === thoughtId);
  if (!existing || existing.text === clean) return t;
  if (!clean.trim()) return popThought(t, reviewId, thoughtId);
  return withReview(t, reviewId, { thoughts: r.thoughts.map((x) => (x.id === thoughtId ? { ...x, text: clean } : x)) });
}

export function popThought(t: Tracked, reviewId: string, thoughtId: string): Tracked {
  const r = t.reviews[reviewId];
  if (!r || !r.thoughts.some((x) => x.id === thoughtId)) return t;
  return withReview(t, reviewId, { thoughts: r.thoughts.filter((x) => x.id !== thoughtId) });
}

export function popChange(t: Tracked, reviewId: string, changeId: string): Tracked {
  const r = t.reviews[reviewId];
  if (!r || r.popped.includes(changeId)) return t;
  return withReview(t, reviewId, { popped: [...r.popped, changeId] });
}

export function setStatus(t: Tracked, reviewId: string, status: ReviewStatus): Tracked {
  const r = t.reviews[reviewId];
  if (!r || r.status === status) return t;
  return withReview(t, reviewId, { status });
}

export function retarget(t: Tracked, reviewId: string, from: number, to: number): Tracked {
  return withReview(t, reviewId, { from, to, blocked: false });
}

/** Installing a new candidate version makes it active with no pops (its own fresh choices). */
export function installVersion(t: Tracked, reviewId: string, versionId: string): Tracked {
  return withReview(t, reviewId, { activeVersion: versionId, popped: [] });
}

export function keepOriginalChoices(v: CandidateVersion, popped: readonly string[]): { original: string; proposed: string }[] {
  return v.diff.groups.filter((g) => popped.includes(g.id)).map((g) => ({ original: g.original, proposed: g.replacement }));
}

export type AcceptResult = { ok: true; next: Tracked; hunks: Hunk[]; text: string } | { ok: false; reason: string };

/**
 * Apply the effective candidate (after pops) to exactly the review's current scope, change group by change
 * group so unchanged words inside the scope keep their positions for other reviews.
 */
export function acceptReview(t: Tracked, reviewId: string, v: CandidateVersion): AcceptResult {
  const r = t.reviews[reviewId];
  if (!r || r.status !== 'open') return { ok: false, reason: 'This review is no longer open.' };
  if (r.activeVersion !== v.id) return { ok: false, reason: 'This is not the active suggestion.' };
  if (v.outcome !== 'replace') return { ok: false, reason: 'There is no replacement to apply.' };
  if (!isCurrent(t, r, v)) return { ok: false, reason: 'The passage changed; this suggestion is outdated.' };
  const text = effectiveText(v.diff, r.popped);
  if (text === v.source) return { ok: false, reason: 'Nothing to apply.' };

  const hunks: Hunk[] = [];
  let md = t.md.slice(0, r.from);
  let cursor = r.from;
  let delta = 0;
  for (const g of v.diff.groups) {
    if (r.popped.includes(g.id) || g.original === g.replacement) continue;
    const fromA = r.from + g.srcFrom;
    const toA = r.from + g.srcTo;
    md += t.md.slice(cursor, fromA) + g.replacement;
    cursor = toA;
    hunks.push({ fromA, toA, fromB: fromA + delta, toB: fromA + delta + g.replacement.length });
    delta += g.replacement.length - g.original.length;
  }
  md += t.md.slice(cursor);
  if (md.slice(r.from, r.from + text.length) !== text) return { ok: false, reason: 'Internal mismatch; nothing applied.' };

  const mapped = applyEdit(setStatus(t, reviewId, 'accepted'), md, hunks);
  return { ok: true, next: mapped.next, hunks, text };
}
