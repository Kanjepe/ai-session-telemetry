// Live session cards: one card per Claude/Codex session plus running subagents
// and just-invoked skills. Cards are diffed by signature to avoid re-rendering.

import { state, sessionKey } from './state.js';
import {
  escapeHtml,
  fmtAge,
  fmtCost,
  fmtDuration,
  fmtRate,
  fmtTokens,
  shortModel,
  toolLabel,
} from './format.js';
import { rateForModel } from './pricing.js';

const grid = document.getElementById('grid');
const emptyEl = document.getElementById('empty');
const countProcesses = document.getElementById('count-processes');
const countLive = document.getElementById('count-live');
const countWaiting = document.getElementById('count-waiting');
const countPaused = document.getElementById('count-paused');
const lastUpdateEl = document.getElementById('last-update');
const entryEls = new Map();

const STATUS_LABEL = {
  live: 'live',
  waiting: 'waiting',
  paused: 'paused',
  idle: 'idle',
};

function renderSessionMetrics(s) {
  const cost = fmtCost(s.costUsd || 0);
  const burnTokPerMin = (s.tokensLast5Min || 0) / 5;
  const burnUsdPerMin = (s.costLast5Min || 0) / 5;
  const burn = fmtTokens(Math.round(burnTokPerMin));
  let burnClass = 'metric--idle';
  if (burnTokPerMin > 50000) burnClass = 'metric--hot';
  else if (burnTokPerMin > 10000) burnClass = 'metric--fast';
  else if (burnTokPerMin > 1000) burnClass = 'metric--normal';
  const burnStr = burnTokPerMin > 0
    ? `${burn.num}${burn.unit}/min <span class="metric__usd">≈ ${fmtCost(burnUsdPerMin)}/min</span>`
    : 'idle';
  const rate = rateForModel(s.model, state.stats?.pricing);
  const costTitle = rate
    ? `Model: ${s.model || 'unknown'} (${rate.label})\nRates per 1M tokens:\n  input: ${fmtRate(rate.input)}\n  output: ${fmtRate(rate.output)}\n  cache read: ${fmtRate(rate.cacheRead)}\n  cache create: ${fmtRate(rate.cacheCreate)}\n\nClick the 'pricing reference' panel below for the full table.`
    : `Model: ${s.model || 'unknown'}`;
  return `
    <div class="entry__metrics" aria-label="Session metrics">
      <span class="metric metric--cost" title="${escapeHtml(costTitle)}">
        <span class="metric__label">cost</span>
        <span class="metric__val">${cost}<span class="metric__sub">total</span></span>
      </span>
      <span class="metric ${burnClass}">
        <span class="metric__label">burn</span>
        <span class="metric__val">${burnStr}</span>
      </span>
    </div>
  `;
}

const CHAIN_LIMIT = 6;
function renderToolChain(history) {
  if (!history || history.length === 0) {
    return '<p class="entry__chain entry__chain--empty">no tool activity yet</p>';
  }
  const last = history.slice(-CHAIN_LIMIT);
  const names = last.map((t) => `<span class="chain__tool">${escapeHtml(toolLabel(t.name))}</span>`);
  const joined = names.join('<span class="chain__arrow">→</span>');
  const lastT = new Date(history[history.length - 1].t).getTime();
  const ageSec = Math.max(0, Math.floor((Date.now() - lastT) / 1000));
  return `
    <p class="entry__chain" aria-label="Recent tool activity">
      <span class="chain__label">recent:</span> ${joined}
      <span class="chain__sep">·</span>
      <span class="chain__age">${fmtAge(ageSec)} ago</span>
    </p>
  `;
}

function topTools(toolUsage, limit = 5) {
  const entries = Object.entries(toolUsage || {});
  entries.sort((a, b) => b[1] - a[1]);
  return entries.slice(0, limit);
}

function statusOrder(status) {
  switch (status) {
    case 'live': return 0;
    case 'waiting': return 1;
    case 'paused': return 2;
    case 'idle': return 3;
    default: return 4;
  }
}

function matchesFilter(session) {
  const providerMatches =
    state.sessionProviderView === 'all' || session.provider === state.sessionProviderView;
  if (!providerMatches) return false;
  if (state.currentFilter === 'all') return true;
  return session.status === state.currentFilter;
}

const RECENT_SKILL_WINDOW_MS = 60 * 1000;

function liveWorkItems() {
  if (state.currentFilter !== 'live' && state.currentFilter !== 'all') return [];
  if (state.sessionProviderView === 'codex') return [];
  const items = [];
  const tl = state.activity?.timeline || [];
  const now = Date.now();
  for (const ev of tl) {
    const ts = new Date(ev.timestamp).getTime();
    if (ev.kind === 'agent' && !ev.completed) {
      items.push({ kind: 'agent', ev, ts });
    } else if (ev.kind === 'skill' && now - ts < RECENT_SKILL_WINDOW_MS) {
      items.push({ kind: 'skill', ev, ts });
    }
  }
  return items;
}

function renderLiveCard(item) {
  const ev = item.ev;
  const ageSec = Math.max(0, Math.floor((Date.now() - item.ts) / 1000));
  if (item.kind === 'agent') {
    const desc = ev.description ? `<p class="live-card__desc">${escapeHtml(ev.description)}</p>` : '';
    return `
      <article class="live-card live-card--agent" data-kind="agent">
        <header class="live-card__head">
          <span class="live-card__kind">[ subagent ]</span>
          <span class="live-card__status">
            <span class="live-card__dot" aria-hidden="true"></span>
            running
          </span>
          <span class="live-card__time">${fmtAge(ageSec)} ago</span>
        </header>
        <div class="live-card__body">
          <h3 class="live-card__title">${escapeHtml(ev.name)}</h3>
          ${desc}
          <p class="live-card__parent">↪ from: <strong>${escapeHtml(ev.projectName)}</strong></p>
        </div>
      </article>
    `;
  }
  return `
    <article class="live-card live-card--skill" data-kind="skill">
      <header class="live-card__head">
        <span class="live-card__kind">[ skill ]</span>
        <span class="live-card__status">
          <span class="live-card__dot" aria-hidden="true"></span>
          just invoked
        </span>
        <span class="live-card__time">${fmtAge(ageSec)} ago</span>
      </header>
      <div class="live-card__body">
        <h3 class="live-card__title">${escapeHtml(ev.name)}</h3>
        <p class="live-card__parent">↪ from: <strong>${escapeHtml(ev.projectName)}</strong></p>
      </div>
    </article>
  `;
}

function renderEntry(s, index) {
  const status = s.status || 'idle';
  const provider = s.provider || 'claude';
  const num = String(index + 1).padStart(2, '0');
  const statusLabel = STATUS_LABEL[status] || status;
  const subagent = s.currentTool === 'Task';
  const tokens = fmtTokens(s.tokens.total);

  const metaParts = [
    `<strong>${escapeHtml(shortModel(s.model))}</strong>`,
    fmtDuration(s.durationSeconds),
  ];
  if (s.gitBranch) metaParts.push(escapeHtml(s.gitBranch));

  const pills = topTools(s.toolUsage, 4)
    .map(([name, count]) => `<span class="pill">${escapeHtml(name)}:<em>${count}</em></span>`)
    .join('');

  const safeSid = escapeHtml(s.sessionId);
  const sidShort = `${escapeHtml(s.sessionId.slice(0, 8))}..${escapeHtml(s.sessionId.slice(-4))}`;

  let currentLine = '';
  if (s.currentTool) {
    const verb = subagent ? 'spawning' : s.currentTool === 'Skill' ? 'invoking skill' : 'now';
    const detail = s.currentToolDetail
      ? `${escapeHtml(toolLabel(s.currentTool))} <span class="entry__arrow">→</span> <strong>${escapeHtml(s.currentToolDetail)}</strong>`
      : `<strong>${escapeHtml(toolLabel(s.currentTool))}</strong>`;
    currentLine = `<p class="entry__current">${verb} ${detail}</p>`;
  }

  const metricsLine = renderSessionMetrics(s);
  const toolChain = renderToolChain(s.toolHistory);

  return `
    <article class="entry" data-status="${status}" data-provider="${provider}" data-session="${safeSid}" data-session-key="${escapeHtml(sessionKey(s))}">
      <header class="entry__head">
        <span class="entry__id">[${num}]</span>
        <span class="entry__status">
          <span class="entry__provider" data-provider="${provider}">${provider}</span>
          <span class="entry__dot" aria-hidden="true"></span>
          <span class="entry__statuslabel">${statusLabel}</span>
        </span>
        <time class="entry__time">${fmtAge(s.ageSeconds)} ago</time>
      </header>

      <div class="entry__body">
        <h2 class="entry__title">
          ${s.isObserver
            ? `<span class="entry__obs-prefix">obs/</span>${escapeHtml(s.projectName.replace(/^obs\//, ''))}`
            : escapeHtml(s.projectName)
          }
        </h2>
        ${s.title ? `<p class="entry__subtitle">${escapeHtml(s.title)}</p>` : ''}

        <div class="entry__meta">
          ${metaParts.join('<span class="sep">·</span>')}
        </div>

        <div class="entry__stats" aria-label="Session statistics">
          <div class="stat-cell">
            <span class="stat-cell__num">${tokens.num}<span class="stat-cell__unit">${tokens.unit}</span></span>
            <span class="stat-cell__label">tokens</span>
          </div>
          <div class="stat-cell">
            <span class="stat-cell__num">${s.toolCount}</span>
            <span class="stat-cell__label">actions</span>
          </div>
          <div class="stat-cell">
            <span class="stat-cell__num">${s.userMessageCount}<span class="stat-cell__unit">/${s.assistantMessageCount}</span></span>
            <span class="stat-cell__label">msgs</span>
          </div>
        </div>

        ${currentLine}

        ${metricsLine}
        ${toolChain}

        <footer class="entry__foot">
          ${pills ? `<span class="entry__pills">${pills}</span>` : '<span></span>'}
          <code class="entry__hash">${sidShort}</code>
        </footer>
      </div>
    </article>
  `;
}

function sessionSignature(s) {
  const recentTools = (s.toolHistory || []).slice(-CHAIN_LIMIT).map((t) => t.name).join('>');
  return [
    s.provider || 'claude',
    s.status,
    s.title || '',
    s.projectName || '',
    s.isObserver ? '1' : '0',
    s.gitBranch || '',
    s.model || '',
    s.currentTool || '',
    s.currentToolDetail || '',
    s.toolCount || 0,
    s.tokens?.total || 0,
    s.userMessageCount || 0,
    s.assistantMessageCount || 0,
    s.durationSeconds || 0,
    Object.keys(s.toolUsage || {}).sort().join(','),
    Math.round((s.costUsd || 0) * 100),
    Math.round((s.tokensLast5Min || 0) / 1000),
    recentTools,
  ].join('|');
}

function htmlToElement(html) {
  const tmp = document.createElement('template');
  tmp.innerHTML = html.trim();
  return tmp.content.firstElementChild;
}

function updateTimeOnly(el, s) {
  const timeEl = el.querySelector('.entry__time');
  if (timeEl) {
    const txt = `${fmtAge(s.ageSeconds)} ago`;
    if (timeEl.textContent !== txt) timeEl.textContent = txt;
  }
}

export function renderSessions() {
  const all = Array.from(state.sessions.values());
  all.sort((a, b) => {
    const so = statusOrder(a.status) - statusOrder(b.status);
    if (so !== 0) return so;
    return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime();
  });

  const visible = all.filter(matchesFilter);
  const workItems = liveWorkItems();
  const totalVisible = visible.length + workItems.length;

  if (totalVisible === 0) {
    for (const el of entryEls.values()) el.remove();
    entryEls.clear();
    emptyEl.hidden = state.currentFilter === 'stats';
  } else {
    emptyEl.hidden = true;
    const visibleIds = new Set(visible.map(sessionKey));

    for (const [sid, el] of entryEls) {
      if (sid.startsWith('agent:') || sid.startsWith('skill:')) continue;
      if (!visibleIds.has(sid)) {
        el.remove();
        entryEls.delete(sid);
      }
    }

    visible.forEach((s, i) => {
      const key = sessionKey(s);
      let el = entryEls.get(key);
      const sig = sessionSignature(s);

      if (!el) {
        el = htmlToElement(renderEntry(s, i));
        el.dataset.sig = sig;
        entryEls.set(key, el);
      } else if (el.dataset.sig !== sig) {
        const fresh = htmlToElement(renderEntry(s, i));
        el.dataset.status = s.status;
        el.dataset.sig = sig;
        el.innerHTML = fresh.innerHTML;
      } else {
        updateTimeOnly(el, s);
      }
    });

    visible.forEach((s, i) => {
      const el = entryEls.get(sessionKey(s));
      if (grid.children[i] !== el) {
        grid.insertBefore(el, grid.children[i] || null);
      }
    });

    const workKeys = new Set();
    for (const item of workItems) {
      const key = item.kind === 'agent'
        ? `agent:${item.ev.sessionId}:${item.ev.name}:${item.ev.timestamp}`
        : `skill:${item.ev.sessionId}:${item.ev.name}:${item.ev.timestamp}`;
      workKeys.add(key);

      let el = entryEls.get(key);
      if (!el) {
        el = htmlToElement(renderLiveCard(item));
        entryEls.set(key, el);
        grid.appendChild(el);
      } else {
        const timeEl = el.querySelector('.live-card__time');
        if (timeEl) {
          const ageSec = Math.max(0, Math.floor((Date.now() - item.ts) / 1000));
          timeEl.textContent = `${fmtAge(ageSec)} ago`;
        }
      }
    }

    for (const [key, el] of entryEls) {
      if (key.startsWith('agent:') || key.startsWith('skill:')) {
        if (!workKeys.has(key)) {
          el.remove();
          entryEls.delete(key);
        }
      }
    }
  }

  let live = 0, waiting = 0, paused = 0;
  const countedSessions = all.filter(
    (session) => state.sessionProviderView === 'all' || session.provider === state.sessionProviderView,
  );
  for (const s of countedSessions) {
    if (s.status === 'live') live += 1;
    else if (s.status === 'waiting') waiting += 1;
    else if (s.status === 'paused') paused += 1;
  }
  countLive.textContent = live;
  countWaiting.textContent = waiting;
  countPaused.textContent = paused;
  countProcesses.textContent = state.processes.length;

  const now = new Date();
  lastUpdateEl.textContent = now.toLocaleTimeString('en-GB', { hour12: false });
}

export function flashEntry(session) {
  const el = grid.querySelector(`[data-session-key="${CSS.escape(sessionKey(session))}"]`);
  if (!el) return;
  el.classList.remove('just-updated');
  void el.offsetWidth;
  el.classList.add('just-updated');
}
