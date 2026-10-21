// Stats view: one period (day / week / month / year) drives every number on screen.
// Data maths lives in stats-model.js; this file only renders and wires input.

import { state } from './state.js';
import { escapeHtml, fmtCost, fmtRate, fmtTokensCompact, MONTH_SHORT } from './format.js';
import { PRICING_FALLBACK } from './pricing.js';
import {
  dayKey,
  mergeProviders,
  parseDay,
  periodRange,
  shiftAnchor,
  summarizePeriod,
  yearHeatmap,
} from './stats-model.js';

const PERIODS = ['day', 'week', 'month', 'year'];
const PROVIDERS = ['all', 'claude', 'codex'];
const SERIES_COLORS = 4; // top models get their own colour, the rest share "other"
const PREFS_KEY = 'telemetry.stats';
const COUNT_UP_MS = 450;
const PREVIOUS = { day: 'yesterday', week: 'last week', month: 'last month', year: 'last year' };

const $ = (id) => document.getElementById(id);
const panelEl = document.querySelector('.stats-panel');
const els = {
  label: $('st-label'),
  cost: $('st-cost'),
  tokens: $('st-tokens'),
  delta: $('st-delta'),
  deltaHint: $('st-delta-hint'),
  forecast: $('st-forecast'),
  forecastHint: $('st-forecast-hint'),
  readout: $('st-readout'),
  bars: $('st-bars'),
  note: $('st-note'),
  heatWrap: $('st-heat-wrap'),
  heat: $('st-heat'),
  projects: $('st-projects'),
  models: $('st-models'),
  meta: $('st-meta'),
  pricing: $('pricing-ref-body'),
  todayCost: $('today-cost'),
  todayTokens: $('today-tokens'),
  todayDate: $('today-date'),
};

const view = loadPrefs();
let summary = null;
const shown = { cost: 0, tokens: 0 };

function loadPrefs() {
  const prefs = { period: 'day', provider: 'all', anchor: dayKey(new Date()) };
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    if (PERIODS.includes(saved.period)) prefs.period = saved.period;
    if (PROVIDERS.includes(saved.provider)) prefs.provider = saved.provider;
  } catch {
    // Storage blocked (private mode) – defaults are fine.
  }
  return prefs;
}

function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ period: view.period, provider: view.provider }));
  } catch {
    // ignore
  }
}

function providerData() {
  if (view.provider === 'claude') return mergeProviders([state.stats]);
  if (view.provider === 'codex') return mergeProviders([state.statsCodex]);
  return mergeProviders([state.stats, state.statsCodex]);
}

function periodLabel(kind, anchor) {
  const { start, end } = periodRange(kind, anchor);
  const d = parseDay(start);
  const dm = (k) => `${Number(k.slice(8))} ${MONTH_SHORT[Number(k.slice(5, 7)) - 1]}`;
  if (kind === 'day') {
    const wd = d.toLocaleDateString('en-GB', { weekday: 'short' }).toLowerCase();
    return `${wd} ${dm(start)} ${d.getFullYear()}`;
  }
  if (kind === 'week') {
    const last = new Date(parseDay(end).getTime() - 86400000);
    return `${dm(start)} – ${dm(dayKey(last))} ${last.getFullYear()}`;
  }
  if (kind === 'month') return `${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}`;
  return String(d.getFullYear());
}

function countUp(el, key, target, fmt) {
  const from = shown[key];
  shown[key] = target;
  if (from === target || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.textContent = fmt(target);
    return;
  }
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / COUNT_UP_MS);
    const eased = 1 - (1 - k) ** 3;
    el.textContent = fmt(from + (target - from) * eased);
    if (k < 1 && shown[key] === target) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Stable colour per model within the current period (by cost rank).
function colourIndex(models) {
  const map = new Map();
  models.slice(0, SERIES_COLORS).forEach((m, i) => map.set(m.model, i));
  return (model) => (map.has(model) ? map.get(model) : SERIES_COLORS);
}

function renderKpis(s) {
  els.label.textContent = periodLabel(view.period, view.anchor);
  countUp(els.cost, 'cost', s.cost, fmtCost);
  countUp(els.tokens, 'tokens', s.tokens, (v) => fmtTokensCompact(Math.round(v)));

  if (s.deltaPct == null) {
    els.delta.textContent = '—';
    els.delta.dataset.trend = 'flat';
  } else {
    els.delta.textContent = `${s.deltaPct > 0 ? '▲ +' : s.deltaPct < 0 ? '▼ ' : ''}${s.deltaPct}%`;
    els.delta.dataset.trend = s.deltaPct > 0 ? 'up' : s.deltaPct < 0 ? 'down' : 'flat';
  }
  els.deltaHint.textContent = s.partialData
    ? `logs start ${s.coverageStart || '—'}`
    : `${fmtCost(s.prevCost)} ${PREVIOUS[view.period]}${s.isCurrent ? ' at this point' : ''}`;

  if (s.forecastCost == null) {
    els.forecast.textContent = '—';
    els.forecastHint.textContent = !s.isCurrent
      ? 'period closed'
      : s.partialData
        ? 'not enough history'
        : 'too early to tell';
  } else {
    els.forecast.textContent = `~${fmtCost(s.forecastCost)}`;
    els.forecastHint.textContent = `by end of ${view.period}`;
  }
}

function barTitle(bar) {
  if (view.period === 'day') return `${bar.label}:00`;
  if (view.period === 'year') return `${bar.label} ${bar.key.slice(0, 4)}`;
  return periodLabel('day', bar.key);
}

function readout(bar, colourOf) {
  if (!bar) {
    els.readout.innerHTML = '<span class="st-readout__dim">hover a bar · click to zoom in</span>';
    return;
  }
  const models = bar.models
    .slice(0, 3)
    .map((m) => `<span class="sw sw--${colourOf(m.model)}"></span>${escapeHtml(m.label || m.model)} ${fmtCost(m.cost)}`)
    .join('  ');
  els.readout.innerHTML = `<strong>${escapeHtml(barTitle(bar))}</strong> · ${fmtCost(bar.cost)} · ${fmtTokensCompact(bar.tokens)} tokens${models ? ` <span class="st-readout__models">${models}</span>` : ''}`;
}

function renderBars(s) {
  const colourOf = colourIndex(s.models);
  const max = Math.max(...s.series.map((b) => b.cost), 0.01);
  els.bars.style.setProperty('--cols', s.series.length);
  els.bars.dataset.period = view.period;

  // Reuse columns so height changes animate instead of flashing.
  while (els.bars.children.length > s.series.length) els.bars.lastChild.remove();
  while (els.bars.children.length < s.series.length) {
    const col = document.createElement('button');
    col.type = 'button';
    col.className = 'st-col';
    col.innerHTML = '<span class="st-col__stack"></span><span class="st-col__label"></span>';
    els.bars.appendChild(col);
  }

  s.series.forEach((bar, i) => {
    const col = els.bars.children[i];
    col.dataset.current = String(bar.isCurrent);
    col.dataset.future = String(bar.isFuture);
    col.dataset.index = String(i);
    col.setAttribute('aria-label', `${barTitle(bar)}: ${fmtCost(bar.cost)}`);
    const stack = col.firstChild;
    stack.style.height = `${bar.cost > 0 ? Math.max(2, (bar.cost / max) * 100) : 0}%`;
    const segments = bar.models.length ? bar.models : [];
    const total = segments.reduce((a, m) => a + m.cost, 0) || 1;
    stack.innerHTML = segments
      .map((m) => `<span class="st-seg sw--${colourOf(m.model)}" style="flex-grow:${(m.cost / total).toFixed(4)}"></span>`)
      .join('');
    // Thin label row: show every label for ≤ 12 columns, otherwise every few.
    const every = s.series.length > 24 ? 5 : s.series.length > 12 ? 3 : 1;
    col.lastChild.textContent = i % every === 0 || bar.isCurrent ? bar.label : '';
  });

  els.bars.onmouseover = (e) => {
    const col = e.target.closest('.st-col');
    if (col) readout(s.series[Number(col.dataset.index)], colourOf);
  };
  els.bars.onmouseleave = () => readout(null, colourOf);
  els.bars.onclick = (e) => {
    const col = e.target.closest('.st-col');
    if (!col || view.period === 'day') return;
    const bar = s.series[Number(col.dataset.index)];
    setView({ period: view.period === 'year' ? 'month' : 'day', anchor: bar.key.slice(0, 10) });
  };
  readout(null, colourOf);

  const notes = [];
  if (s.hourlyMissing) notes.push('hourly detail is kept for the last 14 days – totals are complete');
  if (s.partialData && s.coverageStart) {
    notes.push(`data starts ${s.coverageStart} – older session logs are no longer on disk (Claude Code prunes them after ~30 days by default)`);
  }
  els.note.hidden = notes.length === 0;
  els.note.textContent = notes.join(' · ');
}

function renderList(el, items, { colourOf = null, empty = 'no usage in this period' } = {}) {
  if (!items.length) {
    el.innerHTML = `<li class="st-list__empty">${empty}</li>`;
    return;
  }
  const total = items.reduce((a, x) => a + x.cost, 0) || 1;
  const max = items[0].cost || 1;
  el.innerHTML = items
    .slice(0, 8)
    .map((x) => {
      const name = x.label || x.name || x.model;
      const swatch = colourOf ? `<span class="sw sw--${colourOf(x.model)}"></span>` : '';
      const badge = x.isMemory ? '<span class="st-list__badge" title="claude-mem memory infrastructure">mem</span>' : '';
      const est = x.estimated ? '<span class="st-list__badge" title="unknown model – priced at the provider default rate">est</span>' : '';
      return `
        <li class="st-list__item">
          <span class="st-list__name" title="${escapeHtml(x.model || x.name)}">${swatch}${escapeHtml(name)}${badge}${est}</span>
          <span class="st-list__val">${fmtCost(x.cost)}</span>
          <span class="st-list__share">${Math.round((x.cost / total) * 100)}%</span>
          <span class="st-list__bar"><span style="width:${((x.cost / max) * 100).toFixed(1)}%"></span></span>
        </li>`;
    })
    .join('');
}

function renderHeatmap(data) {
  const show = view.period === 'year';
  els.heatWrap.hidden = !show;
  if (!show) return;
  const today = dayKey(new Date());
  const { end } = periodRange('year', view.anchor);
  const endKey = end <= today ? dayKey(new Date(parseDay(end).getTime() - 86400000)) : today;
  const { weeks } = yearHeatmap(data.daily, endKey);
  els.heat.innerHTML = weeks
    .map(
      (week) =>
        `<div class="st-heat__week">${week
          .map((c) =>
            c
              ? `<button type="button" class="st-heat__cell" data-level="${c.level}" data-date="${c.date}" title="${c.date} · ${fmtCost(c.cost)} · ${fmtTokensCompact(c.tokens)} tokens"></button>`
              : '<span class="st-heat__cell st-heat__cell--none"></span>',
          )
          .join('')}</div>`,
    )
    .join('');
}

function pricingTable(title, table, verifiedAt) {
  const isCodex = table[0]?.cachedInput != null;
  const head = isCodex
    ? '<th>model</th><th>input</th><th>cached in</th><th>output</th>'
    : '<th>model</th><th>input</th><th>output</th><th>cache read</th><th>cache write</th>';
  const rows = table
    .map((p) =>
      isCodex
        ? `<tr><td>${escapeHtml(p.label)}</td><td>${fmtRate(p.input)}</td><td>${fmtRate(p.cachedInput)}</td><td>${fmtRate(p.output)}</td></tr>`
        : `<tr><td>${escapeHtml(p.label)}</td><td>${fmtRate(p.input)}</td><td>${fmtRate(p.output)}</td><td>${fmtRate(p.cacheRead)}</td><td>${fmtRate(p.cacheCreate)}</td></tr>`,
    )
    .join('');
  return `
    <h4 class="pricing-ref__sub">${title}${verifiedAt ? ` · verified ${verifiedAt}` : ''}</h4>
    <table class="pricing-ref__table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

function renderPricing() {
  if (!els.pricing) return;
  const parts = [];
  if (view.provider !== 'codex') {
    parts.push(pricingTable('claude', state.stats?.pricing?.length ? state.stats.pricing : PRICING_FALLBACK, state.stats?.pricingVerifiedAt));
  }
  if (view.provider !== 'claude' && state.statsCodex?.pricing?.length) {
    parts.push(pricingTable('codex', state.statsCodex.pricing, state.statsCodex.pricingVerifiedAt));
  }
  els.pricing.innerHTML = `${parts.join('')}
    <p class="pricing-ref__note">USD per 1M tokens, public list prices. Every message is priced with its own model's rate at the time it was sent, so model switches and price changes stay accurate.</p>`;
}

// Header chip: today across both providers.
function renderHeaderToday() {
  const today = dayKey(new Date());
  const s = summarizePeriod(mergeProviders([state.stats, state.statsCodex]), 'day', today);
  if (els.todayDate) els.todayDate.textContent = today.replaceAll('-', '.');
  if (els.todayCost) els.todayCost.textContent = fmtCost(s.cost);
  if (els.todayTokens) els.todayTokens.textContent = fmtTokensCompact(s.tokens);
}

function syncControls() {
  panelEl.querySelectorAll('[data-period]').forEach((b) => {
    b.dataset.active = String(b.dataset.period === view.period);
  });
  panelEl.querySelectorAll('[data-stats-provider]').forEach((b) => {
    b.dataset.active = String(b.dataset.statsProvider === view.provider);
  });
  const isNow = periodRange(view.period, view.anchor).start === periodRange(view.period, dayKey(new Date())).start;
  panelEl.querySelector('[data-shift="1"]').disabled = isNow;
  panelEl.querySelector('[data-shift="0"]').disabled = isNow;
}

export function renderStatsView() {
  renderHeaderToday();
  if (!panelEl || panelEl.hidden) return;
  if (!state.stats && !state.statsCodex) return;
  const data = providerData();
  summary = summarizePeriod(data, view.period, view.anchor);
  syncControls();
  renderKpis(summary);
  renderBars(summary);
  renderHeatmap(data);
  renderList(els.projects, summary.projects);
  renderList(els.models, summary.models, { colourOf: colourIndex(summary.models) });
  const files = (state.stats?.fileCount || 0) + (state.statsCodex?.fileCount || 0);
  if (els.meta) els.meta.textContent = `${files} files`;
  renderPricing();
}

function setView(next) {
  Object.assign(view, next);
  savePrefs();
  renderStatsView();
}

function shift(dir) {
  if (dir === 0) return setView({ anchor: dayKey(new Date()) });
  const anchor = shiftAnchor(view.period, view.anchor, dir);
  if (anchor > dayKey(new Date())) return;
  setView({ anchor });
}

export function initStatsView() {
  if (!panelEl) return;
  panelEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.period) setView({ period: btn.dataset.period });
    else if (btn.dataset.statsProvider) setView({ provider: btn.dataset.statsProvider });
    else if (btn.dataset.shift != null) shift(Number(btn.dataset.shift));
    else if (btn.dataset.date) setView({ period: 'day', anchor: btn.dataset.date });
  });
  document.addEventListener('keydown', (e) => {
    if (panelEl.hidden || e.target.closest('input, textarea')) return;
    if (e.key === 'ArrowLeft') shift(-1);
    else if (e.key === 'ArrowRight') shift(1);
  });
}
