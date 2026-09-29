'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Service}=require('../dist/nodes/NnaPollStudio/service');
const {ChatGPTBridge}=require('../dist/nodes/NnaPollStudio/chatgpt-bridge');
const c={apiId:1,apiHash:'a'.repeat(32),sessionString:'1AAAA',expectedUserId:'42',expectedUsername:'nna_enthiran',allowedGroupId:'-1001234500000',allowedGroupUsername:'nnasoulsdiscuss',allowedTopicIds:'10'};
const scope={botId:'99',botUsername:'N_N_A_TestBot',operatorIds:['42','43'],groups:[{id:c.allowedGroupId,title:'Group'}],defaultTargets:[{groupId:c.allowedGroupId,topicId:10,title:'Daily'}],chatgptEnabled:true,chatgptOwnerId:'42'};
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'nna-chatgpt-test-'));t.after(()=>{assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});});
 const calls=[],client={connect:async()=>{},destroy:async()=>{},getMe:async()=>({id:42,username:'nna_enthiran',bot:false})};
 const s=new Service({helpers:{httpRequest:async r=>{calls.push(r);throw Error('Unexpected bot call');}}},c,{accessToken:'99:test'},scope,{root,createClient:async()=>client,publish:async(_,credentials,d,target)=>{calls.push({publish:d.settings.type});return {status:'sent',messageId:88,senderId:'42',groupId:target.groupId,topicId:target.topicId,url:'https://t.me/c/1234500000/10/88'};}});
 return {s,b:new ChatGPTBridge(s),calls,client};
}
const args=(kind='poll')=>({kind,question:'இன்றைய தேர்வு?',options:['காலை','மாலை'],settings:kind==='quiz'?{correct:[1]}:{},groupId:c.allowedGroupId,topicId:10});
const prepare=(b,a=args())=>b.run({action:'prepare',arguments:a});
const publish=(b,d,extra={})=>b.run({action:'publish',arguments:{draftId:d.draftId,confirmationHash:d.confirmationHash,confirm:true,...extra}});
test('all three types show defaults and destinations without Telegram messages or changing private drafts',async t=>{
 const {s,b,calls}=fixture(t);s.store.change('draft_42',()=>({active:true,stage:'content',expiresAt:Date.now()+10000}));const prior=s.draft('42');
 const list=await b.run({action:'list',arguments:{}});assert.deepEqual(list.types,['poll','quiz','checklist']);assert.equal(list.defaults.poll.revote,false);assert.equal(list.defaults.checklist.othersComplete,false);
 for(const kind of list.types){const d=await prepare(b,args(kind));assert.equal(d.state,'draft');assert.equal(d.kind,kind);assert.match(d.preview,/@nna_enthiran/);assert.equal(d.destination.topicId,10);assert.equal(d.settings.revote,false);if(kind==='quiz')assert.match(d.preview,/2\. மாலை/);assert.deepEqual(s.draft('42'),prior);}
 assert.equal(calls.length,0);
});
test('strict identity and request validation rejects forged owner targets content and settings',async t=>{
 const {s,b,calls}=fixture(t);assert.throws(()=>new ChatGPTBridge({...s,scope:{...scope,chatgptOwnerId:'43'}}));assert.throws(()=>new ChatGPTBridge({...s,scope:{...scope,chatgptEnabled:false}}));
 for(const a of [{...args(),owner:'43'},{...args(),topicId:11},{...args(),groupId:'-100999'},{...args(),question:'Bad\nA) injected'},{...args(),options:['same','same']},{...args(),settings:{revote:'false'}},{...args(),settings:{hide:true}},{...args('quiz'),settings:{}},{...args('quiz'),settings:{correct:[2]}},{...args('quiz'),settings:{correct:[0,1]}},{...args('checklist'),settings:{anonymous:true}},{...args(),kind:'other'},{...args(),settings:JSON.parse('{"__proto__":{}}')}])await assert.rejects(prepare(b,a));
 await assert.rejects(b.run({action:'publish',arguments:{draftId:'../../x',confirm:true,confirmationHash:'x'}}));assert.equal(calls.length,0);
});
test('all poll settings and checklist permissions survive preview',async t=>{
 const {b}=fixture(t),settings={anonymous:false,multiple:true,revote:true,shuffle:false,adding:false,hide:true,seconds:120,members:true,countries:['IN'],correct:[0,1],explanation:'Both answers',description:'Details'};
 const d=await prepare(b,{...args('quiz'),settings});for(const [k,v]of Object.entries(settings))assert.deepEqual(d.settings[k],v);
 const todo=await prepare(b,{...args('checklist'),options:['Read'],settings:{othersAppend:true,othersComplete:true}});assert.equal(todo.options.length,1);assert.match(todo.preview,/undo செய்யலாம்: ON/);
});
test('publish requires exact preview confirmation and remains idempotent after restart',async t=>{
 const {s,b,calls}=fixture(t),d=await prepare(b);await assert.rejects(publish(b,d,{confirm:false}));await assert.rejects(publish(b,d,{confirmationHash:'a'.repeat(64)}));assert.equal(calls.length,0);
 const r=await publish(b,d);assert.equal(r.state,'sent');assert.equal(r.receipt.url,'https://t.me/c/1234500000/10/88');assert.equal(calls.length,1);
 const restarted=new ChatGPTBridge(new Service(s.ctx,c,s.b,scope,{root:s.store.root}));const repeat=await publish(restarted,d);assert.equal(repeat.alreadyPublished,true);assert.equal(calls.length,1);
 assert.equal((await restarted.run({action:'get',arguments:{draftId:d.draftId}})).state,'sent');
});
test('draft expiry disabled destination tampering and wrong sender fail closed',async t=>{
 const {s,b,client,calls}=fixture(t);let d=await prepare(b);s.store.change('chatgpt_draft_'+d.draftId,x=>({...x,expiresAt:0}));await assert.rejects(publish(b,d),/EXPIRED/);
 d=await prepare(b);s.store.change('chatgpt_draft_'+d.draftId,x=>({...x,sourceText:'tampered'}));await assert.rejects(publish(b,d),/MISSING/);
 d=await prepare(b);s.store.change('topics',()=>({targets:[]}));await assert.rejects(publish(b,d),/DISABLED/);assert.equal(calls.length,0);
 s.store.change('topics',()=>({targets:scope.defaultTargets}));d=await prepare(b);client.getMe=async()=>({id:43,username:'nna_enthiran'});assert.equal((await publish(b,d)).state,'uncertain');assert.equal(calls.length,0);
});
test('uncertain and simultaneous publications never duplicate sends',async t=>{
 const {s,b,calls}=fixture(t);let release;const wait=new Promise(resolve=>release=resolve);s.deps.publish=async()=>{calls.push({publish:true});await wait;throw Error('remote timeout');};const d=await prepare(b),first=publish(b,d);await new Promise(resolve=>setImmediate(resolve));
 const second=await publish(b,d);assert.equal(second.state,'sending');release();assert.equal((await first).state,'uncertain');assert.equal((await publish(b,d)).state,'uncertain');assert.equal(calls.length,1);
});
test('bridge operation is explicit and old Telegram operations remain available',()=>{
 const {NnaPollStudio}=require('../dist/nodes/NnaPollStudio/NnaPollStudio.node');const p=new NnaPollStudio().description.properties;
 assert.ok(p.find(x=>x.name==='operation').options.some(x=>x.value==='chatgptBridge'));assert.ok(p.find(x=>x.name==='operation').options.some(x=>x.value==='handle'));assert.equal(p.find(x=>x.name==='scopeJSON').noDataExpression,true);
});
