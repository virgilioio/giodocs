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
} as const;

export type IconKey = keyof typeof IC;
