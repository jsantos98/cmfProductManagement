import { useEffect, useRef, useState } from 'react';
import type { PortalArticle, PortalTicketDetails, PortalTicketRow } from '../../../server/src/types';
import { api } from '../api';
import HtmlFrame from './HtmlFrame';

interface Props {
  /** the row as listed (shown immediately; the conversation loads on top) */
  row: PortalTicketRow;
  onClose: () => void;
  /** move to the previous/next row of the grid's current sorted + filtered order */
  onStep: (delta: -1 | 1) => void;
  onTogglePin: (row: PortalTicketRow) => void;
  busy?: boolean;
}

const fmtDate = (s: string | null | undefined) => (s && Number.isFinite(Date.parse(s)) ? new Date(s).toLocaleString() : '');
// same persisted width as the work item panel, so both feel like one panel
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

const isInternal = (a: PortalArticle) => /internal/i.test(a.type);

export default function PortalTicketPanel({ row, onClose, onStep, onTogglePin, busy }: Props) {
  const [d, setD] = useState<PortalTicketDetails | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const body = useRef<HTMLDivElement>(null);
  const id = row.id;

  useEffect(() => {
    let live = true;
    setLoading(true);
    setErr(null);
    setD(null);
    api.portal
      .ticket(id)
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

  const t = d?.ticket ?? row;
  const field = (label: string, v: React.ReactNode) =>
    v === '' || v === null || v === undefined ? null : (
      <>
        <dt>{label}</dt>
        <dd>{v}</dd>
      </>
    );
  const slaDue = fmtDate(t.slaDueDate);
  const overdue = Number.isFinite(Date.parse(t.slaDueDate)) && Date.parse(t.slaDueDate) < Date.now();

  return (
    <aside ref={asideRef} className="ui-details pt-panel" role="complementary" aria-label={`Ticket ${id}`}>
      <div className={'ui-details-resize' + (dragging ? ' dragging' : '')} onMouseDown={startResize} title="Drag to resize" aria-hidden />
      <div>
        <div className="details-head">
          <div className="details-head-main">
            <div className="details-head-line">
              <b className="pt-id">#{id}</b>
              {t.state && <span className="badge">{t.state}</span>}
              {t.pinned && <span className="badge count">pinned</span>}
            </div>
            <span className="details-title">{t.title}</span>
          </div>
          <div className="details-head-actions">
            <button className="ghost" onClick={() => onStep(-1)} title="Previous row (↑)" aria-label="Previous row">
              ↑
            </button>
            <button className="ghost" onClick={() => onStep(1)} title="Next row (↓)" aria-label="Next row">
              ↓
            </button>
            <button onClick={() => onTogglePin(t)} disabled={busy} title={t.pinned ? 'Remove from My requests (local only)' : 'Add to My requests (local only)'}>
              {t.pinned ? 'Unpin' : 'Pin'}
            </button>
            <button onClick={() => window.open(t.url, '_blank', 'noopener')} title="Open in the Customer Portal">
              Portal ↗
            </button>
            <button className="ghost" onClick={onClose} aria-label="Close" title="Close (Esc)">
              ✕
            </button>
          </div>
        </div>
      </div>
      <div className="ui-details-body" ref={body}>
        <dl className="detail-grid">
          {field('Customer', t.customer)}
          {field('Site', t.site)}
          {field('Version', t.context)}
          {field('Priority', t.priority)}
          {field('Status', t.status)}
          {field('Requester', t.requester)}
          {field('Owner role', t.ownerRole)}
          {field('Agent', t.agent)}
          {field('Created', d?.createdBy ? `${d.createdBy}, ${fmtDate(t.createdOn)}` : fmtDate(t.createdOn))}
          {field('SLA start', fmtDate(d?.slaStartDate))}
          {field('SLA due', slaDue && <span className={overdue ? 'wait-red' : undefined}>{slaDue}</span>)}
          {field(
            'Last reply',
            t.lastReplyOn
              ? `${t.lastReplyBy ? t.lastReplyBy + ' ' : ''}${t.lastReplyRole ? `(${t.lastReplyRole}) ` : ''}${fmtDate(t.lastReplyOn)}`.trim()
              : '',
          )}
          {field(
            'Waiting for support',
            t.waitingForSupport === null ? '' : t.waitingForSupport ? <span className="badge warn">yes</span> : <span className="muted">no</span>,
          )}
          {field('Replies', t.replies ? String(t.replies) : '')}
          {field('Work items', t.workItems ? String(t.workItems) : '')}
        </dl>
        {t.matches.length > 0 && (
          <section className="detail-section">
            <h4>Matched keywords</h4>
            <span className="chips">
              {t.matches.map((m) => (
                <span key={m} className="chip">
                  {m}
                </span>
              ))}
            </span>
          </section>
        )}
        <section className="detail-section">
          <h4>Conversation{d ? ` (${d.articles.length})` : ''}</h4>
          {loading && !d && <p className="muted">Loading…</p>}
          {err && <div className="banner error">{err}</div>}
          {d && d.articles.length === 0 && <p className="muted">No messages.</p>}
          {d?.articles.map((a) => (
            <div key={a.id} className={'pt-article' + (isInternal(a) ? ' internal' : '')}>
              <div className="pt-article-head">
                <b>{a.from || '—'}</b>
                {a.to && <span className="muted">→ {a.to}</span>}
                <span className="muted">· {fmtDate(a.createdOn)}</span>
                <span className="grow" />
                <span className={'badge' + (isInternal(a) ? ' warn' : '')}>{a.type}</span>
              </div>
              <HtmlFrame html={a.html} title="ticket message" />
            </div>
          ))}
        </section>
      </div>
      <div className="ui-details-foot">
        <span className="grow">Esc closes · ↑/↓ previous / next row · drag the left edge to resize</span>
      </div>
    </aside>
  );
}
