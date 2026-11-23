import type { TfsApi } from '../tfs/client.js';
import type { AppConfig, PrRef } from '../types.js';

export interface PrResolution { prs: PrRef[]; prOpen: number; prError?: string }

const MAX_IN_FLIGHT = 8;
const cache = new Map<string, any>();

export function clearPrCache(): void { cache.clear(); }

/** Pull-request links of a work item's relations, deduped by repo + id. */
export function prLinks(relations: any[]): { repoId: string; id: number }[] {
  const seen = new Set<string>();
  const out: { repoId: string; id: number }[] = [];
  for (const r of relations ?? []) {
    if (r?.rel !== 'ArtifactLink' || typeof r.url !== 'string') continue;
    const m = /^vstfs:\/\/\/Git\/PullRequestId\/([^/%]+)%2F([^/%]+)%2F(\d+)$/i.exec(r.url);
    if (!m) continue;
    const key = `${m[2].toLowerCase()}/${m[3]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ repoId: m[2], id: Number(m[3]) });
  }
  return out;
}

/** Version a target branch delivers to, or null when it is not a version branch. */
export function versionOf(targetRef: string): string | null {
  const b = (targetRef ?? '').replace(/^refs\/heads\//, '');
  let m = /^(\d+\.\d+(?:\.\d+)?)\/dev$/.exec(b);
  if (m) return m[1];
  m = /^(\d+\.\d+)\/(\d+)\/[^/]+$/.exec(b);
  if (m) return `${m[1]}.${m[2]}`;
  return null;
}

function cmpVersion(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pb[i] ?? -1) - (pa[i] ?? -1);
    if (d) return d;
  }
  return 0;
}

export async function resolvePrs(
  client: TfsApi,
  relationsById: Map<number, any[]>,
  cfg: AppConfig,
): Promise<Map<number, PrResolution>> {
  if (!client.getPullRequest) throw new Error('Pull request lookup is not supported by this client');
  const getPr = client.getPullRequest.bind(client);
  const linksById = new Map<number, { repoId: string; id: number }[]>();
  const todo = new Map<string, { repoId: string; id: number }>();
  for (const [wid, rels] of relationsById) {
    const links = prLinks(rels);
    linksById.set(wid, links);
    for (const l of links) {
      const k = `${l.repoId.toLowerCase()}/${l.id}`;
      const hit = cache.get(k);
      if (!(hit && (hit.status === 'completed' || hit.status === 'abandoned'))) todo.set(k, l);
    }
  }

  const fetched = new Map<string, any>(); // this call's results (also covers active PRs)
  const failed = new Set<string>();
  const queue = [...todo.entries()];
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const [k, l] = next;
      try {
        const pr = await getPr(l.repoId, l.id);
        fetched.set(k, pr);
        if (pr?.status === 'completed' || pr?.status === 'abandoned') cache.set(k, pr);
      } catch {
        failed.add(k);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_IN_FLIGHT, queue.length) }, worker));

  const base = `${cfg.tfs.serverUrl}/${cfg.tfs.collection}/${cfg.tfs.project}`;
  const result = new Map<number, PrResolution>();
  for (const [wid, links] of linksById) {
    const prs: PrRef[] = [];
    let prOpen = 0;
    let bad = 0;
    for (const l of links) {
      const k = `${l.repoId.toLowerCase()}/${l.id}`;
      if (failed.has(k)) { bad++; continue; }
      const pr = fetched.get(k) ?? cache.get(k);
      if (!pr) { bad++; continue; }
      if (pr.status === 'active') prOpen++;
      else if (pr.status === 'completed') {
        const target = String(pr.targetRefName ?? '').replace(/^refs\/heads\//, '');
        const repo = pr.repository?.name ?? '';
        prs.push({
          id: l.id, repo, target, version: versionOf(target),
          url: `${base}/_git/${encodeURIComponent(repo)}/pullrequest/${l.id}`,
          closedDate: pr.closedDate ?? '',
        });
      }
    }
    prs.sort((a, b) => cmpVersion(a.version, b.version) || a.id - b.id);
    result.set(wid, { prs, prOpen, ...(bad ? { prError: `${bad} PR${bad > 1 ? 's' : ''} could not be read` } : {}) });
  }
  return result;
}

/** Attach PR info to items; any failure leaves prs undefined (unknown) and the list still loads. */
export async function attachPrs<T extends { id: number; prs?: PrRef[]; prOpen?: number; prError?: string }>(
  c: TfsApi, items: T[], cfg: AppConfig,
): Promise<void> {
  if (!items.length) return;
  try {
    if (!c.getRelations) throw new Error('Relations lookup is not supported by this client');
    const rels = await c.getRelations(items.map(i => i.id));
    const res = await resolvePrs(c, rels, cfg);
    for (const it of items) {
      const r = res.get(it.id);
      it.prs = r?.prs ?? [];
      it.prOpen = r?.prOpen ?? 0;
      if (r?.prError) it.prError = r.prError;
    }
  } catch (e) {
    console.warn(`Pull request lookup failed: ${(e as Error).message}`);
  }
}
