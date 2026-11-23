import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyTagDiff, bandFor, hasTag, joinTags, splitTags, toBacklogItem } from '../src/backlog/derive.js';
import type { AppConfig } from '../src/types.js';

const cfg = JSON.parse(readFileSync(new URL('../../config/default.json', import.meta.url), 'utf8')) as AppConfig;

describe('bandFor', () => {
  it.each([
    [-1, 'Not Reviewed'], [0, 'High Priority'], [99, 'High Priority'], [599, 'After Next'],
    [610, 'Tech Debt'], [2000, 'Will Not Be Done'], [5003, 'Known Issues'], [null, 'Unknown'],
  ])('%s -> %s', (order, label) => {
    expect(bandFor(order as number | null, cfg.bands)).toBe(label);
  });
});

describe('toBacklogItem', () => {
  const raw = (tags: string, extra: Record<string, unknown> = {}) => ({
    id: 1, rev: 3,
    fields: {
      'System.WorkItemType': 'Bug', 'System.Title': 't', 'System.State': 'New', 'System.Tags': tags,
      'System.AssignedTo': { displayName: 'Joao' }, 'Custom.BusinessOrder': 50, 'System.Parent': 7, ...extra,
    },
  });

  it('derives component like Excel and min/max version from the version tags', () => {
    const it1 = toBacklogItem(raw('12.0x; ExtendableControllers; IoT; UX'), cfg, new Map([[7, 'Parent']]));
    expect(it1.component).toBe('Controller');
    expect(it1.minVersion).toBe('12.0x');
    expect(it1.maxVersion).toBe('12.0x');
    const multi = toBacklogItem(raw('11.3x; 12.0x; 12.1x; IoT'), cfg);
    expect([multi.minVersion, multi.maxVersion]).toEqual(['11.3x', '12.1x']);
    expect(it1.band).toBe('High Priority');
    expect(it1.assignedTo).toBe('Joao');
    expect(it1.parentTitle).toBe('Parent');
    expect(it1.url).toBe('https://tfs-product.cmf.criticalmanufacturing.com/Products/Product/_workitems/edit/1');
  });

  it('takes the parent title and type from a ParentInfo', () => {
    const it1 = toBacklogItem(raw('IoT'), cfg, new Map([[7, { title: 'F', type: 'Feature' }]]));
    expect([it1.parentTitle, it1.parentType]).toEqual(['F', 'Feature']);
    expect(toBacklogItem(raw('IoT'), cfg, new Map([[7, 'Parent']])).parentType).toBe('');
  });

  it('returns Unknown when nothing matches', () => {
    const it2 = toBacklogItem(raw('13.0x; IoT; NoDocsNeeded'), cfg);
    expect(it2.component).toBe('Unknown');
    expect(it2.minVersion).toBe('13.0x');
    expect(toBacklogItem(raw('IoT; UX'), cfg).maxVersion).toBe('Unknown');
  });

  it('flags next version by exact tag', () => {
    expect(toBacklogItem(raw('IoT; 12.1X'), cfg).nextVersion).toBe(true);
    expect(toBacklogItem(raw('IoT; 12.1x-foo'), cfg).nextVersion).toBe(false);
  });
});

describe('tags', () => {
  it('splits and joins', () => {
    expect(splitTags(' a ;b;; c ')).toEqual(['a', 'b', 'c']);
    expect(joinTags(['a', 'b'])).toBe('a; b');
    expect(hasTag(['IoT'], 'iot')).toBe(true);
  });

  it('applyTagDiff adds with case-insensitive dedupe, keeping existing casing', () => {
    expect(applyTagDiff(['IoT', 'UX'], ['iot', '12.1x'])).toEqual(['IoT', 'UX', '12.1x']);
  });

  it('applyTagDiff removes case-insensitively', () => {
    expect(applyTagDiff(['IoT', 'UX', '12.0x'], [], ['ux', '12.0X'])).toEqual(['IoT']);
  });

  it('applyTagDiff can empty the list', () => {
    expect(applyTagDiff(['a'], [], ['A'])).toEqual([]);
  });
});
