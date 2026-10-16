import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { openReviews } from '../core/workspace';
import type { StoreState, WorkspaceStore } from '../state/store';
import type { EditorHandle } from '../editor/types';
import { ReviewFamily } from './ReviewFamily';

interface Props {
  store: WorkspaceStore;
  state: StoreState;
  handle: EditorHandle | null;
  scrollerRef: RefObject<HTMLElement | null>;
  tick: number;
  narrow: boolean;
  raw: boolean;
  dockRef: RefObject<HTMLDivElement | null>;
  hovered: string | null;
  onCreateBubble(): void;
  onRetarget(reviewId: string): void;
  onLocateChange(changeId: string | null): void;
}

interface Layout {
  markers: { id: string; top: number; label: string }[];
  family: { anchorTop: number; offscreen: boolean } | null;
  plus: number | null;
  visTop: number;
  visBottom: number;
}

const MARKER_GAP = 40;

/**
 * Right-side review space. Positions are measured from the editor's real geometry: minimized markers sit beside
 * their targets (collisions pushed down), the expanded family aligns with its source and stays within the visible
 * area; when the source scrolls away the connector hides and "Back to passage" appears.
 */
export function ReviewLayer({ store, state, handle, scrollerRef, tick, narrow, raw, dockRef, hovered, onCreateBubble, onRetarget, onLocateChange }: Props) {
  const railRef = useRef<HTMLDivElement>(null);
  const familyRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<Layout>({ markers: [], family: null, plus: null, visTop: 0, visBottom: 0 });
  const reviews = openReviews(state.tracked);
  const expanded = state.expanded ? state.tracked.reviews[state.expanded] : null;

  useLayoutEffect(() => {
    const rail = railRef.current;
    const scroller = scrollerRef.current;
    if (!rail || !scroller || !handle) return;
    const railTop = rail.getBoundingClientRect().top;
    const sRect = scroller.getBoundingClientRect();
    const visTop = sRect.top - railTop;
    const visBottom = visTop + scroller.clientHeight;
    const markers: Layout['markers'] = [];
    let family: Layout['family'] = null;
    for (const r of reviews) {
      const rect = handle.rectFor(r.from, r.to);
      if (!rect) continue;
      const top = rect.top - railTop;
      if (r.id === state.expanded) {
        family = { anchorTop: top, offscreen: rect.bottom - railTop < visTop || top > visBottom };
      } else {
        const n = r.thoughts.length;
        markers.push({ id: r.id, top, label: `Open review · ${n} ${n === 1 ? 'thought' : 'thoughts'}` });
      }
    }
    markers.sort((a, b) => a.top - b.top);
    for (let i = 1; i < markers.length; i++) markers[i].top = Math.max(markers[i].top, markers[i - 1].top + MARKER_GAP);
    let plus: number | null = null;
    const sel = handle.getSelection();
    if (sel && !('error' in sel)) {
      const rect = handle.rectFor(sel.from, sel.to);
      if (rect) plus = rect.top - railTop;
    }
    setLayout((prev) => {
      const next = { markers, family, plus, visTop, visBottom };
      return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
    });
    // tick covers scroll/resize/editor geometry; state covers anchors and review changes.
  }, [tick, state.tracked, state.expanded, handle, scrollerRef, narrow]);

  // Clamp the measured family inside the visible review space without moving the prose.
  useLayoutEffect(() => {
    const el = familyRef.current;
    if (!el || !layout.family || narrow) return;
    const h = el.offsetHeight;
    const { visTop, visBottom } = layout;
    let top = layout.family.anchorTop - 26;
    if (h + 24 < visBottom - visTop) top = Math.min(Math.max(top, visTop + 12), visBottom - h - 12);
    else top = visTop + 12;
    el.style.top = `${Math.max(0, top)}px`;
  });

  const family = expanded && (
    <ReviewFamily
      key={expanded.id}
      store={store}
      state={state}
      review={expanded}
      raw={raw}
      hovered={hovered}
      offscreen={!!layout.family?.offscreen || narrow}
      onBackToPassage={() => handle?.scrollTo(expanded.from)}
      onRetarget={() => onRetarget(expanded.id)}
      onLocateChange={onLocateChange}
    />
  );

  return (
    <aside className="rail" ref={railRef} aria-label="Reviews">
      {layout.markers.map((m) => (
        <button
          key={m.id}
          type="button"
          className="marker"
          style={{ top: m.top }}
          aria-label={m.label}
          title={m.label}
          onClick={() => store.expand(m.id)}
        >
          •••
        </button>
      ))}
      {layout.plus !== null && !expanded && (
        <button
          type="button"
          className="plus-bubble"
          style={{ top: layout.plus }}
          title="New bubble for this selection (Ctrl/Cmd+Alt+M)"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onCreateBubble}
        >
          + Bubble
        </button>
      )}
      {family && !narrow && (
        <div ref={familyRef} className={`family${layout.family?.offscreen ? ' offscreen' : ''}`} data-review={expanded.id}>
          {family}
        </div>
      )}
      {family && narrow && dockRef.current && <DockPortal target={dockRef.current}>{family}</DockPortal>}
    </aside>
  );
}

function DockPortal({ target, children }: { target: HTMLElement; children: ReactNode }) {
  return createPortal(<div className="family docked">{children}</div>, target);
}
