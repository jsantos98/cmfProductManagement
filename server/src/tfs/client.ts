import type { AppConfig } from '../types.js';

export interface RawItem {
  id: number;
  rev: number;
  fields: Record<string, any>;
  relations?: any[];
}

export interface PatchOp {
  op: 'add' | 'replace' | 'remove' | 'test';
  path: string;
  value?: unknown;
}

/** Subset of TfsClient used by the services, so tests can inject a fake. */
export interface TfsApi {
  wiql(query: string): Promise<number[]>;
  getItems(ids: number[], fields: string[]): Promise<RawItem[]>;
  patch(id: number, ops: PatchOp[], opts?: { validateOnly?: boolean }): Promise<RawItem>;
  /** Relations per work item id (optional: absent in fakes, meaning "relations unknown"). */
  getRelations?(ids: number[]): Promise<Map<number, any[]>>;
  getPullRequest?(repoId: string, id: number): Promise<any>;
}

export class TfsError extends Error {
  constructor(message: string, public status?: number) { super(message); }
}

export class TfsClient implements TfsApi {
  private base: string;
  private auth: string;
  private api: string;

  constructor(private config: AppConfig, pat: string | undefined = process.env.AZURE_DEVOPS_PAT) {
    if (!pat) throw new TfsError('AZURE_DEVOPS_PAT is not set');
    this.base = `${config.tfs.serverUrl}/${config.tfs.collection}`;
    this.api = `api-version=${config.tfs.apiVersion}`;
    this.auth = 'Basic ' + Buffer.from(':' + pat).toString('base64');
  }

  private async request<T>(method: string, url: string, body?: unknown, contentType = 'application/json', signal?: AbortSignal): Promise<T> {
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: { Authorization: this.auth, Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': contentType } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal,
      });
    } catch (e: any) {
      const cause = e?.cause?.code ?? e?.cause?.message ?? '';
      throw new TfsError(`TFS request failed: ${e?.message ?? e}${cause ? ` (${cause})` : ''}`);
    }
    const text = await res.text();
    if (!res.ok) {
      let msg = text.slice(0, 300);
      try { msg = JSON.parse(text).message ?? msg; } catch { /* not JSON */ }
      throw new TfsError(`TFS HTTP ${res.status}: ${msg}`, res.status);
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new TfsError(`TFS returned a non-JSON response (HTTP ${res.status}); check URL/authentication`, res.status);
    }
  }

  async connectionData(signal?: AbortSignal): Promise<string> {
    const r = await this.request<any>('GET', `${this.base}/_apis/connectionData`, undefined, undefined, signal);
    return r?.authenticatedUser?.providerDisplayName ?? '';
  }

  /**
   * Signed-in user as a TFS identity string usable in identity fields: "Display Name <DOMAIN\user>".
   * connectionData has no domain, so the unique name is read from a work item assigned to @Me;
   * without one, the display name alone is used (TFS resolves it when unique).
   */
  async me(): Promise<{ displayName: string; identity: string; id: string }> {
    const r = await this.request<any>('GET', `${this.base}/_apis/connectionData`);
    const displayName: string = r?.authenticatedUser?.providerDisplayName ?? '';
    if (!displayName) throw new TfsError('Cannot determine the signed-in user');
    let uniqueName = '';
    try {
      const ids = await this.wiql('SELECT [System.Id] FROM WorkItems WHERE [System.AssignedTo] = @Me ORDER BY [System.ChangedDate] DESC');
      if (ids.length) {
        const [w] = await this.getItems(ids.slice(0, 1), ['System.AssignedTo']);
        uniqueName = w?.fields['System.AssignedTo']?.uniqueName ?? '';
      }
    } catch { /* fall back to the display name */ }
    return { displayName, id: String(r?.authenticatedUser?.id ?? ''), identity: uniqueName ? `${displayName} <${uniqueName}>` : displayName };
  }

  async wiql(query: string): Promise<number[]> {
    const url = `${this.base}/${this.config.tfs.project}/_apis/wit/wiql?${this.api}`;
    const r = await this.request<any>('POST', url, { query });
    return (r.workItems ?? []).map((w: any) => w.id as number);
  }

  async getItems(ids: number[], fields: string[]): Promise<RawItem[]> {
    const byId = new Map<number, RawItem>();
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const r = await this.request<any>('POST', `${this.base}/_apis/wit/workitemsbatch?${this.api}`, { ids: chunk, fields, errorPolicy: 'omit' });
      for (const w of r.value ?? []) if (w) byId.set(w.id, { id: w.id, rev: w.rev, fields: w.fields ?? {} });
    }
    return ids.filter(id => byId.has(id)).map(id => byId.get(id)!);
  }

  /** Relations of work items (the batch endpoint cannot return fields and relations together). */
  async getRelations(ids: number[]): Promise<Map<number, any[]>> {
    const out = new Map<number, any[]>();
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const r = await this.request<any>('POST', `${this.base}/_apis/wit/workitemsbatch?${this.api}`, { ids: chunk, $expand: 'Relations', errorPolicy: 'omit' });
      for (const w of r.value ?? []) if (w) out.set(w.id, w.relations ?? []);
    }
    return out;
  }

  async getPullRequest(repoId: string, id: number): Promise<any> {
    return this.request<any>('GET', `${this.base}/${this.config.tfs.project}/_apis/git/repositories/${encodeURIComponent(repoId)}/pullrequests/${id}?${this.api}`);
  }

  async getItem(id: number): Promise<RawItem> {
    const w = await this.request<any>('GET', `${this.base}/_apis/wit/workitems/${id}?$expand=relations&api-version=6.0`);
    return { id: w.id, rev: w.rev, fields: w.fields ?? {}, relations: w.relations ?? [] };
  }

  /** Raw comments payload; callers treat failures as best-effort. */
  async getComments(id: number, top = 20): Promise<unknown> {
    return this.request<unknown>('GET', `${this.base}/${this.config.tfs.project}/_apis/wit/workItems/${id}/comments?$top=${top}&api-version=6.0-preview.3`);
  }

  async patch(id: number, ops: PatchOp[], opts: { validateOnly?: boolean } = {}): Promise<RawItem> {
    const url = `${this.base}/_apis/wit/workitems/${id}?${this.api}${opts.validateOnly ? '&validateOnly=true' : ''}`;
    const w = await this.request<any>('PATCH', url, ops, 'application/json-patch+json');
    return { id: w.id, rev: w.rev, fields: w.fields ?? {} };
  }
}
