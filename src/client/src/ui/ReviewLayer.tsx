import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { openReviews } from '../core/workspace';
import type { StoreState, WorkspaceStore } from '../state/store';
import type { EditorHandle } from '../editor/types';
import { ReviewFamily } from './ReviewFamily';
import {
  clampFamilyTop,
  clusterWidth,
  COARSE_MARKER,
  connectDots,
  envelope,
  markerRect,
  markerZone,
  MARKER,
  MOTION,
  FAMILY,
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
  family: { anchorTop: number; anchorBottom: number; lineMid: number } | null;
  docRight: number;
  railWidth: number;
  height: number;
  size: MarkerSize;
  /** The rail's top in the scroller's content coordinates (independent of the scroll position). */
  railOffset: number;
}

/**
 * What the scroll path needs to place the family and its connection without measuring the DOM again: refreshed by
 * every full placement (after each render, i.e. after edits, wrapping, resizes, family content and cluster changes).
 */
interface FamilyGeom {
  reviewId: string;
  /** Natural top (the spacer height), height, left and width of the family, in rail coordinates. */
  natural: number;
  height: number;
  left: number;
  width: number;
  trackHeight: number;
  /** The drawn top (clampFamilyTop, matching CSS sticky) and off-screen state of the current connection. */
  drawn: string;
  /** Rail → canvas offset; the main bubble and in-family obstacles relative to the family box; fixed obstacles. */
  dx: number;
  dy: number;
  main: Rect;
  inner: Rect[];
  outer: Rect[];
  mini: Rect | null;
  cluster: Rect | null;
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
  /** Holds the family's natural top in the track (a margin would also stop sticky from shifting it up). */
  const spacerRef = useRef<HTMLDivElement>(null);
  const [settled, setSettled] = useState(0);
  /** Whether the expanded review's passage is out of view (shows "Back to passage" and drops the connection). */
  const [offscreen, setOffscreen] = useState(false);
  const geom = useRef<FamilyGeom | null>(null);
  /**
   * Passage tops measured while every review was minimized. Opening a review adds its markings (an insertion + takes
   * inline space and can re-wrap a line), which must not re-slot the miniatures; so while the text, the writing
   * width and the view are unchanged, the minimized measurements stay authoritative.
   */
  const restingTops = useRef<{ key: string; tops: Map<string, number> } | null>(null);
  const [layout, setLayout] = useState<Layout>({
    markers: [],
    family: null,
    docRight: 0,
    railWidth: 0,
    height: 0,
    size: MARKER,
    railOffset: 0,
  });
  const reviews = openReviews(state.tracked);
  const expanded = state.expanded ? state.tracked.reviews[state.expanded] : null;

  useLayoutEffect(() => {
    const rail = railRef.current;
    const scroller = scrollerRef.current;
    if (!rail || !scroller || !handle) return;
    const railRect = rail.getBoundingClientRect();
    const railTop = railRect.top;
    const sRect = scroller.getBoundingClientRect();
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
        family = { anchorTop: top, anchorBottom: rect.bottom - railTop, lineMid };
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
    const railOffset = railTop - sRect.top + scroller.scrollTop;
    setLayout((prev) => {
      const next = { markers, family, docRight, railWidth, height, size, railOffset };
      return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
    });
    // tick covers resize, reflow and editor geometry (scrolling moves nothing in rail coordinates); state covers
    // anchors and review changes.
  }, [tick, state.tracked, state.expanded, state.revision, handle, scrollerRef, narrow, raw]);

  /**
   * The one owner of the family's placement and its passage connection.
   * - 'full' (after every render): measure the family, settle its natural top, left and width beside the clusters,
   *   and cache what the scroll path needs.
   * - 'scroll' (from the scroll event, before paint): no layout reads; CSS sticky keeps the family in view, so only
   *   the connection and the off-screen state follow, computed with clampFamilyTop (validated against the rendered
   *   sticky position). A span that would change the horizontal placement falls back to 'full'.
   */
  const place = (mode: 'full' | 'scroll') => {
    const rail = railRef.current;
    const svg = rail?.parentElement?.querySelector('.overlay .dots');
    const el = familyRef.current;
    const scroller = scrollerRef.current;
    if (!rail || !svg || !el || !layout.family || narrow || !scroller || !expanded) {
      svg?.replaceChildren();
      svg?.setAttribute('data-from', 'none');
      geom.current = null;
      return;
    }
    const fam = layout.family;
    const visTop = scroller.scrollTop - layout.railOffset;
    const visBottom = visTop + scroller.clientHeight;
    const at = (m: Marker) => ({ x: INSET + m.x, top: m.top });
    const zones = layout.markers.map((m) => markerZone(at(m), layout.size));
    const active = layout.markers.find((m) => m.active);
    const activeCluster = active ? layout.markers.filter((m) => m.cluster === active.cluster).map((m) => markerZone(at(m), layout.size)) : [];
    const baseNatural = Math.max(0, fam.anchorTop - 30);

    let g = geom.current;
    if (mode === 'scroll' && g && g.reviewId === expanded.id) {
      const shown = clampFamilyTop(g.natural, g.height, visTop, visBottom, g.trackHeight);
      const p = placeFamily(zones, activeCluster, { top: shown, bottom: shown + g.height }, layout.railWidth);
      if (p.left === g.left && p.width === g.width && (p.below ?? baseNatural) === g.natural) {
        draw(g, shown, fam.anchorBottom < visTop || fam.anchorTop > visBottom);
        return;
      }
    }

    // Full placement. Bound the family to the visible space; taller content scrolls inside it.
    const trackHeight = rail.clientHeight;
    el.style.maxHeight = `${Math.max(160, scroller.clientHeight - 2 * FAMILY.inset)}px`;
    // Width depends on which markers lie beside the family, and its height on the width: settle in a few passes.
    // Only the natural top (the spacer above the family) is written; CSS sticky keeps the family in the visible area.
    let natural = baseNatural;
    let left = 0;
    let width = 0;
    // Fractional heights: offsetHeight would round, and the clamp (and so the connection) would be off by up to 0.5 px.
    for (let pass = 0, prev = ''; pass < 3; pass++) {
      const h = el.getBoundingClientRect().height;
      natural = baseNatural;
      const shown = clampFamilyTop(natural, h, visTop, visBottom, trackHeight);
      const p = placeFamily(zones, activeCluster, { top: shown, bottom: shown + h }, layout.railWidth);
      if (p.below !== null) natural = p.below;
      ({ left, width } = p);
      const key = `${left}|${width}|${natural}`;
      el.style.marginLeft = `${left}px`;
      el.style.width = `${width}px`;
      if (spacerRef.current) spacerRef.current.style.height = `${natural}px`;
      if (key === prev) break;
      prev = key;
    }
    el.dataset.placed = '1';
    const height = el.getBoundingClientRect().height;

    const railRect = rail.getBoundingClientRect();
    const canvasRect = rail.parentElement!.getBoundingClientRect();
    const famRect = el.getBoundingClientRect();
    const rel = (r: DOMRect): Rect => ({ x: r.left - famRect.left, y: r.top - famRect.top, w: r.width, h: r.height });
    const box = (r: DOMRect): Rect => ({ x: r.left - canvasRect.left, y: r.top - canvasRect.top, w: r.width, h: r.height });
    const dx = railRect.left - canvasRect.left;
    const dy = railRect.top - canvasRect.top;
    const shift = (r: Rect): Rect => ({ ...r, x: r.x + dx, y: r.y + dy });
    const mainEl = el.querySelector<HTMLElement>('.family-inner > .review') ?? el.querySelector<HTMLElement>('.chain-item');
    if (!mainEl) {
      svg.replaceChildren();
      svg.setAttribute('data-from', 'none');
      geom.current = null;
      return;
    }
    const clusterZones = activeCluster.map(shift);
    const mini = active ? shift(markerRect(at(active), layout.size)) : null;
    g = geom.current = {
      reviewId: expanded.id,
      natural,
      height,
      left,
      width,
      trackHeight,
      drawn: '',
      dx,
      dy,
      main: rel(mainEl.getBoundingClientRect()),
      // The family's other bubbles, controls and messages (visible inside it), with their motion envelope.
      inner: [...el.querySelectorAll<HTMLElement>('.chain-item, .pair-message, .hint, .blocked-note')]
        .filter((b) => b !== mainEl)
        .map((b) => b.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.bottom > famRect.top && r.top < famRect.bottom)
        .map((r) => envelope(rel(r))),
      // Every miniature but the active one, and the selection action.
      outer: [
        ...layout.markers.filter((m) => !m.active).map((m) => shift(markerZone(at(m), layout.size))),
        ...[...rail.parentElement!.querySelectorAll<HTMLElement>('.sel-action')].map((b) => envelope(box(b.getBoundingClientRect()))),
      ],
      mini,
      cluster: clusterZones.length
        ? (() => {
            const x = Math.min(...clusterZones.map((z) => z.x));
            const y = Math.min(...clusterZones.map((z) => z.y));
            return { x, y, w: Math.max(...clusterZones.map((z) => z.x + z.w)) - x, h: Math.max(...clusterZones.map((z) => z.y + z.h)) - y };
          })()
        : null,
    };
    draw(g, clampFamilyTop(natural, height, visTop, visBottom, trackHeight), fam.anchorBottom < visTop || fam.anchorTop > visBottom);
  };

  /** Off-screen state and the passage → family thought dots for the family drawn at `shown` (rail coordinates). */
  const draw = (g: FamilyGeom, shown: number, isOffscreen: boolean) => {
    setOffscreen((prev) => (prev === isOffscreen ? prev : isOffscreen));
    const key = `${shown}|${isOffscreen}`;
    if (key === g.drawn) return;
    g.drawn = key;
    const group = svg();
    group.replaceChildren();
    group.setAttribute('data-from', 'none');
    if (isOffscreen || !layout.family) return;
    const fx = g.dx + g.left;
    const fy = g.dy + shown;
    const move = (r: Rect): Rect => ({ ...r, x: r.x + fx, y: r.y + fy });
    const passage = { x: layout.docRight + g.dx + 6, y: layout.family.lineMid + g.dy };
    const obstacles = [...g.outer, ...g.inner.map(move)];
    const link = connectDots(passage, g.mini, g.mini && envelope(g.mini, MOTION.markerHover), move(g.main), obstacles, g.cluster);
    for (const d of link?.dots ?? []) dot(group, d.x, d.y, d.r);
    group.setAttribute('data-from', link?.from ?? 'none');
  };
  const svg = () => railRef.current!.parentElement!.querySelector('.overlay .dots')!;

  const placeRef = useRef(place);
  placeRef.current = place;
  useLayoutEffect(() => placeRef.current('full'));
  // Scrolling: the scroll event runs before the frame is painted, so the connection is drawn for the same frame.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const onScroll = () => placeRef.current('scroll');
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, [scrollerRef]);

  const family = expanded && (
    <ReviewFamily
      key={expanded.id}
      store={store}
      state={state}
      review={expanded}
      raw={raw}
      hovered={hovered}
      offscreen={offscreen || narrow}
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
        <div className="family-track" key={expanded.id}>
          <div ref={spacerRef} aria-hidden="true" />
          <div
            ref={familyRef}
            className={`family${offscreen ? ' offscreen' : ''}`}
            style={{ top: FAMILY.inset, bottom: FAMILY.inset }}
            onScroll={() => placeRef.current('full')}
            data-review={expanded.id}
            data-settled={settled}
            onAnimationEnd={(e) => e.animationName === 'inflate' && setSettled((n) => n + 1)}
          >
            {family}
          </div>
        </div>
      )}
      {family && narrow && dockRef.current && <DockPortal target={dockRef.current}>{family}</DockPortal>}
    </aside>
  );
}

function DockPortal({ target, children }: { target: HTMLElement; children: ReactNode }) {
  return createPortal(<div className="family docked">{children}</div>, target);
}
