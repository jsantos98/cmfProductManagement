import { effectiveWiql, getBacklogDef, getConfig } from '../config.js';
import { TfsClient, type RawItem, type TfsApi } from '../tfs/client.js';
import { TFS_FIELDS, toBacklogItem, withDerived, type ParentInfo } from './derive.js';
import { childIds, toComments, toItemDetails } from './details.js';
import { rawComments, readAcks, waitingFor } from './attention.js';
import type { ItemComment, ItemDetails, BacklogItem, BacklogResponse, CountEntry, MetricsResponse, TagsResponse } from '../types.js';

interface CacheEntry { items: BacklogItem[]; loadedAt: string; wiql: string; outsideFeatures: BacklogItem[] }
const caches = new Map<string, CacheEntry>();
const inflight = new Map<string, { wiql: string; p: Promise<void> }>();
let client: TfsApi | null = null;

export function getClient(): TfsApi {
  return (client ??= new TfsClient(getConfig()));
}

export interface Me { displayName: string; identity: string; id: string }
let meCache: Promise<Me> | null = null;
/** Signed-in TFS user (cached for the server's lifetime; a failure is retried next time). */
export function getMe(): Promise<Me> {
  meCache ??= (getClient() as TfsClient).me().catch((e) => { meCache = null; throw e; });
  return meCache;
}

const info = (r: RawItem): ParentInfo => ({ title: r.fields['System.Title'] ?? '', type: r.fields['System.WorkItemType'] ?? '' });

/** Title and type of the given items plus those of their parents (one extra batch call for parents not in the set). */
export async function parentTitles(c: TfsApi, raws: RawItem[]): Promise<Map<number, ParentInfo>> {
  const parents = new Map<number, ParentInfo>(raws.map(r => [r.id, info(r)]));
  const missing = [...new Set(raws.map(r => r.fields['System.Parent']).filter((p): p is number => typeof p === 'number' && !parents.has(p)))];
  if (missing.length) for (const p of await c.getItems(missing, ['System.Title', 'System.WorkItemType'])) parents.set(p.id, info(p));
  return parents;
}

/** Drop one backlog's cache so its next load reloads from TFS (e.g. after an item was rejected back to Active). */
export function invalidateBacklog(backlogId: string): void {
  caches.delete(backlogId);
}

async function load(backlogId: string, wiql: string): Promise<void> {
  const cfg = getConfig();
  const c = getClient();
  const ids = await c.wiql(wiql);
  const raws = await c.getItems(ids, TFS_FIELDS);
  const titles = await parentTitles(c, raws);
  const items = raws.map(r => toBacklogItem(r, cfg, titles));
  caches.set(backlogId, { items, loadedAt: new Date().toISOString(), wiql, outsideFeatures: await outsideFeatures(c, items) });
}

/** Parent Features of these items that are not in the list themselves (shown read-only as group headers); best effort. */
async function outsideFeatures(c: TfsApi, items: BacklogItem[]): Promise<BacklogItem[]> {
  const inList = new Set(items.map(i => i.id));
  const ids = [...new Set(items.filter(i => i.parentType === 'Feature' && i.parentId !== null && !inList.has(i.parentId)).map(i => i.parentId!))];
  if (!ids.length) return [];
  try {
    const raws = await c.getItems(ids, TFS_FIELDS);
    const titles = await parentTitles(c, raws);
    return raws.map(r => ({ ...toBacklogItem(r, getConfig(), titles), outside: true }));
  } catch (e) {
    console.warn(`Outside Features lookup failed: ${(e as Error).message}`);
    return [];
  }
}

/** Loads (or serves from cache) one backlog. Reloads when refreshed, uncached, or its effective WIQL changed. */
export async function loadBacklog(backlogId: string, refresh = false): Promise<BacklogResponse> {
  const def = getBacklogDef(backlogId);
  if (!def) throw new Error(`Unknown backlog ${backlogId}`);
  const cfg = getConfig();
  const wiql = effectiveWiql(def, cfg);
  const cached = caches.get(backlogId);
  if (!cached || refresh || cached.wiql !== wiql) {
    let f = inflight.get(backlogId);
    if (!f || f.wiql !== wiql) {
      const p: Promise<void> = load(backlogId, wiql).finally(() => { if (inflight.get(backlogId)?.p === p) inflight.delete(backlogId); });
      f = { wiql, p };
      inflight.set(backlogId, f);
    }
    await f.p;
  }
  const c = caches.get(backlogId)!;
  return { backlogId, items: c.items, outsideFeatures: c.outsideFeatures, loadedAt: c.loadedAt, nextVersionTag: cfg.nextVersionTag, bands: cfg.bands };
}

export function getCachedItem(backlogId: string, id: number): BacklogItem | undefined {
  return caches.get(backlogId)?.items.find(i => i.id === id);
}

/** Look an item up across every loaded backlog (used for parent titles). */
export function findCachedItem(id: number): BacklogItem | undefined {
  for (const c of caches.values()) {
    const it = c.items.find(i => i.id === id);
    if (it) return it;
  }
  return undefined;
}

/** Update the item in every cache that contains it. */
export function replaceItem(item: BacklogItem): void {
  for (const c of caches.values()) {
    const i = c.items.findIndex(x => x.id === item.id);
    if (i >= 0) c.items[i] = item;
  }
}

/**
 * After items changed area path: they no longer belong to the current backlog, and any other backlog
 * may now contain them, so the other caches are dropped and reload from TFS on their next request.
 */
export function afterMove(currentBacklogId: string, movedIds: number[]): void {
  const gone = new Set(movedIds);
  const cur = caches.get(currentBacklogId);
  if (cur) cur.items = cur.items.filter(i => !gone.has(i.id));
  for (const id of [...caches.keys()]) if (id !== currentBacklogId) caches.delete(id);
}

/** Drop caches of backlog ids that are no longer configured. */
export function pruneCaches(): void {
  const ids = new Set(getConfig().backlogs.map(b => b.id));
  for (const id of [...caches.keys()]) if (!ids.has(id)) caches.delete(id);
  for (const id of [...inflight.keys()]) if (!ids.has(id)) inflight.delete(id);
}

/** Re-derive band/component/version columns of all caches after a settings change. */
export function rederive(): void {
  const cfg = getConfig();
  pruneCaches();
  for (const c of caches.values()) c.items = c.items.map(i => withDerived(i, cfg));
}

function count(keys: string[]): CountEntry[] {
  const m = new Map<string, number>();
  for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export async function getMetrics(backlogId: string): Promise<MetricsResponse> {
  const { items, loadedAt } = await loadBacklog(backlogId, false);
  const cfg = getConfig();
  const bandCounts = new Map<string, number>();
  for (const i of items) bandCounts.set(i.band, (bandCounts.get(i.band) ?? 0) + 1);
  const byBand: CountEntry[] = cfg.bands.map(b => ({ key: b.label, count: bandCounts.get(b.label) ?? 0 }));
  const unknown = bandCounts.get('Unknown') ?? 0;
  if (unknown > 0) byBand.push({ key: 'Unknown', count: unknown });
  const nr = items.filter(i => i.businessOrder === -1);
  const nv = items.filter(i => i.nextVersion);
  return {
    backlogId,
    total: items.length,
    byType: count(items.map(i => i.type)),
    byBand,
    byState: count(items.map(i => i.state)),
    byComponent: count(items.map(i => i.component)),
    notReviewed: { total: nr.length, byType: count(nr.map(i => i.type)) },
    nextVersion: { tag: cfg.nextVersionTag, total: nv.length, byType: count(nv.map(i => i.type)) },
    loadedAt,
  };
}

export async function getTags(backlogId: string): Promise<TagsResponse> {
  const { items } = await loadBacklog(backlogId, false);
  const cfg = getConfig();
  // count case-insensitively, keep first-seen casing
  const m = new Map<string, CountEntry>();
  for (const i of items) for (const t of i.tags) {
    const e = m.get(t.toLowerCase());
    if (e) e.count++; else m.set(t.toLowerCase(), { key: t, count: 1 });
  }
  const tags = [...m.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  return { tags, versionTags: cfg.versionTags, nextVersionTag: cfg.nextVersionTag };
}

/** On-demand, uncached details of one item (fields, children, best-effort comments). */
export async function getItemDetails(id: number): Promise<ItemDetails> {
  const cfg = getConfig();
  const c = getClient() as TfsClient; // details need the concrete client (getItem/getComments)
  const raw = await c.getItem(id);
  const kidIds = childIds(raw);
  const [children, commentsRes] = await Promise.all([
    kidIds.length ? c.getItems(kidIds, ['System.WorkItemType', 'System.Title', 'System.State']) : Promise.resolve([]),
    c.getComments(id, 100).then(p => ({ p }), (e: Error) => ({ e })),
  ]);
  let comments: ItemComment[] = [];
  let commentsError: string | undefined;
  let meId = '';
  try { meId = (await getMe()).id; } catch { /* best effort */ }
  if ('p' in commentsRes) comments = toComments(commentsRes.p, meId || undefined); else commentsError = commentsRes.e.message;
  const pid = raw.fields['System.Parent'];
  const cachedParent = typeof pid === 'number' ? findCachedItem(pid) : undefined;
  let parent: ParentInfo = { title: cachedParent?.title ?? '', type: cachedParent?.type ?? '' };
  if (typeof pid === 'number' && (!parent.title || !parent.type)) {
    try {
      const [p] = await c.getItems([pid], ['System.Title', 'System.WorkItemType']);
      if (p) parent = info(p);
    } catch { /* best effort */ }
  }
  const details = toItemDetails(raw, children, comments, cfg, parent, commentsError);
  const ackedAt = readAcks()[String(id)];
  if (ackedAt) details.ackedAt = ackedAt;
  if (meId && 'p' in commentsRes) {
    const w = waitingFor(rawComments(commentsRes.p), meId, ackedAt);
    details.attention = w ? { id, ...w } : null;
  }
  return details;
}
