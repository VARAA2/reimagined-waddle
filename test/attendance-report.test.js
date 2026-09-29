'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{Api}=require('teleproto'),bigInt=require('big-integer');
const {runOperation}=require('../dist/nodes/NnaTelegramSender/sender');
const {NnaTelegramSender}=require('../dist/nodes/NnaTelegramSender/NnaTelegramSender.node');
const c={apiId:12345,apiHash:'a'.repeat(32),sessionString:'1'+'A'.repeat(352),expectedUserId:'12345',allowedGroupId:'-1001234567',allowedGroupUsername:'example_group',allowedTopicIds:'20'};
const link=(id,name)=>`<a href="tg://user?id=${id}">${name}</a>`;
const base=(over={})=>({report:{reportKey:'2026-10-04|main',targetGroupId:'',topicId:0,parts:['📡 <b>அறிக்கை</b>\n1. '+link(111,'Alpha')+'\n2. '+link(222,'Beta')+'\n3. <a href="https://t.me/gamma_user">Gamma</a>'],hints:{},...over}});

// fake: getInputEntity only succeeds for users already in `cache`; fetches add users to the cache.
function fake({cache=[111,222],messageUsers={},searchUsers={},hashOk={},dropEntities=false,sendError=false,wrongText=false,rejectMentions='',hideReadback=false}={}){
 const known=new Set(cache.map(String)),calls=[],sent=[];
 const me=new Api.User({id:bigInt(12345),premium:true});
 const mk=n=>new Api.Channel({id:bigInt(String(n).replace(/^-100/,'')),megagroup:true,forum:true,title:'T',photo:new Api.ChatPhotoEmpty(),date:0});
 const client={connect:async()=>{},destroy:async()=>{},getMe:async()=>me,
  getEntity:async n=>mk(n),
  getInputEntity:async x=>{
   if(x&&x.className==='Channel'||x&&x.className==='InputPeerSelf'||x&&x.className==='InputPeerChannel')return x.className==='Channel'?new Api.InputPeerChannel({channelId:x.id,accessHash:bigInt(1)}):x;
   const u=String(x);if(!known.has(u))throw Error('Could not find the input entity');return new Api.InputPeerUser({userId:bigInt(u),accessHash:bigInt(9)});
  },
  getMessages:async(peer,{ids})=>{
   calls.push('getMessages');
   if(peer.className==='InputPeerSelf'||sent.some(s=>s.id===ids[0])){const s=sent.find(x=>x.id===ids[0]);return [s?{className:'Message',id:s.id,out:true,message:wrongText?'other':s.text,entities:dropEntities?[]:s.entities.map(e=>e.className==='InputMessageEntityMentionName'?new Api.MessageEntityMentionName({offset:e.offset,length:e.length,userId:e.userId.userId}):e)}:undefined];}
   for(const [uid,mid] of Object.entries(messageUsers))if(mid===ids[0])known.add(uid);
   return [{className:'Message',id:ids[0]}];
  },
  invoke:async r=>{
   calls.push(r.className);
   if(r.className==='users.GetUsers'){const u=String(r.id[0].userId);return [hashOk[u]?new Api.User({id:bigInt(u),accessHash:bigInt(hashOk[u])}):new Api.UserEmpty({id:bigInt(u)})];}
   if(r.className==='channels.GetParticipants'){for(const [uid,q] of Object.entries(searchUsers))if(r.filter.q===q)known.add(uid);return {participants:[]};}
   if(r.className==='messages.GetMessages'){calls.push('raw-getmessages');const s=sent.find(x=>x.id===r.id[0].id);return {messages:hideReadback||!s?[]:[{className:'Message',id:s.id,out:false,message:wrongText?'other':s.text,entities:dropEntities?[]:s.entities.map(e=>e.className==='InputMessageEntityMentionName'?new Api.MessageEntityMentionName({offset:e.offset,length:e.length,userId:e.userId.userId}):e)}]};}
   if(r.className==='messages.SendMessage'){
    if(sendError)throw Error('network');
    if(rejectMentions&&r.entities.some(e=>e.className==='InputMessageEntityMentionName')){const e=Error('rejected');e.errorMessage=rejectMentions;throw e;}
    const id=1000+sent.length;sent.push({id,text:r.message,entities:r.entities,peer:r.peer,replyTo:r.replyTo,randomId:r.randomId});
    return {updates:[new Api.UpdateMessageID({id,randomId:r.randomId})]};
   }
   throw Error('Unexpected RPC '+r.className);
  }};
 return {client,calls,sent};
}
const run=(f,p=base(),extra={})=>runOperation('sendAttendanceReport',c,{...p,...extra},{createClient:async()=>f.client});

test('cached users become real mentions; username links stay links; sent to Saved Messages',async()=>{
 const f=fake();const r=await run(f);
 assert.equal(r.status,'sent');assert.equal(r.destination,'saved_messages');assert.deepEqual(r.mentionsUnresolved,[]);assert.equal(r.mentionsResolved,2);
 const s=f.sent[0];assert.equal(s.peer.className,'InputPeerSelf');
 assert.deepEqual(s.entities.map(e=>e.className),['MessageEntityBold','InputMessageEntityMentionName','InputMessageEntityMentionName','MessageEntityTextUrl']);
 assert.ok(!f.calls.includes('users.GetUsers')&&!f.calls.includes('channels.GetParticipants'));
});
test('stored access hash is verified before use; a bad hash falls back to plain text and never blocks the report',async()=>{
 const p=base({hints:{111:{accessHash:'42'},222:{accessHash:'43'}}});p.report.parts=['1. '+link(555,'Hash Ok')+'\n2. '+link(556,'Hash Bad')];p.report.hints={555:{accessHash:'42'},556:{accessHash:'43'}};
 const f=fake({cache:[],hashOk:{555:'42'}});const r=await run(f,p);
 assert.deepEqual(r.mentionsUnresolved,['556']);assert.equal(r.mentionsResolved,1);
 assert.equal(f.sent[0].entities.filter(e=>e.className==='InputMessageEntityMentionName').length,1);assert.match(f.sent[0].text,/Hash Bad/);
});
test('a message the person wrote resolves them (topic messages hint)',async()=>{
 const p=base();p.report.parts=['1. '+link(777,'Chatter')];p.report.hints={777:{messageId:151144}};
 const f=fake({cache:[],messageUsers:{777:151144}});const r=await run(f,p);
 assert.deepEqual(r.mentionsUnresolved,[]);assert.equal(f.sent[0].entities[0].className,'InputMessageEntityMentionName');
});
test('member search by name is the last resort',async()=>{
 const p=base();p.report.parts=['1. '+link(888,'Searchable')];p.report.hints={888:{name:'Searchable'}};
 const f=fake({cache:[],searchUsers:{888:'Searchable'}});const r=await run(f,p);
 assert.deepEqual(r.mentionsUnresolved,[]);assert.ok(f.calls.includes('channels.GetParticipants'));
});
test('unresolvable people stay as plain text and are reported',async()=>{
 const p=base();p.report.parts=['1. '+link(999,'Nobody')];const f=fake({cache:[]});const r=await run(f,p);
 assert.deepEqual(r.mentionsUnresolved,['999']);assert.equal(f.sent[0].entities.length,0);assert.equal(r.status,'sent');
});
test('several parts are sent in order with stable random ids (safe re-run)',async()=>{
 const p=base();p.report.parts=['part <b>one</b>','part two'];const a=fake();await run(a,p);const b=fake();await run(b,p);
 assert.equal(a.sent.length,2);assert.deepEqual(a.sent.map(s=>String(s.randomId)),b.sent.map(s=>String(s.randomId)));
 assert.notEqual(String(a.sent[0].randomId),String(a.sent[1].randomId));
});
test('group topic destination: only the allowed or explicitly extra group, reply to the topic',async()=>{
 const ok=base({targetGroupId:'-1001234567',topicId:20});const f=fake();const r=await run(f,ok);assert.equal(r.destination,'-1001234567');
 assert.equal(String(f.sent[0].replyTo.topMsgId),'20');
 const extra=base({targetGroupId:'-1009999999',topicId:4});const g=fake();assert.equal((await run(g,extra,{attendanceExtraGroupId:'-1009999999'})).status,'sent');
 for(const bad of [base({targetGroupId:'-1009999999',topicId:4}),base({targetGroupId:'-100abc'}),base({topicId:5}),base({parts:[]}),base({parts:Array(11).fill('x')}),base({reportKey:'bad key!'})]){
  let connected=false;await assert.rejects(runOperation('sendAttendanceReport',c,bad,{createClient:async()=>{connected=true;return fake().client;}}),/NNA_REPORT_/);assert.equal(connected,false);
 }
});
test('only bold, user mentions and t.me links are accepted; anything else is rejected before connecting',async()=>{
 for(const html of ['<i>x</i>','<a href="https://evil.example/x">x</a>','<a href="tg://user?id=abc">x</a>','<b>open','x</b>','<a>no href</a>','<b href="tg://user?id=1">x</b>','<script>x</script>']){
  const p=base();p.report.parts=[html];let connected=false;
  await assert.rejects(runOperation('sendAttendanceReport',c,p,{createClient:async()=>{connected=true;return fake().client;}}),/NNA_REPORT_/,html);assert.equal(connected,false);
 }
});
test('an unreachable network is unconfirmed and never retried; a named Telegram refusal is reported by name',async()=>{
 const a=fake({sendError:true});await assert.rejects(run(a),/NNA_REPORT_DELIVERY_UNCONFIRMED/);assert.equal(a.sent.length,0);
});
test('a failed readback never turns a sent report into a failure, it only says verified:false',async()=>{
 for(const opts of [{hideReadback:true},{wrongText:true},{dropEntities:true}]){
  const f=fake(opts);const r=await run(f);assert.equal(r.status,'sent');assert.equal(f.sent.length,1);assert.equal(r.verified,false);assert.equal(r.verifyNotes.length,1);
 }
 const good=await run(fake());assert.equal(good.verified,true);assert.deepEqual(good.verifyNotes,[]);
});
test('Saved Messages are verified with the raw request, group topics with the normal helper',async()=>{
 const s=fake();await run(s);assert.ok(s.calls.includes('raw-getmessages'));
 const g=fake();await run(g,base({targetGroupId:'-1001234567',topicId:20}));assert.ok(!g.calls.includes('raw-getmessages'));
});
test('a refused mention is retried once as plain text, and other refusals are surfaced by name',async()=>{
 const f=fake({rejectMentions:'USER_ID_INVALID'});const r=await run(f);
 assert.equal(r.status,'sent');assert.equal(f.sent.length,1);assert.ok(f.sent[0].entities.every(e=>e.className!=='InputMessageEntityMentionName'));
 assert.deepEqual(r.verifyNotes,['MENTIONS_DROPPED_USER_ID_INVALID']);assert.equal(r.verified,false);
 const g=fake({rejectMentions:'CHAT_WRITE_FORBIDDEN'});await assert.rejects(run(g),/NNA_REPORT_SEND_REJECTED_CHAT_WRITE_FORBIDDEN/);assert.equal(g.sent.length,0);
});
test('monospace ids are allowed for membership records, code tags with attributes are not',async()=>{
 const p=base();p.report.parts=['<b>Name:</b> '+link(111,'Alpha')+'\n<b>ID:</b> <code>111</code>'];const f=fake();const r=await run(f,p);
 assert.equal(r.status,'sent');assert.ok(f.sent[0].entities.some(e=>e.className==='MessageEntityCode'));
 const bad=base();bad.report.parts=['<code href="tg://user?id=1">x</code>'];await assert.rejects(runOperation('sendAttendanceReport',c,bad,{createClient:async()=>fake().client}),/NNA_REPORT_/);
});
test('node exposes the operation, JSON parameter and optional extra group',()=>{
 const props=new NnaTelegramSender().description.properties;
 assert.ok(props.find(x=>x.name==='operation').options.some(o=>o.value==='sendAttendanceReport'));
 assert.ok(props.some(x=>x.name==='attendanceReportJSON'&&x.required)&&props.some(x=>x.name==='attendanceExtraGroupId'&&!x.required));
});
