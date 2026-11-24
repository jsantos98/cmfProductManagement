// Customer Portal write actions, built exactly like the portal web app builds them (see README). Every action:
// 1. re-reads the ticket and refuses (409) when it changed since the client loaded it,
// 2. builds the portal input; with dryRun it stops here and returns a preview,
// 3. calls the portal, audits the result in data/changes.jsonl (kind "portal") and returns the fresh details.
import { audit, defaultAuditPath } from '../backlog/changes.js';
import type { PortalActionRequest, PortalActionResult, PortalTicketOptions, PortalWorkItem } from '../types.js';
import { signedInAccount } from './auth.js';
import { portalCall } from './client.js';
import { getTicketDetails, invalidateList, plain, refResolver, validTicketId } from './requests.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

export class PortalConflictError extends Error {}
export class PortalActionError extends Error {}

const BO = 'Cmf.CustomerPortal.BusinessObjects';
const bo = (name: string) => `${BO}.${name}, ${BO}`;
const WORK_ITEM_COLLECTION = 'Product';
const WORK_ITEM_PROJECT = 'Product';

// ---- pure helpers -------------------------------------------------------------------------------------------------

/** Plain text typed in the cockpit → the HTML body the portal stores (escaped; blank line = paragraph). */
export function textToHtml(text: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return text
    .replace(/\r\n?/g, '\n')
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/** "Name <mail@x>" → "mail@x"; a bare address is returned as is. */
export function emailOf(s: string): string {
  const m = /<([^>]+)>/.exec(s);
  return (m ? m[1] : s).trim();
}

export interface StateInfo { id: string; name: string }
export interface StateModelInfo { name: string; states: StateInfo[]; transitions: { from: string; to: string; reasonDefault: string }[] }

/** Target states reachable from `current` (self-transitions excluded). */
export function reachable(model: StateModelInfo, current: string): string[] {
  return [...new Set(model.transitions.filter((t) => t.from === current && t.to !== current).map((t) => t.to))];
}

/** Close reasons that apply to a request type: untagged ones plus those tagged with its short code (e.g. "[ER]"). */
export function closeReasonsFor(values: { Value?: string; Description?: string }[], openReason: string): { value: string; description: string }[] {
  const code: Record<string, string> = { 'Enhancement Request': 'ER', Bug: 'Bug', Question: 'Question' };
  const mine = code[openReason] ?? openReason;
  return values
    .map((v) => {
      const d = String(v.Description ?? '');
      const tag = /\[([^\]]*)\]/.exec(d)?.[1] ?? null;
      return { value: String(v.Value ?? ''), description: d.replace(/\s*\[[^\]]*\]\s*/g, ' ').trim(), tag };
    })
    .filter((v) => v.value && v.value !== 'Automatically Closed' && (v.tag === null || v.tag === mine))
    .map(({ value, description }) => ({ value, description }));
}

/** TicketWorkItem relations already on the ticket (CMFMap "TicketWorkItem"). */
export function existingWorkItems(ticket: any, deref: <T>(x: T) => T = (x) => x): { wid: string; collection: string; project: string }[] {
  const data: any[] = Array.isArray(ticket?.RelationCollection?.CMFMapData) ? ticket.RelationCollection.CMFMapData : [];
  const rel = data.find((e) => Array.isArray(e) && e[0] === 'TicketWorkItem');
  const list: any[] = Array.isArray(rel?.[1]) ? rel[1] : [];
  return list
    .map(deref)
    .map((r) => deref(deref(r)?.TargetEntity))
    .filter((t) => t && t.WId)
    .map((t) => ({ wid: String(t.WId), collection: String(t.Collection ?? WORK_ITEM_COLLECTION), project: String(t.Project ?? WORK_ITEM_PROJECT) }));
}

/** Other relations to keep on a full update (the portal re-sends the ticket's tags). */
function tagRelations(ticket: any): any[] {
  const data: any[] = Array.isArray(ticket?.RelationCollection?.CMFMapData) ? ticket.RelationCollection.CMFMapData : [];
  const rel = data.find((e) => Array.isArray(e) && e[0] === 'TicketTag');
  return Array.isArray(rel?.[1]) ? rel[1] : [];
}

/** State model info from a FullLoadAllEntityTypes output (Ticket entity type). */
export function ticketStateModels(out: any): Map<string, StateModelInfo> {
  const deref = refResolver(out);
  const ticket = (out?.EntityTypeCollection ?? []).map(deref).find((e: any) => e?.Name === 'Ticket');
  const models = new Map<string, StateModelInfo>();
  for (const m0 of ticket?.StateModels ?? []) {
    const m = deref(m0);
    models.set(String(m.Name), {
      name: String(m.Name),
      states: (m.States ?? []).map(deref).map((s: any) => ({ id: String(s.Id), name: String(s.Name) })),
      transitions: (m.StateTransitions ?? []).map(deref).map((t: any) => ({
        from: String(deref(t.FromState)?.Name ?? ''),
        to: String(deref(t.ToState)?.Name ?? ''),
        reasonDefault: String(t.ReasonDefaultValue ?? ''),
      })),
    });
  }
  return models;
}

// ---- portal metadata (cached) -------------------------------------------------------------------------------------

let entityTypes: { at: number; models: Map<string, StateModelInfo> } | null = null;
const META_TTL = 12 * 3600_000;

async function stateModel(name: string): Promise<StateModelInfo> {
  if (!entityTypes || Date.now() - entityTypes.at > META_TTL) {
    const r = await portalCall<any>('EntityType', 'FullLoadAllEntityTypes', '', { LoadProperties: false, LoadStateModels: true, LoadOperations: false }, 'Cmf.Foundation.BusinessOrchestration.EntityTypeManagement');
    entityTypes = { at: Date.now(), models: ticketStateModels(r) };
  }
  const m = entityTypes.models.get(name);
  if (!m) throw new PortalActionError(`State model ${name} not found in the portal`);
  return m;
}

let closeReasonsCache: { at: number; values: any[] } | null = null;
async function closeReasonValues(): Promise<any[]> {
  if (!closeReasonsCache || Date.now() - closeReasonsCache.at > META_TTL) {
    const r = await portalCall<any>('Table', 'GetLookupTableByName', '', { Name: 'CloseTicketReason' }, 'Cmf.Foundation.BusinessOrchestration.TableManagement');
    closeReasonsCache = { at: Date.now(), values: r?.LookupTable?.Values ?? [] };
  }
  return closeReasonsCache.values;
}

async function rawTicket(id: string): Promise<any> {
  const o = await portalCall<any>('Ticket', 'GetTicketDetails', 'TicketManagement', { TicketId: id, IncludeArticles: true, IncludeExternalAttachments: true });
  if (!o?.Ticket) throw new PortalActionError(`Ticket ${id} not found`);
  return o;
}

/** Newest article of a GetTicketDetails output (replies go to its sender, with its CC). */
function lastArticle(o: any): any {
  const articles: any[] = Array.isArray(o?.Articles?.Table) ? o.Articles.Table : [];
  return [...articles].sort((a, b) => Date.parse(a.CreatedOn) - Date.parse(b.CreatedOn)).at(-1);
}

export async function getOptions(id: string): Promise<PortalTicketOptions> {
  const o = await rawTicket(id);
  const t = o.Ticket;
  const d = refResolver(o), cms = d(t.CurrentMainState);
  const model = await stateModel(String(d(cms?.StateModel)?.Name ?? ''));
  const current = String(d(cms?.CurrentState)?.Name ?? t.State ?? '');
  return {
    state: current,
    transitions: reachable(model, current),
    closeReasons: closeReasonsFor(await closeReasonValues(), String(t.OpenReason ?? '')),
    workItems: existingWorkItems(t, refResolver(o)).map((w) => Number(w.wid)).filter(Number.isFinite),
    modifiedOn: String(t.ModifiedOn ?? ''),
    replyTo: lastArticle(o) ? emailOf(String(lastArticle(o).From ?? '')) : '',
    replyCc: String(lastArticle(o)?.CC ?? ''),
  };
}

export async function getWorkItem(wid: number): Promise<PortalWorkItem> {
  const r = await portalCall<any>('Ticket', 'GetTfsWorkItem', 'TicketManagement', { TfsCollection: WORK_ITEM_COLLECTION, WorkItemId: wid });
  const w = r?.WorkItem;
  const s = (v: unknown) => (typeof v === 'string' && v ? v : null);
  return { id: wid, title: w ? String(w.Description ?? '') : null, type: w ? s(w.WorkItemType) : null, state: w ? s(w.State) : null };
}

// ---- the action ---------------------------------------------------------------------------------------------------

interface Built { service: string; method: string; input: Record<string, unknown>; summary: string; auditDetail: Record<string, unknown> }

async function build(id: string, req: PortalActionRequest, o: any): Promise<Built> {
  const t = o.Ticket;
  switch (req.action) {
    case 'assign-to-me':
      return { service: 'Ticket', method: 'AssignTicketToCurrentUser', input: { TicketId: id }, summary: 'Assigned to you', auditDetail: {} };

    case 'state': {
      const d = refResolver(o), cms = d(t.CurrentMainState);
      const model = await stateModel(String(d(cms?.StateModel)?.Name ?? ''));
      const current = String(d(cms?.CurrentState)?.Name ?? t.State ?? '');
      if (!reachable(model, current).includes(req.to)) throw new PortalActionError(`Cannot move from ${current} to ${req.to}`);
      const target = model.states.find((s) => s.name === req.to);
      if (!target) throw new PortalActionError(`Unknown state ${req.to}`);
      let reason: string | null = null;
      let comments: string | undefined;
      if (req.to === 'Closed') {
        const allowed = closeReasonsFor(await closeReasonValues(), String(t.OpenReason ?? '')).map((r) => r.value);
        if (!req.reason || !allowed.includes(req.reason)) throw new PortalActionError('Choose a close reason');
        reason = req.reason;
        if (reason.toUpperCase() === 'OTHER') {
          if (!req.comment?.trim()) throw new PortalActionError('Close reason "Other" needs a comment');
          comments = req.comment.trim();
        }
      }
      const input: Record<string, unknown> = { TicketId: id, StateId: target.id, Reason: reason };
      if (comments) input.ServiceComments = comments;
      return {
        service: 'Ticket', method: 'ChangeTicketState', input,
        summary: `State ${current} → ${req.to}${reason ? ` (${reason})` : ''}`,
        auditDetail: { from: current, to: req.to, reason, comment: comments ?? null },
      };
    }

    case 'reply': {
      const text = String(req.text ?? '').trim();
      if (!text) throw new PortalActionError('Write a message first');
      if (text.length > 20_000) throw new PortalActionError('Message too long');
      const last = lastArticle(o);
      const me = signedInAccount();
      if (!me) throw new PortalActionError('Unknown signed-in user; sign in again');
      const minutes = Math.max(0, Math.min(24 * 60, Math.round(Number(req.timeSpent ?? 0)) || 0));
      const article: Record<string, unknown> = {
        $type: bo('Article'),
        Ticket: t,
        TimeSpent: minutes,
        Body: textToHtml(text),
        From: me,
        To: last ? emailOf(String(last.From ?? '')) : '',
        CC: req.kind === 'internal-note' ? '' : String(last?.CC ?? ''),
      };
      if (req.kind === 'public-note') article.Type = 'Public Note';
      if (req.kind === 'internal-note') article.Type = 'Internal Note';
      const label = req.kind === 'reply' ? 'Reply' : req.kind === 'public-note' ? 'Public note' : 'Internal note';
      return {
        service: 'Ticket', method: 'ReplyToTicket',
        input: { Article: article, Attachments: [], IncludeExternalAttachments: true },
        summary: `${label} sent${req.kind === 'internal-note' ? '' : ` to ${article.To || 'the requester'}`}`,
        auditDetail: { kind: req.kind, to: article.To, cc: article.CC, timeSpent: minutes, chars: text.length, snippet: plain(text).slice(0, 120) },
      };
    }

    case 'link-work-items': {
      const ids = [...new Set((req.ids ?? []).map(Number))].filter((n) => Number.isInteger(n) && n > 0);
      if (!ids.length) throw new PortalActionError('Give at least one work item id');
      const existing = existingWorkItems(t, refResolver(o));
      const add = ids.filter((n) => !existing.some((e) => e.wid === String(n) && e.collection === WORK_ITEM_COLLECTION));
      if (!add.length) throw new PortalActionError('Those work items are already linked');
      for (const n of add) {
        const w = await getWorkItem(n);
        if (w.title === null) throw new PortalActionError(`Work item ${n} not found in TFS (${WORK_ITEM_COLLECTION})`);
      }
      const rel = (w: { wid: string; collection: string; project: string }) => ({
        $type: bo('TicketWorkItem'),
        SourceEntity: { $type: bo('Ticket'), Id: t.Id, Name: t.Name },
        TargetEntity: { $type: bo('WorkItem'), Name: `${w.collection}-${w.wid}`, WId: w.wid, Collection: w.collection, Project: w.project },
      });
      const all = [...existing, ...add.map((n) => ({ wid: String(n), collection: WORK_ITEM_COLLECTION, project: WORK_ITEM_PROJECT }))];
      const tags = tagRelations(t).map((r) => ({ ...r, $type: r.$type ?? bo('TicketTag') }));
      return {
        service: 'Ticket', method: 'FullUpdateTicket',
        input: { Ticket: t, Relations: [...all.map(rel), ...tags] },
        summary: `Linked work item${add.length === 1 ? '' : 's'} ${add.map((n) => '#' + n).join(', ')}`,
        auditDetail: { added: add, kept: existing.map((e) => Number(e.wid)) },
      };
    }
  }
  throw new PortalActionError('Unknown action');
}

/** Preview of the input for dry runs (the ticket itself is elided). */
function preview(b: Built): Record<string, unknown> {
  return JSON.parse(JSON.stringify(b.input, (k, v) => (k === 'Ticket' && v && typeof v === 'object' ? `<ticket ${v.Id ?? ''}>` : v)));
}

export async function runAction(id: string, req: PortalActionRequest, dryRun: boolean, auditPath = defaultAuditPath()): Promise<PortalActionResult> {
  if (!validTicketId(id)) throw new PortalActionError('Invalid ticket id');
  const o = await rawTicket(id);
  const modifiedOn = String(o.Ticket.ModifiedOn ?? '');
  if (!req.expectedModifiedOn || req.expectedModifiedOn !== modifiedOn) {
    throw new PortalConflictError(`Ticket ${id} changed in the portal since you loaded it (by ${o.Ticket.ModifiedBy ?? 'someone'}, ${modifiedOn}). Reload it and try again.`);
  }
  const b = await build(id, req, o);
  if (dryRun) return { ok: true, dryRun: true, summary: b.summary, request: { service: `${b.service}/${b.method}`, input: preview(b) } };

  const entry = { ts: new Date().toISOString(), kind: 'portal', ticket: id, action: req.action, ...b.auditDetail };
  try {
    await portalCall<any>(b.service, b.method, 'TicketManagement', b.input);
  } catch (e) {
    audit(auditPath, { ...entry, ok: false, error: (e as Error).message });
    throw e;
  }
  audit(auditPath, { ...entry, ok: true, error: null });
  invalidateList();
  let details;
  try {
    details = await getTicketDetails(id);
  } catch {
    details = undefined;
  }
  return { ok: true, dryRun: false, summary: b.summary, details };
}
