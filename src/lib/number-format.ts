/* How a number property shows its values (property_defs.config, checked by
 * guard_property_config): plain, with thousands separators, as a percent
 * (the number as typed, then %), or as money in a currency, with an
 * optional fixed number of decimals. Stored values never change. */

export type NumberFormatKind = "number" | "comma" | "percent" | "currency";
export const CURRENCIES = ["USD", "MXN", "EUR", "GBP", "CAD", "BRL", "COP"] as const;
export type Currency = (typeof CURRENCIES)[number];
export type NumberFormat = { format?: NumberFormatKind; decimals?: number; currency?: Currency };

export const FORMAT_LABELS: Record<NumberFormatKind, string> = {
  number: "Number",
  comma: "Number with commas",
  percent: "Percent",
  currency: "Currency",
};

export const CURRENCY_LABELS: Record<Currency, string> = {
  USD: "US dollar",
  MXN: "Mexican peso",
  EUR: "Euro",
  GBP: "British pound",
  CAD: "Canadian dollar",
  BRL: "Brazilian real",
  COP: "Colombian peso",
};

/** Reads a number property's config defensively. */
export function readNumberFormat(config: unknown): NumberFormat {
  if (!config || typeof config !== "object" || Array.isArray(config)) return {};
  const c = config as Record<string, unknown>;
  const out: NumberFormat = {};
  if (c.format === "number" || c.format === "comma" || c.format === "percent" || c.format === "currency")
    out.format = c.format;
  if (typeof c.decimals === "number" && Number.isInteger(c.decimals) && c.decimals >= 0 && c.decimals <= 6)
    out.decimals = c.decimals;
  if (typeof c.currency === "string" && (CURRENCIES as readonly string[]).includes(c.currency))
    out.currency = c.currency as Currency;
  return out;
}

/** A number as its property shows it. */
export function formatNumber(n: number, f: NumberFormat = {}): string {
  if (!Number.isFinite(n)) return "";
  const kind = f.format ?? "number";
  const fixed = f.decimals !== undefined ? { minimumFractionDigits: f.decimals, maximumFractionDigits: f.decimals } : {};
  switch (kind) {
    case "comma":
      return new Intl.NumberFormat("en-US", { maximumFractionDigits: 6, ...fixed }).format(n);
    case "percent":
      return `${new Intl.NumberFormat("en-US", { useGrouping: false, maximumFractionDigits: 6, ...fixed }).format(n)}%`;
    case "currency":
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: f.currency ?? "USD",
        currencyDisplay: f.currency && f.currency !== "USD" ? "code" : "symbol",
        ...fixed,
      }).format(n);
    default:
      return f.decimals !== undefined ? n.toFixed(f.decimals) : String(n);
  }
}
