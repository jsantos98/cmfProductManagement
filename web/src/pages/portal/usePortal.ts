// Customer Portal data shared by the sidebar badge and the page: one load, refreshed at most every 5 minutes.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PortalRequestsResponse, PortalTicketRow } from '../../../../server/src/types';
import { ApiError, api, type PortalStatus } from '../../api';

export interface PortalState {
  status: PortalStatus | null;
  data: PortalRequestsResponse | null;
  /** last load error (not a sign-in problem) */
  err: string | null;
  loading: boolean;
  /** false once a load found no portal session */
  signedIn: boolean | null;
  loadedAt: string;
  load: (refresh?: boolean) => Promise<void>;
  /** optimistic local edit of the loaded response */
  mutate: (f: (d: PortalRequestsResponse) => PortalRequestsResponse) => void;
  /** sidebar badge: pinned requests waiting for support (undefined while unknown / signed out) */
  badge: number | undefined;
}

export const isOverdue = (t: PortalTicketRow) => {
  const d = Date.parse(t.slaDueDate);
  return Number.isFinite(d) && d < Date.now();
};

export function usePortalRequests(): PortalState {
  const [status, setStatus] = useState<PortalStatus | null>(null);
  const [data, setData] = useState<PortalRequestsResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const seq = useRef(0);
  const at = useRef(0);

  const load = useCallback(async (refresh = false) => {
    const my = ++seq.current;
    at.current = Date.now();
    setLoading(true);
    const st = api.portal.status().catch((): PortalStatus => ({ signedIn: false, remembered: false }));
    try {
      const r = await api.portal.requests(refresh);
      const s = await st;
      if (seq.current !== my) return;
      setData(r);
      setStatus({ ...s, signedIn: true });
      setSignedIn(true);
      setErr(null);
    } catch (e) {
      const s = await st;
      if (seq.current !== my) return;
      if (e instanceof ApiError && e.status === 401) {
        setData(null);
        setStatus({ ...s, signedIn: false });
        setSignedIn(false);
        setErr(null);
      } else {
        setStatus(s);
        setErr(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (seq.current === my) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible' && Date.now() - at.current >= 5 * 60_000) void load(false);
    }, 60_000);
    return () => window.clearInterval(t);
  }, [load]);

  const mutate = useCallback((f: (d: PortalRequestsResponse) => PortalRequestsResponse) => setData((d) => (d ? f(d) : d)), []);
  const badge = signedIn && data ? data.pinned.filter((t) => t.waitingForSupport === true).length : undefined;
  return { status, data, err, loading, signedIn, loadedAt: data?.loadedAt ?? '', load, mutate, badge };
}
