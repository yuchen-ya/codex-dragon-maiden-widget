import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const {acceptsWindowMessage}=createRequire(import.meta.url)('../desktop/ipc-window.cjs');
test('late renderer messages never access a destroyed window or renderer',()=>{
 const gone={isDestroyed:()=>true,get webContents(){throw Error('Object has been destroyed');}};
 assert.equal(acceptsWindowMessage(gone,{sender:{}}),false);
 assert.equal(acceptsWindowMessage(null,{sender:{}}),false);
 const contents={isDestroyed:()=>false},live={isDestroyed:()=>false,webContents:contents};
 assert.equal(acceptsWindowMessage(live,{sender:contents}),true);
 assert.equal(acceptsWindowMessage(live,{sender:contents},true),false);
 assert.equal(acceptsWindowMessage(live,{sender:{}}),false);
 contents.isDestroyed=()=>true;assert.equal(acceptsWindowMessage(live,{sender:contents}),false);
});
