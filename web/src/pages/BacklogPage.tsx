import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AgGridReact, type CustomCellRendererProps } from 'ag-grid-react';
import type {
  CellClassParams,
  CellClickedEvent,
  CellContextMenuEvent,
  CellStyle,
  ColDef,
  GridApi,
  GridReadyEvent,
  IRowNode,
  PostSortRowsParams,
  RowClassParams,
  ValueGetterParams,
  ValueSetterParams,
} from 'ag-grid-community';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';
import type {
  AttentionEntry,
  BacklogItem,
  BacklogDef,
  Band,
  ChangesResponse,
  ComponentRule,
  MetricsResponse,
  SettingsDto,
  TagsResponse,
} from '../../../server/src/types';
import { api } from '../api';
import MetricsBar, { type Filters } from '../components/MetricsBar';
import BulkBar from '../components/BulkBar';
import TagsEditor from '../components/TagsEditor';
import ComponentEditor from '../components/ComponentEditor';
import { blockingTag, componentNames, deriveComponent, withComponent } from '../../../server/src/shared/component';
import { compareVersionLabels, versionRange } from '../../../server/src/shared/version';
import PendingChangesDialog from '../components/PendingChangesDialog';
import CheckboxFilter, { excludeModel, type CheckboxFilterParams } from '../components/CheckboxFilter';
import ItemDetailsModal from '../components/ItemDetailsModal';
import RowContextMenu, { type MenuEntry } from '../components/RowContextMenu';
import { toast } from '../components/Toasts';
import {
  ASSIGN_ME,
  FIELD_REF,
  TAGS_REF,
  addTag,
  bandFor,
  buildChanges,
  clearField,
  effective,
  hasTag,
  removeTag,
  setField as pSetField,
  setTags as pSetTags,
  type FieldKey,
  type PendingMap,
} from '../pending';

const LS_COLS_LEGACY = 'cmfpm.columnState.v1';
const lsCols = (id: string) => `cmfpm.columnState.v1.${id}`;
const LS_TAG = 'cmfpm.viewTag';
const lsFold = (id: string) => `cmfpm.featureFold.v1.${id}`;

/** Fold state of Feature children: `closed` = the default for every Feature, `toggled` = Features that differ from it. */
interface FoldState { closed: boolean; toggled: number[] }

/** Feature grouping data shared with the grid callbacks. */
interface FoldCtx {
  /** ids of the Features in this backlog */
  featureIds: Set<number>;
  /** Feature id -> number of its children in this backlog */
  childCount: Map<number, number>;
  isClosed: (featureId: number) => boolean;
  anyClosed: boolean;
  toggle: (featureId: number) => void;
}
const isFeatureChild = (it: BacklogItem, f: FoldCtx) =>
  it.parentId !== null && it.type !== 'Feature' && (it.parentType === 'Feature' || f.featureIds.has(it.parentId));

const lsGet = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
};
const readFold = (id: string): FoldState => {
  try {
    const v = JSON.parse(lsGet(lsFold(id)) ?? '') as Partial<FoldState>;
    return { closed: v.closed === true, toggled: Array.isArray(v.toggled) ? v.toggled.filter((n) => Number.isInteger(n)) : [] };
  } catch {
    return { closed: false, toggled: [] };
  }
};

/** Mutable object shared with grid callbacks (passed as grid `context`) so column defs can stay static. */
interface Ctx {
  editMode: boolean;
  pending: PendingMap;
  errors: Record<number, string>;
  viewTag: string;
  bands: Band[];
  editable: Set<string>;
  stateOptions: string[];
  tagNames: string[];
  versionTags: string[];
  /** settings.hiddenTags: default exclusions of the Tags filter */
  hiddenTags: string[];
  filters: Filters;
  attention: Map<number, AttentionEntry>;
  fold: FoldCtx;
  backlogs: BacklogDef[];
  componentRules: ComponentRule[];
  setField: (item: BacklogItem, key: FieldKey, raw: unknown) => void;
  setComponent: (item: BacklogItem, component: string) => void;
  setTags: (item: BacklogItem, tags: string[]) => void;
  toggleNext: (item: BacklogItem, on: boolean) => void;
}

const ROW_TYPE: Record<string, string> = { Epic: 'epic', Feature: 'feature', 'User Story': 'story', Bug: 'bug' };
const TYPE_ORDER = ['Epic', 'Feature', 'User Story', 'Bug'];

const MAX_MOVE_COLORS = 16;
const hex6 = /^#[0-9a-f]{6}$/i;
const moveTarget = (ctx: Ctx, id: number): number => {
  const a = ctx.pending[id]?.fields.areaPath?.new;
  if (typeof a !== 'string') return -1;
  return ctx.backlogs.findIndex((b) => b.areaPath.trim().toLowerCase() === a.trim().toLowerCase());
};

const typeClass = (t: string) => 'pill pill-' + t.toLowerCase().replace(/\s+/g, '-');

function TypeCell(p: CustomCellRendererProps<BacklogItem>) {
  return p.value ? <span className={typeClass(String(p.value))}>{String(p.value)}</span> : null;
}
function IdCell(p: CustomCellRendererProps<BacklogItem>) {
  return p.data ? (
    <a href={p.data.url} target="_blank" rel="noreferrer">
      {p.data.id}
    </a>
  ) : null;
}
function TagsCell(p: CustomCellRendererProps<BacklogItem, string[]>) {
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
function WaitingCell(p: CustomCellRendererProps<BacklogItem>) {
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
function TitleCell(p: CustomCellRendererProps<BacklogItem>) {
  const ctx = p.context as Ctx;
  const it = p.data;
  if (!it) return null;
  const f = ctx.fold;
  const n = it.type === 'Feature' ? (f.childCount.get(it.id) ?? 0) : 0;
  const nested = it.parentId !== null && it.type !== 'Feature' && f.featureIds.has(it.parentId);
  const closed = n > 0 && f.isClosed(it.id);
  return (
    <span className={nested ? 'title-nested' : undefined}>
      {n > 0 && (
        <button
          className={'fold-btn' + (closed ? ' closed' : '')}
          title={`${closed ? 'Show' : 'Hide'} the ${n} item${n === 1 ? '' : 's'} of this Feature`}
          onClick={(e) => {
            e.stopPropagation();
            f.toggle(it.id);
          }}
        >
          {closed ? '▸' : '▾'} {n}
        </button>
      )}
      {nested && <span className="nest-mark">↳</span>}
      {String(p.value ?? '')}
      {it.outside && <span className="outside-tag" title={`Not in this backlog (${it.areaPath}); shown to group its items`}>other area</span>}
    </span>
  );
}
function BandCell(p: CustomCellRendererProps<BacklogItem>) {
  const ctx = p.context as Ctx;
  const color = ctx.bands.find((b) => b.label === p.value)?.color ?? '#9e9e9e';
  return (
    <span>
      <span className="dot" style={{ background: color }} /> {String(p.value ?? '')}
    </span>
  );
}
function NextVersionCell(p: CustomCellRendererProps<BacklogItem, boolean>) {
  const ctx = p.context as Ctx;
  const item = p.data;
  if (!item) return null;
  return (
    <input
      type="checkbox"
      checked={!!p.value}
      disabled={!ctx.editMode || !ctx.editable.has(TAGS_REF) || !!item.outside}
      onChange={(e) => ctx.toggleNext(item, e.target.checked)}
    />
  );
}

const colOfField: Record<string, FieldKey | 'tags' | 'nextVersion'> = {
  businessOrder: 'businessOrder',
  title: 'title',
  state: 'state',
  iterationPath: 'iterationPath',
  areaPath: 'areaPath',
  tags: 'tags',
  nextVersion: 'nextVersion',
};

function buildColumns(ctx: Ctx): ColDef<BacklogItem>[] {
  const eff = (it: BacklogItem) => effective(it, ctx.pending[it.id]);
  const edit = (ref: string) => (p: { data?: BacklogItem }) => ctx.editMode && ctx.editable.has(ref) && !p.data?.outside;
  const noTextAll = { getQuickFilterText: () => '' };
  return [
    {
      colId: 'sel',
      headerName: '',
      width: 44,
      maxWidth: 44,
      pinned: 'left',
      hide: true,
      checkboxSelection: (p) => !p.data?.outside,
      headerCheckboxSelection: true,
      headerCheckboxSelectionFilteredOnly: true,
      sortable: false,
      resizable: false,
      filter: false,
      suppressMovable: true,
      lockVisible: true,
      suppressHeaderMenuButton: true,
      ...noTextAll,
    },
    {
      colId: 'id',
      headerName: 'ID',
      width: 90,
      field: 'id',
      filter: 'agNumberColumnFilter',
      cellRenderer: IdCell,
      sort: 'asc',
      sortIndex: 1,
    },
    {
      colId: 'waiting',
      headerName: '💬',
      headerTooltip: 'Comments waiting for you (@mentions)',
      width: 56,
      maxWidth: 70,
      editable: false,
      filter: false,
      valueGetter: (p: ValueGetterParams<BacklogItem>) => (p.data ? (ctx.attention.get(p.data.id)?.count ?? 0) : 0),
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
      colId: 'title',
      headerName: 'Title',
      flex: 1,
      minWidth: 300,
      valueGetter: (p: ValueGetterParams<BacklogItem>) => (p.data ? eff(p.data).title : ''),
      valueSetter: (p: ValueSetterParams<BacklogItem>) => {
        if (p.data) ctx.setField(p.data, 'title', p.newValue);
        return false;
      },
      editable: edit(FIELD_REF.title),
      cellRenderer: TitleCell,
      filter: 'agTextColumnFilter',
    },
    {
      colId: 'state',
      headerName: 'State',
      width: 100,
      valueGetter: (p: ValueGetterParams<BacklogItem>) => (p.data ? eff(p.data).state : ''),
      valueSetter: (p: ValueSetterParams<BacklogItem>) => {
        if (p.data) ctx.setField(p.data, 'state', p.newValue);
        return false;
      },
      editable: edit(FIELD_REF.state),
      cellEditor: 'agSelectCellEditor',
      cellEditorParams: () => ({ values: ctx.stateOptions }),
      filter: CheckboxFilter,
      filterParams: { order: () => ctx.stateOptions } satisfies CheckboxFilterParams,
    },
    {
      colId: 'businessOrder',
      headerName: 'BusinessOrder',
      width: 130,
      type: 'numericColumn',
      valueGetter: (p: ValueGetterParams<BacklogItem>) => (p.data ? eff(p.data).businessOrder : null),
      valueSetter: (p: ValueSetterParams<BacklogItem>) => {
        if (p.data) ctx.setField(p.data, 'businessOrder', p.newValue);
        return false;
      },
      editable: edit(FIELD_REF.businessOrder),
      cellEditor: 'agNumberCellEditor',
      cellEditorParams: { precision: 0 },
      filter: 'agNumberColumnFilter',
      sort: 'asc',
      sortIndex: 0,
      cellStyle: (p: CellClassParams<BacklogItem>): CellStyle | null => {
        if (!p.data) return null;
        const band = bandFor(eff(p.data).businessOrder, ctx.bands);
        if (!band) return null;
        const style: CellStyle = { borderLeft: `4px solid ${band.color}` };
        if (/^#[0-9a-f]{6}$/i.test(band.color)) style.backgroundColor = band.color + '22';
        return style;
      },
    },
    {
      colId: 'band',
      headerName: 'Band',
      width: 140,
      valueGetter: (p: ValueGetterParams<BacklogItem>) =>
        p.data ? (bandFor(eff(p.data).businessOrder, ctx.bands)?.label ?? 'Unknown') : '',
      cellRenderer: BandCell,
      filter: CheckboxFilter,
      filterParams: {
        order: () => [...ctx.bands.map((b) => b.label), 'Unknown'],
        colorOf: (v: string) => ctx.bands.find((b) => b.label === v)?.color,
      } satisfies CheckboxFilterParams,
    },
    {
      colId: 'tags',
      headerName: 'Tags',
      width: 220,
      valueGetter: (p: ValueGetterParams<BacklogItem>) => (p.data ? eff(p.data).tags : []),
      valueSetter: (p: ValueSetterParams<BacklogItem>) => {
        if (p.data && Array.isArray(p.newValue)) ctx.setTags(p.data, p.newValue as string[]);
        return false;
      },
      editable: edit(TAGS_REF),
      cellEditor: TagsEditor,
      cellEditorPopup: true,
      singleClickEdit: true,
      // Enter adds a tag inside the editor instead of the grid stopping the edit
      suppressKeyboardEvent: (p) => p.editing && ['Enter', 'ArrowUp', 'ArrowDown'].includes(p.event.key),
      cellRenderer: TagsCell,
      // distinct tags, ascending; a row passes when it has any checked tag (getValue = effective tags array)
      filter: CheckboxFilter,
      filterParams: { multi: true, defaults: () => ctx.hiddenTags } satisfies CheckboxFilterParams,
      getQuickFilterText: (p) => (p.data ? eff(p.data).tags.join(' ') : ''),
      comparator: (a: string[] | undefined, b: string[] | undefined) => (a ?? []).join(';').localeCompare((b ?? []).join(';')),
    },
    {
      colId: 'nextVersion',
      headerName: 'Next version',
      headerValueGetter: () => `Next ${ctx.viewTag}`,
      width: 110,
      valueGetter: (p: ValueGetterParams<BacklogItem>) =>
        p.data ? hasTag(eff(p.data).tags, ctx.viewTag) : false,
      cellRenderer: NextVersionCell,
      filter: false,
      ...noTextAll,
    },
    {
      colId: 'component',
      headerName: 'Component',
      width: 130,
      // derived from the effective tags, so a pending component change shows at once
      valueGetter: (p: ValueGetterParams<BacklogItem>) => (p.data ? deriveComponent(eff(p.data).tags, ctx.componentRules) : ''),
      valueSetter: (p: ValueSetterParams<BacklogItem>) => {
        if (p.data && typeof p.newValue === 'string' && p.newValue !== p.oldValue) ctx.setComponent(p.data, p.newValue);
        return false;
      },
      editable: edit(TAGS_REF),
      cellEditor: ComponentEditor,
      cellEditorPopup: true,
      singleClickEdit: true,
      // while the picker is open, Enter / arrows belong to it (otherwise the grid stops editing first)
      suppressKeyboardEvent: (p) => p.editing && ['Enter', 'ArrowUp', 'ArrowDown'].includes(p.event.key),
      filter: CheckboxFilter,
      filterParams: { order: () => [...componentNames(ctx.componentRules), 'Unknown'] } satisfies CheckboxFilterParams,
    },
    {
      colId: 'minVersion',
      headerName: 'Min ver',
      width: 100,
      headerTooltip: 'Lowest version tag (11.3x, 12.1.0 …); a line tag like 12.0x counts as the start of that line',
      valueGetter: (p: ValueGetterParams<BacklogItem>) => (p.data ? versionRange(eff(p.data).tags).min : ''),
      comparator: compareVersionLabels,
      filter: 'agTextColumnFilter',
    },
    {
      colId: 'maxVersion',
      headerName: 'Max ver',
      width: 100,
      headerTooltip: 'Highest version tag; a line tag like 12.1x counts as the whole line',
      valueGetter: (p: ValueGetterParams<BacklogItem>) => (p.data ? versionRange(eff(p.data).tags).max : ''),
      comparator: compareVersionLabels,
      filter: 'agTextColumnFilter',
    },
    {
      colId: 'parent',
      headerName: 'Parent',
      width: 240,
      valueGetter: (p: ValueGetterParams<BacklogItem>) =>
        p.data && p.data.parentId !== null ? `#${p.data.parentId} ${p.data.parentTitle}` : '',
      filter: 'agTextColumnFilter',
    },
    {
      colId: 'iterationPath',
      headerName: 'Iteration',
      width: 170,
      valueGetter: (p: ValueGetterParams<BacklogItem>) => (p.data ? eff(p.data).iterationPath : ''),
      valueSetter: (p: ValueSetterParams<BacklogItem>) => {
        if (p.data) ctx.setField(p.data, 'iterationPath', p.newValue);
        return false;
      },
      editable: edit(FIELD_REF.iterationPath),
      filter: 'agTextColumnFilter',
    },
    {
      colId: 'areaPath',
      headerName: 'Area',
      width: 220,
      valueGetter: (p: ValueGetterParams<BacklogItem>) => (p.data ? eff(p.data).areaPath : ''),
      filter: 'agTextColumnFilter',
    },
    { colId: 'assignedTo', headerName: 'Assigned To', width: 150, field: 'assignedTo', filter: 'agTextColumnFilter' },
  ];
}

interface Props {
  backlogId: string;
  backlogName: string;
  /** area colour (header dot) */
  backlogColor?: string;
  /** items to validate in this area (header tab label) */
  toValidate?: number;
  active: boolean;
  reloadToken: number;
  /** bumped when another backlog moved items: reload (keeping pending edits) */
  staleToken: number;
  onMoved: () => void;
  /** signed-in user's display name (from /api/health), for "Assign to me" */
  me?: string;
  onPendingCount: (n: number) => void;
}

export default function BacklogPage({ backlogId, backlogName, active, reloadToken, staleToken, onMoved, onPendingCount, me }: Props) {
  const gridApi = useRef<GridApi<BacklogItem> | null>(null);
  const [items, setItems] = useState<BacklogItem[]>([]);
  /** parent Features outside this backlog: read-only group headers */
  const [outside, setOutside] = useState<BacklogItem[]>([]);
  const [loadedAt, setLoadedAt] = useState('');
  const [serverTag, setServerTag] = useState('');
  const [bands, setBands] = useState<Band[]>([]);
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [tags, setTags] = useState<TagsResponse | null>(null);
  const [settings, setSettings] = useState<SettingsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [pending, setPending] = useState<PendingMap>({});
  const pendingRef = useRef<PendingMap>({});
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [editMode, setEditMode] = useState(false);
  const [storedTag, setStoredTag] = useState<string | null>(() => lsGet(LS_TAG));
  const [filters, setFilters] = useState<Filters>({});
  const [quick, setQuick] = useState('');
  const [dialog, setDialog] = useState(false);
  const [selCount, setSelCount] = useState(0);
  const [colMenu, setColMenu] = useState(false);
  const [visTick, setVisTick] = useState(0);

  const [attention, setAttention] = useState<Map<number, AttentionEntry>>(new Map());
  const [attentionLoaded, setAttentionLoaded] = useState(false);
  const [fold, setFold] = useState<FoldState>(() => readFold(backlogId));

  const ctx = useRef<Ctx>({
    editMode: false,
    pending: {},
    errors: {},
    viewTag: '',
    bands: [],
    editable: new Set(),
    stateOptions: [],
    tagNames: [],
    versionTags: [],
    hiddenTags: [],
    filters: {},
    attention: new Map(),
    fold: { featureIds: new Set(), childCount: new Map(), isClosed: () => false, anyClosed: false, toggle: () => undefined },
    backlogs: [],
    setField: () => undefined,
    setTags: () => undefined,
    toggleNext: () => undefined,
    componentRules: [],
    setComponent: () => undefined,
  }).current;

  const versionTags = useMemo(() => {
    const s = new Set(tags?.versionTags ?? []);
    if (serverTag) s.add(serverTag);
    return [...s];
  }, [tags, serverTag]);
  const viewTag = storedTag && versionTags.includes(storedTag) ? storedTag : serverTag;

  ctx.editMode = editMode;
  ctx.errors = errors;
  ctx.viewTag = viewTag;
  ctx.bands = bands;
  ctx.editable = new Set(settings?.editableFields ?? []);
  ctx.stateOptions = settings?.stateOptions ?? [];
  ctx.tagNames = (tags?.tags ?? []).map((t) => t.key);
  ctx.versionTags = versionTags;
  ctx.hiddenTags = settings?.hiddenTags ?? [];
  ctx.filters = filters;
  ctx.attention = attention;
  ctx.backlogs = settings?.backlogs ?? [];
  ctx.componentRules = settings?.componentRules ?? [];

  const itemsById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  // ---- Feature children: fold under their Feature ----
  const rowData = useMemo(() => {
    if (!outside.length) return items;
    const parents = new Set(items.map((i) => i.parentId));
    const ids = new Set(items.map((i) => i.id));
    return [...items, ...outside.filter((f) => parents.has(f.id) && !ids.has(f.id))];
  }, [items, outside]);
  const featureIds = useMemo(() => new Set(rowData.filter((i) => i.type === 'Feature').map((i) => i.id)), [rowData]);
  const childCount = useMemo(() => {
    const m = new Map<number, number>();
    for (const i of items) if (i.parentId !== null && i.type !== 'Feature' && featureIds.has(i.parentId)) m.set(i.parentId, (m.get(i.parentId) ?? 0) + 1);
    return m;
  }, [items, featureIds]);
  const toggledSet = useMemo(() => new Set(fold.toggled), [fold]);
  const updateFold = useCallback(
    (next: FoldState) => {
      setFold(next);
      lsSet(lsFold(backlogId), JSON.stringify(next));
    },
    [backlogId],
  );
  ctx.fold = {
    featureIds,
    childCount,
    isClosed: (fid) => fold.closed !== toggledSet.has(fid),
    anyClosed: fold.closed || toggledSet.size > 0,
    toggle: (fid) =>
      updateFold({ closed: fold.closed, toggled: toggledSet.has(fid) ? fold.toggled.filter((x) => x !== fid) : [...fold.toggled, fid] }),
  };
  const featureChildren = items.filter((i) => isFeatureChild(i, ctx.fold));
  const hiddenChildren = featureChildren.filter((i) => ctx.fold.isClosed(i.parentId!)).length;
  const outsideChildren = featureChildren.filter((i) => !featureIds.has(i.parentId!)).length;
  const pendingCount = Object.keys(pending).length;

  const mutate = useCallback(
    (fn: (m: PendingMap) => PendingMap) => {
      const next = fn(pendingRef.current);
      if (next === pendingRef.current) return;
      pendingRef.current = next;
      ctx.pending = next;
      setPending(next);
    },
    [ctx],
  );

  const resetPending = useCallback(() => {
    pendingRef.current = {};
    ctx.pending = {};
    setPending({});
    setErrors({});
  }, [ctx]);

  ctx.setField = (item, key, raw) => {
    let v: string | number | null;
    if (key === 'businessOrder') {
      if (raw === null || raw === undefined || raw === '') v = null;
      else {
        const n = Number(raw);
        if (Number.isNaN(n)) return;
        v = n;
      }
    } else {
      v = String(raw ?? '').trim();
      if (key === 'title' && v === '') return;
    }
    mutate((m) => pSetField(m, item, key, v));
  };
  ctx.setTags = (item, t) => mutate((m) => pSetTags(m, item, t));
  ctx.toggleNext = (item, on) => mutate((m) => (on ? addTag(m, item, ctx.viewTag) : removeTag(m, item, ctx.viewTag)));
  /** Component = a tag: swap the component tag (pending edit). A new name is also added to the component rules. */
  ctx.setComponent = (item, component) => {
    const name = String(component ?? '').trim();
    let rules = ctx.componentRules;
    if (name && !componentNames(rules).some((n) => n.toLowerCase() === name.toLowerCase())) {
      rules = [...rules, { match: name, component: name }];
      ctx.componentRules = rules; // visible at once; persisted below
      void addComponentRule(name, rules);
    }
    const tags = withComponent(effective(item, pendingRef.current[item.id]).tags, name || null, rules);
    ctx.setTags(item, tags);
    const block = name ? blockingTag(tags, name, rules) : null;
    if (block) {
      toast('warn', `#${item.id} still shows ${block.component}`, `Tag "${block.tag}" matches the earlier "${block.component}" rule. Remove it or reorder the component rules in Settings.`);
    }
  };
  const addComponentRule = async (name: string, componentRules: ComponentRule[]) => {
    if (!settings) return;
    const next = { ...settings, componentRules };
    try {
      await api.putSettings(next);
      setSettings(next);
      toast('info', `New component "${name}"`, 'Added to Settings → Component rules.');
    } catch (e) {
      toast('warn', `Component "${name}" not saved to settings`, e instanceof Error ? e.message : String(e));
    }
  };

  const loadMetrics = useCallback(async () => {
    try {
      const [m, t] = await Promise.all([api.metrics(backlogId), api.tags(backlogId)]);
      setMetrics(m);
      setTags(t);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [backlogId]);

  const attentionAt = useRef(0); // last attention fetch (ms)
  const loadAttention = useCallback(async () => {
    attentionAt.current = Date.now();
    try {
      const r = await api.attention(backlogId);
      setAttention(new Map(r.items.map((a) => [a.id, a])));
      setAttentionLoaded(true);
    } catch (e) {
      console.warn('attention load failed', e);
    }
  }, [backlogId]);

  const load = useCallback(
    async (refresh: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const b = await api.backlog(backlogId, refresh);
        setItems(b.items);
        setOutside((b.outsideFeatures ?? []).map((f) => ({ ...f, outside: true })));
        setLoadedAt(b.loadedAt);
        setServerTag(b.nextVersionTag);
        setBands(b.bands);
        const [m, t, s] = await Promise.all([api.metrics(backlogId), api.tags(backlogId), api.getSettings()]);
        setMetrics(m);
        setTags(t);
        setSettings(s);
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

  const firstToken = useRef(reloadToken);
  useEffect(() => {
    if (reloadToken === firstToken.current) return;
    firstToken.current = reloadToken;
    resetPending();
    void load(false);
  }, [reloadToken, load, resetPending]);

  const firstStale = useRef(staleToken);
  useEffect(() => {
    if (staleToken === firstStale.current) return;
    firstStale.current = staleToken;
    void load(false); // keep pending edits
  }, [staleToken, load]);

  useEffect(() => onPendingCount(pendingCount), [pendingCount, onPendingCount]);

  useEffect(() => {
    if (pendingCount === 0) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [pendingCount]);

  // keep cell styles / values in sync with pending changes
  useEffect(() => {
    const a = gridApi.current;
    if (!a) return;
    const fc = a.getFocusedCell();
    const active = document.activeElement;
    const focusInGrid = !active || active === document.body || !!active.closest('.ag-root-wrapper');
    a.refreshCells({ force: true, suppressFlash: true });
    // A forced refresh re-renders the focused cell and the browser drops keyboard focus,
    // which breaks "type, Enter, type" editing. Put focus back on the grid's focused cell.
    if (fc && focusInGrid && a.getEditingCells().length === 0) a.setFocusedCell(fc.rowIndex, fc.column, fc.rowPinned);
  }, [pending, errors, editMode, viewTag, bands, settings]);
  useEffect(() => {
    gridApi.current?.refreshHeader();
  }, [viewTag]);
  useEffect(() => {
    gridApi.current?.onFilterChanged();
  }, [filters, viewTag, attention]);
  // fold changes: re-filter (hides/shows children and re-runs postSortRows), redraw the carets, drop hidden rows from the selection
  useEffect(() => {
    const a = gridApi.current;
    if (!a) return;
    a.onFilterChanged();
    a.refreshCells({ columns: ['title'], force: true, suppressFlash: true });
    const hidden = a.getSelectedNodes().filter((n) => !n.displayed);
    if (hidden.length) a.setNodesSelected({ nodes: hidden, newValue: false });
  }, [fold, childCount]);
  useEffect(() => {
    gridApi.current?.refreshCells({ columns: ['waiting'], force: true, suppressFlash: true });
  }, [attention]);

  // Re-check waiting comments while the tab is visible: every 5 min, and on window focus / tab switch
  // when the last check is older than a minute (the server reads fresh revs; unchanged items are cached).
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

  // Notify (when the tab is visible): all waiting items on the first check, then only new comments.
  const announced = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!attentionLoaded || !active) return;
    const list = [...attention.values()];
    const keyOf = (a: AttentionEntry) => `${a.id}@${a.lastDate}`;
    const first = announced.current === null;
    const seen = announced.current ?? new Set<string>();
    const fresh = list.filter((a) => !seen.has(keyOf(a)));
    announced.current = new Set([...seen, ...list.map(keyOf)]);
    if (!fresh.length) return;
    const n = first ? list.length : fresh.length;
    const title = first
      ? `${n} item${n === 1 ? '' : 's'} with comments waiting for you`
      : `New comment${n === 1 ? '' : 's'} waiting for you`;
    const text = fresh.slice(0, 3).map((a) => `#${a.id} ${a.lastAuthor}`).join(' · ') + (fresh.length > 3 ? ' …' : '');
    toast('info', title, text, { ms: first ? 10_000 : 30_000, onClick: () => setFilters((f) => ({ ...f, waiting: true })) });
  }, [attention, attentionLoaded, active]);
  useEffect(() => {
    const api_ = gridApi.current;
    if (!api_) return;
    api_.setColumnsVisible(['sel'], editMode);
    if (!editMode) {
      api_.stopEditing();
      api_.deselectAll();
    }
  }, [editMode]);

  const colDefs = useMemo(() => buildColumns(ctx), [ctx]);

  const defaultColDef = useMemo<ColDef<BacklogItem>>(
    () => ({
      sortable: true,
      resizable: true,
      singleClickEdit: true,
      tooltipValueGetter: (p) => (p.data ? ctx.errors[p.data.id] : undefined),
      cellClass: (p: CellClassParams<BacklogItem>) => {
        const id = p.data?.id;
        if (id === undefined) return undefined;
        const cls: string[] = [];
        const e = ctx.pending[id];
        if (e) {
          const col = p.colDef.colId ?? '';
          const k = colOfField[col];
          if (col === 'id') cls.push('row-edited');
          else if (col === 'component') {
            if ((e.tagsAdd.length || e.tagsRemove.length) && p.value !== p.data!.component) cls.push('cell-edited');
          }
          else if (k === 'tags') {
            if (e.tagsAdd.length || e.tagsRemove.length) cls.push('cell-edited');
          } else if (k === 'nextVersion') {
            if (hasTag(e.tagsAdd, ctx.viewTag) || hasTag(e.tagsRemove, ctx.viewTag)) cls.push('cell-edited');
          } else if (k && e.fields[k as FieldKey]) cls.push('cell-edited');
        }
        if (ctx.errors[id]) cls.push('cell-error');
        return cls;
      },
    }),
    [ctx],
  );

  const rowClassRules = useMemo(() => {
    const rules: Record<string, (p: RowClassParams<BacklogItem>) => boolean> = {
      'row-moving': (p) => !!p.data && !!ctx.pending[p.data.id]?.fields.areaPath,
      'row-outside': (p) => !!p.data?.outside,
    };
    for (let n = 0; n < MAX_MOVE_COLORS; n++) rules['row-moving-' + n] = (p) => !!p.data && moveTarget(ctx, p.data.id) === n;
    return rules;
  }, [ctx]);
  const moveCss = (settings?.backlogs ?? [])
    .slice(0, MAX_MOVE_COLORS)
    .map((b, n) => (hex6.test(b.color) ? `.grid-wrap .ag-row.row-moving-${n}{--move-color:${b.color}}` : ''))
    .join('');

  const saveState = useCallback(() => {
    const st = gridApi.current?.getColumnState().filter((c) => c.colId !== 'sel');
    if (st) lsSet(lsCols(backlogId), JSON.stringify(st));
  }, [backlogId]);

  const [gridReady, setGridReady] = useState(false);
  const onGridReady = (e: GridReadyEvent<BacklogItem>) => {
    gridApi.current = e.api;
    setGridReady(true);
    const raw = lsGet(lsCols(backlogId)) ?? lsGet(LS_COLS_LEGACY);
    if (raw) {
      try {
        const saved = JSON.parse(raw) as { colId: string }[];
        e.api.applyColumnState({ state: saved, applyOrder: true });
        if (!saved.some((c) => c.colId === 'waiting')) {
          const idx = e.api.getAllGridColumns().findIndex((c) => c.getColId() === 'id');
          if (idx >= 0) e.api.moveColumns(['waiting'], idx + 1); // new column: keep it next to ID
        }
      } catch {
        /* ignore corrupt state */
      }
    }
    e.api.setColumnsVisible(['sel'], ctx.editMode);
  };

  // Tags filter starts with the configured hidden tags unchecked; re-applied when that setting changes.
  const appliedHidden = useRef<string | null>(null);
  useEffect(() => {
    const a = gridApi.current;
    if (!a || !gridReady || !settings) return;
    const key = JSON.stringify(settings.hiddenTags ?? []);
    if (appliedHidden.current === key) return;
    appliedHidden.current = key;
    void (async () => {
      await a.getColumnFilterInstance('tags'); // make sure the React filter exists before setting its model
      await a.setColumnFilterModel('tags', excludeModel(settings.hiddenTags ?? []));
      a.onFilterChanged();
    })();
  }, [gridReady, settings]);

  const resetLayout = () => {
    const a = gridApi.current;
    if (!a) return;
    lsSet(lsCols(backlogId), '[]'); // empty state: stops the legacy-key fallback from resurrecting the old layout
    a.resetColumnState();
    a.applyColumnState({
      state: [
        { colId: 'businessOrder', sort: 'asc', sortIndex: 0 },
        { colId: 'id', sort: 'asc', sortIndex: 1 },
      ],
    });
    a.setColumnsVisible(['sel'], ctx.editMode);
    setVisTick((n) => n + 1);
  };

  const isExternalFilterPresent = useCallback(
    () => !!ctx.filters.notReviewed || !!ctx.filters.nextVersion || !!ctx.filters.waiting || ctx.fold.anyClosed,
    [ctx],
  );
  const doesExternalFilterPass = useCallback(
    (node: { data?: BacklogItem }) => {
      const it = node.data;
      if (!it) return true;
      const f = ctx.filters;
      const e = effective(it, ctx.pending[it.id]);
      if (ctx.fold.anyClosed && isFeatureChild(it, ctx.fold) && ctx.fold.isClosed(it.parentId!)) return false;
      if (f.waiting && !ctx.attention.has(it.id)) return false;
      if (f.notReviewed && e.businessOrder !== -1) return false;
      if (f.nextVersion && !hasTag(e.tags, ctx.viewTag)) return false;
      return true;
    },
    [ctx],
  );

  // Type / Band checkbox filters live in the grid filter model; this mirrors them for the metric cards.
  const [colSel, setColSel] = useState<{ type: string[] | null; band: string[] | null }>({ type: null, band: null });
  const syncColSel = useCallback(() => {
    const a = gridApi.current;
    if (!a) return;
    const vals = (c: string) => (a.getColumnFilterModel(c) as { values: string[] } | null)?.values ?? null;
    setColSel({ type: vals('type'), band: vals('band') });
  }, []);
  const toggleCol = async (col: 'type' | 'band', value: string) => {
    const a = gridApi.current;
    if (!a) return;
    const cur = (a.getColumnFilterModel(col) as { values: string[] } | null)?.values;
    const only = !!cur && cur.length === 1 && cur[0] === value;
    await a.getColumnFilterInstance(col); // make sure the React filter exists before setting its model
    await a.setColumnFilterModel(col, only ? null : { values: [value] });
    a.onFilterChanged();
  };
  const clearAll = async () => {
    setFilters({});
    const a = gridApi.current;
    if (!a) return;
    await Promise.all([a.setColumnFilterModel('type', null), a.setColumnFilterModel('band', null)]);
    a.onFilterChanged();
  };

  // Children of a Feature that is shown follow it directly (in their own sort order); the rest keep their place.
  const postSortRows = useCallback((p: PostSortRowsParams<BacklogItem>) => {
    const nodes = p.nodes;
    const shown = new Set<number>();
    for (const n of nodes) if (n.data?.type === 'Feature') shown.add(n.data.id);
    if (!shown.size) return;
    const parentOf = (d?: BacklogItem): number | null =>
      d && d.parentId !== null && d.type !== 'Feature' && shown.has(d.parentId) ? d.parentId : null;
    const kids = new Map<number, IRowNode<BacklogItem>[]>();
    for (const n of nodes) {
      const pid = parentOf(n.data);
      if (pid !== null) kids.set(pid, [...(kids.get(pid) ?? []), n]);
    }
    if (!kids.size) return;
    const out: IRowNode<BacklogItem>[] = [];
    for (const n of nodes) {
      if (parentOf(n.data) !== null) continue;
      out.push(n);
      const k = n.data ? kids.get(n.data.id) : undefined;
      if (k) out.push(...k);
    }
    nodes.splice(0, nodes.length, ...out);
  }, []);

  const [detailId, setDetailId] = useState<number | null>(null);
  const onCellClicked = (e: CellClickedEvent<BacklogItem>) => {
    if (!e.data || e.colDef.colId === 'sel') return;
    // shortcut: clicking BusinessOrder in view mode switches to edit mode and edits that cell
    if (!ctx.editMode && e.colDef.colId === 'businessOrder' && !e.data.outside && ctx.editable.has(FIELD_REF.businessOrder)) {
      ctx.editMode = true;
      setEditMode(true);
      const node = e.node;
      setTimeout(() => {
        if (node.rowIndex !== null) gridApi.current?.startEditingCell({ rowIndex: node.rowIndex, colKey: 'businessOrder' });
      }, 0);
      return;
    }
    if (ctx.editMode && e.colDef.colId !== 'waiting') return;
    if ((e.event?.target as HTMLElement | null)?.closest('a,input,button,label')) return;
    setDetailId(e.data.id);
  };
  const [menu, setMenu] = useState<{ x: number; y: number; header: string; entries: MenuEntry[] } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const onCellContextMenu = (e: CellContextMenuEvent<BacklogItem>) => {
    const ev = e.event as MouseEvent | null | undefined;
    const clicked = e.data;
    if (!ev || !clicked) return;
    ev.preventDefault();
    if (clicked.outside) {
      setMenu({
        x: ev.clientX,
        y: ev.clientY,
        header: `#${clicked.id} Feature outside this backlog`,
        entries: [
          { kind: 'item', label: 'Open details', onSelect: () => setDetailId(clicked.id) },
          { kind: 'item', label: 'Open in TFS ↗', onSelect: () => window.open(clicked.url, '_blank', 'noopener') },
        ],
      });
      return;
    }
    const sel = gridApi.current?.getSelectedRows() ?? [];
    const targets = sel.length > 1 && sel.some((i) => i.id === clicked.id) ? sel : [clicked];
    const header =
      targets.length > 1
        ? `${targets.length} selected items`
        : `#${clicked.id} ${clicked.title.length > 40 ? clicked.title.slice(0, 40) + '…' : clicked.title}`;
    const norm = (v: string) => v.trim().toLowerCase();
    const entries: MenuEntry[] = [];
    for (const b of ctx.backlogs) {
      if (b.id === backlogId || !b.areaPath.trim()) continue;
      const already = targets.every((t) => norm(effective(t, ctx.pending[t.id]).areaPath) === norm(b.areaPath));
      entries.push({
        kind: 'item',
        label: `Move to ${b.name}${b.hidden ? ' (hidden)' : ''}`,
        color: b.color,
        disabled: already || applying,
        onSelect: () => void moveNow(targets, b.areaPath),
      });
    }
    // Iteration: distinct iterations of this backlog, ordered by their lowest BusinessOrder (reviewed items only:
    // null / -1 do not rank an iteration; those iterations go last, by name).
    const iters = new Map<string, { min: number; n: number }>();
    for (const it of items) {
      const ef = effective(it, ctx.pending[it.id]);
      const path = ef.iterationPath.trim();
      if (!path) continue;
      const bo = ef.businessOrder !== null && ef.businessOrder >= 0 ? ef.businessOrder : Infinity;
      const s = iters.get(path) ?? { min: Infinity, n: 0 };
      iters.set(path, { min: Math.min(s.min, bo), n: s.n + 1 });
    }
    const canIter = ctx.editable.has(FIELD_REF.iterationPath);
    entries.push({
      kind: 'sub',
      label: 'Set iteration',
      disabled: !canIter || iters.size === 0 || applying,
      children: [...iters]
        .sort(([a, x], [b, y]) => x.min - y.min || a.localeCompare(b))
        .map(([path, s]) => {
          const checked = targets.every((t) => effective(t, ctx.pending[t.id]).iterationPath === path);
          return {
            kind: 'item' as const,
            label: path,
            hint: `${s.min === Infinity ? 'no BO' : 'BO ' + s.min} · ${s.n}`,
            checked,
            disabled: checked,
            onSelect: () => void setNow(targets, 'iterationPath', path),
          };
        }),
    });
    const mine = !!me && targets.every((t) => t.assignedTo === me);
    entries.push({
      kind: 'item',
      label: mine ? 'Assigned to me' : 'Assign to me',
      checked: mine,
      disabled: mine || applying,
      onSelect: () => void setNow(targets, 'assignedTo', ASSIGN_ME),
    });
    if (targets.some((t) => ctx.pending[t.id]?.fields.areaPath)) {
      entries.push({
        kind: 'item',
        label: 'Undo move',
        onSelect: () => mutate((m) => targets.reduce((acc, t) => clearField(acc, t, 'areaPath'), m)),
      });
    }
    if (entries.length) entries.push({ kind: 'sep' });
    entries.push({ kind: 'item', label: 'Open details', onSelect: () => setDetailId(clicked.id) });
    entries.push({
      kind: 'item',
      label: 'Open in TFS ↗',
      onSelect: () => window.open(clicked.url, '_blank', 'noopener'),
    });
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

  const nextCount = useMemo(
    () => items.filter((i) => hasTag(effective(i, pending[i.id]).tags, viewTag)).length,
    [items, pending, viewTag],
  );

  const onRefresh = async () => {
    if (pendingCount > 0 && !window.confirm(`Discard ${pendingCount} item(s) with pending edits and reload from TFS?`)) {
      return;
    }
    resetPending();
    await load(true);
  };

  const onDiscard = () => {
    if (pendingCount === 0) return;
    if (window.confirm(`Discard pending edits on ${pendingCount} item(s)?`)) resetPending();
  };

  const onApplied = (resp: ChangesResponse) => {
    const errs: Record<number, string> = { ...ctx.errors };
    const replace = new Map<number, BacklogItem>();
    const moved = new Set<number>();
    let missing = false;
    for (const r of resp.results) {
      if (r.ok) {
        delete errs[r.id];
        if (resp.phase === 'applied') {
          if (r.moved) moved.add(r.id);
          else if (r.item) replace.set(r.id, r.item);
          else missing = true;
        }
      } else {
        errs[r.id] = r.error ?? 'Failed';
      }
    }
    setErrors(errs);
    if (resp.phase === 'applied') {
      const okIds = new Set(resp.results.filter((r) => r.ok).map((r) => r.id));
      mutate((m) => {
        const n = { ...m };
        okIds.forEach((id) => delete n[id]);
        return n;
      });
      if (replace.size || moved.size) {
        setItems((prev) => prev.filter((i) => !moved.has(i.id)).map((i) => replace.get(i.id) ?? i));
      }
      if (moved.size) onMoved();
      if (missing) void load(false);
      else void loadMetrics();
    }
  };

  // Apply without confirmation: success -> toast; any failure -> the pending dialog with the results.
  const [applying, setApplying] = useState(false);
  const [failure, setFailure] = useState<{ resp: ChangesResponse | null; err: string | null } | null>(null);
  /**
   * Write `snapshot` to TFS now. Success -> toast. Failure -> `onFail` (lets a move park itself in the
   * pending edits so the dialog can show it), then the pending dialog with the results.
   */
  const send = async (snapshot: PendingMap, onFail?: (failedIds: Set<number>) => void) => {
    const changes = buildChanges(itemsById, snapshot);
    if (changes.length === 0 || applying) return;
    const targetName = (area: unknown) =>
      (settings?.backlogs ?? []).find((b) => b.areaPath.toLowerCase() === String(area ?? '').toLowerCase())?.name ?? String(area);
    setApplying(true);
    try {
      const resp = await api.changes(backlogId, { changes }, false);
      const failed = resp.results.filter((r) => !r.ok);
      if (failed.length || resp.phase !== 'applied') {
        // validation phase: nothing was written, so every item is still to do; applied phase: only the failures
        onFail?.(new Set(resp.phase === 'applied' ? failed.map((r) => r.id) : changes.map((c) => c.id)));
        onApplied(resp);
        setFailure({ resp, err: null });
        return;
      }
      onApplied(resp);
      const moves = new Map<string, number>();
      for (const r of resp.results) {
        if (!r.moved) continue;
        const name = targetName(snapshot[r.id]?.fields.areaPath?.new);
        moves.set(name, (moves.get(name) ?? 0) + 1);
      }
      const ids = resp.results.map((r) => '#' + r.id);
      const parts = [ids.length > 8 ? `${ids.slice(0, 8).join(', ')} +${ids.length - 8} more` : ids.join(', ')];
      for (const [name, n] of moves) parts.push(`${n} moved to ${name}`);
      toast('ok', `${resp.results.length} item${resp.results.length === 1 ? '' : 's'} updated in TFS`, parts.join(' · '));
    } catch (e) {
      onFail?.(new Set(changes.map((c) => c.id)));
      setFailure({ resp: null, err: e instanceof Error ? e.message : String(e) });
    } finally {
      setApplying(false);
    }
  };
  const applyNow = () => send(pendingRef.current);

  /**
   * Right-click actions (move, iteration): written immediately, together with any pending edits of those items
   * (a move takes them out of this tab; any write bumps the rev, so edits left behind would fail later).
   * On failure the change is parked in the pending edits so the dialog can show it.
   */
  const setNow = (targets: BacklogItem[], key: 'areaPath' | 'iterationPath' | 'assignedTo', value: string) => {
    const base = pendingRef.current;
    const subset = targets.reduce<PendingMap>(
      (acc, t) => pSetField(base[t.id] ? { ...acc, [t.id]: base[t.id] } : acc, t, key, value),
      {},
    );
    return send(subset, (failedIds) =>
      mutate((m) => targets.filter((t) => failedIds.has(t.id)).reduce((acc, t) => pSetField(acc, t, key, value), m)),
    );
  };
  const moveNow = (targets: BacklogItem[], areaPath: string) => setNow(targets, 'areaPath', areaPath);

  const selectedItems = (): BacklogItem[] => gridApi.current?.getSelectedRows() ?? [];
  const canTags = ctx.editable.has(TAGS_REF);
  const canOrder = ctx.editable.has(FIELD_REF.businessOrder);

  const colList = useMemo(
    () => colDefs.filter((c) => c.colId !== 'sel').map((c) => ({ id: c.colId as string, name: c.headerName ?? '' })),
    [colDefs],
  );
  void visTick;

  return (
    <div className={'page backlog' + (active ? '' : ' hidden')} aria-label={backlogName}>
      <MetricsBar
        metrics={metrics}
        bands={bands}
        filters={filters}
        colSel={colSel}
        onToggleCol={(c, v) => void toggleCol(c, v)}
        onClearAll={() => void clearAll()}
        nextTag={viewTag}
        nextCount={nextCount}
        waitingCount={attention.size}
        onChange={setFilters}
      />
      <div className="toolbar">
        <input
          className="search"
          type="search"
          placeholder="Quick search…"
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
        />
        <button onClick={onRefresh} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        <span className="muted">loaded {loadedAt ? new Date(loadedAt).toLocaleTimeString() : '—'}</span>
        <label className="inline">
          Next version
          <select
            value={viewTag}
            onChange={(e) => {
              setStoredTag(e.target.value);
              lsSet(LS_TAG, e.target.value);
            }}
          >
            {versionTags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <div className="menu-wrap">
          <button onClick={() => setColMenu((v) => !v)}>Columns ▾</button>
          {colMenu && (
            <div className="menu" onMouseLeave={() => setColMenu(false)}>
              {colList.map((c) => (
                <label key={c.id}>
                  <input
                    type="checkbox"
                    checked={gridApi.current?.getColumn(c.id)?.isVisible() ?? true}
                    onChange={(e) => {
                      gridApi.current?.setColumnsVisible([c.id], e.target.checked);
                      setVisTick((n) => n + 1);
                    }}
                  />
                  {c.id === 'nextVersion' ? 'Next version' : c.name}
                </label>
              ))}
              <button className="link-btn" onClick={resetLayout}>
                Reset layout
              </button>
            </div>
          )}
        </div>
        {featureChildren.length > 0 && (
          <span className="fold-ctl" title="Items whose parent is a Feature. The ▾/▸ count on a Feature row folds just that Feature.">
            Feature items
            <button disabled={!ctx.fold.anyClosed} onClick={() => updateFold({ closed: false, toggled: [] })}>
              ▾ Show all
            </button>
            <button disabled={hiddenChildren === featureChildren.length} onClick={() => updateFold({ closed: true, toggled: [] })}>
              ▸ Hide all
            </button>
            {hiddenChildren > 0 && (
              <span className="muted" title={outsideChildren ? `${outsideChildren} belong to Features outside this backlog (no row to unfold here)` : undefined}>
                {hiddenChildren} folded
              </span>
            )}
          </span>
        )}
        <span className="grow" />
        <label className="inline toggle">
          <input type="checkbox" checked={editMode} onChange={(e) => setEditMode(e.target.checked)} />
          Edit mode
        </label>
        {pendingCount > 0 && <span className="badge warn">{pendingCount} pending</span>}
        <button
          className="primary"
          disabled={pendingCount === 0 || applying}
          onClick={() => void applyNow()}
          title="Write all pending changes to TFS now"
        >
          {applying ? 'Applying…' : `Apply (${pendingCount})`}
        </button>
        <button disabled={pendingCount === 0 || applying} onClick={() => setDialog(true)} title="List pending changes; dry run">
          Review
        </button>
        <button disabled={pendingCount === 0 || applying} onClick={onDiscard}>
          Discard
        </button>
      </div>
      {error && <div className="banner error">{error}</div>}
      {editMode && (
        <BulkBar
          selCount={selCount}
          canTags={canTags}
          canOrder={canOrder}
          tagNames={ctx.tagNames}
          nextTag={viewTag}
          onAddTag={(t) => mutate((m) => selectedItems().reduce((acc, i) => addTag(acc, i, t), m))}
          onRemoveTag={(t) => mutate((m) => selectedItems().reduce((acc, i) => removeTag(acc, i, t), m))}
          onSetOrder={(n) => mutate((m) => selectedItems().reduce((acc, i) => pSetField(acc, i, 'businessOrder', n), m))}
          onNext={(on) =>
            mutate((m) => selectedItems().reduce((acc, i) => (on ? addTag(acc, i, viewTag) : removeTag(acc, i, viewTag)), m))
          }
        />
      )}
      {moveCss && <style>{moveCss}</style>}
      <div
        className={'grid-wrap ag-theme-quartz' + (editMode ? '' : ' view-mode')}
        onContextMenu={(e) => {
          // suppress the browser menu on rows only; header / empty space keep the default
          if ((e.target as HTMLElement).closest('.ag-row')) e.preventDefault();
        }}
      >
        <AgGridReact<BacklogItem>
          rowData={rowData}
          columnDefs={colDefs}
          defaultColDef={defaultColDef}
          context={ctx}
          getRowId={(p) => String(p.data.id)}
          quickFilterText={quick}
          rowSelection="multiple"
          suppressRowClickSelection
          stopEditingWhenCellsLoseFocus
          enterNavigatesVertically
          enterNavigatesVerticallyAfterEdit
          tooltipShowDelay={300}
          rowHeight={30}
          headerHeight={32}
          isExternalFilterPresent={isExternalFilterPresent}
          doesExternalFilterPass={doesExternalFilterPass}
          postSortRows={postSortRows}
          getRowClass={(p: RowClassParams<BacklogItem>) => (p.data && ROW_TYPE[p.data.type] ? 'row-type-' + ROW_TYPE[p.data.type] : undefined)}
          rowClassRules={rowClassRules}
          isRowSelectable={(n) => !n.data?.outside}
          onCellClicked={onCellClicked}
          onCellContextMenu={onCellContextMenu}
          onFilterChanged={syncColSel}
          onGridReady={onGridReady}
          onSelectionChanged={(e) => setSelCount(e.api.getSelectedNodes().length)}
          onColumnMoved={saveState}
          onColumnResized={(e) => e.finished && saveState()}
          onColumnVisible={() => {
            saveState();
            setVisTick((n) => n + 1);
          }}
          onSortChanged={saveState}
        />
      </div>
      {menu && (
        <RowContextMenu x={menu.x} y={menu.y} header={menu.header} entries={menu.entries} onClose={closeMenu} />
      )}
      {detailId !== null && (
        <ItemDetailsModal id={detailId} bands={bands} onClose={closeDetail} onOpen={setDetailId} onStep={stepDetail} onAttentionChanged={() => void loadAttention()} />
      )}
      {(dialog || failure) && (
        <PendingChangesDialog
          backlogId={backlogId}
          pending={pending}
          itemsById={itemsById}
          onClose={() => {
            setDialog(false);
            setFailure(null);
          }}
          onApplied={onApplied}
          initialResp={failure?.resp}
          initialErr={failure?.err}
        />
      )}
    </div>
  );
}
