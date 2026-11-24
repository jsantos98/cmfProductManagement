// Customer Portal REST client: the same `/api/<Service>/<Method>` calls the portal web app makes, signed with the
// user's own token (see auth.ts). Inputs carry the MES `$type` the portal expects.
import { getConfig } from '../config.js';
import { accessToken, PortalAuthError } from './auth.js';

export class PortalApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** `Cmf.CustomerPortal.Orchestration.<area>.InputObjects.<method>Input, Cmf.CustomerPortal.Orchestration` */
export const inputType = (area: string, method: string) =>
  `Cmf.CustomerPortal.Orchestration.${area}.InputObjects.${method}Input, Cmf.CustomerPortal.Orchestration`;

async function send(url: string, body: string, token: string): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
    body,
    signal: AbortSignal.timeout(30_000),
  });
}

/** POST {baseUrl}/api/{service}/{method}; retries once with a refreshed token after a 401. */
export async function portalCall<T>(service: string, method: string, area: string, input: Record<string, unknown>): Promise<T> {
  const url = `${getConfig().portal.baseUrl}/api/${service}/${method}`;
  const body = JSON.stringify({ $id: '1', $type: inputType(area, method), ...input });
  let res = await send(url, body, await accessToken());
  if (res.status === 401) res = await send(url, body, await accessToken(true));
  const text = await res.text();
  if (res.status === 401) throw new PortalAuthError('The Customer Portal refused the sign-in; please sign in again.', true);
  if (!res.ok) {
    let why = `HTTP ${res.status}`;
    try {
      const j = JSON.parse(text) as { Message?: string; message?: string; ExceptionMessage?: string };
      why = j.Message ?? j.message ?? j.ExceptionMessage ?? why;
    } catch {
      /* not JSON */
    }
    throw new PortalApiError(`Customer Portal ${service}/${method} failed: ${why}`, res.status);
  }
  return JSON.parse(text) as T;
}
