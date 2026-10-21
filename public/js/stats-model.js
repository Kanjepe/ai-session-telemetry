// Period maths for the stats view. Works on the server's `daily` / `hourly`
// series (see buildStatsData in lib/stats.js). No DOM access – unit-tested in Node.
// Day keys are local 'YYYY-MM-DD'; hour keys are local 'YYYY-MM-DDTHH'.

import { MONTH_SHORT } from './format.js';

const WEEKDAY_LABELS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const MIN_FORECAST_FRACTION = 0.05;

export function parseDay(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function dayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(key, n) {
  const d = parseDay(key);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

function periodStart(kind, key) {
  const d = parseDay(key);
  if (kind === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  if (kind === 'month') d.setDate(1);
  if (kind === 'year') d.setMonth(0, 1);
  return dayKey(d);
}

// Half-open range [start, end) of the period that contains `anchor`.
export function periodRange(kind, anchor) {
  const start = periodStart(kind, anchor);
  return { start, end: shiftAnchor(kind, start, 1) };
}

// Start of the period `dir` periods away from the one containing `anchor`.
export function shiftAnchor(kind, anchor, dir) {
  const d = parseDay(periodStart(kind, anchor));
  if (kind === 'day') d.setDate(d.getDate() + dir);
  if (kind === 'week') d.setDate(d.getDate() + 7 * dir);
  if (kind === 'month') d.setMonth(d.getMonth() + dir);
  if (kind === 'year') d.setFullYear(d.getFullYear() + dir);
  return dayKey(d);
}

function mergeBy(lists, keyOf) {
  const acc = new Map();
  for (const item of lists.flat()) {
    const key = keyOf(item);
    const cur = acc.get(key);
    if (cur) {
      cur.tokens += item.tokens;
      cur.cost += item.cost;
    } else {
      acc.set(key, { ...item });
    }
  }
  return Array.from(acc.values())
    .map((x) => ({ ...x, cost: round2(x.cost) }))
    .sort((a, b) => b.cost - a.cost || b.tokens - a.tokens);
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

function sum(rows, field) {
  return round2(rows.reduce((acc, r) => acc + (r[field] || 0), 0));
}

// Combine several providers' series into one (null providers are skipped).
export function mergeProviders(providers) {
  const merge = (field, keyField) => {
    const byKey = new Map();
    for (const prov of providers) {
      for (const row of prov?.[field] || []) {
        const list = byKey.get(row[keyField]) || [];
        list.push(row);
        byKey.set(row[keyField], list);
      }
    }
    return Array.from(byKey.keys())
      .sort()
      .map((key) => {
        const rows = byKey.get(key);
        const out = {
          [keyField]: key,
          tokens: rows.reduce((a, r) => a + r.tokens, 0),
          cost: sum(rows, 'cost'),
          models: mergeBy(rows.map((r) => r.models || []), (x) => x.model),
        };
        if (field === 'daily') out.projects = mergeBy(rows.map((r) => r.projects || []), (x) => x.name);
        return out;
      });
  };
  return { daily: merge('daily', 'date'), hourly: merge('hourly', 'key') };
}

function daysIn(daily, start, end) {
  return daily.filter((d) => d.date >= start && d.date < end);
}

function buildSeries(data, kind, range, todayKey, nowHourKey) {
  const byDate = new Map(data.daily.map((d) => [d.date, d]));
  const bar = (key, label, row, isCurrent, isFuture) => ({
    key,
    label,
    tokens: row?.tokens || 0,
    cost: row?.cost || 0,
    models: row?.models || [],
    isCurrent,
    isFuture,
  });

  if (kind === 'day') {
    const byHour = new Map(data.hourly.map((h) => [h.key, h]));
    return Array.from({ length: 24 }, (_, h) => {
      const key = `${range.start}T${String(h).padStart(2, '0')}`;
      return bar(key, String(h).padStart(2, '0'), byHour.get(key), key === nowHourKey, key > nowHourKey);
    });
  }
  if (kind === 'year') {
    const year = Number(range.start.slice(0, 4));
    return MONTH_SHORT.map((label, i) => {
      const start = dayKey(new Date(year, i, 1));
      const end = dayKey(new Date(year, i + 1, 1));
      const rows = daysIn(data.daily, start, end);
      const row = {
        tokens: rows.reduce((a, r) => a + r.tokens, 0),
        cost: sum(rows, 'cost'),
        models: mergeBy(rows.map((r) => r.models || []), (x) => x.model),
      };
      return bar(start, label, row, todayKey >= start && todayKey < end, start > todayKey);
    });
  }
  const out = [];
  for (let key = range.start; key < range.end; key = addDays(key, 1)) {
    const label = kind === 'week' ? WEEKDAY_LABELS[out.length] : String(Number(key.slice(8)));
    out.push(bar(key, label, byDate.get(key), key === todayKey, key > todayKey));
  }
  return out;
}

// Everything the stats view shows for one period.
export function summarizePeriod(data, kind, anchor, nowMs = Date.now()) {
  const now = new Date(nowMs);
  const todayKey = dayKey(now);
  const nowHourKey = `${todayKey}T${String(now.getHours()).padStart(2, '0')}`;
  const range = periodRange(kind, anchor);
  const isCurrent = todayKey >= range.start && todayKey < range.end;
  const rows = daysIn(data.daily, range.start, range.end);

  // Previous period, cut at the same point in time when this one is still running.
  const prev = periodRange(kind, shiftAnchor(kind, anchor, -1));
  let prevCost;
  let prevTokens;
  let prevEndKey = prev.end;
  if (kind === 'day') {
    const prevHours = data.hourly.filter((h) => h.key.startsWith(prev.start));
    const cutHour = isCurrent ? `${prev.start}T${nowHourKey.slice(11)}` : null;
    const counted = cutHour ? prevHours.filter((h) => h.key <= cutHour) : null;
    const prevRows = counted || daysIn(data.daily, prev.start, prev.end);
    prevCost = sum(prevRows, 'cost');
    prevTokens = prevRows.reduce((a, r) => a + r.tokens, 0);
  } else {
    const elapsedDays = Math.round((parseDay(todayKey) - parseDay(range.start)) / 86400000) + 1;
    const prevEnd = isCurrent ? addDays(prev.start, elapsedDays) : prev.end;
    prevEndKey = prevEnd < prev.end ? prevEnd : prev.end;
    const prevRows = daysIn(data.daily, prev.start, prevEndKey);
    prevCost = sum(prevRows, 'cost');
    prevTokens = prevRows.reduce((a, r) => a + r.tokens, 0);
  }

  const cost = sum(rows, 'cost');
  // Claude Code prunes old logs, so the oldest day we have is a hard data boundary.
  const coverageStart = data.daily[0]?.date || null;
  const partialData = !coverageStart || coverageStart > range.start;
  const prevUncovered = !coverageStart || prevEndKey <= coverageStart;
  const startMs = parseDay(range.start).getTime();
  const fraction = (nowMs - startMs) / (parseDay(range.end).getTime() - startMs);
  const series = buildSeries(data, kind, range, todayKey, nowHourKey);

  return {
    kind,
    range,
    isCurrent,
    tokens: rows.reduce((a, r) => a + r.tokens, 0),
    cost,
    prevCost,
    prevTokens,
    coverageStart,
    partialData,
    deltaPct:
      prevCost > 0 && !partialData && !prevUncovered
        ? Math.round(((cost - prevCost) / prevCost) * 100)
        : null,
    forecastCost:
      isCurrent && !partialData && fraction >= MIN_FORECAST_FRACTION ? round2(cost / fraction) : null,
    series,
    hourlyMissing: kind === 'day' && rows.length > 0 && series.every((b) => b.tokens === 0),
    models: mergeBy(rows.map((r) => r.models || []), (x) => x.model),
    projects: mergeBy(rows.map((r) => r.projects || []), (x) => x.name),
  };
}

// 53 Monday-first week columns ending with the week of `endKey`; level 0–4 by cost rank.
export function yearHeatmap(daily, endKey) {
  const byDate = new Map(daily.map((d) => [d.date, d]));
  const costs = daily.map((d) => d.cost).filter((c) => c > 0).sort((a, b) => a - b);
  const levelOf = (cost) => {
    if (!cost) return 0;
    const rank = costs.findIndex((c) => c >= cost) + 1;
    return Math.max(1, Math.ceil((4 * rank) / costs.length));
  };
  const first = addDays(periodStart('week', endKey), -52 * 7);
  const weeks = [];
  for (let w = 0; w < 53; w++) {
    const week = [];
    for (let d = 0; d < 7; d++) {
      const date = addDays(first, w * 7 + d);
      if (date > endKey) {
        week.push(null);
        continue;
      }
      const row = byDate.get(date);
      week.push({ date, tokens: row?.tokens || 0, cost: row?.cost || 0, level: levelOf(row?.cost) });
    }
    weeks.push(week);
  }
  return { weeks };
}
