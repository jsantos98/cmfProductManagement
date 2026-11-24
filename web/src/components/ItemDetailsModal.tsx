import { useEffect, useRef, useState } from 'react';
import type { Band, ItemDetails } from '../../../server/src/types';
import { api } from '../api';
import { toast } from './Toasts';
import HtmlFrame from './HtmlFrame';

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
const WIDTH_KEY = 'cmfpm.detailsWidth.v1';
const clampWidth = (w: number) => Math.round(Math.min(Math.max(w, 380), Math.max(420, window.innerWidth - 360)));
function readWidth(): number {
  try {
    const v = Number(localStorage.getItem(WIDTH_KEY));
    if (Number.isFinite(v) && v > 0) return clampWidth(v);
  } catch {
    /* storage blocked */
  }
  return clampWidth(560);
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

  // Keys: Esc closes, ↑/↓ step — unless the user is typing, editing a grid cell, or another dialog/menu is open.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input, textarea, select, [contenteditable="true"]') || t.closest('.ag-popup, .ag-cell-inline-editing'))) return;
      if (document.querySelector('.modal-backdrop, .ctx-menu, .ag-popup-editor, .ag-cell-inline-editing')) return;
      if (e.key === 'Escape') onClose();
      else {
        e.preventDefault();
        e.stopPropagation();
        onStep(e.key === 'ArrowDown' ? 1 : -1);
      }
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [onClose, onStep]);

  // Panel width: resizable, persisted; the page content makes room for it (body.details-open + --details-w).
  const [width, setWidth] = useState(readWidth);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    document.documentElement.style.setProperty('--details-w', `${width}px`);
  }, [width]);
  // Reserve room only while the panel is actually shown (pages stay mounted but hidden when you navigate away).
  const asideRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = asideRef.current;
    if (!el) return;
    const sync = () => document.body.classList.toggle('details-open', el.getClientRects().length > 0);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.body.classList.remove('details-open');
    };
  }, []);
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    const move = (ev: MouseEvent) => setWidth(clampWidth(window.innerWidth - ev.clientX));
    const up = () => {
      setDragging(false);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setWidth((w) => {
        try {
          localStorage.setItem(WIDTH_KEY, String(w));
        } catch {
          /* storage blocked */
        }
        return w;
      });
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

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
    <aside ref={asideRef} className="ui-details" role="complementary" aria-label={`Work item ${id}`}>
      <div className={'ui-details-resize' + (dragging ? ' dragging' : '')} onMouseDown={startResize} title="Drag to resize" aria-hidden />
      <div>
        <div className="details-head">
          <div className="details-head-main">
            <div className="details-head-line">
              {it && <span className={typeClass(it.type)}>{it.type}</span>}
              <b>#{id}</b>
              {it && <span className="badge">{it.state}</span>}
            </div>
            <span className="details-title">{it?.title ?? (loading ? 'Loading…' : '')}</span>
          </div>
          <div className="details-head-actions">
            <button className="ghost" onClick={() => onStep(-1)} title="Previous row (↑)" aria-label="Previous row">
              ↑
            </button>
            <button className="ghost" onClick={() => onStep(1)} title="Next row (↓)" aria-label="Next row">
              ↓
            </button>
            {it && (
              <button onClick={() => window.open(it.url, '_blank', 'noopener')} title="Open in TFS">
                TFS ↗
              </button>
            )}
            <button className="ghost" onClick={onClose} aria-label="Close" title="Close (Esc)">
              ✕
            </button>
          </div>
        </div>
      </div>
      <div className="ui-details-body" ref={body}>
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
                  <HtmlFrame html={s.html} title="work item content" />
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
                    <HtmlFrame html={c.html} title="work item content" />
                  </div>
                ))}
              </section>
            </div>
          )}
      </div>
      <div className="ui-details-foot">
        <span className="grow">Esc closes · ↑/↓ previous / next row · drag the left edge to resize</span>
      </div>
    </aside>
  );
}
