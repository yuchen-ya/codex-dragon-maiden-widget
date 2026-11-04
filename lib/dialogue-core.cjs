// Shared by Node and the renderer; dialogue files are data, never executable code.
(function () {
  'use strict';
  const GROUPS = ['quotes', 'tail_pull', 'tail_rapid', 'question', 'approval', 'busy', 'proud',
    'finished', 'relieved_run', 'hard_success', 'coding_rest', 'editing_rest', 'rest',
    'revision', 'problem', 'accepted', 'frustration', 'task', 'discussion'];
  const MAX_TEXT = 80;
  function addressTitle(value, strict = false) {
    if (value === undefined || value === '') return '老大';
    const valid = typeof value === 'string' && !/[\u0000-\u001f\u007f{}]/.test(value) && [...value.trim()].length <= 12;
    if (!valid) {
      if (strict) throw new Error('称呼最多 12 个字，不能包含换行、控制字符或花括号');
      return '老大';
    }
    return value.trim() || '老大';
  }
  function normalizeLibrary(value) {
    const groups = Object.fromEntries(GROUPS.map(group => [group, []]));
    let rejected = 0;
    if (!value || value.version !== 1 || !value.groups || typeof value.groups !== 'object' || Array.isArray(value.groups)) {
      return { groups, rejected: 1 };
    }
    for (const group of GROUPS) {
      const entries = value.groups[group];
      if (entries === undefined) continue;
      if (!Array.isArray(entries)) { rejected++; continue; }
      const seen = new Set();
      for (const entry of entries.slice(0, 200)) {
        if (!entry || typeof entry.id !== 'string' || !/^[A-Za-z0-9_-]{1,48}$/.test(entry.id) || seen.has(entry.id) ||
            typeof entry.text !== 'string' || !entry.text.trim() || [...entry.text].length > 1000 ||
            /[\u0000-\u0008\u000b-\u001f\u007f]/.test(entry.text) || /[{}]/.test(entry.text.replaceAll('{title}', '')) ||
            entry.tone !== undefined && !['proud', 'celebrate', 'support', 'comment'].includes(entry.tone) ||
            entry.minRemainingPercent !== undefined && (typeof entry.minRemainingPercent !== 'number' ||
              !Number.isFinite(entry.minRemainingPercent) || entry.minRemainingPercent < 0 || entry.minRemainingPercent > 100)) {
          rejected++; continue;
        }
        seen.add(entry.id);
        groups[group].push({ id: entry.id, text: entry.text.trim().replace(/\s+/g, ' '), tone: entry.tone || 'comment',
          ...(entry.minRemainingPercent === undefined ? {} : { minRemainingPercent: entry.minRemainingPercent }) });
      }
      rejected += Math.max(0, entries.length - 200);
    }
    return { groups, rejected };
  }
  function render(text, title = '老大') {
    if (typeof text !== 'string') return '';
    const characters = [...text.replaceAll('{title}', () => addressTitle(title)).trim()];
    return characters.length > MAX_TEXT ? characters.slice(0, MAX_TEXT - 1).join('') + '…' : characters.join('');
  }
  const api = Object.freeze({ GROUPS, MAX_TEXT, addressTitle, normalizeLibrary, render });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.DragonDialogueCore = api;
})();
