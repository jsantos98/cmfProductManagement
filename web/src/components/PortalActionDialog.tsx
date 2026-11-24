import { useEffect, useMemo, useRef, useState } from 'react';
import type { PortalActionRequest, PortalActionResult, PortalTicketOptions, PortalTicketRow, PortalWorkItem } from '../../../server/src/types';
import { ApiError, api } from '../api';

export type ActionKind = { type: 'assign' } | { type: 'state'; to: string } | { type: 'reply' } | { type: 'link' };
type ReplyKind = 'reply' | 'public-note' | 'internal-note';

interface Props {
  ticket: PortalTicketRow;
  options: PortalTicketOptions;
  kind: ActionKind;
  onClose: () => void;
  /** a real write succeeded */
  onDone: (r: PortalActionResult) => void;
  /** 409: the ticket changed, reload details + options */
  onReload: () => void;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const parseIds = (s: string): number[] => [...new Set(s.split(/[\s,;]+/).filter(Boolean).map((x) => Number(x.replace(/^#/, ''))))];
const shortId = (id: string) => (id.length > 8 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id);

export default function PortalActionDialog({ ticket, options, kind, onClose, onDone, onReload }: Props) {
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [replyKind, setReplyKind] = useState<ReplyKind>('internal-note');
  const [text, setText] = useState('');
  const [timeSpent, setTimeSpent] = useState('0');
  const [idsText, setIdsText] = useState('');
  const [checked, setChecked] = useState<Record<number, PortalWorkItem | string>>({});
  const [checking, setChecking] = useState(false);
  const [dry, setDry] = useState<{ summary?: string; service?: string; error?: string; pending: boolean }>({ pending: false });
  const [busy, setBusy] = useState(false);
  const [sendErr, setSendErr] = useState<{ message: string; conflict: boolean } | null>(null);
  const seq = useRef(0);
  const lastSender = (options.replyTo || 'the last sender') + (options.replyCc ? `, CC ${options.replyCc}` : '');
  const closing = kind.type === 'state' && /^closed$/i.test(kind.to);
  const isOther = /^other$/i.test(reason);

  const ids = useMemo(() => parseIds(idsText), [idsText]);
  const idsBad = ids.some((n) => !Number.isInteger(n) || n <= 0);
  const already = ids.filter((n) => options.workItems.includes(n));
  const linkReady = ids.length > 0 && !idsBad && already.length === 0 && ids.every((n) => typeof checked[n] === 'object');

  // The request to send, or the reason why it is not ready yet.
  const built = useMemo((): { req: PortalActionRequest } | { missing: string } => {
    const base = { expectedModifiedOn: options.modifiedOn };
    switch (kind.type) {
      case 'assign':
        return { req: { ...base, action: 'assign-to-me' } };
      case 'state': {
        if (closing) {
          if (!reason) return { missing: 'Choose a close reason.' };
          if (isOther && !comment.trim()) return { missing: 'Reason "Other" requires a comment.' };
          return { req: { ...base, action: 'state', to: kind.to, reason, ...(comment.trim() ? { comment: comment.trim() } : {}) } };
        }
        return { req: { ...base, action: 'state', to: kind.to } };
      }
      case 'reply': {
        if (!text.trim()) return { missing: 'Type a message.' };
        const mins = Number(timeSpent);
        if (!Number.isFinite(mins) || mins < 0) return { missing: 'Time spent must be 0 or more minutes.' };
        return { req: { ...base, action: 'reply', kind: replyKind, text, timeSpent: Math.round(mins) } };
      }
      case 'link':
        if (ids.length === 0) return { missing: 'Enter one or more TFS work item ids.' };
        if (idsBad) return { missing: 'Ids must be positive numbers.' };
        if (already.length) return { missing: `Already linked: ${already.map((n) => '#' + n).join(', ')}.` };
        if (!linkReady) return { missing: 'Press Check to verify the work items.' };
        return { req: { ...base, action: 'link-work-items', ids } };
    }
  }, [kind, closing, reason, isOther, comment, text, timeSpent, replyKind, ids, idsBad, already, linkReady, options.modifiedOn]);

  // Dry run on open and whenever the inputs change (debounced). This effect ONLY ever passes dryRun = true.
  const key = 'req' in built ? JSON.stringify(built.req) : null;
  useEffect(() => {
    if (!('req' in built)) {
      seq.current++;
      setDry({ pending: false });
      return;
    }
    const req = built.req;
    const my = ++seq.current;
    setDry((d) => ({ ...d, pending: true }));
    const wait = kind.type === 'reply' || closing ? 400 : 0;
    const h = setTimeout(() => {
      api.portal
        .action(ticket.id, req, true)
        .then((r) => my === seq.current && setDry({ summary: r.summary, service: r.request?.service, pending: false }))
        .catch((e) => my === seq.current && setDry({ error: errMsg(e), pending: false }));
    }, wait);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const check = async () => {
    setChecking(true);
    const next: Record<number, PortalWorkItem | string> = {};
    await Promise.all(
      ids
        .filter((n) => Number.isInteger(n) && n > 0)
        .map(async (n) => {
          try {
            const w = await api.portal.workItem(n);
            next[n] = w.title === null ? 'not found' : w;
          } catch (e) {
            next[n] = errMsg(e);
          }
        }),
    );
    setChecked((c) => ({ ...c, ...next }));
    setChecking(false);
  };

  const t = `#${shortId(ticket.id)}`;
  let description = '';
  let title = '';
  let confirmLabel = '';
  switch (kind.type) {
    case 'assign':
      description = `Assign ticket ${t} to you in the Customer Portal.`;
      title = 'Assign to me';
      confirmLabel = 'Assign to me';
      break;
    case 'state':
      description = `Change ticket ${t} from ${options.state} to ${kind.to} in the Customer Portal${closing && reason ? `, reason "${reason}"` : ''}.`;
      title = closing ? 'Close ticket' : `Set state to ${kind.to}`;
      confirmLabel = closing ? 'Close ticket' : `Set ${kind.to}`;
      break;
    case 'reply':
      description =
        replyKind === 'internal-note'
          ? `Add an internal note to ticket ${t} (not visible to the customer).`
          : `Post a ${replyKind === 'reply' ? 'reply' : 'public note'} on ticket ${t}, visible to the customer (sent to ${lastSender}).`;
      title = 'Reply to ticket';
      confirmLabel = replyKind === 'internal-note' ? 'Send internal note' : replyKind === 'public-note' ? 'Send public note' : 'Send reply';
      break;
    case 'link':
      description = `Link ${ids.length ? ids.map((n) => '#' + n).join(', ') : 'TFS work items'} to ticket ${t} in the Customer Portal.`;
      title = 'Link work items';
      confirmLabel = `Link ${ids.length} work item${ids.length === 1 ? '' : 's'}`;
      break;
  }

  const ready = 'req' in built && !dry.pending && !dry.error && !!dry.summary;

  // The only place a real (non dry-run) request is sent: the primary button.
  const send = async () => {
    if (!('req' in built) || !ready || busy) return;
    setBusy(true);
    setSendErr(null);
    try {
      const r = await api.portal.action(ticket.id, built.req, false);
      onDone(r);
    } catch (e) {
      setSendErr({ message: errMsg(e), conflict: e instanceof ApiError && e.status === 409 });
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div
        className="modal modal-reject pt-dialog"
        role="dialog"
        aria-label={title}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy) {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <h3>{title}</h3>
        <div className="modal-body">
          <p className="pt-dlg-desc">{description}</p>

          {closing && (
            <>
              <label className="field">
                Reason
                <select autoFocus value={reason} onChange={(e) => setReason(e.target.value)}>
                  <option value="">Select a reason…</option>
                  {options.closeReasons.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.value}
                      {r.description && r.description !== r.value ? ` — ${r.description}` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Comment{isOther ? ' (required for "Other")' : ' (optional)'}
                <textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
              </label>
            </>
          )}

          {kind.type === 'reply' && (
            <>
              <div className="pt-seg" role="radiogroup" aria-label="Message type">
                {(
                  [
                    ['reply', 'Reply'],
                    ['public-note', 'Public note'],
                    ['internal-note', 'Internal note'],
                  ] as [ReplyKind, string][]
                ).map(([k, label]) => (
                  <button key={k} type="button" role="radio" aria-checked={replyKind === k} className={replyKind === k ? 'on' : ''} onClick={() => setReplyKind(k)}>
                    {label}
                  </button>
                ))}
              </div>
              {replyKind !== 'internal-note' && <div className="banner warn">Visible to the customer (sent to {lastSender}).</div>}
              <label className="field">
                Message (plain text)
                <textarea rows={6} autoFocus value={text} onChange={(e) => setText(e.target.value)} />
              </label>
              <label className="field pt-inline">
                Time spent (min)
                <input type="number" min={0} step={1} value={timeSpent} onChange={(e) => setTimeSpent(e.target.value)} style={{ width: 90 }} />
              </label>
            </>
          )}

          {kind.type === 'link' && (
            <>
              {options.workItems.length > 0 && (
                <div className="pt-dlg-linked">
                  <span className="muted">Already linked:</span>{' '}
                  <span className="chips">
                    {options.workItems.map((n) => (
                      <span key={n} className="chip muted">
                        #{n}
                      </span>
                    ))}
                  </span>
                </div>
              )}
              <label className="field">
                TFS work item ids (comma or space separated)
                <span className="pt-inline">
                  <input
                    autoFocus
                    value={idsText}
                    onChange={(e) => setIdsText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (ids.length && !idsBad) void check();
                      }
                    }}
                    placeholder="e.g. 137986, 138001"
                    style={{ flex: 1 }}
                  />
                  <button type="button" onClick={() => void check()} disabled={checking || ids.length === 0 || idsBad}>
                    {checking ? 'Checking…' : 'Check'}
                  </button>
                </span>
              </label>
              <ul className="pt-dlg-wis">
                {ids.map((n) => {
                  const c = checked[n];
                  const dup = options.workItems.includes(n);
                  return (
                    <li key={n}>
                      <b>#{n}</b>{' '}
                      {dup ? (
                        <span className="wait-red">already linked</span>
                      ) : c === undefined ? (
                        <span className="muted">not checked</span>
                      ) : typeof c === 'string' ? (
                        <span className="wait-red">{c}</span>
                      ) : (
                        <span>
                          {c.title}
                          {(c.type || c.state) && <span className="muted"> ({[c.type, c.state].filter(Boolean).join(', ')})</span>}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          <div className="pt-dlg-dry" aria-live="polite">
            <div className="muted">Dry run (nothing is written)</div>
            {'missing' in built && <div className="muted">{built.missing}</div>}
            {'req' in built && dry.pending && <div className="muted">Checking…</div>}
            {dry.error && <div className="banner error">{dry.error}</div>}
            {dry.summary && !dry.pending && (
              <div>
                <b>{dry.summary}</b>
                {dry.service && <span className="muted"> · service {dry.service}</span>}
              </div>
            )}
          </div>

          {sendErr && (
            <div className="banner error">
              {sendErr.message}
              {sendErr.conflict && (
                <>
                  {' '}
                  <button onClick={onReload}>Reload ticket</button>
                </>
              )}
            </div>
          )}
        </div>
        <div className="modal-foot">
          <span className="muted grow">Esc cancels</span>
          <button className={closing ? 'danger' : 'primary'} disabled={!ready || busy} onClick={() => void send()}>
            {busy ? 'Working…' : confirmLabel}
          </button>
          <button disabled={busy} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
