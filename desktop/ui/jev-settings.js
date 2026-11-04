(() => {
  'use strict';
  let opened = null;
  function element(tag, text) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  }
  async function request(url, method = 'GET', body) {
    const response = await fetch(url, { method, cache: 'no-store',
      ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    const result = await response.json();
    if (!response.ok || result.ok === false) throw new Error(result.error || 'Jev 设置操作失败');
    return result;
  }
  function open() {
    if (opened) { opened.focus(); return; }
    const dialog = element('dialog'); dialog.className = 'whale-v3-dialog whale-jev-dialog';
    opened = dialog;
    dialog.append(element('h2', 'Jev 服务与网络'));
    dialog.append(element('p', '开启后，合格的短消息会通过所选网络发送给 Jev 服务判断。带截图时只分析附带的用户短文字，不上传图片。'));
    const fields = element('fieldset'); fields.disabled = true;
    const controls = {};
    function field(name, label, type = 'text') {
      const row = element('label'), title = element('span', label);
      const input = element(type === 'select' ? 'select' : 'input');
      input.name = name;
      if (type !== 'select') { input.type = type; input.autocomplete = 'off'; input.spellcheck = false; }
      row.append(title, input); fields.append(row); controls[name] = input;
      return input;
    }
    const enabledRow = element('label'); enabledRow.className = 'whale-jev-enabled';
    const enabled = element('input'); enabled.type = 'checkbox';
    enabledRow.append(enabled, element('span', '发送后情境反应（Jev）')); fields.append(enabledRow);
    const warning = element('aside'); warning.className = 'whale-jev-risk';
    warning.append(element('strong', '开启前请了解'));
    const risks = element('ul');
    for (const text of [
      '使用云端模型会产生计费；未显示气泡的判断请求也可能收费。',
      '短文字会发送给所选服务商。自动过滤长数字和疑似密钥不能保证移除所有敏感信息，仍存在隐私泄漏风险。',
      '频繁主动说话可能分散注意力、降低工作效率；可随时关闭此功能，收起桌宠后完全免打扰。'
    ]) risks.append(element('li', text));
    warning.append(risks); fields.append(warning);
    const provider = field('provider', '服务商', 'select');
    const endpoint = field('endpoint', '完整接口地址', 'url');
    endpoint.placeholder = 'https://服务地址/决策接口路径'; endpoint.maxLength = 4096;
    const model = field('model', '模型名称'); model.maxLength = 150;
    const keyEnv = field('keyEnv', '密钥环境变量'); keyEnv.maxLength = 128;
    keyEnv.placeholder = '例如 OPENROUTER_API_KEY';
    fields.append(element('small', '填写环境变量名，不填写密钥。设置环境变量后需重启桌宠；不使用 Codex 登录凭证。'));
    const mode = field('mode', '网络连接', 'select');
    for (const [value, label] of [['direct', '直连'], ['proxy', '指定 HTTP(S) 代理']]) mode.add(new Option(label, value));
    const proxyUrl = field('proxyUrl', '代理地址', 'url');
    proxyUrl.placeholder = 'http://127.0.0.1:端口'; proxyUrl.maxLength = 2048;
    fields.append(element('small', '直连忽略代理环境变量；指定代理失败时不会切换直连。代理地址不含账号密码。'));
    dialog.append(fields);
    const status = element('p', '正在读取设置…'); status.setAttribute('role', 'status'); dialog.append(status);
    const sourceStatus = element('p'); dialog.append(sourceStatus);
    dialog.append(element('small', '测试连接使用当前表单，只发送固定测试句，会产生少量模型费用；不会上传聊天，也不会保存表单。其他服务须兼容 Jev Decisions / System One 请求与响应。'));
    const actions = element('div'); actions.className = 'dialog-actions';
    const cancel = element('button', '取消'), test = element('button', '测试连接'), save = element('button', '保存');
    test.disabled = true; save.disabled = true;
    for (const button of [cancel, test, save]) button.type = 'button';
    actions.append(cancel, test, save); dialog.append(actions);
    let presets = null, testingId = null;
    const busy = value => { fields.disabled = value; test.disabled = value; save.disabled = value; };
    function draft() {
      return { enabled: enabled.checked, provider: provider.value, endpoint: endpoint.value.trim(), model: model.value.trim(), keyEnv: keyEnv.value.trim(),
        network: { mode: mode.value, proxyUrl: proxyUrl.value.trim() } };
    }
    function updateNetwork() { proxyUrl.disabled = mode.value !== 'proxy'; }
    mode.onchange = updateNetwork;
    provider.onchange = () => {
      const preset = presets[provider.value];
      for (const name of ['endpoint', 'model', 'keyEnv']) controls[name].value = preset[name];
      status.textContent = '请确认此服务的接口地址、模型和密钥环境变量。';
    };
    fields.addEventListener('input', () => { status.textContent = '配置已修改，尚未保存或测试。'; });
    cancel.onclick = () => dialog.close();
    save.onclick = async () => {
      busy(true); status.textContent = '正在保存…';
      try { await request('/api/jev-settings', 'PUT', draft()); window.dispatchEvent(new Event('whale-jev-settings-saved')); if (dialog.isConnected) { window.whaleToast?.('Jev 连接设置已保存'); dialog.close(); } }
      catch (error) { if (dialog.isConnected) status.textContent = error.message; }
      finally { if (dialog.isConnected) busy(false); }
    };
    test.onclick = async () => {
      busy(true); testingId = crypto.randomUUID(); status.textContent = '正在用当前配置测试连接…';
      try {
        const result = await request('/api/jev-test', 'POST', { ...draft(), requestId: testingId });
        if (dialog.isConnected) status.textContent = `连接成功 · ${result.networkMode === 'proxy' ? '指定代理' : '直连'} · ${result.elapsedMs} 毫秒 · ${result.model}（尚未保存）`;
      } catch (error) { if (dialog.isConnected) status.textContent = error.message; }
      finally { testingId = null; if (dialog.isConnected) busy(false); }
    };
    dialog.addEventListener('close', () => {
      if (testingId) request('/api/jev-test/cancel', 'POST', { requestId: testingId }).catch(() => window.whaleToast?.('未能取消连接测试，将按超时结束。'));
      dialog.remove(); opened = null;
    });
    document.body.append(dialog); dialog.showModal();
    request('/api/jev-settings').then(result => {
      if (!dialog.isConnected) return;
      presets = result.presets;
      sourceStatus.textContent = result.reactionStatus?.source?.suggestionSupport === false
        ? '本机可监听新发送的短消息，对问题反馈、返工、方案认可、任务安排和情绪作简短反应；Codex 输入框自动草稿尚无可读取接口。'
        : '';
      if (result.reactionStatus?.error) sourceStatus.textContent = result.reactionStatus.error;
      for (const [value, preset] of Object.entries(presets)) provider.add(new Option(preset.name, value));
      for (const name of ['provider', 'endpoint', 'model', 'keyEnv']) controls[name].value = result.settings[name];
      enabled.checked = result.settings.enabled === true;
      mode.value = result.settings.network.mode; proxyUrl.value = result.settings.network.proxyUrl;
      updateNetwork(); busy(false);
      status.textContent = result.keyConfigured ? '已读取到所选环境变量中的密钥。' : '尚未读取到所选密钥环境变量；保存配置不要求已有密钥。';
    }).catch(error => { if (dialog.isConnected) status.textContent = error.message; });
  }
  window.WhaleJevSettings = Object.freeze({ open });
})();
