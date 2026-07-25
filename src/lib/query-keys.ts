export const qk = {
  workspace: (ws: string) => ["workspace", ws] as const,
  pages: (ws: string) => ["pages", ws] as const,
  views: (ws: string) => ["views", ws] as const,
  members: (ws: string) => ["members", ws] as const,
  propDefs: (ws: string) => ["propDefs", ws] as const,
  page: (id: string) => ["page", id] as const,
};
