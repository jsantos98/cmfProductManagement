import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { HomeFeature, HomeItemRef, StateCounts } from '../../../../server/src/types';
import type { DesignProps, SectionKey } from './kit';
import { SEGMENTS, ago, backlogOf, doneCount, firstName, hello, ids, pctDone, typeClass, waitClass } from './kit';
import './designInbox.css';

type View = 'all' | 'reply' | 'validate' | 'triage' | 'flight' | 'next' | 'recent';

interface Row {
  key: string;
  item: HomeItemRef;
  meta: ReactNode;
  sub?: ReactNode;
}
interface Group {
  id: string;
  title: string;
  count: number;
  slot: SectionKey;
  rows: Row[];
  empty: string;
  footer?: ReactNode;
  /** true when rows are not plain item rows (flight view renders its own) */
  custom?: boolean;
}

const dateStr = () => new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
const hhmm = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function Bar({ c }: { c: StateCounts }) {
  const tip = SEGMENTS.filter((s) => c[s.key] > 0).map((s) => `${s.label} ${c[s.key]}`).join(' · ') || 'no items';
  return (
    <div className="dA-bar" title={tip}>
      {c.total > 0 &&
        SEGMENTS.map((s) => (c[s.key] > 0 ? <span key={s.key} style={{ flexGrow: c[s.key], background: s.color }} /> : null))}
    </div>
  );
}

export default function DesignInbox(p: DesignProps) {
  const { data, backlogs } = p;
  const [view, setView] = useState<View>('all');
  const [sel, setSel] = useState<string>('');
  const rootRef = useRef<HTMLDivElement>(null);

  const area = (id: string | null) => backlogOf(backlogs, id);

  // ---- groups ---------------------------------------------------------------------------------------------------
  const groups = useMemo(() => {
    const g: Record<'reply' | 'validate' | 'triage' | 'recent' | 'flight' | 'notStarted', Group> = {
      reply: { id: 'reply', title: 'Reply', count: 0, slot: 'comments', rows: [], empty: 'Nothing waiting for you. Inbox zero.' },
      validate: { id: 'validate', title: 'Validate', count: 0, slot: 'validate', rows: [], empty: 'Nothing to validate.' },
      triage: { id: 'triage', title: 'Triage', count: 0, slot: 'triage', rows: [], empty: 'Nothing to triage.' },
      recent: { id: 'recent', title: 'Recent', count: 0, slot: 'recent', rows: [], empty: 'No recent changes by others.' },
      flight: { id: 'flight', title: 'In flight', count: 0, slot: 'features', rows: [], empty: 'No Active Features assigned to you.', custom: true },
      notStarted: { id: 'notStarted', title: 'Not started', count: 0, slot: 'features', rows: [], empty: '' },
    };

    const c = data.comments.data;
    if (c) {
      g.reply.count = c.items.length;
      g.reply.rows = c.items.map((it) => ({
        key: 'r' + it.id,
        item: it,
        meta: (
          <>
            {it.view === 'validate' && <span className="dA-tag">to validate</span>}
            {it.count > 1 && <span className="dA-tag">{it.count} comments</span>}
            <b className="dA-author">{it.lastAuthor}</b>
            <span className="dA-age">{ago(it.lastDate)}</span>
          </>
        ),
        sub: it.snippet,
      }));
    }

    const v = data.validate.data;
    if (v) {
      g.validate.count = v.backlogs.reduce((s, b) => s + b.total, 0);
      g.validate.rows = v.backlogs
        .flatMap((b) => b.items)
        .sort((a, b) => (b.waitDays ?? -1) - (a.waitDays ?? -1))
        .map((it) => ({
          key: 'v' + it.id,
          item: it,
          meta: (
            <>
              {it.noPr && <span className="pr-chip nopr" title="No completed pull request: analyse before validating">⚠ No PR</span>}
              {it.viaFeature && <span className="listed-feature" title="Listed because the parent Feature is yours">My Feature</span>}
              <span className={'dA-wait ' + (waitClass(it.waitDays) ?? '')}>{it.waitDays === null ? '—' : `${it.waitDays}d`}</span>
            </>
          ),
        }));
      g.validate.footer = (
        <div className="dA-foot">
          {v.backlogs.map((b) => (
            <span key={b.backlogId} className="dA-foot-item">
              <i style={{ background: b.color }} />
              {b.name}
              {b.error ? (
                <span className="dA-err-txt"> {b.error}</span>
              ) : (
                <>
                  {' '}
                  <span className="muted">{b.total}</span>
                  {b.noPr > 0 && <span className="pr-chip nopr">⚠ {b.noPr}</span>}
                  {b.oldestDays !== null && <span className={waitClass(b.oldestDays)}> oldest {b.oldestDays}d</span>}
                </>
              )}
              <a href={`#/b/${encodeURIComponent(b.backlogId)}/validate`}>{b.total > b.items.length ? `+${b.total - b.items.length} more` : 'open'} →</a>
            </span>
          ))}
        </div>
      );
    }

    const t = data.triage.data;
    if (t) {
      g.triage.count = t.backlogs.reduce((s, b) => s + b.total, 0);
      g.triage.rows = t.backlogs.flatMap((b) =>
        b.items.map((it) => ({ key: 't' + it.id, item: it, meta: <span className="dA-state">{it.state}</span> })),
      );
      g.triage.footer = (
        <div className="dA-foot">
          {t.backlogs.map((b) => (
            <span key={b.backlogId} className="dA-foot-item">
              <i style={{ background: b.color }} />
              {b.name} <span className="muted">{b.total}</span>
              {b.byType.map((x) => (
                <span key={x.key} className="muted"> {x.key} {x.count}</span>
              ))}
              {b.error && <span className="dA-err-txt"> {b.error}</span>}
              <a href={`#/b/${encodeURIComponent(b.backlogId)}`}>{b.total > b.items.length ? `+${b.total - b.items.length} more` : 'open'} →</a>
            </span>
          ))}
        </div>
      );
    }

    const r = data.recent.data;
    if (r) {
      g.recent.title = `Recent · last ${r.days} day${r.days === 1 ? '' : 's'}`;
      g.recent.count = r.items.length;
      g.recent.rows = r.items.map((it) => ({
        key: 'c' + it.id,
        item: it,
        meta: (
          <>
            <span className="dA-state">{it.state}</span>
            <b className="dA-author" title={new Date(it.changedDate).toLocaleString()}>{it.changedBy}</b>
            <span className="dA-age">{ago(it.changedDate)}</span>
          </>
        ),
      }));
    }

    const f = data.features.data;
    if (f) {
      g.flight.count = f.active.length;
      g.flight.rows = f.active.map((x) => ({ key: 'f' + x.id, item: x, meta: null }));
      g.notStarted.count = f.notStarted.length;
      g.notStarted.rows = f.notStarted.map((x) => ({
        key: 'n' + x.id,
        item: x,
        meta: <span className="muted">{x.childCount ? `${x.childCount} item${x.childCount === 1 ? '' : 's'}` : 'no items'}</span>,
      }));
    }
    return g;
  }, [data.comments.data, data.validate.data, data.triage.data, data.recent.data, data.features.data]);

  const featById = useMemo(() => {
    const m = new Map<number, HomeFeature>();
    data.features.data?.active.forEach((x) => m.set(x.id, x));
    return m;
  }, [data.features.data]);

  const visible: Group[] =
    view === 'all'
      ? [groups.reply, groups.validate, groups.triage]
      : view === 'reply' || view === 'validate' || view === 'triage' || view === 'recent'
        ? [groups[view]]
        : view === 'flight'
          ? [groups.flight, groups.notStarted]
          : [];

  const flat = useMemo(() => visible.flatMap((g) => g.rows.map((r) => ({ g, r }))), [visible.map((g) => g.id + g.rows.length + g.rows[0]?.key).join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const selIdx = Math.max(0, flat.findIndex((x) => x.r.key === sel));
  const selKey = flat[selIdx]?.r.key;

  const openRow = (g: Group, r: Row) => p.open(r.item.id, ids(g.rows.map((x) => x.item)));

  // ---- keyboard -------------------------------------------------------------------------------------------------
  const latest = useRef({ flat, selIdx, openRow });
  latest.current = { flat, selIdx, openRow };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector('.modal-details')) return;
      const root = rootRef.current;
      if (!root || root.offsetParent === null) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      const { flat: fl, selIdx: si, openRow: open } = latest.current;
      const move = (d: number) => {
        if (!fl.length) return;
        e.preventDefault();
        const n = Math.min(fl.length - 1, Math.max(0, si + d));
        setSel(fl[n].r.key);
      };
      if (e.key === 'j' || e.key === 'ArrowDown') move(1);
      else if (e.key === 'k' || e.key === 'ArrowUp') move(-1);
      else if (e.key === 'Enter') {
        if (el && (el.closest('.dA-row') || /^(BUTTON|A)$/.test(el.tagName))) return;
        const cur = fl[si];
        if (cur) {
          e.preventDefault();
          open(cur.g, cur.r);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!selKey) return;
    rootRef.current?.querySelector<HTMLElement>(`[data-k="${selKey}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selKey, sel]);

  // ---- derived --------------------------------------------------------------------------------------------------
  const updated = Math.max(0, ...(Object.values(data) as { at: number }[]).map((s) => s.at));
  const nvTotal = data.nextVersion.data?.backlogs.reduce((s, b) => s + b.counts.total, 0) ?? 0;
  const navCount = (n: number, slot: SectionKey) => (data[slot].data ? n : null);

  const nav: { id: View; label: string; count: number | null; divider?: boolean }[] = [
    { id: 'all', label: 'Everything', count: data.comments.data || data.validate.data || data.triage.data ? groups.reply.count + groups.validate.count + groups.triage.count : null },
    { id: 'reply', label: 'Reply', count: navCount(groups.reply.count, 'comments') },
    { id: 'validate', label: 'Validate', count: navCount(groups.validate.count, 'validate') },
    { id: 'triage', label: 'Triage', count: navCount(groups.triage.count, 'triage') },
    { id: 'flight', label: 'In flight', count: navCount(groups.flight.count, 'features'), divider: true },
    { id: 'next', label: data.nextVersion.data ? `Next version ${data.nextVersion.data.tag}` : 'Next version', count: navCount(nvTotal, 'nextVersion') },
    { id: 'recent', label: 'Recent', count: navCount(groups.recent.count, 'recent') },
  ];

  // ---- render pieces --------------------------------------------------------------------------------------------
  const renderRow = (g: Group, r: Row) => {
    const it = r.item;
    const a = area(it.backlogId);
    const selected = r.key === selKey;
    const f = g.id === 'flight' ? featById.get(it.id) : undefined;
    return (
      <div
        key={r.key}
        data-k={r.key}
        className={'dA-row' + (selected ? ' is-sel' : '')}
        role="button"
        tabIndex={0}
        onClick={() => { setSel(r.key); openRow(g, r); }}
        onFocus={() => setSel(r.key)}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openRow(g, r); }
        }}
      >
        <span className="dA-edge" style={{ background: a?.color ?? 'var(--dA-line2)' }} title={a?.name ?? 'Not in a configured area'} />
        <div className="dA-main">
          <span className="dA-id">#{it.id}</span>
          <span className={typeClass(it.type)}>{it.type}</span>
          <span className="dA-title" title={it.title}>{it.title}</span>
          {a && <span className="dA-area">{a.name}</span>}
          {f ? (
            <span className="dA-meta">
              <span className="dA-state">{f.state}</span>
              <span className="dA-prog"><Bar c={f.counts} /></span>
              <span className="dA-pct">{doneCount(f.counts)}/{f.counts.total}{f.counts.total ? ` · ${pctDone(f.counts)}%` : ''}</span>
            </span>
          ) : (
            <span className="dA-meta">{r.meta}</span>
          )}
          <a className="dA-tfs" href={it.url} target="_blank" rel="noopener" title="Open in TFS" aria-label={`Open #${it.id} in TFS`} onClick={(e) => e.stopPropagation()}>↗</a>
        </div>
        {r.sub && <div className="dA-sub">{r.sub}</div>}
        {f && f.children.some((k) => !/^(Resolved|Closed|Removed|Done)$/i.test(k.state)) && (
          <div className="dA-kids" onClick={(e) => e.stopPropagation()}>
            {f.children
              .filter((k) => !/^(Resolved|Closed|Removed|Done)$/i.test(k.state))
              .map((k) => (
                <button key={k.id} className="dA-kid" title={`${k.title} · ${k.state}${k.assignedTo ? ' · ' + k.assignedTo : ''}`}
                  onClick={() => p.open(k.id, ids(f.children))}>
                  <span className="muted">#{k.id}</span> {k.title}
                  <span className={'dA-dot dA-dot-' + k.state.toLowerCase().replace(/\s+/g, '-')} />
                </button>
              ))}
          </div>
        )}
      </div>
    );
  };

  const Err = ({ k }: { k: SectionKey }) =>
    data[k].err ? (
      <div className="dA-err" role="alert">
        <span>Could not load: {data[k].err}</span>
        <button onClick={() => p.reload(k, true)}>Retry</button>
      </div>
    ) : null;

  const Skeleton = () => (
    <div className="dA-skel" aria-busy="true" aria-label="Loading">
      {[0, 1, 2, 3].map((i) => <div key={i} className="dA-skel-row" style={{ width: `${92 - i * 9}%` }} />)}
    </div>
  );

  const renderGroup = (g: Group) => {
    const slot = data[g.slot];
    const ready = slot.data !== null;
    return (
      <section key={g.id} className="dA-group" aria-label={g.title}>
        <h3 className="dA-ghead">
          <span>{g.title}</span>
          {ready && <span className="dA-gcount">· {g.count}</span>}
          {slot.loading && ready && <span className="dA-mini-spin" aria-hidden="true" />}
        </h3>
        <Err k={g.slot} />
        {!ready && !slot.err && <Skeleton />}
        {ready && g.rows.length === 0 && g.empty && <div className="dA-empty">{g.empty}</div>}
        {ready && g.rows.map((r) => renderRow(g, r))}
        {ready && g.footer}
      </section>
    );
  };

  const nv = data.nextVersion;
  const feats = data.features;

  const nextPanel = (compact: boolean) => (
    <div className={compact ? 'dA-nv' : 'dA-nv dA-nv-big'}>
      {nv.err && <Err k="nextVersion" />}
      {!nv.data && !nv.err && <Skeleton />}
      {nv.data && nv.data.backlogs.length === 0 && <div className="dA-empty">No items tagged {nv.data.tag}.</div>}
      {nv.data?.backlogs.map((b) => (
        <div key={b.backlogId} className="dA-nv-item">
          <div className="dA-nv-head">
            <i style={{ background: b.color }} />
            <a href={`#/b/${encodeURIComponent(b.backlogId)}`}>{b.name}</a>
            <span className="grow" />
            <b>{b.error ? '—' : pctDone(b.counts) + '%'}</b>
          </div>
          {b.error ? <div className="dA-err-txt">{b.error}</div> : (
            <>
              <Bar c={b.counts} />
              <div className="dA-nv-legend">
                {SEGMENTS.filter((s) => b.counts[s.key] > 0).map((s) => (
                  <span key={s.key}><i style={{ background: s.color }} />{s.label} {b.counts[s.key]}</span>
                ))}
                <span className="grow" />
                {!compact && b.byType.map((t) => <span key={t.key} className="muted">{t.key} {t.count}</span>)}
                {compact && <span className="muted">{b.counts.total}</span>}
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );

  const rail = (
    <aside className="dA-rail" aria-label="Overview">
      <div className="dA-rail-sec">
        <h4>In flight {feats.data && <span className="muted">· {feats.data.active.length}</span>}</h4>
        <Err k="features" />
        {!feats.data && !feats.err && <Skeleton />}
        {feats.data && feats.data.active.length === 0 && <div className="dA-empty">No Active Features.</div>}
        {feats.data?.active.map((f) => (
          <button key={f.id} className="dA-feat" onClick={() => p.open(f.id, ids(feats.data!.active))} title={f.title}>
            <span className="dA-feat-top">
              <i style={{ background: area(f.backlogId)?.color ?? 'var(--dA-line2)' }} />
              <span className="dA-feat-title">{f.title}</span>
            </span>
            <Bar c={f.counts} />
            <span className="dA-feat-meta">
              <span>{doneCount(f.counts)}/{f.counts.total} done</span>
              <b>{f.counts.total ? pctDone(f.counts) + '%' : '—'}</b>
            </span>
          </button>
        ))}
      </div>
      <div className="dA-rail-sec">
        <h4>Next version {nv.data && <span className="muted">· {nv.data.tag}</span>}</h4>
        {nextPanel(true)}
      </div>
    </aside>
  );

  return (
    <div className="dA" ref={rootRef}>
      <nav className="dA-side" aria-label="Sections">
        {nav.map((n) => (
          <div key={n.id}>
            {n.divider && <hr className="dA-div" />}
            <button className={'dA-nav' + (view === n.id ? ' on' : '')} aria-current={view === n.id ? 'page' : undefined} onClick={() => setView(n.id)}>
              <span>{n.label}</span>
              {n.count !== null && <span className={'dA-navc' + (n.count > 0 && n.id !== 'recent' && n.id !== 'next' ? ' hot' : '')}>{n.count}</span>}
            </button>
          </div>
        ))}
        <div className="dA-keys muted"><kbd>j</kbd><kbd>k</kbd> move · <kbd>↵</kbd> open</div>
      </nav>

      <main className="dA-center">
        <header className="dA-top">
          <div>
            <h2>{hello()}{firstName(p.me) ? `, ${firstName(p.me)}` : ''}</h2>
            <div className="muted">{dateStr()}</div>
          </div>
          <span className="grow" />
          {updated > 0 && <span className="dA-upd muted">updated {hhmm(updated)}</span>}
          <button className="dA-refresh" onClick={() => p.refreshAll()} disabled={p.loading} aria-label="Refresh all sections from TFS">
            <span className={p.loading ? 'dA-spin' : ''} aria-hidden="true">↻</span> {p.loading ? 'Refreshing' : 'Refresh'}
          </button>
        </header>

        {view === 'next' ? (
          <section className="dA-group">
            <h3 className="dA-ghead"><span>Next version{nv.data ? ` · ${nv.data.tag}` : ''}</span></h3>
            {nextPanel(false)}
          </section>
        ) : (
          visible.filter((g) => g.id !== 'notStarted' || g.count > 0).map(renderGroup)
        )}
        {view === 'recent' && null}
      </main>

      {rail}
    </div>
  );
}
