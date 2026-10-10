export const qk = {
  workspace: (ws: string) => ["workspace", ws] as const,
  pages: (ws: string) => ["pages", ws] as const,
  views: (ws: string) => ["views", ws] as const,
  members: (ws: string) => ["members", ws] as const,
  invites: (ws: string) => ["invites", ws] as const,
  propDefs: (ws: string) => ["propDefs", ws] as const,
  /** Every property, archived ones included (Settings › Properties). */
  propDefsAll: (ws: string) => ["propDefsAll", ws] as const,
  page: (id: string) => ["page", id] as const,
  customEmoji: (ws: string) => ["customEmoji", ws] as const,
  pageAccess: (id: string) => ["pageAccess", id] as const,
  /** A page's saved versions, newest first (no blocks). */
  pageVersions: (id: string) => ["pageVersions", id] as const,
  /** One version ready to preview: its blocks rendered to a document. */
  pageVersionPreview: (id: string) => ["pageVersionPreview", id] as const,
  /** The pages that mention, link to or embed a page ("Linked from"). */
  backlinks: (id: string) => ["backlinks", id] as const,
  /** This person's notifications, newest first. */
  inbox: (userId: string) => ["inbox", userId] as const,
  /** A page's comments, oldest first. */
  comments: (pageId: string) => ["comments", pageId] as const,
};
