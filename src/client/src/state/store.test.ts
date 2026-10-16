import { describe, expect, it } from 'vitest';
import { WorkspaceStore } from './store';
import type { SuggestPayload, SuggestResponse } from '../services/api';
import { diffCandidate, effectiveText, tokenize } from '../core/changes';
import { diffText } from '../core/textChanges';

/** A suggest function whose responses the test resolves explicitly. */
function controlledSuggest() {
  const calls: { payload: SuggestPayload; resolve: (r: Partial<SuggestResponse>) => void; signal: AbortSignal }[] = [];
  const fn = (payload: SuggestPayload, signal: AbortSignal) =>
    new Promise<SuggestResponse>((resolve) => {
      calls.push({
        payload,
        signal,
        resolve: (r) =>
          resolve({
            requestId: payload.requestId,
            reviewId: payload.reviewId,
            revision: payload.revision,
            outcome: 'replace',
            replacement: payload.selection,
            reason: null,
            mode: payload.mode,
            model: 'test/model',
            provider: 'openrouter',
            usage: { promptTokens: 10, completionTokens: 5, reasoningTokens: 0, cost: 0.001 },
            latencyMs: 5,
            ...r,
          }),
      });
    });
  return { fn, calls };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function userEdit(store: WorkspaceStore, md: string, hint?: number) {
  store.edit(md, diffText(store.state.tracked.md, md, hint));
}

async function reviewWithCandidate(store: WorkspaceStore, s: ReturnType<typeof controlledSuggest>, from: number, to: number, replacement: string) {
  const id = store.createReview(from, to)!;
  store.commitThought(id, null, 'make it better');
  expect(store.requestSuggestion(id, 'initial')).toBe('started');
  s.calls[s.calls.length - 1].resolve({ replacement });
  await flush();
  return id;
}

const DOC = 'The cat sat. The cat ran. The cat slept.';

describe('targeting and acceptance', () => {
  it('replaces only the selected occurrence of repeated wording, after edits before the target', async () => {
    const s = controlledSuggest();
    const store = new WorkspaceStore(s.fn);
    store.newDocument(DOC, { title: 't', fileName: null });
    const second = DOC.indexOf('The cat ran');
    const id = await reviewWithCandidate(store, s, second, second + 'The cat ran'.length, 'The dog ran');
    // Unrelated edit far before the target only moves the anchor.
    userEdit(store, 'Intro paragraph that is long enough to stay outside the nearby context window of the review, really.\n\n' + DOC.replace('The cat sat.', 'The cat sat quietly.'));
    expect(store.state.tracked.reviews[id].status).toBe('open');
    // Nearby context changed -> conservatively outdated; undo the edit and it is current again.
    store.undo();
    store.accept(id);
    expect(store.state.tracked.md).toBe('The cat sat. The dog ran. The cat slept.');
    store.undo();
    expect(store.state.tracked.md).toBe(DOC);
    expect(store.state.tracked.reviews[id].status).toBe('open');
  });

  it('moves anchors through far edits and refuses stale acceptance after an edit inside the target', async () => {
    const s = controlledSuggest();
    const store = new WorkspaceStore(s.fn);
    const filler = 'x'.repeat(300);
    const doc = `${filler}\n\nKeep this sentence short.`;
    store.newDocument(doc, { title: 't', fileName: null });
    const from = doc.indexOf('Keep');
    const id = await reviewWithCandidate(store, s, from, doc.length, 'Keep it short.');
    userEdit(store, 'New first line.\n' + doc, 0);
    const r = store.state.tracked.reviews[id];
    expect(store.state.tracked.md.slice(r.from, r.to)).toBe('Keep this sentence short.');
    userEdit(store, store.state.tracked.md.replace('this sentence', 'this whole sentence'));
    store.accept(id);
    expect(store.state.tracked.md).toContain('this whole sentence');
    expect(store.state.notice?.text).toMatch(/outdated/);
  });

  it('does not let a late response overwrite a discarded review, but records its usage', async () => {
    const s = controlledSuggest();
    const store = new WorkspaceStore(s.fn);
    store.newDocument(DOC, { title: 't', fileName: null });
    const id = store.createReview(0, 12)!;
    store.commitThought(id, null, 'shorter');
    store.requestSuggestion(id, 'initial');
    store.discard(id);
    expect(s.calls[0].signal.aborted).toBe(true);
    s.calls[0].resolve({ replacement: 'Cat sat.' });
    await flush();
    expect(store.state.tracked.reviews[id].activeVersion).toBeNull();
    expect(store.state.activeRequest).toBeNull();
    expect(store.state.ledger).toHaveLength(1);
  });

  it('pops a review whose target is completely deleted, and undo restores both', async () => {
    const s = controlledSuggest();
    const store = new WorkspaceStore(s.fn);
    store.newDocument(DOC, { title: 't', fileName: null });
    const id = await reviewWithCandidate(store, s, 13, 25, 'The dog ran.');
    userEdit(store, DOC.slice(0, 12) + DOC.slice(25), 12);
    expect(store.state.tracked.reviews[id].status).toBe('targetDeleted');
    store.undo();
    expect(store.state.tracked.md).toBe(DOC);
    expect(store.state.tracked.reviews[id].status).toBe('open');
  });

  it('blocks a review when an edit overwrites only one boundary of its scope', async () => {
    const s = controlledSuggest();
    const store = new WorkspaceStore(s.fn);
    store.newDocument(DOC, { title: 't', fileName: null });
    const id = await reviewWithCandidate(store, s, 13, 25, 'The dog ran.');
    userEdit(store, DOC.slice(0, 10) + 'X' + DOC.slice(17));
    expect(store.state.tracked.reviews[id].blocked).toBe(true);
    expect(store.requestSuggestion(id, 'refresh')).toBe('invalid');
  });
});

describe('Undo/Redo keeps candidate version, thoughts and pops linked', () => {
  it('restores v1 with its pop after refining to v2, and redo returns v2 from cache', async () => {
    const s = controlledSuggest();
    const store = new WorkspaceStore(s.fn);
    store.newDocument(DOC, { title: 't', fileName: null });
    const other = await reviewWithCandidate(store, s, 26, DOC.length, 'The cat napped.');
    const id = await reviewWithCandidate(store, s, 0, 12, 'A small cat sat down.');
    const v1 = store.state.tracked.reviews[id].activeVersion!;
    const groups = store.state.versions[v1].diff.groups;
    expect(groups.length).toBeGreaterThan(1);
    const c2 = groups[1].id;
    store.popChange(id, c2);
    store.commitThought(id, null, 'keep it calm');
    const thoughtsAtV1 = store.state.tracked.reviews[id].thoughts.map((t) => t.text);
    const spend = () => store.state.ledger.reduce((sum, e) => sum + (e.usage?.cost ?? 0), 0);
    store.requestSuggestion(id, 'refine');
    expect(s.calls[s.calls.length - 1].payload.prior?.keepOriginal).toEqual([
      { original: groups[1].original, proposed: groups[1].replacement },
    ]);
    s.calls[s.calls.length - 1].resolve({ replacement: 'A calm cat sat down.' });
    await flush();
    const v2 = store.state.tracked.reviews[id].activeVersion!;
    expect(v2).not.toBe(v1);
    expect(store.state.tracked.reviews[id].popped).toEqual([]);
    const spent = spend();
    const callCount = s.calls.length;

    store.undo();
    let r = store.state.tracked.reviews[id];
    expect(r.activeVersion).toBe(v1);
    expect(r.popped).toEqual([c2]);
    expect(r.thoughts.map((t) => t.text)).toEqual(thoughtsAtV1);

    store.redo();
    r = store.state.tracked.reviews[id];
    expect(r.activeVersion).toBe(v2);
    expect(r.popped).toEqual([]);
    expect(s.calls.length).toBe(callCount);
    expect(spend()).toBe(spent);

    // Accept -> Undo restores the source and this review with its version/pops; the other review survives.
    store.popChange(id, store.state.versions[v2].diff.groups[0]?.id ?? 'none');
    const poppedBefore = store.state.tracked.reviews[id].popped;
    const mdBefore = store.state.tracked.md;
    store.accept(id);
    expect(store.state.tracked.reviews[id].status).toBe('accepted');
    expect(store.state.tracked.reviews[other].status).toBe('open');
    store.undo();
    r = store.state.tracked.reviews[id];
    expect(store.state.tracked.md).toBe(mdBefore);
    expect(r.status).toBe('open');
    expect(r.activeVersion).toBe(v2);
    expect(r.popped).toEqual(poppedBefore);
    expect(store.state.tracked.reviews[other].status).toBe('open');
    expect(spend()).toBe(spent);
  });
});

describe('change groups', () => {
  it('tokenizes losslessly and classifies alteration, addition and deletion with stable pops', () => {
    const source = 'We will invite twenty volunteers and track time spent.';
    const candidate = 'We will invite ten volunteers and track outcomes. Each request records cost.';
    expect(tokenize(source).join('')).toBe(source);
    const d = diffCandidate(source, candidate);
    expect(effectiveText(d, [])).toBe(candidate);
    expect(effectiveText(d, d.groups.map((g) => g.id))).toBe(source);
    expect(d.groups.map((g) => g.kind)).toContain('altered');
    const deletion = diffCandidate('Keep this and remove that.', 'Keep this.');
    expect(deletion.groups.some((g) => g.kind === 'deleted')).toBe(true);
    const addition = diffCandidate('Short.', 'Short. Added sentence.');
    expect(addition.groups.map((g) => g.kind)).toEqual(['added']);
  });
});
