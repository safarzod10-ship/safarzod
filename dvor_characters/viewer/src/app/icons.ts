/** Inline SVG icons for the Mini App shell (vector, so they stay sharp on any screen). */
const svg = (body: string, vb = '0 0 24 24') =>
  `<svg viewBox="${vb}" aria-hidden="true" focusable="false">${body}</svg>`;

export const ICONS = {
  home: svg('<path fill="currentColor" d="M12 3 2 11.5h3V21h5.5v-6h3v6H19v-9.5h3z"/>'),
  hero: svg('<path fill="currentColor" d="M12 2c-3.9 0-7 2.6-7 6.2V10h14V8.2C19 4.6 15.9 2 12 2zM4 11h16v2H4zM7 14h10c0 2.8-2.2 5-5 5s-5-2.2-5-5zM5 22c.6-2.2 3.4-3.3 7-3.3s6.4 1.1 7 3.3z"/><rect x="15" y="10.4" width="6" height="2.2" rx="1" fill="currentColor"/>'),
  tasks: svg('<path fill="currentColor" d="M8 2h8v3H8z"/><path fill="currentColor" d="M5 4h2v3h10V4h2a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm3 7v2h8v-2zm0 4v2h8v-2z"/>'),
  rating: svg('<path fill="currentColor" d="M3 13h5v8H3zM9.5 3h5v18h-5zM16 9h5v12h-5z"/>'),
  back: svg('<path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="M15 4 7 12l8 8"/>'),
  play: svg('<path fill="currentColor" d="M6 3.5v17a1 1 0 0 0 1.5.86l14-8.5a1 1 0 0 0 0-1.72l-14-8.5A1 1 0 0 0 6 3.5z"/>'),
  trophy: svg('<path fill="currentColor" d="M7 2h10v2h4v3a5 5 0 0 1-4.6 5A5 5 0 0 1 13 15.9V18h3v3H8v-3h3v-2.1A5 5 0 0 1 7.6 12 5 5 0 0 1 3 7V4h4zm-2 4v1a3 3 0 0 0 2 2.8V6zm14 0h-2v3.8A3 3 0 0 0 19 7z"/>'),
  crosshair: svg('<circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M12 2v5M12 17v5M2 12h5M17 12h5"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/>'),
  shield: svg('<path fill="currentColor" d="M12 2 4 5v6c0 5 3.4 9.3 8 11 4.6-1.7 8-6 8-11V5z"/><path fill="rgba(0,0,0,.25)" d="M12 4.2V19.8c-3.4-1.6-6-5-6-8.8V6.4z"/>'),
  speed: svg('<path fill="currentColor" d="M14.5 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM9.6 8.4l3.6-.8c.7-.1 1.4.2 1.8.8l1.6 2.7 2.6.7-.5 1.9-3.4-.9-1-1.6-1.2 3.3 2.6 2.4V22h-2v-4l-3-2.6-1.3 3.4-4.6.5-.2-2 3.4-.4 2.4-6.3-1.4.3-1.3 2.6-1.8-.9 1.7-3.4zM1 10h5v1.6H1zm1 3.2h4v1.6H2zM0 7h6v1.6H0z"/>'),
  heart: svg('<path fill="currentColor" d="M12 21s-8-5.1-8-11a4.6 4.6 0 0 1 8-3.1A4.6 4.6 0 0 1 20 10c0 5.9-8 11-8 11z"/>'),
  damage: svg('<path fill="currentColor" d="M4 2 2 4l7.6 7.6-3.9 3.9-1.4-1.4L3 15.5l2 2-3 3L3.5 22l3-3 2 2 1.4-1.3-1.4-1.4 3.9-3.9 1.4 1.4 1.4-1.4zM20 2h-4l-5 5 2 2 1.6-1.6 1.4 1.4L22 2.8z"/><path fill="currentColor" d="m17.5 11-1.4 1.4 1.4 1.4-2 2 1.4 1.4 2-2 2.5 2.6 1.4-1.4z"/>'),
  wing: svg('<path fill="currentColor" d="M22 4c-5 0-9.6 1.5-13 4.4L2 15h6l-2 3h5l-1 3c6.5-1.3 12-7.6 12-17zM5 8h4.5L8 9.5H3.5zM2 11h4.6l-1.5 1.5H.5z"/>'),
  defense: svg('<path fill="currentColor" d="M12 2 4 5v6c0 5 3.4 9.3 8 11 4.6-1.7 8-6 8-11V5z"/>'),
  gear: svg('<path fill="currentColor" d="m19.4 13 2-1.6-2-3.4-2.4.8a7 7 0 0 0-1.6-.9L15 5.4h-4l-.4 2.5a7 7 0 0 0-1.6.9l-2.4-.8-2 3.4 2 1.6a7 7 0 0 0 0 1.9l-2 1.6 2 3.4 2.4-.8c.5.4 1 .7 1.6.9l.4 2.5h4l.4-2.5c.6-.2 1.1-.5 1.6-.9l2.4.8 2-3.4-2-1.6a7 7 0 0 0 0-1.9zM13 17a3 3 0 1 1 0-6 3 3 0 0 1 0 6z" transform="translate(-1 -2)"/>'),
  hourglass: svg('<path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M6 3h12M6 21h12M7 3c0 5 5 6 5 9s-5 4-5 9M17 3c0 5-5 6-5 9s5 4 5 9"/><path fill="currentColor" d="M9 19.5c.5-2 3-3 3-3s2.5 1 3 3z"/>'),
  check: svg('<path fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" d="m5 12.5 4.5 4.5L19 7.5"/>'),
  person: svg('<circle cx="12" cy="8.5" r="4.5" fill="currentColor"/><path fill="currentColor" d="M3 22c.8-4.4 4.4-7 9-7s8.2 2.6 9 7z"/>'),
  run: svg('<path fill="currentColor" d="M15 2.5a2.3 2.3 0 1 1 0 4.6 2.3 2.3 0 0 1 0-4.6zM10 8.2l4.2-1c.8-.2 1.6.2 2 .9l1.8 3.1 3 .8-.6 2.1-3.8-1-1.1-1.8-1.4 3.8 3 2.7V23h-2.3v-4.6l-3.4-3-1.5 4-5.3.6-.3-2.3 3.9-.4 2.8-7.3-1.6.4-1.5 3-2-1 1.9-3.9z"/>'),
  turret: svg('<path fill="currentColor" d="M7 4h10a2 2 0 0 1 2 2v1h2v3h-2v1a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm4-2h2v2h-2z"/><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M12 13v3M12 16l-6 6M12 16l6 6M12 16v6"/><circle cx="9" cy="8.5" r="1.4" fill="#e06a14"/>'),
  cloud: svg('<path fill="currentColor" d="M6.5 19a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 17.4 8.6 4.8 4.8 0 0 1 17.5 19z"/>'),
  door: svg('<rect x="5" y="3" width="14" height="18" rx="1.5" fill="currentColor"/><path stroke="rgba(0,0,0,.45)" stroke-width="1.6" d="M5 7.5h14M5 11.5h14M5 15.5h14"/>'),
  ram: svg('<path fill="currentColor" d="M3 10h9V6l9 6-9 6v-4H3z"/><path stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M2 6l2 2M2 18l2-2"/>'),
  wave: svg('<circle cx="6" cy="12" r="2.6" fill="currentColor"/><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M11 7.5a6.5 6.5 0 0 1 0 9M14.5 4.5a10.5 10.5 0 0 1 0 15M18 2a14 14 0 0 1 0 20"/>'),
  close: svg('<path stroke="currentColor" stroke-width="2.4" stroke-linecap="round" d="M6 6l12 12M18 6 6 18"/>'),
  rank: svg('<path fill="#9aa1aa" d="M32 2 6 12v18c0 15 11 27 26 32 15-5 26-17 26-32V12z"/><path fill="#5b6068" d="M32 7 11 15v15c0 12 9 22 21 27 12-5 21-15 21-27V15z"/><path fill="#d6dae0" d="M20 17h7v10h10V17h7v30h-7V34H27v13h-7z"/><path fill="#eef1f4" d="M24 17h3v30h-3zM37 17h3v30h-3z" opacity=".6"/>', '0 0 64 64'),
};

export const ROLE_ICON = { crosshair: ICONS.crosshair, shield: ICONS.shield, speed: ICONS.speed };
export const STAT_ICONS = [ICONS.heart, ICONS.damage, ICONS.wing, ICONS.defense, ICONS.gear];
