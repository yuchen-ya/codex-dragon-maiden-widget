import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const api = 'window.__whaleRenderTest';
const front = `document.querySelector('.dshwv-frame[data-buffer="'+${api}.status().front+'"]')`;
export async function verifyCurrency({ window, ev, wait, clickAt, hitPoint, move, dispatcher, output }) {
  const checks = [], details = {};
  const stable = () => wait(`!${api}.status().switching`, 'currency bubble commit');
  const text = () => ev(`${front}.textContent`);
  const capture = name => window.webContents.capturePage().then(image => fs.writeFileSync(path.join(output, name + '.png'), image.toPNG()));
  const settings = () => ev("fetch('/dsh-whale/usage-settings.json').then(r=>r.json()).then(d=>d.settings)");
  const saveSettings = value => ev(`fetch('/dsh-whale/usage-settings.json',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify(value)})}).then(r=>r.json())`);
  const refresh = async () => { await ev(`${api}.refresh(true)`); await wait(`!${api}.status().busy`, 'currency background refresh'); };
  const select = async currency => {
    await ev(`(() => {const select=document.querySelector('#dshw-display-currency'); select.value=${JSON.stringify(currency)};select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await wait(`WhaleMoney.state().displayCurrency===${JSON.stringify(currency)}`, 'display currency ' + currency);
  };
  const clickSelector = async selector => clickAt(await ev(`(() => {const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.checkVisibility({opacityProperty:true}));if(!e)throw new Error('missing visible '+${JSON.stringify(selector)});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`));
  const buttonByText = async value => clickAt(await ev(`(() => {const e=[...document.querySelectorAll('.dshwv-menu button')].find(e=>e.textContent.trim()===${JSON.stringify(value)}&&e.checkVisibility({opacityProperty:true}));if(!e)throw new Error('missing button '+${JSON.stringify(value)});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`));
  const summaries = () => ev("Object.fromEntries([...document.querySelectorAll('[data-money-role]')].map(e=>[e.dataset.moneyRole,e.textContent]))");
  const initialSettings = await settings();
  const original = { amount: dispatcher.whale.provider.amount, currency: dispatcher.whale.provider.currency };
  const below = 5.123456789, budget = 20.13579;
  try {
    await ev(`${api}.close(); ${api}.place(120,80,false)`); await delay(450);
    await select('USD');
    await saveSettings({ ...initialSettings, alert: { ...initialSettings.alert, on: true, below, autoClose: false }, budget: { ...initialSettings.budget, on: true, amount: budget, autoClose: false } });
    dispatcher.whale.provider.amount = 12.3456; dispatcher.whale.provider.currency = 'USD';
    await refresh();
    window.focus(); await wait('document.hasFocus()', 'currency fixture focus');
    const point = await hitPoint(); move(point.x, point.y);
    await wait("document.querySelector('.dshwv-menu-btn').checkVisibility({opacityProperty:true})", 'currency menu hover affordance');
    if (!(await ev("document.querySelector('.dshwv-menu').checkVisibility({opacityProperty:true})"))) await clickSelector('.dshwv-menu-btn');
    await buttonByText('- = 小鲸鱼记账 = -');
    await wait("document.querySelector('[data-money-role=alert]')?.textContent.includes('$5.12')", 'usage settings loaded');
    const appearance = await ev("(() => {const img=document.querySelector('.dshwv-img'),root=document.querySelector('.dshwv-root');return{src:img.currentSrc,width:root.offsetWidth,height:root.offsetHeight,transition:getComputedStyle(root).transitionDuration}})()");
    await ev(`${api}.scene([{type:'text',text:'当前 API 余额'},{type:'balance',tpl:'余额 {balance_api}'},{type:'today'}],0)`); await stable(); await delay(450);
    await ev(`window.__currencyFrame=${front};window.__currencyNodes=[...window.__currencyFrame.childNodes]`);
    const usd = await text(); assert.match(usd, /余额 \$ 12\.35/);
    assert.deepEqual(await summaries(), { alert: '余额 ≤ $5.12 时提醒', budget: '已用 ≥ $20.14 时提醒' });
    await capture('currency-usd');
    await select('CNY');
    assert.match(await text(), /余额 ¥ 82\.86/);
    assert.deepEqual(await summaries(), { alert: '余额 ≤ ¥34.39 时提醒', budget: '已用 ≥ ¥135.14 时提醒' });
    assert.equal(await ev(`window.__currencyFrame===${front}&&window.__currencyNodes.every((node,i)=>node===window.__currencyFrame.childNodes[i])`), true);
    await capture('currency-cny');
    checks.push('real currency selector updates balance, warning and budget together without rebuilding the visible bubble');
    const cny = await text();
    dispatcher.whale.provider.amount = 11.2345; await refresh();
    assert.equal(await text(), cny); assert.equal(await ev('WhaleMoney.state().displayCurrency'), 'CNY');
    await select('USD'); assert.equal(await text(), usd);
    checks.push('background refresh keeps the display preference and captured bubble values; currency changes do not expose newer background amounts');

    await ev(`window.__currencyNativeRandom=Math.random;window.__currencyRandomCalls=0;Math.random=()=>{window.__currencyRandomCalls++;return .8;};${api}.scene([{type:'random',lines:[{t:'静静陪你',w:1},{t:'今天也慢慢来',w:3}]}],0)`); await stable();
    const random = await text(), draws = await ev('window.__currencyRandomCalls');
    await select('CNY'); await select('USD'); await refresh();
    assert.equal(await text(), random); assert.equal(await ev('window.__currencyRandomCalls'), draws);
    await ev(`Math.random=window.__currencyNativeRandom;${api}.close();${api}.queue([{kind:'normal'}]);${api}.open()`); await stable();
    await ev(`${api}.scene([{type:'text',text:'缓冲区复用后仍稳定'}],0)`); await stable();
    await select('CNY'); assert.equal(await text(), '缓冲区复用后仍稳定');
    checks.push('switching currencies never rerolls random text and reused buffer nodes have no stale money bindings');

    await clickSelector('[data-money-role=alert] + button');
    await wait("document.querySelector('[data-money-input=alert]')?.isConnected", 'warning editor');
    assert.equal(await ev("document.querySelector('[data-money-input=alert]').value"), '34.39');
    for (let i = 0; i < 20; i++) await ev(`WhaleMoney.setDisplayCurrency(${JSON.stringify(i % 2 ? 'CNY' : 'USD')})`);
    await capture('currency-warning-editor');
    await clickSelector('.dshwv-bubmask .dshwv-bubbtn-ok');
    await wait("!document.querySelector('[data-money-input=alert]')", 'warning editor saved');
    assert.equal((await settings()).alert.below, below);
    checks.push('saving an unedited warning after repeated currency changes preserves every native decimal');

    await clickSelector('[data-money-role=budget] + button');
    await wait("!!document.querySelector('[data-money-input=budget]')", 'budget editor');
    await ev("(() => {const input=document.querySelector('[data-money-input=budget]');input.value='350';input.dispatchEvent(new Event('input',{bubbles:true}));})()");
    await select('USD'); await select('CNY');
    assert.equal(await ev("document.querySelector('[data-money-input=budget]').value"), '350.00');
    assert.match(await ev("window.__dshwRemindMask.innerText"), /¥350\.00/);
    await capture('currency-budget-editor');
    await clickSelector('.dshwv-bubmask .dshwv-bubbtn-ok');
    await wait("!document.querySelector('[data-money-input=budget]')", 'budget editor saved');
    assert.ok(Math.abs((await settings()).budget.amount - 350 / 6.7115) < 1e-10);
    checks.push('editing a CNY budget converts back to its native currency exactly once and preview uses the same amount');

    await ev(`${api}.close()`); dispatcher.whale.provider.amount = 4; await refresh();
    await wait(`${api}.status().scene==='alert'&&!${api}.status().switching`, 'real balance alert');
    assert.match(await text(), /¥34\.39/);
    await select('USD'); assert.match(await text(), /\$5\.12/);
    checks.push('triggered warning templates retain native snapshots and immediately follow display currency');

    await ev(`${api}.close()`); dispatcher.whale.provider.currency = 'CNY'; dispatcher.whale.provider.amount = 671.15; await refresh();
    assert.equal(await ev('WhaleMoney.state().displayCurrency'), 'USD');
    await ev(`${api}.scene([{type:'balance'}],0)`); await stable();
    assert.equal(await text(), '$ 100.00');
    assert.equal((await summaries()).alert, '余额 ≤ $0.76 时提醒');
    await select('CNY'); assert.equal(await text(), '¥ 671.15');
    assert.equal((await summaries()).alert, '余额 ≤ ¥5.12 时提醒');
    checks.push('a CNY API uses the inverse quote for USD display and refresh does not reset the selected currency');
    const afterAppearance = await ev("(() => {const img=document.querySelector('.dshwv-img'),root=document.querySelector('.dshwv-root');return{src:img.currentSrc,width:root.offsetWidth,height:root.offsetHeight,transition:getComputedStyle(root).transitionDuration}})()");
    assert.deepEqual(afterAppearance, appearance);
    details.appearance = appearance; details.currency = await ev('WhaleMoney.state()'); details.nativeWarning = (await settings()).alert.below;
    checks.push('currency changes leave the character asset, dimensions and 300 ms flip transition unchanged');
    fs.writeFileSync(path.join(output, 'currency-regression.json'), JSON.stringify({ ok: true, checks, details }, null, 2));
    return { checks };
  } catch (error) {
    await capture('currency-failure').catch(() => {});
    fs.writeFileSync(path.join(output, 'currency-regression.json'), JSON.stringify({ ok: false, checks, details, error: error.stack, state: await ev('WhaleMoney.state()'), summaries: await summaries(), text: await text() }, null, 2));
    throw error;
  } finally {
    await ev("if(window.__currencyNativeRandom)Math.random=window.__currencyNativeRandom").catch(() => {});
    dispatcher.whale.provider.amount = original.amount; dispatcher.whale.provider.currency = original.currency;
    await saveSettings(initialSettings);
    await ev(`${api}.close();${api}.usage();WhaleMoney.setDisplayCurrency('USD')`);
    if (await ev("document.querySelector('.dshwv-menu').checkVisibility({opacityProperty:true})")) await ev("document.querySelector('.dshwv-menu-btn').click()");
    await refresh();
  }
}
