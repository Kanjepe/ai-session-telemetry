import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeProviders,
  periodRange,
  shiftAnchor,
  summarizePeriod,
  yearHeatmap,
} from '../public/js/stats-model.js';

const m = (model, tokens, cost) => ({ model, label: model, tokens, cost });
const p = (name, tokens, cost) => ({ name, tokens, cost, isMemory: false });

const data = {
  daily: [
    { date: '2026-10-13', tokens: 100, cost: 1, models: [m('opus', 100, 1)], projects: [p('alpha', 100, 1)] },
    { date: '2026-10-19', tokens: 200, cost: 4, models: [m('opus', 150, 3), m('haiku', 50, 1)], projects: [p('alpha', 50, 1), p('beta', 150, 3)] },
    { date: '2026-10-21', tokens: 300, cost: 6, models: [m('opus', 300, 6)], projects: [p('alpha', 300, 6)] },
  ],
  hourly: [
    { key: '2026-10-21T09', tokens: 100, cost: 2, models: [m('opus', 100, 2)] },
    { key: '2026-10-21T10', tokens: 200, cost: 4, models: [m('opus', 200, 4)] },
  ],
};

// Wednesday 2026-10-21, 12:00 local.
const NOW = new Date(2026, 9, 21, 12, 0, 0).getTime();

test('periodRange returns half-open ranges with Monday-based weeks', () => {
  assert.deepEqual(periodRange('day', '2026-10-21'), { start: '2026-10-21', end: '2026-10-22' });
  assert.deepEqual(periodRange('week', '2026-10-21'), { start: '2026-10-19', end: '2026-10-26' });
  assert.deepEqual(periodRange('month', '2026-10-21'), { start: '2026-10-01', end: '2026-11-01' });
  assert.deepEqual(periodRange('year', '2026-10-21'), { start: '2026-01-01', end: '2027-01-01' });
});

test('shiftAnchor moves by whole periods', () => {
  assert.equal(shiftAnchor('day', '2026-10-01', -1), '2026-09-30');
  assert.equal(shiftAnchor('week', '2026-10-21', -1), '2026-10-12');
  assert.equal(shiftAnchor('month', '2026-03-31', -1), '2026-02-01');
  assert.equal(shiftAnchor('year', '2026-10-21', 1), '2027-01-01');
});

test('summarizePeriod week: totals, breakdowns and 7 labelled bars', () => {
  const s = summarizePeriod(data, 'week', '2026-10-21', NOW);
  assert.equal(s.tokens, 500);
  assert.equal(s.cost, 10);
  assert.equal(s.isCurrent, true);
  assert.deepEqual(s.series.map((b) => b.label), ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
  assert.deepEqual(s.series.map((b) => b.cost), [4, 0, 6, 0, 0, 0, 0]);
  assert.equal(s.series[2].isCurrent, true);
  assert.equal(s.series[3].isFuture, true);
  assert.deepEqual(s.models.map((x) => [x.model, x.cost]), [['opus', 9], ['haiku', 1]]);
  assert.deepEqual(s.projects.map((x) => [x.name, x.cost]), [['alpha', 7], ['beta', 3]]);
});

test('summarizePeriod compares with the previous period up to the same point', () => {
  const s = summarizePeriod(data, 'week', '2026-10-21', NOW);
  // Previous week Mon–Wed (13–15 Oct) cost 1; this week so far 10.
  assert.equal(s.prevCost, 1);
  assert.equal(s.deltaPct, 900);
});

test('summarizePeriod forecasts the current period from elapsed time', () => {
  const s = summarizePeriod(data, 'day', '2026-10-21', NOW);
  assert.equal(s.cost, 6);
  assert.equal(s.forecastCost, 12); // half the day gone
  const past = summarizePeriod(data, 'day', '2026-10-19', NOW);
  assert.equal(past.forecastCost, null);
});

test('summarizePeriod day uses hourly bars and flags missing hourly history', () => {
  const s = summarizePeriod(data, 'day', '2026-10-21', NOW);
  assert.equal(s.series.length, 24);
  assert.equal(s.series[10].cost, 4);
  assert.equal(s.hourlyMissing, false);
  const old = summarizePeriod(data, 'day', '2026-10-13', NOW);
  assert.equal(old.hourlyMissing, true);
});

test('summarizePeriod year has 12 month bars', () => {
  const s = summarizePeriod(data, 'year', '2026-10-21', NOW);
  assert.equal(s.series.length, 12);
  assert.equal(s.series[9].label, 'oct');
  assert.equal(s.series[9].cost, 11);
});

test('mergeProviders sums days and hours across providers', () => {
  const other = {
    daily: [{ date: '2026-10-21', tokens: 10, cost: 1, models: [m('gpt', 10, 1)], projects: [p('alpha', 10, 1)] }],
    hourly: [{ key: '2026-10-21T10', tokens: 10, cost: 1, models: [m('gpt', 10, 1)] }],
  };
  const merged = mergeProviders([data, other, null]);
  const day = merged.daily.find((d) => d.date === '2026-10-21');
  assert.equal(day.cost, 7);
  assert.deepEqual(day.models.map((x) => x.model), ['opus', 'gpt']);
  assert.deepEqual(day.projects, [p('alpha', 310, 7)]);
  assert.equal(merged.hourly.find((h) => h.key === '2026-10-21T10').cost, 5);
});

test('yearHeatmap lays out 53 Monday-first weeks with cost levels', () => {
  const { weeks } = yearHeatmap(data.daily, '2026-10-21');
  assert.equal(weeks.length, 53);
  assert.ok(weeks.every((w) => w.length === 7));
  const cells = weeks.flat().filter(Boolean);
  const today = cells.find((c) => c.date === '2026-10-21');
  assert.equal(today.level, 4);
  assert.equal(cells.find((c) => c.date === '2026-10-20').level, 0);
  assert.equal(cells.at(-1).date, '2026-10-21'); // nothing after today
});

test('summarizePeriod withholds forecast and change when data does not cover the period', () => {
  const s = summarizePeriod(data, 'year', '2026-10-21', NOW);
  assert.equal(s.coverageStart, '2026-10-13');
  assert.equal(s.partialData, true);
  assert.equal(s.forecastCost, null);
  assert.equal(s.deltaPct, null);
  const week = summarizePeriod(data, 'week', '2026-10-21', NOW);
  assert.equal(week.partialData, false);
  assert.notEqual(week.forecastCost, null);
});
