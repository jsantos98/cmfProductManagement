// App theme (two candidate directions while João picks one). Applied as <html data-theme="…">.
import { useEffect, useState } from 'react';

export type ThemeId = 'b' | 'a';
export const THEMES: { id: ThemeId; name: string; hint: string }[] = [
  { id: 'b', name: 'Control room', hint: 'Navy shell, teal accent, dense (direction B)' },
  { id: 'a', name: 'Inbox', hint: 'Light shell, blue accent, calm (direction A)' },
];
const KEY = 'cmfpm.theme.v1';
const EVENT = 'cmfpm-theme';

export function getTheme(): ThemeId {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'a' || v === 'b') return v;
  } catch {
    /* storage blocked */
  }
  return 'b';
}

/** Applies the stored theme to <html>; call before the first render. */
export function applyTheme(t: ThemeId = getTheme()): void {
  document.documentElement.dataset.theme = t;
}

export function setTheme(t: ThemeId): void {
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* storage blocked */
  }
  applyTheme(t);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: t }));
}

/** Current theme, re-rendering when it changes. */
export function useTheme(): [ThemeId, (t: ThemeId) => void] {
  const [t, setT] = useState<ThemeId>(getTheme);
  useEffect(() => {
    const h = (e: Event) => setT((e as CustomEvent<ThemeId>).detail);
    window.addEventListener(EVENT, h);
    return () => window.removeEventListener(EVENT, h);
  }, []);
  return [t, setTheme];
}
