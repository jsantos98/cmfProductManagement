import { useEffect, useState } from 'react';

export type ToastKind = 'ok' | 'info' | 'warn';
export interface Toast { id: number; kind: ToastKind; title: string; text?: string; onClick?: () => void; ms?: number }

/** Tiny global notification bus: `toast(...)` from anywhere, `<ToastHost />` rendered once in App. */
let seq = 0;
let listeners: ((t: Toast) => void)[] = [];

export function toast(kind: ToastKind, title: string, text?: string, opts?: { onClick?: () => void; ms?: number }): void {
  const t: Toast = { id: ++seq, kind, title, text, onClick: opts?.onClick, ms: opts?.ms };
  listeners.forEach((l) => l(t));
}

const LIFETIME_MS = 6000;

export function ToastHost() {
  const [list, setList] = useState<Toast[]>([]);

  useEffect(() => {
    const add = (t: Toast) => {
      setList((l) => [...l, t]);
      window.setTimeout(() => setList((l) => l.filter((x) => x.id !== t.id)), t.ms ?? LIFETIME_MS);
    };
    listeners.push(add);
    return () => {
      listeners = listeners.filter((l) => l !== add);
    };
  }, []);

  const close = (id: number) => setList((l) => l.filter((x) => x.id !== id));

  return (
    <div className="toasts" aria-live="polite">
      {list.map((t) => (
        <div
          key={t.id}
          className={'toast ' + t.kind}
          title={t.onClick ? 'Click to filter' : 'Click to dismiss'}
          onClick={() => {
            close(t.id);
            t.onClick?.();
          }}
        >
          <b>{t.title}</b>
          {t.text && <div className="toast-text">{t.text}</div>}
        </div>
      ))}
    </div>
  );
}
