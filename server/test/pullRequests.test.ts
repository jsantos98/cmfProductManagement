import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { attachPrs, clearPrCache, prLinks, resolvePrs, versionOf } from '../src/backlog/pullRequests.js';
import type { TfsApi } from '../src/tfs/client.js';
import type { AppConfig } from '../src/types.js';

const cfg = JSON.parse(readFileSync(new URL('../../config/default.json', import.meta.url), 'utf8')) as AppConfig;

const link = (repo: string, id: number, sep = '%2F') => ({
  rel: 'ArtifactLink', url: `vstfs:///Git/PullRequestId/proj${sep}${repo}${sep}${id}`, attributes: { name: 'Pull Request' },
});

class Fake implements TfsApi {
  fetches: string[] = [];
  prs = new Map<number, any>();
  failIds = new Set<number>();
  async wiql() { return []; }
  async getItems() { return []; }
  async patch(): Promise<any> { throw new Error('no'); }
  async getPullRequest(repoId: string, id: number) {
    this.fetches.push(`${repoId}/${id}`);
    if (this.failIds.has(id)) throw new Error('boom');
    return this.prs.get(id);
  }
}
const pr = (status: string, target: string, closedDate = '2026-01-01T00:00:00Z') =>
  ({ status, targetRefName: `refs/heads/${target}`, repository: { name: 'Product' }, closedDate });

beforeEach(() => clearPrCache());

describe('prLinks', () => {
  it('parses upper and lower case %2F, dedupes, ignores other relations', () => {
    const rels = [link('r1', 5), link('r1', 5, '%2f'), link('r2', 6, '%2f'),
      { rel: 'ArtifactLink', url: 'vstfs:///Git/Commit/a%2Fb%2Fc' }, { rel: 'Hyperlink', url: 'http://x' }];
    expect(prLinks(rels)).toEqual([{ repoId: 'r1', id: 5 }, { repoId: 'r2', id: 6 }]);
  });
});

describe('versionOf', () => {
  it.each([
    ['refs/heads/12.1/dev', '12.1'], ['12.0/dev', '12.0'], ['11.3/dev', '11.3'], ['11.1/dev', '11.1'],
    ['12.0/0/beta', '12.0.0'], ['12.0/1/beta', '12.0.1'], ['11.3/7/beta', '11.3.7'],
    ['12.1/feat/137986-nativeAlarmSupport', null], ['development', null], ['dev', null],
  ])('%s -> %s', (t, v) => expect(versionOf(t)).toBe(v));
});

describe('resolvePrs', () => {
  it('keeps completed, counts active, ignores abandoned, sorts by version desc', async () => {
    const c = new Fake();
    c.prs.set(1, pr('completed', '11.3/dev'));
    c.prs.set(2, pr('completed', '12.1/dev'));
    c.prs.set(3, pr('active', '12.1/dev'));
    c.prs.set(4, pr('abandoned', '12.1/dev'));
    c.prs.set(5, pr('completed', 'development'));
    const r = await resolvePrs(c, new Map([[10, [1, 2, 3, 4, 5].map(i => link('r', i))]]), cfg);
    const x = r.get(10)!;
    expect(x.prs.map(p => p.id)).toEqual([2, 1, 5]);
    expect(x.prs[0]).toMatchObject({ repo: 'Product', target: '12.1/dev', version: '12.1', closedDate: '2026-01-01T00:00:00Z' });
    expect(x.prs[0].url).toBe(`${cfg.tfs.serverUrl}/${cfg.tfs.collection}/${cfg.tfs.project}/_git/Product/pullrequest/2`);
    expect(x.prOpen).toBe(1);
    expect(x.prError).toBeUndefined();
  });

  it('caches completed PRs but re-reads active ones', async () => {
    const c = new Fake();
    c.prs.set(1, pr('completed', '12.0/dev'));
    c.prs.set(2, pr('active', '12.0/dev'));
    const rels = new Map([[10, [link('r', 1), link('r', 2)]]]);
    await resolvePrs(c, rels, cfg);
    await resolvePrs(c, rels, cfg);
    expect(c.fetches.filter(f => f === 'r/1')).toHaveLength(1);
    expect(c.fetches.filter(f => f === 'r/2')).toHaveLength(2);
  });

  it('reports prError for a failed fetch and does not cache it', async () => {
    const c = new Fake();
    c.prs.set(1, pr('completed', '12.0/dev'));
    c.prs.set(2, pr('completed', '12.0/dev'));
    c.failIds.add(2);
    const rels = new Map([[10, [link('r', 1), link('r', 2)]]]);
    const r = await resolvePrs(c, rels, cfg);
    expect(r.get(10)!.prs.map(p => p.id)).toEqual([1]);
    expect(r.get(10)!.prError).toBe('1 PR could not be read');
    c.failIds.clear();
    const r2 = await resolvePrs(c, rels, cfg);
    expect(r2.get(10)!.prs.map(p => p.id)).toEqual([1, 2]);
    expect(r2.get(10)!.prError).toBeUndefined();
  });

  it('limits concurrency to 8', async () => {
    const c = new Fake();
    let cur = 0, max = 0;
    c.getPullRequest = async () => { cur++; max = Math.max(max, cur); await new Promise(r => setTimeout(r, 2)); cur--; return pr('completed', '12.0/dev'); };
    await resolvePrs(c, new Map([[1, Array.from({ length: 30 }, (_, i) => link('r', i + 1))]]), cfg);
    expect(max).toBeLessThanOrEqual(8);
  });
});

describe('attachPrs', () => {
  const items = () => [{ id: 1 } as any, { id: 2 } as any];

  it('leaves prs undefined when relations cannot be read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const c = new Fake() as Fake & TfsApi;
    c.getRelations = async () => { throw new Error('down'); };
    const it = items();
    await attachPrs(c, it, cfg);
    expect(it.every(i => i.prs === undefined)).toBe(true);
    warn.mockRestore();
  });

  it('leaves prs undefined when the client has no relations support', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const it = items();
    await attachPrs(new Fake(), it, cfg);
    expect(it.every(i => i.prs === undefined)).toBe(true);
    warn.mockRestore();
  });

  it('sets prs on every item; an item missing from the map gets []', async () => {
    const c = new Fake() as Fake & TfsApi;
    c.prs.set(1, pr('completed', '12.0/dev'));
    c.getRelations = async () => new Map([[1, [link('r', 1)]]]);
    const it = items();
    await attachPrs(c, it, cfg);
    expect(it[0].prs).toHaveLength(1);
    expect(it[1]).toMatchObject({ prs: [], prOpen: 0 });
  });
});
