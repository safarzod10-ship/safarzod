/**
 * Hand-drawn SVG icons (24x24, stroke = currentColor). Emoji look different
 * on every phone; these keep the atlas look consistent.
 */
import type { Res } from '../game/config.ts';

const svg = (body: string, cls = ''): string =>
  `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;

export const RES_SVG: Record<Res | 'crystals' | 'pop', string> = {
  coins: svg('<ellipse cx="12" cy="8" rx="7" ry="3.2"/><path d="M5 8v4c0 1.8 3.1 3.2 7 3.2s7-1.4 7-3.2V8"/><path d="M5 12v4c0 1.8 3.1 3.2 7 3.2s7-1.4 7-3.2v-4"/>', 'ic-coins'),
  crystals: svg('<path d="M7 4h10l4 5-9 11L3 9z"/><path d="M3 9h18M9.5 4 8 9l4 11 4-11-1.5-5"/>', 'ic-crystals'),
  pop: svg('<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19c.6-3.3 2.8-5 5.5-5s4.9 1.7 5.5 5"/><circle cx="17" cy="9.5" r="2.3"/><path d="M15.6 14.3c.5-.2 1-.3 1.5-.3 2.1 0 3.8 1.4 4.3 4"/>', 'ic-pop'),
  wood: svg('<rect x="3" y="7" width="15" height="10" rx="5" transform="rotate(-12 10 12)"/><ellipse cx="17.3" cy="10.4" rx="2.6" ry="4.9" transform="rotate(-12 17.3 10.4)"/><path d="M16.9 9.2c.9 0 1.3.7 1.2 1.6"/>', 'ic-wood'),
  stone: svg('<path d="M4 16.5 6.5 9l5-3.5 6 2 2.5 6-3 4.5H7.5z"/><path d="M6.5 9 11 12l6.5-4.5M11 12l-1 6"/>', 'ic-stone'),
  iron: svg('<path d="M3 15.5 6 10h12l3 5.5z"/><path d="M6 10l2-3h8l2 3"/><path d="M3 15.5V17h18v-1.5"/>', 'ic-iron'),
  food: svg('<path d="M12 21V9"/><path d="M12 9c-2.6-.3-3.8-2-3.8-4.8 2.6.3 3.8 2 3.8 4.8zm0 0c2.6-.3 3.8-2 3.8-4.8-2.6.3-3.8 2-3.8 4.8z"/><path d="M12 14c-2.6-.3-3.8-2-3.8-4.8 2.6.3 3.8 2 3.8 4.8zm0 0c2.6-.3 3.8-2 3.8-4.8-2.6.3-3.8 2-3.8 4.8z"/>', 'ic-food'),
  goods: svg('<path d="M4 8.5 12 4.5l8 4v8l-8 4-8-4z"/><path d="m4 8.5 8 4 8-4M12 12.5v8"/><path d="m8 6.5 8 4"/>', 'ic-goods'),
};

export const NAV_SVG = {
  map: svg('<path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6z"/><path d="M9 4v14M15 6v14"/>'),
  build: svg('<path d="M4 20V10l5-4 5 4v10"/><path d="M14 20v-6h6v6"/><path d="M3 20h18M8 20v-4h2v4"/>'),
  market: svg('<path d="M4 9 5.5 4h13L20 9"/><path d="M4 9c0 1.4 1.1 2.5 2.7 2.5S9.3 10.4 9.3 9c0 1.4 1.2 2.5 2.7 2.5s2.7-1.1 2.7-2.5c0 1.4 1.1 2.5 2.6 2.5S20 10.4 20 9"/><path d="M5.5 11.3V20h13v-8.7M10 20v-5h4v5"/>'),
  city: svg('<path d="M3 20h18"/><path d="M5 20V9l4-2v13M9 20V5l6 2.5V20M15 20v-8l4 1.5V20"/>'),
  profile: svg('<circle cx="12" cy="8.5" r="3.6"/><path d="M4.5 20c.8-4 3.7-6 7.5-6s6.7 2 7.5 6"/>'),
};

export const UI_SVG = {
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  minus: svg('<path d="M5 12h14"/>'),
  home: svg('<path d="M4 11 12 4l8 7"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>'),
  globe: svg('<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.4 3.8 5.2 3.8 8.5s-1.2 6.1-3.8 8.5c-2.6-2.4-3.8-5.2-3.8-8.5S9.4 5.9 12 3.5z"/>'),
  expand: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><rect x="9" y="9" width="6" height="6" rx="1"/>'),
  check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  brush: svg('<path d="M14.5 4.5 19.5 9.5 11 18l-5-5z"/><path d="M6 13c-2 0-3 1.5-3 3.2 0 1.8-.5 2.8-1 3.3 3.3.4 6.5-.5 7-3.5"/>'),
  up: svg('<path d="M12 19V6M6.5 11.5 12 6l5.5 5.5"/>'),
  trash: svg('<path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13"/>'),
  clock: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  hammer: svg('<path d="M13.5 6.5 17 3l4 4-3.5 3.5z"/><path d="M15 8.5 5 18.5a1.4 1.4 0 0 0 2 2l10-10"/>'),
  star: svg('<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/>'),
  swap: svg('<path d="M7 7h12l-3.5-3.5M17 17H5l3.5 3.5"/>'),
  info: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.6v.4"/>'),
  people: RES_SVG.pop,
};
