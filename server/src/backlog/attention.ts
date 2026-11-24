import fs from 'node:fs';
import path from 'node:path';
import { effectiveWiql, getBacklogDef, getConfig, repoRoot } from '../config.js';
import type { TfsClient } from '../tfs/client.js';
import type { AttentionEntry, AttentionResponse } from '../types.js';

export interface RawComment {
  text?: string;
  createdDate?: string;
  createdBy?: { id?: string; displayName?: string; uniqueName?: string };
  mentions?: { artifactType?: string; artifactId?: string }[];
}

const same = (a: unknown, b: unknown): boolean => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();
const time = (d: unknown): number => { const t = Date.parse(String(d ?? '')); return Number.isNaN(t) ? 0 : t; };

export function rawComments(payload: any): RawComment[] {
  return Array.isArray(payload?.comments) ? payload.comments : [];
}

export function mentionsPerson(c: RawComment, meId: string): boolean {
  return (c.mentions ?? []).some(m => same(m?.artifactType, 'Person') && same(m?.artifactId, meId));
}

const ENTITIES: Record<string, string> = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };

function snippetOf(html: string): string {
  const t = html.replace(/<[^>]*>/g, ' ').replace(/&(nbsp|amp|lt|gt|quot|#39);/g, m => ENTITIES[m]).replace(/\s+/g, ' ').trim();
  return t.length > 140 ? t.slice(0, 139).trimEnd() + '…' : t;
}

/** Comments by others that @mention me and are newer than my latest comment and the local ack. */
export function waitingFor(comments: RawComment[], meId: string, ackDate?: string):
  { count: number; lastAuthor: string; lastDate: string; snippet: string } | null {
  let myLast = 0;
  for (const c of comments) if (same(c.createdBy?.id, meId)) myLast = Math.max(myLast, time(c.createdDate));
  const ack = ackDate ? time(ackDate) : 0;
  const waiting = comments.filter(c => !same(c.createdBy?.id, meId) && time(c.createdDate) > myLast && time(c.createdDate) > ack && mentionsPerson(c, meId));
  if (!waiting.length) return null;
  const last = waiting.reduce((a, b) => (time(b.createdDate) > time(a.createdDate) ? b : a));
  return { count: waiting.length, lastAuthor: last.createdBy?.displayName ?? '', lastDate: String(last.createdDate ?? ''), snippet: snippetOf(String(last.text ?? '')) };
}

// ---- ack store ----
let acksFile = path.join(repoRoot, 'data', 'attention-acks.json');
/** Test hook: point the store at another file. */
export function setAcksPath(p: string): void { acksFile = p; }

export function readAcks(): Record<string, string> {
  try {
    const o = JSON.parse(fs.readFileSync(acksFile, 'utf8'));
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch { return {}; }
}

function writeAcks(o: Record<string, string>): void {
  fs.mkdirSync(path.dirname(acksFile), { recursive: true });
  fs.writeFileSync(acksFile, JSON.stringify(o, null, 2));
}

export function ackAttention(id: number): string {
  const acks = readAcks();
  const now = new Date().toISOString();
  acks[String(id)] = now;
  writeAcks(acks);
  return now;
}

export function unackAttention(id: number): void {
  const acks = readAcks();
  delete acks[String(id)];
  writeAcks(acks);
}

// ---- per-backlog scan ----
const commentCache = new Map<number, { key: string; comments: RawComment[] }>();

/**
 * Scans one backlog for comments waiting for me. Runs the backlog's WIQL and reads Rev/CommentCount fresh
 * from TFS on every call (two cheap calls), so new comments are seen even when the backlog cache is old;
 * comments themselves are refetched only for items whose rev or comment count changed.
 */
export async function getAttention(backlogId: string, view?: 'validate'): Promise<AttentionResponse> {
  const def = getBacklogDef(backlogId);
  if (!def) throw new Error(`Unknown backlog ${backlogId}`);
  const cfg = getConfig();
  if (view !== 'validate') return scanAttention(backlogId, effectiveWiql(def, cfg));
  // imported lazily: validation.ts imports this module
  const { validationIds } = await import('./validation.js');
  return scanAttention(backlogId, async (client) => (await validationIds(client, def, cfg)).ids);
}

/** Scan the items returned by a WIQL (or an id lookup) for comments waiting for me (shared comment cache and acks). */
export async function scanAttention(backlogId: string, query: string | ((client: TfsClient) => Promise<number[]>)): Promise<AttentionResponse> {
  // imported lazily: service.ts imports this module
  const { getMe, getClient } = await import('./service.js');
  const client = getClient() as TfsClient;
  const me = await getMe();
  const ids = typeof query === 'string' ? await client.wiql(query) : await query(client);
  const fresh = ids.length ? await client.getItems(ids, ['System.Rev', 'System.CommentCount']) : [];
  const todo = fresh
    .map(r => ({ id: r.id, rev: r.rev, commentCount: Number(r.fields['System.CommentCount'] ?? 0) }))
    .filter(i => i.commentCount > 0);
  const acks = readAcks();
  const out: AttentionEntry[] = [];
  let errors = 0;
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < todo.length) {
      const it = todo[next++];
      const key = `${it.rev}:${it.commentCount}`;
      let comments = commentCache.get(it.id)?.key === key ? commentCache.get(it.id)!.comments : undefined;
      if (!comments) {
        try {
          comments = rawComments(await client.getComments(it.id, 100));
          commentCache.set(it.id, { key, comments });
        } catch { errors++; continue; }
      }
      const ackedAt = acks[String(it.id)];
      const w = waitingFor(comments, me.id, ackedAt);
      if (w) out.push({ id: it.id, ...w, ...(ackedAt ? { acked: ackedAt } : {}) });
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, todo.length) }, worker));
  out.sort((a, b) => time(b.lastDate) - time(a.lastDate));
  return { backlogId, items: out, errors, loadedAt: new Date().toISOString() };
}
