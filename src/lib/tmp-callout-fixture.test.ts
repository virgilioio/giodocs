import { it } from "vitest";
import { writeFileSync } from "fs";
import { toHtml } from "./export";
import type { Block } from "./types";

const b = (o: Record<string, unknown>) => o as unknown as Block;

it("writes a PDF fixture", () => {
  const blocks: Block[] = [
    b({ id: "1", type: "callout", icon: "💡", color: "blue", children: [
      b({ id: "1a", type: "text", text: "First child paragraph with **bold**." }),
      b({ id: "1b", type: "h2", text: "A heading inside" }),
    ]}),
    b({ id: "2", type: "callout", icon: "⚠️", color: "amber", text: "Legacy single-text callout." }),
    b({ id: "3", type: "callout", icon: "📋", color: "green", children: [
      b({ id: "3a", type: "bullet", text: "one" }),
      b({ id: "3b", type: "bullet", text: "two" }),
      b({ id: "3c", type: "code", text: "const averyveryverylongidentifier_that_should_not_overflow = 1;" }),
    ]}),
    b({ id: "4", type: "columns", cols: [
      [b({ id: "4a", type: "callout", icon: "🔵", color: "purple", children: [
        b({ id: "4a1", type: "text", text: "Callout inside a column track." }),
        b({ id: "4a2", type: "bullet", text: "nested list item" }),
      ]})],
      [b({ id: "4b", type: "text", text: "Right column." })],
    ]}),
    ...Array.from({ length: 26 }, (_, i) => b({ id: `f${i}`, type: "text", text: `Filler paragraph ${i + 1} pushing the next callout toward a page boundary.` })),
    b({ id: "5", type: "callout", icon: "📄", color: "red", children: [
      b({ id: "5a", type: "text", text: "Boundary callout line one." }),
      b({ id: "5b", type: "text", text: "Boundary callout line two." }),
      b({ id: "5c", type: "text", text: "Boundary callout line three." }),
    ]}),
  ];
  writeFileSync("/tmp/browser/callout/fixture.html", toHtml({ title: "Callout export check", blocks }));
});
