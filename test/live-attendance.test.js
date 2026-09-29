'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{Api}=require('teleproto'),bigInt=require('big-integer');
const {runOperation}=require('../dist/nodes/NnaTelegramSender/sender');
const {NnaTelegramSender}=require('../dist/nodes/NnaTelegramSender/NnaTelegramSender.node');
const c={apiId:12345,apiHash:'a'.repeat(32),sessionString:'1'+'A'.repeat(352),expectedUserId:'12345',allowedGroupId:'-1001234567',allowedGroupUsername:'example_group',allowedTopicIds:'20'};
const cfg={liveAttendanceGroupId:'-1001234567'};
const now=Date.parse('2026-10-04T23:00:00Z');
const user=(id,extra={})=>new Api.User({id:bigInt(id),firstName:'N'+id,...extra});
const part=(id,extra={})=>new Api.GroupCallParticipant({peer:new Api.PeerUser({userId:bigInt(id)}),date:1790000000+id,source:id,...extra});
function fake({call=true,info,pages=[[]],users=[],invokeError,broadcast=false,left=false,participantsError}={}){
 const calls=[];const me=new Api.User({id:bigInt(12345),premium:true});
 const mk=(id)=>new Api.Channel({id:bigInt(id),megagroup:!broadcast,forum:!broadcast,broadcast,left,title:'T',photo:new Api.ChatPhotoEmpty(),date:0});
 const client={connect:async()=>{},destroy:async()=>{},getMe:async()=>me,getEntity:async n=>mk(String(n).slice(4)),getInputEntity:async g=>new Api.InputPeerChannel({channelId:g.id,accessHash:bigInt(1)}),
  invoke:async r=>{
   calls.push(r.className);
   if(r.className==='channels.GetFullChannel')return {fullChat:{call:call?new Api.InputGroupCall({id:bigInt(77),accessHash:bigInt(2)}):undefined}};
   if(r.className==='phone.GetGroupCall'){if(invokeError){const e=Error(invokeError);e.errorMessage=invokeError;throw e;}return {call:info||new Api.GroupCall({id:bigInt(77),accessHash:bigInt(2),participantsCount:2,title:'Sunday Live',version:1,scheduleDate:undefined})};}
   if(r.className==='phone.GetGroupParticipants'){if(participantsError){const e=Error(participantsError);e.errorMessage=participantsError;throw e;}const i=r.offset===''?0:Number(r.offset);return {count:pages.flat().length,participants:pages[i],nextOffset:i+1<pages.length?String(i+1):'',users,chats:[],version:1};}
   throw Error('Unexpected RPC '+r.className);
  }};
 return {client,calls};
}
const run=(f,p=cfg)=>runOperation('pollLiveAttendance',c,p,{createClient:async()=>f.client,now});
const GC=(x={})=>new Api.GroupCall({id:bigInt(77),accessHash:bigInt(2),participantsCount:2,title:'Sunday Live',version:1,...x});

test('active call returns users with profile fields and never writes',async()=>{
 const f=fake({pages:[[part(1),part(2,{activeDate:1790000500})]],users:[user(1,{username:'alice'}),user(2,{usernames:[new Api.Username({username:'bob',active:true,editable:true})]})]});
 const r=await run(f);
 assert.equal(r.status,'active');assert.equal(r.callId,'77');assert.equal(r.participants.length,2);
 assert.deepEqual(r.participants.map(x=>[x.userId,x.username]),[['1','alice'],['2','bob']]);
 assert.equal(r.participants[0].joinedAt,new Date(1790000001*1000).toISOString());assert.equal(r.participants[1].activeAt,new Date(1790000500*1000).toISOString());
 assert.deepEqual(f.calls,['channels.GetFullChannel','phone.GetGroupCall','phone.GetGroupParticipants']);
 assert.equal(r.accessHash,undefined);assert.ok(r.participants.every(x=>x.accessHash===''),'no hash when Telegram gave none');
});
test('a usable user access hash is passed on, a min user hash is not',async()=>{
 const f=fake({pages:[[part(1),part(2)]],users:[user(1,{accessHash:bigInt(555)}),user(2,{accessHash:bigInt(777),min:true})]});
 const r=await run(f);assert.equal(r.participants[0].accessHash,'555');assert.equal(r.participants[1].accessHash,'');
});
test('speaking signals are exposed: activeAt when they spoke, muted flag while unmuted',async()=>{
 const f=fake({pages:[[part(1,{muted:true}),part(2,{activeDate:1790000500,canSelfUnmute:true}),part(3,{muted:true,canSelfUnmute:true})]],users:[user(1),user(2),user(3)]});
 const r=await run(f),by=Object.fromEntries(r.participants.map(x=>[x.userId,x]));
 assert.equal(by['1'].muted,true);assert.equal(by['1'].activeAt,null);
 assert.equal(by['2'].muted,false);assert.ok(by['2'].activeAt);assert.equal(by['2'].canSelfUnmute,true);
 assert.equal(by['3'].canSelfUnmute,true);
});
test('no Live in the group reports no_call without listing participants',async()=>{
 const f=fake({call:false});const r=await run(f);assert.equal(r.status,'no_call');assert.deepEqual(r.participants,[]);assert.ok(!f.calls.includes('phone.GetGroupParticipants'));
 const gone=fake({invokeError:'GROUPCALL_INVALID'});assert.equal((await run(gone)).status,'no_call');
});
test('future scheduled Live is reported as scheduled; started Live with old schedule date is read',async()=>{
 const future=fake({info:GC({scheduleDate:Math.floor(now/1000)+3600,participantsCount:0})});const r=await run(future);assert.equal(r.status,'scheduled');assert.ok(!future.calls.includes('phone.GetGroupParticipants'));
 const started=fake({info:GC({scheduleDate:Math.floor(now/1000)-600}),pages:[[part(1)]],users:[user(1)]});assert.equal((await run(started)).status,'active');
});
test('RTMP stream is flagged unsupported instead of returning an empty list',async()=>{
 const f=fake({info:GC({rtmpStream:true})});const r=await run(f);assert.equal(r.status,'rtmp_unsupported');assert.ok(!f.calls.includes('phone.GetGroupParticipants'));
});
test('pages are combined; duplicates, left rows and anonymous peers are handled',async()=>{
 const anon=new Api.GroupCallParticipant({peer:new Api.PeerChannel({channelId:bigInt(5)}),date:1,source:9});
 const f=fake({pages:[[part(1),part(2,{left:true})],[part(1),anon,part(3)]],users:[user(1),user(2),user(3,{deleted:true})]});
 const r=await run(f);assert.deepEqual(r.participants.map(x=>x.userId),['1','3']);assert.equal(r.anonymousCount,1);assert.equal(r.participants[1].deleted,true);
 assert.equal(f.calls.filter(x=>x==='phone.GetGroupParticipants').length,2);
});
test('unknown user record still yields the id so the person is not lost',async()=>{
 const f=fake({pages:[[part(8)]],users:[]});const r=await run(f);assert.equal(r.participants[0].userId,'8');assert.equal(r.participants[0].username,'');
});
test('review group is allowed only when supplied explicitly; other groups rejected before connecting',async()=>{
 const review='-1009876543';assert.equal((await run(fake({call:false}),{liveAttendanceGroupId:review,liveAttendanceReviewGroupId:review})).status,'no_call');
 for(const p of [{liveAttendanceGroupId:review},{liveAttendanceGroupId:'abc'},{liveAttendanceGroupId:cfg.liveAttendanceGroupId,liveAttendanceReviewGroupId:'x'},{}]){
  let connected=false;await assert.rejects(runOperation('pollLiveAttendance',c,p,{createClient:async()=>{connected=true;return fake().client;}}),/NNA_ATTENDANCE_/);assert.equal(connected,false);
 }
});
test('Telegram read errors fail with a safe code',async()=>{
 await assert.rejects(run(fake({invokeError:'FLOOD_WAIT_9'})),/NNA_ATTENDANCE_READ_FAILED/);
});
test('node exposes the operation and its two parameters',()=>{
 const node=new NnaTelegramSender(),props=node.description.properties;
 assert.ok(props.find(x=>x.name==='operation').options.some(o=>o.value==='pollLiveAttendance'));
 assert.ok(props.some(x=>x.name==='liveAttendanceGroupId'&&x.required)&&props.some(x=>x.name==='liveAttendanceReviewGroupId'&&!x.required));
});

test('a broadcast channel is accepted and flagged as a channel',async()=>{
 const f=fake({broadcast:true,pages:[[part(1)]],users:[user(1,{username:'admin_one'})]});const r=await run(f);
 assert.equal(r.status,'active');assert.equal(r.channel,true);assert.equal(r.participants.length,1);assert.equal(r.listenersHidden,false);
 assert.equal((await run(fake())).channel,false);
});
test('hidden listeners: the refused list is not an error, the counters survive',async()=>{
 const info=new Api.GroupCall({id:bigInt(77),accessHash:bigInt(2),participantsCount:137,title:'Live',version:1,listenersHidden:true});
 const r=await run(fake({broadcast:true,info,participantsError:'GROUPCALL_FORBIDDEN'}));
 assert.equal(r.status,'active');assert.equal(r.listenersHidden,true);assert.equal(r.participantsCount,137);assert.deepEqual(r.participants,[]);
 const visible=new Api.GroupCall({id:bigInt(77),accessHash:bigInt(2),participantsCount:5,title:'Live',version:1});
 await assert.rejects(run(fake({info:visible,participantsError:'GROUPCALL_FORBIDDEN'})),/NNA_ATTENDANCE_READ_FAILED/);
});
test('a channel the account has left is rejected',async()=>{
 await assert.rejects(run(fake({broadcast:true,left:true})),/NNA_ATTENDANCE_GROUP_UNAVAILABLE/);
});
