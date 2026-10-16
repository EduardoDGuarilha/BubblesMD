import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type Ref, type TextareaHTMLAttributes } from 'react';
import { effectiveText } from '../core/changes';
import { isCurrent, type CandidateVersion, type ReviewState, type Thought } from '../core/workspace';
import type { RequestState, StoreState, WorkspaceStore } from '../state/store';
import { renderCandidate } from './candidateHtml';
import { chainDots, layoutChain } from '../core/geometry';
import { formatCost } from './format';
import { rupture, ruptureAll } from './fx';
import { CloseIcon, MinusIcon, PlusIcon } from './icons';

interface Props {
  store: WorkspaceStore;
  state: StoreState;
  review: ReviewState;
  raw: boolean;
  hovered: string | null;
  offscreen: boolean;
  onBackToPassage(): void;
  onRetarget(): void;
  onHoverChange(changeId: string | null): void;
  /** Called after the chain is re-laid out, so the passage connector can be re-routed. */
  onGeometryChange?(): void;
}

const isSubmitKey = (e: KeyboardEvent) => e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229;

/**
 * One review family: the suggestion bubble with its reflections clustered beneath it. Every bubble sizes to its
 * content. Enter on a reflection submits it (first → initial suggestion, later → updated suggestion).
 */
export function ReviewFamily({ store, state, review, raw, hovered, offscreen, onBackToPassage, onRetarget, onHoverChange, onGeometryChange }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const chainRef = useRef<HTMLDivElement>(null);
  const geometryRef = useRef(onGeometryChange);
  geometryRef.current = onGeometryChange;
  const signatureRef = useRef('');
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

  const popFamily = () => {
    ruptureAll(rootRef.current);
    store.discard(review.id);
  };

  // The reflections form one chain (suggestion → first → next → … → +) laid out from their measured sizes, with
  // connector dots computed from the actual edges. Re-run on every render and whenever any item resizes.
  const relayout = () => {
    const chain = chainRef.current;
    if (!chain) return;
    const items = [...chain.querySelectorAll<HTMLElement>(':scope > .chain-item')];
    const layout = layoutChain(
      items.map((el) => ({ w: el.offsetWidth, h: el.offsetHeight })),
      chain.clientWidth,
    );
    items.forEach((el, i) => {
      el.style.left = `${layout.rects[i].x}px`;
      el.style.top = `${layout.rects[i].y}px`;
    });
    chain.style.height = `${layout.height}px`;
    const main = rootRef.current?.querySelector<HTMLElement>(':scope > .review');
    const mainRect = main
      ? { x: main.offsetLeft - chain.offsetLeft, y: main.offsetTop - chain.offsetTop, w: main.offsetWidth, h: main.offsetHeight }
      : null;
    const svg = chain.querySelector(':scope > .chain-dots');
    if (svg) {
      svg.replaceChildren(
        ...chainDots(mainRect, layout).map((d) => {
          const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          c.setAttribute('cx', d.x.toFixed(1));
          c.setAttribute('cy', d.y.toFixed(1));
          c.setAttribute('r', d.r.toFixed(1));
          c.setAttribute('class', 'thought-dot');
          return c;
        }),
      );
    }
    // Notify only real geometry changes (the passage connector is re-routed), never on every render.
    const signature = JSON.stringify([layout.rects, mainRect, chain.clientWidth]);
    if (signature !== signatureRef.current) {
      signatureRef.current = signature;
      geometryRef.current?.();
    }
  };
  const relayoutRef = useRef(relayout);
  relayoutRef.current = relayout;
  useLayoutEffect(() => relayoutRef.current());
  useEffect(() => {
    const chain = chainRef.current;
    if (!chain) return;
    const ro = new ResizeObserver(() => relayoutRef.current());
    const observe = () => {
      ro.disconnect();
      ro.observe(chain);
      chain.querySelectorAll(':scope > .chain-item').forEach((el) => ro.observe(el));
      const main = rootRef.current?.querySelector(':scope > .review');
      if (main) ro.observe(main);
    };
    observe();
    const mo = new MutationObserver(observe);
    mo.observe(chain, { childList: true });
    // Window resizes re-wrap text; re-lay out directly too rather than relying on ResizeObserver timing alone.
    const onResize = () => relayoutRef.current();
    window.addEventListener('resize', onResize);
    return () => {
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return (
    <div className="family-inner" ref={rootRef}>
      <div className="pair-message" aria-live="polite">
        <span>{pairText(version, hovered) ?? summary}</span>
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
          onPopFamily={popFamily}
          onRetarget={onRetarget}
          onHoverChange={onHoverChange}
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
      <div ref={chainRef} className={`chain${version || request ? '' : ' draft'}`}>
        <svg className="chain-dots" aria-hidden="true" />
        {review.thoughts.map((t, i) => (
          <ThoughtBubble
            key={t.id}
            thought={t}
            index={i}
            locked={generating}
            onSubmit={(text) => store.submitReflection(review.id, t.id, text)}
            onCommit={(text) => store.commitThought(review.id, t.id, text)}
            onPop={(el) => {
              rupture(el);
              store.popThought(review.id, t.id);
            }}
          />
        ))}
        {adding && (
          <NewThought
            first={review.thoughts.length === 0}
            disabled={generating}
            onSubmit={(text) => {
              setAdding(false);
              store.submitReflection(review.id, null, text);
            }}
            onCommit={(text) => {
              setAdding(false);
              store.commitThought(review.id, null, text);
            }}
            onCancel={() => setAdding(false)}
            onDiscardReview={popFamily}
          />
        )}
        {!adding && (
          <button
            type="button"
            className="bubble add-thought chain-item"
            aria-label="Add a reflection"
            title="Add a reflection (Enter submits it)"
            disabled={generating}
            onClick={() => setAdding(true)}
          >
            <PlusIcon />
          </button>
        )}
      </div>
      {isDraft && review.thoughts.length > 0 && !adding && <p className="hint">Press Enter in a reflection to ask for a suggestion.</p>}
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
  onPopFamily,
  onRetarget,
  onHoverChange,
}: {
  store: WorkspaceStore;
  state: StoreState;
  review: ReviewState;
  version: CandidateVersion | null;
  request: RequestState | undefined;
  raw: boolean;
  busyElsewhere: boolean;
  onPopFamily(): void;
  onRetarget(): void;
  onHoverChange(changeId: string | null): void;
}) {
  const ref = useRef<HTMLElement>(null);
  const generating = request?.status === 'generating';
  const failed = request && request.status !== 'generating';
  const current = version ? isCurrent(state.tracked, review, version) : false;
  const effective = version ? effectiveText(version.diff, review.popped) : '';
  const nothing = !!version && effective === version.source;
  // Derived, never recorded: reflections the active suggestion was not generated from.
  const applied = new Set((version?.thoughts ?? []).map((t) => t.trim()));
  const unapplied = version ? review.thoughts.map((t) => t.text.trim()).filter((t) => t && !applied.has(t)) : [];
  const canAccept = !!version && current && !nothing && !generating;
  const hasThoughts = review.thoughts.some((t) => t.text.trim());
  const canSuggest = !generating && !busyElsewhere && hasThoughts && !review.blocked;
  const [details, setDetails] = useState(false);

  let heading = 'Possible revision';
  if (generating) heading = version ? 'Updating the suggestion…' : 'Thinking about your reflections…';
  else if (!version && failed) heading = request.status === 'interrupted' ? 'Interrupted' : 'No suggestion yet';
  else if (version && failed) heading = request.status === 'interrupted' ? 'Update interrupted — previous suggestion shown' : 'Update failed — previous suggestion shown';

  const chips: string[] = [];
  if (version && !generating) {
    if (review.blocked) chips.push('Needs retarget');
    else if (!current) chips.push('Outdated — the passage changed');
    if (unapplied.length)
      chips.push(`Not yet applied: “${unapplied[0].length > 36 ? `${unapplied[0].slice(0, 35)}…` : unapplied[0]}”${unapplied.length > 1 ? ` +${unapplied.length - 1}` : ''}`);
    if (nothing) chips.push('Nothing to apply');
    for (const check of version.checks ?? []) chips.push(check);
  }

  const decision = [...state.decisions].reverse().find((d) => d.reviewId === review.id && d.versionId === version?.id);

  return (
    <section ref={ref} className={`bubble review${generating ? ' generating' : ''}`} aria-label="Suggested revision" aria-busy={generating}>
      <div className="bubble-controls">
        <button type="button" className="tiny" aria-label="Minimize review" title="Minimize (Esc)" onClick={() => store.expand(null)}>
          <MinusIcon />
        </button>
        <button type="button" className="tiny" aria-label="Pop this review" title="Pop review (discard)" onClick={onPopFamily}>
          <CloseIcon />
        </button>
      </div>
      <div className="review-heading">{heading}</div>
      {chips.length > 0 && (
        <div className="chips">
          {chips.map((c) => (
            <span key={c} className={`chip${c.startsWith('Changed wording') || c.startsWith('Re-added') || c.startsWith('Not yet applied') ? ' warn' : ''}`}>
              {c}
            </span>
          ))}
        </div>
      )}
      {failed && (
        <div className="error-note" role="alert">
          <span>{request.error ?? 'The request did not complete.'}</span>
          <button type="button" className="pill" disabled={busyElsewhere} onClick={() => store.requestSuggestion(review.id, request.action)}>
            Retry
          </button>
        </div>
      )}
      {generating && !version && (
        <div className="thinking" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      )}
      {version && (
        <>
          {effective === '' && !nothing && <p className="reason">This suggestion deletes the whole selection.</p>}
          <CandidateBody
            reviewId={review.id}
            version={version}
            popped={review.popped}
            raw={raw}
            locked={generating}
            onPop={(id) => store.popChange(review.id, id)}
            onHover={onHoverChange}
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
          <button
            type="button"
            className="pill accept"
            disabled={!canAccept}
            onClick={() => {
              ruptureAll(ref.current?.closest('.family-inner'));
              store.accept(review.id);
            }}
          >
            Accept
          </button>
        )}
        {/* Without a suggestion yet, progress or the failure's Retry is the only action. */}
        {version && (
          <button
            type="button"
            className="pill"
            disabled={!canSuggest}
            title={
              busyElsewhere ? 'Busy — another suggestion is generating' : current ? 'Generate a new suggestion from your reflections' : 'Suggest again for the changed passage'
            }
            onClick={() => store.requestSuggestion(review.id, current ? 'refine' : 'refresh')}
          >
            {busyElsewhere ? 'Busy' : current ? 'Try again' : 'Refresh'}
          </button>
        )}
        <button type="button" className="pill" onClick={onPopFamily}>
          Reject
        </button>
      </div>
      {version && (
        <div className="cand-meta">
          <button type="button" className="link-button" aria-expanded={details} onClick={() => setDetails(!details)}>
            {version.mode === 'smart' ? 'Smart' : 'Fast'} · {shortModel(version.model)} · {formatCost(version.usage.cost, version.provider)}
            {(version.attempts ?? 1) > 1 ? ' · 2 calls' : ''}
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
              <dd>
                {formatCost(version.usage.cost, version.provider)}
                {(version.attempts ?? 1) > 1 ? ' (includes one corrective retry)' : ''}
              </dd>
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
  if (g.kind === 'added') return `Added · “${clip(g.replacement)}” · click to remove`;
  if (g.kind === 'deleted') return `Deleted · “${clip(g.original)}” · click to keep it`;
  return `${KIND_NAME[g.kind]} · “${clip(g.original)}” → “${clip(g.replacement)}” · click to keep the original`;
}

const fmt = (n: number | null) => (n === null ? '?' : n.toLocaleString());
const shortModel = (m: string) => m.split('/').pop() ?? m;

function CandidateBody({
  reviewId,
  version,
  popped,
  raw,
  locked,
  onPop,
  onHover,
}: {
  reviewId: string;
  version: CandidateVersion;
  popped: string[];
  raw: boolean;
  locked: boolean;
  onPop(id: string): void;
  onHover(id: string | null): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const { root } = renderCandidate(version.diff, popped, raw, reviewId);
    ref.current?.replaceChildren(...root.childNodes);
  }, [version, popped, raw, reviewId]);

  const activate = (target: EventTarget | null) => {
    const el = (target as HTMLElement | null)?.closest<HTMLElement>('[data-change]');
    if (!el || locked) return false;
    rupture(el);
    onHover(null);
    onPop(el.dataset.change!);
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

/** Textarea that grows with its text in both directions (hidden mirror in the same grid cell). */
type GrowProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string; textareaRef?: Ref<HTMLTextAreaElement> };

function GrowArea({ value, placeholder, textareaRef, ...props }: GrowProps) {
  return (
    <span className="grow" data-value={`${value || placeholder || ''} `}>
      <textarea ref={textareaRef} rows={1} cols={1} value={value} placeholder={placeholder} {...props} />
    </span>
  );
}

function ThoughtBubble({
  thought,
  index,
  locked,
  onSubmit,
  onCommit,
  onPop,
}: {
  thought: Thought;
  index: number;
  locked: boolean;
  onSubmit(text: string): void;
  onCommit(text: string): void;
  onPop(el: Element | null): void;
}) {
  const [text, setText] = useState(thought.text);
  const ref = useRef<HTMLElement>(null);
  const submitted = useRef(false);
  useEffect(() => setText(thought.text), [thought.text]);
  const pending = text !== thought.text;
  return (
    <section
      ref={ref}
      className={`bubble thought chain-item${pending ? ' pending' : ''}`}
      aria-label={`Reflection ${index + 1}`}
      title={pending ? 'Not sent yet — Enter sends it, Shift+Enter adds a line' : undefined}
    >
      <GrowArea
        value={text}
        readOnly={locked}
        aria-label={`Reflection ${index + 1} — Enter submits, Shift+Enter adds a line`}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => (submitted.current = false)}
        onBlur={() => !submitted.current && text !== thought.text && onCommit(text)}
        onKeyDown={(e) => {
          if (isSubmitKey(e)) {
            e.preventDefault();
            submitted.current = true;
            onSubmit(text);
            (e.target as HTMLTextAreaElement).blur();
          }
        }}
      />
      <button
        type="button"
        className="tiny pop-x"
        aria-label={`Pop reflection ${index + 1}`}
        title="Pop reflection"
        disabled={locked}
        onClick={() => onPop(ref.current)}
      >
        <CloseIcon />
      </button>
    </section>
  );
}

function NewThought({
  first,
  disabled,
  onSubmit,
  onCommit,
  onCancel,
  onDiscardReview,
}: {
  first: boolean;
  disabled: boolean;
  onSubmit(text: string): void;
  onCommit(text: string): void;
  onCancel(): void;
  onDiscardReview(): void;
}) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  const finish = (submit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (!text.trim()) onCancel();
    else if (submit) onSubmit(text);
    else onCommit(text);
  };
  // Without preventScroll the browser would scroll toward the family before it is placed beside its passage.
  useEffect(() => ref.current?.focus({ preventScroll: true }), []);
  return (
    <section
      className="bubble thought new pending chain-item"
      aria-label={first ? 'First reflection' : 'New reflection'}
      title="Enter sends it · Shift+Enter adds a line"
    >
      <GrowArea
        textareaRef={ref}
        value={text}
        disabled={disabled}
        placeholder={first ? 'What should change here?' : 'Another thought…'}
        aria-label={first ? 'First reflection — Enter asks for a suggestion' : 'New reflection — Enter asks for an updated suggestion'}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => finish(false)}
        onKeyDown={(e) => {
          if (isSubmitKey(e)) {
            e.preventDefault();
            if (text.trim()) finish(true);
          }
        }}
      />
      <button
        type="button"
        className="tiny pop-x"
        aria-label={first ? 'Pop this review' : 'Cancel reflection'}
        title={first ? 'Pop review' : 'Cancel'}
        onMouseDown={(e) => e.preventDefault()}
        onClick={first ? onDiscardReview : onCancel}
      >
        <CloseIcon />
      </button>
    </section>
  );
}
