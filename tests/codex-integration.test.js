import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const appSource = ['app.js', 'js/state.js', 'js/sessions-view.js']
  .map((file) => readFileSync(join(rootDir, 'public', file), 'utf8'))
  .join('\n');
const indexSource = readFileSync(join(rootDir, 'public', 'index.html'), 'utf8');
const serverSource = readFileSync(join(rootDir, 'server.js'), 'utf8');

test('server includes Codex live sessions and refreshes changed rollouts', () => {
  assert.match(
    serverSource,
    /scanCodexSessions/,
  );
  assert.match(serverSource, /loadCodexSession/);
  assert.match(serverSource, /\.\.\.codexSessions/);
  assert.match(serverSource, /const codexWatcher = chokidar\.watch\(/);
  assert.match(serverSource, /codexWatcher\.on\('add', onCodexJsonlChange\);/);
  assert.match(serverSource, /codexWatcher\.on\('change', onCodexJsonlChange\);/);
  assert.match(serverSource, /invalidateCodexStatsCache\(\);/);
  assert.match(serverSource, /broadcast\(\{ type: 'session-update', session \}\);/);
  assert.match(serverSource, /codexWatcher\.close\(\);/);
});

test('live session UI has provider filters, provider labels, and collision-safe keys', () => {
  assert.match(indexSource, /data-session-provider="all"[^>]*data-active="true"/);
  assert.match(indexSource, /data-session-provider="claude"/);
  assert.match(indexSource, /data-session-provider="codex"/);
  assert.match(appSource, /function sessionKey\(session\)/);
  assert.match(appSource, /`\$\{session\.provider\}:\$\{session\.sessionId\}`/);
  assert.match(appSource, /entry__provider/);
  assert.match(appSource, /state\.sessionProviderView === 'all'/);
});

test('Codex aggregation failures cannot prevent Claude snapshots', () => {
  assert.match(
    serverSource,
    /aggregateCodexStats\(\)\.catch\(\(err\) => \{[\s\S]*?return null;[\s\S]*?\}\),/,
  );
});
