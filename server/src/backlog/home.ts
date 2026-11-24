import { fillArea, getConfig } from '../config.js';
import type { RawItem } from '../tfs/client.js';
import type {
  AppConfig, AttentionEntry, BacklogDef, CountEntry, HomeCommentsResponse, HomeComment, HomeFeature, HomeFeaturesResponse,
  HomeItemRef, HomeNextVersionEntry, HomeNextVersionResponse, HomeRecentItem, HomeRecentResponse, HomeTriageEntry,
  HomeTriageResponse, HomeValidateEntry, HomeValidateResponse, StateCounts, ValidationItem,
} from '../types.js';
import { getAttention } from './attention.js';
import { identity } from './details.js';
import { getClient, loadBacklog } from './service.js';
import { loadValidation } from './validation.js';

const DAY_MS = 86_400_000;
const norm = (s: string): string => s.trim().replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
const timeOf = (d: unknown): number => { const t = Date.parse(String(d ?? '')); return Number.isNaN(t) ? 0 : t; };
const visible = (cfg: AppConfig): BacklogDef[] => cfg.backlogs.filter(b => !b.hidden);
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// ---- pure logic ---------------------------------------------------------------------------------------------

/** The backlog whose area path equals or contains `areaPath` (case-insensitive, `\` boundaries, longest match wins). */
export function backlogForArea(areaPath: string, backlogs: BacklogDef[]): BacklogDef | null {
  const a = norm(areaPath ?? '');
  let best: BacklogDef | null = null;
  let bestLen = -1;
  for (const b of backlogs) {
    const p = norm(b.areaPath ?? '');
    if (!p) continue;
    if ((a === p || a.startsWith(p + '\\')) && p.length > bestLen) { best = b; bestLen = p.length; }
  }
  return best;
}

export function stateCounts(states: string[]): StateCounts {
  const c: StateCounts = { new: 0, active: 0, resolved: 0, closed: 0, other: 0, total: 0 };
  for (const s of states) {
    if (s === 'Removed') continue;
    c.total++;
    if (s === 'New') c.new++;
    else if (s === 'Active') c.active++;
    else if (s === 'Resolved') c.resolved++;
    else if (s === 'Closed') c.closed++;
    else c.other++;
  }
  return c;
}

/** Counts per key, sorted by count desc then key. */
export function countBy(keys: string[]): CountEntry[] {
  const m = new Map<string, number>();
  for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export function itemUrl(cfg: AppConfig, id: number): string {
  return `${cfg.tfs.serverUrl}/${cfg.tfs.collection}/${cfg.tfs.project}/_workitems/edit/${id}`;
}

export function toRef(raw: RawItem, cfg: AppConfig, backlogs: BacklogDef[]): HomeItemRef {
  const f = raw.fields;
  const areaPath = String(f['System.AreaPath'] ?? '');
  return {
    id: raw.id, type: String(f['System.WorkItemType'] ?? ''), title: String(f['System.Title'] ?? ''), state: String(f['System.State'] ?? ''),
    url: itemUrl(cfg, raw.id), areaPath, backlogId: backlogForArea(areaPath, backlogs)?.id ?? null,
  };
}

const STATE_ORDER = ['Active', 'New', 'Resolved', 'Closed'];
const stateRank = (s: string): number => { const i = STATE_ORDER.indexOf(s); return i < 0 ? STATE_ORDER.length : i; };

/** Shapes the features link query: Features = targets of rows without a source; children = rows with a source. */
export function shapeFeatures(
  links: { source: number | null; target: number }[], raws: RawItem[], cfg: AppConfig, backlogs: BacklogDef[],
): Omit<HomeFeaturesResponse, 'loadedAt'> {
  const byId = new Map(raws.map(r => [r.id, r]));
  const featureIds = [...new Set(links.filter(l => l.source === null).map(l => l.target))];
  const children = new Map<number, number[]>();
  for (const l of links) {
    if (l.source === null) continue;
    const list = children.get(l.source) ?? [];
    if (!list.includes(l.target)) list.push(l.target);
    children.set(l.source, list);
  }
  const active: HomeFeature[] = [];
  const notStarted: HomeFeaturesResponse['notStarted'] = [];
  for (const id of featureIds.sort((a, b) => a - b)) {
    const raw = byId.get(id);
    if (!raw) continue;
    const ref = toRef(raw, cfg, backlogs);
    const kids = (children.get(id) ?? []).map(c => byId.get(c)).filter((r): r is RawItem => !!r && r.fields['System.State'] !== 'Removed');
    if (ref.state === 'Active') {
      const kidRefs = kids.map(k => ({ ...toRef(k, cfg, backlogs), assignedTo: identity(k.fields['System.AssignedTo']) }))
        .sort((a, b) => stateRank(a.state) - stateRank(b.state) || a.id - b.id);
      active.push({ ...ref, counts: stateCounts(kids.map(k => String(k.fields['System.State'] ?? ''))), children: kidRefs });
    } else if (ref.state === 'New') {
      notStarted.push({ ...ref, childCount: kids.length });
    }
  }
  return { active, notStarted };
}

export type AttentionView = 'backlog' | 'validate';
export interface ViewedAttention extends AttentionEntry { view: AttentionView }

/** Merges attention entries of both views per backlog: acked (handled) entries dropped, deduped by item id preferring 'validate'. */
export function mergeAttention(parts: { backlog: AttentionEntry[]; validate: AttentionEntry[] }[]): ViewedAttention[] {
  const byId = new Map<number, ViewedAttention>();
  for (const p of parts) {
    for (const e of p.backlog) if (!e.acked && !byId.has(e.id)) byId.set(e.id, { ...e, view: 'backlog' });
    for (const e of p.validate) if (!e.acked) byId.set(e.id, { ...e, view: 'validate' });
  }
  return [...byId.values()].sort((a, b) => timeOf(b.lastDate) - timeOf(a.lastDate));
}

/** Merges recent lists (deduped by id), newest first, capped. */
export function mergeRecent(lists: HomeRecentItem[][], cap = 30): HomeRecentItem[] {
  const byId = new Map<number, HomeRecentItem>();
  for (const l of lists) for (const i of l) if (!byId.has(i.id)) byId.set(i.id, i);
  return [...byId.values()].sort((a, b) => timeOf(b.changedDate) - timeOf(a.changedDate)).slice(0, cap);
}

function wholeDays(date: string, nowMs: number): number | null {
  const t = Date.parse(date);
  return Number.isNaN(t) ? null : Math.max(0, Math.floor((nowMs - t) / DAY_MS));
}

export function shapeValidate(def: BacklogDef, items: ValidationItem[], nowMs = Date.now()): HomeValidateEntry {
  const noPr = (i: ValidationItem): boolean => Array.isArray(i.prs) && i.prs.length === 0 && !i.prError;
  const when = (i: ValidationItem): number => timeOf(i.resolvedDate) || Number.MAX_SAFE_INTEGER;
  const sorted = [...items].sort((a, b) => when(a) - when(b) || a.id - b.id);
  return {
    backlogId: def.id, name: def.name, color: def.color,
    total: items.length, noPr: items.filter(noPr).length, viaFeature: items.filter(i => i.viaFeature).length,
    oldestDays: sorted.length ? wholeDays(sorted[0].resolvedDate, nowMs) : null,
    items: sorted.slice(0, 5).map(i => ({
      id: i.id, type: i.type, title: i.title, state: i.state, url: i.url, areaPath: i.areaPath, backlogId: def.id,
      waitDays: wholeDays(i.resolvedDate, nowMs), noPr: noPr(i), viaFeature: !!i.viaFeature,
    })),
  };
}

// ---- loaders ------------------------------------------------------------------------------------------------

const cache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, ttlMs: number, refresh: boolean, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (!refresh && hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

const REF_FIELDS = ['System.Title', 'System.WorkItemType', 'System.State', 'System.AreaPath'];
const stamp = (): string => new Date().toISOString();
const fetchItems = async (ids: number[], fields: string[]): Promise<RawItem[]> => (ids.length ? getClient().getItems(ids, fields) : []);

export async function getHomeComments(): Promise<HomeCommentsResponse> {
  const cfg = getConfig();
  const backlogs = visible(cfg);
  let errors = 0;
  const parts = await Promise.all(backlogs.map(async b => {
    try {
      const [a, v] = await Promise.all([getAttention(b.id), getAttention(b.id, 'validate')]);
      errors += a.errors + v.errors;
      return { backlog: a.items, validate: v.items };
    } catch { errors++; return { backlog: [] as AttentionEntry[], validate: [] as AttentionEntry[] }; }
  }));
  const merged = mergeAttention(parts);
  const raws = new Map((await fetchItems(merged.map(m => m.id), REF_FIELDS)).map(r => [r.id, r]));
  const items: HomeComment[] = [];
  for (const m of merged) {
    const raw = raws.get(m.id);
    if (!raw) continue;
    items.push({ ...toRef(raw, cfg, backlogs), view: m.view, count: m.count, lastAuthor: m.lastAuthor, lastDate: m.lastDate, snippet: m.snippet });
  }
  return { items, errors, loadedAt: stamp() };
}

export async function getHomeFeatures(refresh = false): Promise<HomeFeaturesResponse> {
  return cached('features', 5 * 60_000, refresh, async () => {
    const cfg = getConfig();
    const client = getClient();
    if (!client.wiqlLinks) throw new Error('TFS client does not support link queries');
    const links = await client.wiqlLinks(cfg.home.featuresWiql);
    const ids = [...new Set(links.flatMap(l => (l.source === null ? [l.target] : [l.source, l.target])))];
    const raws = await fetchItems(ids, [...REF_FIELDS, 'System.AssignedTo']);
    return { ...shapeFeatures(links, raws, cfg, visible(cfg)), loadedAt: stamp() };
  });
}

export async function getHomeValidate(refresh = false): Promise<HomeValidateResponse> {
  const backlogs = visible(getConfig());
  const out = await Promise.all(backlogs.map(async (b): Promise<HomeValidateEntry> => {
    try { return shapeValidate(b, (await loadValidation(b.id, refresh)).items); }
    catch (e) { return { backlogId: b.id, name: b.name, color: b.color, total: 0, noPr: 0, viaFeature: 0, oldestDays: null, items: [], error: msg(e) }; }
  }));
  return { backlogs: out, loadedAt: stamp() };
}

export async function getHomeTriage(refresh = false): Promise<HomeTriageResponse> {
  const backlogs = visible(getConfig());
  const out = await Promise.all(backlogs.map(async (b): Promise<HomeTriageEntry> => {
    try {
      const items = (await loadBacklog(b.id, refresh)).items.filter(i => i.businessOrder === -1);
      return {
        backlogId: b.id, name: b.name, color: b.color, total: items.length, byType: countBy(items.map(i => i.type)),
        items: [...items].sort((x, y) => x.id - y.id).slice(0, 8)
          .map(i => ({ id: i.id, type: i.type, title: i.title, state: i.state, url: i.url, areaPath: i.areaPath, backlogId: b.id })),
      };
    } catch (e) { return { backlogId: b.id, name: b.name, color: b.color, total: 0, byType: [], items: [], error: msg(e) }; }
  }));
  return { backlogs: out, loadedAt: stamp() };
}

export async function getHomeNextVersion(refresh = false): Promise<HomeNextVersionResponse> {
  const cfg = getConfig();
  return cached(`next:${cfg.nextVersionTag}`, 5 * 60_000, refresh, async () => {
    const tag = cfg.nextVersionTag.replace(/'/g, "''");
    const out = await Promise.all(visible(cfg).map(async (b): Promise<HomeNextVersionEntry> => {
      try {
        const q = fillArea(cfg.home.nextVersionWiqlTemplate, b.areaPath).split('{{tag}}').join(tag);
        const ids = await getClient().wiql(q);
        const raws = await fetchItems(ids, ['System.State', 'System.WorkItemType']);
        return {
          backlogId: b.id, name: b.name, color: b.color,
          counts: stateCounts(raws.map(r => String(r.fields['System.State'] ?? ''))),
          byType: countBy(raws.filter(r => r.fields['System.State'] !== 'Removed').map(r => String(r.fields['System.WorkItemType'] ?? ''))),
        };
      } catch (e) { return { backlogId: b.id, name: b.name, color: b.color, counts: stateCounts([]), byType: [], error: msg(e) }; }
    }));
    return { tag: cfg.nextVersionTag, backlogs: out, loadedAt: stamp() };
  });
}

export async function getHomeRecent(refresh = false): Promise<HomeRecentResponse> {
  return cached('recent', 2 * 60_000, refresh, async () => {
    const cfg = getConfig();
    const backlogs = visible(cfg);
    const days = cfg.home.recentDays;
    let errors = 0;
    const lists = await Promise.all(backlogs.map(async (b): Promise<HomeRecentItem[]> => {
      try {
        const q = fillArea(cfg.home.recentWiqlTemplate, b.areaPath).split('{{days}}').join(String(days));
        const ids = await getClient().wiql(q);
        const raws = await fetchItems(ids, [...REF_FIELDS, 'System.ChangedBy', 'System.ChangedDate']);
        return raws.map(r => ({
          ...toRef(r, cfg, backlogs), changedBy: identity(r.fields['System.ChangedBy']), changedDate: String(r.fields['System.ChangedDate'] ?? ''),
        }));
      } catch { errors++; return []; }
    }));
    return { days, items: mergeRecent(lists), errors, loadedAt: stamp() };
  });
}
