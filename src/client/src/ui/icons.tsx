/**
 * Geometric control icons on one 16-unit grid (equal 1.7-unit strokes, centred on the grid), used instead of
 * "+", "−" and "×" text glyphs, whose font metrics sit off-centre inside round controls.
 */
const PLUS = 'M8 3.25v9.5M3.25 8h9.5';
const MINUS = 'M3.25 8h9.5';
const CLOSE = 'M4.6 4.6l6.8 6.8M11.4 4.6l-6.8 6.8';

const svg = (cls: string, d: string) =>
  `<svg class="${cls}" viewBox="0 0 16 16" aria-hidden="true" focusable="false">` +
  `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;

/** Markup for editor widgets and rendered candidates, which are built outside React. */
export const PLUS_SVG = svg('plus-icon', PLUS);
export const MINUS_SVG = svg('minus-icon', MINUS);

function Icon({ className, d }: { className: string; d: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export const PlusIcon = () => <Icon className="plus-icon" d={PLUS} />;
export const MinusIcon = () => <Icon className="icon" d={MINUS} />;
export const CloseIcon = () => <Icon className="icon" d={CLOSE} />;
