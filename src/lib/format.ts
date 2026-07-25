import { usePrefs, type DateFormatMode } from "./preferences";

function relative(iso: string): string {
  const now = Date.now();
  const t = new Date(iso).getTime();
  const s = Math.max(1, Math.floor((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

const absoluteFmt = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function absolute(iso: string): string {
  return absoluteFmt.format(new Date(iso));
}

export function formatTimestamp(iso: string, mode: DateFormatMode): string {
  return mode === "absolute" ? absolute(iso) : relative(iso);
}

export function useFormatDate(): (iso: string) => string {
  const { prefs } = usePrefs();
  return (iso: string) => formatTimestamp(iso, prefs.dateFormat);
}
