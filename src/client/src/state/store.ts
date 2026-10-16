import { History } from '../core/history';
import { diffCandidate, effectiveText, isUnchanged, keepOriginalChecks } from '../core/changes';
import type { Hunk } from '../core/textChanges';
import {
  acceptReview,
  applyEdit,
  commitThought,
  createReview,
  emptyTracked,
  installVersion,
  isCurrent,
  keepOriginalChoices,
  nearContext,
  popChange,
  popThought,
  retarget,
  setStatus,
  type CandidateVersion,
  type KeepOriginal,
  type Mode,
  type SuggestAction,
  type Tracked,
  type Usage,
} from '../core/workspace';
import { ApiError, type AttemptInfo, type SuggestFn, type SuggestPayload, type SuggestResponse } from '../services/api';

export const LIMITS = { selectionChars: 16000, contextEachSide: 2000, reflectionChars: 8000 };

export interface RequestState {
  requestId: string;
  action: SuggestAction;
  status: 'generating' | 'failed' | 'interrupted';
  error?: string;
  startedAt: number;
}

export interface LedgerEntry {
  requestId: string;
  reviewId: string;
  action: SuggestAction;
  mode: Mode;
  model: string | null;
  provider: string | null;
  status: 'pending' | 'completed' | 'ignored' | 'failed' | 'cancelled' | 'interrupted';
  /** 'yes' with a known cost, 'no' when nothing reached a paid provider, 'unknown' otherwise. */
  charged: 'yes' | 'no' | 'unknown';
  usage: Usage | null;
  latencyMs: number | null;
  at: number;
  /** 2 for the automatic no-change correction made within the same request. */
  attempt?: number;
}

export interface DecisionEntry {
  reviewId: string;
  versionId: string | null;
  decision: 'accepted' | 'rejected' | 'invalidated' | 'undone';
  revision: number;
  at: number;
}

export interface Prefs {
  mode: Mode;
  muted: boolean;
  view: 'formatted' | 'markdown';
}

export interface DocMeta {
  id: string;
  title: string;
  fileName: string | null;
}

export interface Notice {
  id: number;
  text: string;
  undo?: boolean;
  tone?: 'info' | 'error';
}

export interface StoreState {
  loaded: boolean;
  hasDocument: boolean;
  doc: DocMeta;
  tracked: Tracked;
  revision: number;
  versions: Record<string, CandidateVersion>;
  requests: Record<string, RequestState>;
  activeRequest: { requestId: string; reviewId: string } | null;
  ledger: LedgerEntry[];
  decisions: DecisionEntry[];
  prefs: Prefs;
  expanded: string | null;
  canUndo: boolean;
  canRedo: boolean;
  notice: Notice | null;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  saveError: string | null;
  /** Source text for which an outdated review already triggered its one automatic refresh. */
  autoRefreshed: Record<string, string>;
}

export interface Persisted {
  v: 1;
  doc: DocMeta;
  tracked: Tracked;
  revision: number;
  versions: Record<string, CandidateVersion>;
  requests: Record<string, RequestState>;
  ledger: LedgerEntry[];
  decisions: DecisionEntry[];
  prefs: Prefs;
}

export interface PersistAdapter {
  load(): Promise<Persisted | null>;
  save(p: Persisted): Promise<void>;
}

export type StoreEvent = { type: 'pop' } | { type: 'focusReview'; reviewId: string };

const uid = () => crypto.randomUUID();

interface Capture {
  requestId: string;
  reviewId: string;
  action: SuggestAction;
  mode: Mode;
  source: string;
  nearBefore: string;
  nearAfter: string;
  thoughts: string[];
  keepOriginal: KeepOriginal[];
  revision: number;
  /** What the result must differ from: the selection (initial/refresh) or the effective proposal (refine/revise). */
  baseline: string;
}

export class WorkspaceStore {
  state: StoreState;
  private listeners = new Set<() => void>();
  private eventListeners = new Set<(e: StoreEvent) => void>();
  private history = new History<Tracked>();
  private controllers = new Map<string, AbortController>();
  private lastCreation: { reviewId: string; before: Tracked } | null = null;
  private noticeSeq = 0;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private saving: Promise<void> = Promise.resolve();

  constructor(
    private suggestFn: SuggestFn,
    private persist: PersistAdapter | null = null,
  ) {
    this.state = {
      loaded: persist === null,
      hasDocument: false,
      doc: { id: 'none', title: 'Untitled', fileName: null },
      tracked: emptyTracked(),
      revision: 0,
      versions: {},
      requests: {},
      activeRequest: null,
      ledger: [],
      decisions: [],
      prefs: { mode: 'smart', muted: false, view: 'formatted' },
      expanded: null,
      canUndo: false,
      canRedo: false,
      notice: null,
      saveStatus: 'idle',
      saveError: null,
      autoRefreshed: {},
    };
  }

  // ---- subscription -------------------------------------------------------------------------------------------

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getState = () => this.state;

  onEvent(fn: (e: StoreEvent) => void): () => void {
    this.eventListeners.add(fn);
    return () => {
      this.eventListeners.delete(fn);
    };
  }

  private emit(e: StoreEvent) {
    this.eventListeners.forEach((fn) => fn(e));
  }

  private set(patch: Partial<StoreState>, persist = true) {
    this.state = {
      ...this.state,
      ...patch,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
    };
    this.listeners.forEach((fn) => fn());
    if (persist && this.persist && this.state.hasDocument) this.scheduleSave();
  }

  private notify(text: string, opts: { undo?: boolean; tone?: 'info' | 'error' } = {}) {
    this.set({ notice: { id: ++this.noticeSeq, text, ...opts } }, false);
  }

  showNotice(text: string, tone: 'info' | 'error' = 'info') {
    this.notify(text, { tone });
  }

  dismissNotice() {
    this.set({ notice: null }, false);
  }

  /** Record a tracked change as one history entry (or merge into the current typing group). */
  private commit(next: Tracked, group?: string, extra: Partial<StoreState> = {}) {
    if (next === this.state.tracked) {
      if (Object.keys(extra).length) this.set(extra);
      return false;
    }
    this.history.record(this.state.tracked, group);
    if (!group) this.history.breakGroup();
    const revision = next.md !== this.state.tracked.md ? this.state.revision + 1 : this.state.revision;
    this.lastCreation = null;
    this.set({ tracked: next, revision, ...extra });
    return true;
  }

  // ---- document -----------------------------------------------------------------------------------------------

  newDocument(md: string, meta: Omit<DocMeta, 'id'>) {
    const doc: DocMeta = { ...meta, id: uid() };
    for (const c of this.controllers.values()) c.abort();
    this.controllers.clear();
    this.history.clear();
    this.lastCreation = null;
    this.set({
      hasDocument: true,
      doc,
      tracked: emptyTracked(md),
      revision: this.state.revision + 1,
      versions: {},
      requests: {},
      activeRequest: null,
      decisions: [],
      expanded: null,
      notice: null,
      autoRefreshed: {},
    });
  }

  /** A user edit from either editor view, already expressed as Markdown hunks. */
  edit(md: string, hunks: readonly Hunk[]) {
    if (md === this.state.tracked.md) return;
    const { next, deleted } = applyEdit(this.state.tracked, md, hunks);
    const extra: Partial<StoreState> = {};
    if (deleted.length) {
      extra.decisions = [
        ...this.state.decisions,
        ...deleted.map((id) => this.decision(id, 'invalidated')),
      ];
      if (this.state.expanded && deleted.includes(this.state.expanded)) extra.expanded = null;
      for (const id of deleted) this.cancelRequest(id);
    }
    this.commit(next, deleted.length ? undefined : 'typing', extra);
    if (deleted.length) {
      this.emit({ type: 'pop' });
      this.notify(deleted.length === 1 ? 'Passage deleted — its review popped.' : 'Passages deleted — their reviews popped.', {
        undo: true,
      });
    }
  }

  setTitle(title: string) {
    this.set({ doc: { ...this.state.doc, title } });
  }

  // ---- history ------------------------------------------------------------------------------------------------

  undo() {
    const prev = this.history.undo(this.state.tracked);
    if (prev) this.restore(prev);
  }

  redo() {
    const next = this.history.redo(this.state.tracked);
    if (next) this.restore(next);
  }

  private restore(next: Tracked) {
    const before = this.state.tracked;
    const decisions = [...this.state.decisions];
    let reopened: string | null = null;
    for (const id of next.order) {
      const was = before.reviews[id]?.status;
      const now = next.reviews[id]?.status;
      if (was === 'accepted' && now === 'open') decisions.push(this.decision(id, 'undone', next));
      if (was !== 'open' && now === 'open') reopened = reopened ?? id;
    }
    let expanded = this.state.expanded;
    if (expanded && next.reviews[expanded]?.status !== 'open') expanded = null;
    if (reopened) expanded = reopened;
    this.lastCreation = null;
    this.set({
      tracked: next,
      decisions,
      expanded,
      revision: next.md !== before.md ? this.state.revision + 1 : this.state.revision,
    });
  }

  // ---- reviews ------------------------------------------------------------------------------------------------

  createReview(from: number, to: number): string | null {
    if (from < 0 || to > this.state.tracked.md.length || from >= to) return null;
    const id = uid();
    const before = this.state.tracked;
    this.commit(createReview(before, id, from, to), undefined, { expanded: id });
    this.lastCreation = { reviewId: id, before };
    return id;
  }

  expand(reviewId: string | null) {
    const prev = this.state.expanded;
    if (prev === reviewId) return;
    if (prev) this.cancelIfEmptyDraft(prev);
    if (!reviewId) {
      this.set({ expanded: null }, false);
      return;
    }
    const r = this.state.tracked.reviews[reviewId];
    if (!r || r.status !== 'open') return;
    this.set({ expanded: reviewId }, false);
    this.maybeAutoRefresh(reviewId);
  }

  /** Reopening an outdated review with a candidate triggers exactly one deliberate refresh. */
  private maybeAutoRefresh(reviewId: string) {
    const { tracked, versions, requests, autoRefreshed } = this.state;
    const r = tracked.reviews[reviewId];
    const v = r?.activeVersion ? versions[r.activeVersion] : null;
    if (!r || !v || r.blocked || isCurrent(tracked, r, v)) return;
    const req = requests[reviewId];
    if (req) return; // generating, or failed/interrupted: explicit Retry only
    const source = tracked.md.slice(r.from, r.to);
    if (autoRefreshed[reviewId] === source) return;
    if (this.state.activeRequest) {
      this.notify('Busy — another suggestion is generating. Refresh this one when it finishes.');
      return;
    }
    this.set({ autoRefreshed: { ...autoRefreshed, [reviewId]: source } }, false);
    this.requestSuggestion(reviewId, 'refresh');
  }

  private cancelIfEmptyDraft(reviewId: string) {
    const r = this.state.tracked.reviews[reviewId];
    if (!r || r.status !== 'open' || r.thoughts.length || r.activeVersion || this.state.requests[reviewId]) return;
    if (this.lastCreation?.reviewId === reviewId && this.history.dropIfTop(this.lastCreation.before)) {
      const before = this.lastCreation.before;
      this.lastCreation = null;
      this.set({ tracked: before, expanded: null });
      return;
    }
    this.commit(setStatus(this.state.tracked, reviewId, 'discarded'), undefined, { expanded: null });
  }

  commitThought(reviewId: string, thoughtId: string | null, text: string): string | null {
    const id = uid();
    const changed = this.commit(commitThought(this.state.tracked, reviewId, thoughtId, text, id));
    return changed && thoughtId === null ? id : null;
  }

  /**
   * Enter on a reflection: commit it, then ask for a suggestion directly. The first reflection produces the initial
   * suggestion; a new or edited later reflection requests an update (refresh when the passage changed meanwhile).
   * Unchanged reflections and busy/generating states never start a request.
   */
  submitReflection(reviewId: string, thoughtId: string | null, text: string) {
    const before = this.state.tracked.reviews[reviewId];
    const previous = thoughtId ? before?.thoughts.find((t) => t.id === thoughtId)?.text : undefined;
    this.commitThought(reviewId, thoughtId, text);
    const r = this.state.tracked.reviews[reviewId];
    if (!r || r.status !== 'open' || this.isGenerating(reviewId)) return;
    const changed = thoughtId === null ? text.trim() !== '' : previous !== undefined && previous.trim() !== text.trim();
    const v = r.activeVersion ? this.state.versions[r.activeVersion] : null;
    if (!v) {
      if (r.thoughts.some((t) => t.text.trim())) this.requestSuggestion(reviewId, 'initial');
      return;
    }
    if (!changed) return;
    if (this.state.activeRequest) {
      this.notify('Busy — your reflection is saved. Use Suggest when the other suggestion finishes.');
      return;
    }
    this.requestSuggestion(reviewId, isCurrent(this.state.tracked, r, v) ? 'refine' : 'refresh');
  }

  /** Explicit coherence repair after popping individual edits; popping alone never calls the model. */
  revise(reviewId: string) {
    const r = this.state.tracked.reviews[reviewId];
    const v = r?.activeVersion ? this.state.versions[r.activeVersion] : null;
    if (!r || !v || !r.popped.length || !isCurrent(this.state.tracked, r, v)) return 'invalid';
    return this.requestSuggestion(reviewId, 'revise');
  }

  popThought(reviewId: string, thoughtId: string) {
    if (this.isGenerating(reviewId)) return;
    if (this.commit(popThought(this.state.tracked, reviewId, thoughtId))) this.emit({ type: 'pop' });
  }

  popChange(reviewId: string, changeId: string) {
    if (this.isGenerating(reviewId)) return;
    if (this.commit(popChange(this.state.tracked, reviewId, changeId))) {
      this.emit({ type: 'pop' });
      this.notify('Change popped — the original wording stays in the suggestion.', { undo: true });
    }
  }

  /** Main X and Reject: discard the review and its thoughts; the document is untouched. */
  discard(reviewId: string) {
    const r = this.state.tracked.reviews[reviewId];
    if (!r || r.status !== 'open') return;
    this.cancelRequest(reviewId);
    const decisions = r.activeVersion ? [...this.state.decisions, this.decision(reviewId, 'rejected')] : this.state.decisions;
    this.commit(setStatus(this.state.tracked, reviewId, 'discarded'), undefined, {
      expanded: this.state.expanded === reviewId ? null : this.state.expanded,
      decisions,
    });
    this.emit({ type: 'pop' });
    this.notify('Review popped — the document is unchanged.', { undo: true });
  }

  accept(reviewId: string) {
    const r = this.state.tracked.reviews[reviewId];
    const v = r?.activeVersion ? this.state.versions[r.activeVersion] : null;
    if (!r || !v || this.isGenerating(reviewId)) return;
    const res = acceptReview(this.state.tracked, reviewId, v);
    if (!res.ok) {
      this.notify(res.reason, { tone: 'error' });
      return;
    }
    this.commit(res.next, undefined, {
      expanded: null,
      decisions: [...this.state.decisions, this.decision(reviewId, 'accepted', res.next)],
    });
    this.emit({ type: 'pop' });
  }

  retarget(reviewId: string, from: number, to: number) {
    if (from >= to) {
      this.notify('Select the passage this review should target, then choose Retarget.', { tone: 'error' });
      return;
    }
    this.commit(retarget(this.state.tracked, reviewId, from, to));
  }

  // ---- requests -----------------------------------------------------------------------------------------------

  isGenerating(reviewId: string) {
    return this.state.requests[reviewId]?.status === 'generating';
  }

  setMode(mode: Mode) {
    if (this.state.activeRequest) return;
    this.set({ prefs: { ...this.state.prefs, mode } });
  }

  setPrefs(patch: Partial<Prefs>) {
    this.set({ prefs: { ...this.state.prefs, ...patch } });
  }

  requestSuggestion(reviewId: string, action: SuggestAction): 'started' | 'busy' | 'invalid' {
    const { tracked, versions, activeRequest } = this.state;
    if (activeRequest) {
      this.notify('Busy — one suggestion at a time.');
      return 'busy';
    }
    const r = tracked.reviews[reviewId];
    if (!r || r.status !== 'open') return 'invalid';
    if (r.blocked) {
      this.notify('Retarget this review before asking for a suggestion.', { tone: 'error' });
      return 'invalid';
    }
    const thoughts = r.thoughts.map((t) => t.text).filter((t) => t.trim());
    if (!thoughts.length) {
      this.notify('Write a reflection first.', { tone: 'error' });
      return 'invalid';
    }
    const source = tracked.md.slice(r.from, r.to);
    if (source.length > LIMITS.selectionChars) {
      this.notify(`The selection is ${source.length.toLocaleString()} characters; the limit is ${LIMITS.selectionChars.toLocaleString()}.`, { tone: 'error' });
      return 'invalid';
    }
    if (thoughts.join('').length > LIMITS.reflectionChars) {
      this.notify(`Reflections exceed ${LIMITS.reflectionChars.toLocaleString()} characters.`, { tone: 'error' });
      return 'invalid';
    }
    const prior = r.activeVersion ? versions[r.activeVersion] : null;
    const keepOriginal = prior ? keepOriginalChoices(prior, r.popped) : [];
    // The writer's current proposal: the active suggestion with their pops applied.
    const effective = prior ? effectiveText(prior.diff, r.popped) : source;
    if ((action === 'refine' || action === 'revise') && !prior) return 'invalid';
    const priorThoughts = new Set((prior?.thoughts ?? []).map((t) => t.trim()));
    const requestId = uid();
    const mode = this.state.prefs.mode;
    const capture: Capture = {
      baseline: action === 'refine' || action === 'revise' ? effective : source,
      requestId,
      reviewId,
      action,
      mode,
      source,
      ...nearContext(tracked.md, r.from, r.to),
      thoughts,
      keepOriginal,
      revision: this.state.revision,
    };
    const payload: SuggestPayload = {
      requestId,
      reviewId,
      revision: this.state.revision,
      action,
      mode,
      selection: source,
      contextBefore: tracked.md.slice(Math.max(0, r.from - LIMITS.contextEachSide), r.from),
      contextAfter: tracked.md.slice(r.to, r.to + LIMITS.contextEachSide),
      reflections: r.thoughts
        .filter((t) => t.text.trim())
        .map((t) => ({ id: t.id, text: t.text, isNew: !!prior && !priorThoughts.has(t.text.trim()) })),
      prior: prior ? { source: prior.source, candidate: effective, keepOriginal } : null,
    };
    const controller = new AbortController();
    this.controllers.set(requestId, controller);
    const entry: LedgerEntry = {
      requestId,
      reviewId,
      action,
      mode,
      model: null,
      provider: null,
      status: 'pending',
      charged: 'unknown',
      usage: null,
      latencyMs: null,
      at: Date.now(),
    };
    this.set({
      requests: { ...this.state.requests, [reviewId]: { requestId, action, status: 'generating', startedAt: Date.now() } },
      activeRequest: { requestId, reviewId },
      ledger: [...this.state.ledger, entry],
    });
    this.suggestFn(payload, controller.signal).then(
      (res) => this.finish(capture, res),
      (err) => this.fail(capture, err),
    );
    return 'started';
  }

  private releaseLock(requestId: string): Partial<StoreState> {
    this.controllers.delete(requestId);
    return this.state.activeRequest?.requestId === requestId ? { activeRequest: null } : {};
  }

  /** One ledger entry per provider call; the automatic correction is recorded as attempt 2 of the same request. */
  private recordAttempts(c: Capture, attempts: AttemptInfo[], provider: string | null, status: LedgerEntry['status'], failedCharge?: 'no' | 'unknown') {
    let ledger = this.state.ledger;
    attempts.forEach((a, i) => {
      const id = i === 0 ? c.requestId : `${c.requestId}#${i + 1}`;
      const charged: LedgerEntry['charged'] = provider === 'fake' ? 'no' : a.usage.cost !== null ? 'yes' : 'unknown';
      const patch: Partial<LedgerEntry> = { status, model: a.model, provider, usage: a.usage, charged, latencyMs: a.latencyMs, attempt: i + 1 };
      if (ledger.some((e) => e.requestId === id)) ledger = ledger.map((e) => (e.requestId === id ? { ...e, ...patch } : e));
      else ledger = [...ledger, { requestId: id, reviewId: c.reviewId, action: c.action, mode: c.mode, at: Date.now(), ...patch } as LedgerEntry];
    });
    if (!attempts.length && failedCharge) {
      ledger = ledger.map((e) => (e.requestId === c.requestId ? { ...e, status, charged: failedCharge } : e));
    }
    return ledger;
  }

  private finish(c: Capture, res: SuggestResponse) {
    const base: Partial<StoreState> = this.releaseLock(c.requestId);
    const live = this.state.tracked.reviews[c.reviewId];
    const req = this.state.requests[c.reviewId];
    const accepted = live?.status === 'open' && req?.requestId === c.requestId && res.requestId === c.requestId;
    const attempts = res.attempts?.length ? res.attempts : [{ model: res.model, outcome: res.outcome, usage: res.usage, latencyMs: res.latencyMs }];
    const ledger = this.recordAttempts(c, attempts, res.provider, accepted ? 'completed' : 'ignored');
    if (!accepted) {
      this.set({ ...base, ledger });
      return;
    }
    const requests = { ...this.state.requests };
    delete requests[c.reviewId];
    const replacement = res.replacement ?? '';
    const unchanged = res.outcome === 'unchanged' || (res.outcome === 'replace' && isUnchanged(c.baseline, replacement));
    if (res.outcome !== 'replace' || unchanged) {
      // Never install a non-result: the previous proposal and reflections stay as they are.
      if (c.action === 'revise' && unchanged) {
        this.set({ ...base, ledger, requests });
        this.notify('Nothing to revise — the proposal already reads coherently.');
        return;
      }
      const reason = res.reason ? ` ${res.reason}` : '';
      const error =
        res.outcome === 'cannot_apply'
          ? `Could not apply.${reason}`
          : attempts.length > 1
            ? 'No change, even after one corrective retry. Your previous proposal is kept.'
            : `The model made no change.${reason} Your previous proposal is kept.`;
      requests[c.reviewId] = { requestId: c.requestId, action: c.action, status: 'failed', error, startedAt: Date.now() };
      this.set({ ...base, ledger, requests });
      return;
    }
    const version: CandidateVersion = {
      id: uid(),
      reviewId: c.reviewId,
      requestId: c.requestId,
      action: c.action,
      outcome: 'replace',
      reason: res.reason,
      source: c.source,
      nearBefore: c.nearBefore,
      nearAfter: c.nearAfter,
      replacement,
      diff: diffCandidate(c.source, replacement),
      thoughts: c.thoughts,
      keepOriginal: c.keepOriginal,
      mode: c.mode,
      model: res.model,
      provider: res.provider,
      usage: res.usage,
      latencyMs: res.latencyMs,
      revision: c.revision,
      createdAt: Date.now(),
      attempts: attempts.length,
      checks: keepOriginalChecks(replacement, c.keepOriginal),
    };
    this.set({ ...base, ledger, requests, versions: { ...this.state.versions, [version.id]: version } }, false);
    this.commit(installVersion(this.state.tracked, c.reviewId, version.id));
    const r = this.state.tracked.reviews[c.reviewId];
    if (!isCurrent(this.state.tracked, r, version)) {
      this.notify('The passage changed while this suggestion was generating, so it is outdated. Use Suggest to refresh it.');
    }
  }

  private fail(c: Capture, err: unknown) {
    const e = err instanceof ApiError ? err : new ApiError(String(err), 0, 'client', 'unknown');
    const cancelled = e.code === 'cancelled';
    const base = this.releaseLock(c.requestId);
    const status: LedgerEntry['status'] = cancelled ? 'cancelled' : 'failed';
    let ledger = this.recordAttempts(c, e.attempts, e.attempts.length ? 'openrouter' : null, status, e.charged === 'no' ? 'no' : 'unknown');
    if (e.attempts.length) {
      // The call that failed after a completed attempt has its own, unknown charge.
      ledger = [
        ...ledger,
        { requestId: `${c.requestId}#${e.attempts.length + 1}`, reviewId: c.reviewId, action: c.action, mode: c.mode, model: null, provider: null,
          status, charged: e.charged === 'no' ? 'no' : 'unknown', usage: null, latencyMs: null, at: Date.now(), attempt: e.attempts.length + 1 },
      ];
    }
    const requests = { ...this.state.requests };
    if (requests[c.reviewId]?.requestId === c.requestId) {
      if (cancelled) delete requests[c.reviewId];
      else requests[c.reviewId] = { ...requests[c.reviewId], status: 'failed', error: e.message };
    }
    this.set({ ...base, ledger, requests });
  }

  /** Stop waiting for a review's request; a late result is ignored but its usage is still recorded. */
  private cancelRequest(reviewId: string) {
    const req = this.state.requests[reviewId];
    if (!req) return;
    const requests = { ...this.state.requests };
    delete requests[reviewId];
    this.set({ requests }, false);
    if (req.status === 'generating') this.controllers.get(req.requestId)?.abort();
  }

  // ---- derived helpers ----------------------------------------------------------------------------------------

  private decision(reviewId: string, decision: DecisionEntry['decision'], t: Tracked = this.state.tracked): DecisionEntry {
    return { reviewId, versionId: t.reviews[reviewId]?.activeVersion ?? null, decision, revision: this.state.revision, at: Date.now() };
  }

  effectiveCandidate(reviewId: string): string | null {
    const r = this.state.tracked.reviews[reviewId];
    const v = r?.activeVersion ? this.state.versions[r.activeVersion] : null;
    return r && v ? effectiveText(v.diff, r.popped) : null;
  }

  // ---- persistence --------------------------------------------------------------------------------------------

  async load() {
    if (!this.persist) return;
    let saved: Persisted | null = null;
    let saveError: string | null = null;
    try {
      saved = await this.persist.load();
    } catch (e) {
      saveError = `Could not read saved work: ${String(e)}`;
    }
    if (saved && saved.v === 1) {
      // Recovery never replays requests: anything in flight becomes Interrupted with explicit Retry.
      const requests: Record<string, RequestState> = {};
      for (const [id, r] of Object.entries(saved.requests ?? {})) {
        requests[id] = r.status === 'generating' ? { ...r, status: 'interrupted', error: 'Interrupted by reload.' } : r;
      }
      const ledger = (saved.ledger ?? []).map((e) =>
        e.status === 'pending' ? { ...e, status: 'interrupted' as const, charged: 'unknown' as const } : e,
      );
      this.state = {
        ...this.state,
        loaded: true,
        hasDocument: true,
        doc: saved.doc,
        tracked: saved.tracked,
        revision: saved.revision,
        versions: saved.versions,
        requests,
        ledger,
        decisions: saved.decisions ?? [],
        prefs: { ...this.state.prefs, ...saved.prefs },
        saveStatus: 'saved',
        saveError,
      };
      this.listeners.forEach((fn) => fn());
      return;
    }
    this.set({ loaded: true, saveError }, false);
  }

  snapshot(): Persisted {
    const s = this.state;
    return {
      v: 1,
      doc: s.doc,
      tracked: s.tracked,
      revision: s.revision,
      versions: s.versions,
      requests: s.requests,
      ledger: s.ledger,
      decisions: s.decisions,
      prefs: s.prefs,
    };
  }

  private scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    if (this.state.saveStatus !== 'saving') this.set({ saveStatus: 'saving' }, false);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      const snap = this.snapshot();
      // Writes are serialized: a newer snapshot is always written after an older one completes.
      this.saving = this.saving.then(async () => {
        try {
          await this.persist!.save(snap);
          if (!this.saveTimer) this.set({ saveStatus: 'saved', saveError: null }, false);
        } catch (e) {
          this.set({ saveStatus: 'error', saveError: `Not saved in this browser: ${String(e)}. Export to keep your work.` }, false);
        }
      });
    }, 400);
  }
}
