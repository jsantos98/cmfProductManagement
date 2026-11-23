import { useEffect, useMemo, useState } from 'react';
import { useGridFilter, type CustomFilterProps } from 'ag-grid-react';

/**
 * Single-value columns: `values` = the checked values (null model = all).
 * `multi` columns (e.g. tags): `exclude` = unchecked keys (lower case) — a row with ANY of them is hidden,
 * so tags that appear later are visible by default; `with` = only rows that have this key ("only" link).
 */
export interface CheckboxModel { values?: string[]; exclude?: string[]; with?: string }

/** Extra params (colDef.filterParams). */
export interface CheckboxFilterParams {
  /** fixed order of known values (shown first, in this order); the rest follow ascending */
  order?: () => string[];
  /** colour swatch per value */
  colorOf?: (value: string) => string | undefined;
  /** the cell value is a string[] (e.g. tags): unchecking a value hides every row that has it; case-insensitive */
  multi?: boolean;
  /** multi only: values unchecked by default (a "defaults" link restores them) */
  defaults?: () => string[];
  /** multi only: hint under the header (default "unchecked tags hide their rows") */
  note?: string;
}

/** Multi-mode model that unchecks `tags` (null when empty = no filter). */
export function excludeModel(tags: string[]): CheckboxModel | null {
  const exclude = [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
  return exclude.length ? { exclude } : null;
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
const SEARCH_FROM = 12; // show the search box when the list is longer than this

/** Excel-like checkbox list (AG Grid Community has no set filter). */
export default function CheckboxFilter(props: CustomFilterProps<any, any, CheckboxModel> & CheckboxFilterParams) {
  const { model, onModelChange, getValue, api, order, colorOf, multi, defaults, note } = props;
  const selected = model?.values;
  const selectedSet = useMemo(() => (selected ? new Set(selected) : null), [selected]);
  const excluded = useMemo(() => new Set(model?.exclude ?? []), [model]);
  const req = multi ? model?.with : undefined;
  const [q, setQ] = useState('');

  const keyOf = (v: string) => (multi ? v.toLowerCase() : v);
  const valuesOf = (node: Parameters<typeof getValue>[0]): string[] => {
    const raw = getValue(node);
    if (!multi) return [String(raw ?? '')];
    const arr = Array.isArray(raw) ? raw.map((x) => String(x).trim()).filter(Boolean) : [];
    return arr.length ? arr : [''];
  };

  useGridFilter({
    doesFilterPass: ({ node }) => {
      if (!multi) return !selectedSet || selectedSet.has(valuesOf(node)[0]);
      const keys = valuesOf(node).map(keyOf);
      return !keys.some((k) => excluded.has(k)) && (!req || keys.includes(req));
    },
    getModelAsString: () => {
      if (!model) return '';
      if (!multi) return (selected ?? []).join(', ');
      return [req && `with ${req}`, excluded.size && `without ${[...excluded].join(', ')}`].filter(Boolean).join('; ');
    },
  });

  // When the model is set from outside (metric cards, clear filters) the grid filters before this
  // component re-renders with the new doesFilterPass; re-run filtering once the new model is in place.
  useEffect(() => {
    api.onFilterChanged();
  }, [api, model]);

  // recomputed on every render; cheap enough and always reflects current (effective) values
  const entries = useMemo(() => {
    const counts = new Map<string, { label: string; n: number }>();
    api.forEachNode((n) => {
      for (const v of valuesOf(n)) {
        const k = keyOf(v);
        const e = counts.get(k);
        if (e) e.n++;
        else counts.set(k, { label: v, n: 1 });
      }
    });
    const known = (order?.() ?? []).map(keyOf).filter((k) => counts.has(k));
    const rest = [...counts.keys()]
      .filter((k) => !known.includes(k))
      .sort((a, b) => (a === '' ? 1 : b === '' ? -1 : collator.compare(counts.get(a)!.label, counts.get(b)!.label)));
    return [...known, ...rest].map((k) => ({ k, ...counts.get(k)! }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, getValue, order, model, multi]);

  const all = entries.map((e) => e.k);
  const needle = q.trim().toLowerCase();
  const visible = needle ? entries.filter((e) => e.label.toLowerCase().includes(needle)) : entries;
  const visKeys = visible.map((e) => e.k);
  const empty = multi ? '(no tags)' : '(empty)';
  const labelOf = (k: string) => entries.find((e) => e.k === k)?.label || (k === '' ? empty : k);

  // --- single-value: model = checked values ---
  const setChecked = (keys: string[]) => onModelChange(keys.length === all.length ? null : { values: keys });
  const cur = () => selected ?? all;
  // --- multi: model = unchecked (excluded) keys + optional "with" ---
  const setExcluded = (keys: string[], w = req) =>
    onModelChange(keys.length || w ? { exclude: keys, ...(w ? { with: w } : {}) } : null);

  const checked = (k: string) => (multi ? !excluded.has(k) : !selectedSet || selectedSet.has(k));
  const toggle = (k: string) => {
    if (multi) return setExcluded(excluded.has(k) ? [...excluded].filter((x) => x !== k) : [...excluded, k]);
    setChecked(cur().includes(k) ? cur().filter((x) => x !== k) : [...cur(), k]);
  };
  const selectAll = () => {
    if (multi) return needle ? setExcluded([...excluded].filter((k) => !visKeys.includes(k))) : onModelChange(null);
    needle ? setChecked([...new Set([...cur(), ...visKeys])]) : onModelChange(null);
  };
  const selectNone = () => {
    if (multi) return setExcluded(needle ? [...new Set([...excluded, ...visKeys])] : all);
    if (!needle) return onModelChange({ values: [] });
    setChecked(cur().filter((k) => !visKeys.includes(k)));
  };
  const only = (k: string) => (multi ? onModelChange({ exclude: [], with: k }) : setChecked([k]));

  return (
    <div className="cbf">
      {entries.length > SEARCH_FROM && (
        <input className="cbf-search" type="search" placeholder="search…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      )}
      <div className="cbf-head">
        <button className="link-btn" onClick={selectAll}>Select all</button>
        <button className="link-btn" onClick={selectNone}>none</button>
        {multi && !!defaults?.().length && (
          <button className="link-btn" title={`Uncheck the default hidden tags: ${defaults().join(', ')}`} onClick={() => onModelChange(excludeModel(defaults()))}>
            defaults
          </button>
        )}
        {multi && <span className="muted cbf-note">{note ?? 'unchecked tags hide their rows'}</span>}
      </div>
      {req !== undefined && (
        <div className="cbf-with">
          Only rows with <b>{labelOf(req)}</b>
          <button className="link-btn" title="Remove this condition" onClick={() => setExcluded([...excluded], '')}>
            ✕
          </button>
        </div>
      )}
      {visible.map(({ k, label, n }) => (
        <label key={k} className="cbf-row">
          <input type="checkbox" checked={checked(k)} onChange={() => toggle(k)} />
          {colorOf && <span className="dot" style={{ background: colorOf(label) ?? '#9e9e9e' }} />}
          <span className="cbf-label">{label || empty}</span>
          <button
            className="link-btn cbf-only"
            title={multi ? 'Show only rows with this tag' : 'Show only this'}
            onClick={(e) => {
              e.preventDefault();
              only(k);
            }}
          >
            only
          </button>
          <span className="muted">{n}</span>
        </label>
      ))}
      {visible.length === 0 && <span className="muted">no match</span>}
    </div>
  );
}
