// Pure helpers shared by server and web (no Node imports): product versions from tags.
//
// Version tags come in several spellings: release lines "12.0x", "12.0.x", "12.0", "11x", "11.x" and exact
// versions "12.1.0", "10.2.12". A line tag covers the whole line, so it is the lowest of its line for the
// minimum and the highest for the maximum (11.3.7 < 11.3x for max; 11.3x < 11.3.7 for min).

export interface Version {
  major: number;
  minor: number | null; // null = whole major line ("11x")
  patch: number | null; // null = whole minor line ("12.0x")
  /** normalised label: "12.0x", "11x" or "12.1.0" */
  label: string;
}

// a dot or an "x" is required so plain numbers ("0", "2024") are not versions
const RE = /^(\d{1,3})(?:\.(\d{1,3}))?(?:\.(\d{1,4}))?(\.?x)?$/i;

export function parseVersionTag(tag: string): Version | null {
  const t = tag.trim();
  const m = RE.exec(t);
  if (!m) return null;
  const [, a, b, c, x] = m;
  if (b === undefined && !x) return null; // "12" alone is not a version tag
  if (c !== undefined && x) return null; // "12.0.1x" is not a spelling we know
  const major = Number(a);
  const minor = b === undefined ? null : Number(b);
  const patch = c === undefined ? null : Number(c);
  const label = patch !== null ? `${major}.${minor}.${patch}` : minor !== null ? `${major}.${minor}x` : `${major}x`;
  return { major, minor, patch, label };
}

/** Compare for the minimum: a missing part (whole line) ranks lowest. */
function cmpLow(a: Version, b: Version): number {
  return a.major - b.major || (a.minor ?? -1) - (b.minor ?? -1) || (a.patch ?? -1) - (b.patch ?? -1);
}
/** Compare for the maximum: a missing part (whole line) ranks highest. */
function cmpHigh(a: Version, b: Version): number {
  const inf = Number.MAX_SAFE_INTEGER;
  return a.major - b.major || (a.minor ?? inf) - (b.minor ?? inf) || (a.patch ?? inf) - (b.patch ?? inf);
}

export const UNKNOWN_VERSION = 'Unknown';

/** Lowest and highest version found in the tags ('Unknown' when there is none). */
export function versionRange(tags: string[]): { min: string; max: string } {
  const vs = tags.map(parseVersionTag).filter((v): v is Version => v !== null);
  if (!vs.length) return { min: UNKNOWN_VERSION, max: UNKNOWN_VERSION };
  const min = vs.reduce((a, b) => (cmpLow(b, a) < 0 ? b : a));
  const max = vs.reduce((a, b) => (cmpHigh(b, a) > 0 ? b : a));
  return { min: min.label, max: max.label };
}

/** Sort comparator for version labels (grid columns): by version, 'Unknown' / non-versions last. */
export function compareVersionLabels(a: string | null | undefined, b: string | null | undefined): number {
  const va = a ? parseVersionTag(a) : null;
  const vb = b ? parseVersionTag(b) : null;
  if (!va || !vb) return (va ? 0 : 1) - (vb ? 0 : 1) || String(a ?? '').localeCompare(String(b ?? ''));
  return cmpLow(va, vb);
}
