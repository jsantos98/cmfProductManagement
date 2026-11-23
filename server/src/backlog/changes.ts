import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../config.js';
import type { PatchOp, TfsApi } from '../tfs/client.js';
import { applyTagDiff, joinTags, toBacklogItem, type ParentInfo } from './derive.js';
import type { AppConfig, BacklogItem, ChangesResponse, ItemChange, ItemChangeResult } from '../types.js';

export interface ChangeDeps {
  client: TfsApi;
  cfg: AppConfig;
  getItem(id: number): BacklogItem | undefined;
  replaceItem(item: BacklogItem): void;
  /** called once after an apply phase in which these items changed area path (cache maintenance) */
  afterMove?(movedIds: number[]): void;
  /** JSONL audit file; defaults to <repo>/data/changes.jsonl */
  auditPath?: string;
  /** TFS identity of the signed-in user ("Name <DOMAIN\\user>"), used to resolve System.AssignedTo = '@me' */
  me?(): Promise<string>;
}

/** The only accepted value for System.AssignedTo: the server substitutes the signed-in user. */
export const ASSIGN_ME = '@me';

const OLD_VALUE: Record<string, keyof BacklogItem> = {
  'Custom.BusinessOrder': 'businessOrder', 'System.State': 'state', 'System.Title': 'title',
  'System.IterationPath': 'iterationPath', 'System.AreaPath': 'areaPath', 'System.AssignedTo': 'assignedTo',
};

/** Build the JSON-patch ops (and field -> new value map for auditing). Throws on invalid input. */
function buildOps(ch: ItemChange, item: BacklogItem, cfg: AppConfig, me: string | null): { ops: PatchOp[]; newValues: Record<string, unknown> } {
  const ops: PatchOp[] = [{ op: 'test', path: '/rev', value: ch.rev }];
  const newValues: Record<string, unknown> = {};
  for (const [ref, raw] of Object.entries(ch.fields ?? {})) {
    let value: unknown = raw;
    if (ref === 'System.AssignedTo') {
      // not a generally editable field: only "assign to me" is allowed
      if (raw !== ASSIGN_ME) throw new Error(`Assigned To can only be set to the signed-in user (${ASSIGN_ME})`);
      if (!me) throw new Error('Signed-in user is unknown; cannot assign');
      ops.push({ op: 'add', path: `/fields/${ref}`, value: me });
      newValues[ref] = me;
      continue;
    }
    if (ref === 'System.AreaPath') {
      // not a generally editable field: only a move to the area path of a configured backlog is allowed
      const want = String(raw ?? '').trim().toLowerCase();
      const target = want ? cfg.backlogs.find(b => b.areaPath.trim().toLowerCase() === want) : undefined;
      if (!target) throw new Error(`Area path not allowed: ${String(raw ?? '')}`);
      value = target.areaPath;
      ops.push({ op: 'add', path: `/fields/${ref}`, value });
      newValues[ref] = value;
      continue;
    }
    if (ref === 'System.Tags' || !cfg.editableFields.includes(ref)) throw new Error(`Field not editable: ${ref}`);
    if (ref === 'Custom.BusinessOrder') {
      const n = Number(raw);
      if (raw === null || raw === '' || !Number.isInteger(n)) throw new Error('Custom.BusinessOrder must be an integer');
      value = n;
    }
    ops.push({ op: 'add', path: `/fields/${ref}`, value });
    newValues[ref] = value;
  }
  if (ch.tags && (ch.tags.add?.length || ch.tags.remove?.length)) {
    if (!cfg.editableFields.includes('System.Tags')) throw new Error('Field not editable: System.Tags');
    const value = joinTags(applyTagDiff(item.tags, ch.tags.add, ch.tags.remove));
    ops.push({ op: 'add', path: '/fields/System.Tags', value });
    newValues['System.Tags'] = value;
  }
  if (ops.length === 1) throw new Error('No changes provided');
  return { ops, newValues };
}

export const defaultAuditPath = (): string => path.join(repoRoot, 'data', 'changes.jsonl');

export function audit(file: string, entry: unknown): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8');
  } catch (e) {
    console.error('Audit write failed:', (e as Error).message);
  }
}

interface Prepared { ch: ItemChange; item: BacklogItem; ops: PatchOp[]; newValues: Record<string, unknown> }

export async function applyChanges(changes: ItemChange[], opts: { dryRun: boolean } & ChangeDeps): Promise<ChangesResponse> {
  const { dryRun, client, cfg, getItem, replaceItem, afterMove } = opts;
  const auditFile = opts.auditPath ?? defaultAuditPath();
  const prepared: Prepared[] = [];
  const results: ItemChangeResult[] = [];

  let me: string | null = null;
  if (changes.some(c => c.fields && 'System.AssignedTo' in c.fields)) {
    try { me = (await opts.me?.()) ?? null; } catch { me = null; }
  }

  // Phase 1: build + validate everything, write nothing
  for (const ch of changes) {
    try {
      const item = getItem(ch.id);
      if (!item) throw new Error(`Item ${ch.id} is not in the loaded backlog`);
      const { ops, newValues } = buildOps(ch, item, cfg, me);
      await client.patch(ch.id, ops, { validateOnly: true });
      prepared.push({ ch, item, ops, newValues });
      results.push({ id: ch.id, ok: true });
    } catch (e) {
      results.push({ id: ch.id, ok: false, error: (e as Error).message });
    }
  }
  if (dryRun || results.some(r => !r.ok)) return { dryRun, phase: 'validation', results };

  // Phase 2: apply sequentially, keep successes
  const applied: ItemChangeResult[] = [];
  const movedIds: number[] = [];
  for (const { ch, item, ops, newValues } of prepared) {
    const fields: Record<string, { old: unknown; new: unknown }> = {};
    for (const [ref, nv] of Object.entries(newValues)) {
      const key = OLD_VALUE[ref];
      fields[ref] = { old: ref === 'System.Tags' ? joinTags(item.tags) : key ? item[key] : undefined, new: nv };
    }
    const entry: Record<string, unknown> = { ts: new Date().toISOString(), id: ch.id, oldRev: ch.rev, newRev: null, ok: false, error: null, fields };
    try {
      const updated = await client.patch(ch.id, ops);
      const titles = new Map<number, ParentInfo>(item.parentId !== null ? [[item.parentId, { title: item.parentTitle, type: item.parentType }]] : []);
      const fresh = toBacklogItem(updated, cfg, titles);
      replaceItem(fresh);
      entry.ok = true;
      entry.newRev = updated.rev;
      const moved = 'System.AreaPath' in newValues && fresh.areaPath.trim().toLowerCase() !== item.areaPath.trim().toLowerCase();
      if (moved) movedIds.push(ch.id);
      applied.push({ id: ch.id, ok: true, newRev: updated.rev, item: fresh, ...(moved ? { moved: true } : {}) });
    } catch (e) {
      entry.error = (e as Error).message;
      applied.push({ id: ch.id, ok: false, error: (e as Error).message });
    }
    audit(auditFile, entry);
  }
  if (movedIds.length) afterMove?.(movedIds);
  return { dryRun: false, phase: 'applied', results: applied };
}
