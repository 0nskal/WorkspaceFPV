import logoUrl from './logo.png';
/** Ikony inline SVG w stylu Lucide (stroke 1.75, bez wypelnien). */
const PATHS: Record<string, string> = {
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  alert: '<path d="M12 4 2.5 20h19L12 4Z"/><path d="M12 10v5M12 17.5v.5"/>',
  minus: '<path d="M5 12h14"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  arrowUp: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>',
  copy: '<rect x="8" y="8" width="12" height="12"/><path d="M4 16V4h12"/>',
  chip: '<rect x="5" y="5" width="14" height="14"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  paperclip: '<path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  panel: '<rect x="3" y="4" width="18" height="16"/><path d="M15 4v16"/>',
  plug: '<path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0V8ZM12 18v4"/>',
  play: '<path d="M7 4v16l13-8Z"/>',
  stop: '<rect x="5" y="5" width="14" height="14"/>',
  radio: '<path d="M4.9 19.1a10 10 0 0 1 0-14.2M19.1 4.9a10 10 0 0 1 0 14.2M8.5 15.5a5 5 0 0 1 0-7M15.5 8.5a5 5 0 0 1 0 7"/><circle cx="12" cy="12" r="1.5"/>',
  chart: '<path d="M3 3v18h18"/><path d="m7 15 4-5 3 3 5-7"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  external: '<path d="M14 4h6v6M20 4 10 14M18 14v6H4V6h6"/>',
};

export type IconName = keyof typeof PATHS | string;

export function icon(name: IconName, size = 15, extra = ''): string {
  return `<svg class="i" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" ${extra}>${PATHS[name] ?? ''}</svg>`;
}

/** WorkspaceFPV logo (app icon), rendered from assets/icon-source.png by scripts/make-icons.mjs. */
export function logo(size = 24): string {
  return `<img class="logo" src="${logoUrl}" width="${size}" height="${size}" alt="" aria-hidden="true">`;
}
