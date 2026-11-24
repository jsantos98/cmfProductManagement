import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AgGridReact, type CustomCellRendererProps } from 'ag-grid-react';
import type {
  CellClickedEvent,
  CellContextMenuEvent,
  ColDef,
  GridApi,
  GridReadyEvent,
  RowClassParams,
  ValueFormatterParams,
  ValueGetterParams,
} from 'ag-grid-community';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';
import type { AttentionEntry, ChangesResponse, PrRef, ValidationItem } from '../../../server/src/types';
import { api } from '../api';
import CheckboxFilter, { type CheckboxFilterParams } from '../components/CheckboxFilter';
import ItemDetailsModal from '../components/ItemDetailsModal';
import RowContextMenu, { type MenuEntry } from '../components/RowContextMenu';
import { toast } from '../components/Toasts';

const lsCols = (id: string) => `cmfpm.columnState.v1.validate.${id}`;
const lsGet = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
};

const ROW_TYPE: Record<string, string> = { Epic: 'epic', Feature: 'feature', 'User Story': 'story', Bug: 'bug' };
const TYPE_ORDER = ['Epic', 'Feature', 'User Story', 'Bug'];
const typeClass = (t: string) => 'pill pill-' + t.toLowerCase().replace(/\s+/g, '-');
const DAY = 86_400_000;
/** days since resolved; null when TFS has no resolved date */
const waitDays = (it: ValidationItem): number | null => {
  const t = Date.parse(it.resolvedDate);
  return Number.isNaN(t) ? null : Math.max(0, Math.floor((Date.now() - t) / DAY));
};
/** nulls/empties always last, whatever the sort direction */
const nullsLast = (a: unknown, b: unknown, _na: unknown, _nb: unknown, desc: boolean) => {
  const ea = a === null || a === undefined || a === '';
  const eb = b === null || b === undefined || b === '';
  if (ea || eb) return ea && eb ? 0 : (ea ? 1 : -1) * (desc ? -1 : 1);
  return (a as number | string) < (b as number | string) ? -1 : (a as number | string) > (b as number | string) ? 1 : 0;
};
// ---- pull requests ----
const NO_PR = '(no PR)';
const PR_UNKNOWN = '(unknown)';
const PR_OTHER = 'other';
/** "12.1" > "12.0" > "11.3.7" > "11.3" (numeric, more parts = later) */
const cmpVersion = (a: string, b: string) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? -1) - (pb[i] ?? -1);
    if (d) return d;
  }
  return 0;
};
/** no completed PR (and the links were read) */
const noPr = (it: ValidationItem) => !!it.prs && it.prs.length === 0 && !it.prError;
/** filter values: distinct versions (highest first), "other", or a marker */
const prLabels = (it: ValidationItem): string[] => {
  if (!it.prs) return [PR_UNKNOWN];
  if (!it.prs.length) return [it.prError ? PR_UNKNOWN : NO_PR];
  const v = [...new Set(it.prs.map((p) => p.version).filter((x): x is string => !!x))].sort((a, b) => cmpVersion(b, a));
  return it.prs.some((p) => !p.version) ? [...v, PR_OTHER] : v;
};
/** sort key: highest version; other-only below versions; no PR / unknown last (null) */
const prSortKey = (it: ValidationItem): string | null => {
  const l = prLabels(it);
  return l[0] === NO_PR || l[0] === PR_UNKNOWN ? null : l[0];
};
const prComparator = (a: string | null, b: string | null, _na: unknown, _nb: unknown, desc: boolean) => {
  if (a === null || b === null) return a === b ? 0 : (a === null ? 1 : -1) * (desc ? -1 : 1);
  if (a === PR_OTHER || b === PR_OTHER) return a === b ? 0 : a === PR_OTHER ? -1 : 1;
  return cmpVersion(a, b);
};
const prLine = (p: PrRef) => `#${p.id} ${p.repo} → ${p.target}${p.closedDate ? ` (${new Date(p.closedDate).toLocaleDateString()})` : ''}`;
const openNote = (n?: number) => (n ? `\n${n} active PR${n === 1 ? '' : 's'} (not completed)` : '');

const idList = (ids: number[]) => (ids.length > 8 ? `${ids.slice(0, 8).map((i) => '#' + i).join(', ')} +${ids.length - 8} more` : ids.map((i) => '#' + i).join(', '));

interface Ctx {
  attention: Map<number, AttentionEntry>;
  onlyWaiting: boolean;
  onlyNoPr: boolean;
}

function TypeCell(p: CustomCellRendererProps<ValidationItem>) {
  return p.value ? <span className={typeClass(String(p.value))}>{String(p.value)}</span> : null;
}
function IdCell(p: CustomCellRendererProps<ValidationItem>) {
  return p.data ? (
    <a href={p.data.url} target="_blank" rel="noreferrer">
      {p.data.id}
    </a>
  ) : null;
}
function TagsCell(p: CustomCellRendererProps<ValidationItem, string[]>) {
  return (
    <span className="chips">
      {(p.value ?? []).map((t) => (
        <span key={t} className="chip">
          {t}
        </span>
      ))}
    </span>
  );
}
function WaitingCell(p: CustomCellRendererProps<ValidationItem>) {
  const ctx = p.context as Ctx;
  const a = p.data ? ctx.attention.get(p.data.id) : undefined;
  if (!a) return null;
  const tip = `${a.count} comment${a.count === 1 ? '' : 's'} waiting for you — last: ${a.lastAuthor}, ${new Date(a.lastDate).toLocaleString()}: ${a.snippet}`;
  return (
    <span className="waiting-badge" title={tip}>
      💬 {a.count}
    </span>
  );
}
function PrCell(p: CustomCellRendererProps<ValidationItem>) {
  const it = p.data;
  if (!it) return null;
  if (!it.prs) {
    return (
      <span className="pr-chip unknown" title="Pull request links could not be read from TFS">
        ?
      </span>
    );
  }
  if (noPr(it)) {
    return (
      <span className="pr-chip nopr" title={'No completed pull request: analyse this item before validating' + openNote(it.prOpen)}>
        ⚠ No PR — analyse
      </span>
    );
  }
  const tip = 'Completed pull requests:\n' + it.prs.map(prLine).join('\n') + openNote(it.prOpen) + (it.prError ? `\n${it.prError}` : '');
  // one chip per version (highest first), then one per non-version branch; each links to its newest PR
  const byKey = new Map<string, PrRef>();
  for (const pr of [...it.prs].sort((a, b) => b.id - a.id)) {
    const k = pr.version ?? '~' + pr.target;
    if (!byKey.has(k)) byKey.set(k, pr);
  }
  const rank = (k: string) => (k.startsWith('~') ? 1 : 0);
  const chips = [...byKey.entries()].sort(([a], [b]) => rank(a) - rank(b) || (rank(a) ? a.localeCompare(b) : cmpVersion(b, a)));
  return (
    <span className="chips" title={tip}>
      {chips.map(([k, pr]) => (
        <a key={k} className={'pr-chip' + (pr.version ? '' : ' other')} href={pr.url} target="_blank" rel="noreferrer">
          {pr.version ?? pr.target}
        </a>
      ))}
      {it.prError && <span className="pr-chip unknown">?</span>}
    </span>
  );
}
function AgeCell(p: CustomCellRendererProps<ValidationItem, number | null>) {
  const d = p.value;
  if (d === null || d === undefined) return <span className="muted" title="TFS has no resolved date">—</span>;
  return <span className={d >= 30 ? 'wait-red' : d >= 14 ? 'wait-amber' : undefined}>{d}d</span>;
}

const LISTED_ME = 'Assigned to me';
const LISTED_FEATURE = 'My Feature';
/** Why the item is in the list: assigned to me, or only because its parent Feature is mine (then show who has it). */
function ListedForCell(p: CustomCellRendererProps<ValidationItem>) {
  const it = p.data;
  if (!it) return null;
  if (!it.viaFeature) return <span className="muted">{LISTED_ME}</span>;
  const who = it.assignedTo || 'unassigned';
  return (
    <span title={`Parent Feature #${it.parentId} ${it.parentTitle} is assigned to you; this item is assigned to ${who}`}>
      <span className="listed-feature">{LISTED_FEATURE}</span> <span className="muted">{who}</span>
    </span>
  );
}

function buildColumns(ctx: Ctx): ColDef<ValidationItem>[] {
  return [
    {
      colId: 'sel',
      headerName: '',
      width: 44,
      maxWidth: 44,
      pinned: 'left',
      checkboxSelection: true,
      headerCheckboxSelection: true,
      headerCheckboxSelectionFilteredOnly: true,
      sortable: false,
      resizable: false,
      filter: false,
      suppressMovable: true,
      lockVisible: true,
      suppressHeaderMenuButton: true,
      getQuickFilterText: () => '',
    },
    { colId: 'id', headerName: 'ID', width: 90, field: 'id', filter: 'agNumberColumnFilter', cellRenderer: IdCell },
    {
      colId: 'waiting',
      headerName: '💬',
      headerTooltip: 'Comments waiting for you (@mentions)',
      width: 56,
      maxWidth: 70,
      filter: false,
      valueGetter: (p: ValueGetterParams<ValidationItem>) => (p.data ? (ctx.attention.get(p.data.id)?.count ?? 0) : 0),
      cellRenderer: WaitingCell,
      getQuickFilterText: () => '',
    },
    {
      colId: 'type',
      headerName: 'Type',
      width: 110,
      field: 'type',
      filter: CheckboxFilter,
      filterParams: { order: () => TYPE_ORDER } satisfies CheckboxFilterParams,
      cellRenderer: TypeCell,
    },
    {
      colId: 'prs',
      headerName: 'PR versions',
      headerTooltip: 'Versions with a completed pull request (12.1/dev → 12.1, 11.3/7/beta → 11.3.7; other branches in grey)',
      width: 200,
      valueGetter: (p: ValueGetterParams<ValidationItem>) => (p.data ? prLabels(p.data) : []),
      cellRenderer: PrCell,
      filter: CheckboxFilter,
      filterParams: { multi: true, note: 'unchecked versions hide their rows' } satisfies CheckboxFilterParams,
      comparator: (_a: unknown, _b: unknown, na, nb, desc: boolean) =>
        prComparator(na.data ? prSortKey(na.data) : null, nb.data ? prSortKey(nb.data) : null, na, nb, desc),
      getQuickFilterText: (p) => (p.data ? [...prLabels(p.data), ...(p.data.prs ?? []).map((r) => r.target)].join(' ') : ''),
    },
    { colId: 'title', headerName: 'Title', field: 'title', flex: 1, minWidth: 300, filter: 'agTextColumnFilter' },
    {
      colId: 'listedFor',
      headerName: 'Listed for',
      headerTooltip: 'Assigned to me, or under a Feature assigned to me (the item itself is assigned to someone else)',
      width: 230,
      valueGetter: (p: ValueGetterParams<ValidationItem>) => (p.data ? (p.data.viaFeature ? LISTED_FEATURE : LISTED_ME) : null),
      cellRenderer: ListedForCell,
      filter: CheckboxFilter,
      getQuickFilterText: (p) => (p.data ? `${p.value} ${p.data.assignedTo}` : ''),
    },
    {
      colId: 'resolvedReason',
      headerName: 'Resolved reason',
      width: 140,
      field: 'resolvedReason',
      filter: CheckboxFilter,
    },
    { colId: 'resolvedBy', headerName: 'Resolved by', width: 150, field: 'resolvedBy', filter: CheckboxFilter },
    {
      colId: 'resolvedDate',
      headerName: 'Resolved on',
      width: 120,
      field: 'resolvedDate',
      // ISO strings sort chronologically
      valueFormatter: (p: ValueFormatterParams<ValidationItem, string>) => (p.value ? new Date(p.value).toLocaleDateString() : ''),
      comparator: nullsLast,
      filter: 'agTextColumnFilter',
      sort: 'asc',
    },
    {
      colId: 'waitDays',
      headerName: 'Waiting',
      headerTooltip: 'Days since resolved (amber from 14, red from 30)',
      width: 90,
      type: 'numericColumn',
      valueGetter: (p: ValueGetterParams<ValidationItem>) => (p.data ? waitDays(p.data) : null),
      comparator: nullsLast,
      cellRenderer: AgeCell,
      filter: 'agNumberColumnFilter',
      getQuickFilterText: () => '',
    },
    {
      colId: 'tags',
      headerName: 'Tags',
      width: 220,
      field: 'tags',
      cellRenderer: TagsCell,
      filter: CheckboxFilter,
      filterParams: { multi: true } satisfies CheckboxFilterParams,
      getQuickFilterText: (p) => (p.data ? p.data.tags.join(' ') : ''),
      comparator: (a: string[] | undefined, b: string[] | undefined) => (a ?? []).join(';').localeCompare((b ?? []).join(';')),
    },
    { colId: 'iterationPath', headerName: 'Iteration', width: 170, field: 'iterationPath', filter: 'agTextColumnFilter' },
    {
      colId: 'parent',
      headerName: 'Parent',
      width: 240,
      valueGetter: (p: ValueGetterParams<ValidationItem>) =>
        p.data && p.data.parentId !== null ? `#${p.data.parentId} ${p.data.parentTitle}` : '',
      filter: 'agTextColumnFilter',
    },
  ];
}

interface Props {
  backlogId: string;
  backlogName: string;
  /** area colour (header dot) */
  backlogColor?: string;
  active: boolean;
  onChanged: (action: 'close' | 'reject') => void;
  /** reports the loaded item count and how many have waiting comments (for the sub-tab) */
  onStats?: (s: { total: number; waiting: number }) => void;
  me?: string;
}

interface Failure {
  failed: { id: number; error: string }[];
  nothingWritten: boolean;
  err?: string;
}

export default function ValidationPage({ backlogId, backlogName, active, onChanged, onStats }: Props) {
  const gridApi = useRef<GridApi<ValidationItem> | null>(null);
  const [items, setItems] = useState<ValidationItem[]>([]);
  const [loadedAt, setLoadedAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [quick, setQuick] = useState('');
  const [selCount, setSelCount] = useState(0);
  const [onlyWaiting, setOnlyWaiting] = useState(false);
  const [onlyNoPr, setOnlyNoPr] = useState(false);
  const [attention, setAttention] = useState<Map<number, AttentionEntry>>(new Map());
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState<ValidationItem[] | null>(null);
  const [comment, setComment] = useState('');
  const [failure, setFailure] = useState<Failure | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; header: string; entries: MenuEntry[] } | null>(null);

  const ctx = useRef<Ctx>({ attention: new Map(), onlyWaiting: false, onlyNoPr: false }).current;
  ctx.attention = attention;
  ctx.onlyWaiting = onlyWaiting;
  ctx.onlyNoPr = onlyNoPr;

  const colDefs = useMemo(() => buildColumns(ctx), [ctx]);
  const defaultColDef = useMemo<ColDef<ValidationItem>>(() => ({ sortable: true, resizable: true }), []);

  const attentionAt = useRef(0);
  const loadAttention = useCallback(async () => {
    attentionAt.current = Date.now();
    try {
      const r = await api.attention(backlogId, 'validate');
      setAttention(new Map(r.items.map((a) => [a.id, a])));
    } catch (e) {
      console.warn('validation attention load failed', e);
    }
  }, [backlogId]);

  const load = useCallback(
    async (refresh: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const r = await api.validation(backlogId, refresh);
        setItems(r.items);
        setLoadedAt(r.loadedAt);
        setLoaded(true);
        void loadAttention();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [backlogId, loadAttention],
  );
  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    if (!loaded) return;
    const ids = new Set(items.map((i) => i.id));
    let waiting = 0;
    attention.forEach((_, id) => {
      if (ids.has(id)) waiting++;
    });
    onStats?.({ total: items.length, waiting });
  }, [items, attention, loaded, onStats]);

  useEffect(() => {
    if (!active) return;
    const check = (minAge: number) => {
      if (document.visibilityState === 'visible' && Date.now() - attentionAt.current > minAge) void loadAttention();
    };
    const onFocus = () => check(60_000);
    check(60_000);
    const timer = window.setInterval(() => check(0), 5 * 60_000);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [active, loadAttention]);

  useEffect(() => {
    gridApi.current?.onFilterChanged();
    gridApi.current?.refreshCells({ columns: ['waiting'], force: true, suppressFlash: true });
  }, [attention, onlyWaiting, onlyNoPr]);

  const isExternalFilterPresent = useCallback(() => ctx.onlyWaiting || ctx.onlyNoPr, [ctx]);
  const doesExternalFilterPass = useCallback(
    (node: { data?: ValidationItem }) =>
      !!node.data && (!ctx.onlyWaiting || ctx.attention.has(node.data.id)) && (!ctx.onlyNoPr || noPr(node.data)),
    [ctx],
  );

  const saveState = useCallback(() => {
    const st = gridApi.current?.getColumnState().filter((c) => c.colId !== 'sel');
    if (st) lsSet(lsCols(backlogId), JSON.stringify(st));
  }, [backlogId]);
  const onGridReady = (e: GridReadyEvent<ValidationItem>) => {
    gridApi.current = e.api;
    const raw = lsGet(lsCols(backlogId));
    if (raw) {
      try {
        e.api.applyColumnState({ state: JSON.parse(raw) as { colId: string }[], applyOrder: true });
      } catch {
        /* ignore corrupt state */
      }
    }
  };

  // ---- actions ----
  const selected = (): ValidationItem[] => gridApi.current?.getSelectedRows() ?? [];

  const transition = async (targets: ValidationItem[], action: 'close' | 'reject', text?: string) => {
    if (!targets.length || busy) return;
    setBusy(true);
    let resp: ChangesResponse | null = null;
    try {
      resp = await api.transition(
        backlogId,
        { items: targets.map((t) => ({ id: t.id, rev: t.rev })), action, ...(text?.trim() ? { comment: text.trim() } : {}) },
        false,
      );
    } catch (e) {
      setFailure({ failed: [], nothingWritten: false, err: e instanceof Error ? e.message : String(e) });
      setBusy(false);
      return;
    }
    const okIds = resp.phase === 'applied' ? resp.results.filter((r) => r.ok).map((r) => r.id) : [];
    const failed = resp.results.filter((r) => !r.ok).map((r) => ({ id: r.id, error: r.error ?? 'Failed' }));
    if (okIds.length) {
      const gone = new Set(okIds);
      setItems((prev) => prev.filter((i) => !gone.has(i.id)));
      setRejecting(null);
      toast(
        'ok',
        `${okIds.length} item${okIds.length === 1 ? '' : 's'} ${action === 'close' ? 'closed in TFS' : 'reactivated'}`,
        idList(okIds),
      );
      onChanged(action);
    }
    if (failed.length || resp.phase !== 'applied') {
      setFailure({ failed, nothingWritten: resp.phase !== 'applied' });
    } else {
      setRejecting(null);
    }
    setBusy(false);
  };

  const startReject = (targets: ValidationItem[]) => {
    if (!targets.length) return;
    setComment('');
    setRejecting(targets);
  };
  const submitReject = () => {
    if (rejecting && !busy) void transition(rejecting, 'reject', comment);
  };

  // ---- grid events ----
  const onCellClicked = (e: CellClickedEvent<ValidationItem>) => {
    if (!e.data || e.colDef.colId === 'sel') return;
    if ((e.event?.target as HTMLElement | null)?.closest('a,input,button,label')) return;
    setDetailId(e.data.id);
  };
  const closeMenu = useCallback(() => setMenu(null), []);
  const onCellContextMenu = (e: CellContextMenuEvent<ValidationItem>) => {
    const ev = e.event as MouseEvent | null | undefined;
    const clicked = e.data;
    if (!ev || !clicked) return;
    ev.preventDefault();
    const sel = selected();
    const targets = sel.length > 1 && sel.some((i) => i.id === clicked.id) ? sel : [clicked];
    const header =
      targets.length > 1
        ? `${targets.length} selected items`
        : `#${clicked.id} ${clicked.title.length > 40 ? clicked.title.slice(0, 40) + '…' : clicked.title}`;
    const entries: MenuEntry[] = [
      { kind: 'item', label: '✓ Validated → Close', disabled: busy, onSelect: () => void transition(targets, 'close') },
      { kind: 'item', label: '✗ Reject → Active…', disabled: busy, onSelect: () => startReject(targets) },
      { kind: 'sep' },
      { kind: 'item', label: 'Open details', onSelect: () => setDetailId(clicked.id) },
      { kind: 'item', label: 'Open in TFS ↗', onSelect: () => window.open(clicked.url, '_blank', 'noopener') },
    ];
    setMenu({ x: ev.clientX, y: ev.clientY, header, entries });
  };
  const stepDetail = useCallback(
    (delta: -1 | 1) => {
      const a = gridApi.current;
      if (!a || detailId === null) return;
      const n = a.getDisplayedRowCount();
      for (let i = 0; i < n; i++) {
        if (a.getDisplayedRowAtIndex(i)?.data?.id !== detailId) continue;
        const next = a.getDisplayedRowAtIndex(i + delta);
        if (next?.data) {
          a.ensureNodeVisible(next);
          setDetailId(next.data.id);
        }
        return;
      }
    },
    [detailId],
  );
  const closeDetail = useCallback(() => setDetailId(null), []);

  const waitingTotal = useMemo(() => items.filter((i) => attention.has(i.id)).length, [items, attention]);
  const noPrTotal = useMemo(() => items.filter(noPr).length, [items]);
  useEffect(() => {
    if (noPrTotal === 0 && onlyNoPr) setOnlyNoPr(false);
  }, [noPrTotal, onlyNoPr]);

  return (
    <div className={'page validation' + (active ? '' : ' hidden')} aria-label={`${backlogName} — to validate`}>
      <div className="toolbar">
        <input className="search" type="search" placeholder="Quick search…" value={quick} onChange={(e) => setQuick(e.target.value)} />
        <button onClick={() => void load(true)} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        <span className="muted">loaded {loadedAt ? new Date(loadedAt).toLocaleTimeString() : '—'}</span>
        {waitingTotal > 0 && (
          <label className="inline toggle" title="Only items with comments waiting for you">
            <input type="checkbox" checked={onlyWaiting} onChange={(e) => setOnlyWaiting(e.target.checked)} />
            💬 only ({waitingTotal})
          </label>
        )}
        {noPrTotal > 0 && (
          <label className="inline toggle nopr-toggle" title="Only items with no completed pull request (to analyse)">
            <input type="checkbox" checked={onlyNoPr} onChange={(e) => setOnlyNoPr(e.target.checked)} />
            ⚠ No PR only ({noPrTotal})
          </label>
        )}
        <span className="grow" />
        <span className="muted">{selCount} selected</span>
        <button
          className="primary"
          disabled={selCount === 0 || busy}
          onClick={() => void transition(selected(), 'close')}
          title="Validated: close the selected items in TFS"
        >
          ✓ Close
        </button>
        <button disabled={selCount === 0 || busy} onClick={() => startReject(selected())} title="Send the selected items back to Active">
          ✗ Reject…
        </button>
      </div>
      {error && <div className="banner error">{error}</div>}
      {loaded && items.length === 0 && !error && <div className="empty-state">Nothing to validate 🎉</div>}
      <div
        className="grid-wrap ag-theme-quartz"
        style={items.length === 0 && loaded ? { display: 'none' } : undefined}
        onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest('.ag-row')) e.preventDefault();
        }}
      >
        <AgGridReact<ValidationItem>
          rowData={items}
          columnDefs={colDefs}
          defaultColDef={defaultColDef}
          context={ctx}
          getRowId={(p) => String(p.data.id)}
          quickFilterText={quick}
          rowSelection="multiple"
          suppressRowClickSelection
          tooltipShowDelay={300}
          rowHeight={30}
          headerHeight={32}
          isExternalFilterPresent={isExternalFilterPresent}
          doesExternalFilterPass={doesExternalFilterPass}
          getRowClass={(p: RowClassParams<ValidationItem>) => {
            if (!p.data) return undefined;
            const c = [ROW_TYPE[p.data.type] ? 'row-type-' + ROW_TYPE[p.data.type] : '', noPr(p.data) ? 'row-nopr' : ''].filter(Boolean);
            return c.length ? c : undefined;
          }}
          onCellClicked={onCellClicked}
          onCellContextMenu={onCellContextMenu}
          onGridReady={onGridReady}
          onSelectionChanged={(e) => setSelCount(e.api.getSelectedNodes().length)}
          onColumnMoved={saveState}
          onColumnResized={(e) => e.finished && saveState()}
          onColumnVisible={saveState}
          onSortChanged={saveState}
        />
      </div>
      {menu && <RowContextMenu x={menu.x} y={menu.y} header={menu.header} entries={menu.entries} onClose={closeMenu} />}
      {detailId !== null && (
        <ItemDetailsModal id={detailId} bands={[]} onClose={closeDetail} onOpen={setDetailId} onStep={stepDetail} onAttentionChanged={() => void loadAttention()} />
      )}
      {rejecting && (
        <div className="modal-backdrop">
          <div
            className="modal modal-reject"
            role="dialog"
            aria-label="Reject items"
            onKeyDown={(e) => {
              if (e.key === 'Escape' && !busy) setRejecting(null);
              else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submitReject();
            }}
          >
            <h3>
              Reject {rejecting.length} item{rejecting.length === 1 ? '' : 's'} → Active
            </h3>
            <div className="modal-body">
              <div className="muted reject-ids">{idList(rejecting.map((r) => r.id))}</div>
              <label className="field">
                Comment (optional, added to the item's discussion)
                <textarea rows={5} autoFocus value={comment} onChange={(e) => setComment(e.target.value)} />
              </label>
            </div>
            <div className="modal-foot">
              <span className="muted grow">Ctrl+Enter to reject</span>
              <button className="primary" disabled={busy} onClick={submitReject}>
                {busy ? 'Working…' : 'Reject'}
              </button>
              <button disabled={busy} onClick={() => setRejecting(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {failure && (
        <div className="modal-backdrop">
          <div className="modal modal-reject" role="alertdialog" aria-label="Transition failed">
            <h3>Some items could not be updated</h3>
            <div className="modal-body">
              {failure.err && <div className="banner error">{failure.err}</div>}
              {failure.failed.map((f) => (
                <div key={f.id} className="error-text">
                  <b>#{f.id}</b>: {f.error}
                </div>
              ))}
              {failure.nothingWritten && (
                <div className="banner error">
                  Validation failed: <b>nothing was written</b> to TFS. The items are still in the list.
                </div>
              )}
              {!failure.nothingWritten && failure.failed.length > 0 && (
                <p className="muted">The other items were updated; the failed ones remain in the list.</p>
              )}
            </div>
            <div className="modal-foot">
              <button className="primary" autoFocus onClick={() => setFailure(null)}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
