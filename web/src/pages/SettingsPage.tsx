import { Fragment, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { BacklogDef, Band, SettingsDto } from '../../../server/src/types';
import { api } from '../api';
import { PageHeader, Skeleton } from '../ui/kit';
import { THEMES, useTheme } from '../ui/theme';
import './settings.css';

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

const SECTIONS: { id: string; label: string }[] = [
  { id: 'areas', label: 'Areas' },
  { id: 'queries', label: 'Queries' },
  { id: 'reasons', label: 'Validation reasons' },
  { id: 'versions', label: 'Versions & tags' },
  { id: 'bands', label: 'Bands' },
  { id: 'components', label: 'Components' },
  { id: 'fields', label: 'Editable fields' },
  { id: 'appearance', label: 'Appearance' },
];

/** Editing row: the BacklogDef plus UI-only state (stripped before saving). */
interface BacklogRow extends BacklogDef {
  _key: number;
  _isNew: boolean;      // not yet saved: id follows the name until the user edits it
  _idTouched: boolean;
  _wiqlOpen: boolean;
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const csv = (s: string) =>
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

/** The exact payload sent to the server (UI-only row fields stripped, CSV split). Also used for dirty tracking. */
function buildPayload(s: SettingsDto, rows: BacklogRow[], vt: string, st: string, ht: string): SettingsDto {
  const backlogs: BacklogDef[] = rows.map(({ _key, _isNew, _idTouched, _wiqlOpen, ...b }) => {
    const wiql = b.wiql?.trim();
    return { id: b.id, name: b.name, color: b.color, areaPath: b.areaPath, ...(wiql ? { wiql } : {}), ...(b.hidden ? { hidden: true } : {}) };
  });
  return { ...s, backlogs, versionTags: csv(vt), stateOptions: csv(st), hiddenTags: csv(ht) };
}

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
  valueKey,
  valueLabel,
  rows,
  onChange,
}: {
  valueKey: K;
  valueLabel: string;
  rows: ({ match: string } & Record<K, string>)[];
  onChange: (r: ({ match: string } & Record<K, string>)[]) => void;
}) {
  return (
    <>
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
    </>
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
    <div className="st-sub">
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

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={`st-${id}`} data-st={id} className="ui-panel st-section">
      <div className="ui-panel-head"><h3>{title}</h3></div>
      <div className="ui-panel-body">{children}</div>
    </section>
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
  const [baseline, setBaseline] = useState<string>('');
  const [active, setActive] = useState(SECTIONS[0].id);
  const [theme, setTheme] = useTheme();
  const keySeq = useRef(0);
  const bodyRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    try {
      const d = await api.getSettings();
      const newRows: BacklogRow[] = d.backlogs.map((b) => ({ ...b, _key: keySeq.current++, _isNew: false, _idTouched: true, _wiqlOpen: !!b.wiql?.trim() }));
      const vt = d.versionTags.join(', ');
      const st = d.stateOptions.join(', ');
      const ht = (d.hiddenTags ?? []).join(', ');
      setS(d);
      setRows(newRows);
      setVT(vt);
      setST(st);
      setHT(ht);
      setBaseline(JSON.stringify(buildPayload(d, newRows, vt, st, ht)));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const dirty = !!s && JSON.stringify(buildPayload(s, rows, versionTagsText, statesText, hiddenTagsText)) !== baseline;

  // warn before leaving the page with unsaved edits
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  // highlight the section in view
  const loaded = !!s;
  useEffect(() => {
    const root = bodyRef.current;
    if (!root) return;
    const els = Array.from(root.querySelectorAll<HTMLElement>('[data-st]'));
    if (!els.length) return;
    const visible = new Set<string>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          const id = (en.target as HTMLElement).dataset.st!;
          if (en.isIntersecting) visible.add(id);
          else visible.delete(id);
        }
        const first = SECTIONS.find((x) => visible.has(x.id));
        if (first) setActive(first.id);
      },
      { root, rootMargin: '0px 0px -60% 0px', threshold: 0 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [loaded]);

  const goTo = (id: string) => {
    setActive(id);
    document.getElementById(`st-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const revert = async () => {
    if (dirty && !window.confirm('Discard your unsaved changes and reload the saved settings?')) return;
    setMsg(null);
    await load();
  };

  if (!s) {
    return (
      <div className="page settings-page">
        <PageHeader title="Settings" meta="Changes apply to all areas" />
        <div className="st-loading">
          {error ? (
            <div className="banner error">{error}</div>
          ) : (
            <>
              <Skeleton height={16} width="40%" />
              <Skeleton height={80} />
              <Skeleton height={80} />
            </>
          )}
        </div>
      </div>
    );
  }

  const set = (p: Partial<SettingsDto>) => setS({ ...s, ...p });

  const save = async () => {
    setBusy(true);
    setMsg(null);
    setError(null);
    const dto = buildPayload(s, rows, versionTagsText, statesText, hiddenTagsText);
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
  const setHome = (p: Partial<SettingsDto['home']>) => set({ home: { ...s.home, ...p } });

  const bands = s.bands;
  const setBands = (b: Band[]) => set({ bands: b });

  return (
    <div className="page settings-page">
      <PageHeader title="Settings" meta="Changes apply to all areas">
        <button disabled={busy} onClick={() => void revert()} title="Re-fetch the saved settings and drop local edits">Revert</button>
        <button className="primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
      </PageHeader>

      <div className="st-body" ref={bodyRef}>
        <nav className="st-nav" aria-label="Settings sections">
          <div className="st-nav-title">Sections</div>
          {SECTIONS.map((x) => (
            <a
              key={x.id}
              href={`#st-${x.id}`}
              className={active === x.id ? 'on' : ''}
              aria-current={active === x.id ? 'true' : undefined}
              onClick={(e) => {
                e.preventDefault();
                goTo(x.id);
              }}
            >
              {x.label}
            </a>
          ))}
        </nav>

        <div className="st-content">
          {error && <div className="banner error">{error}</div>}
          {msg && !dirty && <div className="banner ok">{msg}</div>}

          <Section id="areas" title="Areas">
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
          </Section>

          <Section id="queries" title="Queries">
            <div className="st-sub">
              <h4>Backlog WIQL template</h4>
              <p className="muted"><code>{'{{areaPath}}'}</code> is replaced by each backlog's area path.</p>
              <textarea rows={6} value={s.wiqlTemplate} onChange={(e) => set({ wiqlTemplate: e.target.value })} />
            </div>

            <div className="st-sub">
              <h4>Home</h4>
              <p className="muted">Queries behind the Home page cards. All of them only read from TFS.</p>
              <h4>Running features</h4>
              <p className="muted">
                Link query (<code>FROM WorkItemLinks</code>, one hop, <code>MODE (MayContain)</code>) of your open Features and their child
                items. Active Features get a progress bar; New ones are listed as "Not started".
              </p>
              <textarea rows={5} value={s.home.featuresWiql} onChange={(e) => setHome({ featuresWiql: e.target.value })} />
              <h4>Next version progress</h4>
              <p className="muted">
                Items tagged with the next version, per area. <code>{'{{areaPath}}'}</code> and <code>{'{{tag}}'}</code> (= Next version tag)
                are filled in.
              </p>
              <textarea rows={4} value={s.home.nextVersionWiqlTemplate} onChange={(e) => setHome({ nextVersionWiqlTemplate: e.target.value })} />
              <h4>Recently changed</h4>
              <p className="muted">
                Items changed by others, per area. <code>{'{{areaPath}}'}</code> and <code>{'{{days}}'}</code> are filled in.
              </p>
              <textarea rows={4} value={s.home.recentWiqlTemplate} onChange={(e) => setHome({ recentWiqlTemplate: e.target.value })} />
              <label className="field-inline">
                Days back{' '}
                <input
                  className="st-num"
                  type="number"
                  min={1}
                  max={30}
                  value={s.home.recentDays}
                  onChange={(e) => setHome({ recentDays: Number(e.target.value) })}
                />
              </label>
            </div>

            <div className="st-sub">
              <h4>Validation ("To validate" view)</h4>
              <p className="muted">WIQL for Resolved items assigned to you. <code>{'{{areaPath}}'}</code> is replaced by each backlog's area path.</p>
              <textarea rows={6} value={s.validation.wiqlTemplate} onChange={(e) => setVal({ wiqlTemplate: e.target.value })} />
              <h4>Items under my Features</h4>
              <p className="muted">
                Link query (<code>FROM WorkItemLinks</code>, one hop) of Resolved items whose parent Feature is assigned to you; its linked
                items are added to the list. Must contain <code>{'{{areaPath}}'}</code>; leave empty to turn it off.
              </p>
              <textarea rows={6} value={s.validation.featureWiqlTemplate ?? ''} onChange={(e) => setVal({ featureWiqlTemplate: e.target.value })} />
            </div>
          </Section>

          <Section id="reasons" title="Validation reasons">
            <ReasonTable title="Close (validated)" hint="System.Reason set when closing, per work item type." map={s.validation.close} onChange={(m) => setVal({ close: m })} />
            <ReasonTable title="Reject (back to Active)" hint="System.Reason set when rejecting, per work item type." map={s.validation.reject} onChange={(m) => setVal({ reject: m })} />
          </Section>

          <Section id="versions" title="Versions & tags">
            <label className="field st-field-wide">Next version tag
              <input value={s.nextVersionTag} onChange={(e) => set({ nextVersionTag: e.target.value })} />
            </label>
            <label className="field st-field-wide">Version tags (comma separated)
              <input value={versionTagsText} onChange={(e) => setVT(e.target.value)} />
            </label>
            <label className="field st-field-wide">Hidden by default (comma separated)
              <input value={hiddenTagsText} onChange={(e) => setHT(e.target.value)} placeholder="e.g. 10.2x, WontFix" />
            </label>
            <p className="muted">These tags start unchecked in the Tags column filter of every backlog, so items with any of them are hidden. The filter's <b>defaults</b> link restores them.</p>
          </Section>

          <Section id="bands" title="Bands">
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
          </Section>

          <Section id="components" title="Components">
            <RuleTable valueKey="component" valueLabel="Component" rows={s.componentRules} onChange={(r) => set({ componentRules: r })} />
          </Section>

          <Section id="fields" title="Editable fields">
            <div className="st-fields">
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
            </div>
            <label className="field st-field-wide">State options (comma separated)
              <input value={statesText} onChange={(e) => setST(e.target.value)} />
            </label>
          </Section>

          <Section id="appearance" title="Appearance">
            <p className="muted">Theme of this app. Stored in this browser only; it is not saved to the server and not part of "Save".</p>
            <div className="st-theme-pick" role="radiogroup" aria-label="Theme">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={theme === t.id}
                  className={'st-theme' + (theme === t.id ? ' on' : '')}
                  onClick={() => setTheme(t.id)}
                >
                  <span className={`st-prev st-prev-${t.id}`} aria-hidden>
                    <span className="st-prev-shell"><i className="act" /><i /><i /></span>
                    <span className="st-prev-main"><i className="acc" /><i /><i /></span>
                  </span>
                  <span className="st-theme-name">{t.name}</span>
                  <span className="st-theme-hint">{t.hint}</span>
                </button>
              ))}
            </div>
          </Section>

          {dirty && (
            <div className="st-savebar" role="region" aria-label="Unsaved changes">
              <b>Unsaved changes</b>
              <span className="muted">Applied to all areas once saved.</span>
              <span className="st-spacer" />
              <button disabled={busy} onClick={() => void revert()}>Revert</button>
              <button className="primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          )}
          <div className="st-end" />
        </div>
      </div>
    </div>
  );
}
