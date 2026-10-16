/**
 * Pure layout geometry for the review space: the wrapping chain of thoughts, the passage connection, clusters of
 * minimized reviews, the expanded family's placement and the selection action.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Dot extends Point {
  r: number;
}

/**
 * The animation envelope every resting rect must be given room for: the ±1.5 px float, the 2 % inflate overshoot,
 * a 12 % hover scale on minimized markers, plus a margin and clearance around connector dots.
 */
export const MOTION = { float: 1.5, inflate: 0.02, markerHover: 0.12, margin: 2, dotClear: 2 };

export function envelope(r: Rect, scale = MOTION.inflate): Rect {
  const dx = (r.w * scale) / 2 + MOTION.margin;
  const dy = (r.h * scale) / 2 + MOTION.float + MOTION.margin;
  return { x: r.x - dx, y: r.y - dy, w: r.w + 2 * dx, h: r.h + 2 * dy };
}

export const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

function dotHits(d: Dot, r: Rect): boolean {
  const cx = clamp(d.x, r.x, r.x + r.w);
  const cy = clamp(d.y, r.y, r.y + r.h);
  return (d.x - cx) ** 2 + (d.y - cy) ** 2 < (d.r + MOTION.dotClear) ** 2;
}

// Gaps leave room for a connector and both neighbours' motion envelopes.
export const CHAIN = { gapX: 22, gapY: 26, indents: [16, 34], stagger: 4 };

export interface ChainLayout {
  rects: Rect[];
  rowOf: number[];
  /** Bottom edge of each row (including stagger). */
  rowBottoms: number[];
  /** Top edge of each row. */
  rowTops: number[];
  height: number;
}

/**
 * Place reflections (and the trailing input/plus) as one chain that flows left to right and wraps into rows.
 * Rows alternate their indent and items get a slight stagger so the chain reads as drifting thoughts.
 */
export function layoutChain(sizes: { w: number; h: number }[], width: number): ChainLayout {
  const rects: Rect[] = [];
  const rowOf: number[] = [];
  const rowBottoms: number[] = [];
  const rowTops: number[] = [];
  let row = 0;
  let x = CHAIN.indents[0];
  let y = 0;
  let bottom = 0;
  let top = Infinity;
  sizes.forEach((s, i) => {
    const indent = CHAIN.indents[row % CHAIN.indents.length];
    const w = Math.min(s.w, Math.max(1, width - indent));
    if (rects.length && rowOf[rowOf.length - 1] === row && x + w > width) {
      rowBottoms.push(bottom);
      rowTops.push(top);
      row++;
      y = bottom + CHAIN.gapY;
      x = CHAIN.indents[row % CHAIN.indents.length];
      top = Infinity;
    }
    const itemY = y + (i % 2) * CHAIN.stagger;
    rects.push({ x, y: itemY, w, h: s.h });
    rowOf.push(row);
    bottom = Math.max(bottom, itemY + s.h);
    top = Math.min(top, itemY);
    x += w + CHAIN.gapX;
  });
  if (rects.length) {
    rowBottoms.push(bottom);
    rowTops.push(top);
  }
  return { rects, rowOf, rowBottoms, rowTops, height: rects.length ? bottom : 0 };
}

function along(points: Point[], count: number, radii: number[]): Dot[] {
  const segs = points.slice(1).map((p, i) => ({ a: points[i], b: p, len: Math.hypot(p.x - points[i].x, p.y - points[i].y) }));
  const total = segs.reduce((n, s) => n + s.len, 0);
  if (total < 8) return [];
  const dots: Dot[] = [];
  for (let k = 1; k <= count; k++) {
    let d = (total * k) / (count + 1);
    for (const s of segs) {
      if (d <= s.len) {
        const t = s.len ? d / s.len : 0;
        dots.push({ x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t, r: radii[k - 1] ?? radii[radii.length - 1] });
        break;
      }
      d -= s.len;
    }
  }
  return dots;
}

/**
 * Connector dots for the chain, from the actual edges: suggestion → first item through the vertical gap, items on
 * one row through the horizontal gap, and across a wrap via the lane between rows (never through a bubble).
 */
export function chainDots(main: Rect | null, layout: ChainLayout): Dot[] {
  const { rects, rowOf, rowBottoms, rowTops } = layout;
  const dots: Dot[] = [];
  if (main && rects.length) {
    const first = rects[0];
    const x = clamp(first.x + 22, main.x + 26, main.x + main.w - 26);
    dots.push(...along([{ x, y: main.y + main.h }, { x, y: first.y }], 2, [1.6, 2.3]));
  }
  for (let i = 1; i < rects.length; i++) {
    const a = rects[i - 1];
    const b = rects[i];
    if (rowOf[i] === rowOf[i - 1]) {
      const lo = Math.max(a.y, b.y);
      const hi = Math.min(a.y + a.h, b.y + b.h);
      const y = hi > lo ? (lo + hi) / 2 : (a.y + a.h / 2 + b.y + b.h / 2) / 2;
      dots.push(...along([{ x: a.x + a.w, y }, { x: b.x, y }], 2, [1.5, 2.1]));
    } else {
      const lane = (rowBottoms[rowOf[i - 1]] + rowTops[rowOf[i]]) / 2;
      const ax = clamp(a.x + a.w / 2, a.x + 16, a.x + a.w - 16);
      const bx = b.x + Math.min(22, b.w / 2);
      dots.push(...along([{ x: ax, y: a.y + a.h }, { x: ax, y: lane }, { x: bx, y: lane }, { x: bx, y: b.y }], 4, [1.4, 1.8, 2.2, 2.6]));
    }
  }
  return dots;
}

const ROUTE_T = [0.3, 0.56, 0.8];
const ROUTE_R = [2, 3, 4.4];

/** Thought dots along a route: three growing dots on a straight run, four on a run with one bend. */
function routeDots(points: Point[]): Dot[] {
  if (points.length === 2) {
    const [a, b] = points;
    return ROUTE_T.map((t, i) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, r: ROUTE_R[i] }));
  }
  return along(points, 4, [1.8, 2.4, 3.2, 4.2]);
}

/** True when the route and its dots stay clear of every blocked rect and of the target's interior. */
function clearRoute(points: Point[], dots: Dot[], blocked: Rect[], inner: Rect): boolean {
  const hit = (p: Dot) => dotHits(p, inner) || blocked.some((o) => dotHits(p, o));
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const from = i === 1 ? 4 : 0;
    const to = i === points.length - 1 ? len - 4 : len;
    for (let d = from; d < to; d += 4) if (hit({ x: a.x + ((b.x - a.x) * d) / len, y: a.y + ((b.y - a.y) * d) / len, r: 0.5 })) return false;
  }
  return !dots.some(hit);
}

/** Attach points on the suggestion's left edge, nearest to `y` first. */
function leftEdge(target: Rect, y: number, maxDy = Infinity): Point[] {
  const ys: number[] = [];
  for (let v = target.y + 14; v <= target.y + target.h - 14; v += 4) if (Math.abs(v - y) <= maxDy) ys.push(v);
  ys.sort((p, q) => Math.abs(p - y) - Math.abs(q - y));
  return ys.map((v) => ({ x: target.x - 4, y: v }));
}

export const CONNECT = { passageDy: 40, passageLength: 300 };

export interface Connection {
  from: 'passage' | 'miniature';
  dots: Dot[];
}

/**
 * The passage → suggestion connection. Normally a short straight run of thought dots from the passage to the
 * suggestion's left edge near the passage line. When that run is blocked (by any miniature, bubble or control) or
 * too long, the dots start from the active review's own miniature instead: straight when possible, otherwise with
 * one bend, out over or under its cluster (`cluster`, the cluster's zone bounds) to the suggestion. With no clear
 * route, no dots are drawn. `obstacles` and `miniatureZone` are inflated by their motion envelopes already;
 * `miniature` is the resting rect.
 */
export function connectDots(
  passage: Point | null,
  miniature: Rect | null,
  miniatureZone: Rect | null,
  target: Rect,
  obstacles: Rect[],
  cluster: Rect | null = null,
): Connection | null {
  const inner = { x: target.x + 2, y: target.y + 2, w: target.w - 4, h: target.h - 4 };
  const attempt = (points: Point[], blocked: Rect[]) => {
    const dots = routeDots(points);
    return clearRoute(points, dots, blocked, inner) ? dots : null;
  };
  if (passage) {
    const blocked = miniatureZone ? [...obstacles, miniatureZone] : obstacles;
    for (const end of leftEdge(target, passage.y, CONNECT.passageDy)) {
      const len = Math.hypot(end.x - passage.x, end.y - passage.y);
      if (len < 14) return { from: 'passage', dots: [] };
      const dots = len <= CONNECT.passageLength ? attempt([passage, end], blocked) : null;
      if (dots) return { from: 'passage', dots };
    }
  }
  if (miniature) {
    const m = miniature;
    const starts = [
      { x: m.x + m.w + 2, y: m.y + m.h / 2 },
      { x: m.x + m.w * 0.82, y: m.y - 1 },
      { x: m.x + m.w * 0.82, y: m.y + m.h + 1 },
    ];
    const runs = starts
      .flatMap((a) => leftEdge(target, a.y).map((b) => ({ points: [a, b], len: Math.hypot(b.x - a.x, b.y - a.y) })))
      .sort((p, q) => p.len - q.len);
    if (runs[0] && runs[0].len < 14) return { from: 'miniature', dots: [] };
    for (const run of runs) {
      const dots = attempt(run.points, obstacles);
      if (dots) return { from: 'miniature', dots };
    }
    // Enclosed by its neighbours: rise (or drop) clear of the cluster, then run to the suggestion.
    const box = cluster ?? m;
    const bent: { points: Point[]; len: number }[] = [];
    for (const lift of [10, 16, 22]) {
      for (const [x, y, lane] of [
        [m.x + m.w / 2, m.y - 1, box.y - lift],
        [m.x + m.w / 2, m.y + m.h + 1, box.y + box.h + lift],
      ]) {
        for (const end of leftEdge(target, lane).slice(0, 12)) {
          const points = [{ x, y }, { x, y: lane }, end];
          bent.push({ points, len: Math.abs(lane - y) + Math.hypot(end.x - x, end.y - lane) });
        }
      }
    }
    bent.sort((p, q) => p.len - q.len);
    for (const run of bent) {
      const dots = attempt(run.points, obstacles);
      if (dots) return { from: 'miniature', dots };
    }
  }
  return null;
}

// ---- minimized reviews ------------------------------------------------------------------------------------------

export interface MarkerSize {
  w: number;
  h: number;
}

/** Resting size of a minimized review; with a coarse pointer, styles.css enlarges markers to 44 × 44 targets. */
export const MARKER: MarkerSize = { w: 34, h: 24 };
export const COARSE_MARKER: MarkerSize = { w: 44, h: 44 };

/**
 * Honeycomb lattice for markers of one size: neighbours in a row are one motion envelope apart, alternate rows
 * shift by half a cell, so adjacent rows interlock (a staggered silhouette, never a grid). Anchors closer than
 * `join` group into one cluster. `pad` is the room the envelope adds on each side of a resting marker.
 */
export function lattice(size: MarkerSize = MARKER) {
  const zone = envelope({ x: 0, y: 0, w: size.w, h: size.h }, MOTION.markerHover);
  return { size, pad: { x: -zone.x, y: -zone.y }, pitchX: Math.ceil(zone.w) + 1, pitchY: Math.ceil(zone.h) + 1, join: size.h * 2 };
}

export const CLUSTER = lattice();

export interface MarkerAnchor {
  id: string;
  /** Top of the passage in rail coordinates. */
  top: number;
  /** Creation order; breaks ties so the result never depends on which review is open. */
  seq: number;
}

export interface PlacedMarker {
  id: string;
  x: number;
  top: number;
  cluster: number;
}

/** How many markers fit in a row starting at `offset` within `width` (envelope included). */
function rowCapacity(l: ReturnType<typeof lattice>, offset: number, width: number): number {
  const room = width - l.size.w - l.pad.x - offset;
  return room < 0 ? 0 : Math.floor(room / l.pitchX) + 1;
}

/**
 * Minimized reviews as equal-size markers in local clusters beside their passages.
 *
 * - Anchors are grouped in order of position: one within `join` of the previous joins its cluster.
 * - A cluster is packed on the honeycomb lattice in anchor order (higher passages sit higher). Its column count
 *   follows the cluster size (about √n), narrows when the anchors spread over more lines, and is limited by `width`.
 * - The cluster is centred on its anchors' span. A cluster that would touch the previous one moves down by the
 *   smallest amount; nothing goes above `minTop` or past `width`. When `width` holds a single marker, clusters
 *   become one column. Markers never overlap, including their motion envelopes.
 */
export function placeMarkers(anchors: MarkerAnchor[], width: number, size: MarkerSize = MARKER): PlacedMarker[] {
  const l = lattice(size);
  const sorted = [...anchors].sort((a, b) => a.top - b.top || a.seq - b.seq);
  const clusters: MarkerAnchor[][] = [];
  for (const a of sorted) {
    const current = clusters[clusters.length - 1];
    if (current && a.top - current[current.length - 1].top <= l.join) current.push(a);
    else clusters.push([a]);
  }
  const evenCap = Math.max(1, rowCapacity(l, 0, width));
  const oddOffset = rowCapacity(l, l.pitchX / 2, width) > 0 ? l.pitchX / 2 : 0;
  const oddCap = oddOffset ? rowCapacity(l, oddOffset, width) : evenCap;
  const placed: PlacedMarker[] = [];
  let floor = l.pad.y;
  clusters.forEach((members, index) => {
    const n = members.length;
    const span = members[n - 1].top - members[0].top;
    const rowsBySpan = Math.floor(span / l.pitchY) + 1;
    const cols = Math.max(1, Math.min(Math.round(Math.sqrt(n)), Math.ceil(n / rowsBySpan), evenCap));
    const slots: { x: number; row: number }[] = [];
    for (let row = 0; slots.length < n; row++) {
      const odd = row % 2 === 1;
      const offset = odd ? oddOffset : 0;
      const cap = Math.max(1, Math.min(cols, odd ? oddCap : evenCap));
      for (let k = 0; k < cap && slots.length < n; k++) slots.push({ x: offset + k * l.pitchX, row });
    }
    const rows = slots[slots.length - 1].row + 1;
    const height = (rows - 1) * l.pitchY;
    const top = Math.max(members[0].top + span / 2 - height / 2, floor);
    members.forEach((m, i) => placed.push({ id: m.id, x: slots[i].x, top: top + slots[i].row * l.pitchY, cluster: index }));
    floor = top + height + l.pitchY;
  });
  return placed;
}

/** Resting rect and motion zone (envelope) of a placed marker. */
export const markerRect = (m: { x: number; top: number }, size: MarkerSize = MARKER): Rect => ({ x: m.x, y: m.top, w: size.w, h: size.h });
export const markerZone = (m: { x: number; top: number }, size: MarkerSize = MARKER): Rect => envelope(markerRect(m, size), MOTION.markerHover);

export const FAMILY = { min: 236, max: 548, gap: 14, right: 10, edge: 8, inset: 12 };

/**
 * Where the expanded family is drawn, in track (rail) coordinates, for its natural top: CSS `position: sticky` with
 * `FAMILY.inset` at the top and bottom of the visible area, inside a track of `trackHeight`. Mirrors the browser:
 * the bottom constraint shifts the box up (not above the track start), then the top constraint shifts it down (not
 * past the track end), so the top inset wins when the family does not fit.
 */
export function clampFamilyTop(natural: number, height: number, visTop: number, visBottom: number, trackHeight = Infinity): number {
  let top = natural;
  const bottomLimit = visBottom - FAMILY.inset - height;
  if (top > bottomLimit) top = Math.max(bottomLimit, Math.min(natural, 0));
  const topLimit = visTop + FAMILY.inset;
  if (top < topLimit) top = Math.max(top, Math.min(topLimit, trackHeight - height));
  return top;
}

/** The widest marker footprint the rail can give clusters while still fitting a family of minimum width beside them. */
export const clusterWidth = (railWidth: number, size: MarkerSize = MARKER) =>
  Math.max(size.w + lattice(size).pad.x, railWidth - FAMILY.min - FAMILY.gap - FAMILY.right);

/**
 * Horizontal placement of the expanded family, separate from (and after) marker placement. The family sits just
 * right of the active review's cluster and of any marker zone beside its vertical span, shrinking its width to fit.
 * If the rail cannot fit the minimum width there, it opens below the active cluster at the rail's left instead.
 */
export function placeFamily(
  zones: Rect[],
  activeCluster: Rect[],
  span: { top: number; bottom: number },
  railWidth: number,
): { left: number; width: number; below: number | null } {
  const beside = zones.filter((z) => z.y < span.bottom && z.y + z.h > span.top);
  const left = Math.max(FAMILY.edge, ...[...beside, ...activeCluster].map((z) => z.x + z.w + FAMILY.gap));
  const width = Math.min(FAMILY.max, railWidth - left - FAMILY.right);
  if (width >= FAMILY.min) return { left, width, below: null };
  const bottom = Math.max(0, ...activeCluster.map((z) => z.y + z.h));
  return { left: FAMILY.edge, width: Math.max(0, Math.min(FAMILY.max, railWidth - FAMILY.edge - FAMILY.right)), below: bottom + FAMILY.gap };
}

// ---- selection action -------------------------------------------------------------------------------------------

/**
 * Where the selection's "+ Bubble" action goes: just above the first selected line, centred on it, or below the
 * last line when there is no room above. It stays inside `bounds` (the visible writing column) and never covers a
 * selected line; with no such place, null.
 */
export function placeSelectionAction(lines: Rect[], bounds: { left: number; right: number; top: number; bottom: number }, size: { w: number; h: number }, gap = 6): { x: number; y: number; below: boolean } | null {
  if (!lines.length) return null;
  const sorted = [...lines].sort((a, b) => a.y - b.y || a.x - b.x);
  const first = sorted.filter((r) => r.y < sorted[0].y + sorted[0].h / 2);
  const lastTop = sorted[sorted.length - 1].y;
  const last = sorted.filter((r) => r.y + r.h > lastTop + sorted[sorted.length - 1].h / 2);
  const centre = (row: Rect[]) => (Math.min(...row.map((r) => r.x)) + Math.max(...row.map((r) => r.x + r.w))) / 2;
  const x = (row: Rect[]) => clamp(centre(row) - size.w / 2, bounds.left, bounds.right - size.w);
  const covers = (box: Rect) => lines.some((r) => overlaps(box, r));
  const above = Math.min(...first.map((r) => r.y)) - gap - size.h;
  if (above >= bounds.top + 2) {
    const box = { x: x(first), y: above, w: size.w, h: size.h };
    if (!covers(box)) return { x: box.x, y: box.y, below: false };
  }
  const below = Math.max(...last.map((r) => r.y + r.h)) + gap;
  if (below + size.h <= bounds.bottom - 2) {
    const box = { x: x(last), y: below, w: size.w, h: size.h };
    if (!covers(box)) return { x: box.x, y: box.y, below: true };
  }
  return null;
}
