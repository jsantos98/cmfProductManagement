import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  BacklogDef,
  HomeCommentsResponse,
  HomeFeature,
  HomeFeaturesResponse,
  HomeItemRef,
  HomeNextVersionResponse,
  HomeRecentResponse,
  HomeTriageResponse,
  HomeValidateResponse,
  StateCounts,
} from '../../../server/src/types';
import { api } from '../api';
import ItemDetailsModal from '../components/ItemDetailsModal';

// ---- helpers ---------------------------------------------------------------------------------------------------

const typeClass = (t: string) => 'pill pill-' + t.toLowerCase().replace(/\s+/g, '-');

/** "5m", "3h", "2d" since an ISO date ('' when unknown). */
export function ago(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const m = Math.max(0, Math.round((Date.now() - t) / 60_000));
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

const waitClass = (d: number | null) => (d === null ? 'muted' : d >= 30 ? 'wait-red' : d >= 14 ? 'wait-amber' : undefined);

const SEGMENTS: { key: keyof Omit<StateCounts, 'total'>; label: string }[] = [
  { key: 'closed', label: 'Closed' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'active', label: 'Active' },
  { key: 'new', label: 'New' },
  { key: 'other', label: 'Other' },
];
const done = (c: StateCounts) => c.closed + c.resolved;
const pct = (c: StateCounts) => (c.total ? Math.round((100 * done(c)) / c.total) : 0);

/** Stacked bar of item states (Closed / Resolved / Active / New / other). */
function Progress({ c }: { c: StateCounts }) {
  const tip = SEGMENTS.filter((s) => c[s.key] > 0).map((s) => `${s.label} ${c[s.key]}`).join(' · ') || 'no items';
  return (
    <div className="progress" title={tip}>
      {c.total > 0 &&
        SEGMENTS.map((s) =>
          c[s.key] > 0 ? <span key={s.key} className={'seg seg-' + s.key} style={{ flexGrow: c[s.key] }} /> : null,
        )}
    </div>
  );
}

// ---- page context and shared pieces -----------------------------------------------------------------------------

interface HomeCtx {
  backlogs: BacklogDef[];
  /** open the details of `id`; ↑/↓ steps through `list` */
  open: (id: number, list: number[]) => void;
}

function AreaDot({ ctx, id }: { ctx: HomeCtx; id: string | null }) {
  const b = id ? ctx.backlogs.find((x) => x.id === id) : undefined;
  return b ? <span className="dot" style={{ background: b.color }} title={b.name} /> : <span className="dot dot-none" title="Not in a configured area" />;
}

/** One clickable item line: #id, type, title, then the card's own extras on the right. */
function ItemLine({ it, ctx, list, children, sub }: { it: HomeItemRef; ctx: HomeCtx; list: number[]; children?: ReactNode; sub?: ReactNode }) {
  return (
    <li className="home-row" onClick={() => ctx.open(it.id, list)}>
      <div className="home-row-main">
        <AreaDot ctx={ctx} id={it.backlogId} />
        <span className="home-id">#{it.id}</span>
        <span className={typeClass(it.type)}>{it.type}</span>
        <span className="home-title" title={it.title}>{it.title}</span>
        {children && <span className="home-extra">{children}</span>}
        <a className="home-tfs" href={it.url} target="_blank" rel="noopener" title="Open in TFS" onClick={(e) => e.stopPropagation()}>
          ↗
        </a>
      </div>
      {sub && <div className="home-sub">{sub}</div>}
    </li>
  );
}

function GroupHead({ b, children, link, linkLabel }: { b: { name: string; color: string }; children?: ReactNode; link: string; linkLabel: string }) {
  return (
    <div className="home-group-head">
      <span className="dot" style={{ background: b.color }} />
      <b>{b.name}</b>
      {children}
      <span className="grow" />
      <a href={link}>{linkLabel} →</a>
    </div>
  );
}

const ids = (xs: { id: number }[]) => xs.map((x) => x.id);

// ---- sections ---------------------------------------------------------------------------------------------------

/**
 * Section registry: to add a section, add an endpoint + one entry here.
 * `count` feeds the badge in the card header (null = no badge).
 */
interface SectionDef<T> {
  id: string;
  title: (d: T | null) => string;
  load: (refresh: boolean) => Promise<T>;
  count: (d: T) => number | null;
  render: (d: T, ctx: HomeCtx) => ReactNode;
  /** spans both grid columns */
  wide?: boolean;
}
const section = <T,>(s: SectionDef<T>) => s as unknown as SectionDef<unknown>;

const SECTIONS: SectionDef<unknown>[] = [
  section<HomeCommentsResponse>({
    id: 'comments',
    title: () => '💬 Comments to reply',
    load: (r) => api.home.comments(r),
    count: (d) => d.items.length,
    render: (d, ctx) => {
      if (!d.items.length) return <Empty text="Nothing waiting for you 🎉" warn={d.errors ? `${d.errors} item(s) could not be checked` : undefined} />;
      const list = ids(d.items);
      return (
        <ul className="home-list">
          {d.items.map((it) => (
            <ItemLine
              key={it.id}
              it={it}
              ctx={ctx}
              list={list}
              sub={
                <>
                  <b>{it.lastAuthor}</b> · {ago(it.lastDate)} ago{it.count > 1 ? ` · ${it.count} comments` : ''}
                  {it.view === 'validate' && <span className="badge">to validate</span>} — <span className="muted">{it.snippet}</span>
                </>
              }
            />
          ))}
        </ul>
      );
    },
  }),
  section<HomeFeaturesResponse>({
    id: 'features',
    title: () => '🚀 Running features',
    load: (r) => api.home.features(r),
    count: (d) => d.active.length,
    render: (d, ctx) => (
      <>
        {!d.active.length && <Empty text="No Active Features assigned to you" />}
        <ul className="home-list">
          {d.active.map((f) => (
            <FeatureRow key={f.id} f={f} ctx={ctx} list={ids(d.active)} />
          ))}
        </ul>
        {d.notStarted.length > 0 && (
          <details className="home-more">
            <summary>Not started ({d.notStarted.length})</summary>
            <ul className="home-list">
              {d.notStarted.map((f) => (
                <ItemLine key={f.id} it={f} ctx={ctx} list={ids(d.notStarted)}>
                  <span className="muted">{f.childCount ? `${f.childCount} item${f.childCount === 1 ? '' : 's'}` : 'no items'}</span>
                </ItemLine>
              ))}
            </ul>
          </details>
        )}
      </>
    ),
  }),
  section<HomeValidateResponse>({
    id: 'validate',
    title: () => '✓ To validate',
    load: (r) => api.home.validate(r),
    count: (d) => d.backlogs.reduce((s, b) => s + b.total, 0),
    render: (d, ctx) => (
      <>
        {d.backlogs.map((b) => (
          <div key={b.backlogId} className="home-group">
            <GroupHead b={b} link={`#/b/${encodeURIComponent(b.backlogId)}/validate`} linkLabel="Open To validate">
              <span className="badge">{b.total}</span>
              {b.noPr > 0 && <span className="pr-chip nopr" title="No completed pull request: analyse before validating">⚠ No PR {b.noPr}</span>}
              {b.viaFeature > 0 && <span className="listed-feature" title="Listed because the parent Feature is yours">My Feature {b.viaFeature}</span>}
              {b.oldestDays !== null && <span className={waitClass(b.oldestDays)} title="Oldest waiting">oldest {b.oldestDays}d</span>}
            </GroupHead>
            {b.error && <div className="banner error">{b.error}</div>}
            {!b.error && b.total === 0 && <div className="muted home-empty-line">Nothing to validate</div>}
            <ul className="home-list">
              {b.items.map((it) => (
                <ItemLine key={it.id} it={it} ctx={ctx} list={ids(b.items)}>
                  {it.noPr && <span className="pr-chip nopr">⚠ No PR</span>}
                  {it.viaFeature && <span className="listed-feature">My Feature</span>}
                  <span className={waitClass(it.waitDays)}>{it.waitDays === null ? '—' : `${it.waitDays}d`}</span>
                </ItemLine>
              ))}
            </ul>
          </div>
        ))}
      </>
    ),
  }),
  section<HomeTriageResponse>({
    id: 'triage',
    title: () => '🧭 Triage (BO −1)',
    load: (r) => api.home.triage(r),
    count: (d) => d.backlogs.reduce((s, b) => s + b.total, 0),
    render: (d, ctx) => (
      <>
        {d.backlogs.map((b) => (
          <div key={b.backlogId} className="home-group">
            <GroupHead b={b} link={`#/b/${encodeURIComponent(b.backlogId)}`} linkLabel="Open backlog">
              <span className="badge">{b.total}</span>
              {b.byType.map((t) => (
                <span key={t.key} className="muted">
                  {t.key} {t.count}
                </span>
              ))}
            </GroupHead>
            {b.error && <div className="banner error">{b.error}</div>}
            {!b.error && b.total === 0 && <div className="muted home-empty-line">Nothing to triage</div>}
            <ul className="home-list">
              {b.items.map((it) => (
                <ItemLine key={it.id} it={it} ctx={ctx} list={ids(b.items)}>
                  <span className="muted">{it.state}</span>
                </ItemLine>
              ))}
            </ul>
            {b.total > b.items.length && <div className="muted home-empty-line">+{b.total - b.items.length} more in the backlog</div>}
          </div>
        ))}
      </>
    ),
  }),
  section<HomeNextVersionResponse>({
    id: 'next-version',
    title: (d) => `🎯 Next version${d ? ` (${d.tag})` : ''}`,
    load: (r) => api.home.nextVersion(r),
    count: (d) => d.backlogs.reduce((s, b) => s + b.counts.total, 0),
    render: (d) => (
      <>
        {d.backlogs.map((b) => (
          <div key={b.backlogId} className="home-group">
            <GroupHead b={b} link={`#/b/${encodeURIComponent(b.backlogId)}`} linkLabel="Open backlog">
              <span className="badge">{b.counts.total}</span>
              <span>
                <b>{pct(b.counts)}%</b> <span className="muted">done (Resolved + Closed)</span>
              </span>
            </GroupHead>
            {b.error ? (
              <div className="banner error">{b.error}</div>
            ) : (
              <>
                <Progress c={b.counts} />
                <div className="home-legend">
                  {SEGMENTS.filter((s) => b.counts[s.key] > 0).map((s) => (
                    <span key={s.key}>
                      <span className={'swatch seg-' + s.key} /> {s.label} {b.counts[s.key]}
                    </span>
                  ))}
                  <span className="grow" />
                  {b.byType.map((t) => (
                    <span key={t.key} className="muted">
                      {t.key} {t.count}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        ))}
      </>
    ),
  }),
  section<HomeRecentResponse>({
    id: 'recent',
    title: (d) => `🕑 Recently changed${d ? ` (last ${d.days} day${d.days === 1 ? '' : 's'})` : ''}`,
    load: (r) => api.home.recent(r),
    count: (d) => d.items.length,
    render: (d, ctx) => {
      if (!d.items.length) return <Empty text="No changes by others" warn={d.errors ? `${d.errors} area(s) could not be read` : undefined} />;
      const list = ids(d.items);
      return (
        <ul className="home-list">
          {d.items.map((it) => (
            <ItemLine key={it.id} it={it} ctx={ctx} list={list}>
              <span className="muted">{it.state}</span>
              <span title={new Date(it.changedDate).toLocaleString()}>
                {it.changedBy} · {ago(it.changedDate)}
              </span>
            </ItemLine>
          ))}
        </ul>
      );
    },
  }),
];

function Empty({ text, warn }: { text: string; warn?: string }) {
  return (
    <div className="home-empty">
      {text}
      {warn && <div className="error-text">{warn}</div>}
    </div>
  );
}

function FeatureRow({ f, ctx, list }: { f: HomeFeature; ctx: HomeCtx; list: number[] }) {
  const [open, setOpen] = useState(false);
  const c = f.counts;
  return (
    <ItemLine
      it={f}
      ctx={ctx}
      list={list}
      sub={
        <>
          <div className="feature-progress">
            <button
              className="fold-btn"
              title={open ? 'Hide items' : 'Show items'}
              onClick={(e) => {
                e.stopPropagation();
                setOpen((o) => !o);
              }}
              disabled={!f.children.length}
            >
              {open ? '▾' : '▸'}
            </button>
            <Progress c={c} />
            <span className="feature-done">
              {done(c)}/{c.total} done{c.total ? ` · ${pct(c)}%` : ''}
            </span>
            <span className="muted">
              {c.active ? `${c.active} active` : ''}
              {c.active && c.new ? ' · ' : ''}
              {c.new ? `${c.new} new` : ''}
            </span>
          </div>
          {open && (
            <ul className="home-list home-children" onClick={(e) => e.stopPropagation()}>
              {f.children.map((k) => (
                <ItemLine key={k.id} it={k} ctx={ctx} list={ids(f.children)}>
                  <span className="muted">{k.state}</span>
                  <span className="muted">{k.assignedTo}</span>
                </ItemLine>
              ))}
            </ul>
          )}
        </>
      }
    >
      <span className="muted">{f.state}</span>
    </ItemLine>
  );
}

// ---- cards ------------------------------------------------------------------------------------------------------

interface CardState { data: unknown; err: string | null; loading: boolean; at: number }

function Card({ def, ctx, tick, active }: { def: SectionDef<unknown>; ctx: HomeCtx; tick: { n: number; refresh: boolean }; active: boolean }) {
  const [st, setSt] = useState<CardState>({ data: null, err: null, loading: true, at: 0 });
  const seq = useRef(0);
  const load = useCallback(
    async (refresh: boolean) => {
      const my = ++seq.current;
      setSt((s) => ({ ...s, loading: true }));
      try {
        const data = await def.load(refresh);
        if (my === seq.current) setSt({ data, err: null, loading: false, at: Date.now() });
      } catch (e) {
        if (my === seq.current) setSt((s) => ({ ...s, err: e instanceof Error ? e.message : String(e), loading: false, at: Date.now() }));
      }
    },
    [def],
  );
  useEffect(() => {
    void load(tick.refresh);
  }, [tick, load]);
  // coming back to Home: reload data older than a minute (server caches keep this cheap)
  const atRef = useRef(0);
  atRef.current = st.at;
  useEffect(() => {
    if (active && atRef.current && Date.now() - atRef.current > 60_000) void load(false);
  }, [active, load]);

  const n = st.data !== null ? def.count(st.data) : null;
  return (
    <section className={'home-card' + (def.wide ? ' wide' : '')}>
      <header className="home-card-head">
        <h3>{def.title(st.data)}</h3>
        {n !== null && <span className={'badge' + (n > 0 ? ' count' : '')}>{n}</span>}
        <span className="grow" />
        {st.at > 0 && <span className="muted home-card-at">{new Date(st.at).toLocaleTimeString()}</span>}
        <button className="home-card-refresh" onClick={() => void load(true)} disabled={st.loading} title="Refresh from TFS">
          {st.loading ? '…' : '↻'}
        </button>
      </header>
      <div className={'home-card-body' + (st.loading && st.data !== null ? ' dim' : '')}>
        {st.err && <div className="banner error">{st.err}</div>}
        {st.data === null && st.loading && <div className="muted">Loading…</div>}
        {st.data !== null && def.render(st.data, ctx)}
      </div>
    </section>
  );
}

// ---- page -------------------------------------------------------------------------------------------------------

interface Props {
  active: boolean;
  backlogs: BacklogDef[];
  /** called after Mark handled / Undo in the details (tab badges) */
  onAttentionChanged?: () => void;
}

export default function HomePage({ active, backlogs, onAttentionChanged }: Props) {
  const [tick, setTick] = useState({ n: 0, refresh: false });
  const [detail, setDetail] = useState<{ id: number; list: number[] } | null>(null);
  const ctx: HomeCtx = { backlogs, open: (id, list) => setDetail({ id, list }) };

  // auto refresh: every 5 minutes while visible
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    const t = window.setInterval(() => {
      if (activeRef.current && document.visibilityState === 'visible') setTick((k) => ({ n: k.n + 1, refresh: false }));
    }, 5 * 60_000);
    return () => window.clearInterval(t);
  }, []);

  const step = (delta: -1 | 1) =>
    setDetail((d) => {
      if (!d) return d;
      const i = d.list.indexOf(d.id);
      const j = i + delta;
      return i < 0 || j < 0 || j >= d.list.length ? d : { ...d, id: d.list[j] };
    });

  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 19 ? 'Good afternoon' : 'Good evening';

  return (
    <div className={'page home' + (active ? '' : ' hidden')}>
      <div className="home-top">
        <h2>{hello}</h2>
        <span className="muted">{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
        <span className="grow" />
        <button onClick={() => setTick((k) => ({ n: k.n + 1, refresh: true }))} title="Reload every section from TFS">
          ↻ Refresh all
        </button>
      </div>
      <div className="home-grid">
        {SECTIONS.map((s) => (
          <Card key={s.id} def={s} ctx={ctx} tick={tick} active={active} />
        ))}
      </div>
      {detail && (
        <ItemDetailsModal
          id={detail.id}
          bands={[]}
          onClose={() => setDetail(null)}
          onOpen={(id) => setDetail((d) => ({ id, list: d?.list ?? [id] }))}
          onStep={step}
          onAttentionChanged={() => {
            onAttentionChanged?.();
            setTick((k) => ({ n: k.n + 1, refresh: false }));
          }}
        />
      )}
    </div>
  );
}
