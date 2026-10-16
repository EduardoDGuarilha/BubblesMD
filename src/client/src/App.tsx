import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { isCurrent } from './core/workspace';
import type { ChangeKind } from './core/changes';
import type { Hunk } from './core/textChanges';
import type { WorkspaceStore } from './state/store';
import { fetchConfig, type AppConfig } from './services/api';
import { FormattedEditor, type FormatCommand, type FormattedHandle } from './editor/FormattedEditor';
import { MarkdownEditor } from './editor/MarkdownEditor';
import { checkFormattedSupport, scanUnsupported } from './editor/markdownModel';
import { EMPTY_SPEC, type DecorationSpec, type EditorCallbacks, type EditorHandle } from './editor/types';
import { Landing } from './ui/Landing';
import { ReviewLayer } from './ui/ReviewLayer';
import { Toolbar } from './ui/Toolbar';
import { playPop, preloadPop } from './ui/sound';
import { rupture } from './ui/fx';

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

type PendingReplace = { kind: 'new' } | { kind: 'file'; md: string; title: string; fileName: string };

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
        <Workspace store={store} config={config} onNew={createNew} onOpenFile={openFile} onExport={exportMarkdown} />
      ) : (
        <Landing onCreate={createNew} onFile={openFile} error={importError} />
      )}
      {pending && (
        <div className="modal-backdrop">
          <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="replace-title">
            <h2 id="replace-title">Replace the current document?</h2>
            <p>
              {pending.kind === 'new' ? 'Starting a new document' : `Opening ${pending.fileName}`} replaces “{state.doc.title || 'Untitled'}” and its
              reviews in this browser. Export it first if you want to keep it.
            </p>
            <div className="modal-actions">
              <button type="button" className="pill" onClick={exportMarkdown}>
                Export current
              </button>
              <button
                type="button"
                className="pill danger"
                onClick={() => {
                  if (pending.kind === 'new') store.newDocument('', { title: 'Untitled', fileName: null });
                  else store.newDocument(pending.md, { title: pending.title, fileName: pending.fileName });
                  setPending(null);
                }}
              >
                Replace
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
  onNew,
  onOpenFile,
  onExport,
}: {
  store: WorkspaceStore;
  config: AppConfig | null;
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
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const frame = useRef(0);

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
  const [normalizes, setNormalizes] = useState(false);
  useEffect(() => {
    if (view === 'formatted') setNormalizes(checkFormattedSupport(store.state.tracked.md).normalizes);
    setBridgeError(null);
    // Checked when entering Formatted view; edits there produce normalized Markdown anyway.
  }, [view, store, state.doc]);

  const expanded = state.expanded ? state.tracked.reviews[state.expanded] : null;
  const activeVersion = expanded?.activeVersion ? state.versions[expanded.activeVersion] : null;
  const generating = expanded ? state.requests[expanded.id]?.status === 'generating' : false;

  const spec: DecorationSpec = useMemo(() => {
    if (!expanded || expanded.status !== 'open') return EMPTY_SPEC;
    const target = { from: expanded.from, to: expanded.to };
    if (!activeVersion || activeVersion.outcome !== 'replace' || generating || !isCurrent(state.tracked, expanded, activeVersion))
      return { target, changes: [] };
    const changes = activeVersion.diff.groups
      .filter((g) => !expanded.popped.includes(g.id))
      .map((g) => ({ id: g.id, kind: g.kind, from: expanded.from + g.srcFrom, to: expanded.from + g.srcTo }));
    return { target, changes };
  }, [expanded, activeVersion, generating, state.tracked]);

  const createBubble = useCallback(() => {
    const sel = editorRef.current?.getSelection();
    if (!sel) store.showNotice('Select some text first, then create a bubble.');
    else if ('error' in sel) store.showNotice(sel.error, 'error');
    else store.createReview(sel.from, sel.to);
  }, [store]);

  const callbacks: EditorCallbacks = {
    onEdit: (next: string, hunks: Hunk[]) => store.edit(next, hunks),
    onSelectionChange: bump,
    onLayoutChange: bump,
    onUndo: () => store.undo(),
    onRedo: () => store.redo(),
    onCreateBubble: createBubble,
    // Clicking a source marking pops that change in the proposal (added → removed, altered/deleted → original kept).
    onSourceChange: (id: string, _kind: ChangeKind) => {
      const current = store.state.expanded;
      if (!current || store.isGenerating(current)) return;
      rupture(canvasRef.current?.querySelector(`.document [data-change="${id}"]`));
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
    return () => ro.disconnect();
  }, [bump]);

  // Hover/focus pairing: the matching source and suggestion spans highlight together (no connector line). The
  // source side is drawn as an overlay: mutating editor-owned DOM would make ProseMirror/CodeMirror re-render it.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const boxes = canvas.querySelector('.overlay .boxes');
    const clear = () => {
      document.querySelectorAll('.family .linked').forEach((el) => el.classList.remove('linked'));
      boxes?.replaceChildren();
      setHovered(null);
    };
    const link = (target: EventTarget | null) => {
      const el = (target as HTMLElement | null)?.closest?.<HTMLElement>('[data-change]');
      if (!el || !boxes) return;
      const id = el.dataset.change!;
      const kind = el.dataset.kind ?? 'altered';
      clear();
      setHovered(id);
      document.querySelectorAll(`.family [data-change="${id}"]`).forEach((x) => x.classList.add('linked'));
      const c = canvas.getBoundingClientRect();
      for (const x of canvas.querySelectorAll<HTMLElement>(`.document [data-change="${id}"]`)) {
        for (const r of x.getClientRects()) {
          const box = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          box.setAttribute('x', String(r.left - c.left - 2));
          box.setAttribute('y', String(r.top - c.top - 1));
          box.setAttribute('width', String(r.width + 4));
          box.setAttribute('height', String(r.height + 2));
          box.setAttribute('rx', String(Math.min(10, r.height / 2 + 1)));
          box.setAttribute('class', `link-box ${kind}`);
          boxes.append(box);
        }
      }
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
  }, [state.expanded, state.tracked]);

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
        <span className="brand">Bubbles.MD</span>
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
      {!readOnly && view === 'formatted' && normalizes && (
        <div className="banner subtle">Editing in Formatted view writes standard Markdown syntax for this document (for example `**bold**`).</div>
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
        onScroll={bump}
        onPointerDown={(e) => {
          if (!store.state.expanded) return;
          const t = e.target as HTMLElement;
          if (t.closest('.family, .marker, .plus-bubble, [data-change], .dock, .modal')) return;
          store.expand(null);
        }}
      >
        <div className="canvas" ref={canvasRef}>
          <div className="document">
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
            onCreateBubble={createBubble}
            onRetarget={(id) => {
              const sel = editorRef.current?.getSelection();
              if (sel && 'error' in sel) store.showNotice(sel.error, 'error');
              else store.retarget(id, sel?.from ?? 0, sel?.to ?? 0);
            }}
            onHoverChange={(id) => setHovered(id)}
          />
          <svg className="overlay" aria-hidden="true">
            <g className="dots" />
            <g className="boxes" />
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
              ×
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
