/* Which code blocks are diagrams. Pure, so it's tested on its own.
 *
 * A code block is a diagram when its language is "mermaid", or when it
 * has no language and its first line opens a Mermaid diagram (a pasted
 * diagram that lost its ```mermaid fence). An explicit other language
 * ("" set by choosing Code, or "js") always stays code. */

const MERMAID_START =
  /^(?:(?:flowchart|graph)\s+(?:TD|TB|BT|LR|RL)\b|sequenceDiagram\b|classDiagram(?:-v2)?\b|stateDiagram(?:-v2)?\b|erDiagram\b|gantt\b|journey\b|pie\b|mindmap\b|timeline\b|gitGraph\b|quadrantChart\b|xychart-beta\b|sankey-beta\b|block-beta\b)/;

export function looksLikeMermaid(text: string): boolean {
  const first = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("%%"));
  return !!first && MERMAID_START.test(first);
}

export function isDiagramBlock(b: { type?: string; lang?: unknown; text?: unknown } | undefined): boolean {
  if (!b || b.type !== "code") return false;
  if (typeof b.lang === "string") {
    if (b.lang.toLowerCase() === "mermaid") return true;
    // Chosen explicitly: "" (plain Code) or another language stays code.
    return false;
  }
  return typeof b.text === "string" && looksLikeMermaid(b.text);
}
