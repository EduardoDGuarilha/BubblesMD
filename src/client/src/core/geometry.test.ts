import { describe, expect, it } from 'vitest';
import {
  chainDots,
  CLUSTER,
  COARSE_MARKER,
  connectDots,
  envelope,
  layoutChain,
  MARKER,
  markerZone,
  overlaps,
  placeFamily,
  placeMarkers,
  placeSelectionAction,
  type Rect,
} from './geometry';

describe('family geometry', () => {
  it('lays out a wrapping chain whose bubbles stay clear of each other throughout their motion', () => {
    const sizes = [
      { w: 90, h: 34 },
      { w: 260, h: 54 },
      { w: 120, h: 34 },
      { w: 300, h: 76 },
      { w: 30, h: 30 },
    ];
    const layout = layoutChain(sizes, 420);
    expect(new Set(layout.rowOf).size).toBeGreaterThan(1);
    const moving = layout.rects.map((r) => envelope(r));
    for (let i = 0; i < moving.length; i++)
      for (let j = i + 1; j < moving.length; j++) expect(overlaps(moving[i], moving[j]), `${i}/${j}`).toBe(false);
    for (const r of layout.rects) expect(r.x + r.w).toBeLessThanOrEqual(420);

    const main: Rect = { x: 0, y: -120, w: 400, h: 100 };
    for (const d of chainDots(main, layout)) {
      const disc = { x: d.x - d.r, y: d.y - d.r, w: d.r * 2, h: d.r * 2 };
      for (const r of [main, ...layout.rects]) expect(overlaps(disc, envelope(r)), JSON.stringify(d)).toBe(false);
    }
  });

  it('connects from the passage when clear, else from the active miniature, else not at all', () => {
    const target: Rect = { x: 200, y: 40, w: 300, h: 160 };
    const passage = { x: 0, y: 100 };
    const mini: Rect = { x: 60, y: 140, w: 34, h: 24 };
    const zone = envelope(mini, 0.12);
    const clear = connectDots(passage, mini, zone, target, []);
    expect(clear?.from).toBe('passage');
    // The miniature in the way of the passage run: the dots start from the miniature instead.
    const inWay: Rect = { x: 80, y: 88, w: 34, h: 24 };
    const fallback = connectDots(passage, inWay, envelope(inWay, 0.12), target, [envelope({ x: 140, y: 30, w: 34, h: 24 }, 0.12)]);
    expect(fallback?.from).toBe('miniature');
    for (const d of fallback!.dots) {
      const disc = { x: d.x - d.r, y: d.y - d.r, w: d.r * 2, h: d.r * 2 };
      expect(overlaps(disc, target)).toBe(false);
    }
    // Enclosed by neighbours to its right: one bend over the cluster, still touching nothing.
    const enclosed: Rect = { x: 4, y: 115, w: 34, h: 24 };
    const neighbours = [
      { x: 48, y: 115, w: 34, h: 24 },
      { x: 26, y: 150, w: 34, h: 24 },
      { x: 70, y: 150, w: 34, h: 24 },
    ].map((r) => envelope(r, 0.12));
    const cluster = { x: 0, y: 110, w: 108, h: 70 };
    const family: Rect = { x: 130, y: 105, w: 300, h: 160 };
    const bent = connectDots({ x: -40, y: 128 }, enclosed, envelope(enclosed, 0.12), family, neighbours, cluster);
    expect(bent?.from).toBe('miniature');
    expect(bent!.dots.length).toBe(4);
    for (const d of bent!.dots) {
      const disc = { x: d.x - d.r, y: d.y - d.r, w: d.r * 2, h: d.r * 2 };
      for (const o of [...neighbours, family]) expect(overlaps(disc, o), JSON.stringify(d)).toBe(false);
    }
    const wall: Rect = { x: 120, y: -400, w: 40, h: 1000 };
    expect(connectDots(passage, inWay, envelope(inWay, 0.12), target, [wall])).toBeNull();
  });
});

const zoneOf = (m: { x: number; top: number }) => markerZone(m);
const noOverlap = (placed: { x: number; top: number }[]) => {
  const boxes = placed.map(zoneOf);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (overlaps(boxes[i], boxes[j])) return false;
  return true;
};

describe('minimized review clusters', () => {
  const five = [100, 128, 156, 184, 212].map((top, i) => ({ id: `r${i}`, top, seq: i }));

  it('packs nearby reviews into one staggered cluster (neither a column nor a row), deterministically', () => {
    const placed = placeMarkers(five, 300);
    expect(placeMarkers([...five].reverse(), 300)).toEqual(placed);
    expect(noOverlap(placed)).toBe(true);
    expect(new Set(placed.map((m) => m.cluster)).size).toBe(1);
    const xs = new Set(placed.map((m) => m.x));
    const rows = new Set(placed.map((m) => m.top));
    expect(xs.size).toBeGreaterThan(1);
    expect(rows.size).toBeGreaterThan(1);
    // Neighbouring rows interlock by half a cell (honeycomb), and higher passages sit higher.
    expect(xs.has(CLUSTER.pitchX / 2)).toBe(true);
    const tops = [...placed].sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1))).map((m) => m.top);
    expect([...tops].sort((a, b) => a - b)).toEqual(tops);
    for (const m of placed) expect(m.x + MARKER.w).toBeLessThanOrEqual(300);
  });

  it('keeps distant reviews at their passages, and pushes a touching cluster down by the minimum', () => {
    const placed = placeMarkers([...five, { id: 'far', top: 600, seq: 9 }], 300);
    expect(placed.find((m) => m.id === 'far')!.top).toBe(600);
    expect(placed.find((m) => m.id === 'far')!.cluster).toBe(1);
    const close = placeMarkers([...five, { id: 'next', top: 262, seq: 9 }], 300);
    expect(noOverlap(close)).toBe(true);
    const last = Math.max(...close.filter((m) => m.id !== 'next').map((m) => m.top));
    expect(close.find((m) => m.id === 'next')!.top).toBe(Math.max(262, last + CLUSTER.pitchY));
  });

  it('stays inside a narrow rail as a single column, never above the top', () => {
    const placed = placeMarkers([{ id: 'a', top: -20, seq: 0 }, ...five], MARKER.w + 8);
    expect(noOverlap(placed)).toBe(true);
    expect(new Set(placed.map((m) => m.x))).toEqual(new Set([0]));
    expect(Math.min(...placed.map((m) => zoneOf(m).y))).toBeGreaterThanOrEqual(0);
  });

  it('spaces enlarged touch markers by their own size', () => {
    const placed = placeMarkers(five, 300, COARSE_MARKER);
    const zones = placed.map((m) => markerZone(m, COARSE_MARKER));
    for (let i = 0; i < zones.length; i++) for (let j = i + 1; j < zones.length; j++) expect(overlaps(zones[i], zones[j])).toBe(false);
  });

  it('keeps the arrangement when one passage shifts slightly', () => {
    const a = placeMarkers(five, 300);
    const b = placeMarkers(five.map((m) => (m.id === 'r2' ? { ...m, top: m.top + 3 } : m)), 300);
    expect(b.map((m) => [m.id, m.x])).toEqual(a.map((m) => [m.id, m.x]));
  });
});

describe('family and selection action placement', () => {
  it('puts the family right of the clusters beside it, or below the active cluster when the rail is too narrow', () => {
    const placed = placeMarkers([100, 128, 156].map((top, i) => ({ id: `r${i}`, top, seq: i })), 200);
    const zones = placed.map(zoneOf);
    const wide = placeFamily(zones, zones, { top: 70, bottom: 400 }, 700);
    expect(wide.below).toBeNull();
    expect(wide.left).toBeGreaterThanOrEqual(Math.max(...zones.map((z) => z.x + z.w)));
    expect(wide.left + wide.width).toBeLessThanOrEqual(700);
    const narrow = placeFamily(zones, zones, { top: 70, bottom: 400 }, 260);
    expect(narrow.below).toBeGreaterThanOrEqual(Math.max(...zones.map((z) => z.y + z.h)));
  });

  it('places the selection action above the first line, below the last when needed, never over the selection', () => {
    const lines: Rect[] = [
      { x: 120, y: 200, w: 300, h: 26 },
      { x: 60, y: 228, w: 200, h: 26 },
    ];
    const bounds = { left: 40, right: 600, top: 0, bottom: 800 };
    const above = placeSelectionAction(lines, bounds, { w: 90, h: 28 })!;
    expect(above.below).toBe(false);
    expect(above.y + 28).toBeLessThanOrEqual(200);
    expect(above.x).toBe(120 + 150 - 45);
    const top = placeSelectionAction(lines, { ...bounds, top: 180 }, { w: 90, h: 28 })!;
    expect(top.below).toBe(true);
    expect(top.y).toBeGreaterThanOrEqual(254);
    const edge = placeSelectionAction([{ x: 560, y: 300, w: 40, h: 26 }], bounds, { w: 90, h: 28 })!;
    expect(edge.x + 90).toBeLessThanOrEqual(600);
    expect(placeSelectionAction(lines, { ...bounds, top: 180, bottom: 270 }, { w: 90, h: 28 })).toBeNull();
  });
});
