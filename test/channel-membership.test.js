'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{Api}=require('teleproto'),bigInt=require('big-integer');
const {runOperation}=require('../dist/nodes/NnaTelegramSender/sender');
const {NnaTelegramSender}=require('../dist/nodes/NnaTelegramSender/NnaTelegramSender.node');
const c={apiId:12345,apiHash:'a'.repeat(32),sessionString:'1'+'A'.repeat(352),expectedUserId:'12345',allowedGroupId:'-1001234567',allowedGroupUsername:'example_group',allowedTopicIds:'20'};
const CH='-1009876543';
const T=1790000000;
const user=(id,extra={})=>new Api.User({id:bigInt(id),firstName:'N'+id,accessHash:bigInt(1000+id),...extra});
const ev=(id,action,userId,extra={})=>new Api.ChannelAdminLogEvent({id:bigInt(id),date:T+id,userId:bigInt(userId),action,...extra});
const join=(id,u)=>ev(id,new Api.ChannelAdminLogEventActionParticipantJoin(),u);
const joinInvite=(id,u)=>ev(id,new Api.ChannelAdminLogEventActionParticipantJoinByInvite({invite:new Api.ChatInviteExported({link:'https://t.me/+SECRETLINK',adminId:bigInt(1),date:T,revoked:false,permanent:false,requestNeeded:false})}),u);
const request=(id,u,by)=>ev(id,new Api.ChannelAdminLogEventActionParticipantJoinByRequest({invite:new Api.ChatInviteExported({link:'https://t.me/+SECRETLINK',adminId:bigInt(1),date:T}),approvedBy:bigInt(by)}),u);
const added=(id,adminId,u)=>ev(id,new Api.ChannelAdminLogEventActionParticipantInvite({participant:new Api.ChannelParticipant({userId:bigInt(u),date:T})}),adminId);
const leave=(id,u)=>ev(id,new Api.ChannelAdminLogEventActionParticipantLeave(),u);
const banned=(id,adminId,u,view=true)=>ev(id,new Api.ChannelAdminLogEventActionParticipantToggleBan({prevParticipant:new Api.ChannelParticipant({userId:bigInt(u),date:T}),newParticipant:new Api.ChannelParticipantBanned({peer:new Api.PeerUser({userId:bigInt(u)}),kickedBy:bigInt(adminId),date:T,bannedRights:new Api.ChatBannedRights({untilDate:0,viewMessages:view})})}),adminId);
function fake({events=[],users=[],admin='admin',broadcast=true,failLog=false}={}){
 const asked=[];const me=new Api.User({id:bigInt(12345),premium:true});
 const ch=n=>new Api.Channel({id:bigInt(String(n).replace(/^-100/,'')),broadcast,megagroup:!broadcast,title:'#Example Channel',photo:new Api.ChatPhotoEmpty(),date:0});
 const client={connect:async()=>{},destroy:async()=>{},getMe:async()=>me,getEntity:async n=>ch(n),getInputEntity:async g=>new Api.InputPeerChannel({channelId:g.id,accessHash:bigInt(1)}),
  invoke:async r=>{
   if(r.className==='channels.GetParticipant')return {participant:admin==='admin'?new Api.ChannelParticipantAdmin({userId:bigInt(12345),date:T,promotedBy:bigInt(1),adminRights:new Api.ChatAdminRights({})}):admin==='creator'?new Api.ChannelParticipantCreator({userId:bigInt(12345),adminRights:new Api.ChatAdminRights({})}):new Api.ChannelParticipant({userId:bigInt(12345),date:T})};
   if(r.className==='channels.GetAdminLog'){
    if(failLog){const e=Error('x');e.errorMessage='CHAT_ADMIN_REQUIRED';throw e;}
    asked.push({min:String(r.minId),max:String(r.maxId),limit:r.limit,filter:r.eventsFilter});
    const pick=events.filter(e=>e.id.greater(r.minId)&&(String(r.maxId)==='0'||e.id.lesser(r.maxId))).sort((a,b)=>b.id.compare(a.id)).slice(0,r.limit);
    return {events:pick,chats:[],users};
   }
   throw Error('Unexpected RPC '+r.className);
  }};
 return {client,asked};
}
const cfg={membershipChannelId:CH,membershipExtraChannelId:CH,membershipSinceEventId:'0'};
const run=(f,p=cfg)=>runOperation('readChannelMembership',c,p,{createClient:async()=>f.client,now:Date.parse('2026-10-01T00:00:00Z')});

test('every event kind is normalised, oldest first, with the person and no invite link',async()=>{
 const f=fake({events:[join(1,11),joinInvite(2,12),request(3,13,99),added(4,98,14),leave(5,11),banned(6,97,15)],users:[user(11,{username:'eleven'}),user(12),user(13),user(14),user(15)]});
 const r=await run(f);
 assert.equal(r.status,'ok');assert.equal(r.channel,true);assert.equal(r.maxEventId,'6');assert.equal(r.complete,true);
 assert.deepEqual(r.events.map(e=>[e.eventId,e.kind,e.via,e.userId,e.actorId]),[['1','joined','self','11','11'],['2','joined','invite_link','12','12'],['3','joined','join_request','13','99'],['4','joined','added','14','98'],['5','left','self','11','11'],['6','removed','removed_by_admin','15','97']]);
 assert.equal(r.events[0].user.username,'eleven');assert.equal(r.events[0].user.accessHash,'1011');
 assert.ok(!JSON.stringify(r).includes('SECRETLINK'),'invite links are secrets');
 assert.equal(f.asked[0].filter.join,true);assert.equal(f.asked[0].filter.leave,true);
});
test('only events after the cursor are returned and the cursor advances',async()=>{
 const f=fake({events:[join(1,11),join(2,12),leave(3,12)],users:[user(11),user(12)]});
 const r=await run(f,{...cfg,membershipSinceEventId:'2'});
 assert.deepEqual(r.events.map(e=>e.eventId),['3']);assert.equal(r.maxEventId,'3');
 const none=await run(f,{...cfg,membershipSinceEventId:'3'});assert.equal(none.count,0);assert.equal(none.maxEventId,'3');
});
test('cursor initialisation returns the newest id and no events, so old members are never processed',async()=>{
 const f=fake({events:[join(1,11),join(2,12),leave(3,12)],users:[user(11),user(12)]});
 const r=await run(f,{...cfg,membershipSinceEventId:'-1'});
 assert.equal(r.status,'cursor_initialised');assert.deepEqual(r.events,[]);assert.equal(r.maxEventId,'3');
 const empty=await run(fake(),{...cfg,membershipSinceEventId:'-1'});assert.equal(empty.maxEventId,'0');
});
test('activation time hides earlier events but the cursor still moves past them',async()=>{
 const f=fake({events:[join(1,11),join(3600,12)],users:[user(11),user(12)]});
 const r=await run(f,{...cfg,membershipActivatedAt:new Date((T+100)*1000).toISOString()});
 assert.deepEqual(r.events.map(e=>e.eventId),['3600']);assert.equal(r.maxEventId,'3600');
});
test('more than one page is followed, and a huge backlog is reported as incomplete',async()=>{
 const many=Array.from({length:230},(_,i)=>join(i+1,1000+i));const users=many.map((e,i)=>user(1000+i));
 const r=await run(fake({events:many,users}));assert.equal(r.count,230);assert.equal(r.complete,true);assert.equal(r.events[0].eventId,'1');assert.equal(r.events[229].eventId,'230');
 const big=Array.from({length:620},(_,i)=>join(i+1,5000+i));
 const partial=await run(fake({events:big,users:big.map((e,i)=>user(5000+i))}));assert.equal(partial.complete,false);assert.equal(partial.count,500);
});
test('unknown users keep the id, bots and deleted accounts are flagged',async()=>{
 const f=fake({events:[join(1,21),join(2,22),join(3,23)],users:[user(22,{bot:true}),user(23,{deleted:true,min:true})]});
 const r=await run(f);
 assert.equal(r.events[0].user,null);assert.equal(r.events[1].user.bot,true);assert.equal(r.events[2].user.deleted,true);assert.equal(r.events[2].user.accessHash,'');
});
test('a non-admin account, a channel that is not allowed, or a bad cursor stop before any log read',async()=>{
 await assert.rejects(run(fake({admin:'member'})),/NNA_MEMBERSHIP_ADMIN_REQUIRED/);
 assert.equal((await run(fake({admin:'creator'}))).status,'ok');
 for(const p of [{...cfg,membershipChannelId:'-1005555555',membershipExtraChannelId:''},{...cfg,membershipChannelId:'abc'},{...cfg,membershipSinceEventId:'-2'},{...cfg,membershipSinceEventId:'1;2'},{...cfg,membershipActivatedAt:'not a date'}]){
  let connected=false;await assert.rejects(runOperation('readChannelMembership',c,p,{createClient:async()=>{connected=true;return fake().client;}}),/NNA_MEMBERSHIP_/);assert.equal(connected,false);
 }
 await assert.rejects(run(fake({failLog:true})),/NNA_MEMBERSHIP_READ_FAILED/);
});
test('the main allowed group needs no extra permission and the node exposes the parameters',async()=>{
 const own={membershipChannelId:c.allowedGroupId,membershipSinceEventId:'0'};assert.equal((await run(fake({broadcast:false}),own)).status,'ok');
 const props=new NnaTelegramSender().description.properties;
 assert.ok(props.find(x=>x.name==='operation').options.some(o=>o.value==='readChannelMembership'));
 for(const n of ['membershipChannelId','membershipExtraChannelId','membershipSinceEventId','membershipActivatedAt'])assert.ok(props.some(x=>x.name===n),n);
});
