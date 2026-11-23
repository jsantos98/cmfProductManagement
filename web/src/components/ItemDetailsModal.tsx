import { useEffect, useRef, useState } from 'react';
import type { Band, ItemDetails } from '../../../server/src/types';
import { api } from '../api';
import { toast } from './Toasts';

interface Props {
  id: number;
  bands: Band[];
  onClose: () => void;
  onOpen: (id: number) => void;
  /** move to the previous/next row of the grid's current sorted + filtered order */
  onStep: (delta: -1 | 1) => void;
  /** called after Mark handled / Undo so the page can re-fetch the attention map */
  onAttentionChanged?: () => void;
}

const typeClass = (t: string) => 'pill pill-' + t.toLowerCase().replace(/\s+/g, '-');
const fmtDate = (s: string) => (s ? new Date(s).toLocaleString() : '');
const BASE_CSS =
  'body{font:13px system-ui,Segoe UI,sans-serif;color:#1f2430;margin:0;padding:8px 12px;overflow:hidden;word-wrap:break-word}' +
  'img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #d9dce1;padding:2px 5px}pre{white-space:pre-wrap}a{color:#2563eb}';

/** TFS HTML is untrusted: it only renders in a script-free sandboxed iframe (allow-same-origin only lets us measure height). */
function HtmlFrame({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [h, setH] = useState(40);
  const measure = () => {
    const b = ref.current?.contentDocument?.body;
    if (b) setH(Math.max(24, b.scrollHeight + 4));
  };
  const srcDoc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>${BASE_CSS}</style></head><body>${html}</body></html>`;
  return (
    <iframe
      ref={ref}
      className="detail-frame"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc={srcDoc}
      style={{ height: h }}
      onLoad={measure}
      title="work item content"
    />
  );
}

export default function ItemDetailsModal({ id, bands, onClose, onOpen, onStep, onAttentionChanged }: Props) {
  const [d, setD] = useState<ItemDetails | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setErr(null);
    api
      .item(id)
      .then((r) => {
        if (!live) return;
        setD(r);
        body.current?.scrollTo(0, 0);
      })
      .catch((e) => live && setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [id]);

  const [busy, setBusy] = useState(false);
  const setAck = async (on: boolean) => {
    setBusy(true);
    try {
      if (on) await api.ackAttention(id);
      else await api.unackAttention(id);
      const r = await api.item(id);
      setD(r);
      onAttentionChanged?.();
      toast('ok', on ? `#${id} marked handled` : `#${id} back in "waiting"`);
    } catch (e) {
      toast('warn', on ? 'Could not mark handled' : 'Could not undo', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        onStep(e.key === 'ArrowDown' ? 1 : -1);
      }
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [onClose, onStep]);

  const it = d?.item;
  const band = it ? bands.find((b) => b.label === it.band) : undefined;
  const field = (label: string, v: React.ReactNode) =>
    v === '' || v === null || v === undefined ? null : (
      <>
        <dt>{label}</dt>
        <dd>{v}</dd>
      </>
    );

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-details" role="dialog" aria-label={`Work item ${id}`}>
        <div className="details-head">
          {it && <span className={typeClass(it.type)}>{it.type}</span>}
          <b>#{id}</b>
          <span className="details-title">{it?.title ?? (loading ? 'Loading…' : '')}</span>
          {it && <span className="badge">{it.state}</span>}
          {it && <button onClick={() => window.open(it.url, '_blank', 'noopener')}>Open in TFS ↗</button>}
          <button onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body" ref={body}>
          {loading && !d && <p className="muted">Loading…</p>}
          {err && <div className="banner error">{err}</div>}
          {d && it && (
            <div className={loading ? 'dim' : ''}>
              <dl className="detail-grid">
                {field(
                  'Business order',
                  it.businessOrder === null ? (
                    ''
                  ) : (
                    <>
                      {it.businessOrder} <span className="dot" style={{ background: band?.color ?? '#9e9e9e' }} /> {it.band}
                    </>
                  ),
                )}
                {field('Assigned to', it.assignedTo)}
                {field('Iteration', it.iterationPath)}
                {field('Area', it.areaPath)}
                {field(
                  'Tags',
                  it.tags.length ? (
                    <span className="chips">
                      {it.tags.map((t) => (
                        <span key={t} className="chip">
                          {t}
                        </span>
                      ))}
                    </span>
                  ) : (
                    ''
                  ),
                )}
                {field(
                  'Parent',
                  it.parentId !== null ? (
                    <button className="link-btn" onClick={() => onOpen(it.parentId as number)}>
                      #{it.parentId} {it.parentTitle}
                    </button>
                  ) : (
                    ''
                  ),
                )}
                {field('Priority', d.priority)}
                {field('Severity', d.severity)}
                {field('Bug type', d.bugType)}
                {field('Target version', d.targetVersion)}
                {field('Version', d.version)}
                {field('Created', d.createdBy ? `${d.createdBy}, ${fmtDate(d.createdDate)}` : fmtDate(d.createdDate))}
                {field('Changed', d.changedBy ? `${d.changedBy}, ${fmtDate(d.changedDate)}` : fmtDate(d.changedDate))}
              </dl>
              {d.sections.map((s) => (
                <section key={s.label} className="detail-section">
                  <h4>{s.label}</h4>
                  <HtmlFrame html={s.html} />
                </section>
              ))}
              {d.children.length > 0 && (
                <section className="detail-section">
                  <h4>Children ({d.children.length})</h4>
                  <ul className="detail-list">
                    {d.children.map((c) => (
                      <li key={c.id}>
                        <span className={typeClass(c.type)}>{c.type}</span>{' '}
                        <button className="link-btn" onClick={() => onOpen(c.id)}>
                          #{c.id}
                        </button>{' '}
                        {c.title} <span className="muted">[{c.state}]</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <section className="detail-section">
                <h4>Comments ({d.comments.length})</h4>
                {d.attention && (
                  <div className="attention-bar">
                    <span className="grow">
                      💬 {d.attention.count} comment{d.attention.count === 1 ? '' : 's'} waiting for you
                    </span>
                    <button disabled={busy} onClick={() => void setAck(true)}>
                      Mark handled
                    </button>
                  </div>
                )}
                {!d.attention && d.ackedAt && (
                  <div className="attention-bar handled">
                    <span className="grow muted">Marked handled {fmtDate(d.ackedAt)}</span>
                    <button disabled={busy} onClick={() => void setAck(false)}>
                      Undo
                    </button>
                  </div>
                )}
                {d.commentsError && <div className="muted">Comments unavailable: {d.commentsError}</div>}
                {d.comments.map((c, i) => (
                  <div key={i} className={'detail-comment' + (c.mentionsMe ? ' mention' : '')}>
                    <div className="muted">
                      {c.author} · {fmtDate(c.date)}
                      {c.mentionsMe && <span className="mention-tag">@you</span>}
                    </div>
                    <HtmlFrame html={c.html} />
                  </div>
                ))}
              </section>
            </div>
          )}
        </div>
        <div className="modal-foot">
          <span className="muted grow">Esc closes · ↑/↓ previous / next row</span>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
