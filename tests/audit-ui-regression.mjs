import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { verifyFxPopover } from './privacy-ui-regression.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const api = 'window.__whaleRenderTest';
const front = `document.querySelector('.dshwv-frame[data-buffer="'+${api}.status().front+'"]')`;

export async function verifyAuditUI({ window, ev, wait, clickAt, hitPoint, move, dispatcher, output, dataDir }) {
  const resolved = path.resolve(dataDir);
  assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('whale-follow-test-'), 'UI audit requires the isolated desktop fixture');
  assert.equal(path.resolve(dispatcher.whale.config.codexHome), path.join(resolved, 'fixture-codex'));
  const checks = [], details = {}, service = dispatcher.whale, originalLastTurn = service.lastTurn, originalRecords = service.usageRecords;
  const initialSettings = service.readUsageSettings(), sizeFile = path.join(resolved, '.dshw-size.json'), initialSize = fs.readFileSync(sizeFile, 'utf8');
  const originalBounds = window.getBounds();
  let record = { ok: true, seq: 1000, id: 'audit:first-failure', turn: 'first-failure', outcome: 'failed', completionKind: 'failed',
    failureKind: 'high-demand', amount: null, tokens: 17, currency: 'USD', costState: 'unknown', notify: true, ts: Date.now() - 60000, notificationAt: null };
  let publishing = false;
  service.lastTurn = () => { if (!publishing) return { ok: true, seq: 0, turn: null }; if (record.notificationAt === null) record.notificationAt = Date.now(); return { ...record }; };
  const stable = () => wait(`!${api}.status().switching&&(!${api}.status().shown||(getComputedStyle(document.querySelector('.dshwv-bshape')).opacity==='1'&&getComputedStyle(document.querySelector('.dshwv-text')).opacity==='1'))`, 'audit bubble commit and visual fade');
  const text = () => ev(`${front}.textContent`);
  const close = async () => { await ev(`${api}.close()`); await delay(400); };
  const capture = name => window.webContents.capturePage().then(image => fs.writeFileSync(path.join(output, name + '.png'), image.toPNG()));
  const checkbox = async (selector, checked) => ev(`(() => {const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw new Error('missing checkbox');el.checked=${checked};el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const normalToggle = 'input[title="每轮对话结束后自动显示本轮消耗金额"]';
  const publish = async (kind, extra = {}) => {
    record = { ...record, seq: record.seq + 1, id: 'audit:' + kind + ':' + (record.seq + 1), turn: 'turn-' + (record.seq + 1),
      outcome: kind === 'success' ? 'completed' : kind === 'cancelled' ? 'aborted' : 'failed', completionKind: kind,
      failureKind: null, amount: null, costState: 'unknown', tokens: 19, ts: Date.now() - 5000, notificationAt: Date.now(), ...extra };
    await ev(`${api}.poll()`);
    await wait(`Number(localStorage.getItem('dshw-last-seq'))===${record.seq}`, 'audit notice consumed');
    await stable(); await delay(250);
  };
  const hold = () => ev(`window.__auditFrame=${front};window.__auditNodes=[...window.__auditFrame.childNodes];window.__auditText=window.__auditFrame.textContent;true`);
  const sameNodes = () => ev(`window.__auditFrame===${front}&&window.__auditNodes.length===window.__auditFrame.childNodes.length&&window.__auditNodes.every((n,i)=>n===window.__auditFrame.childNodes[i])`);
  const plays = () => ev('window.__auditMediaPlays.length');
  const clickVisible = async selector => {
    const point = await ev(`new Promise((resolve,reject)=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el||!el.checkVisibility({opacityProperty:true})){reject(new Error('missing visible control'));return;}el.scrollIntoView({block:'nearest'});let previous=null,stable=0;const timeout=setTimeout(()=>reject(new Error('control geometry never stabilized')),2500);function sample(){const r=el.getBoundingClientRect(),menu=el.closest('.dshwv-menu'),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2),current=[r.x,r.y,r.width,r.height];if(previous&&current.every((v,i)=>Math.abs(v-previous[i])<.05)&&(!menu||getComputedStyle(menu).opacity==='1')&&(hit===el||el.contains(hit)))stable++;else stable=0;previous=current;if(stable>=3){clearTimeout(timeout);resolve({x:r.x+r.width/2,y:r.y+r.height/2,width:innerWidth,height:innerHeight});}else requestAnimationFrame(sample);}requestAnimationFrame(sample);})`);
    assert.ok(point.x > 0 && point.y > 0 && point.x < point.width && point.y < point.height, 'control is inside the viewport: ' + selector);
    await clickAt(point);
  };
  try {
    service.writeUsageSettings({ ...initialSettings, alert: { ...initialSettings.alert, on: false }, budget: { ...initialSettings.budget, on: false },
      taskEnd: { on: true, sel: 'preset:duck:press' }, outcomeNotice: { failed: true, cancelled: true } });
    fs.writeFileSync(sizeFile, JSON.stringify({ ...JSON.parse(initialSize), vol: 0.2, sound: true, bubbleOn: true, turnCostOn: false, turnCostCloseMs: 0 }));
    await ev("localStorage.removeItem('dshw-last-seq');localStorage.removeItem('dshw-last-turn-id')");
    const reloaded = once(window.webContents, 'did-finish-load'); window.webContents.reload(); await reloaded;
    await ev(`window.__auditOriginalPlay=HTMLMediaElement.prototype.play;window.__auditMediaPlays=[];window.__auditSpyAt=Date.now();
      HTMLMediaElement.prototype.play=function(){window.__auditMediaPlays.push(this.src);return Promise.resolve();};
      window.__auditBufferStart=AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start=function(){window.__auditMediaPlays.push('decoded-audio');};true;`);
    publishing = true;
    await wait(`${api}?.poll&&${api}.status().scene==='cost'&&!${api}.status().switching`, 'first-poll delayed-publication failure notice');
    await stable();
    assert.ok(await ev('window.__auditSpyAt') <= record.notificationAt, 'audio spy installed before first publication');
    assert.match(await text(), /挤不进去\.\.\./); assert.match(await text(), /金额未知/); assert.doesNotMatch(await text(), /\$\s*0\.00/);
    assert.equal(await plays(), 0); assert.equal(await ev(`document.querySelector(${JSON.stringify(normalToggle)}).checked`), false);
    details.noticeLayout = await ev(`(() => {const frame=${front},bounds=frame.getBoundingClientRect(),shape=document.querySelector('.dshwv-bshape'),inverse=shape.getScreenCTM().inverse();
      const inWhite=(x,y)=>shape.isPointInFill(new DOMPoint(x,y).matrixTransform(inverse));
      return{frame:bounds.toJSON(),lines:[...frame.querySelectorAll('.dshwv-label,.dshwv-hint')].map(el=>{const range=document.createRange();range.selectNodeContents(el);const ranges=[...range.getClientRects()].filter(r=>r.width&&r.height).map(r=>({rect:r.toJSON(),insideWhite:[[r.left+.5,r.top+.5],[r.right-.5,r.top+.5],[r.left+.5,r.bottom-.5],[r.right-.5,r.bottom-.5]].every(([x,y])=>inWhite(x,y))}));return{text:el.textContent,rect:el.getBoundingClientRect().toJSON(),scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight,ranges};})};})()`);
    for (const line of details.noticeLayout.lines) {
      assert.ok(line.rect.left >= details.noticeLayout.frame.left - 1 && line.rect.right <= details.noticeLayout.frame.right + 1, 'notice text stays within the bubble content width');
      assert.ok(line.scrollWidth <= line.clientWidth + 1 && line.scrollHeight <= line.clientHeight + 1, 'notice text is wrapped rather than clipped');
      assert.ok(line.ranges.length > 0 && line.ranges.every(range => range.insideWhite), 'actual text line ranges fit inside the white SVG bubble');
    }
    details.firstPublication = { originalEndAt: record.ts, publishedAt: record.notificationAt, text: await text() };
    await capture('audit-first-failure');
    checks.push('a terminal high-demand failure published after startup is shown on the first poll with unknown amount and no success sound');

    await hold(); const firstText = await text(), firstEpoch = await ev(`${api}.status().epoch`);
    record = { ...record, amount: 1.25, costState: 'observed' }; await ev(`${api}.poll()`); await delay(300);
    assert.equal(await text(), firstText); assert.equal(await sameNodes(), true); assert.equal(await ev(`${api}.status().epoch`), firstEpoch); assert.equal(await plays(), 0);
    checks.push('same-sequence billing revisions neither reopen the visible bubble nor replay sound');

    await close();
    await publish('failed'); assert.equal(await ev(`${api}.status().shown`), false);
    await publish('cancelled'); assert.equal(await ev(`${api}.status().shown`), false); assert.equal(await plays(), 0);
    await publish('failed', { failureKind: 'high-demand', costState: 'pending' });
    assert.match(await text(), /待记账/); assert.doesNotMatch(await text(), /\$\s*0\.00/); assert.equal(await plays(), 0);
    checks.push('ordinary failure stays silent; cancellation obeys the cost switch; high-demand remains eligible and unknown amounts are not zero');

    await close(); await checkbox(normalToggle, true);
    const beforeCancellation = await plays();
    await publish('cancelled', { amount: 0.37, costState:'observed', source:'shared-key-interval' });
    assert.match(await text(), /本轮已观测消耗/);assert.match(await text(), /0\.37/);
    assert.doesNotMatch(await text(), /挤不进去|靠岸|待命|逆风/);assert.equal(await plays(),beforeCancellation);
    await capture('cancelled-consumption');await close();
    await publish('cancelled', {amount:null,costState:'pending',tokens:23});
    assert.match(await text(), /待记账/);assert.doesNotMatch(await text(), /挤不进去|\$\s*0\.00/);assert.equal(await plays(),beforeCancellation);
    await close();checks.push('mid-turn cancellation shows neutral observed consumption or pending cost with tokens, never a busy phrase or success sound');
    await ev(`(() => {const vol=[...document.querySelectorAll('input[type=range]')].find(el=>el.max==='1');vol.value='0.2';vol.dispatchEvent(new Event('input',{bubbles:true}));
      const sound=document.querySelector('input[title="每轮对话回复完成时播放提示音"]');sound.checked=true;sound.dispatchEvent(new Event('change',{bubbles:true}));
      const select=document.querySelector('select[title^="选择任务结束音"]');select.value='preset:duck:press';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await delay(150); const beforeSuccess = await plays();
    await publish('success', { amount: 1.25, costState: 'observed', label: '本轮测试扣费:' });
    assert.match(await text(), /1\.25/);
    await wait(`window.__auditMediaPlays.length === ${beforeSuccess+1}`, 'decoded completion sound scheduled exactly once');
    assert.equal(await plays(), beforeSuccess + 1);
    await hold(); const successEpoch = await ev(`${api}.status().epoch`);
    record = { ...record, amount: 2.5 }; await ev(`${api}.poll()`); await delay(250);
    assert.equal(await plays(), beforeSuccess + 1); assert.equal(await sameNodes(), true); assert.equal(await ev(`${api}.status().epoch`), successEpoch);
    checks.push('normal completion still emits one success cue, and same-sequence corrections stay silent');
    await close();

    await ev(`(() => {
      window.__auditOriginalFetch=window.fetch;window.__auditFx={rate:7,requests:[]};window.__auditMediaRequests=[];window.__auditRejectMedia=false;
      window.fetch=function(input,options){const url=String(typeof input==='string'?input:input.url),method=String(options?.method||'GET').toUpperCase();
        if(url.includes('/api/fx/usd-cny')){window.__auditFx.requests.push(url);const forced=url.includes('refresh=1');return Promise.resolve(new Response(JSON.stringify({ok:true,usdCny:window.__auditFx.rate,date:'2026-09-15',retrievedAt:new Date().toISOString(),checkedAt:new Date().toISOString(),stale:false,cooldownRemainingMs:forced?15000:0}),{headers:{'Content-Type':'application/json'}}));}
        if(method!=='GET'&&/\\/(?:roles|role-|bubble-img)/.test(url)){window.__auditMediaRequests.push(url);if(window.__auditRejectMedia)return Promise.resolve(new Response(JSON.stringify({ok:false,error:'测试磁盘空间不足，保存未完成'}),{status:507,headers:{'Content-Type':'application/json'}}));}
        return window.__auditOriginalFetch.apply(this,arguments);
      };
      window.__auditOriginalRandom=Math.random;window.__auditDraws=0;Math.random=()=>{window.__auditDraws++;return .2;};
    })()`);
    await ev(`WhaleMoney.refreshQuote({apply:true}).then(()=>WhaleMoney.setDisplayCurrency('CNY'))`);
    await ev(`${api}.place(120,80,false);if(!document.querySelector('.dshwv-menu').checkVisibility({opacityProperty:true}))document.querySelector('.dshwv-menu-btn').click()`);
    await wait("getComputedStyle(document.querySelector('.dshwv-menu')).opacity==='1'", 'menu transition complete before snapshot scenario');
    await ev(`${api}.queue([
      {kind:'custom',modules:[{type:'balance',tpl:'余额 {balance_api}'},{type:'random',lines:[{t:'第一泡稳定语',w:1}]}]},
      {kind:'custom',modules:[{type:'balance',tpl:'余额 {balance_api}'},{type:'random',lines:[{t:'第二泡稳定语',w:1}]}]}
    ]);${api}.open()`); await stable(); await delay(350);
    const baseline = await ev(`${api}.status().balance`), rounded = (baseline * 7).toFixed(2);
    assert.ok((await text()).includes(rounded)); await hold(); const randomBefore = await ev('window.__auditDraws'), oldText = await text();
    await ev(`window.__auditFx.rate=8;WhaleMoney.refreshQuote({apply:false,reason:'timer'})`);
    assert.equal(await text(), oldText); assert.equal(await sameNodes(), true); assert.equal(await ev('window.__auditDraws'), randomBefore);
    assert.equal(await ev('WhaleMoney.state().quote.usdCny'), 7); assert.equal(await ev('WhaleMoney.state().hasPendingQuote'), true);
    await ev(`${api}.next()`); await stable();
    assert.ok((await text()).includes((baseline * 8).toFixed(2))); assert.match(await text(), /第二泡稳定语/);
    assert.equal(await ev('WhaleMoney.state().quote.usdCny'), 8);
    checks.push('a real background FX candidate preserves the current DOM and random sentence; advancing the bubble applies the candidate');

    await hold(); const randomAtManual = await ev('window.__auditDraws');
    const point = await hitPoint(); move(point.x, point.y); await delay(100);
    if (!(await ev("document.querySelector('.dshwv-menu').checkVisibility({opacityProperty:true})"))) await ev("document.querySelector('.dshwv-menu-btn').click()");
    await wait("document.querySelector('#dshw-fx-refresh')?.checkVisibility({opacityProperty:true})&&!document.querySelector('#dshw-fx-refresh').disabled", 'manual FX button ready');
    await ev('window.__auditFx.rate=9'); await clickVisible('#dshw-fx-refresh');
    await wait("WhaleMoney.state().quote.usdCny===9&&!WhaleMoney.state().refreshing", 'manual quote applied');
    assert.equal(await ev(`${api}.status().shown`), true);
    assert.ok((await text()).includes((baseline * 9).toFixed(2))); assert.match(await text(), /第二泡稳定语/);
    assert.equal(await sameNodes(), true); assert.equal(await ev('window.__auditDraws'), randomAtManual);
    assert.match(await ev('window.__auditFx.requests.at(-1)'), /refresh=1.*reason=manual/);
    assert.equal(await ev("document.querySelector('#dshw-fx-refresh').disabled"), true);
    assert.match(await ev("document.querySelector('#toast').textContent"), /金额显示已同步/);
    details.menu = await ev("(() => {const menu=document.querySelector('.dshwv-menu'),button=document.querySelector('#dshw-fx-refresh');return {rect:menu.getBoundingClientRect().toJSON(),viewport:{width:innerWidth,height:innerHeight},scrollHeight:menu.scrollHeight,clientHeight:menu.clientHeight,scrollTop:menu.scrollTop,overflowY:getComputedStyle(menu).overflowY,buttonRect:button.getBoundingClientRect().toJSON(),caption:document.querySelector('#dshw-currency-note').textContent};})()");
    assert.ok(details.menu.rect.top >= -1 && details.menu.rect.left >= -1 && details.menu.rect.bottom <= details.menu.viewport.height + 1 && details.menu.rect.right <= details.menu.viewport.width + 1, 'expanded menu stays inside the viewport');
    if (details.menu.scrollHeight > details.menu.clientHeight) assert.match(details.menu.overflowY, /auto|scroll/);
    await capture('audit-manual-fx');
    checks.push(...(await verifyFxPopover({ window, ev, wait, clickAt, output })).checks);
    checks.push('the actual manual FX button updates captured amount text without replacing bubble nodes or redrawing the random sentence, then enters cooldown');

    await close(); await ev('Math.random=window.__auditOriginalRandom;WhaleMoney.setDisplayCurrency("USD")');
    const today = new Date().toLocaleDateString('en-CA'), oldDay = '2026-01-01';
    service.usageRecords = () => ({ ok: true, currency: 'USD', settings: initialSettings, today: { total: 2, models: [], since: Date.now() },
      days7: [{ date: today, total: 2, models: [] }], total7: 2,
      all: { total: 2, totalComplete: false, missingSummaryDays: [oldDay], days: [{ date: today, total: 2, models: [] }, { date: oldDay, total: null, models: [{ model: 'overlap-estimate', cost: 777 }] }],
        events: [{ id: 'audit-old-root', day: oldDay, model: 'overlap-root', cost: 100, source: 'shared-key-interval', ts: 1767225600000 },
          { id: 'audit-old-child', day: oldDay, model: 'overlap-child', cost: 100, source: 'subagent-pricing-estimate', ts: 1767225600000 }] } });
    await ev(`${api}.openHistory()`);
    await wait("document.querySelector('.dshwv-usage-oview-num')?.textContent.includes('2.00')", 'unknown history fixture rendered');
    assert.match(await ev("document.querySelector('.dshwv-usage-oview').textContent"), /已知小计/);
    assert.equal(await ev("document.querySelector('.dshwv-usage-oview-num').textContent"), '$2.00');
    await ev("[...document.querySelectorAll('.dshwv-usage-collapse')].find(el=>el.textContent.includes('每日与逐条明细')).click()");
    await wait(`!!document.querySelector('[data-usage-day="${oldDay}"]')`, 'unknown day row');
    const unknownRow = await ev(`document.querySelector('[data-usage-day="${oldDay}"]').textContent`);
    assert.match(unknownRow, /未知/); assert.doesNotMatch(unknownRow, /\$0\.00|\$200\.00|\$777\.00/);
    details.unknownHistory = { overview: await ev("document.querySelector('.dshwv-usage-oview').textContent"), row: unknownRow };
    await capture('audit-history-unknown');
    checks.push('unknown historical daily totals stay unknown and are not replaced with zero, model estimates, or overlapping event sums');
    await ev("document.querySelector('.dshwv-usage-close').click()"); service.usageRecords = originalRecords;

    await ev(`window.__auditOriginalReadData=FileReader.prototype.readAsDataURL;window.__auditPreviewReads=0;window.__auditOversizeReads=0;
      FileReader.prototype.readAsDataURL=function(){window.__auditPreviewReads++;return window.__auditOriginalReadData.apply(this,arguments);};true;`);
    for (const kind of ['role', 'bubble']) {
      const result = await ev(`(async()=>{const file=new File([new Uint8Array([137,80,78,71,13,10,26,10])],'broken.png',{type:'image/png'});
        if(${JSON.stringify(kind)}==='role')await ${api}.importRole({files:[file],value:'broken'});else await ${api}.importBubble(file);
        return {toast:document.querySelector('#toast').textContent,shown:!document.querySelector('#toast').hidden,previews:window.__auditPreviewReads,uploads:window.__auditMediaRequests.length};})()`);
      assert.equal(result.shown, true); assert.match(result.toast, /PNG|图片|损坏/); assert.equal(result.previews, 0); assert.equal(result.uploads, 0);
      const oversized = await ev(`(async()=>{const policy=WhaleMediaGuard.getPolicy();const file={name:'too-big.png',type:'image/png',size:policy[${JSON.stringify(kind === 'role' ? 'roleBytes' : 'bubbleBytes')}]+1,arrayBuffer:async()=>{window.__auditOversizeReads++;return new ArrayBuffer(1);}};
        if(${JSON.stringify(kind)}==='role')await ${api}.importRole({files:[file],value:'large'});else await ${api}.importBubble(file);
        return {toast:document.querySelector('#toast').textContent,shown:!document.querySelector('#toast').hidden,reads:window.__auditOversizeReads,previews:window.__auditPreviewReads,uploads:window.__auditMediaRequests.length};})()`);
      assert.equal(oversized.shown, true); assert.match(oversized.toast, /最多|超出|过大/); assert.equal(oversized.reads, 0); assert.equal(oversized.previews, 0); assert.equal(oversized.uploads, 0);
    }
    await capture('audit-invalid-media');
    checks.push('bad PNG and oversized role/bubble files show real toast feedback before preview decoding, oversized buffer reads, or upload requests');

    await ev(`window.__auditRejectMedia=true;window.__auditGoodFilePromise=new Promise(resolve=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=8;canvas.getContext('2d').fillRect(0,0,8,8);canvas.toBlob(blob=>resolve(new File([blob],'audit-image.png',{type:'image/png'})),'image/png');});true;`);
    await ev(`window.__auditGoodFilePromise.then(file=>${api}.importBubble(file))`);
    assert.match(await ev("document.querySelector('#toast').textContent"), /空间不足/);
    assert.equal(await ev('window.__auditMediaRequests.length'), 1);
    await ev(`window.__auditGoodFilePromise.then(file=>${api}.importRole({files:[file],value:'valid'}))`);
    await wait("[...document.querySelectorAll('.dshwv-cropmask')].some(el=>el.checkVisibility({opacityProperty:true}))", 'valid role crop opens');
    await delay(180);
    await ev("[...document.querySelectorAll('.dshwv-cropmask')].find(el=>el.checkVisibility({opacityProperty:true})).querySelector('.dshwv-cropbtn-ok').click()");
    await wait('window.__auditMediaRequests.length===2', 'role save attempted');
    await wait("!document.querySelector('#toast').hidden&&document.querySelector('#toast').textContent.includes('空间不足')", 'role save failure toast');
    assert.equal(await ev("[...document.querySelectorAll('.dshwv-cropmask')].some(el=>el.checkVisibility({opacityProperty:true}))"), true);
    await capture('audit-write-failed');
    checks.push('simulated storage-full replies display a visible save error and preserve the role crop editor instead of pretending success');
    await ev("[...document.querySelectorAll('.dshwv-cropmask')].find(el=>el.checkVisibility({opacityProperty:true})).querySelector('.dshwv-cropbtn-no').click()");
    details.media = await ev('({previewReads:window.__auditPreviewReads,oversizeReads:window.__auditOversizeReads,requests:window.__auditMediaRequests})');
    await ev("document.querySelector('#toast').hidden=true");
    window.setContentSize(480, 380);
    await wait('innerWidth===480&&innerHeight===380', 'small fixture viewport');
    await ev(`${api}.place(40,40,false);if(!document.querySelector('.dshwv-menu').checkVisibility({opacityProperty:true}))document.querySelector('.dshwv-menu-btn').click()`);
    await delay(300);
    await ev("(() => {const menu=document.querySelector('.dshwv-menu');menu.scrollTop=0;window.__auditLastMenuControl=[...menu.querySelectorAll('button,input,select')].filter(el=>el.checkVisibility({opacityProperty:true})).at(-1);if(!window.__auditLastMenuControl)throw new Error('missing final menu control');window.__auditLastMenuControl.scrollIntoView({block:'end'});})()");
    await delay(100);
    details.smallMenu = await ev("(() => {const menu=document.querySelector('.dshwv-menu'),el=window.__auditLastMenuControl,r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{rect:menu.getBoundingClientRect().toJSON(),viewport:{width:innerWidth,height:innerHeight},scrollHeight:menu.scrollHeight,clientHeight:menu.clientHeight,scrollTop:menu.scrollTop,overflowY:getComputedStyle(menu).overflowY,lastControl:{text:el.textContent||el.title||el.type,rect:r.toJSON(),hit:hit===el||el.contains(hit)}};})()");
    assert.ok(details.smallMenu.scrollHeight > details.smallMenu.clientHeight && details.smallMenu.scrollTop > 0, 'small menu really scrolls');
    assert.ok(details.smallMenu.rect.top >= -1 && details.smallMenu.rect.bottom <= 381, 'small menu stays inside the viewport');
    assert.ok(details.smallMenu.lastControl.rect.top >= 0 && details.smallMenu.lastControl.rect.bottom <= 380, 'last menu control can be scrolled into view');
    assert.equal(details.smallMenu.lastControl.hit, true, 'last control has an unobstructed browser hit target');
    await capture('audit-small-menu-bottom');
    checks.push('at a 480×380 viewport the expanded menu stays bounded and its last control is reachable by scrolling');
    window.setBounds(originalBounds);
    fs.writeFileSync(path.join(output, 'ui-audit-regression.json'), JSON.stringify({ ok: true, checks, details, dataDir }, null, 2));
    return { checks };
  } catch (error) {
    await capture('audit-ui-failure').catch(() => {});
    fs.writeFileSync(path.join(output, 'ui-audit-regression.json'), JSON.stringify({ ok: false, checks, error: error.stack, details,
      state: await ev(`${api}?.status()`).catch(() => null), money: await ev('WhaleMoney.state()').catch(() => null),
      text: await text().catch(() => ''), dataDir }, null, 2));
    throw error;
  } finally {
    window.setBounds(originalBounds);
    service.lastTurn = originalLastTurn; service.usageRecords = originalRecords;
    await ev(`(() => {if(window.__auditOriginalFetch)window.fetch=window.__auditOriginalFetch;if(window.__auditOriginalRandom)Math.random=window.__auditOriginalRandom;
      if(window.__auditOriginalReadData)FileReader.prototype.readAsDataURL=window.__auditOriginalReadData;
      const vol=[...document.querySelectorAll('input[type=range]')].find(el=>el.max==='1');if(vol){vol.value='0';vol.dispatchEvent(new Event('input',{bubbles:true}));}
      if(window.__auditOriginalPlay)HTMLMediaElement.prototype.play=window.__auditOriginalPlay;
      if(window.__auditBufferStart)AudioBufferSourceNode.prototype.start=window.__auditBufferStart;
      ${api}.close();if(document.querySelector('.dshwv-menu').checkVisibility({opacityProperty:true}))document.querySelector('.dshwv-menu-btn').click();
      document.querySelector('#toast').hidden=true;
    })()` ).catch(() => {});
    await delay(150); service.writeUsageSettings(initialSettings); fs.writeFileSync(sizeFile, initialSize);
    await ev(`WhaleMoney.refreshQuote({apply:true}).then(()=>WhaleMoney.setDisplayCurrency('USD'))`).catch(() => {});
    await ev(`${api}.usage();${api}.refresh(true)`).catch(() => {});
    await wait(`!${api}.status().busy`, 'audit cleanup refresh').catch(() => {});
  }
}
