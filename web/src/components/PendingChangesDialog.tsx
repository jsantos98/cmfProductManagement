import { useState } from 'react';
import type { BacklogItem, ChangesResponse, ItemChangeResult } from '../../../server/src/types';
import { api } from '../api';
import { FIELD_LABEL, buildChanges, type FieldKey, type PendingMap } from '../pending';

interface Props {
  backlogId: string;
  pending: PendingMap;
  itemsById: Map<number, BacklogItem>;
  onClose: () => void;
  /** called with every real (non dry-run) response */
  onApplied: (resp: ChangesResponse) => void;
  /** outcome of an Apply done outside the dialog (opened because something failed) */
  initialResp?: ChangesResponse | null;
  initialErr?: string | null;
}

const fmt = (v: unknown) => (v === null || v === undefined || v === '' ? '∅' : String(v));

export default function PendingChangesDialog({ backlogId, pending, itemsById, onClose, onApplied, initialResp = null, initialErr = null }: Props) {
  const [busy, setBusy] = useState(false);
  const [resp, setResp] = useState<ChangesResponse | null>(initialResp);
  const [err, setErr] = useState<string | null>(initialErr);
  const [appliedCount, setAppliedCount] = useState(
    initialResp && !initialResp.dryRun && initialResp.phase === 'applied' ? initialResp.results.filter((x) => x.ok).length : 0,
  );

  const ids = Object.keys(pending).map(Number);
  const results = new Map<number, ItemChangeResult>((resp?.results ?? []).map((r) => [r.id, r]));

  const run = async (dryRun: boolean) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.changes(backlogId, { changes: buildChanges(itemsById, pending) }, dryRun);
      setResp(r);
      if (!dryRun) {
        if (r.phase === 'applied') setAppliedCount((n) => n + r.results.filter((x) => x.ok).length);
        onApplied(r);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const failed = resp?.results.filter((r) => !r.ok) ?? [];

  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-label="Pending changes">
        <h3>Pending changes ({ids.length})</h3>
        <div className="modal-body">
          {ids.length === 0 && <p className="muted">Nothing pending.</p>}
          {ids.map((id) => {
            const e = pending[id];
            const item = itemsById.get(id);
            const r = results.get(id);
            return (
              <div key={id} className={'chg' + (r ? (r.ok ? ' ok' : ' bad') : '')}>
                <div className="chg-head">
                  <b>#{id}</b> {item?.title ?? ''}
                  {r && (
                    <span className={'status ' + (r.ok ? 'ok' : 'bad')}>
                      {r.ok ? (resp?.dryRun || resp?.phase === 'validation' ? 'valid' : 'applied') : 'failed'}
                    </span>
                  )}
                </div>
                <ul>
                  {(Object.keys(e.fields) as FieldKey[]).map((k) => (
                    <li key={k}>
                      {FIELD_LABEL[k]}: <span className="old">{fmt(e.fields[k]!.old)}</span> →{' '}
                      <span className="new">{fmt(e.fields[k]!.new)}</span>
                    </li>
                  ))}
                  {(e.tagsAdd.length > 0 || e.tagsRemove.length > 0) && (
                    <li>
                      Tags:{' '}
                      {e.tagsAdd.map((t) => (
                        <span key={'a' + t} className="chip add">+{t}</span>
                      ))}
                      {e.tagsRemove.map((t) => (
                        <span key={'r' + t} className="chip del">−{t}</span>
                      ))}
                    </li>
                  )}
                </ul>
                {r && !r.ok && <div className="error-text">{r.error ?? 'Failed'}</div>}
              </div>
            );
          })}
          {err && <div className="banner error">{err}</div>}
          {resp && resp.dryRun && (
            <div className={'banner ' + (failed.length ? 'error' : 'ok')}>
              Dry run: {failed.length ? `${failed.length} item(s) would fail.` : 'all changes valid.'} Nothing was
              written.
            </div>
          )}
          {resp && !resp.dryRun && resp.phase === 'validation' && failed.length > 0 && (
            <div className="banner error">
              Validation failed: <b>nothing was written</b> to TFS. Fix or discard the failing items and apply again.
            </div>
          )}
          {resp && !resp.dryRun && resp.phase === 'applied' && (
            <div className={'banner ' + (failed.length ? 'error' : 'ok')}>
              {appliedCount} item(s) written to TFS{failed.length ? `; ${failed.length} failed and remain pending.` : '.'}
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button disabled={busy || ids.length === 0} onClick={() => run(true)}>
            Dry run
          </button>
          <button className="primary" disabled={busy || ids.length === 0} onClick={() => run(false)}>
            {busy ? 'Working…' : 'Apply'}
          </button>
          <button onClick={onClose}>{ids.length === 0 ? 'Close' : 'Cancel'}</button>
        </div>
      </div>
    </div>
  );
}
