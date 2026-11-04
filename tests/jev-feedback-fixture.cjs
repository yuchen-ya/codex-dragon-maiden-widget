// Electron integration: real filesystem watch, local HTTP decision service,
// protocol, preload, renderer presentation acknowledgment and private journal.
const { app, BrowserWindow, protocol, session, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'qa-output', 'jev-feedback');
const dataDir = path.join(output, 'run-' + Date.now());
fs.mkdirSync(dataDir, { recursive: true });
app.setPath('userData', path.join(dataDir, 'profile'));
app.disableHardwareAcceleration();
protocol.registerSchemesAsPrivileged([{ scheme: 'whale', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
let saved = {}, win, dispatcher, server, calls = 0;
const errors = [], checks = [];
ipcMain.on('whale-storage', event => { event.returnValue = saved; });
ipcMain.on('whale-save-storage', (_event, values) => { saved = values; });
ipcMain.on('whale-shape', (_event, values) => { if (process.platform === 'win32') win.setShape(values); });
ipcMain.handle('whale-command', () => true);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const ev = code => win.webContents.executeJavaScript(code);
async function wait(predicate, label) {
  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) { if (await predicate()) return; await delay(30); }
  throw Error('Timed out: ' + label);
}
const journal = () => fs.readFileSync(path.join(dataDir, 'jev-reactions.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
async function main() {
  const { makeFixture } = await import(pathToFileURL(path.join(root, 'tests/desktop-fixture.mjs')));
  const { createDispatcher } = await import(pathToFileURL(path.join(root, 'runtime/dispatcher.mjs')));
  const { JevConnection } = await import(pathToFileURL(path.join(root, 'runtime/jev-connection.mjs')));
  const { REACTION_QUESTIONS } = await import(pathToFileURL(path.join(root, 'runtime/reaction-policy.mjs')));
  const options = await makeFixture(dataDir);
  const sessions = path.join(options.service.config.codexHome, 'sessions');
  fs.mkdirSync(sessions, { recursive: true });
  const rollout = path.join(sessions, 'fixture.jsonl');
  fs.writeFileSync(rollout, JSON.stringify({ type: 'session_meta', payload: { id: 'fixture-thread' } }) + '\n');
  const uploaded = [];
  server = http.createServer(async (req, res) => {
    const chunks = []; for await (const part of req) chunks.push(part);
    const request = JSON.parse(Buffer.concat(chunks));
    calls++; uploaded.push(request.state);
    const answers = { hold_back: { type: 'noul', noul: 0.05 } };
    for (const [name, choice] of Object.entries({ relation: 'unavailable', emotion: 'weak_or_none', occasion: 'revision' })) {
      answers[name] = { type: 'choice', choice, probabilities: Object.fromEntries(Object.keys(REACTION_QUESTIONS[name].criteria).map(label => [label, label === choice ? 1 : 0])) };
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ answers }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const connection = new JevConnection({ dataDir, env: { FIXTURE_JEV_KEY: 'FAKE_ONLY' } });
  connection.save({ enabled: true, provider: 'custom', endpoint: 'http://127.0.0.1:' + server.address().port,
    model: 'fixture', keyEnv: 'FIXTURE_JEV_KEY', network: { mode: 'direct', proxyUrl: '' } });
  dispatcher = createDispatcher({ dataDir, ...options, jevConnection: connection });
  session.defaultSession.protocol.handle('whale', async request => {
    const url = new URL(request.url);
    const result = await dispatcher.dispatch(url.pathname + url.search, { method: request.method,
      body: ['GET', 'HEAD'].includes(request.method) ? null : Buffer.from(await request.arrayBuffer()) });
    return new Response(request.method === 'HEAD' ? null : result.body, { status: result.status, headers: result.headers });
  });
  win = new BrowserWindow({ width: 880, height: 760, show: false, frame: false, transparent: true,
    webPreferences: { backgroundThrottling: false, preload: path.join(root, 'desktop/preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, additionalArguments: ['--whale-render-test'] } });
  win.webContents.on('console-message', (_event, details) => { if (details.level === 'error') errors.push(details.message); });
  win.setIgnoreMouseEvents(true, { forward: false });
  await win.loadURL('whale://widget/widget.html'); win.showInactive();
  await wait(() => ev('!!window.__whaleRenderTest && !!window.WhaleCollapse'), 'renderer ready');
  await wait(() => dispatcher.reactions.visible && !dispatcher.reactions.blocked, 'renderer ready to show a reaction');
  function send(id, text) {
    fs.appendFileSync(rollout, JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', id,
      content: [{ type: 'input_text', text }], internal_chat_message_metadata_passthrough: {
        turn_id: 'fixture-turn', create_time: Date.now() / 1000, content_item_kinds: ['user.text'] } } }) + '\n');
  }
  send('first', '这版还没到位，再调整一下。');
  await wait(() => journal().some(record => record.event === 'shown'), 'visible bubble acknowledgment');
  assert.equal(calls, 1);
  assert.equal(await ev('__whaleRenderTest.status().scene'), 'reaction');
  assert.match(await ev('document.querySelector(".dshwv-pop").innerText'), /还没过老大这关/);
  await delay(350);
  fs.writeFileSync(path.join(output, 'reaction.png'), (await win.webContents.capturePage()).toPNG());
  await delay(6000);
  assert.equal(await ev('__whaleRenderTest.status().scene'), 'reaction');
  assert.equal(await ev('__whaleRenderTest.status().shown'), true);
  await delay(2200);
  assert.equal(await ev('__whaleRenderTest.status().shown'), false);
  checks.push('Jev 短句超过 5 秒候选有效期后仍可读，8 秒阅读期结束自动收起');
  const shown = journal().find(record => record.event === 'shown');
  for (const event of ['observed', 'received', 'request-started', 'decision', 'notice-ready']) {
    assert.ok(journal().some(record => record.event === event && record.trace === shown.trace), event);
  }
  checks.push('新增落盘消息经真实监听、HTTP 判定和 renderer 气泡展示确认，日志使用同一匿名追踪号');
  send('cooldown', '继续调整一下。');
  await wait(() => journal().some(record => record.reason === 'cooldown'), 'cooldown skip');
  assert.equal(calls, 1);
  checks.push('气泡展示后的冷却期直接跳过，没有第二笔付费请求');
  await ev("document.querySelector('.dshwv-tail').dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true}))");
  await wait(() => ev('WhaleCollapse.collapsed && !WhaleCollapse.busy'), 'collapsed');
  await wait(() => dispatcher.reactions.blocked, 'hidden state reached the host');
  send('hidden', '再继续检查一下。');
  await wait(() => journal().some(record => record.reason === 'ui-blocked'), 'hidden skip');
  assert.equal(calls, 1);
  assert.equal(await ev('__whaleRenderTest.status().shown'), false);
  checks.push('收起后没有额外请求或气泡');
  await ev("document.querySelector('.dshwv-tail').dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true}))");
  await wait(() => ev('!WhaleCollapse.collapsed && !WhaleCollapse.busy'), 'expanded');
  await ev('WhaleJevSettings.open()');
  await wait(() => ev("!!document.querySelector('.whale-jev-risk') && !document.querySelector('.whale-jev-dialog fieldset').disabled"), 'risk notice');
  const risk = await ev("(() => {const e=document.querySelector('.whale-jev-risk'),r=e.getBoundingClientRect(),s=getComputedStyle(e);return {text:e.innerText,color:s.color,background:s.backgroundColor,top:r.top,bottom:r.bottom,height:innerHeight};})()");
  assert.match(risk.text, /计费/); assert.match(risk.text, /隐私泄漏风险/); assert.match(risk.text, /降低工作效率/);
  assert.equal(risk.background, 'rgb(255, 240, 241)'); assert.ok(risk.top > 0 && risk.bottom < risk.height);
  fs.writeFileSync(path.join(output, 'risk-notice.png'), (await win.webContents.capturePage()).toPNG());
  checks.push('Jev 配置首屏浅红提示包含计费、过滤局限与效率风险，无额外确认步骤');
  const raw = fs.readFileSync(path.join(dataDir, 'jev-reactions.jsonl'), 'utf8');
  for (const value of ['这版还没到位', 'FAKE_ONLY', 'fixture-thread', rollout]) assert.ok(!raw.includes(value));
  assert.deepEqual(uploaded, [{ route: 'user_only', user_message: '这版还没到位，再调整一下。' }]);
  assert.deepEqual(errors, []);
  checks.push('内部日志无正文、密钥、原始消息/聊天标识或本机源路径；renderer 无错误');
  await ev("document.querySelector('.whale-jev-dialog').close();document.querySelector('.dshwv-menu-btn').click()");
  await wait(() => ev("!document.querySelector('#dshw-address-title').disabled"), 'address field');
  assert.equal(await ev("document.querySelector('#dshw-address-title').value"), '老大');
  await ev("(() => {const input=document.querySelector('#dshw-address-title');input.value='主人';input.parentElement.querySelector('button').click();})()");
  await wait(() => ev("DragonDialogue.title === '主人'"), 'saved address');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, '.dshw-size.json'))).addressTitle, '主人');
  fs.writeFileSync(path.join(output, 'address-setting.png'), (await win.webContents.capturePage()).toPNG());
  await ev("document.querySelector('.dshwv-menu-btn').click()");
  await delay(Math.max(0, 10100 - (Date.now() - dispatcher.reactions.lastShown)));
  await wait(() => !dispatcher.reactions.blocked, 'menu closed');
  send('addressed', '这版还需要继续调整。');
  await wait(() => journal().filter(record => record.event === 'shown').length === 2, 'addressed reaction');
  assert.match(await ev('document.querySelector(".dshwv-pop").innerText'), /主人/);
  assert.ok(!JSON.stringify(uploaded).includes('主人'), 'the custom address stays local');
  checks.push('设置页保存称呼为主人，Jev 气泡使用新称呼，称呼不上传模型');
  await ev('__whaleRenderTest.close()'); await delay(400);
  await ev("window.dispatchEvent(new Event('whale-tail-tug'))");
  await wait(() => ev("__whaleRenderTest.status().scene === 'tail'"), 'addressed tail line');
  assert.match(await ev('document.querySelector(".dshwv-pop").innerText'), /干嘛，主人/);
  checks.push('尾巴互动共用称呼占位符');
  const { acceptInteractionHook } = await import(pathToFileURL(path.join(root, 'runtime/interaction-notices.mjs')));
  const question = { hook_event_name: 'PreToolUse', session_id: 'fixture-thread', turn_id: 'fixture-turn',
    tool_name: 'request_user_input', tool_use_id: 'addressed-question' };
  acceptInteractionHook(dataDir, question);
  await wait(() => ev("__whaleRenderTest.status().scene === 'wait'"), 'addressed question');
  assert.match(await ev('document.querySelector(".dshwv-pop").innerText'), /主人，我有个问题/);
  acceptInteractionHook(dataDir, { ...question, hook_event_name: 'PostToolUse' });
  await wait(() => ev("__whaleRenderTest.status().scene !== 'wait'"), 'question resolved');
  checks.push('真实提问提醒同样代入自定义称呼');
  await dispatcher.close();
  const custom = { version: 1, groups: { tail_pull: [{ id: 'long-tail', text: '{title}，' + '继续'.repeat(100) }] } };
  fs.writeFileSync(path.join(dataDir, 'dialogue-custom.json'), JSON.stringify(custom));
  const restarted = new JevConnection({ dataDir, env: { FIXTURE_JEV_KEY: 'FAKE_ONLY' } });
  dispatcher = createDispatcher({ dataDir, ...options, jevConnection: restarted });
  await win.reload();
  await wait(() => ev("window.DragonDialogue?.title === '主人' && !!window.WhaleCollapse"), 'reloaded address');
  await wait(() => dispatcher.reactions.visible && !dispatcher.reactions.blocked, 'reloaded reaction state');
  send('no-dialogue', '继续修改。');
  await wait(() => journal().some(record => record.reason === 'no-dialogue'), 'deleted reactions skip payment');
  assert.equal(calls, 2);
  await ev("window.dispatchEvent(new Event('whale-tail-tug'))");
  await wait(() => ev("__whaleRenderTest.status().scene === 'tail'"), 'custom long tail line');
  const displayed = await ev('document.querySelector(".dshwv-pop").innerText');
  assert.ok(displayed.includes('主人')); assert.ok(displayed.endsWith('…'));
  assert.equal([...displayed].length, 80);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 'dialogue-custom.json'))), custom);
  checks.push('重启后称呼和个人库保留；长台词安全缩短，删除全部反应后不调用模型');
  await ev('__whaleRenderTest.close()'); await delay(400);
  acceptInteractionHook(dataDir, { hook_event_name: 'PreToolUse', session_id: 'fixture-thread', turn_id: 'fixture-turn',
    tool_name: 'request_user_input', tool_use_id: 'fixture-question' });
  await wait(() => ev("__whaleRenderTest.status().scene === 'wait'"), 'missing question dialogue fallback');
  assert.match(await ev('document.querySelector(".dshwv-pop").innerText'), /待回答/);
  assert.deepEqual(errors, []);
  checks.push('提问台词被删除后仍显示待回答提醒，renderer 无错误');
  acceptInteractionHook(dataDir, { hook_event_name: 'PostToolUse', session_id: 'fixture-thread', turn_id: 'fixture-turn',
    tool_name: 'request_user_input', tool_use_id: 'fixture-question' });
  fs.unlinkSync(path.join(dataDir, '.dshw-size.json')); saved = {};
  await win.reload();
  await wait(() => ev("!!document.querySelector('.dshwv-volpct') && !!window.WhaleCollapse"), 'fresh audio controls');
  assert.equal(await ev("document.querySelector('.dshwv-volpct').textContent"), '0%');
  assert.equal(await ev("document.querySelector('input[type=range][max=\"1\"]').value"), '0');
  checks.push('空配置首次启动的音量控件与运行默认值均为静音');
}
app.whenReady().then(main).catch(async error => {
  errors.push(error.stack || String(error)); process.exitCode = 1;
  if (win) fs.writeFileSync(path.join(output, 'failure.png'), (await win.webContents.capturePage()).toPNG());
}).finally(async () => {
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ ok: errors.length === 0, checks, errors, calls,
    scope: '隔离 Electron、真实文件监听/协议/renderer 与本地假服务；外部 Jev 合成测试另记，不代表原生跨应用点击验收。' }, null, 2));
  await dispatcher?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  win?.destroy(); app.quit();
});
