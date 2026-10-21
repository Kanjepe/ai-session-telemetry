// Groups subagent and skill usage across Claude sessions for the activity view.
export function aggregateActivity(sessions) {
  const agentsByType = new Map();
  const skillsByName = new Map();
  const timeline = [];

  for (const s of sessions) {
    const parentName = s.projectName || 'unknown';

    for (const sub of s.subagents || []) {
      let bucket = agentsByType.get(sub.type);
      if (!bucket) {
        bucket = {
          type: sub.type,
          activeCount: 0,
          totalCount: 0,
          totalDurationMs: 0,
          completedCount: 0,
          parents: new Map(),
          history: [],
          lastSeen: '',
        };
        agentsByType.set(sub.type, bucket);
      }
      bucket.totalCount += 1;
      if (!sub.completed) bucket.activeCount += 1;
      if (sub.completed && sub.durationMs != null) {
        bucket.totalDurationMs += sub.durationMs;
        bucket.completedCount += 1;
      }
      bucket.history.push({ t: sub.timestamp });
      if (!bucket.lastSeen || sub.timestamp > bucket.lastSeen) {
        bucket.lastSeen = sub.timestamp;
      }

      let parent = bucket.parents.get(s.sessionId);
      if (!parent) {
        parent = { sessionId: s.sessionId, projectName: parentName, count: 0, activeCount: 0 };
        bucket.parents.set(s.sessionId, parent);
      }
      parent.count += 1;
      if (!sub.completed) parent.activeCount += 1;

      timeline.push({
        kind: 'agent',
        timestamp: sub.timestamp,
        name: sub.type,
        description: sub.description,
        completed: sub.completed,
        durationMs: sub.durationMs,
        sessionId: s.sessionId,
        projectName: parentName,
      });
    }

    for (const sk of s.skills || []) {
      let bucket = skillsByName.get(sk.name);
      if (!bucket) {
        bucket = {
          name: sk.name,
          totalCount: 0,
          parents: new Map(),
          history: [],
          lastSeen: '',
        };
        skillsByName.set(sk.name, bucket);
      }
      bucket.totalCount += 1;
      bucket.history.push({ t: sk.timestamp });
      if (!bucket.lastSeen || sk.timestamp > bucket.lastSeen) {
        bucket.lastSeen = sk.timestamp;
      }

      let parent = bucket.parents.get(s.sessionId);
      if (!parent) {
        parent = { sessionId: s.sessionId, projectName: parentName, count: 0 };
        bucket.parents.set(s.sessionId, parent);
      }
      parent.count += 1;

      timeline.push({
        kind: 'skill',
        timestamp: sk.timestamp,
        name: sk.name,
        sessionId: s.sessionId,
        projectName: parentName,
      });
    }
  }

  const newestFirst = (a, b) => String(b || '').localeCompare(String(a || ''));
  timeline.sort((a, b) => newestFirst(a.timestamp, b.timestamp));

  const finalize = (bucket) => ({
    ...bucket,
    parents: Array.from(bucket.parents.values()).sort((a, b) => b.count - a.count),
  });

  return {
    agents: Array.from(agentsByType.values())
      .map(finalize)
      .sort((a, b) => b.activeCount - a.activeCount || newestFirst(a.lastSeen, b.lastSeen)),
    skills: Array.from(skillsByName.values())
      .map(finalize)
      .sort((a, b) => newestFirst(a.lastSeen, b.lastSeen)),
    timeline: timeline.slice(0, 120),
  };
}
