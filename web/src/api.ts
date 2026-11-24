import type {
  AttentionResponse,
  BacklogResponse,
  ChangesRequest,
  ChangesResponse,
  HealthResponse,
  HomeCommentsResponse,
  HomeFeaturesResponse,
  HomeNextVersionResponse,
  HomeRecentResponse,
  HomeTriageResponse,
  HomeValidateResponse,
  ItemDetails,
  MetricsResponse,
  SettingsDto,
  SummaryResponse,
  TagsResponse,
  TransitionRequest,
  ValidationResponse,
} from '../../server/src/types';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET', body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET') headers['X-CMF-PM'] = '1';
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (e) {
    throw new ApiError(`Network error: ${e instanceof Error ? e.message : String(e)}`, 0);
  }
  const text = await res.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
  }
  if (!res.ok) {
    const msg =
      data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `${res.status} ${res.statusText}`;
    throw new ApiError(msg, res.status);
  }
  return data as T;
}

export const api = {
  health: () => request<HealthResponse>('/api/health'),
  backlog: (id: string, refresh = false) =>
    request<BacklogResponse>(`/api/backlog?backlog=${encodeURIComponent(id)}${refresh ? '&refresh=1' : ''}`),
  metrics: (id: string) => request<MetricsResponse>(`/api/metrics?backlog=${encodeURIComponent(id)}`),
  item: (id: number) => request<ItemDetails>(`/api/items/${id}`),
  tags: (id: string) => request<TagsResponse>(`/api/tags?backlog=${encodeURIComponent(id)}`),
  changes: (id: string, req: ChangesRequest, dryRun: boolean) =>
    request<ChangesResponse>(`/api/changes?backlog=${encodeURIComponent(id)}${dryRun ? '&dryRun=1' : ''}`, 'POST', req),
  attention: (id: string, view?: 'validate') =>
    request<AttentionResponse>(`/api/attention?backlog=${encodeURIComponent(id)}${view ? `&view=${view}` : ''}`),
  validation: (id: string, refresh = false) =>
    request<ValidationResponse>(`/api/validation?backlog=${encodeURIComponent(id)}${refresh ? '&refresh=1' : ''}`),
  transition: (id: string, req: TransitionRequest, dryRun = false) =>
    request<ChangesResponse>(`/api/validation/transition?backlog=${encodeURIComponent(id)}${dryRun ? '&dryRun=1' : ''}`, 'POST', req),
  summary: () => request<SummaryResponse>('/api/summary'),
  ackAttention: (id: number) => request<{ id: number; ackedAt: string }>(`/api/attention/${id}/ack`, 'POST'),
  unackAttention: (id: number) => request<{ id: number }>(`/api/attention/${id}/ack`, 'DELETE'),
  home: {
    comments: (refresh = false) => request<HomeCommentsResponse>(`/api/home/comments${refresh ? '?refresh=1' : ''}`),
    features: (refresh = false) => request<HomeFeaturesResponse>(`/api/home/features${refresh ? '?refresh=1' : ''}`),
    validate: (refresh = false) => request<HomeValidateResponse>(`/api/home/validate${refresh ? '?refresh=1' : ''}`),
    triage: (refresh = false) => request<HomeTriageResponse>(`/api/home/triage${refresh ? '?refresh=1' : ''}`),
    nextVersion: (refresh = false) => request<HomeNextVersionResponse>(`/api/home/next-version${refresh ? '?refresh=1' : ''}`),
    recent: (refresh = false) => request<HomeRecentResponse>(`/api/home/recent${refresh ? '?refresh=1' : ''}`),
  },
  getSettings: () => request<SettingsDto>('/api/settings'),
  putSettings: (s: SettingsDto) => request<unknown>('/api/settings', 'PUT', s),
};
