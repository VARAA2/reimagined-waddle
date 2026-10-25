'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{Api}=require('teleproto'),bigInt=require('big-integer');
const {runOperation}=require('../dist/nodes/NnaTelegramSender/sender');
const {nextLive,weeklyConfig}=require('../dist/nodes/NnaTelegramSender/live-weekly');
const {NnaTelegramSender}=require('../dist/nodes/NnaTelegramSender/NnaTelegramSender.node');
const c={apiId:12345,apiHash:'a'.repeat(32),sessionString:'1'+'A'.repeat(352),expectedUserId:'12345',allowedGroupId:'-1001234567',allowedGroupUsername:'example_group',allowedTopicIds:'20'};
const cfg={weeklyLiveGroupId:'-1001234567',weeklyLiveWeekday:0,weeklyLiveTimeIst:'04:00',weeklyLiveTitleTemplate:'{DD}_{MM}_{YY} #Example_4AM 📖'};
// Sunday 25 Oct 2026 08:05 IST = 02:35 UTC; the next Sunday 04:00 IST is 1 Nov 2026 = 31 Oct 22:30 UTC.
const NOW=Date.UTC(2026,9,25,2,35),NEXT=Date.UTC(2026,9,31,22,30)/1000;
function fake({existing,admin=true,creator=false,createError,ignoreCreate=false}={}){let call=existing,creates=0;
 const me=new Api.User({id:bigInt(12345)});
 const channel=new Api.Channel({id:bigInt(1234567),megagroup:true,forum:true,creator,adminRights:admin?new Api.ChatAdminRights({manageCall:true}):undefined});
 const client={connect:async()=>{},destroy:async()=>{},getMe:async()=>me,getEntity:async()=>channel,getInputEntity:async()=>new Api.InputPeerChannel({channelId:bigInt(1234567),accessHash:bigInt(1)}),invoke:async r=>{
  if(r.className==='channels.GetFullChannel')return {fullChat:{call:call?{id:call.id}:undefined}};
  if(r.className==='phone.GetGroupCall')return {call:{className:'GroupCall',...call}};
  if(r.className==='phone.CreateGroupCall'){creates++;assert.equal(r.rtmpStream,false);if(createError){const e=Error(createError);e.errorMessage=createError;throw e;}
   const made={id:'-77',title:r.title,scheduleDate:r.scheduleDate};if(!ignoreCreate)call=made;return {updates:[{call:{className:'GroupCall',...made}}]};}
  throw Error('Unexpected RPC '+r.className);
 }};return {client,get creates(){return creates;},get call(){return call;}};
}
const run=(f,p=cfg,now=NOW)=>runOperation('scheduleWeeklyLive',c,p,{createClient:async()=>f.client,now});

test('next Sunday 04:00 IST and the dated title',()=>{
 assert.deepEqual(nextLive(weeklyConfig(cfg),NOW),{liveAt:NEXT,title:'01_11_26 #Example_4AM 📖',istDate:'2026-11-01 04:00'});
 // Saturday evening -> the next morning; Sunday 03:55 (too close) -> one week later.
 assert.equal(nextLive(weeklyConfig(cfg),Date.UTC(2026,9,31,14,0)).liveAt,NEXT);
 assert.equal(nextLive(weeklyConfig(cfg),Date.UTC(2026,9,31,22,25)).liveAt,NEXT+7*86400);
 assert.equal(nextLive(weeklyConfig({...cfg,weeklyLiveTitleTemplate:'{YYYY}-{MM}-{DD}'}),NOW).title,'2026-11-01');
});
test('schedules once, verifies readback, then reports already_scheduled',async()=>{
 const f=fake();const r=await run(f);
 assert.deepEqual(r,{status:'live_scheduled',senderId:'12345',groupId:'-1001234567',title:'01_11_26 #Example_4AM 📖',liveAt:NEXT,istDate:'2026-11-01 04:00',autoStart:false,callId:'-77'});
 assert.equal((await run(f)).status,'already_scheduled');assert.equal(f.creates,1);
});
test('a running or hand-scheduled Live is never changed',async()=>{
 const running=fake({existing:{id:'5',title:'Now'}});assert.equal((await run(running)).status,'live_running');
 const other=fake({existing:{id:'6',title:'Other',scheduleDate:NEXT+3600}});const r=await run(other);
 assert.equal(r.status,'other_live_scheduled');assert.equal(r.existingTitle,'Other');assert.equal(running.creates+other.creates,0);
});
test('admin right is required; creator is enough',async()=>{
 assert.equal((await run(fake({admin:false,creator:true}))).status,'live_scheduled');
 const f=fake({admin:false});await assert.rejects(run(f),/NNA_WEEKLY_LIVE_ADMIN_REQUIRED/);assert.equal(f.creates,0);
});
test('Telegram errors and missing readback fail closed',async()=>{
 await assert.rejects(run(fake({createError:'FLOOD_WAIT_X'})),/NNA_WEEKLY_LIVE_UNCONFIRMED/);
 await assert.rejects(run(fake({createError:'CHAT_ADMIN_REQUIRED'})),/NNA_WEEKLY_LIVE_ADMIN_REQUIRED/);
 await assert.rejects(run(fake({ignoreCreate:true})),/NNA_WEEKLY_LIVE_UNCONFIRMED/);
});
test('invalid configuration is rejected before connecting',async()=>{
 for(const p of [{...cfg,weeklyLiveGroupId:'-1009999999'},{...cfg,weeklyLiveWeekday:7},{...cfg,weeklyLiveTimeIst:'4:00'},{...cfg,weeklyLiveTitleTemplate:''},{...cfg,weeklyLiveTitleTemplate:'a\nb'}]){
  let connected=false;await assert.rejects(runOperation('scheduleWeeklyLive',c,p,{createClient:async()=>{connected=true;return fake().client;},now:NOW}),/NNA_WEEKLY_LIVE_/);assert.equal(connected,false);
 }
});
test('node exposes the operation and its parameters',()=>{
 const node=new NnaTelegramSender(),props=node.description.properties;
 assert.ok(props.find(x=>x.name==='operation').options.some(o=>o.value==='scheduleWeeklyLive'));
 for(const n of ['weeklyLiveGroupId','weeklyLiveWeekday','weeklyLiveTimeIst','weeklyLiveTitleTemplate'])assert.ok(props.find(x=>x.name===n));
});
