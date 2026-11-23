import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { CustomCellEditorProps } from 'ag-grid-react';
import type { BacklogItem, ComponentRule } from '../../../server/src/types';
import { componentNames } from '../../../server/src/shared/component';

type Props = CustomCellEditorProps<BacklogItem, string>;
const NONE = '(none)';
const lc = (s: string) => s.trim().toLowerCase();

/**
 * Popup editor for the Component column: pick a known component, "(none)", or type a new one.
 * The value is a component name ('' = none); the column's valueSetter turns it into tag changes.
 */
const ComponentEditor = forwardRef<unknown, Props>(function ComponentEditor(props, ref) {
  const rules = ((props.context as { componentRules?: ComponentRule[] } | undefined)?.componentRules ?? []);
  const names = useMemo(() => componentNames(rules), [rules]);
  const current = props.value && props.value !== 'Unknown' ? props.value : '';
  const [draft, setDraft] = useState('');
  const [cursor, setCursor] = useState(0);
  const chosen = useRef<string | null>(null);

  const q = lc(draft);
  const options = [NONE, ...names].filter((n) => !q || lc(n).includes(q));
  const isNew = !!q && !names.some((n) => lc(n) === q) && q !== lc(NONE);
  const rows = isNew ? [...options, `+ New component "${draft.trim()}"`] : options;

  useImperativeHandle(ref, () => ({
    getValue: () => (chosen.current === null ? props.value : chosen.current),
    isPopup: () => true,
  }));

  const pick = (i: number) => {
    if (i < 0 || i >= rows.length) return;
    const label = rows[i];
    chosen.current = isNew && i === rows.length - 1 ? draft.trim() : label === NONE ? '' : label;
    props.onValueChange?.(chosen.current);
    props.stopEditing?.();
  };

  return (
    <div
      className="tags-editor comp-editor"
      onKeyDown={(e) => {
        if (e.key === 'Escape') return; // let the grid cancel
        e.stopPropagation();
        if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, rows.length - 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
        else if (e.key === 'Enter') { e.preventDefault(); pick(cursor); }
      }}
    >
      <input
        autoFocus
        value={draft}
        placeholder="filter or type a new component"
        onChange={(e) => { setDraft(e.target.value); setCursor(0); }}
      />
      <div className="comp-list" role="listbox">
        {rows.map((n, i) => {
          const isCur = n === NONE ? !current : lc(n) === lc(current);
          return (
            <div
              key={n}
              role="option"
              aria-selected={i === cursor}
              className={'comp-opt' + (i === cursor ? ' cur' : '') + (isCur ? ' on' : '') + (n === NONE ? ' muted' : '')}
              onMouseEnter={() => setCursor(i)}
              onMouseDown={(e) => { e.preventDefault(); pick(i); }}
            >
              {isCur ? '✓ ' : ''}{n}
            </div>
          );
        })}
      </div>
      <div className="muted comp-hint">Sets the component tag; tags naming another component are removed.</div>
    </div>
  );
});

export default ComponentEditor;
