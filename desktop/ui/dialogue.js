(() => {
  'use strict';
  const core = window.DragonDialogueCore;
  let title = '老大';
  const groups = window.DragonDialogueData.groups;
  window.DragonDialogue = Object.freeze({
    groups,
    get title() { return title; },
    setTitle(value) { title = core.addressTitle(value); },
    format(text) { return core.render(text, title); },
    text(group, index = 0, fallback = '') {
      const lines = groups[group] || [];
      return core.render(lines.length ? lines[index % lines.length].text : fallback, title);
    }
  });
})();
