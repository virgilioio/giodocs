/* The app's @font-face rules as one CSS string, with every url() made
 * absolute, for documents that render inside an iframe (the page history
 * preview). An iframe doesn't share the page's font faces, so without this
 * the preview falls back to system fonts. Read once and cached. */

let cached: string | null = null;

function absolutize(css: string, base: string): string {
  return css.replace(/url\((['"]?)([^'")]+)\1\)/g, (m, _q: string, u: string) => {
    try {
      return `url("${new URL(u, base).href}")`;
    } catch {
      return m;
    }
  });
}

function visit(rules: CSSRuleList, base: string, out: string[]): void {
  for (const r of Array.from(rules)) {
    if (typeof CSSFontFaceRule !== "undefined" && r instanceof CSSFontFaceRule) {
      out.push(absolutize(r.cssText, base));
    } else if (typeof CSSImportRule !== "undefined" && r instanceof CSSImportRule) {
      const sheet = r.styleSheet;
      if (sheet) visitSheet(sheet, out);
    } else if ("cssRules" in r) {
      // @layer, @media and @supports blocks.
      visit((r as CSSGroupingRule).cssRules, base, out);
    }
  }
}

function visitSheet(sheet: CSSStyleSheet, out: string[]): void {
  let rules: CSSRuleList;
  try {
    rules = sheet.cssRules;
  } catch {
    return; // a cross-origin sheet
  }
  visit(rules, sheet.href ?? document.baseURI, out);
}

export function documentFontFaceCss(): string {
  if (cached !== null) return cached;
  if (typeof document === "undefined") return "";
  const out: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) visitSheet(sheet, out);
  cached = out.join("\n");
  return cached;
}
