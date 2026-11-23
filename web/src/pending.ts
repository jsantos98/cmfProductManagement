import type { BacklogItem, Band, ItemChange } from '../../server/src/types';

export type FieldKey = 'businessOrder' | 'title' | 'state' | 'iterationPath' | 'areaPath' | 'assignedTo';
export type FieldValue = string | number | null;

export const FIELD_REF: Record<FieldKey, string> = {
  businessOrder: 'Custom.BusinessOrder',
  title: 'System.Title',
  state: 'System.State',
  iterationPath: 'System.IterationPath',
  areaPath: 'System.AreaPath',
  assignedTo: 'System.AssignedTo',
};
export const TAGS_REF = 'System.Tags';
export const FIELD_LABEL: Record<FieldKey, string> = {
  businessOrder: 'BusinessOrder',
  title: 'Title',
  state: 'State',
  iterationPath: 'Iteration',
  areaPath: 'Area',
  assignedTo: 'Assigned to',
};
/** Value of a pending System.AssignedTo change: the server substitutes the signed-in user. */
export const ASSIGN_ME = '@me';

export interface PendingEntry {
  fields: Partial<Record<FieldKey, { old: FieldValue; new: FieldValue }>>;
  tagsAdd: string[];
  tagsRemove: string[];
}
export type PendingMap = Record<number, PendingEntry>;

const lc = (s: string) => s.toLowerCase();
export const hasTag = (tags: string[], t: string) => tags.some((x) => lc(x) === lc(t));

const emptyEntry = (): PendingEntry => ({ fields: {}, tagsAdd: [], tagsRemove: [] });
const isEmpty = (e: PendingEntry) =>
  Object.keys(e.fields).length === 0 && e.tagsAdd.length === 0 && e.tagsRemove.length === 0;

function store(map: PendingMap, id: number, e: PendingEntry): PendingMap {
  const next = { ...map };
  if (isEmpty(e)) delete next[id];
  else next[id] = e;
  return next;
}

export function setField(map: PendingMap, item: BacklogItem, key: FieldKey, value: FieldValue): PendingMap {
  const e = map[item.id] ?? emptyEntry();
  const old = item[key] as FieldValue;
  const fields = { ...e.fields };
  if (old === value) delete fields[key];
  else fields[key] = { old, new: value };
  return store(map, item.id, { ...e, fields });
}

/** Remove just one pending field of an item (e.g. undo a move). */
export function clearField(map: PendingMap, item: BacklogItem, key: FieldKey): PendingMap {
  const e = map[item.id];
  if (!e || !e.fields[key]) return map;
  const fields = { ...e.fields };
  delete fields[key];
  return store(map, item.id, { ...e, fields });
}

export function addTag(map: PendingMap, item: BacklogItem, tag: string): PendingMap {
  const t = tag.trim();
  if (!t) return map;
  const e = map[item.id] ?? emptyEntry();
  let { tagsAdd, tagsRemove } = e;
  if (hasTag(item.tags, t)) tagsRemove = tagsRemove.filter((x) => lc(x) !== lc(t));
  else if (!hasTag(tagsAdd, t)) tagsAdd = [...tagsAdd, t];
  return store(map, item.id, { ...e, tagsAdd, tagsRemove });
}

export function removeTag(map: PendingMap, item: BacklogItem, tag: string): PendingMap {
  const t = tag.trim();
  if (!t) return map;
  const e = map[item.id] ?? emptyEntry();
  let { tagsAdd, tagsRemove } = e;
  const orig = item.tags.find((x) => lc(x) === lc(t));
  if (orig !== undefined) {
    if (!hasTag(tagsRemove, t)) tagsRemove = [...tagsRemove, orig];
  }
  tagsAdd = tagsAdd.filter((x) => lc(x) !== lc(t));
  return store(map, item.id, { ...e, tagsAdd, tagsRemove });
}

/** Replace the tag edits of an item so that its tags become `newTags`. */
export function setTags(map: PendingMap, item: BacklogItem, newTags: string[]): PendingMap {
  const e = map[item.id] ?? emptyEntry();
  const seen = new Set<string>();
  const wanted: string[] = [];
  for (const raw of newTags) {
    const t = raw.trim();
    if (t && !seen.has(lc(t))) {
      seen.add(lc(t));
      wanted.push(t);
    }
  }
  const tagsAdd = wanted.filter((t) => !hasTag(item.tags, t));
  const tagsRemove = item.tags.filter((t) => !seen.has(lc(t)));
  return store(map, item.id, { ...e, tagsAdd, tagsRemove });
}

export function effectiveTags(item: BacklogItem, e?: PendingEntry): string[] {
  if (!e) return item.tags;
  return [...item.tags.filter((t) => !hasTag(e.tagsRemove, t)), ...e.tagsAdd];
}

export interface Effective {
  title: string;
  state: string;
  iterationPath: string;
  areaPath: string;
  businessOrder: number | null;
  tags: string[];
}

export function effective(item: BacklogItem, e?: PendingEntry): Effective {
  const f = e?.fields ?? {};
  return {
    title: f.title ? (f.title.new as string) : item.title,
    state: f.state ? (f.state.new as string) : item.state,
    iterationPath: f.iterationPath ? (f.iterationPath.new as string) : item.iterationPath,
    areaPath: f.areaPath ? (f.areaPath.new as string) : item.areaPath,
    businessOrder: f.businessOrder ? (f.businessOrder.new as number | null) : item.businessOrder,
    tags: effectiveTags(item, e),
  };
}

export function bandFor(order: number | null, bands: Band[]): Band | undefined {
  if (order === null) return undefined;
  return bands.find((b) => order >= b.min && (b.max === null || order <= b.max));
}

export function buildChanges(items: Map<number, BacklogItem>, pending: PendingMap): ItemChange[] {
  const out: ItemChange[] = [];
  for (const [idStr, e] of Object.entries(pending)) {
    const id = Number(idStr);
    const item = items.get(id);
    if (!item) continue;
    const change: ItemChange = { id, rev: item.rev };
    const keys = Object.keys(e.fields) as FieldKey[];
    if (keys.length) {
      change.fields = {};
      for (const k of keys) change.fields[FIELD_REF[k]] = e.fields[k]!.new;
    }
    if (e.tagsAdd.length || e.tagsRemove.length) {
      change.tags = {};
      if (e.tagsAdd.length) change.tags.add = e.tagsAdd;
      if (e.tagsRemove.length) change.tags.remove = e.tagsRemove;
    }
    out.push(change);
  }
  return out;
}
