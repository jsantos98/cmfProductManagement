import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { effectiveWiql, validateSettings, SettingsError } from '../src/config.js';
import type { AppConfig, BacklogDef, SettingsDto } from '../src/types.js';

const cfg = JSON.parse(readFileSync(new URL('../../config/default.json', import.meta.url), 'utf8')) as AppConfig;
const def = (o: Partial<BacklogDef> = {}): BacklogDef => ({ id: 'a', name: 'A', color: '#112233', areaPath: 'Product\\A', ...o });
const settings = (o: Partial<SettingsDto> = {}): SettingsDto => {
  const { port: _p, tfs: _t, ...rest } = cfg;
  return { ...rest, ...o } as SettingsDto;
};

describe('effectiveWiql', () => {
  it('substitutes the area path into the template', () => {
    const w = effectiveWiql(cfg.backlogs[1], cfg);
    expect(w).toContain("UNDER 'Product\\Data and Delivery\\Industrial Connectivity'");
    expect(w).not.toContain('{{areaPath}}');
  });
  it('doubles single quotes in the area path', () => {
    expect(effectiveWiql(def({ areaPath: "Pro'duct" }), cfg)).toContain("UNDER 'Pro''duct'");
  });
  it('replaces every placeholder occurrence', () => {
    const c = { ...cfg, wiqlTemplate: "X '{{areaPath}}' Y '{{areaPath}}'" };
    expect(effectiveWiql(def({ areaPath: 'P' }), c)).toBe("X 'P' Y 'P'");
  });
  it('override wins and is trimmed', () => {
    expect(effectiveWiql(def({ wiql: '  SELECT 1  ' }), cfg)).toBe('SELECT 1');
  });
  it('blank override is ignored', () => {
    expect(effectiveWiql(def({ wiql: '   ' }), cfg)).toBe(effectiveWiql(def(), cfg));
  });
});

describe('validateSettings (backlogs)', () => {
  it('accepts the defaults', () => {
    expect(() => validateSettings(settings())).not.toThrow();
  });
  it('rejects an empty backlog list', () => {
    expect(() => validateSettings(settings({ backlogs: [] }))).toThrow(SettingsError);
  });
  it('rejects duplicate ids', () => {
    expect(() => validateSettings(settings({ backlogs: [def(), def()] }))).toThrow(/duplicate/);
  });
  it('rejects a bad slug', () => {
    for (const id of ['Bad Id', '-x', '', 'A']) {
      expect(() => validateSettings(settings({ backlogs: [def({ id })] }))).toThrow(SettingsError);
    }
  });
  it('rejects a bad colour', () => {
    expect(() => validateSettings(settings({ backlogs: [def({ color: 'red' })] }))).toThrow(/color/);
  });
  it('rejects an empty name', () => {
    expect(() => validateSettings(settings({ backlogs: [def({ name: ' ' })] }))).toThrow(/name/);
  });
  it('rejects a missing area path without override', () => {
    expect(() => validateSettings(settings({ backlogs: [def({ areaPath: '' })] }))).toThrow(/area path/);
  });
  it('accepts a missing area path with a WIQL override', () => {
    expect(() => validateSettings(settings({ backlogs: [def({ areaPath: '', wiql: 'SELECT 1' })] }))).not.toThrow();
  });
  it('rejects a template without the placeholder', () => {
    expect(() => validateSettings(settings({ wiqlTemplate: 'SELECT 1' }))).toThrow(/areaPath/);
  });
  it('does not require the placeholder when every backlog overrides', () => {
    expect(() => validateSettings(settings({ wiqlTemplate: '', backlogs: [def({ wiql: 'SELECT 1' })] }))).not.toThrow();
  });
});
