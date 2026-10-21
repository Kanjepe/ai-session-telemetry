import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listRolloutFiles } from '../lib/codex.js';

// Guards against the August regression where a sequential scan of
// ~/.codex/sessions made the server take 78 s to start.
const DAYS = 200;
const FILES_PER_DAY = 10;
const BUDGET_MS = 3000;

test(`listRolloutFiles scans ${DAYS * FILES_PER_DAY} rollouts within ${BUDGET_MS} ms`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-perf-'));
  const writes = [];
  for (let d = 0; d < DAYS; d++) {
    const day = join(root, '2026', String(1 + (d % 12)).padStart(2, '0'), String(d).padStart(3, '0'));
    await mkdir(day, { recursive: true });
    for (let f = 0; f < FILES_PER_DAY; f++) {
      writes.push(writeFile(join(day, `rollout-${d}-${f}.jsonl${f % 2 ? '.zst' : ''}`), '{}'));
    }
  }
  await Promise.all(writes);

  const t0 = performance.now();
  const files = await listRolloutFiles(root);
  const elapsed = performance.now() - t0;

  assert.equal(files.length, DAYS * FILES_PER_DAY);
  assert.ok(elapsed < BUDGET_MS, `scan took ${Math.round(elapsed)} ms`);
});
