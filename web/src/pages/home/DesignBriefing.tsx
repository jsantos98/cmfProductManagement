import { useState } from 'react';
import type { ReactNode } from 'react';
import type { HomeItemRef, StateCounts } from '../../../../server/src/types';
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
import './designBriefing.css';

const SHOW = 5;
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const secId = (k: string) => 'dD-sec-' + k;
const scrollTo = (k: string) => document.getElementById(secId(k))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
const daysSince = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, Math.floor((Date.now() - t) / 86_400_000)) : null;
};
const hhmm = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function Bar({ c }: { c: StateCounts }) {
  const tip = SEGMENTS.filter((s) => c[s.key] > 0).map((s) => `${s.label} ${c[s.key]}`).join(' · ') || 'no items';
  return (
    <div className="dD-bar" title={tip} role="img" aria-label={tip}>
      {c.total > 0 &&
        SEGMENTS.map((s) => (c[s.key] > 0 ? <span key={s.key} style={{ flexGrow: c[s.key], background: s.color }} /> : null))}
    </div>
  );
}

function Dot({ p, id }: { p: DesignProps; id: string | null }) {
  const b = backlogOf(p.backlogs, id);
  return <span className="dD-dot" style={{ background: b?.color ?? '#c9c4bc' }} title={b?.name ?? 'Not in a configured area'} />;
}

function activate(e: React.KeyboardEvent, fn: () => void) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fn();
  }
}

function Row({
  p, it, list, meta, chips,
}: { p: DesignProps; it: HomeItemRef; list: number[]; meta: ReactNode; chips?: ReactNode }) {
  const b = backlogOf(p.backlogs, it.backlogId);
  const go = () => p.open(it.id, list);
  return (
    <li className="dD-row">
      <div className="dD-row-main" role="button" tabIndex={0} onClick={go} onKeyDown={(e) => activate(e, go)}>
        <div className="dD-row-title">
          <span className="dD-title">{it.title}</span>
          <a className="dD-ext" href={it.url} target="_blank" rel="noopener noreferrer" title="Open in TFS" aria-label={`Open #${it.id} in TFS`} onClick={(e) => e.stopPropagation()}>
            ↗
          </a>
        </div>
        <div className="dD-meta">
          <span className="dD-id">#{it.id}</span>
          <span className={'dD-type ' + typeClass(it.type).split(' ')[1]}>{it.type}</span>
          {meta}
          {b && (
            <span className="dD-area">
              <Dot p={p} id={it.backlogId} />
              {b.name}
            </span>
          )}
          {chips}
        </div>
      </div>
    </li>
  );
}

/** Shows placeholders / errors around a section's content. */
function Body<T>({ slot, k, p, children }: { slot: Slot<T>; k: SectionKey; p: DesignProps; children: (d: T) => ReactNode }) {
  return (
    <div className={'dD-body' + (slot.loading && slot.data ? ' dD-dim' : '')}>
      {slot.err && (
        <p className="dD-note dD-err">
          Could not load this section ({slot.err}).{' '}
          <button className="dD-link" onClick={() => p.reload(k, true)}>Retry</button>
        </p>
      )}
      {slot.data === null && !slot.err && <div className="dD-skel" aria-label="Loading"><i /><i /><i /></div>}
      {slot.data !== null && children(slot.data)}
    </div>
  );
}

function Section({ n, id, title, aside, children }: { n: number; id: string; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="dD-section" id={secId(id)} aria-labelledby={secId(id) + '-h'}>
      <header className="dD-sec-head">
        <h2 id={secId(id) + '-h'}>
          <span className="dD-num">{n}</span> · {title}
        </h2>
        {aside && <span className="dD-aside">{aside}</span>}
      </header>
      {children}
    </section>
  );
}

function List<T extends HomeItemRef>({ items, render }: { items: T[]; render: (it: T, list: number[]) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const vis = open ? items : items.slice(0, SHOW);
  const list = ids(vis);
  return (
    <>
      <ul className="dD-list">{vis.map((it) => render(it, list))}</ul>
      {items.length > SHOW && (
        <button className="dD-link dD-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'Show fewer' : `Show all ${items.length}`}
        </button>
      )}
    </>
  );
}

export default function DesignBriefing(p: DesignProps) {
  const d = p.data;
  const name = firstName(p.me);
  const dateLine = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const at = Math.max(...Object.values(d).map((s) => s.at));

  // ---- narrative ----
  const clauses: ReactNode[] = [];
  const A = (k: string, children: ReactNode) => (
    <button className="dD-nlink" onClick={() => scrollTo(k)}>{children}</button>
  );
  if (d.comments.data && d.comments.data.items.length) {
    const its = d.comments.data.items;
    const oldest = its.reduce((a, b) => (Date.parse(b.lastDate) < Date.parse(a.lastDate) ? b : a));
    const od = daysSince(oldest.lastDate);
    clauses.push(
      <span key="c">
        {A('reply', <><b>{its.length}</b> {its.length === 1 ? 'comment is' : 'comments are'} waiting for your reply</>)}
        {od !== null && <> — the oldest from {oldest.lastAuthor}, <b>{od}</b> {od === 1 ? 'day' : 'days'} ago</>}.
      </span>,
    );
  }
  if (d.validate.data) {
    const bs = d.validate.data.backlogs;
    const total = bs.reduce((s, b) => s + b.total, 0);
    if (total) {
      const via = bs.reduce((s, b) => s + b.viaFeature, 0);
      const old = Math.max(...bs.map((b) => b.oldestDays ?? -1));
      clauses.push(
        <span key="v">
          {A('validate', <><b>{total}</b> {total === 1 ? 'item is' : 'items are'} ready to validate</>)}
          {via > 0 && <>, <b>{via}</b> of them under your {via === 1 ? 'feature' : 'features'}</>}
          {old >= 0 && <>; the oldest has waited <b>{old}</b> {old === 1 ? 'day' : 'days'}</>}.
        </span>,
      );
    }
  }
  if (d.triage.data) {
    const bs = d.triage.data.backlogs;
    const total = bs.reduce((s, b) => s + b.total, 0);
    if (total) {
      const top = bs.reduce((a, b) => (b.total > a.total ? b : a));
      clauses.push(
        <span key="t">
          {A('triage', <><b>{total}</b> {total === 1 ? 'item still needs' : 'items still need'} triage</>)}
          {bs.length > 1 && top.total > 0 && top.total < total && <>, <b>{top.total}</b> in {top.name}</>}.
        </span>,
      );
    }
  }
  if (d.features.data) {
    const act = d.features.data.active.filter((f) => f.counts.total > 0);
    if (act.length) {
      const worst = act.reduce((a, b) => (pctDone(b.counts) < pctDone(a.counts) ? b : a));
      clauses.push(
        <span key="f">
          {A('features', <>{worst.title}</>)} is the furthest behind at <b>{pctDone(worst.counts)}%</b> done.
        </span>,
      );
    }
  }
  if (d.nextVersion.data) {
    const nv = d.nextVersion.data;
    const tot = nv.backlogs.reduce((s, b) => s + b.counts.total, 0);
    if (tot) {
      const done = nv.backlogs.reduce((s, b) => s + doneCount(b.counts), 0);
      clauses.push(
        <span key="n">
          {A('next', <>{nv.tag}</>)} is <b>{Math.round((100 * done) / tot)}%</b> done across {nv.backlogs.length === 1 ? 'its area' : 'both areas'}.
        </span>,
      );
    }
  }
  const loadingAny = Object.values(d).some((s) => s.data === null && !s.err);
  const allLoaded = !loadingAny;

  const cm = d.comments, ft = d.features, va = d.validate, tr = d.triage, nv = d.nextVersion, rc = d.recent;

  return (
    <div className="dD">
      <div className="dD-col">
        <header className="dD-mast">
          <div className="dD-mast-top">
            <span className="dD-date">{dateLine}</span>
            <button className="dD-link dD-refresh" onClick={p.refreshAll} disabled={p.loading} aria-busy={p.loading}>
              {p.loading ? '↻ Refreshing…' : <>↻ Refresh{at > 0 && <> · updated {hhmm(at)}</>}</>}
            </button>
          </div>
          <h1>{hello()}{name ? `, ${name}` : ''}</h1>
        </header>

        <section className="dD-glance" aria-label="Today at a glance">
          <div className="dD-label">Today at a glance</div>
          <p className="dD-narr">
            {clauses.length > 0
              ? clauses.map((c, i) => <span key={i}>{i > 0 && ' '}{c}</span>)
              : allLoaded
                ? 'Nothing needs your attention right now.'
                : null}
            {loadingAny && <span className="dD-ellipsis" aria-label="still loading"> …</span>}
          </p>
        </section>

        <Section n={1} id="reply" title="Reply" aside={cm.data && cm.data.items.length > 0 ? `${cm.data.items.length} waiting` : undefined}>
          <Body slot={cm} k="comments" p={p}>
            {(c) =>
              c.items.length === 0 ? (
                <p className="dD-note">Nothing to reply to.{c.errors > 0 && ` (${c.errors} could not be checked)`}</p>
              ) : (
                <List
                  items={c.items}
                  render={(it, list) => (
                    <Row
                      key={it.id}
                      p={p}
                      it={it}
                      list={list}
                      meta={<span><b>{it.lastAuthor}</b> · {ago(it.lastDate)} ago{it.count > 1 ? ` · ${it.count} comments` : ''}</span>}
                      chips={it.view === 'validate' ? <span className="dD-chip">to validate</span> : undefined}
                    />
                  )}
                />
              )
            }
          </Body>
        </Section>

        <Section n={2} id="validate" title="Validate" aside={va.data ? `${va.data.backlogs.reduce((s, b) => s + b.total, 0)} ready` : undefined}>
          <Body slot={va} k="validate" p={p}>
            {(v) => {
              const items = v.backlogs.flatMap((b) => b.items).sort((a, b) => (b.waitDays ?? -1) - (a.waitDays ?? -1));
              const total = v.backlogs.reduce((s, b) => s + b.total, 0);
              return (
                <>
                  {v.backlogs.filter((b) => b.error).map((b) => (
                    <p key={b.backlogId} className="dD-note dD-err">{b.name}: {b.error}</p>
                  ))}
                  {total === 0 && !v.backlogs.some((b) => b.error) ? (
                    <p className="dD-note">Nothing to validate.</p>
                  ) : (
                    <List
                      items={items}
                      render={(it, list) => (
                        <Row
                          key={it.id}
                          p={p}
                          it={it}
                          list={list}
                          meta={<span className={waitClass(it.waitDays)}>{it.waitDays === null ? 'waiting —' : `waiting ${it.waitDays}d`}</span>}
                          chips={
                            <>
                              {it.noPr && <span className="pr-chip nopr" title="No completed pull request: analyse before validating">⚠ No PR</span>}
                              {it.viaFeature && <span className="listed-feature" title="Listed because the parent Feature is yours">My Feature</span>}
                            </>
                          }
                        />
                      )}
                    />
                  )}
                  <div className="dD-areas">
                    {v.backlogs.filter((b) => b.total > 0).map((b) => (
                      <a key={b.backlogId} href={`#/b/${encodeURIComponent(b.backlogId)}/validate`}>
                        <span className="dD-dot" style={{ background: b.color }} />
                        {b.name} · {b.total}{b.noPr > 0 && ` (${b.noPr} no PR)`} →
                      </a>
                    ))}
                  </div>
                </>
              );
            }}
          </Body>
        </Section>

        <Section n={3} id="triage" title="Triage" aside={tr.data ? `${tr.data.backlogs.reduce((s, b) => s + b.total, 0)} to review` : undefined}>
          <Body slot={tr} k="triage" p={p}>
            {(t) => {
              const items = t.backlogs.flatMap((b) => b.items).sort((a, b) => a.id - b.id);
              const total = t.backlogs.reduce((s, b) => s + b.total, 0);
              return (
                <>
                  {t.backlogs.filter((b) => b.error).map((b) => (
                    <p key={b.backlogId} className="dD-note dD-err">{b.name}: {b.error}</p>
                  ))}
                  {total === 0 && !t.backlogs.some((b) => b.error) ? (
                    <p className="dD-note">Nothing to triage.</p>
                  ) : (
                    <List items={items} render={(it, list) => <Row key={it.id} p={p} it={it} list={list} meta={<span>{it.state}</span>} />} />
                  )}
                  <div className="dD-areas">
                    {t.backlogs.filter((b) => b.total > 0).map((b) => (
                      <a key={b.backlogId} href={`#/b/${encodeURIComponent(b.backlogId)}`}>
                        <span className="dD-dot" style={{ background: b.color }} />
                        {b.name} · {b.total}
                        {b.byType.length > 0 && <span className="muted"> ({b.byType.map((x) => `${x.count} ${x.key}`).join(', ')})</span>} →
                      </a>
                    ))}
                  </div>
                </>
              );
            }}
          </Body>
        </Section>

        <Section n={4} id="features" title="Features in flight" aside={ft.data ? plural(ft.data.active.length, 'active') : undefined}>
          <Body slot={ft} k="features" p={p}>
            {(f) => (
              <>
                {f.active.length === 0 && <p className="dD-note">No Active Features assigned to you.</p>}
                <ul className="dD-list">
                  {f.active.map((x) => {
                    const go = () => p.open(x.id, ids(f.active));
                    const area = backlogOf(p.backlogs, x.backlogId);
                    return (
                      <li key={x.id} className="dD-feat">
                        <div className="dD-feat-main" role="button" tabIndex={0} onClick={go} onKeyDown={(e) => activate(e, go)}>
                          <div className="dD-feat-text">
                            <div className="dD-row-title">
                              <span className="dD-title">{x.title}</span>
                              <a className="dD-ext" href={x.url} target="_blank" rel="noopener noreferrer" title="Open in TFS" aria-label={`Open #${x.id} in TFS`} onClick={(e) => e.stopPropagation()}>↗</a>
                            </div>
                            <Bar c={x.counts} />
                            <div className="dD-meta">
                              <span className="dD-id">#{x.id}</span>
                              <span>{doneCount(x.counts)} of {x.counts.total} items done</span>
                              {x.counts.active > 0 && <span>{x.counts.active} active</span>}
                              {x.counts.new > 0 && <span>{x.counts.new} new</span>}
                              {area && <span className="dD-area"><Dot p={p} id={x.backlogId} />{area.name}</span>}
                            </div>
                          </div>
                          <div className="dD-pct">{pctDone(x.counts)}<small>%</small></div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {f.notStarted.length > 0 && (
                  <details className="dD-more">
                    <summary>Not started ({f.notStarted.length})</summary>
                    <ul className="dD-list">
                      {f.notStarted.map((x) => (
                        <Row key={x.id} p={p} it={x} list={ids(f.notStarted)} meta={<span>{x.childCount ? plural(x.childCount, 'item') : 'no items'}</span>} />
                      ))}
                    </ul>
                  </details>
                )}
              </>
            )}
          </Body>
        </Section>

        <Section n={5} id="next" title="Next version" aside={nv.data?.tag}>
          <Body slot={nv} k="nextVersion" p={p}>
            {(v) => (
              <div className="dD-nv">
                {v.backlogs.map((b) => (
                  <div key={b.backlogId} className="dD-nv-item">
                    <div className="dD-nv-head">
                      <div>
                        <a className="dD-nv-name" href={`#/b/${encodeURIComponent(b.backlogId)}`}>
                          <span className="dD-dot" style={{ background: b.color }} />
                          {b.name}
                        </a>
                        {b.error ? (
                          <p className="dD-note dD-err">{b.error}</p>
                        ) : (
                          <div className="dD-meta">
                            <span>
                              {SEGMENTS.filter((s) => b.counts[s.key] > 0).slice().reverse().map((s) => `${b.counts[s.key]} ${s.label.toLowerCase()}`).join(' · ') || 'no items'}
                            </span>
                          </div>
                        )}
                      </div>
                      {!b.error && <div className="dD-pct">{pctDone(b.counts)}<small>%</small></div>}
                    </div>
                    {!b.error && <Bar c={b.counts} />}
                  </div>
                ))}
              </div>
            )}
          </Body>
        </Section>

        <Section n={6} id="recent" title="Recently changed" aside={rc.data ? `last ${plural(rc.data.days, 'day')}` : undefined}>
          <Body slot={rc} k="recent" p={p}>
            {(r) =>
              r.items.length === 0 ? (
                <p className="dD-note">No changes by others.{r.errors > 0 && ` (${r.errors} area(s) could not be read)`}</p>
              ) : (
                <List
                  items={r.items}
                  render={(it, list) => (
                    <Row key={it.id} p={p} it={it} list={list} meta={<span title={new Date(it.changedDate).toLocaleString()}><b>{it.changedBy}</b> · {ago(it.changedDate)} ago · {it.state}</span>} />
                  )}
                />
              )
            }
          </Body>
        </Section>
      </div>
    </div>
  );
}
