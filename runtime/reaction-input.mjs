const MASK = '[已过滤]';

// Apply before the external request. Never retain a copy of a matched value in
// diagnostics. Counts describe what was removed, not what the secret was.
export function filterReactionText(input) {
  const filtered = { numbers: 0, secrets: 0 };
  const secret = () => { filtered.secrets++; return MASK; };
  const text = input
    .replace(/-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z]+ )*PRIVATE KEY-----|$)/g, secret)
    .replace(/\bBearer[ \t]+[A-Za-z0-9._~+/=-]+/gi, secret)
    .replace(/\b[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)["']?\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;，；]+)/g, secret)
    .replace(/(?:\b(?:(?:api[_-]?)?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|token|secret|password|passwd|authorization)\b|密钥|密码)["']?\s*[:=：]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;，；]+)/gi, secret)
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{8,}|AIza[A-Za-z0-9_-]{20,}|(?:AKIA|ASIA)[A-Z0-9]{12,})\b/g, secret)
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, secret)
    .replace(/(?<![A-Za-z0-9_])[A-Za-z0-9+/_-]{24,}={0,2}(?![A-Za-z0-9_])/g, value => {
      const compact = value.replace(/[-_]/g, '');
      const hex = /^[A-Fa-f0-9]{24,}$/.test(compact) && /[A-Fa-f]/.test(compact);
      const mixed = /[a-z]/.test(value) && /[A-Z]/.test(value) && (/[0-9]/.test(value) || value.length >= 32);
      return hex || mixed ? secret() : value;
    })
    .replace(/[0-9０-９]{6,}/g, () => { filtered.numbers++; return MASK; });
  const remaining = text.replaceAll(MASK, '');
  const meaningful = /[\p{L}\p{N}]/u.test(remaining) && !/^[\p{N}\s.,，。+\-:/%]+$/u.test(remaining);
  return { text, filtered, meaningful };
}
