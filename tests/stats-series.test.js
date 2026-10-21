import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStatsData } from '../lib/stats.js';

const localDay = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toLocaleDateString('sv-SE');
};

const hourKey = (d) =>
  `${d.toLocaleDateString('sv-SE')}T${String(d.getHours()).padStart(2, '0')}`;

function buckets() {
  const today = localDay(0);
  const old = localDay(-30);
  const now = new Date();
  const oldHour = new Date(Date.now() - 20 * 24 * 3600 * 1000);
  const models = (entries) => new Map(entries.map(([m, tokens, cost]) => [m, { tokens, cost }]));
  return {
    byProject: new Map(),
    byDay: new Map([[today, 300], [old, 50]]),
    byDayCost: new Map([[today, 3], [old, 0.5]]),
    byDayModel: new Map([[today, models([['opus', 200, 2.5], ['haiku', 100, 0.5]])], [old, models([['opus', 50, 0.5]])]]),
    byDayProject: new Map([[today, models([['alpha', 250, 2.6], ['beta', 50, 0.4]])], [old, models([['alpha', 50, 0.5]])]]),
    byHour: new Map([[hourKey(now), 300], [hourKey(oldHour), 50]]),
    byHourCost: new Map([[hourKey(now), 3], [hourKey(oldHour), 0.5]]),
    byHourModel: new Map([[hourKey(now), models([['opus', 300, 3]])]]),
  };
}

test('buildStatsData emits a daily series with model and project breakdowns', () => {
  const { daily } = buildStatsData(buckets(), { labelFor: (m) => m.toUpperCase() });
  assert.deepEqual(daily.map((d) => d.date), [localDay(-30), localDay(0)]);
  const today = daily[1];
  assert.equal(today.tokens, 300);
  assert.equal(today.cost, 3);
  assert.deepEqual(today.models.map((m) => [m.model, m.label, m.tokens]), [
    ['opus', 'OPUS', 200],
    ['haiku', 'HAIKU', 100],
  ]);
  assert.deepEqual(today.projects, [
    { name: 'alpha', tokens: 250, cost: 2.6, isMemory: false },
    { name: 'beta', tokens: 50, cost: 0.4, isMemory: false },
  ]);
});

test('buildStatsData emits hourly data for the last 14 days only', () => {
  const { hourly } = buildStatsData(buckets(), {});
  assert.equal(hourly.length, 1);
  assert.equal(hourly[0].key, hourKey(new Date()));
  assert.equal(hourly[0].tokens, 300);
  assert.equal(hourly[0].models[0].model, 'opus');
});

test('buildStatsData flags memory-infra projects in the daily series', () => {
  const b = buckets();
  b.byProject.set('obs/alpha', { isMemory: true });
  b.byDayProject.get(localDay(0)).set('obs/alpha', { tokens: 10, cost: 0.1 });
  const { daily } = buildStatsData(b, {});
  const mem = daily[1].projects.find((p) => p.name === 'obs/alpha');
  assert.equal(mem.isMemory, true);
});
