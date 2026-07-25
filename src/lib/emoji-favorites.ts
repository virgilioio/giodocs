import { useEffect, useState } from "react";

const KEY = "gio.emoji.favorites";
const EVT = "gio.emoji.favorites.changed";

export function readFavorites(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeFavorites(next: string[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(EVT));
}

export function addFavorite(emoji: string) {
  const cur = readFavorites();
  if (cur.includes(emoji)) return;
  writeFavorites([emoji, ...cur]);
}

export function removeFavorite(emoji: string) {
  writeFavorites(readFavorites().filter((e) => e !== emoji));
}

export function useEmojiFavorites(): string[] {
  const [list, setList] = useState<string[]>(() => readFavorites());
  useEffect(() => {
    const onChange = () => setList(readFavorites());
    window.addEventListener(EVT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(EVT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);
  return list;
}
