(() => {
  'use strict';
  function text(parent, tag, value) { const el = document.createElement(tag); el.textContent = value; parent.append(el); return el; }
  function modelStatsText(row) {
    const cost = row.estimatedCostUsd === null ? '费用未知' : `${row.costComplete ? '≈' : '部分估算 '}$${row.estimatedCostUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const speed = row.tokensPerSecond === null ? '纯生成速度暂无记录' : `纯生成 ≈${row.tokensPerSecond.toLocaleString('zh-CN', { maximumFractionDigits: 1 })} token/秒`;
    const cache = row.cacheHitPercent === null ? '缓存命中率未知' : `缓存命中率 ${row.cacheHitPercent.toLocaleString('zh-CN', { maximumFractionDigits: 1 })}%`;
    return `${row.requests.toLocaleString('zh-CN')} 个请求 · ${cost} · ${speed} · ${cache}`;
  }
  function renderModels(parent, data) {
    parent.replaceChildren();
    if (!data.available) { text(parent, 'p', data.reason || '暂时无法读取模型统计，请刷新重试'); return; }
    if (!data.models.length) { text(parent, 'p', '所选范围内暂无本机用量记录。'); return; }
    const total = data.models.reduce((sum, row) => sum + row.tokens, 0);
    data.models.forEach((row, index) => {
      const card = document.createElement('section'); card.className = 'model-usage-card';
      card.style.setProperty('--model-color', ['#5844d6', '#12a6cf', '#b477ca', '#d08c35'][index % 4]);
      const heading = document.createElement('div'); heading.className = 'model-usage-heading';
      text(heading, 'strong', row.model); text(heading, 'strong', row.tokens.toLocaleString('zh-CN')); card.append(heading);
      const progress = document.createElement('progress'); progress.max = Math.max(total, 1); progress.value = row.tokens;
      progress.setAttribute('aria-label', row.model + ' token 用量占比'); card.append(progress);
      text(card, 'p', modelStatsText(row));
      text(card, 'small', `${total ? (row.tokens / total * 100).toFixed(1) : '0'}% 用量占比 · 首 token 计时覆盖 ${row.timedRequests}/${row.requests} 个请求`);
      parent.append(card);
    });
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { modelStatsText, renderModels };
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  function time(value) { if (!value) return '未知'; const d = new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value); return Number.isFinite(d.getTime()) ? d.toLocaleString() : '未知'; }
  function switchDesktop(command) {
    const expected=command==='desktop'?'standalone':'follow-codex';
    return new Promise((resolve,reject)=>{
      const clean=()=>{clearTimeout(timer);window.removeEventListener('whale-desktop-mode',done);};
      const done=e=>{if(e.detail===expected){clean();requestAnimationFrame(()=>requestAnimationFrame(resolve));}};
      const timer=setTimeout(()=>{clean();reject(Error('切换尚未完成，请稍后重试或查看运行状态'));},8000);
      window.addEventListener('whale-desktop-mode',done);
      window.dispatchEvent(new Event('whale-mode-changing'));
      Promise.resolve(window.whaleDesktop.command(command)).then(result=>{if(result===false||result?.ok===false){clean();reject(Error('切换未完成'));}},e=>{clean();reject(e);});
    });
  }
  function open() {
    const dialog = document.createElement('dialog'); dialog.className = 'whale-v3-dialog';
    text(dialog, 'h2', 'Codex 用量明细'); const content = document.createElement('div'); dialog.append(content);
    const actions = document.createElement('div'); actions.className = 'dialog-actions'; const refresh = text(actions, 'button', '刷新'), close = text(actions, 'button', '关闭'); dialog.append(actions);
    let generation = 0, modelGeneration = 0, period = 'today';
    const controls = document.createElement('label'); controls.className = 'model-usage-range'; controls.textContent = '模型统计范围';
    const select = document.createElement('select'); select.setAttribute('aria-label', '模型统计范围');
    for (const [value, label] of [['today', '今天'], ['7d', '近 7 天'], ['all', '全部记录']]) { const option = text(select, 'option', label); option.value = value; }
    controls.append(select);
    const models = document.createElement('div'); models.className = 'model-usage-list';
    async function loadModels(force = false) {
      const own = ++modelGeneration;
      models.replaceChildren(); text(models, 'p', '正在读取模型统计…首次读取需要下载统计组件并建立本地索引。');
      try {
        const response = await fetch('/api/model-usage?period=' + period + (force ? '&refresh=1' : ''), { cache: 'no-store' });
        if (!response.ok) throw Error('暂时无法读取模型统计，请刷新重试');
        const data = await response.json();
        if (own === modelGeneration && dialog.isConnected) renderModels(models, data);
      } catch (error) { if (own === modelGeneration && dialog.isConnected) { models.replaceChildren(); text(models, 'p', error.message); } }
    }
    select.onchange = () => { period = select.value; loadModels(); };
    async function load() {
      const own = ++generation; refresh.disabled = true; content.replaceChildren(); text(content, 'p', '正在读取…');
      try {
        const response = await fetch('/api/insights?refresh=1', { cache: 'no-store' }); if (!response.ok) throw Error('暂时无法读取额度'); const data = await response.json();
        if (own !== generation || !dialog.isConnected) return; content.replaceChildren(); const sub = data.subscription || {};
        text(content, 'h3', 'Codex 订阅');
        if (!sub.available) text(content, 'p', sub.reason || '暂无可用额度，请确认 Codex 已登录后刷新。');
        for (const item of sub.windows || []) {
          const box = document.createElement('section'); content.append(box);
          const valid = item.usedPercent !== null && item.usedPercent !== undefined && Number.isFinite(Number(item.usedPercent));
          text(box, 'strong', window.WhaleAccountView.quotaLabel(item));
          text(box, 'p', valid ? `已用 ${Number(item.usedPercent).toFixed(1)}% · 剩余 ${Math.max(0, 100 - Number(item.usedPercent)).toFixed(1)}%${item.stale ? '（数据已过期）' : ''}` : '额度比例未知');
          if (valid) { const progress = document.createElement('progress'); progress.max = 100; progress.value = Math.max(0, Math.min(100, item.usedPercent)); progress.setAttribute('aria-label', item.label || '额度'); box.append(progress); }
          text(box, 'p', '重置时间：' + time(item.resetsAt));
        }
        if(Number.isSafeInteger(sub.resetCreditsAvailable))text(content,'p','可用重置：'+sub.resetCreditsAvailable+' 次');
        text(content, 'h3', '各模型用量'); content.append(controls, models);
        loadModels(true);
        text(content, 'p', '来源：Codex Usage Dashboard · 按北京时间统计本机已保存日志，包含子代理的独立用量。');
        text(content, 'small', '纯生成速度（日志估算）＝有首 token 计时的总输出（含推理）÷ 对应生成时长；排除首 token 等待、工具执行及用户等待。缺少首 token 计时不计入速度，显示覆盖率。费用按 API 单价估算，不代表订阅扣款。请求数按 token 增量去重；缓存命中率＝缓存输入 ÷ 全部输入。');
      } catch (error) { if (own === generation) { content.replaceChildren(); text(content, 'p', error.message || '读取失败，请稍后重试'); } }
      finally { if (own === generation) refresh.disabled = false; }
    }
    refresh.onclick = load; close.onclick = () => dialog.close(); dialog.onclose = () => { generation++; modelGeneration++; dialog.remove(); }; document.body.append(dialog); dialog.showModal(); load();
  }
  const menu = document.querySelector('.dshwv-menu');
  if (menu) {
    const container = menu.querySelector('.dshwv-menu-root') || menu.firstElementChild || menu;
    const row = document.createElement('div'); row.className = 'dshwv-menu-row';
    const feedback = text(row, 'button', '音效与手感'); feedback.className = 'dshwv-sound';
    feedback.onclick = () => window.WhaleFeedback.open(); container.append(row);
    const usageRow = document.createElement('div'); usageRow.className = 'dshwv-menu-row';
    const insights = text(usageRow, 'button', '用量明细'); insights.className = 'dshwv-sound';
    insights.onclick = open; container.append(usageRow);
    if (window.whaleDesktop?.command) {
      const modeRow = document.createElement('div'); modeRow.className = 'dshwv-menu-row';
      for (const [command, label] of [['desktop', '进入桌面'], ['follow', '跟随 Codex']]) {
        const button = text(modeRow, 'button', label); button.className = 'dshwv-sound';
        button.onclick = async () => { button.disabled=true; try { await switchDesktop(command); window.whaleToast?.(command === 'desktop' ? '已切换为独立桌面模式' : '已切换为跟随 Codex'); } catch (e) { window.whaleToast?.(e.message); } finally {button.disabled=false;} };
      }
      container.append(modeRow);
    }
  }
  window.addEventListener('whale-open-insights', open);
})();
