import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateActivity } from '../lib/activity.js';

const sessions = [
  {
    sessionId: 's1',
    projectName: 'alpha',
    subagents: [
      { type: 'Explore', timestamp: '2026-10-21T08:00:00Z', completed: true, durationMs: 1000 },
      { type: 'Explore', timestamp: '2026-10-21T09:00:00Z', completed: false },
    ],
    skills: [{ name: 'roast', timestamp: '2026-10-21T08:30:00Z' }],
  },
  {
    sessionId: 's2',
    projectName: null,
    subagents: [{ type: 'Plan', timestamp: '2026-10-21T07:00:00Z', completed: true, durationMs: 500 }],
  },
];

test('aggregateActivity groups subagents by type with active and duration totals', () => {
  const { agents } = aggregateActivity(sessions);
  assert.deepEqual(agents.map((a) => a.type), ['Explore', 'Plan']);
  const explore = agents[0];
  assert.equal(explore.totalCount, 2);
  assert.equal(explore.activeCount, 1);
  assert.equal(explore.totalDurationMs, 1000);
  assert.equal(explore.lastSeen, '2026-10-21T09:00:00Z');
  assert.deepEqual(explore.parents, [
    { sessionId: 's1', projectName: 'alpha', count: 2, activeCount: 1 },
  ]);
});

test('aggregateActivity sorts the timeline newest first and names unknown projects', () => {
  const { timeline, skills } = aggregateActivity(sessions);
  assert.deepEqual(
    timeline.map((t) => t.timestamp),
    ['2026-10-21T09:00:00Z', '2026-10-21T08:30:00Z', '2026-10-21T08:00:00Z', '2026-10-21T07:00:00Z'],
  );
  assert.equal(timeline.at(-1).projectName, 'unknown');
  assert.equal(skills[0].name, 'roast');
});

test('aggregateActivity handles no sessions', () => {
  assert.deepEqual(aggregateActivity([]), { agents: [], skills: [], timeline: [] });
});
