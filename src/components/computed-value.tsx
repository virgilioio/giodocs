import { formulaText, type FormulaResult } from "@/lib/property-formula";

/* Read-only values worked out for a row: a formula's result (its error in
 * words, faint, with the reason on hover) and a Unique ID. */

export function FormulaValueView({
  result,
  variant = "cell",
}: {
  result: FormulaResult | null;
  variant?: "cell" | "strip";
}) {
  const size = variant === "cell" ? "text-meta" : "";
  if (!result) return <span className="text-faint">—</span>;
  if (result.error)
    return (
      <span className={`truncate ${size} text-faint`} title={result.error}>
        {result.error}
      </span>
    );
  const text = formulaText(result.value);
  if (!text) return variant === "cell" ? <span className="text-faint">—</span> : <span className="text-whisper">Empty</span>;
  return (
    <span className={`truncate ${size} text-body ${typeof result.value === "number" ? "tnum" : ""}`}>
      {text}
    </span>
  );
}

export function UniqueIdView({ text, variant = "cell" }: { text: string; variant?: "cell" | "strip" }) {
  if (!text) return variant === "cell" ? <span className="text-faint">—</span> : <span className="text-whisper">Empty</span>;
  return <span className={`tnum truncate ${variant === "cell" ? "text-meta" : ""} text-muted`}>{text}</span>;
}
