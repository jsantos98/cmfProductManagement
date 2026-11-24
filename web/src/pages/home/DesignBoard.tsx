import { useState } from 'react';
import type { ReactNode } from 'react';
import type { HomeFeature, HomeItemRef, StateCounts } from '../../../../server/src/types';
import { SEGMENTS, ago, backlogOf, doneCount, firstName, hello, pctDone, typeClass, waitClass } from './kit';
import type { DesignProps, Slot } from './kit';
import './designBoard.css';

const initials = (n: string) =>
  n.split(/[\s,.<]+/).filter(Boolean).slice(0, 2).map((s) => s[0]!.toUpperCase()).join('') || '?';

function Bar({ c, thin }: { c: StateCounts; thin?: boolean }) {
  const tip = SEGMENTS.filter((s) => c[s.key] > 0).map((s) => `${s.label} ${c[s.key]}`).join(' · ') || 'no items';
  return (
    <div className={'dC-bar' + (thin ? ' dC-bar-thin' : '')} title={tip}>
      {c.total > 0 && SEGMENTS.map((s) => (c[s.key] > 0 ? <span key={s.key} style={{ flexGrow: c[s.key], background: s.color }} /> : null))}
    </div>
  );
}

interface CardProps {
  it: HomeItemRef;
  p: DesignProps;
  list: number[];
  children?: ReactNode;
  extra?: ReactNode;
}
function Card({ it, p, list, children, extra }: CardProps) {
  const area = backlogOf(p.backlogs, it.backlogId);
  const go = () => p.open(it.id, list);
  return (
    <div
      className="dC-card"
      style={{ borderLeftColor: area?.color ?? '#c5cad3' }}
      tabIndex={0}
      role="button"
      onClick={go}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          go();
        }
      }}
    >
      <div className="dC-top">
        <span className="dC-id">#{it.id}</span>
        <span className={typeClass(it.type)}>{it.type}</span>
        <span className="dC-grow" />
        <a className="dC-tfs" href={it.url} target="_blank" rel="noopener" title="Open in TFS" onClick={(e) => e.stopPropagation()}>
          ↗
        </a>
      </div>
      <div className="dC-title" title={it.title}>{it.title}</div>
      {children && <div className="dC-meta">{children}</div>}
      {extra}
    </div>
  );
}

function Skeleton() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <div key={i} className="dC-card dC-skel" aria-hidden>
          <div className="dC-sk" style={{ width: '40%' }} />
          <div className="dC-sk" />
          <div className="dC-sk" style={{ width: '70%' }} />
        </div>
      ))}
    </>
  );
}

interface ColProps<T> {
  icon: string;
  name: string;
  color: string;
  slot: Slot<T>;
  count: (d: T) => number;
  isEmpty: (d: T) => boolean;
  emptyText: string;
  retry: () => void;
  footer?: ReactNode;
  children: (d: T) => ReactNode;
}
function Column<T>(c: ColProps<T>) {
  const { data, err, loading } = c.slot;
  return (
    <section className="dC-col" style={{ borderTopColor: c.color }}>
      <header className="dC-colhead">
        <span>{c.icon}</span>
        <h3>{c.name}</h3>
        <span className="dC-count" style={{ background: c.color + '22', color: c.color }}>{data ? c.count(data) : '–'}</span>
      </header>
      <div className="dC-colbody">
        {err && (
          <div className="dC-err" role="alert">
            <span>{err}</span>
            <button type="button" onClick={c.retry}>Retry</button>
          </div>
        )}
        {!data && loading && <Skeleton />}
        {data && (c.isEmpty(data) ? <div className="dC-empty"><b>{c.emptyText}</b></div> : c.children(data))}
      </div>
      {data && c.footer}
    </section>
  );
}

function AreaHead({ b, n, link, label }: { b: { name: string; color: string }; n: number; link: string; label: string }) {
  return (
    <div className="dC-area">
      <span className="dC-dot" style={{ background: b.color }} />
      <b>{b.name}</b>
      <span className="dC-areacount">{n}</span>
      <span className="dC-grow" />
      <a href={link}>{label} →</a>
    </div>
  );
}

function FeatureCard({ f, p, list }: { f: HomeFeature; p: DesignProps; list: number[] }) {
  const [openKids, setOpenKids] = useState(false);
  const kids = f.children;
  return (
    <Card
      it={f}
      p={p}
      list={list}
      extra={
        <>
          <div className="dC-prog">
            <Bar c={f.counts} />
            <span className="dC-progtxt">{doneCount(f.counts)}/{f.counts.total} · {pctDone(f.counts)}%</span>
          </div>
          {kids.length > 0 && (
            <button
              type="button"
              className="dC-toggle"
              aria-expanded={openKids}
              onClick={(e) => { e.stopPropagation(); setOpenKids((v) => !v); }}
              onKeyDown={(e) => e.stopPropagation()}
            >
              {openKids ? '▾' : '▸'} {kids.length} item{kids.length === 1 ? '' : 's'}
            </button>
          )}
          {openKids && (
            <ul className="dC-kids" onClick={(e) => e.stopPropagation()}>
              {kids.map((k) => (
                <li key={k.id}>
                  <button
                    type="button"
                    className="dC-kid"
                    onClick={(e) => { e.stopPropagation(); p.open(k.id, kids.map((x) => x.id)); }}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <span className={'dC-state dC-state-' + k.state.toLowerCase().replace(/\s+/g, '-')} title={k.state} />
                    <span className="dC-kidid">#{k.id}</span>
                    <span className="dC-kidtitle" title={k.title}>{k.title}</span>
                    {k.assignedTo && <span className="dC-av dC-av-s" title={k.assignedTo}>{initials(k.assignedTo)}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      }
    />
  );
}

export default function DesignBoard(p: DesignProps) {
  const { data: d } = p;
  const slots = [d.comments, d.features, d.validate, d.triage, d.nextVersion, d.recent];
  const at = Math.max(...slots.map((s) => s.at));
  const time = at ? new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  const name = firstName(p.me);
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const nv = d.nextVersion;
  const ns = d.features.data?.notStarted ?? [];

  return (
    <div className="dC">
      <div className="dC-head">
        <div>
          <h2>{hello()}{name ? `, ${name}` : ''}</h2>
          <div className="dC-date">{today}</div>
        </div>
        <span className="dC-grow" />
        {time && <span className="dC-upd">updated {time}</span>}
        <button type="button" className="dC-refresh" disabled={p.loading} onClick={p.refreshAll}>
          <span className={p.loading ? 'dC-spin' : ''}>↻</span> Refresh
        </button>
      </div>

      <div className="dC-nv">
        <div className="dC-nvlabel">Next version{nv.data ? <b> {nv.data.tag}</b> : ''}</div>
        {nv.err && (
          <div className="dC-err dC-err-inline" role="alert">
            <span>{nv.err}</span>
            <button type="button" onClick={() => p.reload('nextVersion', true)}>Retry</button>
          </div>
        )}
        {!nv.data && nv.loading && <div className="dC-sk dC-nvsk" />}
        {nv.data?.backlogs.map((b) => (
          <a key={b.backlogId} className="dC-nvitem" href={`#/b/${encodeURIComponent(b.backlogId)}`} title={`Open ${b.name} backlog`}>
            <div className="dC-nvrow">
              <span className="dC-dot" style={{ background: b.color }} />
              <b>{b.name}</b>
              <span className="dC-grow" />
              {b.error ? <span className="dC-bad" title={b.error}>error</span> : <span className="dC-nvpct">{pctDone(b.counts)}% done</span>}
              <span className="dC-muted">{b.counts.total}</span>
            </div>
            <Bar c={b.counts} thin />
          </a>
        ))}
      </div>

      <div className="dC-board">
        <Column
          icon="💬" name="Reply" color="#e58a2b" slot={d.comments}
          count={(x) => x.items.length} isEmpty={(x) => !x.items.length}
          emptyText="Inbox zero ✨" retry={() => p.reload('comments', true)}
        >
          {(x) => {
            const list = x.items.map((i) => i.id);
            return (
              <>
                {x.items.map((it) => (
                  <Card key={it.id} it={it} p={p} list={list}>
                    <span className="dC-av" title={it.lastAuthor}>{initials(it.lastAuthor)}</span>
                    <span className="dC-chip">{it.lastAuthor.split(' ')[0]} · {ago(it.lastDate)}</span>
                    {it.count > 0 && <span className="dC-chip">💬 {it.count} comment{it.count === 1 ? '' : 's'}</span>}
                    {it.view === 'validate' && <span className="dC-chip dC-chip-v">to validate</span>}
                    <div className="dC-snippet">{it.snippet}</div>
                  </Card>
                ))}
                {x.errors > 0 && <div className="dC-warn">{x.errors} item(s) could not be checked</div>}
              </>
            );
          }}
        </Column>

        <Column
          icon="✓" name="Validate" color="#2e9e6b" slot={d.validate}
          count={(x) => x.backlogs.reduce((s, b) => s + b.total, 0)}
          isEmpty={(x) => x.backlogs.every((b) => !b.items.length && !b.error)}
          emptyText="Nothing to validate ✨" retry={() => p.reload('validate', true)}
        >
          {(x) => {
            const list = x.backlogs.flatMap((b) => b.items.map((i) => i.id));
            return x.backlogs.filter((b) => b.items.length || b.error).map((b) => (
              <div key={b.backlogId} className="dC-group">
                <AreaHead b={b} n={b.total} link={`#/b/${encodeURIComponent(b.backlogId)}/validate`} label="Open To validate" />
                {b.error && <div className="dC-err"><span>{b.error}</span></div>}
                {b.items.map((it) => (
                  <Card key={it.id} it={it} p={p} list={list}>
                    {it.noPr && <span className="pr-chip nopr">⚠ No PR</span>}
                    {it.viaFeature && <span className="listed-feature">My Feature</span>}
                    <span className={'dC-chip ' + (waitClass(it.waitDays) ?? '')}>⏱ {it.waitDays === null ? '—' : `${it.waitDays}d`}</span>
                  </Card>
                ))}
                {b.total > b.items.length && <div className="dC-more">+{b.total - b.items.length} more</div>}
              </div>
            ));
          }}
        </Column>

        <Column
          icon="🧭" name="Triage" color="#7b61c9" slot={d.triage}
          count={(x) => x.backlogs.reduce((s, b) => s + b.total, 0)}
          isEmpty={(x) => x.backlogs.every((b) => !b.items.length && !b.error)}
          emptyText="Everything triaged ✨" retry={() => p.reload('triage', true)}
        >
          {(x) => {
            const list = x.backlogs.flatMap((b) => b.items.map((i) => i.id));
            return x.backlogs.filter((b) => b.items.length || b.error).map((b) => (
              <div key={b.backlogId} className="dC-group">
                <AreaHead b={b} n={b.total} link={`#/b/${encodeURIComponent(b.backlogId)}`} label="Open backlog" />
                {b.error && <div className="dC-err"><span>{b.error}</span></div>}
                {b.items.map((it) => (
                  <Card key={it.id} it={it} p={p} list={list}>
                    <span className="dC-chip">{it.state}</span>
                    <span className="dC-chip dC-chip-area">{backlogOf(p.backlogs, it.backlogId)?.name ?? 'No area'}</span>
                  </Card>
                ))}
                {b.total > b.items.length && <div className="dC-more">+{b.total - b.items.length} more in the backlog</div>}
              </div>
            ));
          }}
        </Column>

        <Column
          icon="🚀" name="In flight" color="#1976d2" slot={d.features}
          count={(x) => x.active.length} isEmpty={(x) => !x.active.length && !x.notStarted.length}
          emptyText="No Features assigned to you" retry={() => p.reload('features', true)}
          footer={
            ns.length > 0 ? (
              <details className="dC-ns">
                <summary>Not started ({ns.length})</summary>
                <ul>
                  {ns.map((f) => (
                    <li key={f.id}>
                      <button type="button" onClick={() => p.open(f.id, ns.map((x) => x.id))}>
                        <span className="dC-dot" style={{ background: backlogOf(p.backlogs, f.backlogId)?.color ?? '#c5cad3' }} />
                        <span className="dC-kidid">#{f.id}</span>
                        <span className="dC-kidtitle" title={f.title}>{f.title}</span>
                        <span className="dC-muted">{f.childCount || 0}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null
          }
        >
          {(x) => {
            const list = x.active.map((f) => f.id);
            return x.active.length ? x.active.map((f) => <FeatureCard key={f.id} f={f} p={p} list={list} />) : <div className="dC-empty">No Active Features</div>;
          }}
        </Column>

        <Column
          icon="🕑" name="Recent" color="#8a94a6" slot={d.recent}
          count={(x) => x.items.length} isEmpty={(x) => !x.items.length}
          emptyText="Quiet lately" retry={() => p.reload('recent', true)}
        >
          {(x) => {
            const list = x.items.map((i) => i.id);
            return (
              <>
                {x.items.map((it) => (
                  <Card key={it.id} it={it} p={p} list={list}>
                    <span className="dC-av" title={it.changedBy}>{initials(it.changedBy)}</span>
                    <span className="dC-chip">{it.changedBy.split(' ')[0]} · {ago(it.changedDate)}</span>
                    <span className="dC-chip">{it.state}</span>
                  </Card>
                ))}
                <div className="dC-more">last {x.days} day{x.days === 1 ? '' : 's'}{x.errors ? ` · ${x.errors} error(s)` : ''}</div>
              </>
            );
          }}
        </Column>
      </div>
    </div>
  );
}
