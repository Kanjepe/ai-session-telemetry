// Pure formatting helpers shared by every view. No DOM access – unit-tested in Node.

export function fmtAge(seconds) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

export function fmtDuration(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm === 0 ? `${h}h` : `${h}h${String(rm).padStart(2, '0')}`;
}

export function fmtTokens(n) {
  if (n < 1000) return { num: String(n), unit: '' };
  if (n < 1_000_000) return { num: (n / 1000).toFixed(1), unit: 'k' };
  if (n < 1_000_000_000) return { num: (n / 1_000_000).toFixed(2), unit: 'M' };
  if (n < 1_000_000_000_000) return { num: (n / 1_000_000_000).toFixed(2), unit: 'B' };
  return { num: (n / 1_000_000_000_000).toFixed(2), unit: 'T' };
}

export function fmtTokensCompact(n) {
  const t = fmtTokens(n);
  return `${t.num}${t.unit}`;
}

export function fmtDateLong(iso) {
  if (!iso) return '----.--.--';
  const [y, m, d] = iso.split('-');
  return `${y}.${m}.${d}`;
}

export function fmtDateShort(iso) {
  if (!iso) return '--';
  return iso.slice(5);
}

export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export function weekdayShort(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return WEEKDAYS[d.getDay()];
}

export function shortModel(model) {
  if (!model || model === 'unknown') return '—';
  const trimmed = model.replace(/^claude-/, '').replace(/-(\d{8})$/, '');
  return trimmed.replace(/-/g, ' ');
}

export function fmtCost(usd) {
  if (!usd || usd <= 0) return '$0';
  if (usd < 0.01) return '<$0.01';
  if (usd < 10) return `$${usd.toFixed(2)}`;
  if (usd < 100) return `$${usd.toFixed(1)}`;
  return `$${Math.round(usd)}`;
}

// mcp__plugin_playwright_playwright__browser_click -> playwright · browser_click
export function toolLabel(name) {
  const parts = String(name || '').split('__');
  if (parts[0] !== 'mcp' || parts.length < 3) return String(name || '');
  const words = parts[1].replace(/^plugin_/, '').split('_');
  const half = words.length / 2;
  const server =
    words.length % 2 === 0 && words.slice(0, half).join('_') === words.slice(half).join('_')
      ? words.slice(0, half).join('_')
      : words.join('_');
  return `${server} · ${parts.slice(2).join('__')}`;
}

export function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function fmtRate(usd) {
  if (usd >= 1) return `$${usd.toFixed(usd >= 10 ? 0 : 2)}`;
  return `$${usd.toFixed(2)}`;
}

export const MONTH_SHORT = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export function fmtAgo(iso) {
  if (!iso) return '—';
  const sec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  return `${fmtAge(sec)} ago`;
}

export function fmtAvgDuration(totalMs, n) {
  if (!n) return '—';
  const avgSec = Math.floor(totalMs / 1000 / n);
  return fmtDuration(avgSec);
}
