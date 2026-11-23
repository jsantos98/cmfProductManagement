import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { fillArea } from '../src/config.js';
import { transition, type TransitionDeps } from '../src/backlog/validation.js';
import { toBacklogItem } from '../src/backlog/derive.js';
import type { PatchOp, RawItem, TfsApi } from '../src/tfs/client.js';
import type { AppConfig, ValidationItem } from '../src/types.js';

const cfg = JSON.parse(readFileSync(new URL('../../config/default.json', import.meta.url), 'utf8')) as AppConfig;

interface Call { id: number; ops: PatchOp[]; validateOnly: boolean }
class FakeClient implements TfsApi {
  calls: Call[] = [];
  constructor(private failValidate = new Set<number>(), private failWrite = new Set<number>()) {}
  async wiql() { return []; }
  async getItems() { return []; }
  async patch(id: number, ops: PatchOp[], opts: { validateOnly?: boolean } = {}): Promise<RawItem> {
    const validateOnly = !!opts.validateOnly;
    this.calls.push({ id, ops, validateOnly });
    if (validateOnly && this.failValidate.has(id)) throw new Error('TFS HTTP 400: invalid transition');
    if (!validateOnly && this.failWrite.has(id)) throw new Error('TFS HTTP 409: rev mismatch');
    return { id, rev: 21, fields: {} };
  }
}

let store: Map<number, ValidationItem>;
let auditPath: string;
let applied: { ids: number[]; action: string }[];
const types: Record<number, string> = { 1: 'Bug', 2: 'User Story', 3: 'Task' };

const run = (c: FakeClient, req: Parameters<typeof transition>[1], dryRun = false) => {
  const deps: TransitionDeps = { client: c, cfg, auditPath, getItem: id => store.get(id), afterApplied: (ids, action) => { applied.push({ ids, action }); } };
  return transition('connect-iot', req, dryRun, deps);
};
const writes = (c: FakeClient) => c.calls.filter(x => !x.validateOnly);
const req = (action: 'close' | 'reject', ids = [1], comment?: string) => ({ action, comment, items: ids.map(id => ({ id, rev: 20 })) });

beforeEach(() => {
  applied = [];
  store = new Map([1, 2, 3].map(id => [id, {
    ...toBacklogItem({ id, rev: 20, fields: { 'System.WorkItemType': types[id], 'System.Title': `t${id}` } }, cfg),
    resolvedDate: '', resolvedBy: '', resolvedReason: '',
  }]));
  auditPath = path.join(mkdtempSync(path.join(tmpdir(), 'cmfpm-')), 'data', 'changes.jsonl');
});

describe('fillArea', () => {
  it('substitutes every placeholder and escapes single quotes', () => {
    expect(fillArea("A '{{areaPath}}' B '{{areaPath}}'", "Prod\O'Neil")).toBe("A 'Prod\O''Neil' B 'Prod\O''Neil'");
  });
});

describe('transition', () => {
  it('uses the configured reason per type and Closed/Active state', async () => {
    const c = new FakeClient();
    await run(c, req('close', [1, 2]));
    await run(c, req('reject', [1, 2]));
    const w = writes(c);
    expect(w[0].ops).toContainEqual({ op: 'add', path: '/fields/System.State', value: 'Closed' });
    expect(w[0].ops).toContainEqual({ op: 'add', path: '/fields/System.Reason', value: 'Verified' });
    expect(w[1].ops).toContainEqual({ op: 'add', path: '/fields/System.Reason', value: 'Acceptance tests pass' });
    expect(w[2].ops).toContainEqual({ op: 'add', path: '/fields/System.State', value: 'Active' });
    expect(w[2].ops).toContainEqual({ op: 'add', path: '/fields/System.Reason', value: 'Test Failed' });
    expect(w[3].ops).toContainEqual({ op: 'add', path: '/fields/System.Reason', value: 'Acceptance tests fail' });
  });

  it('errors for a type without a configured reason, and for an unknown id, without calling TFS', async () => {
    const c = new FakeClient();
    const r = await run(c, req('close', [3, 99]));
    expect(r.phase).toBe('validation');
    expect(r.results[0]).toMatchObject({ id: 3, ok: false, error: 'No close reason configured for Task' });
    expect(r.results[1]).toMatchObject({ id: 99, ok: false });
    expect(c.calls).toHaveLength(0);
  });

  it('sends test /rev first and History only when a comment is given, HTML-escaped', async () => {
    const c = new FakeClient();
    await run(c, req('reject', [1], '  <b>&"\'\nline2  '));
    await run(c, req('reject', [2], '   '));
    for (const call of c.calls) expect(call.ops[0]).toEqual({ op: 'test', path: '/rev', value: 20 });
    const withC = writes(c)[0].ops.find(o => o.path === '/fields/System.History');
    expect(withC).toEqual({ op: 'add', path: '/fields/System.History', value: '&lt;b&gt;&amp;&quot;&#39;<br>line2' });
    expect(writes(c)[1].ops.some(o => o.path === '/fields/System.History')).toBe(false);
  });

  it('writes nothing when any validation fails', async () => {
    const c = new FakeClient(new Set([2]));
    const r = await run(c, req('close', [1, 2]));
    expect(r.phase).toBe('validation');
    expect(r.results.map(x => x.ok)).toEqual([true, false]);
    expect(writes(c)).toHaveLength(0);
    expect(existsSync(auditPath)).toBe(false);
    expect(applied).toEqual([]);
  });

  it('dry run makes only validateOnly calls', async () => {
    const c = new FakeClient();
    const r = await run(c, req('close', [1, 2]), true);
    expect(r).toMatchObject({ dryRun: true, phase: 'validation' });
    expect(r.results.every(x => x.ok)).toBe(true);
    expect(c.calls.length).toBe(2);
    expect(writes(c)).toHaveLength(0);
  });

  it('keeps successes when one write fails, audits each and reports only written ids', async () => {
    const c = new FakeClient(new Set(), new Set([2]));
    const r = await run(c, req('reject', [1, 2], 'nope'));
    expect(r.phase).toBe('applied');
    expect(r.results).toEqual([{ id: 1, ok: true, newRev: 21 }, expect.objectContaining({ id: 2, ok: false })]);
    expect(applied).toEqual([{ ids: [1], action: 'reject' }]);
    const lines = readFileSync(auditPath, 'utf8').trim().split('\n').map(l => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ kind: 'validation', action: 'reject', id: 1, oldRev: 20, newRev: 21, state: 'Active', reason: 'Test Failed', comment: 'nope', ok: true });
    expect(lines[1]).toMatchObject({ id: 2, ok: false });
    expect(lines[1].comment).toBe('nope');
  });
});
