import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { effectiveText } from '../core/changes';
import { isCurrent, type CandidateVersion, type ReviewState, type Thought } from '../core/workspace';
import type { RequestState, StoreState, WorkspaceStore } from '../state/store';
import { renderCandidate } from './candidateHtml';
import { formatCost } from './format';

interface Props {
  store: WorkspaceStore;
  state: StoreState;
  review: ReviewState;
  raw: boolean;
  hovered: string | null;
  offscreen: boolean;
  onBackToPassage(): void;
  onRetarget(): void;
  onLocateChange(changeId: string | null): void;
}

const isSubmitKey = (e: KeyboardEvent) => e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229;

export function ReviewFamily({ store, state, review, raw, hovered, offscreen, onBackToPassage, onRetarget, onLocateChange }: Props) {
  const version = review.activeVersion ? state.versions[review.activeVersion] : null;
  const request: RequestState | undefined = state.requests[review.id];
  const generating = request?.status === 'generating';
  const busyElsewhere = !!state.activeRequest && state.activeRequest.reviewId !== review.id;
  const isDraft = !version && !request;
  const [adding, setAdding] = useState<boolean>(isDraft && review.thoughts.length === 0);

  const changes = version?.diff.groups.filter((g) => !review.popped.includes(g.id)).length ?? 0;
  const summary = [
    version ? `${changes} ${changes === 1 ? 'change' : 'changes'}` : null,
    `${review.thoughts.length} ${review.thoughts.length === 1 ? 'thought' : 'thoughts'}`,
  ]
    .filter(Boolean)
    .join(' · ');

  /** Enter on a reflection: before any candidate exists it submits the first request; afterwards it only commits locally. */
  const commitAndMaybeSubmit = (thoughtId: string | null, text: string) => {
    store.commitThought(review.id, thoughtId, text);
    const live = store.state.tracked.reviews[review.id];
    if (!live.activeVersion && !store.state.requests[review.id] && live.thoughts.some((t) => t.text.trim())) {
      store.requestSuggestion(review.id, 'initial');
    }
  };

  return (
    <div className="family-inner">
      <div className="pair-message" aria-live="polite">
        {pairText(version, hovered) ?? summary}
        {offscreen && (
          <button type="button" className="link-button back" onClick={onBackToPassage}>
            Back to passage
          </button>
        )}
      </div>
      {(version || request) && (
        <MainBubble
          store={store}
          state={state}
          review={review}
          version={version}
          request={request}
          raw={raw}
          busyElsewhere={busyElsewhere}
          onRetarget={onRetarget}
          onLocateChange={onLocateChange}
        />
      )}
      {review.blocked && !version && !request && (
        <div className="blocked-note">
          Part of this passage was overwritten. Select the text this review should target, then{' '}
          <button type="button" className="link-button" onClick={onRetarget}>
            Retarget
          </button>
          .
        </div>
      )}
      <div className="thoughts">
        {review.thoughts.map((t, i) => (
          <ThoughtBubble
            key={t.id}
            thought={t}
            index={i}
            locked={generating}
            first={i === 0 && !version && !request}
            onCommit={(text, submit) => (submit && isDraft ? commitAndMaybeSubmit(t.id, text) : store.commitThought(review.id, t.id, text))}
            onPop={() => store.popThought(review.id, t.id)}
          />
        ))}
        {adding && (
          <NewThought
            first={review.thoughts.length === 0}
            disabled={generating}
            onCommit={(text, submit) => {
              if (submit && isDraft) commitAndMaybeSubmit(null, text);
              else store.commitThought(review.id, null, text);
              setAdding(false);
            }}
            onCancel={() => setAdding(false)}
            onDiscardReview={() => store.discard(review.id)}
          />
        )}
      </div>
      {!adding && (
        <button
          type="button"
          className="add-thought"
          aria-label="Add a reflection"
          title="Add a reflection"
          disabled={generating}
          onClick={() => setAdding(true)}
        >
          +
        </button>
      )}
      {isDraft && review.thoughts.length > 0 && !adding && (
        <p className="hint">Press Enter in a reflection to ask for a suggestion.</p>
      )}
    </div>
  );
}

function MainBubble({
  store,
  state,
  review,
  version,
  request,
  raw,
  busyElsewhere,
  onRetarget,
  onLocateChange,
}: {
  store: WorkspaceStore;
  state: StoreState;
  review: ReviewState;
  version: CandidateVersion | null;
  request: RequestState | undefined;
  raw: boolean;
  busyElsewhere: boolean;
  onRetarget(): void;
  onLocateChange(changeId: string | null): void;
}) {
  const generating = request?.status === 'generating';
  const failed = request && request.status !== 'generating';
  const current = version ? isCurrent(state.tracked, review, version) : false;
  const effective = version ? effectiveText(version.diff, review.popped) : '';
  const nothing = version?.outcome === 'replace' && effective === version.source;
  const thoughtsChanged =
    !!version &&
    JSON.stringify(review.thoughts.map((t) => t.text.trim()).filter(Boolean)) !== JSON.stringify(version.thoughts.map((t) => t.trim()));
  const canAccept = !!version && version.outcome === 'replace' && current && !nothing && !generating;
  const hasThoughts = review.thoughts.some((t) => t.text.trim());
  const canSuggest = !generating && !busyElsewhere && hasThoughts && !review.blocked;
  const [details, setDetails] = useState(false);

  let heading = 'Possible revision';
  if (generating) heading = version ? 'Updating the suggestion…' : 'Thinking about your reflections…';
  else if (version?.outcome === 'unchanged') heading = 'No change suggested';
  else if (version?.outcome === 'cannot_apply') heading = 'Could not apply';
  else if (!version && failed) heading = request.status === 'interrupted' ? 'Interrupted' : 'Suggestion failed';

  const chips: string[] = [];
  if (version && !generating) {
    if (review.blocked) chips.push('Needs retarget');
    else if (!current) chips.push('Outdated — the passage changed');
    if (thoughtsChanged) chips.push('Thoughts changed');
    if (nothing) chips.push('Nothing to apply');
  }

  const decision = [...state.decisions].reverse().find((d) => d.reviewId === review.id && d.versionId === version?.id);

  return (
    <section className={`review${generating ? ' generating' : ''}`} aria-label="Suggested revision" aria-busy={generating}>
      <div className="bubble-controls">
        <button type="button" className="tiny" aria-label="Minimize review" title="Minimize (Esc)" onClick={() => store.expand(null)}>
          −
        </button>
        <button type="button" className="tiny" aria-label="Pop this review" title="Pop review (discard)" onClick={() => store.discard(review.id)}>
          ×
        </button>
      </div>
      <div className="review-heading">{heading}</div>
      {chips.length > 0 && (
        <div className="chips">
          {chips.map((c) => (
            <span key={c} className="chip">
              {c}
            </span>
          ))}
        </div>
      )}
      {failed && (
        <div className="error-note" role="alert">
          {request.error ?? 'The request did not complete.'}{' '}
          <button type="button" className="pill" disabled={busyElsewhere} onClick={() => store.requestSuggestion(review.id, request.action)}>
            Retry
          </button>
        </div>
      )}
      {generating && !version && <div className="thinking" aria-hidden="true"><span /><span /><span /></div>}
      {version && version.outcome !== 'replace' && version.reason && <p className="reason">{version.reason}</p>}
      {version && version.outcome === 'replace' && (
        <>
          {effective === '' && !nothing && <p className="reason">This suggestion deletes the whole selection.</p>}
          <CandidateBody
            version={version}
            popped={review.popped}
            raw={raw}
            locked={generating || !current}
            onPop={(id) => store.popChange(review.id, id)}
            onHover={onLocateChange}
          />
        </>
      )}
      {review.blocked && (
        <div className="blocked-note">
          Part of this passage was overwritten. Select the text this review should target, then{' '}
          <button type="button" className="link-button" onClick={onRetarget}>
            Retarget
          </button>
          .
        </div>
      )}
      <div className="actions">
        {version && (
          <button type="button" className="pill accept" disabled={!canAccept} onClick={() => store.accept(review.id)}>
            Accept
          </button>
        )}
        <button
          type="button"
          className="pill"
          disabled={!canSuggest}
          title={busyElsewhere ? 'Busy — another suggestion is generating' : undefined}
          onClick={() => store.requestSuggestion(review.id, version && !current ? 'refresh' : version ? 'refine' : 'initial')}
        >
          {busyElsewhere ? 'Busy' : version && !current ? 'Refresh' : 'Suggest'}
        </button>
        <button type="button" className="pill" onClick={() => store.discard(review.id)}>
          Reject
        </button>
      </div>
      {version && (
        <div className="cand-meta">
          <button type="button" className="link-button" aria-expanded={details} onClick={() => setDetails(!details)}>
            {version.mode === 'smart' ? 'Smart' : 'Fast'} · {shortModel(version.model)} · {formatCost(version.usage.cost, version.provider)}
          </button>
          {details && (
            <dl className="details">
              <dt>Model</dt>
              <dd>{version.model}</dd>
              <dt>Tokens</dt>
              <dd>
                {fmt(version.usage.promptTokens)} in · {fmt(version.usage.completionTokens)} out · {fmt(version.usage.reasoningTokens)} reasoning
              </dd>
              <dt>Cost</dt>
              <dd>{formatCost(version.usage.cost, version.provider)}</dd>
              <dt>Latency</dt>
              <dd>{(version.latencyMs / 1000).toFixed(1)} s</dd>
              <dt>Request</dt>
              <dd>
                {version.action} · revision {version.revision} · {version.requestId.slice(0, 8)}
              </dd>
              <dt>Status</dt>
              <dd>{decision?.decision ?? 'pending'}</dd>
            </dl>
          )}
        </div>
      )}
    </section>
  );
}

const KIND_NAME = { added: 'Added', altered: 'Altered', deleted: 'Deleted' } as const;
const clip = (s: string) => (s.trim().length > 48 ? `${s.trim().slice(0, 47)}…` : s.trim());

function pairText(version: CandidateVersion | null, hovered: string | null): string | null {
  const g = hovered && version?.diff.groups.find((x) => x.id === hovered);
  if (!g) return null;
  if (g.kind === 'added') return `Added · “${clip(g.replacement)}”`;
  if (g.kind === 'deleted') return `Deleted · “${clip(g.original)}”`;
  return `${KIND_NAME[g.kind]} · “${clip(g.original)}” → “${clip(g.replacement)}”`;
}

const fmt = (n: number | null) => (n === null ? '?' : n.toLocaleString());
const shortModel = (m: string) => m.split('/').pop() ?? m;

function CandidateBody({
  version,
  popped,
  raw,
  locked,
  onPop,
  onHover,
}: {
  version: CandidateVersion;
  popped: string[];
  raw: boolean;
  locked: boolean;
  onPop(id: string): void;
  onHover(id: string | null): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const { root } = renderCandidate(version.diff, popped, raw);
    ref.current?.replaceChildren(...root.childNodes);
  }, [version, popped, raw]);

  const activate = (target: EventTarget | null) => {
    const el = (target as HTMLElement | null)?.closest<HTMLElement>('[data-change]');
    if (!el || locked) return false;
    onPop(el.dataset.change!);
    onHover(null);
    return true;
  };

  return (
    <div
      ref={ref}
      className={`candidate${raw ? ' raw' : ''}${locked ? ' locked' : ''}`}
      onClick={(e) => {
        if (activate(e.target)) e.preventDefault();
      }}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && activate(e.target)) e.preventDefault();
      }}
    />
  );
}

function autosize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

function ThoughtBubble({
  thought,
  index,
  locked,
  first,
  onCommit,
  onPop,
}: {
  thought: Thought;
  index: number;
  locked: boolean;
  first: boolean;
  onCommit(text: string, submit: boolean): void;
  onPop(): void;
}) {
  const [text, setText] = useState(thought.text);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setText(thought.text), [thought.text]);
  useLayoutEffect(() => autosize(ref.current), [text]);
  return (
    <section className="thought" aria-label={`Reflection ${index + 1}`}>
      <button type="button" className="tiny" aria-label={`Pop reflection ${index + 1}`} title="Pop reflection" disabled={locked} onClick={onPop}>
        ×
      </button>
      <textarea
        ref={ref}
        value={text}
        rows={1}
        readOnly={locked}
        aria-label={`Reflection ${index + 1}`}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== thought.text && onCommit(text, false)}
        onKeyDown={(e) => {
          if (isSubmitKey(e)) {
            e.preventDefault();
            onCommit(text, first);
            (e.target as HTMLTextAreaElement).blur();
          }
        }}
      />
    </section>
  );
}

function NewThought({
  first,
  disabled,
  onCommit,
  onCancel,
  onDiscardReview,
}: {
  first: boolean;
  disabled: boolean;
  onCommit(text: string, submit: boolean): void;
  onCancel(): void;
  onDiscardReview(): void;
}) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  const finish = (submit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (text.trim()) onCommit(text, submit);
    else onCancel();
  };
  useEffect(() => ref.current?.focus(), []);
  useLayoutEffect(() => autosize(ref.current), [text]);
  return (
    <section className="thought new" aria-label={first ? 'First reflection' : 'New reflection'}>
      <button
        type="button"
        className="tiny"
        aria-label={first ? 'Pop this review' : 'Cancel reflection'}
        title={first ? 'Pop review' : 'Cancel'}
        onMouseDown={(e) => e.preventDefault()}
        onClick={first ? onDiscardReview : onCancel}
      >
        ×
      </button>
      <textarea
        ref={ref}
        value={text}
        rows={first ? 2 : 1}
        disabled={disabled}
        placeholder={first ? 'What should change here? Enter to ask · Shift+Enter for a new line' : 'Another thought… (Enter to add)'}
        aria-label={first ? 'First reflection — Enter asks for a suggestion' : 'New reflection'}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => finish(false)}
        onKeyDown={(e) => {
          if (isSubmitKey(e)) {
            e.preventDefault();
            if (text.trim()) finish(true);
          }
        }}
      />
    </section>
  );
}
