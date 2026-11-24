import { Fragment, useEffect, useRef, useState } from 'react';
import type { BacklogDef, Band, SettingsDto } from '../../../server/src/types';
import { api } from '../api';

interface Props {
  onSaved: () => void | Promise<void>;
}

const FIELDS: { ref: string; label: string }[] = [
  { ref: 'Custom.BusinessOrder', label: 'BusinessOrder' },
  { ref: 'System.Title', label: 'Title' },
  { ref: 'System.State', label: 'State' },
  { ref: 'System.IterationPath', label: 'Iteration path' },
  { ref: 'System.Tags', label: 'Tags' },
];

/** Editing row: the BacklogDef plus UI-only state (stripped before saving). */
interface BacklogRow extends BacklogDef {
  _key: number;
  _isNew: boolean;      // not yet saved: id follows the name until the user edits it
  _idTouched: boolean;
  _wiqlOpen: boolean;
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const csv =(s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

function move<T>(list: T[], i: number, d: -1 | 1): T[] {
  const j = i + d;
  if (j < 0 || j >= list.length) return list;
  const n = [...list];
  [n[i], n[j]] = [n[j], n[i]];
  return n;
}
const patch = <T,>(list: T[], i: number, p: Partial<T>): T[] => list.map((x, k) => (k === i ? { ...x, ...p } : x));

function RowButtons({ i, len, onMove, onDel }: { i: number; len: number; onMove: (d: -1 | 1) => void; onDel: () => void }) {
  return (
    <td className="row-btns">
      <button disabled={i === 0} onClick={() => onMove(-1)} title="up">↑</button>
      <button disabled={i === len - 1} onClick={() => onMove(1)} title="down">↓</button>
      <button onClick={onDel} title="remove">✕</button>
    </td>
  );
}

function RuleTable<K extends 'component' | 'version'>({
  title,
  valueKey,
  valueLabel,
  rows,
  onChange,
}: {
  title: string;
  valueKey: K;
  valueLabel: string;
  rows: ({ match: string } & Record<K, string>)[];
  onChange: (r: ({ match: string } & Record<K, string>)[]) => void;
}) {
  return (
    <section>
      <h3>{title}</h3>
      <p className="muted">First match wins (case-insensitive substring of the tags string); order matters.</p>
      <table className="form-table">
        <thead>
          <tr><th>Match</th><th>{valueLabel}</th><th /></tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td><input value={r.match} onChange={(e) => onChange(patch(rows, i, { match: e.target.value } as never))} /></td>
              <td><input value={r[valueKey]} onChange={(e) => onChange(patch(rows, i, { [valueKey]: e.target.value } as never))} /></td>
              <RowButtons i={i} len={rows.length} onMove={(d) => onChange(move(rows, i, d))} onDel={() => onChange(rows.filter((_, k) => k !== i))} />
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={() => onChange([...rows, { match: '', [valueKey]: '' } as never])}>+ Add rule</button>
    </section>
  );
}

function ReasonTable({
  title,
  hint,
  map,
  onChange,
}: {
  title: string;
  hint: string;
  map: Record<string, string>;
  onChange: (m: Record<string, string>) => void;
}) {
  const rows = Object.entries(map);
  const commit = (r: [string, string][]) => onChange(Object.fromEntries(r));
  return (
    <div>
      <h4>{title}</h4>
      <p className="muted">{hint}</p>
      <table className="form-table">
        <thead>
          <tr><th>Work item type</th><th>Reason</th><th /></tr>
        </thead>
        <tbody>
          {rows.map(([t, r], i) => (
            <tr key={i}>
              <td><input value={t} onChange={(e) => commit(rows.map((x, k) => (k === i ? [e.target.value, r] : x)) as [string, string][])} /></td>
              <td><input value={r} onChange={(e) => commit(rows.map((x, k) => (k === i ? [t, e.target.value] : x)) as [string, string][])} /></td>
              <td className="row-btns"><button onClick={() => commit(rows.filter((_, k) => k !== i))} title="remove">✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={() => commit([...rows, ['', '']])}>+ Add type</button>
    </div>
  );
}

export default function SettingsPage({ onSaved }: Props) {
  const [s, setS] = useState<SettingsDto | null>(null);
  const [versionTagsText, setVT] = useState('');
  const [statesText, setST] = useState('');
  const [hiddenTagsText, setHT] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<BacklogRow[]>([]);
  const keySeq = useRef(0);

  const load = async () => {
    try {
      const d = await api.getSettings();
      setS(d);
      setRows(d.backlogs.map((b) => ({ ...b, _key: keySeq.current++, _isNew: false, _idTouched: true, _wiqlOpen: !!b.wiql?.trim() })));
      setVT(d.versionTags.join(', '));
      setST(d.stateOptions.join(', '));
      setHT((d.hiddenTags ?? []).join(', '));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => {
    void load();
  }, []);

  if (!s) return <div className="page settings">{error ? <div className="banner error">{error}</div> : 'Loading…'}</div>;

  const set = (p: Partial<SettingsDto>) => setS({ ...s, ...p });

  const save = async () => {
    setBusy(true);
    setMsg(null);
    setError(null);
    const backlogs: BacklogDef[] = rows.map(({ _key, _isNew, _idTouched, _wiqlOpen, ...b }) => {
      const wiql = b.wiql?.trim();
      return { id: b.id, name: b.name, color: b.color, areaPath: b.areaPath, ...(wiql ? { wiql } : {}), ...(b.hidden ? { hidden: true } : {}) };
    });
    const dto: SettingsDto = { ...s, backlogs, versionTags: csv(versionTagsText), stateOptions: csv(statesText), hiddenTags: csv(hiddenTagsText) };
    try {
      await api.putSettings(dto);
      await load();
      setMsg('Saved. The backlogs will reload.');
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const setVal = (p: Partial<SettingsDto['validation']>) => set({ validation: { ...s.validation, ...p } });

  const bands = s.bands;
  const setBands = (b: Band[]) => set({ bands: b });

  return (
    <div className="page settings">
      <div className="settings-head">
        <h2>Settings</h2>
        <button className="primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        <button disabled={busy} onClick={() => void load()}>Reload</button>
        {msg && <span className="badge ok">{msg}</span>}
      </div>
      {error && <div className="banner error">{error}</div>}

      <section>
        <h3>Backlogs (tabs)</h3>
        <p className="muted">One tab per backlog, in this order. Hidden backlogs keep their data but show no tab. Leave Custom WIQL blank to use the template below.</p>
        <table className="form-table backlog-table">
          <thead>
            <tr><th>Show</th><th>Name</th><th>Colour</th><th>Area path</th><th>Id</th><th>Custom WIQL</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <Fragment key={r._key}>
                <tr>
                  <td><input type="checkbox" checked={!r.hidden} onChange={(e) => setRows(patch(rows, i, { hidden: !e.target.checked }))} /></td>
                  <td>
                    <input
                      value={r.name}
                      onChange={(e) => setRows(patch(rows, i, { name: e.target.value, ...(r._isNew && !r._idTouched ? { id: slugify(e.target.value) } : {}) }))}
                    />
                  </td>
                  <td><input type="color" value={/^#[0-9a-f]{6}$/i.test(r.color) ? r.color : '#999999'} onChange={(e) => setRows(patch(rows, i, { color: e.target.value }))} /></td>
                  <td><input value={r.areaPath} onChange={(e) => setRows(patch(rows, i, { areaPath: e.target.value }))} /></td>
                  <td className="id-cell">
                    <input
                      value={r.id}
                      readOnly={!r._isNew}
                      title={r._isNew ? 'Used in URLs; lowercase letters, digits and dashes' : 'Fixed once saved'}
                      onChange={(e) => setRows(patch(rows, i, { id: e.target.value, _idTouched: true }))}
                    />
                  </td>
                  <td>
                    <label className="inline check">
                      <input type="checkbox" checked={r._wiqlOpen} onChange={(e) => setRows(patch(rows, i, { _wiqlOpen: e.target.checked }))} />
                      {r.wiql?.trim() ? 'custom' : 'template'}
                    </label>
                  </td>
                  <RowButtons
                    i={i}
                    len={rows.length}
                    onMove={(d) => setRows(move(rows, i, d))}
                    onDel={() => { if (rows.length > 1) setRows(rows.filter((_, k) => k !== i)); }}
                  />
                </tr>
                {r._wiqlOpen && (
                  <tr className="wiql-row">
                    <td />
                    <td colSpan={6}>
                      <textarea
                        rows={4}
                        placeholder="Blank = use the WIQL template"
                        value={r.wiql ?? ''}
                        onChange={(e) => setRows(patch(rows, i, { wiql: e.target.value }))}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        <button
          onClick={() => setRows([...rows, { id: '', name: '', color: '#607d8b', areaPath: '', _key: keySeq.current++, _isNew: true, _idTouched: false, _wiqlOpen: false }])}
        >
          + Add backlog
        </button>
      </section>

      <section>
        <h3>WIQL template</h3>
        <p className="muted"><code>{'{{areaPath}}'}</code> is replaced by each backlog's area path.</p>
        <textarea rows={6} value={s.wiqlTemplate} onChange={(e) => set({ wiqlTemplate: e.target.value })} />
      </section>

      <section>
        <h3>Validation ("To validate" view)</h3>
        <p className="muted">WIQL for Resolved items assigned to you. <code>{'{{areaPath}}'}</code> is replaced by each backlog's area path.</p>
        <textarea rows={6} value={s.validation.wiqlTemplate} onChange={(e) => setVal({ wiqlTemplate: e.target.value })} />
        <h4>Items under my Features</h4>
        <p className="muted">
          Link query (<code>FROM WorkItemLinks</code>, one hop) of Resolved items whose parent Feature is assigned to you; its linked
          items are added to the list. Must contain <code>{'{{areaPath}}'}</code>; leave empty to turn it off.
        </p>
        <textarea rows={6} value={s.validation.featureWiqlTemplate ?? ''} onChange={(e) => setVal({ featureWiqlTemplate: e.target.value })} />
        <ReasonTable title="Close (validated)" hint="System.Reason set when closing, per work item type." map={s.validation.close} onChange={(m) => setVal({ close: m })} />
        <ReasonTable title="Reject (back to Active)" hint="System.Reason set when rejecting, per work item type." map={s.validation.reject} onChange={(m) => setVal({ reject: m })} />
      </section>

      <section>
        <h3>Versions</h3>
        <label className="field">Next version tag
          <input value={s.nextVersionTag} onChange={(e) => set({ nextVersionTag: e.target.value })} />
        </label>
        <label className="field">Version tags (comma separated)
          <input value={versionTagsText} onChange={(e) => setVT(e.target.value)} />
        </label>
      </section>

      <section>
        <h3>Tags filter</h3>
        <label className="field">Hidden by default (comma separated)
          <input value={hiddenTagsText} onChange={(e) => setHT(e.target.value)} placeholder="e.g. 10.2x, WontFix" />
        </label>
        <p className="muted">These tags start unchecked in the Tags column filter of every backlog, so items with any of them are hidden. The filter's <b>defaults</b> link restores them.</p>
      </section>

      <section>
        <h3>Bands</h3>
        <table className="form-table">
          <thead>
            <tr><th>Label</th><th>Min</th><th>Max (blank = none)</th><th>Color</th><th /></tr>
          </thead>
          <tbody>
            {bands.map((b, i) => (
              <tr key={i}>
                <td><input value={b.label} onChange={(e) => setBands(patch(bands, i, { label: e.target.value }))} /></td>
                <td><input type="number" value={b.min} onChange={(e) => setBands(patch(bands, i, { min: Number(e.target.value) }))} /></td>
                <td>
                  <input
                    type="number"
                    value={b.max ?? ''}
                    onChange={(e) => setBands(patch(bands, i, { max: e.target.value === '' ? null : Number(e.target.value) }))}
                  />
                </td>
                <td><input type="color" value={/^#[0-9a-f]{6}$/i.test(b.color) ? b.color : '#999999'} onChange={(e) => setBands(patch(bands, i, { color: e.target.value }))} /></td>
                <RowButtons i={i} len={bands.length} onMove={(d) => setBands(move(bands, i, d))} onDel={() => setBands(bands.filter((_, k) => k !== i))} />
              </tr>
            ))}
          </tbody>
        </table>
        <button onClick={() => setBands([...bands, { label: '', min: 0, max: null, color: '#999999' }])}>+ Add band</button>
      </section>

      <RuleTable title="Component rules" valueKey="component" valueLabel="Component" rows={s.componentRules} onChange={(r) => set({ componentRules: r })} />

      <section>
        <h3>Editable fields</h3>
        {FIELDS.map((f) => (
          <label key={f.ref} className="inline check">
            <input
              type="checkbox"
              checked={s.editableFields.includes(f.ref)}
              onChange={(e) =>
                set({
                  editableFields: e.target.checked
                    ? [...s.editableFields, f.ref]
                    : s.editableFields.filter((x) => x !== f.ref),
                })
              }
            />
            {f.label} <span className="muted">({f.ref})</span>
          </label>
        ))}
        <label className="field">State options (comma separated)
          <input value={statesText} onChange={(e) => setST(e.target.value)} />
        </label>
      </section>
    </div>
  );
}
