import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const {createHeartbeatMonitor}=createRequire(import.meta.url)('../desktop/heartbeat.cjs');
test('a busy supervisor is reported once as delayed and recovers without visibility commands',()=>{
 let time=0,seen=0;const events=[];
 const health=createHeartbeatMonitor({now:()=>time,lastSeen:()=>seen,onDelayed:()=>events.push('delayed'),onRecovered:()=>events.push('recovered')});
 assert.equal(health.check(),false);time=7000;assert.equal(health.check(),true);
 for(let i=0;i<20;i++){time+=1000;health.check();}assert.deepEqual(events,['delayed']);
 seen=time;assert.equal(health.check(),false);assert.deepEqual(events,['delayed','recovered']);
 time+=100;health.check();assert.equal(events.length,2);
});
