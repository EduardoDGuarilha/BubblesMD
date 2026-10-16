import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { openReviews } from '../core/workspace';
import type { StoreState, WorkspaceStore } from '../state/store';
import type { EditorHandle } from '../editor/types';
import { ReviewFamily } from './ReviewFamily';
import {
  clusterWidth,
  COARSE_MARKER,
  connectDots,
  envelope,
  markerRect,
  markerZone,
  MARKER,
  MOTION,
  placeFamily,
  placeMarkers,
  type MarkerSize,
  type Rect,
} from '../core/geometry';

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
  onRetarget(reviewId: string): void;
  onHoverChange(changeId: string | null): void;
  /** Hover/focus on a minimized review: highlight its passage only (null clears). */
  onPeek(reviewId: string | null): void;
}

interface Marker {
  id: string;
  top: number;
  x: number;
  cluster: number;
  label: string;
  active: boolean;
}

interface Layout {
  markers: Marker[];
  /** Rail coordinates of the expanded review's passage; lineMid is the middle of its first line. */
  family: { anchorTop: number; lineMid: number; offscreen: boolean } | null;
  docRight: number;
  visTop: number;
  visBottom: number;
  railWidth: number;
  height: number;
  size: MarkerSize;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Markers sit this far inside the rail's left edge. */
const INSET = 4;

function dot(group: Element, x: number, y: number, r: number) {
  const c = document.createElementNS(SVG_NS, 'circle');
  c.setAttribute('cx', x.toFixed(1));
  c.setAttribute('cy', y.toFixed(1));
  c.setAttribute('r', r.toFixed(1));
  c.setAttribute('class', 'thought-dot');
  group.append(c);
}

const excerpt = (text: string) => {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > 40 ? `${t.slice(0, 39)}…` : t;
};

/**
 * Right-side review space, measured from the editor's real geometry. Every open review keeps a same-size miniature
 * in a stable cluster beside its passage (opening one changes nothing about the arrangement); the expanded family
 * is placed afterwards, beside the clusters, and connected by thought dots after every layout pass.
 */
export function ReviewLayer({ store, state, handle, scrollerRef, tick, narrow, raw, dockRef, hovered, onRetarget, onHoverChange, onPeek }: Props) {
  const railRef = useRef<HTMLDivElement>(null);
  const familyRef = useRef<HTMLDivElement>(null);
  const [settled, setSettled] = useState(0);
  /**
   * Passage tops measured while every review was minimized. Opening a review adds its markings (an insertion + takes
   * inline space and can re-wrap a line), which must not re-slot the miniatures; so while the text, the writing
   * width and the view are unchanged, the minimized measurements stay authoritative.
   */
  const restingTops = useRef<{ key: string; tops: Map<string, number> } | null>(null);
  const [layout, setLayout] = useState<Layout>({ markers: [], family: null, docRight: 0, visTop: 0, visBottom: 0, railWidth: 0, height: 0, size: MARKER });
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
    const railWidth = rail.clientWidth;
    const restKey = `${state.revision}|${Math.round(doc?.width ?? 0)}|${raw}|${narrow}`;
    const resting = state.expanded && restingTops.current?.key === restKey ? restingTops.current.tops : null;
    const measured = new Map<string, number>();
    const anchors: { id: string; top: number; seq: number }[] = [];
    const labels = new Map<string, string>();
    let family: Layout['family'] = null;
    for (const r of reviews) {
      const rect = handle.rectFor(r.from, r.to);
      if (!rect) continue;
      const top = rect.top - railTop;
      measured.set(r.id, top);
      anchors.push({ id: r.id, top: resting?.get(r.id) ?? top, seq: state.tracked.order.indexOf(r.id) });
      const n = r.thoughts.length;
      labels.set(r.id, `Review of “${excerpt(state.tracked.md.slice(r.from, r.to))}” · ${n} ${n === 1 ? 'thought' : 'thoughts'}`);
      if (r.id === state.expanded) {
        const start = handle.rectFor(r.from, r.from);
        const lineMid = start ? (start.top + Math.min(start.bottom, start.top + 30)) / 2 - railTop : top + 12;
        family = { anchorTop: top, lineMid, offscreen: rect.bottom - railTop < visTop || top > visBottom };
      }
    }
    if (!state.expanded) restingTops.current = { key: restKey, tops: measured };
    // Every open review (the expanded one included) keeps its miniature, so opening one never re-slots the rest.
    const size = window.matchMedia('(pointer: coarse)').matches ? COARSE_MARKER : MARKER;
    const width = (narrow ? railWidth : clusterWidth(railWidth, size)) - INSET;
    const markers: Marker[] = placeMarkers(anchors, width, size).map((m) => ({
      ...m,
      label: labels.get(m.id)!,
      active: m.id === state.expanded,
    }));
    const height = Math.max(0, ...markers.map((m) => m.top + size.h + 12));
    setLayout((prev) => {
      const next = { markers, family, docRight, visTop, visBottom, railWidth, height, size };
      return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
    });
    // tick covers scroll/resize/editor geometry; state covers anchors and review changes.
  }, [tick, state.tracked, state.expanded, state.revision, handle, scrollerRef, narrow, raw]);

  // Place the measured family beside the clusters within the visible space, then draw the passage connection.
  useLayoutEffect(() => {
    const rail = railRef.current;
    const svg = rail?.parentElement?.querySelector('.overlay .dots');
    svg?.replaceChildren();
    svg?.setAttribute('data-from', 'none');
    const el = familyRef.current;
    if (!rail || !el || !layout.family || narrow) return;
    const { visTop, visBottom } = layout;
    const at = (m: Marker) => ({ x: INSET + m.x, top: m.top });
    const zones = layout.markers.map((m) => markerZone(at(m), layout.size));
    const active = layout.markers.find((m) => m.active);
    const activeCluster = active ? layout.markers.filter((m) => m.cluster === active.cluster).map((m) => markerZone(at(m), layout.size)) : [];
    // Bound the family to the visible review space; taller content scrolls inside it so every reflection stays reachable.
    el.style.maxHeight = `${Math.max(160, visBottom - visTop - 24)}px`;
    // Width depends on which markers lie beside the family, and its height on the width: settle in a few passes.
    for (let pass = 0, prev = ''; pass < 3; pass++) {
      const h = el.offsetHeight;
      let top = layout.family.anchorTop - 30;
      if (h + 24 < visBottom - visTop) top = Math.min(Math.max(top, visTop + 12), visBottom - h - 12);
      else top = visTop + 12;
      top = Math.max(0, top);
      const place = placeFamily(zones, activeCluster, { top, bottom: top + h }, layout.railWidth);
      if (place.below !== null) top = place.below;
      const key = `${place.left}|${place.width}|${top}`;
      el.style.left = `${place.left}px`;
      el.style.width = `${place.width}px`;
      el.style.top = `${top}px`;
      if (key === prev) break;
      prev = key;
    }
    if (!svg || layout.family.offscreen) return;

    const railRect = rail.getBoundingClientRect();
    const canvasRect = rail.parentElement!.getBoundingClientRect();
    const box = (r: DOMRect): Rect => ({ x: r.left - canvasRect.left, y: r.top - canvasRect.top, w: r.width, h: r.height });
    const main = el.querySelector<HTMLElement>('.family-inner > .review') ?? el.querySelector<HTMLElement>('.chain-item');
    if (!main) return;
    const famRect = el.getBoundingClientRect();
    const dx = railRect.left - canvasRect.left;
    const dy = railRect.top - canvasRect.top;
    const shift = (r: Rect): Rect => ({ ...r, x: r.x + dx, y: r.y + dy });
    // Obstacles: every miniature but the active one, the family's other bubbles and its controls and messages.
    const obstacles = [
      ...layout.markers.filter((m) => !m.active).map((m) => shift(markerZone(at(m), layout.size))),
      ...[...el.querySelectorAll<HTMLElement>('.chain-item, .pair-message, .hint, .blocked-note')]
        .filter((b) => b !== main)
        .map((b) => b.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.bottom > famRect.top && r.top < famRect.bottom)
        .map((r) => envelope(box(r))),
      ...[...rail.parentElement!.querySelectorAll<HTMLElement>('.sel-action')].map((b) => envelope(box(b.getBoundingClientRect()))),
    ];
    const passage = { x: layout.docRight + dx + 6, y: layout.family.lineMid + dy };
    const mini = active ? shift(markerRect(at(active), layout.size)) : null;
    const clusterZones = activeCluster.map(shift);
    const clusterBox = clusterZones.length
      ? (() => {
          const x = Math.min(...clusterZones.map((z) => z.x));
          const y = Math.min(...clusterZones.map((z) => z.y));
          return { x, y, w: Math.max(...clusterZones.map((z) => z.x + z.w)) - x, h: Math.max(...clusterZones.map((z) => z.y + z.h)) - y };
        })()
      : null;
    const link = connectDots(passage, mini, mini && envelope(mini, MOTION.markerHover), box(main.getBoundingClientRect()), obstacles, clusterBox);
    for (const d of link?.dots ?? []) dot(svg, d.x, d.y, d.r);
    svg.setAttribute('data-from', link?.from ?? 'none');
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
    <aside className="rail" ref={railRef} aria-label="Reviews" style={{ minHeight: layout.height }}>
      {layout.markers.map((m) => (
        <button
          key={m.id}
          type="button"
          className={`bubble marker${m.active ? ' active' : ''}`}
          style={{ top: m.top, left: INSET + m.x }}
          aria-label={m.label}
          aria-pressed={m.active}
          title={m.active ? `${m.label} — minimize` : `${m.label} — open`}
          data-review={m.id}
          onClick={() => store.expand(m.active ? null : m.id)}
          onPointerEnter={() => onPeek(m.id)}
          onPointerLeave={() => onPeek(null)}
          onFocus={() => onPeek(m.id)}
          onBlur={() => onPeek(null)}
        >
          <span aria-hidden="true">•••</span>
        </button>
      ))}
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
