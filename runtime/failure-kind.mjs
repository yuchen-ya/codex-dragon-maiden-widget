// Only a public category leaves the parser. Never retain provider error bodies.
const highDemand = /we['’]re\s+currently\s+experiencing\s+high\s+demand,\s+which\s+may\s+cause\s+temporary\s+errors\.?/i;
export function failureKind(value, depth = 0) {
  if (typeof value === 'string') return highDemand.test(value.slice(0, 16384)) ? 'high-demand' : null;
  if (!value || typeof value !== 'object' || depth > 3) return null;
  for (const key of ['message', 'error', 'detail', 'details']) {
    if (failureKind(value[key], depth + 1)) return 'high-demand';
  }
  return null;
}
