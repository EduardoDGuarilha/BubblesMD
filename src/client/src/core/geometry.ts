/** Pure layout geometry for review families: a wrapping chain of thoughts and obstacle-aware connector dots. */

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

/**
 * Thought dots from the passage to a bubble that avoid every obstacle (minimized reviews, other bubbles), each
 * inflated by its motion envelope. Attach points are tried along the bubble's left edge nearest the passage line
 * first, then its top and bottom edges. Returns null rather than drawing dots through anything.
 */
export function routeDots(source: Point, target: Rect, obstacles: Rect[], obstacleScale = MOTION.markerHover): Dot[] | null {
  const blocked = obstacles.map((o) => envelope(o, obstacleScale));
  const candidates: Point[] = [];
  const top = target.y + 18;
  const bottom = target.y + target.h - 18;
  const ys: number[] = [];
  for (let y = top; y <= bottom; y += 6) ys.push(y);
  ys.sort((p, q) => Math.abs(p - source.y) - Math.abs(q - source.y));
  for (const y of ys) candidates.push({ x: target.x - 4, y });
  for (let x = target.x + 24; x <= target.x + Math.min(target.w - 24, 160); x += 12) {
    candidates.push({ x, y: target.y - 4 }, { x, y: target.y + target.h + 4 });
  }
  for (const end of candidates) {
    const len = Math.hypot(end.x - source.x, end.y - source.y);
    if (len < 14) return [];
    const dots = ROUTE_T.map((t, i) => ({ x: source.x + (end.x - source.x) * t, y: source.y + (end.y - source.y) * t, r: ROUTE_R[i] }));
    const samples: Dot[] = [];
    for (let d = 4; d < len - 4; d += 5) samples.push({ x: source.x + ((end.x - source.x) * d) / len, y: source.y + ((end.y - source.y) * d) / len, r: 0.5 });
    const inner = { x: target.x + 2, y: target.y + 2, w: target.w - 4, h: target.h - 4 };
    const clear = [...dots, ...samples].every((p) => !blocked.some((o) => dotHits(p, o)) && !dotHits(p, inner));
    if (clear) return dots;
  }
  return null;
}

export const MARKER = { w: 34, h: 24, columns: [0, 44], rowStep: 32 };

/**
 * Minimized reviews: each marker takes the free slot nearest its passage (two columns, rows above/below), so
 * nearby reviews group compactly without overlapping one another even at full hover scale and float.
 */
export function placeMarkers(anchors: { id: string; top: number }[]): { id: string; x: number; top: number }[] {
  const placed: { id: string; x: number; top: number }[] = [];
  const boxes: Rect[] = [];
  for (const a of [...anchors].sort((p, q) => p.top - q.top)) {
    const offsets = [0];
    for (let k = 1; k <= 8; k++) offsets.push(k * MARKER.rowStep, -k * MARKER.rowStep);
    let chosen: { x: number; top: number } | null = null;
    for (const dy of offsets) {
      for (const x of MARKER.columns) {
        const rect = envelope({ x, y: a.top + dy, w: MARKER.w, h: MARKER.h }, MOTION.markerHover);
        if (!boxes.some((b) => overlaps(rect, b))) {
          chosen = { x, top: a.top + dy };
          boxes.push(rect);
          break;
        }
      }
      if (chosen) break;
    }
    chosen ??= { x: 0, top: a.top + 9 * MARKER.rowStep };
    placed.push({ id: a.id, ...chosen });
  }
  return placed;
}
