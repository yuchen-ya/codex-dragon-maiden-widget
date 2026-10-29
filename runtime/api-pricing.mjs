import fs from 'node:fs';

// Same versioned rates and quote rules as codex-usage-dashboard v1.1.3.
// This local quote lets completion notifications work before its index refreshes.
const table = JSON.parse(fs.readFileSync(new URL('../vendor/codex-usage-dashboard/prices-v1.json', import.meta.url), 'utf8'));
function lookup(model, rates) {
  const key = Object.keys(rates).filter(key => model === key || model.startsWith(key + '-')).sort((a, b) => b.length - a.length)[0];
  return key ? { model: key, prices: rates[key] } : null;
}
function scheduleAt(schedules, at) {
  return schedules.findLast(([time]) => time === null || at >= Date.parse(time)) || schedules.at(-1);
}
export function estimateApiRequest(model, counts, at, tier = '') {
  model = model.trim().toLowerCase().split('/').at(-1);
  model = Object.hasOwn(table.aliases, model) ? table.aliases[model] : model;
  const schedule = scheduleAt(table.schedules, at);
  let quote = lookup(model, schedule[1]);
  if (!quote) return null;
  const family = table.families.find(family => Object.hasOwn(family.short, quote.model));
  if (family && counts.input_tokens > family.threshold) {
    const rates = family.schedules?.length ? scheduleAt(family.schedules, schedule[0] === null ? Infinity : Date.parse(schedule[0]))[1] : family.long;
    quote = lookup(model, rates) || quote;
  }
  const multiplier = ['priority', 'fast'].includes(tier) ? table.fast[quote.model] : tier === 'ultrafast' ? table.ultrafast[quote.model] : 1;
  if (multiplier === undefined) return null;
  const cached = Math.min(counts.input_tokens, counts.cached_input_tokens);
  return ((counts.input_tokens - cached) * quote.prices.input + cached * quote.prices.cached_input + counts.output_tokens * quote.prices.output) * multiplier / 1000000;
}
