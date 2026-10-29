import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { SessionParser } from '../runtime/session-monitor.mjs';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function verifyDesktop({ app, window, screen, setHost, dispatcher, errors }) {
  const output = process.env.WHALE_DESKTOP_VERIFY_DIR;
  const ev = code => window.webContents.executeJavaScript(code);
  const wait = async (code, label) => { for (let i = 0; i < 150; i++) { if (await ev(code)) return; await delay(50); } throw Error(label); };
  const original = dispatcher.dispatch;
  dispatcher.dispatch = async (url, options) => url.startsWith('/api/insights') ? { status: 200, headers: { 'Content-Type': 'application/json' }, body: Buffer.from(JSON.stringify({ subscription: { available: true, windows: [{ windowDurationMins: 10080, usedPercent: 50, resetsAt: Date.now() + 86400000 }] } })) } : original(url, options);
  try {
    const area = screen.getPrimaryDisplay().workArea;
    await setHost({ hostAlive: true, hostPid: 123456, window: '0', visible: true, attached: true, bounds: screen.dipToScreenRect(null, { ...area, width: 1000, height: 800 }) });
    await wait('window.__whaleRenderTest && document.querySelector(".dshwv-img")?.naturalWidth>0', 'image ready');
    await wait('document.readyState==="complete" && !__whaleRenderTest.status().busy', 'startup settled'); await delay(700);
    await ev('__whaleRenderTest.scale(1);__whaleRenderTest.place(350,420,false);__whaleRenderTest.close();');
    dispatcher.whale.recentGeneration = { model: 'gpt-6.1-sol', tokensPerSecond: 42.5, timestamp: Date.now() };
    await ev('WhaleAccountView.refreshRecent()');
    await ev('WhaleAccountView.refresh(true)');
    const geometry = [];
    async function capture(name) {
      await wait('__whaleRenderTest.status().shown && !__whaleRenderTest.status().switching', 'bubble visible'); await delay(300);
      await wait('Number(getComputedStyle(document.querySelector(".dshwv-text")).opacity)>=0.99 && Number(getComputedStyle(document.querySelector(".dshwv-bshape")).opacity)>=0.99', 'bubble fully painted');
      const metric = await ev(`(()=>{const pop=document.querySelector('.dshwv-pop').getBoundingClientRect(),frame=document.querySelector('.dshwv-frame[aria-hidden="false"]');
        const cx=pop.left+pop.width*454/1026,cy=pop.top+pop.height*248/700,rx=pop.width*354/1026,ry=pop.height*213/700;
        return {text:frame.textContent,pop:pop.toJSON(),rows:[...frame.children].filter(e=>getComputedStyle(e).display!=='none'&&e.textContent).map(e=>{const r=e.getBoundingClientRect();return {text:e.textContent,inside:Math.max(...[r.left,r.right].flatMap(x=>[r.top,r.bottom].map(y=>((x-cx)/rx)**2+((y-cy)/ry)**2)))<=1.03};})};})()`);
      assert.ok(metric.rows.every(row => row.inside), 'bubble text fits ellipse: ' + JSON.stringify(metric));
      geometry.push({ name, ...metric });
      const p = metric.pop;
      fs.writeFileSync(path.join(output, name + '.png'), (await window.webContents.capturePage({ x: Math.max(0, Math.floor(p.x) - 8), y: Math.max(0, Math.floor(p.y) - 8), width: Math.ceil(p.width) + 16, height: Math.ceil(p.height) + 16 })).toPNG());
      return metric;
    }
    await ev('__whaleRenderTest.scene(WhaleAccountView.bubbleModules(),0)');
    const quota = await capture('quota-recent'); assert.match(quota.text, /本周剩余 50%42.5 tok\/s/); assert.equal(quota.rows.length, 3);
    await ev('__whaleRenderTest.close()'); await delay(300);
    const now = Date.now() - 5000, jobs = [];
    const parser = new SessionParser({ id: 'synthetic-generation', defaultModel: 'gpt-6.1-sol', onStart: meta => dispatcher.whale.beginTurn(meta), onUpdate: meta => dispatcher.whale.updateTurn(meta), onEnd: meta => jobs.push(dispatcher.whale.finishTurn(meta)) });
    const put = (ms, type, payload) => parser.accept({ type, timestamp: new Date(now + ms).toISOString(), payload });
    put(0, 'event_msg', { type: 'task_started', turn_id: 'one' });
    put(1000, 'event_msg', { type: 'item_completed', item: { type: 'Reasoning' }, started_at_ms: now + 500 });
    put(1500, 'event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: 10000, cached_input_tokens: 8000, output_tokens: 1000 }, last_token_usage: { input_tokens: 10000, cached_input_tokens: 8000, output_tokens: 1000 } } });
    put(2000, 'event_msg', { type: 'task_complete', turn_id: 'one' }); await Promise.all(jobs);
    await wait('document.querySelector(".dshwv-frame[aria-hidden=false]")?.textContent.includes("本轮用量")', 'completion poll renders API estimate');
    const cost = await capture('completion-metrics'); assert.equal(cost.rows.length, 3); assert.match(cost.text, /80%命中/); assert.match(cost.text, /1000t\/s/);
    await ev('__whaleRenderTest.close()'); await delay(300);
    await ev(`__whaleRenderTest.cost({ok:true,seq:20,id:'mixed',turn:'mixed',outcome:'completed',tokens:123456,metricsComplete:true,modelMetrics:[{model:'gpt-6.1-sol',generationMs:2000,timedOutput:85,input:1000,cachedInput:980,apiCostUsd:.42},{model:'gpt-6-astra',generationMs:5000,timedOutput:144,input:2000,cachedInput:1994,apiCostUsd:1.27}]})`);
    const multi = await capture('completion-multi-model'); assert.equal(multi.rows.length, 3); assert.match(multi.text, /32.7t\/s · 1.69\$ · 99%命中/);
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'bubble-report.json'), JSON.stringify({ ok: true, geometry }, null, 2));
    await setHost({ hostAlive: false });
  } catch (error) { fs.writeFileSync(path.join(output, 'bubble-failure.png'), (await window.webContents.capturePage()).toPNG()); fs.writeFileSync(path.join(output, 'bubble-report.json'), JSON.stringify({ ok: false, error: error.stack, state: await ev('__whaleRenderTest.status()') })); app.exit(1); }
}
