/**
 * Geometrically centred plus (two equal bars on a 16-unit grid). Used instead of a "+" text glyph, whose font
 * metrics sit off-centre inside round controls.
 */
export const PLUS_SVG =
  '<svg class="plus-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
  '<path d="M8 3.25v9.5M3.25 8h9.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';

export function PlusIcon() {
  return (
    <svg className="plus-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M8 3.25v9.5M3.25 8h9.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
