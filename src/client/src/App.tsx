import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { isCurrent, openReviews } from './core/workspace';
import { placeSelectionAction } from './core/geometry';
import type { ChangeKind } from './core/changes';
import type { Hunk } from './core/textChanges';
import type { WorkspaceStore } from './state/store';
import { fetchConfig, type AppConfig } from './services/api';
import { FormattedEditor, type FormatCommand, type FormattedHandle } from './editor/FormattedEditor';
import { MarkdownEditor } from './editor/MarkdownEditor';
import { scanUnsupported } from './editor/markdownModel';
import { EMPTY_SPEC, type DecorationSpec, type EditorCallbacks, type EditorHandle } from './editor/types';
import { Landing } from './ui/Landing';
import { ReviewLayer } from './ui/ReviewLayer';
import { Toolbar } from './ui/Toolbar';
import { playPop, preloadPop } from './ui/sound';
import { rupture } from './ui/fx';
import { CloseIcon, PlusIcon } from './ui/icons';

/** Size of the selection's "+ Bubble" action (fixed in styles.css). */
const SEL_ACTION = { w: 84, h: 28 };
/** Peek at a minimized review's passage: a soft tint and inset underline, no layout change. */
const PEEK_STYLE =
  'background-color: var(--peek); box-shadow: inset 0 -2px 0 var(--edge); border-radius: 3px; box-decoration-break: clone; -webkit-box-decoration-break: clone;';
/** Hovered pop target: a stronger ring on the element's own rounded outline plus a restrained glow in its colour. */
const RING_STYLE =
  'box-shadow: 0 0 0 1.5px var(--ring), 0 0 7px 1px color-mix(in srgb, var(--ring) 45%, transparent); opacity: 1; box-decoration-break: clone; -webkit-box-decoration-break: clone;';

const MAX_IMPORT = 1_048_576;

async function readMarkdownFile(file: File): Promise<{ md: string; title: string; fileName: string } | { error: string }> {
  if (file.size > MAX_IMPORT) return { error: `${file.name} is larger than 1 MiB.` };
  if (!/\.(md|markdown|txt)$/i.test(file.name) && !/^text\//.test(file.type))
    return { error: `${file.name} is not a Markdown or plain-text file. Only .md, .markdown and .txt files can be opened.` };
  const text = await file.text();
  if (text.includes('\u0000')) return { error: `${file.name} looks like a binary file, not Markdown.` };
  return { md: text.replace(/\r\n?/g, '\n'), title: file.name.replace(/\.(md|markdown|txt)$/i, ''), fileName: file.name };
}

function useMediaQuery(query: string) {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setMatch(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return match;
}

type PendingReplace = { kind: 'new' } | { kind: 'home' } | { kind: 'file'; md: string; title: string; fileName: string };

export function App({ store }: { store: WorkspaceStore }) {
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingReplace | null>(null);

  useEffect(() => {
    fetchConfig().then(setConfig);
  }, []);
  // One soap-bubble pop sound per store pop event (the rupture animation is drawn by the UI on the popped element).
  useEffect(() => store.onEvent((e) => e.type === 'pop' && !store.state.prefs.muted && playPop()), [store]);
  // Decode the recorded pop on the first gesture (audio contexts need one).
  useEffect(() => {
    window.addEventListener('pointerdown', preloadPop, { once: true });
    return () => window.removeEventListener('pointerdown', preloadPop);
  }, []);
  useEffect(() => {
    document.title = state.hasDocument ? `${state.doc.title || 'Untitled'} — Bubbles.MD` : 'Bubbles.MD';
  }, [state.hasDocument, state.doc.title]);

  const hasWork = () => store.state.tracked.md.trim() !== '' || store.state.tracked.order.length > 0;

  const openFile = async (file: File) => {
    const res = await readMarkdownFile(file);
    if ('error' in res) {
      if (store.state.hasDocument) store.showNotice(res.error, 'error');
      else setImportError(res.error);
      return;
    }
    setImportError(null);
    if (store.state.hasDocument && hasWork()) setPending({ kind: 'file', ...res });
    else store.newDocument(res.md, { title: res.title, fileName: res.fileName });
  };

  const goHome = () => {
    if (store.state.hasDocument && hasWork()) setPending({ kind: 'home' });
    else store.closeDocument();
  };

  const createNew = () => {
    if (store.state.hasDocument && hasWork()) setPending({ kind: 'new' });
    else store.newDocument('', { title: 'Untitled', fileName: null });
  };

  const exportMarkdown = () => {
    const blob = new Blob([store.state.tracked.md], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(store.state.doc.title || 'document').replace(/[\\/:*?"<>|]+/g, '-')}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  if (!state.loaded) return <div className="loading">Loading…</div>;

  return (
    <>
      {state.hasDocument ? (
        <Workspace store={store} config={config} onHome={goHome} onNew={createNew} onOpenFile={openFile} onExport={exportMarkdown} />
      ) : (
        <Landing onCreate={createNew} onFile={openFile} error={importError} />
      )}
      {pending && (
        <div className="modal-backdrop">
          <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="replace-title">
            <h2 id="replace-title">{pending.kind === 'home' ? 'Leave the current document?' : 'Replace the current document?'}</h2>
            <p>
              {pending.kind === 'home' ? 'Going back to the start closes' : pending.kind === 'new' ? 'Starting a new document replaces' : `Opening ${pending.fileName} replaces`}{' '}
              “{state.doc.title || 'Untitled'}” and its reviews in this browser. Export it first if you want to keep it.
            </p>
            <div className="modal-actions">
              <button type="button" className="pill" onClick={exportMarkdown}>
                Export current
              </button>
              <button
                type="button"
                className="pill danger"
                onClick={() => {
                  if (pending.kind === 'home') store.closeDocument();
                  else if (pending.kind === 'new') store.newDocument('', { title: 'Untitled', fileName: null });
                  else store.newDocument(pending.md, { title: pending.title, fileName: pending.fileName });
                  setPending(null);
                }}
              >
                {pending.kind === 'home' ? 'Leave' : 'Replace'}
              </button>
              <button type="button" className="pill" autoFocus onClick={() => setPending(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Workspace({
  store,
  config,
  onHome,
  onNew,
  onOpenFile,
  onExport,
}: {
  store: WorkspaceStore;
  config: AppConfig | null;
  onHome(): void;
  onNew(): void;
  onOpenFile(file: File): void;
  onExport(): void;
}) {
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const md = state.tracked.md;
  const view = state.prefs.view;
  const narrow = useMediaQuery('(max-width: 899px)');
  const scrollerRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const editorRef = useRef<EditorHandle | FormattedHandle | null>(null);
  const [handle, setHandle] = useState<EditorHandle | null>(null);
  const [tick, setTick] = useState(0);
  const [hovered, setHovered] = useState<string | null>(null);
  /** The hovered/focused pop target, as review + change identity (change ids are only unique within a review). */
  const [linked, setLinked] = useState<{ review: string; change: string; kind: string } | null>(null);
  /** The minimized review whose passage is being peeked at. */
  const [peek, setPeek] = useState<string | null>(null);
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const frame = useRef(0);

  // Scrolling only re-measures the selection action; the review space follows the scroll itself (ReviewLayer).
  const [scrollTick, setScrollTick] = useState(0);
  const scrollFrame = useRef(0);
  const bumpScroll = useCallback(() => {
    if (scrollFrame.current) return;
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = 0;
      setScrollTick((t) => t + 1);
    });
  }, []);

  const bump = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      setTick((t) => t + 1);
    });
  }, []);

  const setEditor = useCallback((h: EditorHandle | FormattedHandle | null) => {
    editorRef.current = h;
    setHandle(h);
  }, []);

  // Formatted mode is read-only only for genuinely unsupported content; normalization is just disclosed.
  const unsupported = useMemo(() => (view === 'formatted' ? scanUnsupported(md) : []), [md, view]);
  useEffect(() => {
    setBridgeError(null);
  }, [view, state.doc]);

  const expanded = state.expanded ? state.tracked.reviews[state.expanded] : null;
  const activeVersion = expanded?.activeVersion ? state.versions[expanded.activeVersion] : null;
  const generating = expanded ? state.requests[expanded.id]?.status === 'generating' : false;

  const spec: DecorationSpec = useMemo(() => {
    const anchors = openReviews(state.tracked).map((r) => ({ id: r.id, from: r.from, to: r.to }));
    if (!expanded || expanded.status !== 'open') return { ...EMPTY_SPEC, anchors };
    const base = { reviewId: expanded.id, target: { from: expanded.from, to: expanded.to }, anchors };
    if (!activeVersion || activeVersion.outcome !== 'replace' || generating || !isCurrent(state.tracked, expanded, activeVersion))
      return { ...base, changes: [] };
    const changes = activeVersion.diff.groups
      .filter((g) => !expanded.popped.includes(g.id))
      .map((g) => ({
        id: g.id,
        kind: g.kind,
        from: expanded.from + g.srcFrom,
        to: expanded.from + g.srcTo,
        // Whitespace-only originals get a visible symbol (presentation only; the text itself is untouched).
        ws: g.original && !g.original.trim() ? (g.original.includes('\n') ? ('break' as const) : ('space' as const)) : undefined,
      }));
    return { ...base, changes };
  }, [expanded, activeVersion, generating, state.tracked]);

  // ---- contextual selection action ----
  // Shown once a selection settles (pointer released, or ~250 ms after the last keyboard change), above the first
  // selected line. Pointer movement never moves it; scroll, resize, reflow and edits re-measure the selection.
  const [selAction, setSelAction] = useState<{ x: number; y: number; below: boolean; key: string } | null>(null);
  const actionRef = useRef<HTMLButtonElement>(null);
  const dragging = useRef(false);
  const settledKey = useRef<string | null>(null);
  const dismissedKey = useRef<string | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [settle, setSettle] = useState(0);
  const selectionKey = () => {
    const sel = editorRef.current?.getSelection();
    return sel && !('error' in sel) ? `${sel.from}:${sel.to}` : null;
  };
  const settleSelection = useCallback(() => {
    settledKey.current = selectionKey();
    setSettle((n) => n + 1);
  }, []);
  const onSelectionChange = useCallback(() => {
    bump();
    // The suppression after creating a bubble covers only that unchanged selection.
    if (dismissedKey.current && selectionKey() !== dismissedKey.current) dismissedKey.current = null;
    if (settleTimer.current) clearTimeout(settleTimer.current);
    if (!dragging.current) settleTimer.current = setTimeout(settleSelection, 250);
  }, [bump, settleSelection]);
  useEffect(() => {
    const up = () => {
      if (!dragging.current) return;
      dragging.current = false;
      requestAnimationFrame(settleSelection);
    };
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, [settleSelection]);

  const createBubble = useCallback(() => {
    const sel = editorRef.current?.getSelection();
    if (!sel) store.showNotice('Select some text first, then create a bubble.');
    else if ('error' in sel) store.showNotice(sel.error, 'error');
    else {
      dismissedKey.current = `${sel.from}:${sel.to}`;
      setSelAction(null);
      store.createReview(sel.from, sel.to);
    }
  }, [store]);

  const callbacks: EditorCallbacks = {
    onEdit: (next: string, hunks: Hunk[]) => store.edit(next, hunks),
    onSelectionChange,
    onLayoutChange: bump,
    onUndo: () => store.undo(),
    onRedo: () => store.redo(),
    onCreateBubble: createBubble,
    // Clicking a source marking pops that change in the proposal (added → removed, altered/deleted → original kept).
    onSourceChange: (id: string, _kind: ChangeKind) => {
      const current = store.state.expanded;
      if (!current || store.isGenerating(current)) return;
      rupture(canvasRef.current?.querySelector(`.document [data-review="${CSS.escape(current)}"][data-change="${CSS.escape(id)}"]`));
      setHovered(null);
      store.popChange(current, id);
    },
  };

  // Global keys: Escape minimizes; undo/redo/new bubble when focus is not in a text field or an editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key === 'Escape') {
        if (store.state.expanded) {
          (document.activeElement as HTMLElement | null)?.blur?.();
          store.expand(null);
          e.preventDefault();
        }
        return;
      }
      const t = e.target as HTMLElement;
      if (t.closest('textarea, input, select, [contenteditable="true"]')) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && !e.altKey && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
      } else if (mod && key === 'y') {
        e.preventDefault();
        store.redo();
      } else if (mod && e.altKey && key === 'm') {
        e.preventDefault();
        createBubble();
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', bump);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', bump);
    };
  }, [store, createBubble, bump]);

  useEffect(() => {
    const ro = new ResizeObserver(bump);
    if (canvasRef.current) ro.observe(canvasRef.current);
    // Editor reflow (wrapping, fonts, images) changes passage and selection geometry without a transaction.
    const doc = canvasRef.current?.querySelector('.document');
    if (doc) ro.observe(doc);
    return () => ro.disconnect();
  }, [bump]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const scroller = scrollerRef.current;
    const h = editorRef.current;
    const key = selectionKey();
    const focused = !!h?.hasFocus() || (!!actionRef.current && document.activeElement === actionRef.current);
    let next: typeof selAction = null;
    if (canvas && scroller && h && key && focused && !dragging.current && key === settledKey.current && key !== dismissedKey.current) {
      const c = canvas.getBoundingClientRect();
      const s = scroller.getBoundingClientRect();
      const d = canvas.querySelector('.document .editor-host')?.getBoundingClientRect();
      const lines = h.selectionRects().map((r) => ({ x: r.left - c.left, y: r.top - c.top, w: r.width, h: r.height }));
      const size = { w: actionRef.current?.offsetWidth || SEL_ACTION.w, h: actionRef.current?.offsetHeight || SEL_ACTION.h };
      const bounds = {
        left: (d?.left ?? c.left) - c.left,
        right: (d?.right ?? c.right) - c.left,
        top: Math.max(0, s.top - c.top),
        bottom: s.top - c.top + scroller.clientHeight,
      };
      const place = placeSelectionAction(lines, bounds, size);
      if (place) next = { ...place, x: Math.round(place.x), y: Math.round(place.y), key };
    }
    setSelAction((prev) =>
      prev === next || (prev && next && prev.x === next.x && prev.y === next.y && prev.key === next.key && prev.below === next.below) ? prev : next,
    );
    // tick: resize, reflow, editor transactions and selection changes; scrollTick: scrolling; settle: a selection
    // came to rest.
  }, [tick, scrollTick, settle, md, view, narrow]);

  // A new document, a source edit or a view switch never inherits a suppressed selection from before.
  useEffect(() => {
    dismissedKey.current = null;
  }, [state.doc.id, md, view]);

  // Hover/focus pairing: the matching source and suggestion targets of one review highlight together through a
  // scoped style rule (no connector line, no overlay, and no mutation of editor-owned DOM).
  useEffect(() => {
    const clear = () => {
      setLinked(null);
      setHovered(null);
    };
    const link = (target: EventTarget | null) => {
      const el = (target as HTMLElement | null)?.closest?.<HTMLElement>('[data-review][data-change]');
      if (!el) return;
      const review = el.dataset.review!;
      setLinked({ review, change: el.dataset.change!, kind: el.dataset.kind ?? 'altered' });
      setHovered(review === store.state.expanded ? el.dataset.change! : null);
    };
    const over = (e: Event) => link(e.target);
    const out = (e: Event) => (e.target as HTMLElement).closest?.('[data-change]') && clear();
    document.addEventListener('pointerover', over);
    document.addEventListener('pointerout', out);
    document.addEventListener('focusin', over);
    document.addEventListener('focusout', out);
    return () => {
      // Any review change (pop, accept, new version) clears obsolete hover state.
      clear();
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointerout', out);
      document.removeEventListener('focusin', over);
      document.removeEventListener('focusout', out);
    };
  }, [state.expanded, state.tracked, store]);

  const dynamicCss = useMemo(() => {
    const rules: string[] = [];
    if (peek && state.tracked.reviews[peek]?.status === 'open') rules.push(`.document .rt-${CSS.escape(peek)} { ${PEEK_STYLE} }`);
    if (linked) {
      const sel = `[data-review="${CSS.escape(linked.review)}"][data-change="${CSS.escape(linked.change)}"]`;
      const colour = linked.kind === 'added' ? 'var(--green)' : linked.kind === 'deleted' ? 'var(--red)' : 'var(--yellow)';
      // The element's own rounded outline, strengthened (the + and − circles and the ↵ badge are drawn in ::after).
      rules.push(
        `${sel}:not(.src-insert):not(.cand-delete):not(.src-break), ${sel}.src-insert::after, ${sel}.cand-delete::after, ${sel}.src-break::after { --ring: ${colour}; ${RING_STYLE} }`,
      );
    }
    return rules.join('\n');
  }, [peek, linked, state.tracked]);

  useEffect(() => {
    if (!state.notice) return;
    const id = state.notice.id;
    const timer = setTimeout(() => store.state.notice?.id === id && store.dismissNotice(), state.notice.undo ? 8000 : 6000);
    return () => clearTimeout(timer);
  }, [state.notice, store]);

  const readOnly = unsupported.length > 0;
  const saveLabel =
    state.saveStatus === 'saving' ? 'Saving…' : state.saveStatus === 'saved' ? 'Saved' : state.saveStatus === 'error' ? 'Not saved' : '';

  return (
    <div className={`app${narrow ? ' narrow' : ''}`}>
      <header className="top">
        <button type="button" className="brand" aria-label="Bubbles.MD — back to the start page" title="Back to the start page" onClick={onHome}>
          Bubbles.MD
        </button>
        <input
          className="title-input"
          aria-label="Document title"
          value={state.doc.title}
          placeholder="Untitled"
          onChange={(e) => store.setTitle(e.target.value)}
        />
        <span className={`save-status ${state.saveStatus}`} title={state.saveError ?? undefined} aria-live="polite">
          {saveLabel}
        </span>
        <div className="top-actions">
          <button type="button" className="link-button" onClick={onNew}>
            New
          </button>
          <button type="button" className="link-button" onClick={() => fileInput.current?.click()}>
            Open
          </button>
          <button type="button" className="link-button" onClick={onExport}>
            Export .md
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".md,.markdown,.txt,text/markdown,text/plain"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onOpenFile(file);
              e.target.value = '';
            }}
          />
        </div>
      </header>
      <Toolbar
        store={store}
        state={state}
        config={config}
        canFormat={view === 'formatted' && !readOnly}
        onFormat={(cmd: FormatCommand) => (editorRef.current as FormattedHandle | null)?.format?.(cmd)}
        onSwitchView={(v) => store.setPrefs({ view: v })}
      />
      {state.saveError && <div className="banner error">{state.saveError}</div>}
      {config && !config.keyConfigured && (
        <div className="banner">The server has no OpenRouter key configured, so suggestions will fail until it is set (see README).</div>
      )}
      {readOnly && (
        <div className="banner">
          This document contains {unsupported.join(', ')}, which Formatted view cannot edit without changing it. Formatted view is
          read-only;{' '}
          <button type="button" className="link-button" onClick={() => store.setPrefs({ view: 'markdown' })}>
            edit in Markdown
          </button>
          .
        </div>
      )}
      {bridgeError && view === 'formatted' && (
        <div className="banner error">
          Formatted view could not map this document to Markdown ({bridgeError}). Reviews are paused here; please use Markdown view. This is a
          known-issue report, not expected behaviour.
        </div>
      )}
      <main
        className="workspace"
        ref={scrollerRef}
        onScroll={bumpScroll}
        onPointerDown={(e) => {
          if (!store.state.expanded) return;
          const t = e.target as HTMLElement;
          if (t.closest('.family, .marker, .sel-action, [data-change], .dock, .modal')) return;
          store.expand(null);
        }}
      >
        <div className="canvas" ref={canvasRef}>
          {dynamicCss && <style>{dynamicCss}</style>}
          <div
            className="document"
            onPointerDown={() => {
              // A new pointer selection gesture: it may intentionally select a range used before.
              dragging.current = true;
              settledKey.current = null;
              dismissedKey.current = null;
              setSelAction(null);
            }}
          >
            {view === 'formatted' ? (
              <FormattedEditor
                key={`f-${state.doc.id}`}
                ref={setEditor}
                md={md}
                spec={spec}
                readOnly={readOnly}
                callbacks={callbacks}
                onBridgeError={(m) => setBridgeError((prev) => (prev === m ? prev : m))}
              />
            ) : (
              <MarkdownEditor key={`m-${state.doc.id}`} ref={setEditor} md={md} spec={spec} callbacks={callbacks} />
            )}
          </div>
          {/* After the editor in the DOM, so Tab reaches it; mousedown is prevented so the selection is kept. */}
          {selAction && (
            <button
              ref={actionRef}
              type="button"
              className={`bubble sel-action${selAction.below ? ' below' : ''}`}
              style={{ left: selAction.x, top: selAction.y }}
              title="New bubble for this selection (Ctrl/Cmd+Alt+M)"
              onMouseDown={(e) => e.preventDefault()}
              onFocus={bump}
              onBlur={bump}
              onClick={createBubble}
            >
              <PlusIcon />
              <span>Bubble</span>
            </button>
          )}
          <ReviewLayer
            store={store}
            state={state}
            handle={handle}
            scrollerRef={scrollerRef}
            tick={tick}
            narrow={narrow}
            raw={view === 'markdown'}
            dockRef={dockRef}
            hovered={hovered}
            onPeek={setPeek}
            onRetarget={(id) => {
              const sel = editorRef.current?.getSelection();
              if (sel && 'error' in sel) store.showNotice(sel.error, 'error');
              else store.retarget(id, sel?.from ?? 0, sel?.to ?? 0);
            }}
            onHoverChange={(id) => setHovered(id)}
          />
          <svg className="overlay" aria-hidden="true">
            <g className="dots" />
          </svg>
        </div>
      </main>
      <div className="dock" ref={dockRef} />
      <footer className="footer">
        {state.notice ? (
          <span className={`notice ${state.notice.tone ?? 'info'}`} role="status">
            {state.notice.text}
            {state.notice.undo && (
              <button type="button" className="link-button" onClick={() => (store.undo(), store.dismissNotice())}>
                Undo
              </button>
            )}
            <button type="button" className="tiny" aria-label="Dismiss" onClick={() => store.dismissNotice()}>
              <CloseIcon />
            </button>
          </span>
        ) : (
          <span className="quiet">Select text, then “+ Bubble” (Ctrl/Cmd+Alt+M). Nothing changes until you Accept.</span>
        )}
        <span className="right quiet">
          {state.activeRequest ? 'Generating one suggestion…' : `${state.tracked.order.filter((id) => state.tracked.reviews[id].status === 'open').length} open reviews`}
        </span>
      </footer>
    </div>
  );
}
