// An independent Chromium host with DEFAULT background throttling. Never opens
// or types into the user's Codex window, profiles or conversation.
const { app, BrowserWindow, ipcMain, screen, protocol } = require('electron');
const path = require('node:path');
const readline = require('node:readline');
const net = require('node:net');
const crypto = require('node:crypto');
const directory = process.argv.find(value => value.startsWith('--fixture-dir='))?.slice(14);
if (!directory || !path.isAbsolute(directory)) app.exit(1);
app.setPath('userData', path.join(directory, 'occlusion-host-profile'));
protocol.registerSchemesAsPrivileged([{ scheme: 'whale-fixture', privileges: { standard: true, secure: true } }]);
// Exercise Chromium's native occlusion path explicitly in this isolated host.
app.commandLine.appendSwitch('enable-features', 'CalculateNativeWinOcclusion');
let window, metrics = { frames: 0, gaps: [], input: '', hidden: false };
const controlPipe = '\\\\.\\pipe\\whale-occlusion-' + process.pid + '-' + crypto.randomBytes(12).toString('hex');
const reply = value => process.stdout.write(JSON.stringify(value) + '\n');
const control = net.createServer(socket => {
  const send = value => socket.write(JSON.stringify(value) + '\n');
  readline.createInterface({ input: socket }).on('line', async line => {
    try {
      const request = JSON.parse(line);
      if (request.command === 'snapshot') send({ id: request.id, ...metrics, focused: window.isFocused(), visible: window.isVisible() });
      if (request.command === 'bounds') send({ id: request.id, bounds: screen.dipToScreenRect(null, window.getContentBounds()) });
      if (request.command === 'focus') { window.focus(); send({ id: request.id, ok: true }); }
      if (request.command === 'type') {
        window.webContents.debugger.attach('1.3');
        let observed;
        try {
          await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
          await window.webContents.debugger.sendCommand('Input.insertText', { text: 'fixture-input-ok' });
          observed = await window.webContents.executeJavaScript("({value:document.querySelector('#editor').value,active:document.activeElement?.id})");
        } finally {
          await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: false });
          window.webContents.debugger.detach();
        }
        send({ id: request.id, ok: true, observed });
      }
      if (request.command === 'close') socket.end(JSON.stringify({ id: request.id, ok: true }) + '\n', () => app.quit());
    } catch (error) { send({ error: error.message }); }
  });
  socket.on('error', () => {});
});
const listening = new Promise((resolve, reject) => { control.once('error', reject); control.listen(controlPipe, resolve); });
ipcMain.on('fixture-paint', (_event, value) => { metrics = { ...value, reportedAt: Date.now() }; });
app.whenReady().then(async () => {
  const area = screen.getPrimaryDisplay().workArea;
  window = new BrowserWindow({ x: area.x + 30, y: area.y + 30, width: Math.min(1060, area.width - 60), height: Math.min(760, area.height - 60), frame: false, show: false, title: '挂件渲染回归测试（自动关闭）', backgroundColor: '#e7f0f5', webPreferences: { nodeIntegration: true, contextIsolation: false } });
  window.webContents.on('render-process-gone', (_event, details) => process.stderr.write(JSON.stringify({ renderer: details }) + '\n'));
  window.webContents.on('did-fail-load', (_event, code, description) => process.stderr.write(JSON.stringify({ loadFailed: code, description }) + '\n'));
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const html = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'"><style>body{font:20px Segoe UI;padding:24px;background:#e7f0f5;color:#234}input{width:500px;padding:12px}#bar{width:120px;height:12px;background:#357;margin:30px}</style><p>正在自动验证挂件下方的界面持续刷新</p><p id="counter"></p><input id="editor" autofocus><div id="bar"></div><script>
    const {ipcRenderer}=require('electron'); const gaps=[]; let frames=0,last=performance.now(),lastPointer=null;
    document.addEventListener('pointerdown',event=>{lastPointer={x:event.clientX,y:event.clientY,target:event.target.id};});
    document.querySelector('#editor').focus();
    function frame(now){
      gaps.push(now-last);if(gaps.length>180)gaps.shift();last=now;frames++;
      document.querySelector('#counter').textContent='渲染帧数 '+frames;
      document.querySelector('#bar').style.transform='translateX('+(frames%300)+'px)';
      if(frames%4===0)ipcRenderer.send('fixture-paint',{frames,gaps:[...gaps],input:document.querySelector('#editor').value,inputRect:document.querySelector('#editor').getBoundingClientRect().toJSON(),active:document.activeElement?.id,lastPointer,hidden:document.hidden});
      requestAnimationFrame(frame);
    }requestAnimationFrame(frame);
  </script>`;
  protocol.handle('whale-fixture', () => new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
  await window.loadURL('whale-fixture://host/');
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.show(); window.setAlwaysOnTop(true); window.moveTop(); window.focus();
  await listening;
  reply({ ready: true, pid: process.pid, controlPipe, handle: window.getNativeWindowHandle().readBigUInt64LE().toString(), bounds: screen.dipToScreenRect(null, window.getContentBounds()), defaultBackgroundThrottling: window.webContents.getLastWebPreferences().backgroundThrottling !== false, occlusionSwitches: { enabled: app.commandLine.getSwitchValue('enable-features'), disabled: app.commandLine.getSwitchValue('disable-features'), disableBackgrounding: app.commandLine.hasSwitch('disable-backgrounding-occluded-windows') } });
}).catch(error => { reply({ startupError: String(error.message).slice(0, 250) }); app.exit(1); });
app.on('will-quit', () => control.close());
app.on('window-all-closed', () => app.quit());
