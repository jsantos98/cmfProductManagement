// Small shared UI building blocks of the redesigned app. Styling lives in styles.css (`ui-*` classes, theme tokens).
import type { CSSProperties, ReactNode } from 'react';

// ---- page header ------------------------------------------------------------------------------------------------

/** Page header band: kicker (area dot + name), title, meta line, and actions on the right. */
export function PageHeader({
  kicker,
  color,
  title,
  meta,
  tabs,
  children,
}: {
  /** small uppercase line above the title, e.g. the area name */
  kicker?: ReactNode;
  /** colour dot before the kicker (area colour) */
  color?: string;
  title: ReactNode;
  /** muted line after the title, e.g. "loaded 10:42" */
  meta?: ReactNode;
  /** optional segmented tabs shown after the title (e.g. Backlog | To validate) */
  tabs?: ReactNode;
  /** actions (buttons, switches) on the right */
  children?: ReactNode;
}) {
  return (
    <header className="ui-page-head">
      <div className="ui-page-head-title">
        {kicker && (
          <span className="ui-page-head-kicker">
            {color && <span className="dot" style={{ background: color }} />}
            {kicker}
          </span>
        )}
        <h1>{title}</h1>
      </div>
      {tabs}
      {meta && <span className="ui-page-head-meta">{meta}</span>}
      <div className="ui-page-head-actions">{children}</div>
    </header>
  );
}

/** Segmented tabs (links). */
export function Tabs({ items }: { items: { label: ReactNode; href: string; on: boolean; onClick?: (e: React.MouseEvent) => void }[] }) {
  return (
    <nav className="ui-tabs">
      {items.map((t) => (
        <a key={t.href} href={t.href} className={t.on ? 'on' : ''} aria-current={t.on ? 'page' : undefined} onClick={t.onClick}>
          {t.label}
        </a>
      ))}
    </nav>
  );
}

// ---- switch -----------------------------------------------------------------------------------------------------

export function Switch({ checked, onChange, label, title, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; title?: string; disabled?: boolean }) {
  return (
    <label className="ui-switch" title={title}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="ui-switch-track" aria-hidden />
      {label}
    </label>
  );
}

// ---- KPI tiles --------------------------------------------------------------------------------------------------

export function Tiles({ children }: { children: ReactNode }) {
  return <div className="ui-tiles">{children}</div>;
}
export function TilesSep() {
  return <span className="ui-tiles-sep" aria-hidden />;
}

/**
 * A KPI tile. With `onClick` it is a toggle button (`active` = pressed); without, a static tile.
 * `color` paints the left accent bar (e.g. a band colour); `tone` colours the value.
 */
export function Tile({
  label,
  value,
  sub,
  active,
  onClick,
  color,
  tone,
  title,
  compact,
  icon,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  active?: boolean;
  onClick?: () => void;
  color?: string;
  tone?: 'warn' | 'bad' | 'ok';
  title?: string;
  compact?: boolean;
  icon?: ReactNode;
}) {
  const cls = 'ui-tile' + (active ? ' active' : '') + (tone ? ' tone-' + tone : '') + (compact ? ' compact' : '');
  const style = color ? ({ '--tile-color': color } as CSSProperties) : undefined;
  const body = (
    <>
      <span className="ui-tile-label">
        {icon}
        {label}
      </span>
      <span className="ui-tile-value">{value}</span>
      {sub !== undefined && sub !== null && sub !== '' && <span className="ui-tile-sub">{sub}</span>}
    </>
  );
  return onClick ? (
    <button type="button" className={cls} style={style} onClick={onClick} aria-pressed={!!active} title={title}>
      {body}
    </button>
  ) : (
    <div className={cls} style={style} title={title}>
      {body}
    </div>
  );
}

// ---- filter bar -------------------------------------------------------------------------------------------------

export interface FilterChip {
  key: string;
  label: ReactNode;
  onClear: () => void;
}

/** Search box, active-filter chips (each removable, plus "clear all"), then page controls (children). */
export function FilterBar({
  search,
  onSearch,
  placeholder = 'Search…',
  chips = [],
  onClearAll,
  children,
}: {
  search: string;
  onSearch: (v: string) => void;
  placeholder?: string;
  chips?: FilterChip[];
  onClearAll?: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="ui-filterbar">
      <span className="ui-search">
        <input type="search" placeholder={placeholder} value={search} onChange={(e) => onSearch(e.target.value)} aria-label="Search" />
      </span>
      {chips.length > 0 && (
        <span className="ui-fchips">
          {chips.map((c) => (
            <span key={c.key} className="ui-fchip">
              {c.label}
              <button type="button" onClick={c.onClear} aria-label="Remove filter" title="Remove filter">
                ✕
              </button>
            </span>
          ))}
          {onClearAll && chips.length > 1 && (
            <button type="button" className="link-btn" onClick={onClearAll}>
              clear all
            </button>
          )}
        </span>
      )}
      <span className="grow" />
      {children}
    </div>
  );
}

// ---- action bars ------------------------------------------------------------------------------------------------

/** Floating bar shown while rows are selected. */
export function SelectionBar({ count, onClear, children }: { count: number; onClear?: () => void; children: ReactNode }) {
  if (count <= 0) return null;
  return (
    <div className="ui-selectionbar" role="toolbar" aria-label="Selection actions">
      <b>{count} selected</b>
      <span className="sep" />
      {children}
      {onClear && (
        <button type="button" className="ui-close" onClick={onClear} title="Clear selection" aria-label="Clear selection">
          ✕
        </button>
      )}
    </div>
  );
}

/** Sticky bar shown while edits are pending. */
export function PendingBar({
  count,
  busy,
  onApply,
  onReview,
  onDiscard,
}: {
  count: number;
  busy?: boolean;
  onApply: () => void;
  onReview: () => void;
  onDiscard: () => void;
}) {
  if (count <= 0) return null;
  return (
    <div className="ui-pendingbar" role="region" aria-label="Pending changes">
      <b>
        {count} item{count === 1 ? '' : 's'} with pending edits
      </b>
      <span className="muted">Nothing is written to TFS until you apply.</span>
      <span className="grow" />
      <button type="button" onClick={onReview} disabled={busy} title="List pending changes; dry run">
        Review
      </button>
      <button type="button" onClick={onDiscard} disabled={busy}>
        Discard
      </button>
      <button type="button" className="primary" onClick={onApply} disabled={busy} title="Write all pending changes to TFS now">
        {busy ? 'Applying…' : `Apply (${count})`}
      </button>
    </div>
  );
}

// ---- states -----------------------------------------------------------------------------------------------------

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="ui-empty">
      {icon && <div className="ui-empty-icon">{icon}</div>}
      <div className="ui-empty-title">{title}</div>
      {children && <div>{children}</div>}
    </div>
  );
}

export function Skeleton({ width = '100%', height = 12, style }: { width?: number | string; height?: number; style?: CSSProperties }) {
  return <span className="ui-skel" style={{ width, height, ...style }} aria-hidden />;
}

/** "HH:MM" of an ISO date or epoch ms ('' when unknown). */
export const hhmm = (v: string | number | null | undefined) => {
  if (v === null || v === undefined || v === '' || v === 0) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
};
