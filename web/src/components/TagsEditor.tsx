import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import type { CustomCellEditorProps } from 'ag-grid-react';
import type { BacklogItem } from '../../../server/src/types';

type Props = CustomCellEditorProps<BacklogItem, string[]>;
interface EditorCtx { tagNames?: string[]; versionTags?: string[] }

const lc = (s: string) => s.trim().toLowerCase();
const has = (list: string[], t: string) => list.some((x) => lc(x) === lc(t));
const MAX_SUGGESTIONS = 8;

/**
 * Popup tag editor. Enter adds the typed (or highlighted) tag and keeps the editor open; Enter on an empty
 * input closes it. `,` / `;` also add, Backspace on an empty input removes the last tag, pasting "a; b" adds
 * both. Version tags are one-click toggles. Clicking elsewhere or Tab keeps the changes; Esc cancels them.
 */
const TagsEditor = forwardRef<unknown, Props>(function TagsEditor(props, ref) {
  // snapshot at open: props.value follows onValueChange in reactive editors
  const original = useRef<string[]>([...(props.value ?? [])]).current;
  const [tags, setTags] = useState<string[]>(original);
  const [draft, setDraft] = useState('');
  const [hi, setHi] = useState(-1);
  const tagsRef = useRef(tags);
  const draftRef = useRef('');
  const inputRef = useRef<HTMLInputElement>(null);
  const { tagNames = [], versionTags = [] } = (props.context as EditorCtx | undefined) ?? {};

  const commit = (next: string[]) => {
    tagsRef.current = next;
    setTags(next);
    props.onValueChange?.(next);
  };
  const setDraftText = (v: string) => {
    draftRef.current = v;
    setDraft(v);
    setHi(-1);
  };
  const add = (raw: string[]) => {
    let next = tagsRef.current;
    for (const r of raw) {
      const t = r.trim();
      if (t && !has(next, t)) next = [...next, t];
    }
    if (next !== tagsRef.current) commit(next);
    setDraftText('');
    inputRef.current?.focus();
  };
  const remove = (t: string) => {
    commit(tagsRef.current.filter((x) => x !== t));
    inputRef.current?.focus();
  };
  const toggle = (t: string) => (has(tagsRef.current, t) ? remove(tagsRef.current.find((x) => lc(x) === lc(t))!) : add([t]));

  const withDraft = () => {
    const t = draftRef.current.trim();
    return !t || has(tagsRef.current, t) ? tagsRef.current : [...tagsRef.current, t];
  };
  useImperativeHandle(ref, () => ({ getValue: () => withDraft(), isPopup: () => true }));

  const q = lc(draft);
  const suggestions = q
    ? tagNames
        .filter((t) => lc(t).includes(q) && !has(tags, t))
        .sort((a, b) => Number(!lc(a).startsWith(q)) - Number(!lc(b).startsWith(q)))
        .slice(0, MAX_SUGGESTIONS)
    : [];

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (hi >= 0 && suggestions[hi]) add([suggestions[hi]]);
      else if (draft.trim()) add([draft]);
      else props.stopEditing?.(); // empty input: done
    } else if (e.key === ',' || e.key === ';') {
      e.preventDefault();
      if (draft.trim()) add([draft]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHi((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHi((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Backspace' && draft === '' && tagsRef.current.length) {
      e.preventDefault();
      commit(tagsRef.current.slice(0, -1));
    }
  };

  return (
    <div className="tags-editor" onKeyDown={(e) => e.key !== 'Escape' && e.key !== 'Tab' && e.stopPropagation()}>
      <div className="chips tags-box" onMouseDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); inputRef.current?.focus(); } }}>
        {tags.map((t) => (
          <span key={t} className={'chip' + (has(original, t) ? '' : ' add')}>
            {t}
            <button type="button" aria-label={`remove ${t}`} tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => remove(t)}>
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          autoFocus
          className="tags-input"
          value={draft}
          placeholder={tags.length ? 'add tag…' : 'type a tag, Enter'}
          onChange={(e) => setDraftText(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            const text = e.clipboardData.getData('text');
            if (/[;,\n]/.test(text)) {
              e.preventDefault();
              add(text.split(/[;,\n]/));
            }
          }}
        />
      </div>
      {suggestions.length > 0 && (
        <div className="tag-suggest" role="listbox">
          {suggestions.map((s, i) => (
            <div
              key={s}
              role="option"
              aria-selected={i === hi}
              className={'comp-opt' + (i === hi ? ' cur' : '')}
              onMouseEnter={() => setHi(i)}
              onMouseDown={(e) => { e.preventDefault(); add([s]); }}
            >
              {s}
            </div>
          ))}
        </div>
      )}
      {versionTags.length > 0 && (
        <div className="tag-quick">
          <span className="muted">Versions:</span>
          {versionTags.map((v) => (
            <button
              key={v}
              type="button"
              tabIndex={-1}
              className={'chip toggle' + (has(tags, v) ? ' on' : '')}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => toggle(v)}
            >
              {v}
            </button>
          ))}
        </div>
      )}
      <div className="tag-foot">
        <span className="muted">Enter adds · Enter on empty closes · Esc cancels</span>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => props.stopEditing?.()}>
          Done
        </button>
      </div>
    </div>
  );
});

export default TagsEditor;
