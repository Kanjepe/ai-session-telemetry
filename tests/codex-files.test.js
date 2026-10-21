import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zstdCompressSync } from 'node:zlib';
import { isRolloutFile, readRolloutFile, listRolloutFiles } from '../lib/codex.js';

const LINE = JSON.stringify({ type: 'session_meta', payload: { id: 'abc' } });

test('isRolloutFile accepts plain and zstd-compressed rollouts only', () => {
  assert.equal(isRolloutFile('rollout-1.jsonl'), true);
  assert.equal(isRolloutFile('2026/07/06/rollout-1.jsonl.zst'), true);
  assert.equal(isRolloutFile('notes.txt'), false);
  assert.equal(isRolloutFile('rollout-1.zst'), false);
});

test('readRolloutFile returns the same text for .jsonl and .jsonl.zst', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'codex-files-'));
  const plain = join(dir, 'a.jsonl');
  const packed = join(dir, 'b.jsonl.zst');
  await writeFile(plain, LINE);
  await writeFile(packed, zstdCompressSync(Buffer.from(LINE)));
  assert.equal(await readRolloutFile(plain), LINE);
  assert.equal(await readRolloutFile(packed), LINE);
});

test('listRolloutFiles walks nested day folders and returns file stats', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-list-'));
  const day = join(root, '2026', '07', '06');
  await mkdir(day, { recursive: true });
  await writeFile(join(day, 'rollout-a.jsonl'), LINE);
  await writeFile(join(day, 'rollout-b.jsonl.zst'), zstdCompressSync(Buffer.from(LINE)));
  await writeFile(join(day, 'ignore.txt'), 'x');

  const files = await listRolloutFiles(root);
  const names = files.map((f) => f.filePath.split(/[\\/]/).pop()).sort();
  assert.deepEqual(names, ['rollout-a.jsonl', 'rollout-b.jsonl.zst']);
  assert.ok(files.every((f) => typeof f.fileStats.mtimeMs === 'number'));
});

test('listRolloutFiles returns an empty list for a missing folder', async () => {
  assert.deepEqual(await listRolloutFiles(join(tmpdir(), 'does-not-exist-xyz')), []);
});
