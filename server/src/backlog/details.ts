import type { AppConfig, ItemChild, ItemComment, ItemDetails, ItemSection } from '../types.js';
import type { RawItem } from '../tfs/client.js';
import { toBacklogItem, type ParentInfo } from './derive.js';
import { mentionsPerson } from './attention.js';

export const DETAIL_SECTIONS: [field: string, label: string][] = [
  ['System.Description', 'Description'],
  ['Custom.Summary', 'Summary'],
  ['Microsoft.VSTS.TCM.ReproSteps', 'Repro steps'],
  ['Microsoft.VSTS.Common.AcceptanceCriteria', 'Acceptance criteria'],
  ['Microsoft.VSTS.TCM.SystemInfo', 'System info'],
];

/** Identity fields come back as objects ({displayName}) or plain strings. */
export const identity = (v: any): string => (typeof v === 'string' ? v : (v?.displayName ?? ''));
const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v));

/** Child ids from `System.LinkTypes.Hierarchy-Forward` relations. */
export function childIds(raw: { relations?: any[] }): number[] {
  const ids: number[] = [];
  for (const r of raw.relations ?? []) {
    if (r?.rel !== 'System.LinkTypes.Hierarchy-Forward') continue;
    const m = /\/workItems\/(\d+)$/i.exec(String(r.url ?? ''));
    if (m) ids.push(Number(m[1]));
  }
  return ids;
}

export function toItemDetails(
  raw: RawItem,
  children: RawItem[],
  comments: ItemComment[],
  cfg: AppConfig,
  parent: string | ParentInfo = '',
  commentsError?: string,
): ItemDetails {
  const f = raw.fields;
  const pid = typeof f['System.Parent'] === 'number' ? (f['System.Parent'] as number) : null;
  const sections: ItemSection[] = DETAIL_SECTIONS
    .map(([field, label]) => ({ label, html: str(f[field]) }))
    .filter(s => s.html.trim() !== '');
  const kids: ItemChild[] = children.map(c => ({
    id: c.id,
    type: str(c.fields['System.WorkItemType']),
    title: str(c.fields['System.Title']),
    state: str(c.fields['System.State']),
  }));
  const p = f['Microsoft.VSTS.Common.Priority'];
  return {
    item: toBacklogItem(raw, cfg, pid !== null && parent ? new Map([[pid, parent]]) : new Map()),
    createdBy: identity(f['System.CreatedBy']),
    createdDate: str(f['System.CreatedDate']),
    changedBy: identity(f['System.ChangedBy']),
    changedDate: str(f['System.ChangedDate']),
    priority: p === undefined || p === null || p === '' ? null : Number(p),
    severity: str(f['Microsoft.VSTS.Common.Severity']),
    bugType: str(f['Custom.BugType']),
    targetVersion: str(f['Custom.TargetVersion']),
    version: str(f['Custom.Version']),
    sections,
    children: kids,
    comments,
    ...(commentsError ? { commentsError } : {}),
  };
}

/** Map the TFS comments payload ({comments:[{createdBy,createdDate,text}]}) to ItemComment[]. */
export function toComments(payload: any, meId?: string): ItemComment[] {
  return (payload?.comments ?? []).map((c: any) => ({
    author: identity(c.createdBy), date: str(c.createdDate), html: str(c.text),
    ...(meId ? { mentionsMe: mentionsPerson(c, meId) } : {}),
  }));
}
