import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import chokidar from 'chokidar';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { scanAllSessions, loadSession, getProjectsDir } from './lib/sessions.js';
import { detectClaudeProcesses } from './lib/processes.js';
import { aggregateStats, invalidateStatsCache } from './lib/stats.js';
import {
  aggregateCodexStats,
  getCodexSessionsDir,
  invalidateCodexStatsCache,
  loadCodexSession,
  scanCodexSessions,
} from './lib/codex.js';
import { getRegistry, getSkillDetail, getAgentDetail } from './lib/registry.js';
import { aggregateActivity } from './lib/activity.js';

async function buildSnapshot() {
  const [claudeSessions, codexSessions, processes, stats, statsCodex, registry] = await Promise.all([
    scanAllSessions(),
    scanCodexSessions().catch((err) => {
      console.error('[codex] live session scan failed:', err.message);
      return [];
    }),
    detectClaudeProcesses(),
    aggregateStats(),
    aggregateCodexStats().catch((err) => {
      console.error('[codex] stats aggregation failed:', err.message);
      return null;
    }),
    getRegistry(),
  ]);
  const sessions = [...claudeSessions, ...codexSessions].sort(
    (a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime(),
  );
  const activity = aggregateActivity(claudeSessions);
  return {
    sessions,
    processes,
    stats,
    statsCodex,
    activity,
    registry,
    scannedAt: new Date().toISOString(),
  };
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4173;
const HOST = process.env.HOST || '127.0.0.1';

const app = express();

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: [
          "'self'",
          `ws://localhost:${PORT}`,
          `ws://127.0.0.1:${PORT}`,
        ],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
);

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', apiLimiter);

app.use(express.static(join(__dirname, 'public')));

// Express 4 does not catch async rejections; route them to a JSON 500.
const handle = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error(`[api] ${req.path} failed:`, err.message);
    res.status(500).json({ error: 'internal error' });
  });

app.get('/api/sessions', handle(async (req, res) => {
  res.json(await buildSnapshot());
}));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, projectsDir: getProjectsDir() });
});

const SAFE_NAME_RE = /^[a-z0-9][a-z0-9_-]*$/i;

app.get('/api/skill/:slug', handle(async (req, res) => {
  if (!SAFE_NAME_RE.test(req.params.slug)) {
    return res.status(400).json({ error: 'invalid slug' });
  }
  const detail = await getSkillDetail(req.params.slug);
  if (!detail) return res.status(404).json({ error: 'not found' });
  res.json(detail);
}));

app.get('/api/agent/:domain/:slug', handle(async (req, res) => {
  if (!SAFE_NAME_RE.test(req.params.domain) || !SAFE_NAME_RE.test(req.params.slug)) {
    return res.status(400).json({ error: 'invalid name' });
  }
  const detail = await getAgentDetail(req.params.domain, req.params.slug);
  if (!detail) return res.status(404).json({ error: 'not found' });
  res.json(detail);
}));

const server = createServer(app);

const ALLOWED_WS_ORIGINS = new Set([
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
  `http://[::1]:${PORT}`,
]);

const wss = new WebSocketServer({
  server,
  path: '/ws',
  verifyClient: (info, cb) => {
    const origin = info.origin || '';
    if (!origin || ALLOWED_WS_ORIGINS.has(origin)) {
      cb(true);
    } else {
      cb(false, 403, 'forbidden origin');
    }
  },
});

const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));

  buildSnapshot()
    .then((snap) => {
      ws.send(JSON.stringify({ type: 'snapshot', ...snap }));
    })
    .catch((err) => console.error('[ws] initial snapshot failed:', err.message));
});

function broadcast(payload) {
  const data = JSON.stringify(payload);
  for (const client of clients) {
    if (client.readyState === 1) {
      client.send(data);
    }
  }
}

const REFRESH_DEBOUNCE_MS = 400;
let refreshTimer = null;
const pendingFiles = new Set();

const pendingLoaders = new Map();

function scheduleRefresh(filePath, loader = loadSession) {
  pendingFiles.add(filePath);
  pendingLoaders.set(filePath, loader);
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    const files = Array.from(pendingFiles);
    pendingFiles.clear();
    refreshTimer = null;
    for (const file of files) {
      try {
        const load = pendingLoaders.get(file) || loadSession;
        pendingLoaders.delete(file);
        const session = await load(file);
        if (session) {
          broadcast({ type: 'session-update', session });
        }
      } catch (err) {
        console.error(`[watch] failed to load ${file}:`, err.message);
      }
    }
  }, REFRESH_DEBOUNCE_MS);
}

const PERIODIC_REFRESH_MS = 5000;
// Stats come from 60 s caches and return the same object until they change,
// so unchanged stats are left out of the periodic push (clients keep theirs).
let lastSentStats = null;
let lastSentStatsCodex = null;

const periodicTimer = setInterval(async () => {
  try {
    const snap = await buildSnapshot();
    const msg = { type: 'snapshot', ...snap };
    if (snap.stats === lastSentStats) delete msg.stats;
    if (snap.statsCodex === lastSentStatsCodex) delete msg.statsCodex;
    lastSentStats = snap.stats;
    lastSentStatsCodex = snap.statsCodex;
    broadcast(msg);
  } catch (err) {
    console.error('[periodic] scan failed:', err.message);
  }
}, PERIODIC_REFRESH_MS);

const projectsDir = getProjectsDir();
const watcher = chokidar.watch(`${projectsDir.replace(/\\/g, '/')}/**/*.jsonl`, {
  ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
});

function onJsonlChange(filePath) {
  invalidateStatsCache();
  scheduleRefresh(filePath);
}

watcher.on('add', onJsonlChange);
watcher.on('change', onJsonlChange);
watcher.on('error', (err) => console.error('[watch] error:', err.message));

const codexSessionsDir = getCodexSessionsDir();
const codexDirGlob = codexSessionsDir.replace(/\\/g, '/');
const codexWatcher = chokidar.watch([`${codexDirGlob}/**/*.jsonl`, `${codexDirGlob}/**/*.jsonl.zst`], {
  ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
});

function onCodexJsonlChange(filePath) {
  invalidateCodexStatsCache();
  scheduleRefresh(filePath, loadCodexSession);
}

codexWatcher.on('add', onCodexJsonlChange);
codexWatcher.on('change', onCodexJsonlChange);
codexWatcher.on('error', (err) => console.error('[codex-watch] error:', err.message));

server.listen(PORT, HOST, () => {
  const displayHost = HOST === '127.0.0.1' || HOST === '::1' ? 'localhost' : HOST;
  console.log(`\n  AI Session Telemetry`);
  console.log(`  ─────────────────────────`);
  console.log(`  Watching: ${projectsDir}`);
  console.log(`  Bind:     ${HOST}:${PORT}`);
  console.log(`  Open:     http://${displayHost}:${PORT}\n`);
});

function shutdown() {
  console.log('\n  Shutting down...');
  clearInterval(periodicTimer);
  watcher.close();
  codexWatcher.close();
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
