// Shared data + helpers for the Home page designs. Every design gets the same `DesignProps`.
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  BacklogDef,
  HomeCommentsResponse,
  HomeFeaturesResponse,
  HomeNextVersionResponse,
  HomeRecentResponse,
  HomeTriageResponse,
  HomeValidateResponse,
  PortalRequestsResponse,
  StateCounts,
} from '../../../../server/src/types';
import { ApiError, api } from '../../api';

/** `Slot.err` of the portal section when there is no portal session (not an error: the tile shows "Sign in"). */
export const PORTAL_SIGNIN = 'signin';

// ---- data -------------------------------------------------------------------------------------------------------

/** One section's state: `data` stays while reloading; `err` is the last error (data may still be the previous one). */
export interface Slot<T> { data: T | null; err: string | null; loading: boolean; at: number }

export interface HomeData {
  comments: Slot<HomeCommentsResponse>;
  features: Slot<HomeFeaturesResponse>;
  validate: Slot<HomeValidateResponse>;
  triage: Slot<HomeTriageResponse>;
  nextVersion: Slot<HomeNextVersionResponse>;
  recent: Slot<HomeRecentResponse>;
  /** Customer Portal enhancement requests (err = 'signin' when no portal session) */
  portal: Slot<PortalRequestsResponse>;
}
export type SectionKey = keyof HomeData;

const LOADERS: { [K in SectionKey]: (refresh: boolean) => Promise<NonNullable<HomeData[K]['data']>> } = {
  comments: (r) => api.home.comments(r),
  features: (r) => api.home.features(r),
  validate: (r) => api.home.validate(r),
  triage: (r) => api.home.triage(r),
  nextVersion: (r) => api.home.nextVersion(r),
  recent: (r) => api.home.recent(r),
  portal: (r) => api.portal.requests(r),
};
const KEYS = Object.keys(LOADERS) as SectionKey[];
const empty = (): Slot<never> => ({ data: null, err: null, loading: false, at: 0 });

/**
 * Loads every Home section in parallel (each independently) while `enabled`.
 * Reloads every 5 minutes while visible, and on activation when older than a minute.
 */
export function useHomeData(enabled: boolean) {
  const [d, setD] = useState<HomeData>(() => Object.fromEntries(KEYS.map((k) => [k, empty()])) as unknown as HomeData);
  const seq = useRef<Record<string, number>>({});
  const reload = useCallback(async (key: SectionKey, refresh = false) => {
    const my = (seq.current[key] = (seq.current[key] ?? 0) + 1);
    setD((p) => ({ ...p, [key]: { ...p[key], loading: true } }));
    try {
      const data = await LOADERS[key](refresh);
      if (seq.current[key] === my) setD((p) => ({ ...p, [key]: { data, err: null, loading: false, at: Date.now() } }));
    } catch (e) {
      const err = e instanceof ApiError && e.status === 401 ? PORTAL_SIGNIN : e instanceof Error ? e.message : String(e);
      if (seq.current[key] === my) setD((p) => ({ ...p, [key]: { ...p[key], err, loading: false, at: Date.now() } }));
    }
  }, []);
  const reloadAll = useCallback((refresh = false) => KEYS.forEach((k) => void reload(k, refresh)), [reload]);

  const oldest = useRef(0);
  oldest.current = Math.min(...KEYS.map((k) => d[k].at));
  useEffect(() => {
    if (!enabled) return;
    if (!oldest.current || Date.now() - oldest.current > 60_000) reloadAll(false);
    const t = window.setInterval(() => document.visibilityState === 'visible' && reloadAll(false), 5 * 60_000);
    return () => window.clearInterval(t);
  }, [enabled, reloadAll]);

  const loading = KEYS.some((k) => d[k].loading);
  return { data: d, reload, reloadAll, loading };
}

// ---- what every design receives ---------------------------------------------------------------------------------

export interface DesignProps {
  data: HomeData;
  /** visible area backlogs (id, name, color, areaPath) */
  backlogs: BacklogDef[];
  /** open the item details modal; ↑/↓ in the modal steps through `list` */
  open: (id: number, list: number[]) => void;
  /** reload one section; refresh = bypass server caches */
  reload: (key: SectionKey, refresh?: boolean) => void;
  /** reload every section from TFS */
  refreshAll: () => void;
  /** true while any section is loading */
  loading: boolean;
  /** signed-in user's display name, e.g. "João Paulo Santos" */
  me?: string;
}

// ---- helpers ----------------------------------------------------------------------------------------------------

/** CSS class of the existing work item type chip (`.pill.pill-bug` …). */
export const typeClass = (t: string) => 'pill pill-' + t.toLowerCase().replace(/\s+/g, '-');

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

/** Existing age classes: amber from 14 days, red from 30. */
export const waitClass = (d: number | null) => (d === null ? 'muted' : d >= 30 ? 'wait-red' : d >= 14 ? 'wait-amber' : undefined);

export const SEGMENTS: { key: keyof Omit<StateCounts, 'total'>; label: string; color: string }[] = [
  { key: 'closed', label: 'Closed', color: '#2e7d32' },
  { key: 'resolved', label: 'Resolved', color: '#81c784' },
  { key: 'active', label: 'Active', color: '#1976d2' },
  { key: 'new', label: 'New', color: '#c5cad3' },
  { key: 'other', label: 'Other', color: '#ffb74d' },
];
/** Resolved + Closed */
export const doneCount = (c: StateCounts) => c.closed + c.resolved;
export const pctDone = (c: StateCounts) => (c.total ? Math.round((100 * doneCount(c)) / c.total) : 0);

export const ids = (xs: { id: number }[]) => xs.map((x) => x.id);
export const backlogOf = (backlogs: BacklogDef[], id: string | null) => (id ? backlogs.find((b) => b.id === id) : undefined);
export const hello = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 19 ? 'Good afternoon' : 'Good evening';
};
export const firstName = (me?: string) => (me ?? '').split(/[\s<]/)[0] || '';
