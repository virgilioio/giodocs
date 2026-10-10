/* Code block languages offered in the picker (src/components/code-lang-picker.tsx). */

export const CODE_LANGS: Array<{ value: string; label: string }> = [
  { value: "", label: "Plain text" },
  { value: "mermaid", label: "Mermaid" },
  { value: "bash", label: "Bash" },
  { value: "css", label: "CSS" },
  { value: "html", label: "HTML" },
  { value: "javascript", label: "JavaScript" },
  { value: "json", label: "JSON" },
  { value: "markdown", label: "Markdown" },
  { value: "python", label: "Python" },
  { value: "sql", label: "SQL" },
  { value: "typescript", label: "TypeScript" },
  { value: "yaml", label: "YAML" },
];

export function langLabel(lang: string): string {
  const hit = CODE_LANGS.find((l) => l.value === lang.toLowerCase());
  return hit ? hit.label : lang;
}
