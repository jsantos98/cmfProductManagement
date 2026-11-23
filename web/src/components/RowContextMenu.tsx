import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export type MenuItem = { kind: 'item'; label: string; hint?: string; color?: string; checked?: boolean; disabled?: boolean; onSelect: () => void };
export type MenuEntry =
  | { kind: 'sep' }
  | MenuItem
  | { kind: 'sub'; label: string; disabled?: boolean; children: MenuItem[] };

interface Props {
  x: number;
  y: number;
  header: string;
  entries: MenuEntry[];
  onClose: () => void;
}

const isActive = (e: MenuEntry | undefined) => !!e && e.kind !== 'sep' && !e.disabled;

/**
 * Small custom context menu (AG Grid Community has none). Positioned at the mouse, clamped to the viewport.
 * One level of submenus ('sub'): hover, click, → or Enter opens it; ← or Esc goes back.
 */
export default function RowContextMenu({ x, y, header, entries, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [pos, setPos] = useState({ left: x, top: y });
  const enabled = entries.map((e, i) => (isActive(e) ? i : -1)).filter((i) => i >= 0);
  const [cur, setCur] = useState<number>(enabled[0] ?? -1);
  const [open, setOpen] = useState<number | null>(null); // index of the open submenu
  const [subCur, setSubCur] = useState(-1); // highlighted child; -1 = focus is in the main menu
  const [subPos, setSubPos] = useState<{ left: number; top: number } | null>(null);
  const prevFocus = useRef<Element | null>(document.activeElement);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)),
    });
    el.focus({ preventScroll: true });
  }, [x, y]);

  // place the open submenu next to its parent item, flipping left / up when it would not fit
  useLayoutEffect(() => {
    if (open === null) return setSubPos(null);
    const item = itemRefs.current[open];
    const sub = subRef.current;
    if (!item || !sub) return;
    const ir = item.getBoundingClientRect();
    const sr = sub.getBoundingClientRect();
    const right = ir.right - 2;
    const left = right + sr.width + 4 <= window.innerWidth ? right : Math.max(4, ir.left - sr.width + 2);
    const top = Math.max(4, Math.min(ir.top - 5, window.innerHeight - sr.height - 4));
    setSubPos({ left, top });
  }, [open, pos]);

  useEffect(() => {
    const inside = (e: Event) => !!ref.current?.contains(e.target as Node);
    const down = (e: Event) => {
      if (!inside(e)) onClose();
    };
    const close = (e: Event) => {
      if (!inside(e)) onClose(); // scrolling a long submenu must not close the menu
    };
    const blur = () => onClose();
    document.addEventListener('mousedown', down, true);
    document.addEventListener('contextmenu', down, true);
    window.addEventListener('scroll', close, true);
    window.addEventListener('wheel', close, true);
    window.addEventListener('blur', blur);
    window.addEventListener('resize', blur);
    return () => {
      document.removeEventListener('mousedown', down, true);
      document.removeEventListener('contextmenu', down, true);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('wheel', close, true);
      window.removeEventListener('blur', blur);
      window.removeEventListener('resize', blur);
      const p = prevFocus.current;
      if (p instanceof HTMLElement && document.contains(p)) p.focus({ preventScroll: true });
    };
  }, [onClose]);

  const choose = (e: MenuItem) => {
    if (e.disabled) return;
    onClose();
    e.onSelect();
  };
  const openSub = (i: number, focusFirst: boolean) => {
    const e = entries[i];
    if (e?.kind !== 'sub' || e.disabled) return;
    setOpen(i);
    setSubCur(focusFirst ? e.children.findIndex((c) => !c.disabled) : -1);
  };

  const subEntry = open !== null && entries[open]?.kind === 'sub' ? (entries[open] as Extract<MenuEntry, { kind: 'sub' }>) : null;
  const subEnabled = subEntry ? subEntry.children.map((c, i) => (c.disabled ? -1 : i)).filter((i) => i >= 0) : [];

  // keep the highlighted child visible while moving with the keyboard
  useEffect(() => {
    if (subCur < 0) return;
    subRef.current?.querySelector<HTMLElement>(`[data-i="${subCur}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [subCur]);

  const onKeyDown = (ev: React.KeyboardEvent) => {
    const k = ev.key;
    if (!['Escape', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(k)) return;
    ev.preventDefault();
    ev.stopPropagation();
    const inSub = subEntry && subCur >= 0;
    if (k === 'Escape' || (k === 'ArrowLeft' && inSub)) {
      if (subEntry) { setOpen(null); setSubCur(-1); } else onClose();
    } else if (k === 'ArrowDown' || k === 'ArrowUp') {
      const list = inSub ? subEnabled : enabled;
      if (!list.length) return;
      const d = k === 'ArrowDown' ? 1 : -1;
      if (inSub) setSubCur(list[(list.indexOf(subCur) + d + list.length) % list.length]);
      else { setOpen(null); setCur(list[(list.indexOf(cur) + d + list.length) % list.length]); }
    } else if (k === 'ArrowRight') {
      if (!inSub && cur >= 0) openSub(cur, true);
    } else if (k === 'Enter') {
      if (inSub) choose(subEntry!.children[subCur]);
      else if (cur >= 0) {
        const e = entries[cur];
        if (e.kind === 'sub') openSub(cur, true);
        else if (e.kind === 'item') choose(e);
      }
    }
  };

  const itemBody = (e: MenuItem | Extract<MenuEntry, { kind: 'sub' }>) => (
    <>
      {e.kind === 'item' && e.color && <span className="dot" style={{ background: e.color }} />}
      {e.kind === 'item' && e.checked !== undefined && <span className="ctx-check">{e.checked ? '✓' : ''}</span>}
      <span className="ctx-label">{e.label}</span>
      {e.kind === 'item' && e.hint && <span className="ctx-hint">{e.hint}</span>}
      {e.kind === 'sub' && <span className="ctx-arrow">▸</span>}
    </>
  );

  return (
    <div
      ref={ref}
      className="ctx-menu"
      role="menu"
      tabIndex={-1}
      style={{ left: pos.left, top: pos.top }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="ctx-head" title={header}>
        {header}
      </div>
      {entries.map((e, i) =>
        e.kind === 'sep' ? (
          <div key={i} className="ctx-sep" />
        ) : (
          <div
            key={i}
            ref={(el) => { itemRefs.current[i] = el; }}
            role="menuitem"
            aria-haspopup={e.kind === 'sub' || undefined}
            aria-expanded={e.kind === 'sub' ? open === i : undefined}
            aria-disabled={e.disabled || undefined}
            className={'ctx-item' + (e.disabled ? ' disabled' : '') + (i === cur ? ' cur' : '')}
            onMouseEnter={() => {
              if (e.disabled) return;
              setCur(i);
              if (e.kind === 'sub') openSub(i, false);
              else { setOpen(null); setSubCur(-1); }
            }}
            onClick={() => (e.kind === 'sub' ? openSub(i, false) : choose(e))}
          >
            {itemBody(e)}
          </div>
        ),
      )}
      {subEntry && (
        <div
          ref={subRef}
          className="ctx-menu ctx-sub"
          role="menu"
          style={{ left: subPos?.left ?? -9999, top: subPos?.top ?? -9999 }}
        >
          {subEntry.children.length === 0 && <div className="ctx-item disabled">(none)</div>}
          {subEntry.children.map((c, j) => (
            <div
              key={j}
              data-i={j}
              role="menuitem"
              aria-disabled={c.disabled || undefined}
              className={'ctx-item' + (c.disabled ? ' disabled' : '') + (j === subCur ? ' cur' : '')}
              onMouseEnter={() => !c.disabled && setSubCur(j)}
              onClick={() => choose(c)}
              title={c.label}
            >
              {itemBody(c)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
