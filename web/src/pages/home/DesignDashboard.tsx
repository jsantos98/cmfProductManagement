import { useState } from 'react';
import type { ReactNode } from 'react';
import type { BacklogDef, HomeItemRef, StateCounts } from '../../../../server/src/types';
import {
  SEGMENTS,
  ago,
  backlogOf,
  doneCount,
  firstName,
  hello,
  ids,
  pctDone,
  typeClass,
  waitClass,
} from './kit';
import type { DesignProps, SectionKey, Slot } from './kit';
import './designDashboard.css';

type Key = 'comments' | 'validate' | 'triage' | 'features' | 'nextVersion' | 'recent';
interface Sort { col: string; dir: 1 | -1 }

const cmp = (a: number | string, b: number | string) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b)));
function sortBy<T>(rows: T[], get: (r: T) => number | string, s: Sort): T[] {
  return [...rows].sort((a, b) => s.dir * cmp(get(a), get(b)));
}
const sumCounts = (cs: StateCounts[]): StateCounts =>
  cs.reduce(
    (t, c) => ({ new: t.new + c.new, active: t.active + c.active, resolved: t.resolved + c.resolved, closed: t.closed + c.closed, other: t.other + c.other, total: t.total + c.total }),
    { new: 0, active: 0, resolved: 0, closed: 0, other: 0, total: 0 },
  );

// ---- small pieces -------------------------------------------------------------------------------------------------

function Area({ backlogs, id }: { backlogs: BacklogDef[]; id: string | null }) {
  const b = backlogOf(backlogs, id);
  return (
    <span className="dB-area" title={b ? b.name : 'Not in a configured area'}>
      <span className="dB-dot" style={{ background: b?.color ?? '#c5cad3' }} />
      {b ? b.name : '—'}
    </span>
  );
}

function Stack({ c, h = 'md' }: { c: StateCounts; h?: 'sm' | 'md' | 'lg' }) {
  const tip = SEGMENTS.filter((s) => c[s.key] > 0).map((s) => `${s.label} ${c[s.key]}`).join(' · ') || 'no items';
  return (
    <div className={'dB-stack dB-stack-' + h} title={tip} role="img" aria-label={tip}>
      {c.total > 0 && SEGMENTS.map((s) => (c[s.key] > 0 ? <span key={s.key} style={{ flexGrow: c[s.key], background: s.color }} /> : null))}
    </div>
  );
}

function Legend({ c }: { c?: StateCounts }) {
  return (
    <div className="dB-legend">
      {SEGMENTS.filter((s) => !c || c[s.key] > 0).map((s) => (
        <span key={s.key}>
          <i style={{ background: s.color }} />
          {s.label}
          {c ? <b> {c[s.key]}</b> : null}
        </span>
      ))}
    </div>
  );
}

function Th({ label, col, sort, onSort, cls }: { label: string; col?: string; sort?: Sort; onSort?: (s: Sort) => void; cls?: string }) {
  if (!col || !onSort || !sort) return <th className={cls}>{label}</th>;
  const on = sort.col === col;
  return (
    <th className={cls} aria-sort={on ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button className="dB-th" onClick={() => onSort({ col, dir: on ? (sort.dir === 1 ? -1 : 1) : -1 })}>
        {label}
        <span className="dB-arrow">{on ? (sort.dir === 1 ? '▲' : '▼') : '↕'}</span>
      </button>
    </th>
  );
}

function Tfs({ url }: { url: string }) {
  return (
    <a className="dB-tfs" href={url} target="_blank" rel="noopener" title="Open in TFS" onClick={(e) => e.stopPropagation()}>
      ↗
    </a>
  );
}

function Empty({ text, warn }: { text: string; warn?: string }) {
  return (
    <div className="dB-empty">
      <div className="dB-empty-ic">✓</div>
      <div>{text}</div>
      {warn && <div className="dB-warn">{warn}</div>}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="dB-skel-panel" aria-busy="true" aria-label="Loading">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="dB-skel" style={{ width: `${95 - i * 9}%` }} />
      ))}
    </div>
  );
}

function ErrBanner({ err, k, p }: { err: string; k: SectionKey; p: DesignProps }) {
  return (
    <div className="dB-err" role="alert">
      <span>⚠ {err}</span>
      <button onClick={() => p.reload(k, true)}>Retry</button>
    </div>
  );
}

function Panel({ title, count, right, children }: { title: string; count?: number | null; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="dB-panel">
      <header className="dB-panel-head">
        <h3>{title}</h3>
        {count !== null && count !== undefined && <span className="dB-count">{count}</span>}
        <span className="dB-grow" />
        {right}
      </header>
      {children}
    </section>
  );
}

/** Clickable table row for a work item. */
function ItemRow({ it, list, p, children, cls }: { it: HomeItemRef; list: number[]; p: DesignProps; children: ReactNode; cls?: string }) {
  return (
    <tr
      className={'dB-tr ' + (cls ?? '')}
      tabIndex={0}
      onClick={() => p.open(it.id, list)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') p.open(it.id, list);
      }}
    >
      {children}
    </tr>
  );
}

const TitleCell = ({ it }: { it: HomeItemRef }) => (
  <td className="dB-title" title={it.title}>
    <span>{it.title}</span>
    <Tfs url={it.url} />
  </td>
);
const IdTypeCells = ({ it }: { it: HomeItemRef }) => (
  <>
    <td className="dB-num">#{it.id}</td>
    <td>
      <span className={typeClass(it.type)}>{it.type}</span>
    </td>
  </>
);

// ---- main ---------------------------------------------------------------------------------------------------------

export default function DesignDashboard(p: DesignProps) {
  const { data: d, backlogs } = p;
  const [picked, setPicked] = useState<Key | null>(null);
  const [sorts, setSorts] = useState<Record<string, Sort>>({});
  const [openF, setOpenF] = useState<Set<number>>(new Set());
  const sortOf = (k: string, def: Sort): Sort => sorts[k] ?? def;
  const setSort = (k: string) => (s: Sort) => setSorts((o) => ({ ...o, [k]: s }));

  const nComments = d.comments.data?.items.length ?? 0;
  const nValidate = d.validate.data?.backlogs.reduce((s, b) => s + b.total, 0) ?? 0;
  const nTriage = d.triage.data?.backlogs.reduce((s, b) => s + b.total, 0) ?? 0;
  const loadedAny = [d.comments, d.validate, d.triage].every((s) => s.data !== null);
  const auto: Key = nComments > 0 ? 'comments' : nValidate > 0 ? 'validate' : nTriage > 0 ? 'triage' : loadedAny ? 'features' : 'comments';
  const sel: Key = picked ?? auto;

  const at = Math.max(0, ...(Object.values(d) as Slot<unknown>[]).map((s) => s.at));
  const features = d.features.data?.active ?? [];
  const avgPct = features.length ? Math.round(features.reduce((s, f) => s + pctDone(f.counts), 0) / features.length) : 0;
  const nvTotal = sumCounts((d.nextVersion.data?.backlogs ?? []).map((b) => b.counts));
  const noPr = d.validate.data?.backlogs.reduce((s, b) => s + b.noPr, 0) ?? 0;
  const oldest = d.validate.data?.backlogs.reduce<number | null>((m, b) => (b.oldestDays === null ? m : Math.max(m ?? 0, b.oldestDays)), null) ?? null;

  // ---- tiles
  interface Tile { key: Key; slot: Slot<unknown>; label: string; big: string; sub: ReactNode; viz: ReactNode; warn?: boolean }
  const dots = (n: number, cls = '') => (
    <div className="dB-dots" aria-hidden>
      {Array.from({ length: Math.min(n, 14) }, (_, i) => (
        <span key={i} className={cls} />
      ))}
      {n > 14 && <em>+{n - 14}</em>}
    </div>
  );
  const areaBar = (rows: { color: string; n: number }[]) => (
    <div className="dB-mini" aria-hidden>
      {rows.filter((r) => r.n > 0).map((r, i) => (
        <span key={i} style={{ flexGrow: r.n, background: r.color }} />
      ))}
    </div>
  );
  const tiles: Tile[] = [
    { key: 'comments', slot: d.comments, label: 'Comments to reply', big: String(nComments), sub: nComments ? 'waiting for you' : 'all caught up', viz: dots(nComments) },
    {
      key: 'validate',
      slot: d.validate,
      label: 'To validate',
      big: String(nValidate),
      sub: nValidate ? (
        <>
          {noPr > 0 && <span className="dB-hot">⚠ {noPr} no PR</span>}
          {noPr > 0 && oldest !== null ? ' · ' : ''}
          {oldest !== null ? `oldest ${oldest}d` : noPr === 0 ? 'nothing old' : ''}
        </>
      ) : (
        'nothing waiting'
      ),
      viz: areaBar((d.validate.data?.backlogs ?? []).map((b) => ({ color: b.color, n: b.total }))),
    },
    { key: 'triage', slot: d.triage, label: 'Triage BO −1', big: String(nTriage), sub: nTriage ? `${d.triage.data?.backlogs.filter((b) => b.total > 0).length} area(s)` : 'inbox empty', viz: areaBar((d.triage.data?.backlogs ?? []).map((b) => ({ color: b.color, n: b.total }))) },
    {
      key: 'features',
      slot: d.features,
      label: 'Running features',
      big: String(features.length),
      sub: features.length ? `avg ${avgPct}% done` : 'none active',
      viz: (
        <div className="dB-mini dB-mini-pct" aria-hidden>
          <span style={{ width: avgPct + '%' }} />
        </div>
      ),
    },
    {
      key: 'nextVersion',
      slot: d.nextVersion,
      label: 'Next version',
      big: nvTotal.total ? pctDone(nvTotal) + '%' : '—',
      sub: d.nextVersion.data ? `${nvTotal.total} items · ${d.nextVersion.data.tag}` : '',
      viz: <Stack c={nvTotal} h="sm" />,
    },
    {
      key: 'recent',
      slot: d.recent,
      label: 'Recently changed',
      big: String(d.recent.data?.items.length ?? 0),
      sub: d.recent.data ? `last ${d.recent.data.days} day${d.recent.data.days === 1 ? '' : 's'}` : '',
      viz: dots(d.recent.data?.items.length ?? 0, 'dB-dot-soft'),
    },
  ];

  const date = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const name = firstName(p.me);

  return (
    <div className="dB">
      <div className="dB-hero">
        <div className="dB-hero-top">
          <div>
            <h2>
              {hello()}
              {name ? `, ${name}` : ''}
            </h2>
            <div className="dB-date">{date}</div>
          </div>
          <span className="dB-grow" />
          <span className="dB-upd">{at ? `updated ${new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}</span>
          <button className="dB-refresh" onClick={() => p.refreshAll()} disabled={p.loading} aria-busy={p.loading}>
            <span className={p.loading ? 'dB-spin' : ''} aria-hidden>
              ↻
            </span>{' '}
            Refresh
          </button>
        </div>
        <div className="dB-tiles" role="group" aria-label="Sections">
          {tiles.map((t) => {
            if (t.slot.data === null && t.slot.loading) {
              return (
                <div key={t.key} className="dB-tile dB-tile-skel" aria-busy="true">
                  <div className="dB-skel dB-skel-dark" style={{ width: '50%', height: 28 }} />
                  <div className="dB-skel dB-skel-dark" style={{ width: '70%' }} />
                  <div className="dB-skel dB-skel-dark" style={{ width: '40%' }} />
                </div>
              );
            }
            const failed = t.slot.data === null && !!t.slot.err;
            return (
              <button key={t.key} className={'dB-tile' + (sel === t.key ? ' on' : '') + (failed ? ' fail' : '')} aria-pressed={sel === t.key} onClick={() => setPicked(t.key)}>
                <span className="dB-tile-big">{failed ? '!' : t.big}</span>
                <span className="dB-tile-label">{t.label}</span>
                <span className="dB-tile-sub">{failed ? 'failed to load' : t.sub || ' '}</span>
                {!failed && t.viz}
              </button>
            );
          })}
        </div>
      </div>

      <div className="dB-body">
        <div className="dB-main">{renderPanel()}</div>
        <aside className="dB-side">{renderProgress()}</aside>
      </div>
    </div>
  );

  // ---- panels ------------------------------------------------------------------------------------------------------

  function guard(slot: Slot<unknown>, k: SectionKey, title: string, body: () => ReactNode): ReactNode {
    if (slot.data === null && slot.loading) return (
      <Panel title={title}>
        <Skeleton />
      </Panel>
    );
    if (slot.data === null) return (
      <Panel title={title}>{slot.err ? <ErrBanner err={slot.err} k={k} p={p} /> : <Skeleton />}</Panel>
    );
    return (
      <>
        {slot.err && <ErrBanner err={slot.err} k={k} p={p} />}
        {body()}
      </>
    );
  }

  function renderPanel(): ReactNode {
    if (sel === 'comments') return guard(d.comments, 'comments', 'Comments to reply', commentsPanel);
    if (sel === 'validate') return guard(d.validate, 'validate', 'To validate', validatePanel);
    if (sel === 'triage') return guard(d.triage, 'triage', 'Triage · BO −1', triagePanel);
    if (sel === 'features') return guard(d.features, 'features', 'Running features', featuresPanel);
    if (sel === 'nextVersion') return guard(d.nextVersion, 'nextVersion', 'Next version', nextPanel);
    return guard(d.recent, 'recent', 'Recently changed', recentPanel);
  }

  function commentsPanel(): ReactNode {
    const r = d.comments.data!;
    const s = sortOf('comments', { col: 'when', dir: 1 });
    const get = (x: (typeof r.items)[number]): number | string =>
      s.col === 'area' ? backlogOf(backlogs, x.backlogId)?.name ?? '' : s.col === 'id' ? x.id : s.col === 'count' ? x.count : s.col === 'type' ? x.type : s.col === 'title' ? x.title : -Date.parse(x.lastDate);
    const rows = sortBy(r.items, get, s);
    const list = ids(rows);
    const st = setSort('comments');
    return (
      <Panel title="Comments to reply" count={r.items.length} right={r.errors ? <span className="dB-warn">{r.errors} item(s) could not be checked</span> : null}>
        {!rows.length ? (
          <Empty text="Nothing waiting for you" />
        ) : (
          <div className="dB-scroll">
            <table className="dB-table">
              <thead>
                <tr>
                  <Th label="Area" col="area" sort={s} onSort={st} />
                  <Th label="ID" col="id" sort={s} onSort={st} />
                  <Th label="Type" col="type" sort={s} onSort={st} />
                  <Th label="Title" col="title" sort={s} onSort={st} />
                  <Th label="Last comment" />
                  <Th label="#" col="count" sort={s} onSort={st} cls="dB-r" />
                  <Th label="Age" col="when" sort={s} onSort={st} cls="dB-r" />
                </tr>
              </thead>
              <tbody>
                {rows.map((it) => (
                  <ItemRow key={it.id} it={it} list={list} p={p}>
                    <td>
                      <Area backlogs={backlogs} id={it.backlogId} />
                    </td>
                    <IdTypeCells it={it} />
                    <TitleCell it={it} />
                    <td className="dB-snip" title={it.snippet}>
                      <b>{it.lastAuthor}</b>
                      {it.view === 'validate' && <span className="dB-tag">to validate</span>} <span className="muted">{it.snippet}</span>
                    </td>
                    <td className="dB-r dB-num">{it.count}</td>
                    <td className="dB-r dB-num" title={new Date(it.lastDate).toLocaleString()}>
                      {ago(it.lastDate)}
                    </td>
                  </ItemRow>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    );
  }

  function validatePanel(): ReactNode {
    const r = d.validate.data!;
    const s = sortOf('validate', { col: 'wait', dir: -1 });
    const flat = r.backlogs.flatMap((b) => b.items.map((it) => ({ ...it })));
    const get = (x: (typeof flat)[number]): number | string =>
      s.col === 'area' ? backlogOf(backlogs, x.backlogId)?.name ?? '' : s.col === 'id' ? x.id : s.col === 'type' ? x.type : s.col === 'title' ? x.title : s.col === 'pr' ? (x.noPr ? 0 : 1) : s.col === 'listed' ? (x.viaFeature ? 1 : 0) : x.waitDays ?? -1;
    const rows = sortBy(flat, get, s);
    const list = ids(rows);
    const st = setSort('validate');
    const more = r.backlogs.filter((b) => b.total > b.items.length);
    return (
      <Panel
        title="To validate"
        count={nValidate}
        right={
          <span className="dB-links">
            {r.backlogs.map((b) => (
              <a key={b.backlogId} href={`#/b/${encodeURIComponent(b.backlogId)}/validate`}>
                <span className="dB-dot" style={{ background: b.color }} />
                {b.name} {b.total} →
              </a>
            ))}
          </span>
        }
      >
        {r.backlogs.filter((b) => b.error).map((b) => (
          <div key={b.backlogId} className="dB-err">
            ⚠ {b.name}: {b.error}
          </div>
        ))}
        {!rows.length ? (
          <Empty text="Nothing to validate" />
        ) : (
          <div className="dB-scroll">
            <table className="dB-table">
              <thead>
                <tr>
                  <Th label="Area" col="area" sort={s} onSort={st} />
                  <Th label="ID" col="id" sort={s} onSort={st} />
                  <Th label="Type" col="type" sort={s} onSort={st} />
                  <Th label="Title" col="title" sort={s} onSort={st} />
                  <Th label="PR" col="pr" sort={s} onSort={st} />
                  <Th label="Listed for" col="listed" sort={s} onSort={st} />
                  <Th label="Waiting" col="wait" sort={s} onSort={st} cls="dB-r" />
                </tr>
              </thead>
              <tbody>
                {rows.map((it) => (
                  <ItemRow key={it.id} it={it} list={list} p={p}>
                    <td>
                      <Area backlogs={backlogs} id={it.backlogId} />
                    </td>
                    <IdTypeCells it={it} />
                    <TitleCell it={it} />
                    <td>{it.noPr ? <span className="pr-chip nopr" title="No completed pull request: analyse before validating">⚠ No PR</span> : <span className="muted">✓ PR</span>}</td>
                    <td>{it.viaFeature ? <span className="listed-feature" title="Listed because the parent Feature is yours">My Feature</span> : <span className="muted">Assigned</span>}</td>
                    <td className={'dB-r dB-num ' + (waitClass(it.waitDays) ?? '')}>{it.waitDays === null ? '—' : `${it.waitDays}d`}</td>
                  </ItemRow>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {more.length > 0 && (
          <div className="dB-foot">
            Showing the oldest per area ·{' '}
            {more.map((b) => (
              <a key={b.backlogId} href={`#/b/${encodeURIComponent(b.backlogId)}/validate`}>
                +{b.total - b.items.length} more in {b.name}
              </a>
            ))}
          </div>
        )}
      </Panel>
    );
  }

  function triagePanel(): ReactNode {
    const r = d.triage.data!;
    const s = sortOf('triage', { col: 'id', dir: 1 });
    const flat = r.backlogs.flatMap((b) => b.items);
    const get = (x: HomeItemRef): number | string =>
      s.col === 'area' ? backlogOf(backlogs, x.backlogId)?.name ?? '' : s.col === 'type' ? x.type : s.col === 'title' ? x.title : s.col === 'state' ? x.state : x.id;
    const rows = sortBy(flat, get, s);
    const list = ids(rows);
    const st = setSort('triage');
    const more = r.backlogs.filter((b) => b.total > b.items.length);
    return (
      <Panel
        title="Triage · BO −1"
        count={nTriage}
        right={
          <span className="dB-links">
            {r.backlogs.map((b) => (
              <a key={b.backlogId} href={`#/b/${encodeURIComponent(b.backlogId)}`}>
                <span className="dB-dot" style={{ background: b.color }} />
                {b.name} {b.total}
                {b.byType.length ? ` (${b.byType.map((t) => `${t.key} ${t.count}`).join(', ')})` : ''} →
              </a>
            ))}
          </span>
        }
      >
        {r.backlogs.filter((b) => b.error).map((b) => (
          <div key={b.backlogId} className="dB-err">
            ⚠ {b.name}: {b.error}
          </div>
        ))}
        {!rows.length ? (
          <Empty text="Nothing to triage" />
        ) : (
          <div className="dB-scroll">
            <table className="dB-table">
              <thead>
                <tr>
                  <Th label="Area" col="area" sort={s} onSort={st} />
                  <Th label="ID" col="id" sort={s} onSort={st} />
                  <Th label="Type" col="type" sort={s} onSort={st} />
                  <Th label="Title" col="title" sort={s} onSort={st} />
                  <Th label="State" col="state" sort={s} onSort={st} />
                </tr>
              </thead>
              <tbody>
                {rows.map((it) => (
                  <ItemRow key={it.id} it={it} list={list} p={p}>
                    <td>
                      <Area backlogs={backlogs} id={it.backlogId} />
                    </td>
                    <IdTypeCells it={it} />
                    <TitleCell it={it} />
                    <td className="muted">{it.state}</td>
                  </ItemRow>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {more.length > 0 && (
          <div className="dB-foot">
            {more.map((b) => (
              <a key={b.backlogId} href={`#/b/${encodeURIComponent(b.backlogId)}`}>
                +{b.total - b.items.length} more in {b.name} backlog
              </a>
            ))}
          </div>
        )}
      </Panel>
    );
  }

  function featuresPanel(): ReactNode {
    const r = d.features.data!;
    const s = sortOf('features', { col: 'id', dir: 1 });
    const get = (f: (typeof r.active)[number]): number | string =>
      s.col === 'pct' ? pctDone(f.counts) : s.col === 'total' ? f.counts.total : s.col === 'title' ? f.title : f.id;
    const rows = sortBy(r.active, get, s);
    const list = ids(rows);
    const st = setSort('features');
    const toggle = (id: number) =>
      setOpenF((o) => {
        const n = new Set(o);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      });
    return (
      <Panel title="Running features" count={r.active.length} right={<Legend />}>
        {!rows.length ? (
          <Empty text="No Active Features assigned to you" />
        ) : (
          <div className="dB-scroll">
            <table className="dB-table">
              <thead>
                <tr>
                  <th className="dB-fold" />
                  <Th label="Area" />
                  <Th label="ID" col="id" sort={s} onSort={st} />
                  <Th label="Title" col="title" sort={s} onSort={st} />
                  <Th label="Progress" cls="dB-wide" />
                  <Th label="Done" col="total" sort={s} onSort={st} cls="dB-r" />
                  <Th label="%" col="pct" sort={s} onSort={st} cls="dB-r" />
                </tr>
              </thead>
              <tbody>
                {rows.map((f) => {
                  const c = f.counts;
                  const isOpen = openF.has(f.id);
                  return (
                    <FeatureRows key={f.id}>
                      <ItemRow it={f} list={list} p={p}>
                        <td className="dB-fold">
                          <button
                            className="dB-chev"
                            aria-expanded={isOpen}
                            aria-label={isOpen ? 'Hide items' : 'Show items'}
                            disabled={!f.children.length}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggle(f.id);
                            }}
                          >
                            {isOpen ? '▾' : '▸'}
                          </button>
                        </td>
                        <td>
                          <Area backlogs={backlogs} id={f.backlogId} />
                        </td>
                        <td className="dB-num">#{f.id}</td>
                        <TitleCell it={f} />
                        <td className="dB-wide">
                          <Stack c={c} />
                        </td>
                        <td className="dB-r dB-num">
                          {doneCount(c)}/{c.total}
                        </td>
                        <td className="dB-r dB-num">
                          <b>{pctDone(c)}%</b>
                        </td>
                      </ItemRow>
                      {isOpen &&
                        f.children.map((k) => (
                          <ItemRow key={k.id} it={k} list={ids(f.children)} p={p} cls="dB-child">
                            <td />
                            <td className="muted" colSpan={1}>
                              {k.assignedTo}
                            </td>
                            <td className="dB-num">#{k.id}</td>
                            <td className="dB-title" title={k.title}>
                              <span className={typeClass(k.type)}>{k.type}</span> <span>{k.title}</span>
                              <Tfs url={k.url} />
                            </td>
                            <td className="muted" colSpan={3}>
                              {k.state}
                            </td>
                          </ItemRow>
                        ))}
                    </FeatureRows>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {r.notStarted.length > 0 && (
          <details className="dB-more">
            <summary>Not started ({r.notStarted.length})</summary>
            <table className="dB-table">
              <tbody>
                {r.notStarted.map((f) => (
                  <ItemRow key={f.id} it={f} list={ids(r.notStarted)} p={p}>
                    <td>
                      <Area backlogs={backlogs} id={f.backlogId} />
                    </td>
                    <td className="dB-num">#{f.id}</td>
                    <TitleCell it={f} />
                    <td className="dB-r muted">{f.childCount ? `${f.childCount} item${f.childCount === 1 ? '' : 's'}` : 'no items'}</td>
                  </ItemRow>
                ))}
              </tbody>
            </table>
          </details>
        )}
      </Panel>
    );
  }

  function nextPanel(): ReactNode {
    const r = d.nextVersion.data!;
    return (
      <Panel
        title={`Next version · ${r.tag}`}
        count={nvTotal.total}
        right={
          <span className="dB-links">
            <b className="dB-bigpct">{pctDone(nvTotal)}%</b> <span className="muted">done (Resolved + Closed)</span>
          </span>
        }
      >
        {!r.backlogs.length ? (
          <Empty text="No items tagged for the next version" />
        ) : (
          <div className="dB-areas">
            <Legend />
            {r.backlogs.map((b) => (
              <div key={b.backlogId} className="dB-area-card">
                <div className="dB-area-head">
                  <span className="dB-dot" style={{ background: b.color }} />
                  <a href={`#/b/${encodeURIComponent(b.backlogId)}`}>
                    <b>{b.name}</b>
                  </a>
                  <span className="dB-grow" />
                  <span className="dB-big">{pctDone(b.counts)}%</span>
                </div>
                {b.error ? (
                  <div className="dB-err">⚠ {b.error}</div>
                ) : (
                  <>
                    <Stack c={b.counts} h="lg" />
                    <div className="dB-area-foot">
                      <Legend c={b.counts} />
                      <span className="dB-grow" />
                      <span className="muted">
                        {b.counts.total} items{b.byType.length ? ' · ' : ''}
                        {b.byType.map((t) => `${t.key} ${t.count}`).join(' · ')}
                      </span>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>
    );
  }

  function recentPanel(): ReactNode {
    const r = d.recent.data!;
    const s = sortOf('recent', { col: 'when', dir: 1 });
    const get = (x: (typeof r.items)[number]): number | string =>
      s.col === 'area' ? backlogOf(backlogs, x.backlogId)?.name ?? '' : s.col === 'id' ? x.id : s.col === 'type' ? x.type : s.col === 'title' ? x.title : s.col === 'state' ? x.state : s.col === 'by' ? x.changedBy : -Date.parse(x.changedDate);
    const rows = sortBy(r.items, get, s);
    const list = ids(rows);
    const st = setSort('recent');
    return (
      <Panel
        title={`Recently changed · last ${r.days} day${r.days === 1 ? '' : 's'}`}
        count={r.items.length}
        right={r.errors ? <span className="dB-warn">{r.errors} area(s) could not be read</span> : null}
      >
        {!rows.length ? (
          <Empty text="No changes by others" />
        ) : (
          <div className="dB-scroll">
            <table className="dB-table">
              <thead>
                <tr>
                  <Th label="Area" col="area" sort={s} onSort={st} />
                  <Th label="ID" col="id" sort={s} onSort={st} />
                  <Th label="Type" col="type" sort={s} onSort={st} />
                  <Th label="Title" col="title" sort={s} onSort={st} />
                  <Th label="State" col="state" sort={s} onSort={st} />
                  <Th label="Changed by" col="by" sort={s} onSort={st} />
                  <Th label="When" col="when" sort={s} onSort={st} cls="dB-r" />
                </tr>
              </thead>
              <tbody>
                {rows.map((it) => (
                  <ItemRow key={it.id} it={it} list={list} p={p}>
                    <td>
                      <Area backlogs={backlogs} id={it.backlogId} />
                    </td>
                    <IdTypeCells it={it} />
                    <TitleCell it={it} />
                    <td className="muted">{it.state}</td>
                    <td>{it.changedBy}</td>
                    <td className="dB-r dB-num" title={new Date(it.changedDate).toLocaleString()}>
                      {ago(it.changedDate)}
                    </td>
                  </ItemRow>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    );
  }

  function renderProgress(): ReactNode {
    const body = () => {
      if (d.features.data === null && d.features.loading) return <Skeleton />;
      if (d.features.data === null) return d.features.err ? <ErrBanner err={d.features.err} k="features" p={p} /> : <Skeleton />;
      const act = d.features.data.active;
      if (!act.length) return <Empty text="No Active Features" />;
      const list = ids(act);
      return (
        <ul className="dB-bars">
          {act.map((f) => (
            <li key={f.id}>
              <button className="dB-bar-row" onClick={() => p.open(f.id, list)} title={f.title}>
                <span className="dB-bar-top">
                  <span className="dB-dot" style={{ background: backlogOf(backlogs, f.backlogId)?.color ?? '#c5cad3' }} />
                  <span className="dB-bar-name">
                    <span className="muted">#{f.id}</span> {f.title}
                  </span>
                  <b className="dB-num">{pctDone(f.counts)}%</b>
                </span>
                <span className="dB-bar-track">
                  <Stack c={f.counts} h="md" />
                </span>
                <span className="dB-bar-sub dB-num">
                  {doneCount(f.counts)}/{f.counts.total} done{f.counts.active ? ` · ${f.counts.active} active` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      );
    };
    return (
      <Panel title="Feature progress" count={d.features.data?.active.length ?? null}>
        {body()}
        <div className="dB-foot">
          <Legend />
        </div>
      </Panel>
    );
  }
}

/** Fragment wrapper so a feature row and its child rows share one key. */
function FeatureRows({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
