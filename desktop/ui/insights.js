(() => {
  'use strict';
  function text(parent, tag, value) { const el = document.createElement(tag); el.textContent = value; parent.append(el); return el; }
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
    let generation = 0;
    async function load() {
      const own = ++generation; refresh.disabled = true; content.replaceChildren(); text(content, 'p', '正在读取…');
      try {
        const response = await fetch('/api/insights?refresh=1', { cache: 'no-store' }); if (!response.ok) throw Error('暂时无法读取额度'); const data = await response.json();
        if (own !== generation || !dialog.isConnected) return; content.replaceChildren(); const sub = data.subscription || {};
        if(window.WhaleAccountView?.mode!=='subscription') {
          const p=data.pricing||{};
          if(p.visible){text(content,'p',p.phase==='peak'?'当前为高峰期':p.phase==='off-peak'?'当前为谷期':'规则待更新');text(content,'p','下次切换：'+time(p.nextChangeAt));text(content,'p',p.note||'');}
          else text(content,'p','当前 API 没有适用的峰谷时段。');
          return;
        }
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
        text(content, 'h3', '本机已观测 token（近 7 天）'); const tokens = sub.tokens || data.tokens || {};
        for (const [key, label] of Object.entries({ total: '总量', input: '输入', output: '输出', cachedInput: '缓存输入', reasoningOutput: '推理输出' })) text(content, 'p', `${label}：${Number.isFinite(tokens[key]) ? tokens[key].toLocaleString() : '暂无记录'}`);
        if (Number.isFinite(tokens.last5Hours)) text(content, 'p', '滚动 5 小时：' + tokens.last5Hours.toLocaleString() + ' token');
        if (tokens.complete === false) text(content, 'p', '扫描结果不完整，目前显示部分已观测记录。' + (tokens.note || ''));
        text(content, 'small', '本机观测不包含其他设备的全部用量。缓存输入、推理输出可能为输入/输出的子集；不要重复相加。官方百分比不能换算为固定的剩余 token。');
        const pricing = data.pricing || {};
      } catch (error) { if (own === generation) { content.replaceChildren(); text(content, 'p', error.message || '读取失败，请稍后重试'); } }
      finally { if (own === generation) refresh.disabled = false; }
    }
    refresh.onclick = load; close.onclick = () => dialog.close(); dialog.onclose = () => { generation++; dialog.remove(); }; document.body.append(dialog); dialog.showModal(); load();
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
    const accountModeChanged=async()=>{
      const member=window.WhaleAccountView?.mode==='subscription';insights.textContent=member?'用量明细':'峰谷时段';insights.hidden=!member;
      if(!member){try{const p=await fetch('/api/pricing').then(r=>r.json());if(window.WhaleAccountView?.mode!=='subscription')insights.hidden=!p.visible;}catch{}}
    };
    accountModeChanged(); window.addEventListener('whale-account-view',accountModeChanged);setInterval(accountModeChanged,60000);
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
