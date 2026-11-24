import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HealthResponse, SettingsDto, SummaryEntry } from '../../server/src/types';
import { api } from './api';
import BacklogPage from './pages/BacklogPage';
import ValidationPage from './pages/ValidationPage';
import SettingsPage from './pages/SettingsPage';
import HomePage from './pages/HomePage';
import { ToastHost } from './components/Toasts';
import Sidebar, { type NavTarget } from './ui/Sidebar';

/**
 * `#/settings` -> settings; `#/b/<id>[/validate]` -> that id (maybe unknown); legacy `#/backlog` -> null = first visible;
 * anything else (`#/`, empty) -> Home.
 */
type View = 'backlog' | 'validate';
type Route =
  | { settings: true; home?: false }
  | { settings: false; home: true }
  | { settings: false; home?: false; id: string | null; view: View };
const parse = (): Route => {
  const h = window.location.hash;
  if (h.startsWith('#/settings')) return { settings: true };
  if (!h.startsWith('#/b/') && !h.startsWith('#/backlog')) return { settings: false, home: true };
  const m = /^#\/b\/([^/?#]+)(\/validate)?/.exec(h);
  return { settings: false, id: m ? decodeURIComponent(m[1]) : null, view: m && m[2] ? 'validate' : 'backlog' };
};

export default function App() {
  const [route, setRoute] = useState<Route>(parse);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthErr, setHealthErr] = useState<string | null>(null);
  const [settings, setSettings] = useState<SettingsDto | null>(null);
  const [settingsErr, setSettingsErr] = useState<string | null>(null);
  const [pendingById, setPendingById] = useState<Record<string, number>>({});
  const [visited, setVisited] = useState<ReadonlySet<string>>(new Set());
  const [reloadToken, setReloadToken] = useState(0);
  const [staleTokens, setStaleTokens] = useState<Record<string, number>>({});
  const [summary, setSummary] = useState<Record<string, SummaryEntry>>({});
  const [valStats, setValStats] = useState<Record<string, { total: number; waiting: number }>>({});
  const [visitedVal, setVisitedVal] = useState<ReadonlySet<string>>(new Set());
  const [visitedHome, setVisitedHome] = useState(false);
  const summaryAt = useRef(0);
  const loadSummary = useCallback(async () => {
    summaryAt.current = Date.now();
    try {
      const r = await api.summary();
      setSummary(Object.fromEntries(r.backlogs.map((e) => [e.id, e])));
    } catch (e) {
      console.warn('summary load failed', e);
    }
  }, []);
  useEffect(() => {
    void loadSummary();
    const check = (minAge: number) => {
      if (document.visibilityState === 'visible' && Date.now() - summaryAt.current > minAge) void loadSummary();
    };
    const onFocus = () => check(60_000);
    const timer = window.setInterval(() => check(0), 5 * 60_000);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [loadSummary]);
  const onValidated = (id: string, action: 'close' | 'reject') => {
    if (action === 'reject') setStaleTokens((t) => ({ ...t, [id]: (t[id] ?? 0) + 1 }));
    void loadSummary();
  };
  const statsCbs = useRef(new Map<string, (s: { total: number; waiting: number }) => void>());
  const statsCb = (id: string) => {
    let f = statsCbs.current.get(id);
    if (!f) {
      f = (st) => setValStats((p) => (p[id]?.total === st.total && p[id]?.waiting === st.waiting ? p : { ...p, [id]: st }));
      statsCbs.current.set(id, f);
    }
    return f;
  };
  const onMoved = (from: string) =>
    setStaleTokens((t) => {
      const next = { ...t };
      for (const b of settings?.backlogs ?? []) if (b.id !== from) next[b.id] = (next[b.id] ?? 0) + 1;
      return next;
    });

  useEffect(() => {
    const h = () => setRoute(parse());
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);

  useEffect(() => {
    api.health().then(setHealth, (e: unknown) => setHealthErr(e instanceof Error ? e.message : String(e)));
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      setSettings(await api.getSettings());
      setSettingsErr(null);
    } catch (e) {
      setSettingsErr(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const tabs = useMemo(() => (settings?.backlogs ?? []).filter((b) => !b.hidden), [settings]);
  const tabIds = useMemo(() => new Set(tabs.map((b) => b.id)), [tabs]);

  // Active backlog: the routed one if it is a visible tab, else the first visible tab.
  const homeRoute = !route.settings && !!route.home;
  const activeId: string | null = route.settings || route.home
    ? null
    : route.id !== null && tabIds.has(route.id)
      ? route.id
      : (tabs[0]?.id ?? null);
  const settingsRoute = route.settings;
  const activeView: View = route.settings || route.home ? 'backlog' : route.view;

  // Normalise the URL (legacy `#/backlog`, hidden/removed id) to the resolved tab.
  useEffect(() => {
    if (!settings || settingsRoute || activeId === null) return;
    const want = `#/b/${encodeURIComponent(activeId)}${activeView === 'validate' ? '/validate' : ''}`;
    if (window.location.hash !== want) window.history.replaceState(null, '', want);
    if (route.settings === false && !route.home && route.id !== activeId) setRoute({ settings: false, id: activeId, view: activeView });
  }, [settings, settingsRoute, activeId, activeView, route]);

  // Lazy mount: a page is created on first visit and then kept mounted.
  useEffect(() => {
    if (homeRoute) setVisitedHome(true);
  }, [homeRoute]);
  useEffect(() => {
    if (activeId === null) return;
    setVisited((v) => (v.has(activeId) ? v : new Set(v).add(activeId)));
  }, [activeId]);
  useEffect(() => {
    if (activeId === null || activeView !== 'validate') return;
    setVisitedVal((v) => (v.has(activeId) ? v : new Set(v).add(activeId)));
  }, [activeId, activeView]);

  const activeName = settingsRoute ? 'Settings' : homeRoute ? 'Home' : (tabs.find((b) => b.id === activeId)?.name ?? '');
  useEffect(() => {
    document.title = activeName ? `${activeName} · PM Cockpit` : 'PM Cockpit';
  }, [activeName]);

  const pendingCbs = useRef(new Map<string, (n: number) => void>());
  const pendingCb = (id: string) => {
    let f = pendingCbs.current.get(id);
    if (!f) {
      f = (n: number) => setPendingById((p) => (p[id] === n ? p : { ...p, [id]: n }));
      pendingCbs.current.set(id, f);
    }
    return f;
  };
  const pendingFor = (id: string) => (tabIds.has(id) ? (pendingById[id] ?? 0) : 0);
  const totalPending = tabs.reduce((s, b) => s + pendingFor(b.id), 0);

  const go = (target: 'settings' | 'home' | string, view: View = 'backlog') => {
    const hash =
      target === 'home'
        ? '#/'
        : target === 'settings'
        ? '#/settings'
        : `#/b/${encodeURIComponent(target)}${view === 'validate' ? '/validate' : ''}`;
    if (window.location.hash === hash) return;
    if (
      target === 'settings' &&
      !settingsRoute &&
      totalPending > 0 &&
      !window.confirm(
        `You have ${totalPending} item(s) with pending edits. They are kept while you browse settings, but saving settings reloads the backlogs and discards them. Continue?`,
      )
    ) {
      return;
    }
    window.location.hash = hash;
  };

  const valCount = (id: string): number | undefined => valStats[id]?.total ?? summary[id]?.toValidate;

  const SIDEBAR_KEY = 'cmfpm.sidebarCollapsed.v1';
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggleCollapsed = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, c ? '0' : '1');
      } catch {
        /* storage blocked */
      }
      return !c;
    });
  const current: NavTarget = settingsRoute
    ? { kind: 'settings' }
    : homeRoute || activeId === null
      ? { kind: 'home' }
      : { kind: 'area', id: activeId, view: activeView };
  const goNav = (t: NavTarget) => (t.kind === 'area' ? go(t.id, t.view) : go(t.kind));

  const onSaved = useCallback(async () => {
    await loadSettings();
    setReloadToken((n) => n + 1);
  }, [loadSettings]);

  return (
    <div className={'app' + (collapsed ? ' sidebar-collapsed' : '')}>
      <Sidebar
        backlogs={tabs}
        current={current}
        go={goNav}
        pending={pendingFor}
        waiting={(id) => summary[id]?.waiting ?? 0}
        toValidate={valCount}
        validateWaiting={(id) => valStats[id]?.waiting ?? 0}
        health={health}
        healthErr={healthErr}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
      />
      <main>
        {!settings && <div className="page">{settingsErr ? <div className="banner error">{settingsErr}</div> : 'Loading…'}</div>}
        {tabs
          .filter((b) => visited.has(b.id) || b.id === activeId)
          .map((b) => (
            <BacklogPage
              key={b.id}
              backlogId={b.id}
              backlogName={b.name}
              backlogColor={b.color}
              toValidate={valCount(b.id)}
              active={b.id === activeId && activeView === 'backlog'}
              reloadToken={reloadToken}
              staleToken={staleTokens[b.id] ?? 0}
              onMoved={() => onMoved(b.id)}
              onPendingCount={pendingCb(b.id)}
              me={health?.identity}
            />
          ))}
        {tabs
          .filter((b) => visitedVal.has(b.id))
          .map((b) => (
            <ValidationPage
              key={b.id}
              backlogId={b.id}
              backlogName={b.name}
              backlogColor={b.color}
              active={b.id === activeId && activeView === 'validate'}
              onChanged={(action) => onValidated(b.id, action)}
              onStats={statsCb(b.id)}
              me={health?.identity}
            />
          ))}
        {settings && visitedHome && (
          <HomePage active={homeRoute} backlogs={tabs} onAttentionChanged={() => void loadSummary()} me={health?.identity} />
        )}
        {settingsRoute && <SettingsPage onSaved={onSaved} />}
      </main>
      <ToastHost />
    </div>
  );
}
