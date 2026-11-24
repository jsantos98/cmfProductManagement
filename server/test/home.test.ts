import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SettingsError, validateSettings } from '../src/config.js';
import { wiqlLinks, type RawItem } from '../src/tfs/client.js';
import {
  backlogForArea, countBy, mergeAttention, mergeRecent, shapeFeatures, shapeValidate, stateCounts,
} from '../src/backlog/home.js';
import type { AppConfig, AttentionEntry, BacklogDef, HomeRecentItem, SettingsDto, ValidationItem } from '../src/types.js';

const cfg = JSON.parse(readFileSync(new URL('../../config/default.json', import.meta.url), 'utf8')) as AppConfig;
const bl = (id: string, areaPath: string): BacklogDef => ({ id, name: id, color: '#112233', areaPath });
const settings = (home: Partial<SettingsDto['home']> = {}): SettingsDto => {
  const { port: _p, tfs: _t, ...rest } = cfg;
  return { ...rest, home: { ...cfg.home, ...home } } as SettingsDto;
};
const raw = (id: number, fields: Record<string, unknown>): RawItem => ({ id, rev: 1, fields });

describe('wiqlLinks', () => {
  it('maps relations, null source for top-level rows', () => {
    const r = { workItemRelations: [{ source: null, target: { id: 1 } }, { source: { id: 1 }, target: { id: 2 } }, { rel: 'x' }] };
    expect(wiqlLinks(r)).toEqual([{ source: null, target: 1 }, { source: 1, target: 2 }]);
  });
  it('is empty for flat responses', () => { expect(wiqlLinks({ workItems: [{ id: 1 }] })).toEqual([]); });
});

describe('stateCounts', () => {
  it('excludes Removed and buckets others', () => {
    expect(stateCounts(['New', 'Active', 'Active', 'Resolved', 'Closed', 'Removed', 'Weird'])).toEqual({ new: 1, active: 2, resolved: 1, closed: 1, other: 1, total: 6 });
  });
});

describe('countBy', () => {
  it('sorts by count desc then key', () => { expect(countBy(['b', 'a', 'b', 'c'])).toEqual([{ key: 'b', count: 2 }, { key: 'a', count: 1 }, { key: 'c', count: 1 }]); });
});

describe('backlogForArea', () => {
  const list = [bl('a', 'Product\\A'), bl('ab', 'Product\\AB'), bl('deep', 'Product\\A\\Deep')];
  it('matches exact and under', () => {
    expect(backlogForArea('Product\\A', list)?.id).toBe('a');
    expect(backlogForArea('Product\\A\\X\\Y', list)?.id).toBe('a');
  });
  it('is case-insensitive', () => { expect(backlogForArea('product\\a\\x', list)?.id).toBe('a'); });
  it('respects the boundary', () => {
    expect(backlogForArea('Product\\ABC', [bl('a', 'Product\\A')])).toBeNull();
    expect(backlogForArea('Product\\AB\\X', list)?.id).toBe('ab');
  });
  it('longest match wins', () => { expect(backlogForArea('Product\\A\\Deep\\Z', list)?.id).toBe('deep'); });
  it('null when nothing matches', () => { expect(backlogForArea('Other', list)).toBeNull(); });
});

describe('shapeFeatures', () => {
  const links = [
    { source: null, target: 20 }, { source: null, target: 10 }, { source: null, target: 30 }, { source: null, target: 40 },
    { source: 10, target: 15 }, { source: 10, target: 11 }, { source: 10, target: 12 }, { source: 10, target: 13 }, { source: 10, target: 14 },
    { source: 20, target: 21 }, { source: 20, target: 22 },
  ];
  const f = (id: number, state: string) =>
    raw(id, { 'System.WorkItemType': 'Feature', 'System.Title': `F${id}`, 'System.State': state, 'System.AreaPath': 'Product\\Technology\\Connect IoT' });
  const c = (id: number, state: string, who?: string) =>
    raw(id, { 'System.WorkItemType': 'User Story', 'System.Title': `S${id}`, 'System.State': state, 'System.AreaPath': 'x', 'System.AssignedTo': who ? { displayName: who } : undefined });
  const raws = [f(10, 'Active'), f(20, 'New'), f(30, 'Resolved'), f(40, 'Active'),
    c(11, 'Closed', 'Ann'), c(12, 'New'), c(13, 'Active'), c(14, 'Weird'), c(15, 'Removed'), c(21, 'New'), c(22, 'Removed')];
  const out = shapeFeatures(links, raws, cfg, [bl('connect-iot', 'Product\\Technology\\Connect IoT')]);

  it('keeps only Active features, by id', () => { expect(out.active.map(x => x.id)).toEqual([10, 40]); });
  it('counts children without Removed', () => { expect(out.active[0].counts).toEqual({ new: 1, active: 1, resolved: 0, closed: 1, other: 1, total: 4 }); });
  it('sorts children Active, New, Resolved, Closed, other', () => { expect(out.active[0].children.map(x => x.id)).toEqual([13, 12, 11, 14]); });
  it('reads assignee, backlog and url', () => {
    expect(out.active[0].children.find(x => x.id === 11)?.assignedTo).toBe('Ann');
    expect(out.active[0].backlogId).toBe('connect-iot');
    expect(out.active[0].url).toContain('/_workitems/edit/10');
  });
  it('lists New features with non-removed child count, ignores others', () => {
    expect(out.notStarted.map(x => [x.id, x.childCount])).toEqual([[20, 1]]);
  });
});

describe('mergeAttention', () => {
  const e = (id: number, lastDate: string, acked?: string): AttentionEntry => ({ id, count: 1, lastAuthor: 'x', lastDate, snippet: '', ...(acked ? { acked } : {}) });
  it('prefers validate, drops acked, sorts by lastDate desc', () => {
    const out = mergeAttention([
      { backlog: [e(1, '2026-01-01'), e(2, '2026-01-03'), e(3, '2026-01-05', 'x')], validate: [e(1, '2026-01-02')] },
      { backlog: [e(4, '2026-01-04')], validate: [] },
    ]);
    expect(out.map(x => [x.id, x.view])).toEqual([[4, 'backlog'], [2, 'backlog'], [1, 'validate']]);
  });
  it('an acked validate entry does not hide the backlog one', () => {
    expect(mergeAttention([{ backlog: [e(1, '2026-01-01')], validate: [e(1, '2026-01-02', 'y')] }]).map(x => x.view)).toEqual(['backlog']);
  });
});

describe('mergeRecent', () => {
  const r = (id: number, changedDate: string): HomeRecentItem =>
    ({ id, type: 'Bug', title: '', state: 'New', url: '', areaPath: '', backlogId: null, changedBy: '', changedDate });
  it('dedupes, sorts desc and caps', () => {
    expect(mergeRecent([[r(1, '2026-01-01'), r(2, '2026-01-03')], [r(2, '2026-01-03'), r(3, '2026-01-02')]]).map(x => x.id)).toEqual([2, 3, 1]);
    const many = Array.from({ length: 40 }, (_, i) => r(i + 1, `2026-01-${String((i % 28) + 1).padStart(2, '0')}`));
    expect(mergeRecent([many])).toHaveLength(30);
    expect(mergeRecent([many], 5)).toHaveLength(5);
  });
});

describe('shapeValidate', () => {
  const now = Date.parse('2026-02-11T12:00:00Z');
  const v = (id: number, resolvedDate: string, extra: Partial<ValidationItem> = {}): ValidationItem =>
    ({ id, type: 'Bug', title: `T${id}`, state: 'Resolved', url: '', areaPath: 'a', resolvedDate, ...extra } as ValidationItem);
  const items = [v(1, '2026-02-10T12:00:00Z', { prs: [] }), v(2, '2026-02-01T12:00:00Z', { prs: [], prError: 'x' }), v(3, '2026-02-05T12:00:00Z', { viaFeature: true }),
    v(4, '2026-02-06T12:00:00Z'), v(5, '2026-02-07T12:00:00Z'), v(6, '2026-02-08T12:00:00Z'), v(7, '2026-02-09T12:00:00Z')];
  const out = shapeValidate(bl('b', 'a'), items, now);
  it('counts', () => { expect([out.total, out.noPr, out.viaFeature]).toEqual([7, 1, 1]); });
  it('oldest days and 5 oldest', () => {
    expect(out.oldestDays).toBe(10);
    expect(out.items.map(i => i.id)).toEqual([2, 3, 4, 5, 6]);
    expect(out.items[0].waitDays).toBe(10);
  });
  it('empty is null', () => { expect(shapeValidate(bl('b', 'a'), [], now).oldestDays).toBeNull(); });
});

describe('validateSettings (home)', () => {
  it('default passes', () => { expect(() => validateSettings(settings())).not.toThrow(); });
  it('rejects a missing placeholder', () => {
    expect(() => validateSettings(settings({ nextVersionWiqlTemplate: 'SELECT 1 {{areaPath}}' }))).toThrow(/tag/);
    expect(() => validateSettings(settings({ recentWiqlTemplate: 'SELECT 1 {{areaPath}}' }))).toThrow(/days/);
    expect(() => validateSettings(settings({ recentWiqlTemplate: 'SELECT 1 {{days}}' }))).toThrow(SettingsError);
  });
  it('rejects blank featuresWiql and a missing block', () => {
    expect(() => validateSettings(settings({ featuresWiql: ' ' }))).toThrow(SettingsError);
    expect(() => validateSettings({ ...settings(), home: undefined })).toThrow(SettingsError);
  });
  it('recentDays must be an integer 1..30', () => {
    for (const d of [0, 31, 1.5, NaN]) expect(() => validateSettings(settings({ recentDays: d }))).toThrow(SettingsError);
    for (const d of [1, 30]) expect(() => validateSettings(settings({ recentDays: d }))).not.toThrow();
  });
});
