import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {bridgeRequest} from '../runtime/bridge.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.resolve(process.argv[2]||path.join(root,'..','qa','mode-feedback'));
fs.mkdirSync(output,{recursive:true});
const data=fs.mkdtempSync(path.join(output,'data-')),codex=path.join(data,'codex');fs.mkdirSync(codex);
const electron=path.join(process.env.USERPROFILE,'.codex','dragon-maiden-widget','desktop-runtime','node_modules','electron','dist','electron.exe');
fs.writeFileSync(path.join(codex,'config.toml'),'model_provider="fixture"\n[model_providers.fixture]\nbase_url="https://example.invalid/v1"\nenv_key="WHALE_FIXTURE_KEY"\n');
fs.writeFileSync(path.join(data,'api-settings.json'),JSON.stringify({monitorSessions:false}));
fs.writeFileSync(path.join(data,'follow-config.json'),JSON.stringify({enabled:true,mode:'follow-codex',pluginRoot:root,electronPath:electron}));
const env={...process.env,CODEX_HOME:codex,WHALE_HOME:data,WHALE_FIXTURE_KEY:'fixture-only',OPENAI_API_KEY:'',OPENAI_BASE_URL:''};
for(const k of ['WHALE_DESKTOP_TEST','WHALE_DESKTOP_AUDIT','WHALE_HOST_ONLY','WHALE_NATIVE_FOLLOW_ONLY','ELECTRON_RUN_AS_NODE'])delete env[k];
const shell=path.join(process.env.WINDIR,'System32','WindowsPowerShell','v1.0','powershell.exe');
const supervisor=path.join(root,'desktop','supervisor.ps1');
const child=spawn(shell,['-NoProfile','-ExecutionPolicy','Bypass','-File',supervisor,'-DataDir',data],{env,windowsHide:true,stdio:['ignore','ignore','pipe']});
let errors='';child.stderr.on('data',d=>errors=(errors+d).slice(-1500));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const status=()=>bridgeRequest('/api/status',{dataDir:data,timeoutMs:1000});
async function wait(fn,limit=15000){const end=Date.now()+limit;while(Date.now()<end){try{const r=await fn();if(r)return r;}catch{}await delay(100);}throw Error('Timed out waiting for real supervisor mode acknowledgement '+errors);}
const transitions=[];
try{
 await wait(async()=>{const s=await status();return s.rendererReady&&s.visible&&s.windowShape?.some(r=>r.width>2&&r.height>2)&&s;});
 for(let i=0;i<8;i++)for(const mode of ['standalone','follow-codex']){
  const start=Date.now();await bridgeRequest('/api/desktop-mode',{dataDir:data,method:'POST',body:{mode}});
  const s=await wait(async()=>{const s=await status();return s.desktopMode===mode&&!s.modePending&&s.visible&&!s.visibility?.pending&&s;},8000);
  assert.equal(s.nativeFollowing,mode==='follow-codex');
  assert.equal(s.windowShapeError,null);
  assert.ok(s.windowShape.some(r=>r.width>2&&r.height>2),'real UI region remains present');
  const before=s.visibility.remaps;
  await bridgeRequest('/api/desktop-mode',{dataDir:data,method:'POST',body:{mode}});await delay(220);
  const repeated=await status();assert.equal(repeated.visible,true);assert.equal(repeated.visibility.remaps,before,'same-mode click cannot remap');
  transitions.push({mode,elapsedMs:Date.now()-start,remaps:before,bounds:s.windowBounds});
 }
 const baseline=(await status()).visibility.remaps;
 for(let i=0;i<250;i++){await delay(120);const s=await status();assert.equal(s.visible,true);assert.equal(s.visibility.remaps,baseline,'idle heartbeat cannot remap');}
 fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({ok:true,transitions,idleStable:true},null,2));
 console.log(JSON.stringify({ok:true,switches:transitions.length,idleStable:true,maxSwitchMs:Math.max(...transitions.map(t=>t.elapsedMs))}));
}catch(e){fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({ok:false,error:e.message,transitions},null,2));throw e;}
finally{
 await promisify(execFile)(shell,['-NoProfile','-ExecutionPolicy','Bypass','-File',supervisor,'-DataDir',data,'-Stop'],{env,windowsHide:true}).catch(()=>{});
 for(let i=0;i<40&&child.exitCode===null;i++)await delay(200);
 if(child.exitCode===null)child.kill();
}
