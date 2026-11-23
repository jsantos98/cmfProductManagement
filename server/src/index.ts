import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { getBacklogDef, getConfig, getSettings, repoRoot, saveSettings, SettingsError } from './config.js';
import { TfsClient, TfsError } from './tfs/client.js';
import { afterMove, getCachedItem, getClient, getMe, getMetrics, getTags, loadBacklog, pruneCaches, rederive, replaceItem } from './backlog/service.js';
import { getItemDetails } from './backlog/service.js';
import { applyChanges } from './backlog/changes.js';
import { ackAttention, getAttention, unackAttention } from './backlog/attention.js';
import { getSummary, loadValidation, pruneValidationCaches, transition } from './backlog/validation.js';
import type { ChangesRequest, HealthResponse, SettingsDto, TransitionRequest } from './types.js';

const version = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(repoRoot, 'server', 'package.json'), 'utf8')).version ?? '0.0.0'; } catch { return '0.0.0'; }
})();

const cfg = getConfig();
const port = Number(process.env.PORT) || cfg.port;
const DEV_PORT = 5181;
const allowedOrigins = new Set([port, DEV_PORT].flatMap(p => [`http://127.0.0.1:${p}`, `http://localhost:${p}`]));

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

// CSRF-style guard for state-changing API calls
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const origin = req.headers.origin;
  if (req.headers['x-cmf-pm'] !== '1' || (origin && !allowedOrigins.has(origin))) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
});

const h = (fn: (req: Request, res: Response) => Promise<unknown> | unknown): RequestHandler =>
  (req, res, next) => { Promise.resolve(fn(req, res)).catch(next); };

app.get('/api/health', h(async (req, res) => {
  const caFile = process.env.NODE_EXTRA_CA_CERTS;
  const out: HealthResponse = {
    ok: false, tfsReachable: false, version,
    patPresent: !!process.env.AZURE_DEVOPS_PAT,
    caConfigured: !!caFile && fs.existsSync(caFile),
  };
  // ?quick=1: liveness only (used by the start scripts), no TFS round trip
  if (req.query.quick === '1') { out.ok = true; res.json(out); return; }
  if (out.patPresent) {
    try {
      out.identity = await new TfsClient(getConfig()).connectionData(AbortSignal.timeout(5000));
      out.tfsReachable = true;
    } catch (e) { out.error = (e as Error).message; }
  } else {
    out.error = 'AZURE_DEVOPS_PAT is not set';
  }
  out.ok = out.patPresent && out.tfsReachable;
  res.json(out);
}));

/** Resolve ?backlog=<id> (missing = first configured backlog). Sends 404 and returns null for an unknown id. */
function backlogId(req: Request, res: Response): string | null {
  const q = req.query.backlog;
  if (q === undefined || q === '') return getConfig().backlogs[0].id;
  const id = String(q);
  if (!getBacklogDef(id)) { res.status(404).json({ error: `Unknown backlog ${id}` }); return null; }
  return id;
}

app.get('/api/backlog', h(async (req, res) => { const b = backlogId(req, res); if (b) res.json(await loadBacklog(b, req.query.refresh === '1')); }));
app.get('/api/metrics', h(async (req, res) => { const b = backlogId(req, res); if (b) res.json(await getMetrics(b)); }));
app.get('/api/tags', h(async (req, res) => { const b = backlogId(req, res); if (b) res.json(await getTags(b)); }));
app.get('/api/attention', h(async (req, res) => {
  const b = backlogId(req, res);
  if (b) res.json(await getAttention(b, req.query.view === 'validate' ? 'validate' : undefined));
}));
app.get('/api/validation', h(async (req, res) => { const b = backlogId(req, res); if (b) res.json(await loadValidation(b, req.query.refresh === '1')); }));
app.get('/api/summary', h(async (_req, res) => { res.json(await getSummary()); }));
app.post('/api/validation/transition', h(async (req, res) => {
  const bid = backlogId(req, res);
  if (!bid) return;
  const body = req.body as TransitionRequest;
  const bad = (m: string): void => { res.status(400).json({ error: m }); };
  if (!Array.isArray(body?.items) || body.items.length === 0) return bad('items must be a non-empty array');
  if (!body.items.every(i => Number.isInteger(i?.id) && i.id > 0 && Number.isInteger(i?.rev))) return bad('each item needs a positive integer id and an integer rev');
  if (body.action !== 'close' && body.action !== 'reject') return bad('action must be close or reject');
  if (body.comment !== undefined && (typeof body.comment !== 'string' || body.comment.length > 4000)) return bad('comment must be a string of at most 4000 characters');
  res.json(await transition(bid, body, req.query.dryRun === '1'));
}));
function itemId(req: Request, res: Response): number | null {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: 'Invalid id' }); return null; }
  return id;
}
app.post('/api/attention/:id/ack', h((req, res) => { const id = itemId(req, res); if (id) res.json({ id, ackedAt: ackAttention(id) }); }));
app.delete('/api/attention/:id/ack', h((req, res) => { const id = itemId(req, res); if (id) { unackAttention(id); res.json({ id }); } }));
app.get('/api/items/:id', h(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: 'Invalid id' }); return; }
  res.json(await getItemDetails(id));
}));

app.post('/api/changes', h(async (req, res) => {
  const bid = backlogId(req, res);
  if (!bid) return;
  const body = req.body as ChangesRequest;
  if (!Array.isArray(body?.changes) || body.changes.length === 0) { res.status(400).json({ error: 'changes must be a non-empty array' }); return; }
  await loadBacklog(bid, false); // ensure the cache exists (revs/tags come from it)
  const dryRun = req.query.dryRun === '1';
  res.json(await applyChanges(body.changes, { dryRun, client: getClient(), cfg: getConfig(), getItem: id => getCachedItem(bid, id), replaceItem, afterMove: ids => afterMove(bid, ids), me: async () => (await getMe()).identity }));
}));

app.get('/api/settings', (_req, res) => { res.json(getSettings()); });
app.put('/api/settings', h((req, res) => {
  saveSettings(req.body as SettingsDto);
  pruneCaches();
  pruneValidationCaches();
  rederive();
  res.json(getSettings());
}));

const webDist = path.join(repoRoot, 'web', 'dist');
if (fs.existsSync(path.join(webDist, 'index.html'))) {
  app.use(express.static(webDist));
  app.get(/^\/(?!api\/).*/, (_req, res) => { res.sendFile(path.join(webDist, 'index.html')); });
}

app.use('/api', (_req, res) => { res.status(404).json({ error: 'Not found' }); });

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const e = err as Error & { status?: number; type?: string };
  const status = err instanceof SettingsError ? 400
    : err instanceof TfsError ? 502
    : e.type === 'entity.parse.failed' ? 400
    : 500;
  if (status >= 500) console.error(e.message);
  res.status(status).json({ error: e.message });
});

app.listen(port, '127.0.0.1', () => {
  const ca = process.env.NODE_EXTRA_CA_CERTS;
  console.log(`cmf backlog server v${version} on http://127.0.0.1:${port}`);
  console.log(`AZURE_DEVOPS_PAT: ${process.env.AZURE_DEVOPS_PAT ? 'set' : 'NOT SET'}`);
  if (!ca) console.warn(`WARNING: NODE_EXTRA_CA_CERTS is not set; TLS to TFS will fail (expected e.g. ${cfg.tfs.caCertPath})`);
  else if (!fs.existsSync(ca)) console.warn(`WARNING: NODE_EXTRA_CA_CERTS points to a missing file: ${ca}; TLS to TFS will fail`);
  else console.log(`NODE_EXTRA_CA_CERTS: ${ca}`);
  // warm the comment caches behind the tab badges (the first scan reads every commented item)
  if (process.env.AZURE_DEVOPS_PAT) {
    getSummary().then(() => console.log('Summary caches warmed'), (e: Error) => console.warn(`Summary warm-up failed: ${e.message}`));
  }
});
