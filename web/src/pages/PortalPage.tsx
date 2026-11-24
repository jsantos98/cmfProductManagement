import { useCallback, useMemo, useRef, useState } from 'react';
import { AgGridReact, type CustomCellRendererProps } from 'ag-grid-react';
import type { CellClickedEvent, ColDef, GridApi, GridReadyEvent, RowClassParams, ValueGetterParams } from 'ag-grid-community';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';
import type { PortalTicketRow } from '../../../server/src/types';
import { api } from '../api';
import PortalTicketPanel from '../components/PortalTicketPanel';
import { toast } from '../components/Toasts';
import { EmptyState, FilterBar, PageHeader, Skeleton, Tabs, Tile, Tiles, TilesSep, hhmm, type FilterChip } from '../ui/kit';
import { ago } from './home/kit';
import { isOverdue, type PortalState } from './portal/usePortal';
import './portal.css';

const PORTAL_URL = 'https://portal.criticalmanufacturing.com/Support/Tickets';
type Tab = 'pinned' | 'suggestions';

interface Ctx {
  pin: (t: PortalTicketRow) => void;
  unpin: (t: PortalTicketRow) => void;
  dismiss: (t: PortalTicketRow) => void;
  busy: Set<string>;
}

const dateOnly = (s: string) => (Number.isFinite(Date.parse(s)) ? new Date(s).toLocaleDateString() : '');
const ts = (s: string) => {
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
};

function IdCell(p: CustomCellRendererProps<PortalTicketRow>) {
  return p.data ? (
    <a className="pt-id" href={p.data.url} target="_blank" rel="noreferrer" title="Open in the Customer Portal">
      {p.data.id}
    </a>
  ) : null;
}
function StateCell(p: CustomCellRendererProps<PortalTicketRow>) {
  const t = p.data;
  if (!t) return null;
  return (
    <span className="pt-state">
      {t.state && <span className="badge">{t.state}</span>}
      {t.status && t.status !== t.state && <span className="muted">{t.status}</span>}
    </span>
  );
}
function ReplyCell(p: CustomCellRendererProps<PortalTicketRow>) {
  const t = p.data;
  if (!t || !t.lastReplyOn) return <span className="muted">—</span>;
  const who = [t.lastReplyRole, ago(t.lastReplyOn)].filter(Boolean).join(' · ');
  const tip = `${t.lastReplyBy ? t.lastReplyBy + ', ' : ''}${new Date(t.lastReplyOn).toLocaleString()}`;
  return (
    <span title={tip} className={t.waitingForSupport ? 'pt-waiting-txt' : undefined}>
      {who}
    </span>
  );
}
function SlaCell(p: CustomCellRendererProps<PortalTicketRow>) {
  const t = p.data;
  if (!t || !t.slaDueDate) return <span className="muted">—</span>;
  const late = isOverdue(t);
  return (
    <span className={late ? 'wait-red' : undefined} title={new Date(t.slaDueDate).toLocaleString() + (late ? ' (overdue)' : '')}>
      {dateOnly(t.slaDueDate)}
    </span>
  );
}
function MatchCell(p: CustomCellRendererProps<PortalTicketRow>) {
  const m = p.data?.matches ?? [];
  return (
    <span className="chips">
      {m.map((k) => (
        <span key={k} className="chip">
          {k}
        </span>
      ))}
    </span>
  );
}
function ActionCell(p: CustomCellRendererProps<PortalTicketRow>) {
  const t = p.data;
  const ctx = p.context as Ctx;
  if (!t) return null;
  const busy = ctx.busy.has(t.id);
  return t.pinned ? (
    <span className="pt-actions">
      <button disabled={busy} onClick={() => ctx.unpin(t)} title="Remove from My requests (local only)">
        Unpin
      </button>
    </span>
  ) : (
    <span className="pt-actions">
      <button className="primary" disabled={busy} onClick={() => ctx.pin(t)} title="Add to My requests (local only)">
        Pin
      </button>
      <button disabled={busy} onClick={() => ctx.dismiss(t)} title="Hide this suggestion (local only)">
        Dismiss
      </button>
    </span>
  );
}

/** Columns per tab: My requests shows reply/SLA tracking, Suggestions shows why it matched and its age. */
function buildColumns(tab: Tab): ColDef<PortalTicketRow>[] {
  const mine = tab === 'pinned';
  return [
    { colId: 'id', headerName: 'ID', width: 140, field: 'id', cellRenderer: IdCell, filter: 'agTextColumnFilter' },
    { colId: 'title', headerName: 'Title', field: 'title', flex: 1, minWidth: 180, filter: 'agTextColumnFilter', tooltipField: 'title' },
    {
      colId: 'customer',
      headerName: 'Customer · Site',
      width: 160,
      valueGetter: (p: ValueGetterParams<PortalTicketRow>) => (p.data ? [p.data.customer, p.data.site].filter(Boolean).join(' · ') : ''),
      filter: 'agTextColumnFilter',
      tooltipValueGetter: (p) => String(p.value ?? ''),
    },
    { colId: 'context', headerName: 'Version', width: 95, field: 'context', filter: 'agTextColumnFilter' },
    {
      colId: 'state',
      headerName: 'State / Status',
      width: 120,
      hide: !mine,
      valueGetter: (p: ValueGetterParams<PortalTicketRow>) => (p.data ? `${p.data.state} ${p.data.status}` : ''),
      cellRenderer: StateCell,
      filter: 'agTextColumnFilter',
    },
    { colId: 'priority', headerName: 'Priority', width: 70, field: 'priority', filter: 'agTextColumnFilter', valueFormatter: (p) => String(p.value ?? '').split(' ')[0], tooltipField: 'priority' },
    {
      colId: 'created',
      headerName: 'Created',
      width: 95,
      hide: mine,
      valueGetter: (p: ValueGetterParams<PortalTicketRow>) => (p.data ? ts(p.data.createdOn) : null),
      valueFormatter: (p) => (p.value ? new Date(p.value as number).toLocaleDateString() : ''),
      filter: false,
      getQuickFilterText: () => '',
    },
    {
      colId: 'lastReply',
      headerName: 'Last reply',
      width: 125,
      hide: !mine,
      valueGetter: (p: ValueGetterParams<PortalTicketRow>) => (p.data ? ts(p.data.lastReplyOn) : null),
      cellRenderer: ReplyCell,
      filter: false,
      comparator: (a: number | null, b: number | null) => (a ?? 0) - (b ?? 0),
      getQuickFilterText: () => '',
    },
    {
      colId: 'sla',
      headerName: 'SLA due',
      width: 90,
      hide: !mine,
      valueGetter: (p: ValueGetterParams<PortalTicketRow>) => (p.data ? ts(p.data.slaDueDate) : null),
      cellRenderer: SlaCell,
      filter: false,
      comparator: (a: number | null, b: number | null) => (a ?? Infinity) - (b ?? Infinity),
      getQuickFilterText: () => '',
    },
    { colId: 'replies', headerName: 'Replies', width: 75, hide: mine, field: 'replies', type: 'numericColumn', filter: 'agNumberColumnFilter' },
    { colId: 'workItems', headerName: 'WIs', headerTooltip: 'Linked work items', width: 60, field: 'workItems', type: 'numericColumn', filter: 'agNumberColumnFilter' },
    {
      colId: 'matches',
      headerName: 'Matched keywords',
      width: 160,
      hide: mine,
      valueGetter: (p: ValueGetterParams<PortalTicketRow>) => (p.data ? p.data.matches.join(', ') : ''),
      cellRenderer: MatchCell,
      filter: 'agTextColumnFilter',
    },
    {
      colId: 'actions',
      headerName: '',
      width: mine ? 80 : 140,
      pinned: 'right',
      sortable: false,
      resizable: false,
      filter: false,
      suppressMovable: true,
      suppressHeaderMenuButton: true,
      cellRenderer: ActionCell,
      getQuickFilterText: () => '',
    },
  ];
}

const matchesSearch = (t: PortalTicketRow, q: string) => {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return [t.title, t.customer, t.site, t.context, t.id].some((v) => v.toLowerCase().includes(s));
};

export default function PortalPage({ active, portal }: { active: boolean; portal: PortalState }) {
  const { status, data, err, loading, signedIn, load, mutate } = portal;
  const gridApi = useRef<GridApi<PortalTicketRow> | null>(null);
  const [tab, setTab] = useState<Tab>('pinned');
  const [quick, setQuick] = useState('');
  const [onlyWaiting, setOnlyWaiting] = useState(false);
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const detailRef = useRef<string | null>(null);
  detailRef.current = detailId;

  const pinned = data?.pinned ?? [];
  const suggestions = data?.suggestions ?? [];
  const waitingTotal = useMemo(() => pinned.filter((t) => t.waitingForSupport === true).length, [pinned]);
  const overdueTotal = useMemo(() => pinned.filter(isOverdue).length, [pinned]);

  const rows = useMemo(() => {
    let r = tab === 'pinned' ? pinned : suggestions;
    if (tab === 'pinned') {
      if (onlyWaiting) r = r.filter((t) => t.waitingForSupport === true);
      if (onlyOverdue) r = r.filter(isOverdue);
    }
    return r.filter((t) => matchesSearch(t, quick));
  }, [tab, pinned, suggestions, onlyWaiting, onlyOverdue, quick]);

  const markBusy = (id: string, on: boolean) =>
    setBusy((b) => {
      const n = new Set(b);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  const act = async (t: PortalTicketRow, label: string, optimistic: () => void, call: () => Promise<unknown>, undo?: () => Promise<unknown>) => {
    markBusy(t.id, true);
    optimistic();
    try {
      await call();
      toast('ok', label, undo ? `#${t.id} — click here to undo` : `#${t.id}`, undo ? { onClick: () => void undo().then(() => load(false)).catch(() => undefined), ms: 10_000 } : undefined);
    } catch (e) {
      toast('warn', `Could not ${label.toLowerCase()}`, e instanceof Error ? e.message : String(e));
    } finally {
      markBusy(t.id, false);
      await load(false);
    }
  };
  const pin = (t: PortalTicketRow) =>
    act(t, 'Pinned', () => mutate((d) => ({ ...d, suggestions: d.suggestions.filter((s) => s.id !== t.id), pinned: [{ ...t, pinned: true }, ...d.pinned] })), () => api.portal.pin(t.id));
  const unpin = (t: PortalTicketRow) =>
    act(t, 'Unpinned', () => mutate((d) => ({ ...d, pinned: d.pinned.filter((s) => s.id !== t.id) })), () => api.portal.unpin(t.id));
  const dismiss = (t: PortalTicketRow) =>
    act(
      t,
      'Dismissed',
      () => mutate((d) => ({ ...d, suggestions: d.suggestions.filter((s) => s.id !== t.id), dismissed: d.dismissed + 1 })),
      () => api.portal.dismiss(t.id),
      () => api.portal.undismiss(t.id),
    );

  const ctx = useRef<Ctx>({ pin, unpin, dismiss, busy }).current;
  ctx.pin = pin;
  ctx.unpin = unpin;
  ctx.dismiss = dismiss;
  ctx.busy = busy;
  const colDefs = useMemo(() => buildColumns(tab), [tab]);
  const defaultColDef = useMemo<ColDef<PortalTicketRow>>(() => ({ sortable: true, resizable: true }), []);

  const onCellClicked = (e: CellClickedEvent<PortalTicketRow>) => {
    if (!e.data || e.colDef.colId === 'actions') return;
    if ((e.event?.target as HTMLElement | null)?.closest('a,input,button,label')) return;
    setDetailId(e.data.id);
  };
  const stepDetail = useCallback(
    (delta: -1 | 1) => {
      const a = gridApi.current;
      if (!a || detailRef.current === null) return;
      const n = a.getDisplayedRowCount();
      for (let i = 0; i < n; i++) {
        if (a.getDisplayedRowAtIndex(i)?.data?.id !== detailRef.current) continue;
        const next = a.getDisplayedRowAtIndex(i + delta);
        if (next?.data) {
          a.ensureNodeVisible(next);
          setDetailId(next.data.id);
        }
        return;
      }
    },
    [],
  );
  const closeDetail = useCallback(() => setDetailId(null), []);
  const detailRow = detailId === null ? undefined : (pinned.find((t) => t.id === detailId) ?? suggestions.find((t) => t.id === detailId));
  const lastRow = useRef<PortalTicketRow | undefined>(undefined);
  if (detailRow) lastRow.current = detailRow;
  // keep the panel on a ticket that just left the list (e.g. unpinned while open)
  const panelRow = detailId === null ? undefined : (detailRow ?? (lastRow.current?.id === detailId ? lastRow.current : undefined));

  const togglePin = (t: PortalTicketRow) => void (t.pinned ? unpin(t) : pin(t));

  const toTab = (t: Tab) => setTab(t);
  const flt = (which: 'waiting' | 'overdue') => {
    setTab('pinned');
    if (which === 'waiting') setOnlyWaiting((v) => !v);
    else setOnlyOverdue((v) => !v);
  };
  const chips: FilterChip[] = [];
  if (onlyWaiting) chips.push({ key: 'waiting', label: 'Waiting for us only', onClear: () => setOnlyWaiting(false) });
  if (onlyOverdue) chips.push({ key: 'overdue', label: 'Overdue SLA only', onClear: () => setOnlyOverdue(false) });
  const clearAll = () => {
    setOnlyWaiting(false);
    setOnlyOverdue(false);
  };

  const firstLoad = loading && !data && signedIn === null;
  const needSignIn = signedIn === false;
  const signIn = () => {
    window.location.href = '/api/portal/login';
  };
  const signOut = async () => {
    // not offered when signed out; kept here so the header action stays one place
    try {
      await api.portal.logout();
    } catch (e) {
      toast('warn', 'Could not sign out', e instanceof Error ? e.message : String(e));
    }
    await load(true);
  };

  return (
    <div className={'page portal pt-page' + (active ? '' : ' hidden')} aria-label="Customer Portal — enhancement requests">
      <PageHeader
        kicker="Customer Portal"
        title="Enhancement requests"
        meta={`loaded ${hhmm(portal.loadedAt) || '—'}`}
        tabs={
          data ? (
            <Tabs
              items={[
                { label: `My requests (${pinned.length})`, href: '#/portal?tab=pinned', on: tab === 'pinned', onClick: (e) => (e.preventDefault(), toTab('pinned')) },
                { label: `Suggestions (${suggestions.length})`, href: '#/portal?tab=suggestions', on: tab === 'suggestions', onClick: (e) => (e.preventDefault(), toTab('suggestions')) },
              ]}
            />
          ) : undefined
        }
      >
        {signedIn && status?.user && (
          <span className="pt-user" title={status.email ?? ''}>
            {status.user}
          </span>
        )}
        {signedIn && <button onClick={() => void signOut()}>Sign out</button>}
        <button onClick={() => void load(true)} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        <a className="pt-ext" href={PORTAL_URL} target="_blank" rel="noopener noreferrer">
          Open portal ↗
        </a>
      </PageHeader>
      <div className="page-body">
        {firstLoad && (
          <div className="pt-skel" aria-busy="true">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} height={22} />
            ))}
          </div>
        )}
        {needSignIn && (
          <EmptyState icon="🔒" title="Not signed in to the Customer Portal">
            <p className="muted">Sign in to see your enhancement requests and suggestions.</p>
            {(status?.error || err) && <div className="banner error">{status?.error ?? err}</div>}
            <button className="primary" onClick={signIn}>
              Sign in to Customer Portal
            </button>
          </EmptyState>
        )}
        {err && !needSignIn && <div className="banner error">{err}</div>}
        {data && (
          <>
            <Tiles>
              <Tile label="Pinned" value={pinned.length} active={tab === 'pinned' && !onlyWaiting && !onlyOverdue} onClick={() => (clearAll(), toTab('pinned'))} title="Your pinned requests" />
              <Tile
                label="Waiting for us"
                value={waitingTotal}
                tone={waitingTotal > 0 ? 'warn' : undefined}
                active={onlyWaiting}
                onClick={waitingTotal > 0 || onlyWaiting ? () => flt('waiting') : undefined}
                title="Pinned requests whose last reply is from the customer side (waiting for support)"
              />
              <Tile
                label="Overdue SLA"
                value={overdueTotal}
                tone={overdueTotal > 0 ? 'bad' : undefined}
                active={onlyOverdue}
                onClick={overdueTotal > 0 || onlyOverdue ? () => flt('overdue') : undefined}
                title="Pinned requests whose SLA due date has passed"
              />
              <TilesSep />
              <Tile label="Suggestions" value={suggestions.length} active={tab === 'suggestions'} onClick={() => toTab('suggestions')} title={`Open requests matching your keywords (${data.dismissed} dismissed)`} />
              <Tile label="Open requests" value={data.openTotal} title="All open enhancement requests in the portal" />
            </Tiles>
            <FilterBar search={quick} onSearch={setQuick} placeholder="Search title, customer, site, version, id…" chips={chips} onClearAll={clearAll} />
            {data.errors.length > 0 && (
              <div className="banner warn">
                {data.errors.length} pinned ticket(s) could not be read: {data.errors.map((x) => `#${x.id} (${x.error})`).join('; ')}
              </div>
            )}
            {rows.length === 0 && (
              <EmptyState icon={tab === 'pinned' ? '📌' : '✓'} title={tab === 'pinned' ? 'No pinned requests match' : 'No suggestions match'}>
                {tab === 'pinned' ? 'Pin a suggestion to follow it here.' : 'Nothing new matches your keywords.'}
              </EmptyState>
            )}
            <div className="grid-wrap ag-theme-quartz" style={rows.length === 0 ? { display: 'none' } : undefined}>
              <AgGridReact<PortalTicketRow>
                key={tab}
                rowData={rows}
                columnDefs={colDefs}
                defaultColDef={defaultColDef}
                context={ctx}
                getRowId={(p) => p.data.id}
                tooltipShowDelay={300}
                rowHeight={30}
                headerHeight={32}
                suppressCellFocus
                getRowClass={(p: RowClassParams<PortalTicketRow>) => {
                  if (!p.data) return undefined;
                  const c = [p.data.waitingForSupport ? 'pt-row-waiting' : '', p.data.id === detailRef.current ? 'row-open' : ''].filter(Boolean);
                  return c.length ? c : undefined;
                }}
                onCellClicked={onCellClicked}
                onGridReady={(e: GridReadyEvent<PortalTicketRow>) => {
                  gridApi.current = e.api;
                }}
                onRowDataUpdated={() => gridApi.current?.refreshCells({ columns: ['actions'], force: true })}
              />
            </div>
          </>
        )}
      </div>
      {panelRow && active && <PortalTicketPanel row={panelRow} onClose={closeDetail} onStep={stepDetail} onTogglePin={togglePin} busy={busy.has(panelRow.id)} onChanged={() => void load(true)} />}
    </div>
  );
}
