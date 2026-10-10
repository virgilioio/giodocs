/* The page being dragged in the sidebar, shared by both sections' trees
 * and the section headers (dragover can't read the drag's data, only its
 * types). */
let dragging: string | null = null;

export const DRAG_TYPE = "application/x-gio-page";

export function draggedPage(): string | null {
  return dragging;
}

export function setDraggedPage(id: string | null): void {
  dragging = id;
}
