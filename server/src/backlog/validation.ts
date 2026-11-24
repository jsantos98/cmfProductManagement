import { getBacklogDef, getConfig, validationFeatureWiql, validationWiql } from '../config.js';
import type { PatchOp, TfsApi } from '../tfs/client.js';
import { TFS_FIELDS, toBacklogItem } from './derive.js';
import { audit, defaultAuditPath } from './changes.js';
import { attachPrs } from './pullRequests.js';
import { getAttention } from './attention.js';
import { getClient, invalidateBacklog, parentTitles } from './service.js';
import type { AppConfig, BacklogDef, ChangesResponse, ItemChangeResult, SummaryResponse, TransitionRequest, ValidationItem, ValidationResponse } from '../types.js';

const VALIDATION_FIELDS = [...TFS_FIELDS, 'Microsoft.VSTS.Common.ResolvedDate', 'Microsoft.VSTS.Common.ResolvedBy', 'System.Reason'];

interface CacheEntry { items: ValidationItem[]; loadedAt: string; wiql: string }
const caches = new Map<string, CacheEntry>();
const inflight = new Map<string, { wiql: string; p: Promise<void> }>();

export interface ValidationIds { ids: number[]; viaFeature: Set<number> }

/** Union of my items and the items under my Features (mine first); `viaFeature` = only in the second list. */
export function mergeValidationIds(mine: number[], underMyFeatures: number[]): ValidationIds {
  const own = new Set(mine);
  const viaFeature = new Set(underMyFeatures.filter(id => !own.has(id)));
  return { ids: [...mine, ...viaFeature], viaFeature };
}

/** Ids to validate in one backlog: Resolved items assigned to me + Resolved items whose parent Feature is mine. */
export async function validationIds(client: TfsApi, def: BacklogDef, cfg: AppConfig): Promise<ValidationIds> {
  const fw = validationFeatureWiql(def, cfg);
  const [mine, under] = await Promise.all([client.wiql(validationWiql(def, cfg)), fw ? client.wiql(fw) : Promise.resolve([])]);
  return mergeValidationIds(mine, under);
}

const queryKey = (def: BacklogDef, cfg: AppConfig) => `${validationWiql(def, cfg)}\n${validationFeatureWiql(def, cfg) ?? ''}`;

async function load(backlogId: string, def: BacklogDef, key: string): Promise<void> {
  const cfg = getConfig();
  const c = getClient();
  const { ids, viaFeature } = await validationIds(c, def, cfg);
  const raws = ids.length ? await c.getItems(ids, VALIDATION_FIELDS) : [];
  const titles = await parentTitles(c, raws);
  const items = raws.map((r): ValidationItem => {
    const by = r.fields['Microsoft.VSTS.Common.ResolvedBy'];
    return {
      ...toBacklogItem(r, cfg, titles),
      resolvedDate: r.fields['Microsoft.VSTS.Common.ResolvedDate'] ?? '',
      resolvedBy: typeof by === 'string' ? by : (by?.displayName ?? ''),
      resolvedReason: r.fields['System.Reason'] ?? '',
      ...(viaFeature.has(r.id) ? { viaFeature: true } : {}),
    };
  });
  // oldest resolved first across both lists (ISO dates sort as strings; missing dates go last)
  items.sort((a, b) => (a.resolvedDate || '~').localeCompare(b.resolvedDate || '~'));
  await attachPrs(c, items, cfg);
  caches.set(backlogId, { items, loadedAt: new Date().toISOString(), wiql: key });
}

/** Resolved items to validate in one backlog's area (mine + under my Features). Reloads when refreshed, uncached, or a query changed. */
export async function loadValidation(backlogId: string, refresh = false): Promise<ValidationResponse> {
  const def = getBacklogDef(backlogId);
  if (!def) throw new Error(`Unknown backlog ${backlogId}`);
  const wiql = queryKey(def, getConfig());
  const cached = caches.get(backlogId);
  if (!cached || refresh || cached.wiql !== wiql) {
    let f = inflight.get(backlogId);
    if (!f || f.wiql !== wiql) {
      const p: Promise<void> = load(backlogId, def, wiql).finally(() => { if (inflight.get(backlogId)?.p === p) inflight.delete(backlogId); });
      f = { wiql, p };
      inflight.set(backlogId, f);
    }
    await f.p;
  }
  const c = caches.get(backlogId)!;
  return { backlogId, items: c.items, loadedAt: c.loadedAt };
}

/** Drop caches of backlog ids that are no longer configured. */
export function pruneValidationCaches(): void {
  const ids = new Set(getConfig().backlogs.map(b => b.id));
  for (const id of [...caches.keys()]) if (!ids.has(id)) caches.delete(id);
  for (const id of [...inflight.keys()]) if (!ids.has(id)) inflight.delete(id);
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export interface TransitionDeps {
  client: TfsApi;
  cfg: AppConfig;
  /** looks up an item of the validation list (loading it when needed) */
  getItem(id: number): Promise<ValidationItem | undefined> | ValidationItem | undefined;
  /** called once after an apply phase with the ids that were written */
  afterApplied?(ids: number[], action: 'close' | 'reject'): void;
  /** JSONL audit file; defaults to <repo>/data/changes.jsonl */
  auditPath?: string;
}

function defaultDeps(backlogId: string): TransitionDeps {
  return {
    client: getClient(),
    cfg: getConfig(),
    getItem: async (id) => {
      let c = caches.get(backlogId);
      if (!c?.items.some(i => i.id === id)) { await loadValidation(backlogId); c = caches.get(backlogId); }
      return c?.items.find(i => i.id === id);
    },
    afterApplied: (ids, action) => {
      const c = caches.get(backlogId);
      if (c) { const gone = new Set(ids); c.items = c.items.filter(i => !gone.has(i.id)); }
      if (action === 'reject' && ids.length) invalidateBacklog(backlogId);
    },
  };
}

/** Close (validated) or reject (back to Active) Resolved items: validate all first, write nothing if any fails. */
export async function transition(backlogId: string, req: TransitionRequest, dryRun: boolean, deps?: TransitionDeps): Promise<ChangesResponse> {
  const d = deps ?? defaultDeps(backlogId);
  const { client, cfg } = d;
  const auditFile = d.auditPath ?? defaultAuditPath();
  const { action } = req;
  const state = action === 'close' ? 'Closed' : 'Active';
  const comment = req.comment?.trim();
  const results: ItemChangeResult[] = [];
  const prepared: { id: number; rev: number; type: string; ops: PatchOp[]; reason: string }[] = [];

  // Phase 1: build + validate everything, write nothing
  for (const { id, rev } of req.items) {
    try {
      const item = await d.getItem(id);
      if (!item) throw new Error(`Item ${id} is not in the "to validate" list`);
      const reason = cfg.validation[action]?.[item.type];
      if (!reason) throw new Error(`No ${action} reason configured for ${item.type}`);
      const ops: PatchOp[] = [
        { op: 'test', path: '/rev', value: rev },
        { op: 'add', path: '/fields/System.State', value: state },
        { op: 'add', path: '/fields/System.Reason', value: reason },
      ];
      if (comment) ops.push({ op: 'add', path: '/fields/System.History', value: escapeHtml(comment).replace(/\r?\n/g, '<br>') });
      await client.patch(id, ops, { validateOnly: true });
      prepared.push({ id, rev, type: item.type, ops, reason });
      results.push({ id, ok: true });
    } catch (e) {
      results.push({ id, ok: false, error: (e as Error).message });
    }
  }
  if (dryRun || results.some(r => !r.ok)) return { dryRun, phase: 'validation', results };

  // Phase 2: apply sequentially, keep successes
  const applied: ItemChangeResult[] = [];
  const done: number[] = [];
  for (const p of prepared) {
    const entry: Record<string, unknown> = {
      ts: new Date().toISOString(), kind: 'validation', action, id: p.id, oldRev: p.rev, newRev: null,
      ok: false, error: null, state, reason: p.reason, ...(comment ? { comment } : {}),
    };
    try {
      const updated = await client.patch(p.id, p.ops);
      entry.ok = true;
      entry.newRev = updated.rev;
      done.push(p.id);
      applied.push({ id: p.id, ok: true, newRev: updated.rev });
    } catch (e) {
      entry.error = (e as Error).message;
      applied.push({ id: p.id, ok: false, error: (e as Error).message });
    }
    audit(auditFile, entry);
  }
  if (done.length) d.afterApplied?.(done, action);
  return { dryRun: false, phase: 'applied', results: applied };
}

/** Per-backlog counters for the tab badges: comments waiting for me (backlog + to-validate) and Resolved items to validate. */
export async function getSummary(): Promise<SummaryResponse> {
  const cfg = getConfig();
  const client = getClient();
  const backlogs = await Promise.all(cfg.backlogs.filter(b => !b.hidden).map(async (def) => {
    try {
      const [a, v, val] = await Promise.all([
        getAttention(def.id), getAttention(def.id, 'validate'), validationIds(client, def, cfg),
      ]);
      const waiting = new Set([...a.items, ...v.items].map(i => i.id)).size;
      return { id: def.id, waiting, toValidate: val.ids.length };
    } catch (e) {
      console.warn(`Summary for backlog ${def.id} failed: ${(e as Error).message}`);
      return { id: def.id, waiting: 0, toValidate: 0 };
    }
  }));
  return { backlogs, loadedAt: new Date().toISOString() };
}
