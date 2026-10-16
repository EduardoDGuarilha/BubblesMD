import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { openReviews } from '../core/workspace';
import type { StoreState, WorkspaceStore } from '../state/store';
import type { EditorHandle } from '../editor/types';
import { ReviewFamily } from './ReviewFamily';
import { PlusIcon } from './PlusIcon';
import { placeMarkers, routeDots } from '../core/geometry';

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
  onHoverChange(changeId: string | null): void;
}

interface Marker {
  id: string;
  top: number;
  x: number;
  label: string;
}

interface Layout {
  markers: Marker[];
  /** Rail coordinates of the expanded review's passage; lineMid is the middle of its first line. */
  family: { anchorTop: number; lineMid: number; offscreen: boolean } | null;
  plus: number | null;
  docRight: number;
  visTop: number;
  visBottom: number;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function dot(group: Element, x: number, y: number, r: number) {
  const c = document.createElementNS(SVG_NS, 'circle');
  c.setAttribute('cx', x.toFixed(1));
  c.setAttribute('cy', y.toFixed(1));
  c.setAttribute('r', r.toFixed(1));
  c.setAttribute('class', 'thought-dot');
  group.append(c);
}

/**
 * Right-side review space. Everything is measured from the editor's real geometry: minimized reviews sit beside
 * their passages (clustered when close), the expanded family floats beside its passage within the visible area,
 * and thought dots are drawn between the actual passage and bubble positions after every layout pass.
 */
export function ReviewLayer({ store, state, handle, scrollerRef, tick, narrow, raw, dockRef, hovered, onCreateBubble, onRetarget, onHoverChange }: Props) {
  const railRef = useRef<HTMLDivElement>(null);
  const familyRef = useRef<HTMLDivElement>(null);
  const [settled, setSettled] = useState(0);
  const [layout, setLayout] = useState<Layout>({ markers: [], family: null, plus: null, docRight: 0, visTop: 0, visBottom: 0 });
  const reviews = openReviews(state.tracked);
  const expanded = state.expanded ? state.tracked.reviews[state.expanded] : null;

  useLayoutEffect(() => {
    const rail = railRef.current;
    const scroller = scrollerRef.current;
    if (!rail || !scroller || !handle) return;
    const railRect = rail.getBoundingClientRect();
    const railTop = railRect.top;
    const sRect = scroller.getBoundingClientRect();
    const visTop = sRect.top - railTop;
    const visBottom = visTop + scroller.clientHeight;
    const doc = rail.parentElement?.querySelector('.document')?.getBoundingClientRect();
    const docRight = doc ? doc.right - railRect.left : -20;
    const raw: { id: string; top: number; label: string }[] = [];
    let family: Layout['family'] = null;
    for (const r of reviews) {
      const rect = handle.rectFor(r.from, r.to);
      if (!rect) continue;
      const top = rect.top - railTop;
      if (r.id === state.expanded) {
        const start = handle.rectFor(r.from, r.from);
        const lineMid = start ? (start.top + Math.min(start.bottom, start.top + 30)) / 2 - railTop : top + 12;
        family = { anchorTop: top, lineMid, offscreen: rect.bottom - railTop < visTop || top > visBottom };
      } else {
        const n = r.thoughts.length;
        raw.push({ id: r.id, top, label: `Open review · ${n} ${n === 1 ? 'thought' : 'thoughts'}` });
      }
    }
    // Nearby minimized reviews take the nearest free slot (no overlap, including hover scale and float).
    const markers: Marker[] = (narrow
      ? placeMarkers(raw).map((m) => ({ ...m, x: 0 }))
      : placeMarkers(raw)
    ).map((m) => ({ ...m, label: raw.find((r) => r.id === m.id)!.label }));
    let plus: number | null = null;
    const sel = handle.hasFocus() ? handle.getSelection() : null;
    if (sel && !('error' in sel)) {
      const end = handle.rectFor(sel.to, sel.to);
      if (end) plus = (end.top + end.bottom) / 2 - railTop - 14;
    }
    setLayout((prev) => {
      const next = { markers, family, plus, docRight, visTop, visBottom };
      return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
    });
    // tick covers scroll/resize/editor geometry; state covers anchors and review changes.
  }, [tick, state.tracked, state.expanded, handle, scrollerRef, narrow]);

  // Place the measured family beside its passage within the visible space, then draw the thought dots.
  useLayoutEffect(() => {
    const rail = railRef.current;
    const svg = rail?.parentElement?.querySelector('.overlay .dots');
    svg?.replaceChildren();
    const el = familyRef.current;
    if (!rail || !el || !layout.family || narrow) return;
    const { visTop, visBottom } = layout;
    // Bound the family to the visible review space; taller content scrolls inside it so every reflection stays reachable.
    el.style.maxHeight = `${Math.max(160, visBottom - visTop - 24)}px`;
    const h = el.offsetHeight;
    let top = layout.family.anchorTop - 30;
    if (h + 24 < visBottom - visTop) top = Math.min(Math.max(top, visTop + 12), visBottom - h - 12);
    else top = visTop + 12;
    el.style.top = `${Math.max(0, top)}px`;
    if (!svg || layout.family.offscreen) return;

    const railRect = rail.getBoundingClientRect();
    const canvasRect = rail.parentElement!.getBoundingClientRect();
    const box = (r: DOMRect) => ({ x: r.left - canvasRect.left, y: r.top - canvasRect.top, w: r.width, h: r.height });
    const main = el.querySelector<HTMLElement>('.family-inner > .review') ?? el.querySelector<HTMLElement>('.chain-item');
    if (!main) return;
    const famRect = el.getBoundingClientRect();
    // Passage → family: from the prose edge at the passage's first line to the bubble, routed around minimized
    // reviews and the family's other bubbles (each with its motion envelope). No clear route → no dots.
    const obstacles = [
      ...[...rail.querySelectorAll<HTMLElement>('.marker')].map((m) => box(m.getBoundingClientRect())),
      ...[...el.querySelectorAll<HTMLElement>('.chain-item')]
        .filter((b) => b !== main)
        .map((b) => b.getBoundingClientRect())
        .filter((r) => r.bottom > famRect.top && r.top < famRect.bottom)
        .map(box),
    ];
    const source = { x: layout.docRight + railRect.left - canvasRect.left + 6, y: layout.family.lineMid + railRect.top - canvasRect.top };
    for (const d of routeDots(source, box(main.getBoundingClientRect()), obstacles) ?? []) dot(svg, d.x, d.y, d.r);
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
      onHoverChange={onHoverChange}
      onGeometryChange={() => setSettled((n) => n + 1)}
    />
  );

  return (
    <aside className="rail" ref={railRef} aria-label="Reviews">
      {layout.markers.map((m) => (
        <button
          key={m.id}
          type="button"
          className="bubble marker"
          style={{ top: m.top, left: 4 + m.x }}
          aria-label={m.label}
          title={m.label}
          onClick={() => store.expand(m.id)}
        >
          <span aria-hidden="true">•••</span>
        </button>
      ))}
      {layout.plus !== null && !expanded && (
        <button
          type="button"
          className="bubble plus-bubble"
          style={{ top: layout.plus }}
          title="New bubble for this selection (Ctrl/Cmd+Alt+M)"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onCreateBubble}
        >
          <span className="plus-disc">
            <PlusIcon />
          </span>
          <span className="plus-label">Bubble</span>
        </button>
      )}
      {family && !narrow && (
        <div
          ref={familyRef}
          className={`family${layout.family?.offscreen ? ' offscreen' : ''}`}
          data-review={expanded.id}
          data-settled={settled}
          onAnimationEnd={(e) => e.animationName === 'inflate' && setSettled((n) => n + 1)}
        >
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
