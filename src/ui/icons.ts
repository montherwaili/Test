/**
 * The game's icons: one hand-drawn set on a 24-unit grid, line-drawn with
 * round ends, so every button and warning lamp shares one look. The warning
 * lamps follow the symbols drivers know from real dashboards.
 */
const ICONS = {
  menu: '<path d="M4 7h16M4 12h16M4 17h10"/>',
  camera:
    '<path d="M3 8.5A1.5 1.5 0 0 1 4.5 7H7l1.5-2h7L17 7h2.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/><circle cx="12" cy="13" r="3.5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.6 2.3c-.8.4-1.2 1-1.2 1.9v.5"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/><circle cx="12" cy="12" r="6.6"/>',
  reset: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4 4.5v4h4"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  chevron: '<path d="M14.5 6l-6 6 6 6"/>',
  play: '<path d="M8 5.5v13l10-6.5z"/>',
  /** Push-to-start: the power symbol. */
  power: '<path d="M12 3.5v8"/><path d="M7.2 6.6a7.5 7.5 0 1 0 9.6 0"/>',
  /** Warning lamps. */
  seatbelt:
    '<circle cx="12" cy="4.6" r="2"/><path d="M8 21v-6.5c0-2.6 1.7-5 4-5s4 2.4 4 5V21"/><path d="M8.6 9.6l7.2 9.8"/>',
  handbrake: '<circle cx="12" cy="12" r="5.6"/><path d="M10.4 14.8V9.2h2.1a1.6 1.6 0 0 1 0 3.2h-2.1"/><path d="M4.6 6.6a8.5 8.5 0 0 0 0 10.8M19.4 6.6a8.5 8.5 0 0 1 0 10.8"/>',
  engine:
    '<path d="M3.5 10v5M3.5 12.5H6M6 9h2l1.4-2H14v2h2.2l1.3 2H20v-1.5M20 9.5v6M6 9v7.5h7.5l1.5 1.5h3l1.5-2.5"/>',
  lowBeam:
    '<path d="M11 6.5c-3.5 0-5.5 2.4-5.5 5.5s2 5.5 5.5 5.5c1.6 0 2.5-2.4 2.5-5.5S12.6 6.5 11 6.5z"/><path d="M16 8.5l4 1.2M16 12l4 1.2M16 15.5l4 1.2"/>',
  highBeam:
    '<path d="M11 6.5c-3.5 0-5.5 2.4-5.5 5.5s2 5.5 5.5 5.5c1.6 0 2.5-2.4 2.5-5.5S12.6 6.5 11 6.5z"/><path d="M16 8.5h4.5M16 12h4.5M16 15.5h4.5"/>',
  horn: '<path d="M4 10v4h3l6 4.5v-13L7 10z"/><path d="M16.5 9a4 4 0 0 1 0 6M18.8 6.8a7 7 0 0 1 0 10.4"/>',
  mirror: '<rect x="3.5" y="7.5" width="17" height="9" rx="4.5"/><path d="M7.5 11.5c1.5-1.2 3-1.6 5-1.2"/>',
  hazard: '<path d="M12 4.5l8 14H4z"/><path d="M12 9.2l3.5 6.1h-7z"/>',
  arrowLeft: '<path d="M10.5 5.5L4 12l6.5 6.5V14.5H20v-5h-9.5z" fill="currentColor"/>',
  arrowRight: '<path d="M13.5 5.5L20 12l-6.5 6.5V14.5H4v-5h9.5z" fill="currentColor"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3z"/>',
  road: '<path d="M8 3L4.5 21M16 3l3.5 18M12 4.5v2.5M12 10.5v3M12 17v2.5"/>',
  map: '<path d="M9 4.5L3.5 6.5v13L9 17.5l6 2 5.5-2v-13L15 6.5z"/><path d="M9 4.5v13M15 6.5v13"/>',
} as const;

export type IconName = keyof typeof ICONS;

/** An inline SVG icon (sized by CSS: 1em by default), coloured by `currentColor`. */
export function icon(name: IconName, className = ''): SVGSVGElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  return tpl.content.firstElementChild as SVGSVGElement;
}
