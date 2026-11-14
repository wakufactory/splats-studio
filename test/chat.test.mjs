import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const script = readFileSync(new URL('../html/chat.js', import.meta.url), 'utf8').replace('export function mountChat', 'function mountChat');
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(fetch) {
  const elements = new Map();
  function element() {
    return {hidden:false, disabled:false, value:'', children:[], listeners:{}, textContent:'',
      append(...items) { this.children.push(...items); }, replaceChildren() { this.children=[]; },
      setAttribute() {}, addEventListener(name, fn) { this.listeners[name]=fn; }, click() {},
    };
  }
  const document = {getElementById(id) {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  }, createElement:element, createTextNode:text => ({textContent:text})};
  document.getElementById('chat-pane').hidden = true;
  let source = 'original', parameters={resolution:32}, previews=0;
  const model={snapshot:() => ({source,mode:'text',parameters:{...parameters}}),
    setSource(value) {source=value;document.getElementById('source').value=value;}, preview:async () => {previews++;return null;}, error:() => null,canApply:() => true};
  const context=vm.createContext({document,fetch,AbortController,URL,setTimeout,clearTimeout,setInterval:() => {},window:{addEventListener() {}},console});
  vm.runInContext(script, context);
  context.mountChat(model);
  return {get:id=>document.getElementById(id),model,source:()=>source,previews:()=>previews,
    edit(value) {source=value;document.getElementById('source').value=value;document.getElementById('source').listeners.input();}};
}
const response = data => ({ok:true,json:async()=>data});
for (const [name, fetch] of [
  ['offline',async()=>{throw Error('offline');}],
  ['static host 404',async()=>({ok:false,json:async()=>{throw Error('HTML');}})],
  ['static host fallback HTML',async()=>({ok:true,json:async()=>{throw Error('HTML');}})],
  ['unrelated JSON',async()=>response({})],
  ['backend unavailable',async()=>response({available:false,ready:false})],
]) test(`chat stays hidden: ${name}`,async()=>{
  const ui=setup(fetch);await tick();assert.equal(ui.get('chat-pane').hidden,true);
});
test('available server shows login even before authentication',async()=>{
  const ui=setup(async()=>response({available:true,ready:false,message:'login'}));await tick();
  assert.equal(ui.get('chat-pane').hidden,false);assert.equal(ui.get('chat-login').hidden,false);
  assert.equal(ui.get('chat-send').disabled,true);
});
test('current source is sent, reply applied and undo restores it',async()=>{
  let sent;
  const ui=setup(async(path,options)=>{
    if(path==='/chat/status')return response({available:true,ready:true});
    if(path==='/chat/send'){sent=JSON.parse(options.body);return response({sessionId:'one'});}
    if(path==='/chat/poll')return response({state:'completed',result:{message:'done',source:'edited'}});
    return response({ok:true});
  });await tick();ui.edit('original');ui.get('chat-input').value='edit';
  await ui.get('chat-send').onclick();
  assert.equal(sent.source,'original');assert.equal(sent.parameters.resolution,32);
  assert.equal(ui.source(),'edited');assert.equal(ui.previews(),1);
  await ui.get('chat-undo').onclick();assert.equal(ui.source(),'original');
});
test('manual edits during response preserve source until proposal is applied',async()=>{
  let finish;
  const ui=setup(async(path)=>{
    if(path==='/chat/status')return response({available:true,ready:true});
    if(path==='/chat/send')return response({sessionId:'one'});
    return new Promise(resolve=>{finish=()=>resolve(response({state:'completed',result:{message:'done',source:'proposal'}}));});
  });await tick();ui.edit('original');ui.get('chat-input').value='edit';
  const pending=ui.get('chat-send').onclick();await tick();ui.edit('manual');finish();await pending;
  assert.equal(ui.source(),'manual');assert.equal(ui.get('chat-proposal').hidden,false);
  await ui.get('chat-apply').onclick();assert.equal(ui.source(),'proposal');
});

test('generation failure retries twice and undo keeps the original source',async()=>{
  let requests=0;
  const ui=setup(async(path,options)=>{
    if(path==='/chat/status')return response({available:true,ready:true});
    if(path==='/chat/send'){
      requests++;
      if(requests>1)assert.equal(JSON.parse(options.body).previewError,'bad DSL');
      return response({sessionId:'one'});
    }
    return response({state:'completed',result:{message:'edit',source:`attempt ${requests}`}});
  });await tick();ui.edit('original');ui.get('chat-input').value='edit';
  ui.model.preview=async()=> 'bad DSL';ui.model.error=()=> 'bad DSL';
  await ui.get('chat-send').onclick();assert.equal(requests,3);assert.equal(ui.source(),'attempt 3');
  ui.model.preview=async()=>null;
  await ui.get('chat-undo').onclick();assert.equal(ui.source(),'original');
});

test('manual edit while failed preview runs prevents automatic repair',async()=>{
  let requests=0,failPreview;
  const ui=setup(async(path)=>{
    if(path==='/chat/status')return response({available:true,ready:true});
    if(path==='/chat/send'){requests++;return response({sessionId:'one'});}
    return response({state:'completed',result:{message:'edit',source:'bad proposal'}});
  });await tick();ui.edit('original');ui.get('chat-input').value='edit';
  ui.model.preview=()=>new Promise(resolve=>{failPreview=()=>resolve('bad DSL');});
  const pending=ui.get('chat-send').onclick();await tick();ui.edit('manual');failPreview();await pending;
  assert.equal(requests,1);assert.equal(ui.source(),'manual');
});


test('chat remains visible when later connection checks fail or report unavailable',async()=>{
  let state={available:true,ready:true,message:'connected'};
  const ui=setup(async()=>{
    if(state instanceof Error)throw state;
    return response(state);
  });await tick();
  assert.equal(ui.get('chat-pane').hidden,false);
  state={available:false,ready:false,message:'unavailable'};
  ui.get('chat-connect').onclick();await tick();
  assert.equal(ui.get('chat-pane').hidden,false);
  assert.equal(ui.get('chat-send').disabled,true);
  assert.equal(ui.get('chat-status').textContent,'unavailable');
  state=Error('offline');
  ui.get('chat-connect').onclick();await tick();
  assert.equal(ui.get('chat-pane').hidden,false);
  assert.equal(ui.get('chat-status').textContent,'offline');
  state={available:true,ready:true,message:'reconnected'};
  ui.get('chat-connect').onclick();await tick();
  assert.equal(ui.get('chat-pane').hidden,false);
  assert.equal(ui.get('chat-send').disabled,false);
});

test('chat remains hidden if initial connection fails and a later check succeeds',async()=>{
  let connected=false;
  const ui=setup(async()=>{
    if(!connected)throw Error('offline');
    return response({available:true,ready:true});
  });await tick();
  assert.equal(ui.get('chat-pane').hidden,true);
  connected=true;
  ui.get('chat-connect').onclick();await tick();
  assert.equal(ui.get('chat-pane').hidden,true);
});
