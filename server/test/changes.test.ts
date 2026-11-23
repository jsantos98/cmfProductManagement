import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyChanges } from '../src/backlog/changes.js';
import { toBacklogItem } from '../src/backlog/derive.js';
import type { PatchOp, RawItem, TfsApi } from '../src/tfs/client.js';
import type { AppConfig, BacklogItem } from '../src/types.js';

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
    if (validateOnly && this.failValidate.has(id)) throw new Error('TFS HTTP 400: invalid value');
    if (!validateOnly && this.failWrite.has(id)) throw new Error('TFS HTTP 409: rev mismatch');
    const fields: Record<string, unknown> = { 'System.WorkItemType': 'Bug', 'System.Title': `t${id}`, 'System.Tags': 'IoT' };
    for (const o of ops) if (o.op === 'add') fields[o.path.replace('/fields/', '')] = o.value;
    return { id, rev: 11, fields };
  }
}

let store: Map<number, BacklogItem>;
let auditPath: string;

let movedCalls: number[][];
const mk = (client: TfsApi, dryRun = false) => (changes: Parameters<typeof applyChanges>[0]) =>
  applyChanges(changes, { dryRun, client, cfg, auditPath, getItem: id => store.get(id), replaceItem: i => { store.set(i.id, i); }, afterMove: ids => { movedCalls.push(ids); } });

beforeEach(() => {
  movedCalls = [];
  store = new Map([1, 2, 3].map(id => [id, toBacklogItem({ id, rev: 10, fields: { 'System.Title': `t${id}`, 'System.Tags': 'IoT; UX', 'Custom.BusinessOrder': -1 } }, cfg)]));
  auditPath = path.join(mkdtempSync(path.join(tmpdir(), 'cmfpm-')), 'data', 'changes.jsonl');
});

const bo = (id: number, v: number) => ({ id, rev: 10, fields: { 'Custom.BusinessOrder': v } });
const writes = (c: FakeClient) => c.calls.filter(x => !x.validateOnly);

describe('applyChanges', () => {
  it('writes nothing when any validation fails', async () => {
    const c = new FakeClient(new Set([2]));
    const r = await mk(c)([bo(1, 5), bo(2, 6), bo(3, 7)]);
    expect(r.phase).toBe('validation');
    expect(r.results.map(x => x.ok)).toEqual([true, false, true]);
    expect(r.results[1].error).toContain('400');
    expect(writes(c)).toHaveLength(0);
    expect(existsSync(auditPath)).toBe(false);
  });

  it('dry run validates only', async () => {
    const c = new FakeClient();
    const r = await mk(c, true)([bo(1, 5)]);
    expect(r).toMatchObject({ dryRun: true, phase: 'validation' });
    expect(r.results[0].ok).toBe(true);
    expect(writes(c)).toHaveLength(0);
  });

  it('keeps successes when one write fails', async () => {
    const c = new FakeClient(new Set(), new Set([2]));
    const r = await mk(c)([bo(1, 5), bo(2, 6), bo(3, 7)]);
    expect(r.phase).toBe('applied');
    expect(r.results.map(x => x.ok)).toEqual([true, false, true]);
    expect(store.get(1)!.businessOrder).toBe(5);
    expect(store.get(1)!.rev).toBe(11);
    expect(store.get(2)!.businessOrder).toBe(-1);
    expect(store.get(3)!.businessOrder).toBe(7);
    const lines = readFileSync(auditPath, 'utf8').trim().split('\n').map(l => JSON.parse(l));
    expect(lines).toHaveLength(3);
    expect(lines[1]).toMatchObject({ id: 2, ok: false });
    expect(lines[0].fields['Custom.BusinessOrder']).toEqual({ old: -1, new: 5 });
  });

  it('sends the test /rev op first, with the loaded rev', async () => {
    const c = new FakeClient();
    await mk(c)([{ id: 1, rev: 10, fields: { 'Custom.BusinessOrder': '42' }, tags: { add: ['12.1x'], remove: ['ux'] } }]);
    for (const call of c.calls) expect(call.ops[0]).toEqual({ op: 'test', path: '/rev', value: 10 });
    const ops = writes(c)[0].ops;
    expect(ops).toContainEqual({ op: 'add', path: '/fields/Custom.BusinessOrder', value: 42 });
    expect(ops).toContainEqual({ op: 'add', path: '/fields/System.Tags', value: 'IoT; 12.1x' });
  });

  it('rejects non-editable fields without calling TFS', async () => {
    const c = new FakeClient();
    const r = await mk(c)([{ id: 1, rev: 10, fields: { 'System.Description': 'x' } }]);
    expect(r.phase).toBe('validation');
    expect(r.results[0]).toMatchObject({ ok: false });
    expect(r.results[0].error).toContain('not editable');
    expect(c.calls).toHaveLength(0);
  });

  describe('area path move', () => {
    const target = cfg.backlogs[1];
    const mv = (id: number, v: string) => ({ id, rev: 10, fields: { 'System.AreaPath': v } });

    it('accepts a configured backlog area path and sends the configured spelling', async () => {
      const c = new FakeClient();
      const r = await mk(c)([mv(1, `  ${target.areaPath.toUpperCase()} `)]);
      expect(r.phase).toBe('applied');
      expect(writes(c)[0].ops).toContainEqual({ op: 'add', path: '/fields/System.AreaPath', value: target.areaPath });
    });

    it('rejects an unconfigured area path without calling TFS', async () => {
      const c = new FakeClient();
      const r = await mk(c)([mv(1, 'Product\\Somewhere Else')]);
      expect(r.phase).toBe('validation');
      expect(r.results[0].error).toContain('Area path not allowed');
      expect(c.calls).toHaveLength(0);
    });

    it('flags moved items on apply, audits old/new and notifies afterMove', async () => {
      store.set(1, toBacklogItem({ id: 1, rev: 10, fields: { 'System.Title': 't1', 'System.AreaPath': cfg.backlogs[0].areaPath } }, cfg));
      const c = new FakeClient();
      const r = await mk(c)([mv(1, target.areaPath), bo(2, 5)]);
      expect(r.results[0]).toMatchObject({ id: 1, ok: true, moved: true });
      expect(r.results[1].moved).toBeUndefined();
      expect(movedCalls).toEqual([[1]]);
      const line = JSON.parse(readFileSync(auditPath, 'utf8').trim().split('\n')[0]);
      expect(line.fields['System.AreaPath']).toEqual({ old: cfg.backlogs[0].areaPath, new: target.areaPath });
    });

    it('writes nothing and does not flag moves in a dry run', async () => {
      const c = new FakeClient();
      const r = await mk(c, true)([mv(1, target.areaPath)]);
      expect(r).toMatchObject({ dryRun: true, phase: 'validation' });
      expect(r.results[0].moved).toBeUndefined();
      expect(writes(c)).toHaveLength(0);
      expect(movedCalls).toEqual([]);
    });
  });
});

describe('assign to me', () => {
  const ME = 'Jane Doe <CORP\\jdoe>';
  const run = (client: FakeClient, changes: Parameters<typeof applyChanges>[0], me?: () => Promise<string>) =>
    applyChanges(changes, { dryRun: false, client, cfg, auditPath, getItem: id => store.get(id), replaceItem: i => { store.set(i.id, i); }, me });

  it('resolves @me to the signed-in identity', async () => {
    const c = new FakeClient();
    const r = await run(c, [{ id: 1, rev: 10, fields: { 'System.AssignedTo': '@me' } }], async () => ME);
    expect(r.results[0].ok).toBe(true);
    expect(writes(c)[0].ops).toContainEqual({ op: 'add', path: '/fields/System.AssignedTo', value: ME });
  });

  it('rejects any other value without calling TFS', async () => {
    const c = new FakeClient();
    const r = await run(c, [{ id: 1, rev: 10, fields: { 'System.AssignedTo': 'Someone Else' } }], async () => ME);
    expect(r.results[0].ok).toBe(false);
    expect(c.calls).toHaveLength(0);
  });

  it('fails cleanly when the identity is unknown', async () => {
    const c = new FakeClient();
    const r = await run(c, [{ id: 1, rev: 10, fields: { 'System.AssignedTo': '@me' } }], async () => { throw new Error('offline'); });
    expect(r.results[0]).toMatchObject({ ok: false, error: expect.stringContaining('unknown') });
    expect(c.calls).toHaveLength(0);
  });
});
