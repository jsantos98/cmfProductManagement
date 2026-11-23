import { describe, expect, it } from 'vitest';
import { compareVersionLabels, parseVersionTag, versionRange } from '../src/shared/version.js';

describe('parseVersionTag', () => {
  it.each([
    ['12.0x', '12.0x'], ['12.0.x', '12.0x'], ['12.0', '12.0x'], ['12.1X', '12.1x'], ['11x', '11x'], ['11.x', '11x'],
    ['12.1.0', '12.1.0'], ['10.2.12', '10.2.12'], ['13.0.0', '13.0.0'],
  ])('%s -> %s', (tag, label) => {
    expect(parseVersionTag(tag)?.label).toBe(label);
  });

  it.each(['0', '12', 'IoT', '12.0.1x', 'v12.0', '12.0x-foo', ''])('%s is not a version', (tag) => {
    expect(parseVersionTag(tag)).toBeNull();
  });
});

describe('versionRange', () => {
  it('takes the lowest and highest line (the reported case)', () => {
    expect(versionRange(['11.3x', '12.0x', '12.1x', 'IoT'])).toEqual({ min: '11.3x', max: '12.1x' });
  });

  it('a line tag is the low end for min and the high end for max', () => {
    expect(versionRange(['11.3.7', '12.0.1', '12.1.0', '12.1x', 'PrivateFix'])).toEqual({ min: '11.3.7', max: '12.1x' });
    expect(versionRange(['11.3x', '11.3.7'])).toEqual({ min: '11.3x', max: '11.3x' });
    expect(versionRange(['11x', '11.2x'])).toEqual({ min: '11x', max: '11x' });
  });

  it('single version, mixed spellings, none', () => {
    expect(versionRange(['13.0x'])).toEqual({ min: '13.0x', max: '13.0x' });
    expect(versionRange(['12.0', '10.2.12', '0'])).toEqual({ min: '10.2.12', max: '12.0x' });
    expect(versionRange(['IoT', 'UX'])).toEqual({ min: 'Unknown', max: 'Unknown' });
  });
});

describe('compareVersionLabels', () => {
  it('sorts by version with Unknown last', () => {
    expect(['13.0x', 'Unknown', '11.3x', '12.1.0', '12.0x', '11x'].sort(compareVersionLabels))
      .toEqual(['11x', '11.3x', '12.0x', '12.1.0', '13.0x', 'Unknown']);
  });
});
