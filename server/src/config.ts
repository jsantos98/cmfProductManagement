import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppConfig, BacklogDef, SettingsDto } from './types.js';

/** Walk up from this module until config/default.json is found (works from src/ and dist/). */
function findRepoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'config', 'default.json'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('Cannot locate repo root (config/default.json not found)');
}

export const repoRoot = findRepoRoot();
const defaultPath = path.join(repoRoot, 'config', 'default.json');
const localPath = path.join(repoRoot, 'config.local.json');

let cached: AppConfig | null = null;

function readJson(file: string): any {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function load(): AppConfig {
  const def = readJson(defaultPath);
  const local = fs.existsSync(localPath) ? readJson(localPath) : {};
  const merged = { ...def, ...local, tfs: { ...def.tfs, ...(local.tfs ?? {}) } };
  // legacy keys, ignored: single-backlog wiql; Excel-style min/max version rules (versions are parsed from tags now)
  for (const k of ['wiql', 'minVersionRules', 'maxVersionRules']) delete merged[k];
  return merged as AppConfig;
}

export const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
export const AREA_PLACEHOLDER = '{{areaPath}}';

/** The WIQL for one backlog: its own override if non-blank, else the shared template with the area path filled in. */
export function effectiveWiql(def: BacklogDef, cfg: AppConfig): string {
  const own = def.wiql?.trim();
  if (own) return own;
  return fillArea(cfg.wiqlTemplate, def.areaPath);
}

/** Substitute {{areaPath}} in a WIQL template, escaping single quotes of the area path. */
export function fillArea(template: string, areaPath: string | undefined): string {
  const area = (areaPath ?? '').replace(/'/g, "''");
  return template.split(AREA_PLACEHOLDER).join(area);
}

/** WIQL of the Resolved items assigned to me in one backlog's area (always built from the area path). */
export function validationWiql(def: BacklogDef, cfg: AppConfig): string {
  return fillArea(cfg.validation.wiqlTemplate, def.areaPath);
}

export function getBacklogDef(id: string): BacklogDef | undefined {
  return getConfig().backlogs.find(b => b.id === id);
}

export function getConfig(): AppConfig {
  return (cached ??= load());
}

export class SettingsError extends Error {}

export function validateSettings(dto: any): asserts dto is SettingsDto {
  const fail = (m: string): never => { throw new SettingsError(m); };
  if (!dto || typeof dto !== 'object') fail('Settings body must be an object');
  if (!Array.isArray(dto.bands) || dto.bands.length === 0) fail('bands must be a non-empty array');
  for (const b of dto.bands) {
    if (typeof b?.label !== 'string' || !b.label) fail('each band needs a label');
    if (typeof b.min !== 'number' || !Number.isFinite(b.min)) fail(`band "${b.label}": min must be a number`);
    if (b.max !== null && (typeof b.max !== 'number' || !Number.isFinite(b.max))) fail(`band "${b.label}": max must be a number or null`);
  }
  if (typeof dto.nextVersionTag !== 'string' || !dto.nextVersionTag.trim()) fail('nextVersionTag must be non-empty');
  if (!Array.isArray(dto.backlogs) || dto.backlogs.length === 0) fail('backlogs must be a non-empty array');
  const ids = new Set<string>();
  let needsTemplate = false;
  for (const b of dto.backlogs) {
    if (typeof b?.id !== 'string' || !SLUG_RE.test(b.id)) fail(`backlog id "${b?.id}" must match ${SLUG_RE}`);
    if (ids.has(b.id)) fail(`duplicate backlog id "${b.id}"`);
    ids.add(b.id);
    if (typeof b.name !== 'string' || !b.name.trim()) fail(`backlog "${b.id}": name must be non-empty`);
    if (typeof b.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(b.color)) fail(`backlog "${b.id}": color must be #rrggbb`);
    const hasOverride = typeof b.wiql === 'string' && b.wiql.trim() !== '';
    const hasArea = typeof b.areaPath === 'string' && b.areaPath.trim() !== '';
    if (!hasOverride && !hasArea) fail(`backlog "${b.id}": needs an area path or a custom WIQL`);
    if (!hasOverride) needsTemplate = true;
  }
  if (typeof dto.wiqlTemplate !== 'string') fail('wiqlTemplate must be a string');
  if (needsTemplate && (!dto.wiqlTemplate.trim() || !dto.wiqlTemplate.includes(AREA_PLACEHOLDER))) {
    fail(`wiqlTemplate must be non-empty and contain ${AREA_PLACEHOLDER}`);
  }
  const v = dto.validation;
  if (!v || typeof v !== 'object') fail('validation must be an object');
  if (typeof v.wiqlTemplate !== 'string' || !v.wiqlTemplate.trim() || !v.wiqlTemplate.includes(AREA_PLACEHOLDER)) {
    fail(`validation.wiqlTemplate must be non-empty and contain ${AREA_PLACEHOLDER}`);
  }
  for (const k of ['close', 'reject']) {
    const m = v[k];
    if (!m || typeof m !== 'object' || Array.isArray(m)) fail(`validation.${k} must be an object`);
    for (const [t, r] of Object.entries(m)) {
      if (typeof r !== 'string' || !r.trim()) fail(`validation.${k}["${t}"] must be a non-empty string`);
    }
  }
  for (const k of ['componentRules', 'versionTags', 'hiddenTags', 'editableFields', 'stateOptions']) {
    if (!Array.isArray(dto[k])) fail(`${k} must be an array`);
  }
}

export function getSettings(): SettingsDto {
  const { port: _p, tfs: _t, ...rest } = getConfig();
  return rest;
}

/** Persist settings to config.local.json (merged over default) and refresh the cached config. */
export function saveSettings(dto: SettingsDto): AppConfig {
  validateSettings(dto);
  const keys: (keyof SettingsDto)[] = ['wiqlTemplate', 'backlogs', 'bands', 'componentRules',
    'versionTags', 'nextVersionTag', 'hiddenTags', 'editableFields', 'stateOptions', 'validation'];
  const local: Record<string, unknown> = fs.existsSync(localPath) ? readJson(localPath) : {};
  for (const k of keys) local[k] = dto[k];
  for (const k of ['wiql', 'minVersionRules', 'maxVersionRules']) delete local[k]; // legacy keys
  fs.writeFileSync(localPath, JSON.stringify(local, null, 2) + '\n', 'utf8');
  cached = load();
  return cached;
}
