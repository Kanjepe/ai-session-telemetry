// Library views: subagents, skills, per-project assets and the activity timeline.

import { state } from './state.js';
import { escapeHtml, fmtDuration } from './format.js';

const activityViewEl = document.getElementById('activity-view');
const detailCache = new Map();

let agentsSearch = '';
let skillsSearch = '';
let projectsSearch = '';
let agentsDomain = 'all';
let skillsGroup = 'all';
let _lastAgentsRenderKey = '';
let _lastSkillsRenderKey = '';
let _lastProjectsRenderKey = '';

function registryHash(list) {
  if (!list || list.length === 0) return '0';
  let h = `${list.length}`;
  for (const item of list) {
    h += `|${item.slug}:${item.usage?.thisMonth || 0}:${item.usage?.lastUsed || ''}`;
  }
  return h;
}

function libraryMatches(item, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    (item.slug || '').toLowerCase().includes(q) ||
    (item.name || '').toLowerCase().includes(q) ||
    (item.description || '').toLowerCase().includes(q) ||
    (item.domain || '').toLowerCase().includes(q)
  );
}

function fmtUsageBadge(usage) {
  const n = usage?.thisMonth || 0;
  const cls = n === 0 ? 'zero' : '';
  return `<span class="library-item__usage ${cls}"><strong>${n}</strong>× this month</span>`;
}

function renderChips(containerId, groups, items, currentKey, getGroupOf, onSelect) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const counts = new Map();
  for (const it of items) {
    const g = getGroupOf(it);
    counts.set(g, (counts.get(g) || 0) + 1);
  }
  const chips = [
    { key: 'all', label: 'all', count: items.length },
    ...groups.map((g) => ({ key: g, label: g, count: counts.get(g) || 0 })),
  ];
  el.innerHTML = chips
    .map(
      (c) => `
        <button class="lib-chip" data-active="${c.key === currentKey}" data-group="${escapeHtml(c.key)}">
          ${escapeHtml(c.label)}<span class="lib-chip__count">${c.count}</span>
        </button>
      `,
    )
    .join('');
  el.querySelectorAll('.lib-chip').forEach((btn) => {
    btn.addEventListener('click', () => onSelect(btn.dataset.group));
  });
}

export function renderAgents(force) {
  const listEl = document.getElementById('agents-list');
  const countEl = document.getElementById('agents-count');
  if (!listEl) return;

  const all = state.registry?.agents || [];
  const filtered = all.filter(
    (a) =>
      libraryMatches(a, agentsSearch) && (agentsDomain === 'all' || a.domain === agentsDomain),
  );

  const key = [
    registryHash(all),
    agentsSearch,
    agentsDomain,
  ].join('||');
  if (!force && key === _lastAgentsRenderKey) return;
  _lastAgentsRenderKey = key;

  renderChips(
    'agents-chips',
    state.registry.agentDomains || [],
    all,
    agentsDomain,
    (a) => a.domain,
    (val) => {
      agentsDomain = val;
      renderAgents(true);
    },
  );

  if (countEl) {
    countEl.textContent = filtered.length === all.length
      ? `${all.length} total`
      : `${filtered.length} / ${all.length} match`;
  }

  if (filtered.length === 0) {
    listEl.innerHTML = '<div class="activity__empty">// no subagents match this filter</div>';
    return;
  }

  listEl.innerHTML = filtered.map(renderAgentLibraryItem).join('');
}

function renderAgentLibraryItem(a) {
  const desc = a.description ? escapeHtml(a.description) : '<em>no description</em>';
  const tools = a.tools
    ? `<span class="label">tools:</span> <span class="val">${escapeHtml(a.tools)}</span>`
    : '';
  const usage = fmtUsageBadge(a.usage);
  return `
    <details class="library-item library-item--agent" data-kind="agent" data-domain="${escapeHtml(a.domain)}" data-slug="${escapeHtml(a.slug)}">
      <summary class="library-item__head">
        <span class="library-item__chevron">▸</span>
        <span class="library-item__name">
          <span class="prefix">↪ </span>${escapeHtml(a.slug)}
        </span>
        ${usage}
        <span class="library-item__domain">${escapeHtml(a.domain)}</span>
        <button class="library-item__copy" data-copy="Agent(subagent_type='${escapeHtml(a.slug)}')" type="button" title="Copy spawn snippet">copy</button>
      </summary>
      <div class="library-item__body">
        <p class="library-item__brief">${desc}</p>
        ${tools ? `<div class="library-item__meta">${tools}</div>` : ''}
        <div class="library-item__detail library-item__detail--loading">// click to expand → loading full profile…</div>
      </div>
    </details>
  `;
}

export function renderSkills(force) {
  const listEl = document.getElementById('skills-list');
  const countEl = document.getElementById('skills-count');
  if (!listEl) return;

  const all = state.registry?.skills || [];
  const filtered = all.filter(
    (s) =>
      libraryMatches(s, skillsSearch) && (skillsGroup === 'all' || s.group === skillsGroup),
  );

  const key = [
    registryHash(all),
    skillsSearch,
    skillsGroup,
  ].join('||');
  if (!force && key === _lastSkillsRenderKey) return;
  _lastSkillsRenderKey = key;

  renderChips(
    'skills-chips',
    state.registry.skillGroups || [],
    all,
    skillsGroup,
    (s) => s.group,
    (val) => {
      skillsGroup = val;
      renderSkills(true);
    },
  );

  if (countEl) {
    countEl.textContent = filtered.length === all.length
      ? `${all.length} total`
      : `${filtered.length} / ${all.length} match`;
  }

  if (filtered.length === 0) {
    listEl.innerHTML = '<div class="activity__empty">// no skills match this filter</div>';
    return;
  }

  listEl.innerHTML = filtered.map(renderSkillLibraryItem).join('');
}

function renderSkillLibraryItem(s) {
  const desc = s.description ? escapeHtml(s.description) : '<em>no description</em>';
  const args = s.argumentHint
    ? `<span class="label">args:</span> <span class="val">${escapeHtml(s.argumentHint)}</span>`
    : '';
  const usage = fmtUsageBadge(s.usage);
  return `
    <details class="library-item library-item--skill" data-kind="skill" data-slug="${escapeHtml(s.slug)}">
      <summary class="library-item__head">
        <span class="library-item__chevron">▸</span>
        <span class="library-item__name">
          <span class="prefix">/</span>${escapeHtml(s.slug)}
        </span>
        ${usage}
        <span class="library-item__domain">${escapeHtml(s.group || 'skill')}</span>
        <button class="library-item__copy" data-copy="/${escapeHtml(s.slug)}" type="button" title="Copy slash command">copy</button>
      </summary>
      <div class="library-item__body">
        <p class="library-item__brief">${desc}</p>
        ${args ? `<div class="library-item__meta">${args}</div>` : ''}
        <div class="library-item__detail library-item__detail--loading">// click to expand → loading full profile…</div>
      </div>
    </details>
  `;
}

async function fetchDetailFor(item) {
  const kind = item.dataset.kind;
  const slug = item.dataset.slug;
  const domain = item.dataset.domain;
  const cacheKey = kind === 'agent' ? `agent:${domain}:${slug}` : `skill:${slug}`;
  if (detailCache.has(cacheKey)) return detailCache.get(cacheKey);

  const url = kind === 'agent' ? `/api/agent/${domain}/${slug}` : `/api/skill/${slug}`;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const data = await r.json();
    detailCache.set(cacheKey, data);
    return data;
  } catch {
    return null;
  }
}

export function attachLibraryHandlers() {
  document.body.addEventListener('toggle', async (e) => {
    const item = e.target.closest('details.library-item');
    if (!item || !item.open) return;
    const detailEl = item.querySelector('.library-item__detail');
    if (!detailEl || !detailEl.classList.contains('library-item__detail--loading')) return;

    const data = await fetchDetailFor(item);
    if (!data) {
      detailEl.classList.remove('library-item__detail--loading');
      detailEl.innerHTML = '<em>// could not load profile</em>';
      return;
    }
    detailEl.classList.remove('library-item__detail--loading');
    const body = data.body || '';
    detailEl.textContent = body || '// no body content';
  }, true);

  document.body.addEventListener('click', async (e) => {
    const btn = e.target.closest('.library-item__copy');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const text = btn.dataset.copy || '';
    try {
      await navigator.clipboard.writeText(text);
      btn.dataset.copied = 'true';
      const oldText = btn.textContent;
      btn.textContent = '✓ copied';
      setTimeout(() => {
        btn.textContent = oldText;
        delete btn.dataset.copied;
      }, 1400);
    } catch {
      btn.textContent = 'err';
    }
  });

  const agentsSearchEl = document.getElementById('agents-search');
  if (agentsSearchEl) {
    agentsSearchEl.addEventListener('input', (e) => {
      agentsSearch = e.target.value;
      renderAgents(true);
    });
  }
  const skillsSearchEl = document.getElementById('skills-search');
  if (skillsSearchEl) {
    skillsSearchEl.addEventListener('input', (e) => {
      skillsSearch = e.target.value;
      renderSkills(true);
    });
  }
  const projectsSearchEl = document.getElementById('projects-search');
  if (projectsSearchEl) {
    projectsSearchEl.addEventListener('input', (e) => {
      projectsSearch = e.target.value;
      renderProjects(true);
    });
  }
}


function projectMatches(project, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  if (project.name.toLowerCase().includes(q)) return true;
  if (project.relPath.toLowerCase().includes(q)) return true;
  for (const s of project.skills) {
    if (s.slug.toLowerCase().includes(q) || (s.description || '').toLowerCase().includes(q)) return true;
  }
  for (const a of project.agents) {
    if (a.slug.toLowerCase().includes(q) || (a.description || '').toLowerCase().includes(q)) return true;
  }
  return false;
}

function projectsRegistryHash(projects) {
  if (!projects || projects.length === 0) return '0';
  return projects
    .map((p) => `${p.relPath}:${p.skills.length}+${p.agents.length}`)
    .join('|');
}

export function renderProjects(force) {
  const listEl = document.getElementById('projects-list');
  const countEl = document.getElementById('projects-count');
  if (!listEl) return;

  const all = state.registry?.projects || [];
  const filtered = all.filter((p) => projectMatches(p, projectsSearch));

  const key = [projectsRegistryHash(all), projectsSearch].join('||');
  if (!force && key === _lastProjectsRenderKey) return;
  _lastProjectsRenderKey = key;

  if (countEl) {
    const skillCount = all.reduce((acc, p) => acc + p.skills.length, 0);
    const agentCount = all.reduce((acc, p) => acc + p.agents.length, 0);
    countEl.textContent = `${all.length} projects · ${skillCount} skills · ${agentCount} agents`;
  }

  if (filtered.length === 0) {
    listEl.innerHTML = '<div class="activity__empty">// no projects with .claude/skills or .claude/agents found</div>';
    return;
  }

  listEl.innerHTML = filtered.map(renderProjectCard).join('');
}

function renderProjectCard(p) {
  const skillsList = p.skills.length
    ? `<ul class="proj-card__list">${p.skills.map((s) => renderProjectSkillRow(p, s)).join('')}</ul>`
    : '<p class="proj-card__empty">// none</p>';
  const agentsList = p.agents.length
    ? `<ul class="proj-card__list">${p.agents.map((a) => renderProjectAgentRow(p, a)).join('')}</ul>`
    : '<p class="proj-card__empty">// none</p>';

  return `
    <article class="proj-card">
      <header class="proj-card__head">
        <h3 class="proj-card__name">${escapeHtml(p.name)}</h3>
        <span class="proj-card__path" title="${escapeHtml(p.path)}">${escapeHtml(p.relPath)}</span>
      </header>
      <div class="proj-card__body">
        <div class="proj-card__section">
          <p class="proj-card__section-head">skills <span class="count">(${p.skills.length})</span></p>
          ${skillsList}
        </div>
        <div class="proj-card__section">
          <p class="proj-card__section-head">subagents <span class="count">(${p.agents.length})</span></p>
          ${agentsList}
        </div>
      </div>
    </article>
  `;
}

function renderProjectSkillRow(p, s) {
  const desc = s.description ? escapeHtml(s.description) : '<em>no description</em>';
  const usage = fmtUsageBadge(s.usage);
  const inlineBody = s.body ? escapeHtml(s.body) : '// no body content';
  return `
    <li>
      <details class="library-item library-item--skill" data-kind="project-skill">
        <summary class="library-item__head">
          <span class="library-item__chevron">▸</span>
          <span class="library-item__name">
            <span class="prefix">/</span>${escapeHtml(s.slug)}
          </span>
          ${usage}
          <span class="library-item__domain">project skill</span>
          <button class="library-item__copy" data-copy="/${escapeHtml(s.slug)}" type="button" title="Copy slash command">copy</button>
        </summary>
        <div class="library-item__body">
          <p class="library-item__brief">${desc}</p>
          <div class="library-item__detail">${inlineBody}</div>
        </div>
      </details>
    </li>
  `;
}

function renderProjectAgentRow(p, a) {
  const desc = a.description ? escapeHtml(a.description) : '<em>no description</em>';
  const usage = fmtUsageBadge(a.usage);
  const tools = a.tools
    ? `<div class="library-item__meta"><span class="label">tools:</span> <span class="val">${escapeHtml(a.tools)}</span></div>`
    : '';
  const inlineBody = a.body ? escapeHtml(a.body) : '// no body content';
  return `
    <li>
      <details class="library-item library-item--agent" data-kind="project-agent">
        <summary class="library-item__head">
          <span class="library-item__chevron">▸</span>
          <span class="library-item__name">
            <span class="prefix">↪ </span>${escapeHtml(a.slug)}
          </span>
          ${usage}
          <span class="library-item__domain">project agent</span>
          <button class="library-item__copy" data-copy="Agent(subagent_type='${escapeHtml(a.slug)}')" type="button" title="Copy spawn snippet">copy</button>
        </summary>
        <div class="library-item__body">
          <p class="library-item__brief">${desc}</p>
          ${tools}
          <div class="library-item__detail">${inlineBody}</div>
        </div>
      </details>
    </li>
  `;
}

export function renderActivity() {
  if (!activityViewEl) return;
  const list = state.activity?.timeline || [];
  if (list.length === 0) {
    activityViewEl.innerHTML = '<div class="activity__empty">// no activity in window</div>';
    return;
  }
  activityViewEl.innerHTML = list.map(renderActivityRow).join('');
}

function renderActivityRow(ev) {
  const time = new Date(ev.timestamp).toLocaleTimeString('en-GB', { hour12: false });
  const kind = ev.kind === 'agent' ? 'agent' : 'skill';
  let status = '';
  if (ev.kind === 'agent') {
    if (ev.completed) {
      const dur = ev.durationMs ? ` ${fmtDuration(Math.floor(ev.durationMs / 1000))}` : '';
      status = `<span class="activity__status done">✓ done${dur}</span>`;
    } else {
      status = `<span class="activity__status running">● running</span>`;
    }
  } else {
    status = `<span class="activity__status">invoked</span>`;
  }
  return `
    <div class="activity__row" data-kind="${kind}">
      <span class="activity__time">${time}</span>
      <span class="activity__kind">${kind}</span>
      <span class="activity__name" title="${escapeHtml(ev.name)}">${escapeHtml(ev.name)}</span>
      ${status}
      <span class="activity__parent" title="${escapeHtml(ev.projectName)}">${escapeHtml(ev.projectName)}</span>
    </div>
  `;
}
