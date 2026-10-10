import { describe, expect, it } from "vitest";
import { isDiagramBlock, looksLikeMermaid } from "./diagram";
import { parseMarkdown } from "./markdown-import";

describe("diagrams", () => {
  it("a mermaid fence keeps its language and draws", () => {
    const [b] = parseMarkdown("```mermaid\nflowchart TD\n  A --> B\n```");
    expect(b).toMatchObject({ type: "code", lang: "mermaid", text: "flowchart TD\n  A --> B" });
    expect(isDiagramBlock(b)).toBe(true);
  });
  it("other fences keep their language and stay code", () => {
    const [b] = parseMarkdown("```js\nconst a = 1\n```");
    expect(b).toMatchObject({ type: "code", lang: "js" });
    expect(isDiagramBlock(b)).toBe(false);
  });
  it("a pasted diagram without its fence language is recognised", () => {
    expect(isDiagramBlock({ type: "code", text: "%% plan\nflowchart LR\n  A-->B" })).toBe(true);
    expect(isDiagramBlock({ type: "code", text: "sequenceDiagram\n  A->>B: hi" })).toBe(true);
    expect(isDiagramBlock({ type: "code", text: "const graph = 1" })).toBe(false);
  });
  it("choosing Code keeps it code, whatever the text", () => {
    expect(isDiagramBlock({ type: "code", lang: "", text: "flowchart TD\n A-->B" })).toBe(false);
  });
  it("only code blocks", () => {
    expect(isDiagramBlock({ type: "text", text: "flowchart TD" })).toBe(false);
    expect(looksLikeMermaid("graph TD")).toBe(true);
    expect(looksLikeMermaid("graph theory")).toBe(false);
  });
});
