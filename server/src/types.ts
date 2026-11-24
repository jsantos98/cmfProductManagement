// Shared API contract between server and web. The web imports these as type-only.

export interface Band {
  label: string;
  /** inclusive; the -1 band uses min = max = -1 */
  min: number;
  /** inclusive; null = no upper bound */
  max: number | null;
  color: string;
}

export interface MatchRule {
  /** case-insensitive substring searched in the item's tags string (Excel SEARCH semantics) */
  match: string;
}
export interface ComponentRule extends MatchRule { component: string }

export interface BacklogDef {
  id: string;        // stable slug /^[a-z0-9][a-z0-9-]*$/, used in URLs and localStorage keys
  name: string;      // tab label
  color: string;     // #rrggbb
  areaPath: string;  // matched with UNDER via wiqlTemplate
  wiql?: string;     // optional full override; blank/absent = use wiqlTemplate
  hidden?: boolean;  // true = no tab shown (data kept)
}

export interface AppConfig {
  port: number;
  tfs: {
    serverUrl: string;
    collection: string;
    project: string;
    apiVersion: string;
    caCertPath: string;
  };
  /** must contain the placeholder {{areaPath}} */
  wiqlTemplate: string;
  /** "To validate": Resolved items assigned to me, per backlog area */
  validation: {
    /** must contain {{areaPath}} */
    wiqlTemplate: string;
    /** Link query (WorkItemLinks, one hop) of the Resolved items under Features assigned to me; its targets are added
     *  to the list. Must contain {{areaPath}}; blank/absent = off. */
    featureWiqlTemplate?: string;
    /** work item type -> System.Reason when closing (validated) */
    close: Record<string, string>;
    /** work item type -> System.Reason when rejecting (back to Active) */
    reject: Record<string, string>;
  };
  /** Home (cockpit) landing page queries */
  home: HomeConfig;
  /** array order = tab order */
  backlogs: BacklogDef[];
  bands: Band[];
  componentRules: ComponentRule[];
  versionTags: string[];
  nextVersionTag: string;
  /** tags unchecked by default in the Tags column filter (rows with any of them are hidden) */
  hiddenTags: string[];
  /** TFS reference names editable from the grid */
  editableFields: string[];
  stateOptions: string[];
}

export interface HomeConfig {
  /** Link query (WorkItemLinks, one hop, MayContain) of my open Features and their children */
  featuresWiql: string;
  /** WIQL of the items tagged with the next version in one area; placeholders {{areaPath}} and {{tag}} */
  nextVersionWiqlTemplate: string;
  /** WIQL of the items changed by others recently in one area; placeholders {{areaPath}} and {{days}} */
  recentWiqlTemplate: string;
  /** days back for "Recently changed" (1..30) */
  recentDays: number;
}

/** Settings editable from the UI (everything except port / TFS connection) */
export type SettingsDto = Omit<AppConfig, 'port' | 'tfs'>;

export interface BacklogItem {
  id: number;
  rev: number;
  url: string;                  // TFS web link (…/_workitems/edit/<id>)
  type: string;                 // System.WorkItemType
  title: string;
  state: string;
  iterationPath: string;
  areaPath: string;
  assignedTo: string;           // display name, '' if none
  tags: string[];               // split on ';', trimmed, original casing
  businessOrder: number | null; // Custom.BusinessOrder
  parentId: number | null;      // System.Parent
  parentTitle: string;          // '' if none
  parentType: string;           // parent's work item type ('' if none or unknown)
  /** Only on BacklogResponse.outsideFeatures: a Feature from outside the backlog, shown as a read-only group header. */
  outside?: boolean;
  changedDate: string;          // ISO
  commentCount: number;         // System.CommentCount, 0 when missing
  // derived
  band: string;                 // band label; 'Unknown' if no band matches or order is null
  component: string;            // first componentRule match, else 'Unknown'
  minVersion: string;           // lowest version tag (shared/version.ts), e.g. "11.3x" / "12.1.0", else 'Unknown'
  maxVersion: string;           // highest version tag, else 'Unknown'
  nextVersion: boolean;         // tags contain config.nextVersionTag (case-insensitive, exact tag)
}

export interface BacklogResponse {
  backlogId: string;
  items: BacklogItem[];
  /** Parent Features of items that are not in this backlog (marked `outside`): read-only group headers, not backlog items. */
  outsideFeatures: BacklogItem[];
  loadedAt: string;             // ISO
  nextVersionTag: string;
  bands: Band[];
}

export interface CountEntry { key: string; count: number }

export interface MetricsResponse {
  backlogId: string;
  total: number;
  byType: CountEntry[];
  byBand: CountEntry[];         // in config band order, including zero counts (+ 'Unknown' if > 0)
  byState: CountEntry[];
  byComponent: CountEntry[];    // sorted desc
  notReviewed: { total: number; byType: CountEntry[] }; // businessOrder === -1
  nextVersion: { tag: string; total: number; byType: CountEntry[] };
  loadedAt: string;
}

export interface TagsResponse { tags: CountEntry[]; versionTags: string[]; nextVersionTag: string }

/** One pending change for one work item. Only provided keys are changed. */
export interface ItemChange {
  id: number;
  /** rev the client loaded; the server sends a `test /rev` op so concurrent edits fail instead of clobbering */
  rev: number;
  /** TFS reference name -> new value. Allowed keys = config.editableFields except System.Tags, plus System.AreaPath when set to a configured backlog's areaPath (move) */
  fields?: Record<string, string | number | null>;
  tags?: { add?: string[]; remove?: string[] };
}

export interface ChangesRequest { changes: ItemChange[] }

export interface ItemChangeResult {
  id: number;
  ok: boolean;
  newRev?: number;
  error?: string;
  item?: BacklogItem;           // refreshed item after a successful write
  moved?: boolean;              // true when this item's System.AreaPath changed in the applied phase
}

/** A completed pull request linked to a work item. `version` is "12.1" for `12.1/dev`, "11.3.7" for `11.3/7/beta`, null for other branches. */
export interface PrRef { id: number; repo: string; target: string; version: string | null; url: string; closedDate: string }
export interface ValidationItem extends BacklogItem {
  resolvedDate: string; resolvedBy: string; resolvedReason: string;
  /** Listed only because its parent Feature is assigned to me (the item itself is not). */
  viaFeature?: boolean;
  /** Completed PRs only. Undefined = the links could not be read (unknown, not "no PR"). */
  prs?: PrRef[];
  /** Linked PRs that are still active (not completed). */
  prOpen?: number;
  /** Set when some linked PRs could not be read. */
  prError?: string;
}
export interface ValidationResponse { backlogId: string; items: ValidationItem[]; loadedAt: string }
/** Close (validated) or reject (back to Active) Resolved items. Results use ChangesResponse; `item` is omitted since the item leaves the list. */
export interface TransitionRequest { items: { id: number; rev: number }[]; action: 'close' | 'reject'; comment?: string }
export interface SummaryEntry { id: string; waiting: number; toValidate: number }
export interface SummaryResponse { backlogs: SummaryEntry[]; loadedAt: string }

export interface ChangesResponse {
  dryRun: boolean;
  /** 'validation' = pre-validation failed or dry run, nothing written; 'applied' = writes attempted */
  phase: 'validation' | 'applied';
  results: ItemChangeResult[];
}

export interface HealthResponse {
  ok: boolean;
  tfsReachable: boolean;
  identity?: string;
  patPresent: boolean;
  caConfigured: boolean;        // NODE_EXTRA_CA_CERTS set and the file exists
  error?: string;
  version: string;
}

export interface ItemSection { label: string; html: string }
export interface ItemChild { id: number; type: string; title: string; state: string }
export interface ItemComment { author: string; date: string; html: string; mentionsMe?: boolean }

export interface AttentionEntry { id: number; count: number; lastAuthor: string; lastDate: string; snippet: string; acked?: string }
export interface AttentionResponse { backlogId: string; items: AttentionEntry[]; errors: number; loadedAt: string }

/** On-demand detail view of one work item (GET /api/items/:id). */
export interface ItemDetails {
  item: BacklogItem;
  createdBy: string;
  createdDate: string;
  changedBy: string;
  changedDate: string;
  priority: number | null;
  severity: string;
  bugType: string;
  targetVersion: string;
  version: string;
  sections: ItemSection[];
  children: ItemChild[];
  comments: ItemComment[];
  commentsError?: string;
  attention?: AttentionEntry | null;
  ackedAt?: string;
}

// ---- Home (cockpit) -------------------------------------------------------------------------------------------
/** Minimal item reference used by the Home cards. `backlogId` = the visible backlog whose area contains the item, if any. */
export interface HomeItemRef { id: number; type: string; title: string; state: string; url: string; areaPath: string; backlogId: string | null }

export interface HomeComment extends HomeItemRef {
  /** where the item is listed: the area backlog or its To validate view */
  view: 'backlog' | 'validate';
  count: number; lastAuthor: string; lastDate: string; snippet: string;
}
export interface HomeCommentsResponse { items: HomeComment[]; errors: number; loadedAt: string }

/** Children counts of a Feature by state; Removed children are excluded. `other` = any other state. */
export interface StateCounts { new: number; active: number; resolved: number; closed: number; other: number; total: number }
export interface HomeFeature extends HomeItemRef {
  counts: StateCounts;
  children: (HomeItemRef & { assignedTo: string })[];
}
export interface HomeFeaturesResponse {
  /** my Active Features, ordered by id */
  active: HomeFeature[];
  /** my New Features (not started) */
  notStarted: (HomeItemRef & { childCount: number })[];
  loadedAt: string;
}

export interface HomeValidateEntry {
  backlogId: string; name: string; color: string;
  total: number; noPr: number; viaFeature: number;
  /** days since the oldest item was resolved, null when unknown */
  oldestDays: number | null;
  /** the 5 oldest items */
  items: (HomeItemRef & { waitDays: number | null; noPr: boolean; viaFeature: boolean })[];
  error?: string;
}
export interface HomeValidateResponse { backlogs: HomeValidateEntry[]; loadedAt: string }

export interface HomeTriageEntry {
  backlogId: string; name: string; color: string;
  total: number; byType: CountEntry[];
  /** up to 8 items, oldest (lowest id) first */
  items: HomeItemRef[];
  error?: string;
}
export interface HomeTriageResponse { backlogs: HomeTriageEntry[]; loadedAt: string }

export interface HomeNextVersionEntry {
  backlogId: string; name: string; color: string;
  counts: StateCounts; byType: CountEntry[];
  error?: string;
}
export interface HomeNextVersionResponse { tag: string; backlogs: HomeNextVersionEntry[]; loadedAt: string }

export interface HomeRecentItem extends HomeItemRef { changedBy: string; changedDate: string }
export interface HomeRecentResponse { days: number; items: HomeRecentItem[]; errors: number; loadedAt: string }
