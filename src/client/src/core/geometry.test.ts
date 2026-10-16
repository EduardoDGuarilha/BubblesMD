import { describe, expect, it } from 'vitest';
import { chainDots, envelope, layoutChain, overlaps, routeDots, type Rect } from './geometry';

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

  it('routes passage dots around a minimized review in the straight path, or draws none', () => {
    const source = { x: 0, y: 100 };
    const bubble: Rect = { x: 120, y: 60, w: 300, h: 160 };
    const marker: Rect = { x: 50, y: 88, w: 34, h: 24 };
    const dots = routeDots(source, bubble, [marker])!;
    expect(dots).not.toBeNull();
    for (const d of dots) {
      const disc = { x: d.x - d.r, y: d.y - d.r, w: d.r * 2, h: d.r * 2 };
      expect(overlaps(disc, envelope(marker, 0.12))).toBe(false);
    }
    const wall: Rect = { x: 40, y: -400, w: 40, h: 1000 };
    expect(routeDots(source, bubble, [wall])).toBeNull();
  });
});

describe('minimized review placement', () => {
  it('keeps nearby markers apart through hover scale and float, close to their passages', async () => {
    const { placeMarkers, MARKER } = await import('./geometry');
    const placed = placeMarkers([
      { id: 'a', top: 100 },
      { id: 'b', top: 104 },
      { id: 'c', top: 108 },
      { id: 'd', top: 300 },
    ]);
    const boxes = placed.map((m) => envelope({ x: m.x, y: m.top, w: MARKER.w, h: MARKER.h }, 0.12));
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i], boxes[j])).toBe(false);
    for (const m of placed) expect(m.x + MARKER.w).toBeLessThanOrEqual(80);
    expect(placed.find((m) => m.id === 'd')!.top).toBe(300);
    expect(Math.max(...placed.slice(0, 3).map((m) => Math.abs(m.top - 104)))).toBeLessThanOrEqual(40);
  });
});
