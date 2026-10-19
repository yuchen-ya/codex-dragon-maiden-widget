(() => {
  'use strict';
  const limit = 24 * 1024 * 1024;
  function element(tag, text) { const el = document.createElement(tag); if (text) el.textContent = text; return el; }
  function open() {
    const dialog = document.createElement('dialog'); dialog.className = 'whale-v3-dialog';
    dialog.append(element('h2', '本地创意工坊'), element('p', '把自己搭配的角色、气泡图片和音效打包分享，或使用别人分享的素材包。这是本地素材交换，不是在线商店。'));
    const steps=element('ol');
    for(const line of ['制作自己的包：先在菜单的角色、音效或资源管理中导入素材，再点“导出本地素材”。','使用分享包：选择别人导出的 whale-workshop.json，确认下方清单，再点“导入所选包”。','导入完成后点“重新加载素材列表”，到菜单的角色/音效下拉或自定义气泡图库中选择。导入不会自动替换正在使用的角色。'])steps.append(element('li',line));
    dialog.append(steps,element('p','仅支持小鲸鱼工坊 JSON 包（最大 24 MiB），不是 DSH 插件 ZIP 或安装程序。不会导入 API 配置、账本或聊天；重名素材使用新编号保存。'));
    const preview=element('div');preview.className='workshop-preview';dialog.append(preview);
    const status = element('p'); status.setAttribute('role', 'status');
    const file = document.createElement('input'); file.type = 'file'; file.accept = '.json,application/json'; file.setAttribute('aria-label', '选择工坊 JSON 包');
    const importButton = element('button', '导入所选包'); importButton.disabled = true; let selected;
    file.onchange = async () => { selected = null; importButton.disabled = true; const candidate = file.files?.[0]; if (!candidate) return; if (candidate.size > limit) { status.textContent = '包超过 24 MiB，请缩减素材后重试。'; return; }
      try { const parsed = JSON.parse(await candidate.text()); if (parsed.schema !== 'api-balance-whale-workshop' || parsed.version !== 1) throw Error('不是支持的工坊包'); selected = parsed; preview.replaceChildren(); status.textContent = ['roles','images','fragments','groups'].map((k,i) => ['角色','图片','音频片段','音效组'][i] + ' ' + (Array.isArray(parsed[k]) ? parsed[k].length : 0)).join(' · '); for(const [kind,label] of [['roles','角色'],['images','气泡图'],['fragments','音频'],['groups','音效组']])for(const item of (Array.isArray(parsed[kind])?parsed[kind]:[]).slice(0,30))preview.append(element('p',label+'：'+String(item.name||'未命名').slice(0,100))); importButton.disabled = false; } catch { status.textContent = '包格式无法识别，请选择有效的工坊 JSON。'; preview.replaceChildren(); }
    };
    importButton.onclick = async () => { if (!selected) return; importButton.disabled = true;
      try { const response = await fetch('/api/workshop/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(selected) }); const result = await response.json(); if (!response.ok || result.ok === false) throw Error(result.error || '导入未完成'); status.textContent = '导入完成。重新加载后可在角色、音效与气泡素材列表中选择。'; selected = null; file.value = ''; reload.hidden = false; } catch (error) { status.textContent = error.message; importButton.disabled = false; }
    };
    const exportButton = element('button', '导出本地素材'); exportButton.onclick = async () => { exportButton.disabled = true; try { const response = await fetch('/api/workshop/export', { cache: 'no-store' }); const pack = await response.json(); if (!response.ok || pack.ok === false) throw Error(pack.error || '导出未完成'); const blob = new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' }); if (blob.size > limit) throw Error('导出包超过 24 MiB，请先减少素材。'); const url = URL.createObjectURL(blob), link = element('a'); link.href = url; link.download = 'whale-workshop.json'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); status.textContent = '已生成素材包。'; } catch (error) { status.textContent = error.message; } finally { exportButton.disabled = false; } };
    const reload = element('button', '重新加载素材列表'); reload.hidden = true; reload.onclick = () => location.reload();
    const close = element('button', '关闭'); close.onclick = () => dialog.close(); const actions = element('div'); actions.className = 'dialog-actions'; actions.append(exportButton, importButton, reload, close); dialog.append(file, status, actions); dialog.onclose = () => dialog.remove(); document.body.append(dialog); dialog.showModal();
  }
  const menu = document.querySelector('.dshwv-menuview'); if (menu) { const row = element('div'); row.className = 'dshwv-menu-row'; const button = element('button', '本地创意工坊'); button.className = 'dshwv-sound'; button.onclick = open; row.append(button); menu.append(row); }
})();
