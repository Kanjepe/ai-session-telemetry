// Client-side fallback for the model price table (the server's table wins when present).

// Mirrors lib/pricing.js FAMILIES (base rates; server table wins when present).
export const PRICING_FALLBACK = [
  { family: 'fable-5.1', label: 'fable 5.1 / mythos 5.1', input: 10, output: 50, cacheRead: 0.25, cacheCreate: 12.5 },
  { family: 'fable-5', label: 'fable 5 / mythos 5', input: 10, output: 50, cacheRead: 1, cacheCreate: 12.5 },
  { family: 'opus-fast', label: 'opus fast', input: 10, output: 50, cacheRead: 1, cacheCreate: 12.5 },
  { family: 'opus-modern', label: 'opus 4.5 – 5', input: 5, output: 25, cacheRead: 0.5, cacheCreate: 6.25 },
  { family: 'opus-legacy', label: 'opus ≤ 4.1', input: 15, output: 75, cacheRead: 1.5, cacheCreate: 18.75 },
  { family: 'sonnet-5', label: 'sonnet 5', input: 3, output: 15, cacheRead: 0.3, cacheCreate: 3.75 },
  { family: 'sonnet', label: 'sonnet ≤ 4.6', input: 3, output: 15, cacheRead: 0.3, cacheCreate: 3.75 },
  { family: 'haiku-3.5', label: 'haiku 3.5', input: 0.8, output: 4, cacheRead: 0.08, cacheCreate: 1 },
  { family: 'haiku', label: 'haiku 4.5', input: 1, output: 5, cacheRead: 0.1, cacheCreate: 1.25 },
];

export function familyForModel(model) {
  if (!model) return null;
  const m = String(model).toLowerCase();
  if (/fable-5-1|mythos-5-1/.test(m)) return 'fable-5.1';
  if (m.includes('fable') || m.includes('mythos')) return 'fable-5';
  if (m.includes('opus')) {
    if (m.includes('fast')) return 'opus-fast';
    return /opus-5|opus-4-[5678]/.test(m) ? 'opus-modern' : 'opus-legacy';
  }
  if (/sonnet-5/.test(m)) return 'sonnet-5';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('haiku-3.5') || m.includes('haiku-3-5') || /3-5-haiku/.test(m)) return 'haiku-3.5';
  if (m.includes('haiku')) return 'haiku';
  return null;
}

export function rateForModel(model, pricing) {
  const table = pricing && pricing.length ? pricing : PRICING_FALLBACK;
  const family = familyForModel(model);
  return table.find((p) => p.family === family) || table.find((p) => p.family === 'sonnet') || null;
}
