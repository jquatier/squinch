// First-party glyph artwork: the sys/* set plus builtin person/box, drawn as
// 24×24 monoline strokes in the house style (DESIGN §2: 1.75 stroke, round
// caps/joins). Everything paints with currentColor so themes tint natively —
// muted on card badges, plate-text white on icon plates, ink in sketch.
// Ours, not vendored: freely styleable, no license constraints.

const S = `fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"`;
const F = `fill="currentColor" stroke="none"`;

const g = (inner: string) => `<g ${S}>${inner}</g>`;

export const SYS_GLYPH_ART: Record<string, Record<string, string>> = {
  sys: {
    api: g(
      `<path d="M8 7 3.5 12 8 17"/><path d="M16 7 20.5 12 16 17"/><path d="M13.5 5 10.5 19"/>`,
    ),
    webapp: g(
      `<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M3 9h18"/>` +
        `<circle cx="5.9" cy="6.75" r="0.8" ${F}/><circle cx="8.4" cy="6.75" r="0.8" ${F}/>`,
    ),
    mobile: g(`<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M10.5 17.75h3"/>`),
    service: g(`<path d="M12 3.5 19 7.75v8.5L12 20.5 5 16.25v-8.5Z"/>`),
    worker: g(
      `<circle cx="12" cy="12" r="3.25"/>` +
        `<path d="M12 4v2.5M12 17.5V20M4 12h2.5M17.5 12H20"/>` +
        `<path d="M6.34 6.34 8.1 8.1M15.9 15.9l1.76 1.76M17.66 6.34 15.9 8.1M8.1 15.9l-1.76 1.76"/>`,
    ),
    database: g(
      `<ellipse cx="12" cy="6" rx="7" ry="2.75"/>` +
        `<path d="M5 6v12c0 1.52 3.13 2.75 7 2.75s7-1.23 7-2.75V6"/>` +
        `<path d="M5 12c0 1.52 3.13 2.75 7 2.75s7-1.23 7-2.75"/>`,
    ),
    cache: g(`<path d="M13.5 3.5 6.5 13.5H11l-.5 7 7-10h-4.5Z"/>`),
    queue: g(
      `<path d="M4 8h10M4 12h10M4 16h10"/><path d="M17 9.5 19.5 12 17 14.5"/>`,
    ),
    "event-bus": g(
      `<path d="M3 12h1.6M8.4 12h1.7M13.9 12h1.7M19.4 12H21"/>` +
        `<circle cx="6.5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="17.5" cy="12" r="1.9"/>`,
    ),
    filestore: g(
      `<path d="M3.5 7v11c0 .83.67 1.5 1.5 1.5h14c.83 0 1.5-.67 1.5-1.5V9.5c0-.83-.67-1.5-1.5-1.5h-7l-2-2.5H5c-.83 0-1.5.67-1.5 1.5Z"/>`,
    ),
    search: g(`<circle cx="10.5" cy="10.5" r="5.5"/><path d="m14.7 14.7 5.3 5.3"/>`),
    gateway: g(
      `<path d="M5 20V10c0-4.5 3-6.5 7-6.5s7 2 7 6.5v10"/><path d="M3.5 20h17"/>`,
    ),
    auth: g(
      `<rect x="5.5" y="10.5" width="13" height="9.5" rx="1.5"/>` +
        `<path d="M8.5 10.5V8c0-2 1.5-3.5 3.5-3.5S15.5 6 15.5 8v2.5"/>` +
        `<circle cx="12" cy="15.25" r="1.1" ${F}/>`,
    ),
    monitor: g(`<path d="M3 12h4.5L10 6.5l4 11 2.5-5.5H21"/>`),
    scheduler: g(`<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3.5 2"/>`),
    org: g(
      `<rect x="5" y="4" width="14" height="16"/><path d="M10.5 20v-4.5h3V20"/>` +
        `<path d="M8.5 8H10M14 8h1.5M8.5 11.5H10M14 11.5h1.5"/>`,
    ),
    internet: g(
      `<circle cx="12" cy="12" r="8"/><ellipse cx="12" cy="12" rx="3.6" ry="8"/>` +
        `<path d="M4.6 9.5h14.8M4.6 14.5h14.8"/>`,
    ),
  },
  builtin: {
    person: g(
      `<circle cx="12" cy="8" r="3.75"/><path d="M5 20c0-4.1 3.1-6.5 7-6.5s7 2.4 7 6.5"/>`,
    ),
    box: g(
      `<path d="M12 3.5 20 7.75v8.5L12 20.5 4 16.25v-8.5Z"/>` +
        `<path d="M4 7.75 12 12l8-4.25"/><path d="M12 12v8.5"/>`,
    ),
  },
};

export const SYS_GLYPH_VIEWBOX = "0 0 24 24";
