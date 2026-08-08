/**
 * The single source of `d=` path data for the 15px icons drawn in menu rows.
 * Every action row in a menu picks its icon from this map — never inlines a
 * path. Later chunks extend the map with additional keys as more menus are
 * migrated to the spec API; do NOT branch this file into per-menu subsets.
 *
 * Contract: paths draw in a 24×24 viewBox, fill="none", stroke-width 1.9,
 * round cap/join. See row-menu.tsx.
 */
export const IC = {
  open:    "m9 18 6-6-6-6",
  chevDown:"m6 9 6 6 6-6",
  chevUp:  "m18 15-6-6-6 6",
  plus:    "M12 5v14M5 12h14",
  pencil:
    "M4 20h4l10-10a2.83 2.83 0 0 0-4-4L4 16v4M13.5 6.5l4 4",
  layout:
    "M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM3 10h18M10 10v9",
  board:   "M5 5v13M12 5v9M19 5v11",
  list:
    "M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01",
  dup:
    "M9 9h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1",
  link:
    "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.8 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7L12.3 19",
  people:
    "M9 3.6a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2zM2 20.4v-1.8a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v1.8M16.5 3.9a3.6 3.6 0 0 1 0 7M22 20.4v-1.8a4 4 0 0 0-3-3.8",
  eyeOff:
    "M3 3l18 18M10.6 5.2A9.7 9.7 0 0 1 12 5c5 0 9 4.5 9 7 0 .9-.6 2-1.6 3.1M6.5 6.8C4.4 8.2 3 10.3 3 12c0 2.5 4 7 9 7 1.6 0 3-.4 4.2-1M9.9 9.9a3 3 0 0 0 4.2 4.2",
  lock:
    "M7 11h10a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2zM8 11V7a4 4 0 0 1 8 0v4",
  bookmark:"M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z",
  trash:
    "M4 7h16M10 11v6M14 11v6M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M9 7V4h6v3",
  clear:   "M18 6 6 18M6 6l12 12",
  shield:
    "M12 2.6l7.6 3.6v5.6c0 4.8-3.3 8.1-7.6 9.6-4.3-1.5-7.6-4.8-7.6-9.6V6.2zM9 11.8l2 2 4-4",
  dot:     "M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8z",
  person:
    "M12 3.4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 20.6v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2",
  arrow:   "M4 12h14m-5-5 5 5-5 5",
  tag:
    "M20.4 13.6 13.6 20.4a2 2 0 0 1-2.8 0L3.6 13.2V4.4a.8.8 0 0 1 .8-.8h8.8l7.2 7.2a2 2 0 0 1 0 2.8zM7.6 7.6h.01",
  clock:
    "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.5V12l3.2 1.9",
  download:
    "M12 3v12M7.5 10.5 12 15l4.5-4.5M4 19h16",
  droplet:
    "M12 3.4c0 0 5.6 5.7 5.6 9.5a5.6 5.6 0 0 1-11.2 0c0-3.8 5.6-9.5 5.6-9.5z",

  /* ── Sheet formatting toolbar. Same 24-grid, same single-path
   * discipline; FILL deliberately reuses `droplet` above so "colour this
   * thing" is one symbol across the product. ── */
  alignL: "M4 6h16M4 12h10M4 18h13",
  alignC: "M4 6h16M7 12h10M6 18h12",
  alignR: "M4 6h16M10 12h10M7 18h13",
  /* Text colour: a serif A, the letterform every ink control uses. */
  letterA: "M5 19 12 5.4 19 19M8.6 14.2h6.8",
  /* Rule above: a heavy line with figures beneath it — a total row. */
  ruleTop: "M3.5 8h17M7 13h3.5M14 13h3M7 17.5h3.5M14 17.5h3",
  /* Freeze header: a grid whose first row is separated off. */
  freezeRow:
    "M4.5 5h15A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-11A1.5 1.5 0 0 1 4.5 5zM3 10h18M7 14.4h10",


  /* ── One icon per BLOCK TYPE. Read by the slash menu, the Turn-into
   * submenu and the parent row through the block definition's `ic` key —
   * never re-listed per menu. ── */
  bText: "M6 5h12M9.6 5v14M7.4 19h4.4",
  bH1: "M5 5.5v13M12.5 5.5v13M5 12h7.5M16.5 10.4 19 8.8V19",
  bH2: "M4.5 5.5v13M12 5.5v13M4.5 12h7.5M15.4 10.6a2.3 2.3 0 0 1 4.2 1.3c0 2-4.2 3.2-4.2 6.4h4.3",
  bH3: "M4.5 5.5v13M12 5.5v13M4.5 12h7.5M15.4 10.4a2.2 2.2 0 1 1 2.4 3.3 2.3 2.3 0 1 1-2.5 3.5",
  bBullet: "M9 6h12M9 12h12M9 18h12M4.6 6h.01M4.6 12h.01M4.6 18h.01",
  bNumbered:
    "M10 6h11M10 12h11M10 18h11M4 6.6 5.6 5.6v5M3.6 14.4a1.6 1.6 0 0 1 3 .8c0 1.4-3 2.2-3 4.4h3",
  bTodo:
    "M5.4 4h13a1.4 1.4 0 0 1 1.4 1.4v13a1.4 1.4 0 0 1-1.4 1.4h-13A1.4 1.4 0 0 1 4 18.4v-13A1.4 1.4 0 0 1 5.4 4zM8.3 12.1l2.6 2.6 4.8-5.2",
  bToggle: "m7 7.5 4.5 4.5L7 16.5M14.5 9.5h5.5M14.5 14.5h4",
  /* Toggle headings: the Toggle chevron + two heading rules + the matching
   * numeral, so they never share an identical glyph with plain Toggle. */
  bToggleH1: "m5 7.5 4 4.5-4 4.5M12 9.5h4.5M12 14.5h3M19.6 10.2 21.4 9v6",
  bToggleH2:
    "m5 7.5 4 4.5-4 4.5M12 9.5h4.5M12 14.5h3M18.8 10a1.6 1.6 0 0 1 2.9.9c0 1.4-2.9 2.2-2.9 4.4h3",
  bToggleH3:
    "m5 7.5 4 4.5-4 4.5M12 9.5h4.5M12 14.5h3M18.8 9.9a1.5 1.5 0 1 1 1.7 2.3 1.6 1.6 0 1 1-1.8 2.4",
  bQuote: "M5 5.5v13M10.5 8.5h9.5M10.5 12.5h9.5M10.5 16.5h6",
  /* Caption: the Text glyph derived smaller — same serif-A skeleton at a
   * reduced optical size, so it reads as "quiet text". */
  bCaption: "M8 8h8M11.4 8v9M9.6 17h3.6",
  bCallout:
    "M9.6 21h4.8M10.4 18.2h3.2M12 3a6.2 6.2 0 0 0-3.6 11.2v3.2h7.2v-3.2A6.2 6.2 0 0 0 12 3z",
  bDivider: "M3 12h18M7 7.4h10M7 16.6h10",
  bCode: "m8.2 8.4-4 3.6 4 3.6M15.8 8.4l4 3.6-4 3.6M13.4 5.6l-2.8 12.8",
  bImage:
    "M4.5 5h15A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-11A1.5 1.5 0 0 1 4.5 5zM3 15.4l5-4.4 4.6 4M13.6 13.2 16.4 11 21 14.6M15.6 8.4h.01",
  bImageRow:
    "M4 5.5h6.4a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1zM3.4 15.2l3-2.6 2.8 2.4M14.6 5.5H20a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-5.4a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1zM13.9 15.2l2.7-2.4 2.6 2.2",
  /* A page with a folded corner — the file block. */
  bFile:
    "M13.4 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9.1zM13.4 3.5v5.6H19",
  bSheet:
    "M4.5 5h15a1.5 1.5 0 0 1 1.5 1.5v11a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-11A1.5 1.5 0 0 1 4.5 5zM3 9.6h18M9 9.6V20M15 9.6V20",
  bTable:
    "M4.5 5h15a1.5 1.5 0 0 1 1.5 1.5v11a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-11A1.5 1.5 0 0 1 4.5 5zM3 10h18M9.5 10v9",
} as const;



export type IconKey = keyof typeof IC;
