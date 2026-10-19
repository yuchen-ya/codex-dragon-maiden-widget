import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';import {once} from 'node:events';import assert from 'node:assert/strict';
import {ROOT,DATA_HOME} from '../runtime/paths.mjs';
const output=path.resolve(process.argv[2]);fs.mkdirSync(output,{recursive:true});const data=fs.mkdtempSync(path.join(output,'fixture-'));
const env={...process.env,WHALE_DESKTOP_TEST:'1',WHALE_VISIBILITY_STRESS:'1',WHALE_COMPOSITION_IDLE_TEST:'1',WHALE_DESKTOP_VERIFY_DIR:output};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(path.join(DATA_HOME,'desktop-runtime/node_modules/electron/dist/electron.exe'),[path.join(ROOT,'desktop/main.cjs'),'--whale-data='+data],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
let errors='';child.stdout.resume();child.stderr.on('data',d=>errors+=d);const timer=setTimeout(()=>child.kill(),90000);
const [code]=await once(child,'close');clearTimeout(timer);const result=JSON.parse(fs.readFileSync(path.join(output,'visibility-stress.json')));assert.equal(result.ok,true,result.error||errors);assert.equal(code,0);console.log(JSON.stringify({ok:true,checks:result.checks,samples:result.composition.length,minMatch:Math.min(...result.composition.map(s=>s.ratio))}));
