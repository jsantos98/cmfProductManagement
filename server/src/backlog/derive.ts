import type { AppConfig, Band, BacklogItem } from '../types.js';
import type { RawItem } from '../tfs/client.js';
import { versionRange } from '../shared/version.js';

export const TFS_FIELDS = ['System.Id', 'System.Rev', 'System.WorkItemType', 'System.Title', 'System.State',
  'System.IterationPath', 'System.AreaPath', 'System.AssignedTo', 'System.Tags', 'Custom.BusinessOrder',
  'System.Parent', 'System.ChangedDate', 'System.CommentCount'];

export function bandFor(order: number | null, bands: Band[]): string {
  if (order === null || order === undefined) return 'Unknown';
  const b = bands.find(x => x.min <= order && (x.max === null || order <= x.max));
  return b ? b.label : 'Unknown';
}

/** First rule whose `match` is a case-insensitive substring of the tags string (Excel SEARCH). */
export function firstMatch<R extends { match: string }>(tagsString: string, rules: R[], valueKey: keyof R): string {
  const hay = tagsString.toLowerCase();
  for (const r of rules) if (r.match && hay.includes(r.match.toLowerCase())) return String(r[valueKey]);
  return 'Unknown';
}

export function splitTags(s: string | null | undefined): string[] {
  return (s ?? '').split(';').map(t => t.trim()).filter(Boolean);
}

export function joinTags(arr: string[]): string {
  return arr.join('; ');
}

export function hasTag(tags: string[], tag: string): boolean {
  const t = tag.trim().toLowerCase();
  return tags.some(x => x.toLowerCase() === t);
}

/** Existing casing is kept; added tags are deduped case-insensitively; removal is case-insensitive. */
export function applyTagDiff(current: string[], add: string[] = [], remove: string[] = []): string[] {
  const rm = new Set(remove.map(t => t.trim().toLowerCase()));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of [...current, ...add.map(a => a.trim())]) {
    const k = t.toLowerCase();
    if (!k || rm.has(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

type Base = Omit<BacklogItem, 'band' | 'component' | 'minVersion' | 'maxVersion' | 'nextVersion'>;

/** Compute the derived columns from base fields (also used to re-derive after a settings change). */
export function withDerived(base: Base, cfg: AppConfig): BacklogItem {
  const tagsStr = joinTags(base.tags);
  const versions = versionRange(base.tags);
  return {
    ...base,
    band: bandFor(base.businessOrder, cfg.bands),
    component: firstMatch(tagsStr, cfg.componentRules, 'component'),
    minVersion: versions.min,
    maxVersion: versions.max,
    nextVersion: hasTag(base.tags, cfg.nextVersionTag),
  };
}

/** Title and work item type of a parent (a plain string = title only). */
export interface ParentInfo { title: string; type: string }

export function toBacklogItem(raw: RawItem, cfg: AppConfig, parents: Map<number, string | ParentInfo> = new Map()): BacklogItem {
  const f = raw.fields;
  const a = f['System.AssignedTo'];
  const parentId = typeof f['System.Parent'] === 'number' ? (f['System.Parent'] as number) : null;
  const p = parentId !== null ? parents.get(parentId) : undefined;
  const bo = f['Custom.BusinessOrder'];
  return withDerived({
    id: raw.id,
    rev: raw.rev,
    url: `${cfg.tfs.serverUrl}/${cfg.tfs.collection}/${cfg.tfs.project}/_workitems/edit/${raw.id}`,
    type: f['System.WorkItemType'] ?? '',
    title: f['System.Title'] ?? '',
    state: f['System.State'] ?? '',
    iterationPath: f['System.IterationPath'] ?? '',
    areaPath: f['System.AreaPath'] ?? '',
    assignedTo: typeof a === 'string' ? a : (a?.displayName ?? ''),
    tags: splitTags(f['System.Tags']),
    businessOrder: bo === undefined || bo === null || bo === '' ? null : Number(bo),
    parentId,
    parentTitle: typeof p === 'string' ? p : (p?.title ?? ''),
    parentType: typeof p === 'object' ? p.type : '',
    changedDate: f['System.ChangedDate'] ?? '',
    commentCount: Number(f['System.CommentCount']) || 0,
  }, cfg);
}
