// Inline SVG icons. Using SVG rather than font glyphs (⚙ ⠿ ↑ …) so the
// UI doesn't depend on the typeface covering symbol codepoints.

const wrap = (paths: string, w = 16): string =>
  `<svg width="${w}" height="${w}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`

export const ICON = {
  /** Drag handle -- three lines. */
  grip: wrap('<path d="M2.5 5h11M2.5 8h11M2.5 11h11"/>'),
  gear: wrap(
    '<circle cx="8" cy="8" r="2.1"/><path d="M8 1.5v1.7M8 12.8v1.7M2.6 8H1M15 8h-1.6M4.1 4.1 3 3M13 13l-1.1-1.1M11.9 4.1 13 3M3 13l1.1-1.1"/>',
  ),
  chevronUp: wrap('<path d="M4 10l4-4 4 4"/>'),
  chevronDown: wrap('<path d="M4 6l4 4 4-4"/>'),
  arrowLeft: wrap('<path d="M9.5 3.5 5 8l4.5 4.5M5 8h7"/>'),
  plus: wrap('<path d="M8 3v10M3 8h10"/>'),
}
