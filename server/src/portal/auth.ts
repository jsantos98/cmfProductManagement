// Customer Portal sign-in: OAuth 2 authorization code + PKCE against the CM security portal.
// The access token lives in memory only; the refresh token (when issued) is kept in Windows Credential Manager
// (scripts/credstore.ps1), never in a file, log or API response.
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { getConfig, repoRoot } from '../config.js';

export class PortalAuthError extends Error {
  constructor(message: string, readonly notSignedIn = false) {
    super(message);
  }
}

const CRED_TARGET = 'cmfpm/customer-portal';
const credScript = path.join(repoRoot, 'scripts', 'credstore.ps1');
const PS = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';

function cred(action: 'get' | 'set' | 'delete', input?: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      PS,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', credScript, action, CRED_TARGET],
      { windowsHide: true, timeout: 20_000 },
      (err, stdout) => {
        if (err) {
          if (action === 'get' && (err as NodeJS.ErrnoException & { code?: number }).code === 2) return resolve(null);
          return reject(new Error(`Credential store ${action} failed`));
        }
        resolve(action === 'get' ? stdout : null);
      },
    );
    if (input !== undefined) child.stdin?.end(input);
    else child.stdin?.end();
  });
}

// ---- state --------------------------------------------------------------------------------------------------------

interface Tokens { access: string; expiresAt: number; refresh: string | null }
let tokens: Tokens | null = null;
/** refresh token loaded from the credential store at most once per process (null = none stored) */
let storedRefresh: string | null | undefined;
const pending = new Map<string, { verifier: string; at: number }>();
let refreshing: Promise<string> | null = null;

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const portalCfg = () => getConfig().portal;
export const redirectUri = () => `http://127.0.0.1:${getConfig().port}/api/portal/callback`;

/** Claims of a JWT for display (not verified; the portal verifies the token). */
function claims(jwt: string): Record<string, unknown> {
  try {
    return JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function tokenRequest(form: Record<string, string>): Promise<Tokens> {
  const c = portalCfg();
  const res = await fetch(c.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ client_id: c.clientId, ...form }).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let j: Record<string, unknown> = {};
  try {
    j = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* not JSON */
  }
  if (!res.ok || typeof j.access_token !== 'string') {
    const why = typeof j.error_description === 'string' ? j.error_description : typeof j.error === 'string' ? j.error : `HTTP ${res.status}`;
    throw new PortalAuthError(`Customer Portal sign-in failed: ${why}`, form.grant_type === 'refresh_token');
  }
  // log the shape only (never values) so a missing refresh token is visible in the server log
  console.log(`Customer Portal token response: ${Object.keys(j).sort().join(', ')}`);
  const expiresIn = typeof j.expires_in === 'number' ? j.expires_in : Number(j.expires_in) || 0;
  const exp = Number(claims(j.access_token).exp) || 0;
  const expiresAt = expiresIn > 0 ? Date.now() + expiresIn * 1000 : exp > 0 ? exp * 1000 : Date.now() + 30 * 60_000;
  return { access: j.access_token, expiresAt, refresh: typeof j.refresh_token === 'string' ? j.refresh_token : null };
}

async function remember(t: Tokens): Promise<void> {
  tokens = t;
  if (t.refresh && t.refresh !== storedRefresh) {
    try {
      await cred('set', t.refresh);
      storedRefresh = t.refresh;
    } catch (e) {
      console.warn(`Could not remember the Customer Portal sign-in: ${(e as Error).message}`);
    }
  }
}

// ---- login flow ---------------------------------------------------------------------------------------------------

/** URL of the portal login page for a new PKCE flow. */
export function loginUrl(): string {
  const c = portalCfg();
  const verifier = b64url(crypto.randomBytes(32));
  const state = b64url(crypto.randomBytes(16));
  const now = Date.now();
  for (const [k, v] of pending) if (now - v.at > 10 * 60_000) pending.delete(k);
  pending.set(state, { verifier, at: now });
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: c.clientId,
    redirect_uri: redirectUri(),
    scope: c.scope,
    state,
    code_challenge: b64url(crypto.createHash('sha256').update(verifier).digest()),
    code_challenge_method: 'S256',
  });
  return `${c.authorizeEndpoint}?${q.toString()}`;
}

/** Completes the flow with the code the portal sent back. */
export async function completeLogin(code: string, state: string | undefined): Promise<void> {
  // Some IdPs drop `state` on the way back. PKCE still binds the code to the verifier only this server holds,
  // so a missing state is accepted when exactly one recent sign-in is pending.
  let key = state;
  if (!key && pending.size === 1) key = [...pending.keys()][0];
  const p = key ? pending.get(key) : undefined;
  if (!p || !key) throw new PortalAuthError(`Sign-in expired or was started elsewhere; please try again. (${state ? 'unknown state' : 'no state returned'}, ${pending.size} pending)`);
  pending.delete(key);
  await remember(await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(), code_verifier: p.verifier }));
}

/** A valid access token, refreshing it (or restoring the remembered sign-in) when needed. */
export async function accessToken(force = false): Promise<string> {
  if (!force && tokens && tokens.expiresAt - Date.now() > 60_000) return tokens.access;
  if (!refreshing) {
    refreshing = (async () => {
      if (storedRefresh === undefined) {
        try {
          storedRefresh = await cred('get');
        } catch {
          storedRefresh = null;
        }
      }
      const rt = tokens?.refresh ?? storedRefresh;
      if (!rt) throw new PortalAuthError('Not signed in to the Customer Portal.', true);
      try {
        const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: rt });
        if (!t.refresh) t.refresh = rt; // some servers do not rotate refresh tokens
        await remember(t);
        return t.access;
      } catch (e) {
        tokens = null;
        if ((e as PortalAuthError).notSignedIn) {
          storedRefresh = null;
          await cred('delete').catch(() => undefined);
          throw new PortalAuthError('Customer Portal sign-in expired; please sign in again.', true);
        }
        throw e;
      }
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

export interface PortalStatus { signedIn: boolean; user?: string; email?: string; expiresAt?: string; remembered: boolean; error?: string }

export async function status(): Promise<PortalStatus> {
  try {
    const tok = await accessToken();
    const c = claims(tok);
    const name = [c.name, c.given_name && c.family_name ? `${c.given_name} ${c.family_name}` : '', c.sub].find((v) => typeof v === 'string' && v);
    return {
      signedIn: true,
      user: typeof name === 'string' ? name : undefined,
      email: typeof c.email === 'string' ? c.email : typeof c.upn === 'string' ? c.upn : undefined,
      expiresAt: tokens ? new Date(tokens.expiresAt).toISOString() : undefined,
      remembered: !!storedRefresh,
    };
  } catch (e) {
    const err = e as PortalAuthError;
    return { signedIn: false, remembered: false, error: err.notSignedIn ? undefined : err.message };
  }
}

export async function logout(): Promise<void> {
  tokens = null;
  storedRefresh = null;
  await cred('delete').catch(() => undefined);
}
