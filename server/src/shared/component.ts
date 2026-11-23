// Pure helpers shared by server and web (no Node imports): component <-> tags.
import type { ComponentRule } from '../types.js';

const lc = (s: string) => s.trim().toLowerCase();

/** Same rule as the server derivation: first rule whose `match` is a case-insensitive substring of "a; b; c". */
export function deriveComponent(tags: string[], rules: ComponentRule[]): string {
  const hay = tags.join('; ').toLowerCase();
  for (const r of rules) if (r.match && hay.includes(r.match.toLowerCase())) return r.component;
  return 'Unknown';
}

/** Distinct component names in rule order. */
export function componentNames(rules: ComponentRule[]): string[] {
  const out: string[] = [];
  for (const r of rules) if (r.component && !out.some((c) => lc(c) === lc(r.component))) out.push(r.component);
  return out;
}

/** The tag that makes an item get `component`: the rule's match text (always matches itself). */
export function componentTag(component: string, rules: ComponentRule[]): string {
  const r = rules.find((x) => lc(x.component) === lc(component) && x.match.trim());
  return r ? r.match.trim() : component.trim();
}

/**
 * Tags after setting the component to `target` (null = no component): tags that exactly name another
 * component (its rule match or name) are removed and the target's tag is added. Other tags are kept, even
 * when they contain a component word (e.g. "ExtendableControllers"); use `blockingTag` to explain those.
 */
export function withComponent(tags: string[], target: string | null, rules: ComponentRule[]): string[] {
  const t = target?.trim() ? target.trim() : null;
  const others = new Set<string>();
  for (const r of rules) {
    if (t && lc(r.component) === lc(t)) continue;
    if (r.match.trim()) others.add(lc(r.match));
    if (r.component.trim()) others.add(lc(r.component));
  }
  const keep = tags.filter((x) => !others.has(lc(x)));
  if (!t) return keep;
  const tag = componentTag(t, rules);
  return keep.some((x) => lc(x) === lc(tag)) ? keep : [...keep, tag];
}

/** When the derived component is not `target`, the tag responsible (the first rule that matched), if any. */
export function blockingTag(tags: string[], target: string, rules: ComponentRule[]): { tag: string; component: string } | null {
  const got = deriveComponent(tags, rules);
  if (lc(got) === lc(target) || got === 'Unknown') return null;
  const rule = rules.find((r) => r.match && tags.join('; ').toLowerCase().includes(r.match.toLowerCase()));
  if (!rule) return null;
  const tag = tags.find((x) => x.toLowerCase().includes(rule.match.toLowerCase())) ?? rule.match;
  return { tag, component: rule.component };
}
