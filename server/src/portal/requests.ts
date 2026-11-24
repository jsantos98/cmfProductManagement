// Customer Portal enhancement requests: open tickets of the configured request type, suggested by keyword, plus the
// tickets João pins. Pins and dismissals are local (data/portal-pins.json); nothing here writes to the portal.
import fs from 'node:fs';
import path from 'node:path';
import { getConfig, repoRoot } from '../config.js';
import type { PortalArticle, PortalConfig, PortalRequestsResponse, PortalTicketDetails, PortalTicketRow } from '../types.js';
import { portalCall } from './client.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---- pure helpers -------------------------------------------------------------------------------------------------

const ENT: Record<string, string> = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
/** Plain text of (possibly HTML) ticket text. */
export const plain = (s: unknown): string =>
  String(s ?? '').replace(/<[^>]*>/g, ' ').replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (m) => ENT[m]).replace(/\s+/g, ' ').trim();

const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Configured keywords found as whole words/phrases (case-insensitive) in the text, in config order. */
export function matchKeywords(text: string, keywords: string[]): string[] {
  const out: string[] = [];
  for (const k of keywords) {
    const kw = k.trim();
    if (!kw || out.includes(kw)) continue;
    if (new RegExp(`(^|[^A-Za-z0-9])${reEsc(kw)}($|[^A-Za-z0-9])`, 'i').test(text)) out.push(kw);
  }
  return out;
}

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
export const ticketUrl = (baseUrl: string, id: string) => `${baseUrl}/Entity/Ticket/${id}`;

/** Row of GetTicketsByFilter (camelCase fields). */
export function rowFromList(r: any, cfg: Pick<PortalConfig, 'baseUrl' | 'keywords'>, pinned: boolean): PortalTicketRow {
  const id = str(r.id);
  return {
    id,
    title: str(r.title),
    priority: str(r.priority),
    state: str(r.state || r.mainStateModelStateName),
    status: str(r.status),
    customer: str(r.customerName),
    site: str(r.siteName),
    context: str(r.context),
    requester: str(r.userName || r.userCustomerName),
    ownerRole: str(r.escalationStateModelStateRoleName),
    agent: str(r.ownerName),
    replies: num(r.numberOfReplies),
    workItems: num(r.numberOfWorkItems),
    createdOn: str(r.createdOn),
    modifiedOn: str(r.modifiedOn),
    slaDueDate: str(r.sLADueDate),
    lastReplyOn: str(r.lastReplyOn),
    lastReplyBy: null,
    lastReplyRole: null,
    waitingForSupport: null,
    matches: matchKeywords(`${str(r.title)} ${plain(r.body)}`, cfg.keywords),
    pinned,
    url: ticketUrl(cfg.baseUrl, id),
  };
}

/** Articles table (Table + Table_Columns) of GetTicketDetails, oldest first. */
export function articlesOf(a: any): PortalArticle[] {
  const rows: any[] = Array.isArray(a?.Table) ? a.Table : [];
  return rows
    .map((x) => ({ id: str(x.ArticleId || x.Name), from: str(x.From || x.CreatedBy), to: str(x.To), createdOn: str(x.CreatedOn), type: str(x.Type), html: str(x.Body) }))
    .sort((x, y) => Date.parse(x.createdOn) - Date.parse(y.createdOn));
}

/** Details of GetTicketDetails (PascalCase Ticket). */
export function detailsFromOutput(o: any, cfg: Pick<PortalConfig, 'baseUrl' | 'keywords'>, pinned: boolean): PortalTicketDetails {
  const t = o?.Ticket ?? {};
  const articles = articlesOf(o?.Articles);
  const id = str(t.Id || t.Name);
  const firstBody = articles[0] ? plain(articles[0].html) : '';
  const ticket: PortalTicketRow = {
    id,
    title: str(t.Title),
    priority: str(t.Priority),
    state: str(t.CurrentMainState?.CurrentState?.Name || t.State),
    status: str(t.Status),
    customer: str(t.Site?.Customer?.Name),
    site: str(t.Site?.Name || t.DataGroupName),
    context: str(t.TicketContext?.Name),
    requester: str(t.User?.User?.Name || t.User?.Name || t.CreatedBy),
    ownerRole: str(t.EscalationStateModelStateRoleName),
    agent: str(t.Agent?.User?.Name || t.Agent?.Name),
    replies: Math.max(0, articles.length - 1),
    workItems: 0,
    createdOn: str(t.CreatedOn),
    modifiedOn: str(t.ModifiedOn),
    slaDueDate: str(t.SLADueDate),
    lastReplyOn: str(t.LastReplyOn),
    lastReplyBy: t.LastReplyBy ? str(t.LastReplyBy) : null,
    lastReplyRole: t.LastReplyRole ? str(t.LastReplyRole) : null,
    waitingForSupport: typeof t.WaitingForSupport === 'boolean' ? t.WaitingForSupport : null,
    matches: matchKeywords(`${str(t.Title)} ${firstBody}`, cfg.keywords),
    pinned,
    url: ticketUrl(cfg.baseUrl, id),
  };
  return { ticket, stateModel: str(t.CurrentMainState?.StateModel?.Name), slaStartDate: str(t.SLAStartDate), createdBy: str(t.CreatedBy), articles };
}

/** Pinned rows keep list numbers (replies, work items) and gain the details-only fields. */
export function mergePinned(fromDetails: PortalTicketRow, fromList: PortalTicketRow | undefined): PortalTicketRow {
  if (!fromList) return fromDetails;
  const out = { ...fromList } as Record<string, unknown>;
  for (const [k, v] of Object.entries(fromDetails)) if (v !== '' && v !== null && v !== undefined) out[k] = v;
  const row = out as unknown as PortalTicketRow;
  return { ...row, replies: fromList.replies, workItems: fromList.workItems, matches: fromList.matches.length ? fromList.matches : fromDetails.matches };
}

/** Suggestions: open rows of the ownership role ('' = any) with a keyword match, not pinned/dismissed; newest first. */
export function suggestionsOf(rows: PortalTicketRow[], ownershipRole: string, pins: Set<string>, dismissed: Set<string>): PortalTicketRow[] {
  return rows
    .filter((r) => (!ownershipRole || r.ownerRole === ownershipRole) && r.matches.length > 0 && !pins.has(r.id) && !dismissed.has(r.id))
    .sort((a, b) => Date.parse(b.createdOn || '0') - Date.parse(a.createdOn || '0'));
}

// ---- local store (pins, dismissals) -------------------------------------------------------------------------------

interface PinStore { pins: Record<string, string>; dismissed: Record<string, string> }
let storeFile = path.join(repoRoot, 'data', 'portal-pins.json');
/** Test hook. */
export function setPinsPath(p: string): void { storeFile = p; }

export function readStore(): PinStore {
  try {
    const o = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
    const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, string>) : {});
    return { pins: obj(o?.pins), dismissed: obj(o?.dismissed) };
  } catch {
    return { pins: {}, dismissed: {} };
  }
}
function writeStore(s: PinStore): void {
  fs.mkdirSync(path.dirname(storeFile), { recursive: true });
  const tmp = storeFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
  fs.renameSync(tmp, storeFile);
}
export const validTicketId = (id: string) => /^\d{10,25}$/.test(id);

export function setPin(id: string, on: boolean): void {
  const s = readStore();
  if (on) { s.pins[id] = new Date().toISOString(); delete s.dismissed[id]; } else delete s.pins[id];
  writeStore(s);
  listCache = null;
}
export function setDismissed(id: string, on: boolean): void {
  const s = readStore();
  if (on) { s.dismissed[id] = new Date().toISOString(); delete s.pins[id]; } else delete s.dismissed[id];
  writeStore(s);
  listCache = null;
}

// ---- portal reads -------------------------------------------------------------------------------------------------

const F = (Name: string, Value: unknown) => ({ $type: 'Cmf.Foundation.BusinessObjects.QueryObject.Filter, Cmf.Foundation.BusinessObjects', Name, Value });
const PAGE = 200;
const LIST_TTL = 2 * 60_000;
let listCache: { at: number; rows: any[] } | null = null;

/** Every open ticket of the request type (all ownership roles), paged. */
async function openTickets(refresh: boolean): Promise<any[]> {
  if (!refresh && listCache && Date.now() - listCache.at < LIST_TTL) return listCache.rows;
  const c = getConfig().portal;
  const rows: any[] = [];
  for (let page = 1; page <= 10; page++) {
    const r = await portalCall<any>('Ticket', 'GetTicketsByFilter', 'TicketManagement', {
      TicketsView: 1, TicketsSortingCriteria: 1, TicketsSortingMode: 1,
      Filters: [F('State', c.openStates), F('OpenReason', c.requestType)],
      PageNumber: page, PageSize: PAGE,
    });
    const batch: any[] = Array.isArray(r?.Results?.T_Result) ? r.Results.T_Result : [];
    rows.push(...batch);
    const total = num(batch[0]?.totalRows ?? r?.TotalRows);
    if (batch.length < PAGE || rows.length >= total) break;
  }
  listCache = { at: Date.now(), rows };
  return rows;
}

async function rawDetails(id: string): Promise<any> {
  return portalCall<any>('Ticket', 'GetTicketDetails', 'TicketManagement', { TicketId: id, IncludeArticles: true, IncludeExternalAttachments: true });
}

export async function getTicketDetails(id: string): Promise<PortalTicketDetails> {
  const c = getConfig().portal;
  const d = detailsFromOutput(await rawDetails(id), c, id in readStore().pins);
  const listed = listCache?.rows.find((r) => str(r.id) === id);
  if (listed) d.ticket = mergePinned(d.ticket, rowFromList(listed, c, d.ticket.pinned));
  return d;
}

export async function getRequests(refresh: boolean): Promise<PortalRequestsResponse> {
  const c = getConfig().portal;
  const store = readStore();
  const pins = new Set(Object.keys(store.pins));
  const dismissed = new Set(Object.keys(store.dismissed));
  const raw = await openTickets(refresh);
  const rows = raw.map((r) => rowFromList(r, c, pins.has(str(r.id))));
  const byId = new Map(rows.map((r) => [r.id, r]));

  const errors: { id: string; error: string }[] = [];
  const pinned = (
    await Promise.all(
      [...pins].map(async (id) => {
        try {
          return mergePinned(detailsFromOutput(await rawDetails(id), c, true).ticket, byId.get(id));
        } catch (e) {
          errors.push({ id, error: (e as Error).message });
          return byId.get(id) ?? null;
        }
      }),
    )
  ).filter((r): r is PortalTicketRow => r !== null);
  pinned.sort((a, b) => Date.parse(b.lastReplyOn || b.modifiedOn || '0') - Date.parse(a.lastReplyOn || a.modifiedOn || '0'));

  return {
    pinned,
    suggestions: suggestionsOf(rows, c.ownershipRole, pins, dismissed),
    openTotal: rows.length,
    dismissed: dismissed.size,
    errors,
    loadedAt: new Date().toISOString(),
  };
}
