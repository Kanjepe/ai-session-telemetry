// Shared client state, filled from WebSocket snapshots and read by every view.

export const SESSION_FILTERS = new Set(['live', 'waiting', 'paused', 'all']);

export const state = {
  sessions: new Map(),
  processes: [],
  stats: null,
  statsCodex: null,
  activity: { agents: [], skills: [], timeline: [] },
  registry: { skills: [], agents: [], skillGroups: [], agentDomains: [], projects: [] },
  currentFilter: 'live',
  sessionProviderView: 'all',
};

// Claude and Codex ids can collide, so sessions are keyed by provider too.
export function sessionKey(session) {
  return `${session.provider}:${session.sessionId}`;
}
