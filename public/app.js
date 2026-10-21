// Entry point: wires the navigation, keeps the WebSocket open and hands
// snapshots to the views. Rendering lives in ./js/*-view.js.

import { state, sessionKey, SESSION_FILTERS } from './js/state.js';
import { renderSessions, flashEntry } from './js/sessions-view.js';
import {
  attachLibraryHandlers,
  renderActivity,
  renderAgents,
  renderProjects,
  renderSkills,
} from './js/library-view.js';
import { initStatsView, renderStatsView } from './js/stats-view.js';

const RECONNECT_MS = 1500;

const connDot = document.getElementById('conn-dot');
const connText = document.getElementById('conn-text');
const emptyEl = document.getElementById('empty');
const filterButtons = document.querySelectorAll('.filter[data-filter]');
const sessionProviderButtons = document.querySelectorAll('[data-session-provider]');

const views = {
  sessions: document.getElementById('grid'),
  agents: document.getElementById('agents-view'),
  skills: document.getElementById('skills-view'),
  projects: document.getElementById('projects-view'),
  activity: document.getElementById('activity-view'),
  stats: document.querySelector('.stats-panel'),
};

function applyViewMode() {
  const isSessions = SESSION_FILTERS.has(state.currentFilter);
  for (const [name, el] of Object.entries(views)) {
    if (el) el.hidden = name === 'sessions' ? !isSessions : state.currentFilter !== name;
  }
  if (emptyEl && !isSessions) emptyEl.hidden = true;
}

function refreshCurrentView() {
  const f = state.currentFilter;
  if (f === 'stats') renderStatsView();
  else if (f === 'agents') renderAgents();
  else if (f === 'skills') renderSkills();
  else if (f === 'projects') renderProjects();
  else if (f === 'activity') renderActivity();
  else renderSessions();
}

filterButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    state.currentFilter = btn.dataset.filter;
    filterButtons.forEach((b) => {
      b.dataset.active = String(b.dataset.filter === state.currentFilter);
    });
    applyViewMode();
    refreshCurrentView();
  });
});

sessionProviderButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    state.sessionProviderView = btn.dataset.sessionProvider;
    sessionProviderButtons.forEach((b) => {
      b.dataset.active = String(b.dataset.sessionProvider === state.sessionProviderView);
    });
    if (SESSION_FILTERS.has(state.currentFilter)) renderSessions();
  });
});

function onSnapshot(msg) {
  state.sessions = new Map((msg.sessions || []).map((s) => [sessionKey(s), s]));
  state.processes = msg.processes || [];
  // Unchanged stats are omitted by the server – keep what we have.
  if (msg.stats) state.stats = msg.stats;
  if (msg.statsCodex) state.statsCodex = msg.statsCodex;
  if (msg.activity) state.activity = msg.activity;
  if (msg.registry) state.registry = msg.registry;
  renderSessions();
  renderStatsView();
  renderAgents();
  renderSkills();
  renderProjects();
  renderActivity();
}

function connect() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);

  ws.addEventListener('open', () => {
    connDot.dataset.state = 'connected';
    connText.textContent = 'connected';
  });
  ws.addEventListener('close', () => {
    connDot.dataset.state = 'disconnected';
    connText.textContent = 'reconnecting';
    setTimeout(connect, RECONNECT_MS);
  });
  ws.addEventListener('error', () => {
    connDot.dataset.state = 'disconnected';
    connText.textContent = 'error';
  });
  ws.addEventListener('message', (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (msg.type === 'snapshot') {
      onSnapshot(msg);
    } else if (msg.type === 'session-update') {
      state.sessions.set(sessionKey(msg.session), msg.session);
      renderSessions();
      flashEntry(msg.session);
    }
  });
}

applyViewMode();
attachLibraryHandlers();
initStatsView();
connect();
