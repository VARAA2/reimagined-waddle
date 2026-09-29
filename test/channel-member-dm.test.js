'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{Api}=require('teleproto'),bigInt=require('big-integer');
const {runOperation}=require('../dist/nodes/NnaTelegramSender/sender');
const {NnaTelegramSender}=require('../dist/nodes/NnaTelegramSender/NnaTelegramSender.node');
const c={apiId:12345,apiHash:'a'.repeat(32),sessionString:'1'+'A'.repeat(352),expectedUserId:'12345',allowedGroupId:'-1001234567',allowedGroupUsername:'example_group',allowedTopicIds:'20'};
const CH='-1009876543',ROOT=1790000000,NOW=(ROOT+7200)*1000;
const tpl=(text,ids=[])=>({text,entities:ids.map(([offset,length,documentId])=>({type:'MessageEntityCustomEmoji',offset,length,documentId}))});
const scope=(over={})=>({channelId:CH,activatedAt:new Date((ROOT-3600)*1000).toISOString(),maxAgeMinutes:60,
 welcome:{text:'Welcome friend 🙏',entities:[{type:'MessageEntityBold',offset:0,length:7},{type:'MessageEntityCustomEmoji',offset:15,length:2,documentId:'5233436883039559649'}]},
 welcomeEmoji:tpl('🙏',[[0,2,'5458774648621643551']]),left:{text:'Sorry to see you go 🥺',entities:[{type:'MessageEntityCustomEmoji',offset:19,length:2,documentId:'5314346928660554905'}]},leftEmoji:tpl('🥺',[[0,2,'5458378137240877666']]),...over});
const user=(id,extra={})=>new Api.User({id:bigInt(id),firstName:'N'+id,accessHash:bigInt(1000+id),...extra});
const ev=(id,action,userId,at=ROOT+7000)=>new Api.ChannelAdminLogEvent({id:bigInt(id),date:at,userId:bigInt(userId),action});
const join=(id,u,at)=>ev(id,new Api.ChannelAdminLogEventActionParticipantJoin(),u,at);
const leave=(id,u,at)=>ev(id,new Api.ChannelAdminLogEventActionParticipantLeave(),u,at);
const banned=(id,admin,u)=>ev(id,new Api.ChannelAdminLogEventActionParticipantToggleBan({prevParticipant:new Api.ChannelParticipant({userId:bigInt(u),date:ROOT}),newParticipant:new Api.ChannelParticipantBanned({peer:new Api.PeerUser({userId:bigInt(u)}),kickedBy:bigInt(admin),date:ROOT,bannedRights:new Api.ChatBannedRights({untilDate:0,viewMessages:true})})}),admin);
function fake({events=[],users=[],admin=true,present=true,sendError,readbackText,noReadback=false}={}){
 const sent=[],calls=[];const me=new Api.User({id:bigInt(12345),premium:true});
 const ch=n=>new Api.Channel({id:bigInt(String(n).replace(/^-100/,'')),broadcast:true,title:'#Example',photo:new Api.ChatPhotoEmpty(),date:0});
 const client={connect:async()=>{},destroy:async()=>{},getMe:async()=>me,getEntity:async n=>ch(n),getInputEntity:async g=>new Api.InputPeerChannel({channelId:g.id,accessHash:bigInt(1)}),
  getMessages:async(peer,{ids})=>{calls.push('getMessages');if(noReadback)return [undefined];const s=sent.find(x=>x.id===ids[0]);return [s?{className:'Message',id:s.id,out:true,message:readbackText??s.text,entities:s.entities.map(e=>e)}:undefined];},
  invoke:async r=>{
   calls.push(r.className);
   if(r.className==='channels.GetParticipant'){
    if(r.participant.className==='InputPeerSelf')return {participant:admin?new Api.ChannelParticipantAdmin({userId:bigInt(12345),date:ROOT,promotedBy:bigInt(1),adminRights:new Api.ChatAdminRights({})}):new Api.ChannelParticipant({userId:bigInt(12345),date:ROOT})};
    if(!present){const e=Error('x');e.errorMessage='USER_NOT_PARTICIPANT';throw e;}
    return {participant:new Api.ChannelParticipant({userId:r.participant.userId,date:ROOT})};
   }
   if(r.className==='channels.GetAdminLog'){
    const pick=events.filter(e=>e.id.greater(r.minId)&&e.id.lesser(r.maxId));
    return {events:pick,chats:[],users};
   }
   if(r.className==='messages.SendMessage'){
    if(sendError){const e=Error('x');e.errorMessage=sendError;throw e;}
    const id=500+sent.length;sent.push({id,text:r.message,entities:r.entities,peer:r.peer,randomId:r.randomId});
    return {updates:[new Api.UpdateMessageID({id,randomId:r.randomId})]};
   }
   throw Error('Unexpected RPC '+r.className);
  }};
 return {client,sent,calls};
}
const params=(over={})=>({scope:scope(),event:{eventId:'9',kind:'joined',userId:'77',at:new Date((ROOT+7000)*1000).toISOString()},part:'text',claimValidated:true,claimRequestKey:'channel-member-dm:'+CH+':9:joined',claimRecipientId:'77',membershipExtraChannelId:CH,...over});
const run=(f,p=params())=>runOperation('sendChannelMemberDirect',c,p,{createClient:async()=>f.client,now:NOW});
const joined=()=>fake({events:[join(9,77)],users:[user(77)]});

test('a new member gets the welcome text with the exact custom emoji, then the emoji part',async()=>{
 const f=joined();const t=await run(f);
 assert.equal(t.status,'sent');assert.equal(t.kind,'joined');assert.equal(t.part,'text');assert.equal(t.verified,true);assert.equal(t.recipientId,'77');
 assert.equal(f.sent[0].text,'Welcome friend 🙏');assert.equal(f.sent[0].peer.className,'InputPeerUser');assert.equal(String(f.sent[0].peer.userId),'77');
 const emoji=f.sent[0].entities.find(e=>e.className==='MessageEntityCustomEmoji');assert.equal(String(emoji.documentId),'5233436883039559649');
 const g=joined();const e=await run(g,params({part:'emoji'}));assert.equal(e.part,'emoji');assert.equal(g.sent[0].text,'🙏');assert.equal(String(g.sent[0].entities[0].documentId),'5458774648621643551');
});
test('a voluntary leaver gets the departure text; the send is repeatable only with the same random id',async()=>{
 const p=params({event:{eventId:'9',kind:'left',userId:'77',at:new Date((ROOT+7000)*1000).toISOString()},claimRequestKey:'channel-member-dm:'+CH+':9:left'});
 const a=fake({events:[leave(9,77)],users:[user(77)],present:false});const r=await run(a,p);
 assert.equal(r.kind,'left');assert.equal(a.sent[0].text,'Sorry to see you go 🥺');
 const b=fake({events:[leave(9,77)],users:[user(77)],present:false});await run(b,p);assert.equal(String(a.sent[0].randomId),String(b.sent[0].randomId));
 const other=fake({events:[leave(9,77)],users:[user(77)],present:false});await run(other,{...p,part:'emoji'});assert.notEqual(String(a.sent[0].randomId),String(other.sent[0].randomId));
});
test('removal by an admin never gets the departure message',async()=>{
 const p=params({event:{eventId:'9',kind:'left',userId:'77',at:new Date((ROOT+7000)*1000).toISOString()},claimRequestKey:'channel-member-dm:'+CH+':9:left'});
 const f=fake({events:[banned(9,5,77)],users:[user(77)],present:false});
 await assert.rejects(run(f,p),/NNA_CHANNELDM_EVENT_MISMATCH/);assert.equal(f.sent.length,0);
});
test('the event is proven from the admin log, and the person status must still match',async()=>{
 await assert.rejects(run(fake({events:[],users:[user(77)]})),/EVENT_NOT_VERIFIED/);
 await assert.rejects(run(fake({events:[join(9,78)],users:[user(78)]})),/EVENT_MISMATCH/);
 await assert.rejects(run(fake({events:[join(9,77)],users:[user(77)],present:false})),/STATUS_CHANGED/);
 const p=params({event:{eventId:'9',kind:'left',userId:'77',at:new Date((ROOT+7000)*1000).toISOString()},claimRequestKey:'channel-member-dm:'+CH+':9:left'});
 await assert.rejects(run(fake({events:[leave(9,77)],users:[user(77)],present:true}),p),/STATUS_CHANGED/);
 for(const u of [user(77,{bot:true}),user(77,{deleted:true}),user(77,{min:true})])await assert.rejects(run(fake({events:[join(9,77)],users:[u]})),/PEER_UNAVAILABLE/);
});
test('claim, freshness, self and scope guards stop before anything is read or sent',async()=>{
 const cases=[params({claimValidated:false}),params({claimRequestKey:'channel-member-dm:'+CH+':9:left'}),params({claimRecipientId:'78'}),
  params({event:{eventId:'9',kind:'joined',userId:'77',at:new Date((ROOT-7200)*1000).toISOString()}}),params({event:{eventId:'9',kind:'joined',userId:'77',at:new Date((ROOT+90000)*1000).toISOString()}}),
  params({event:{eventId:'9',kind:'joined',userId:'12345',at:new Date((ROOT+7000)*1000).toISOString()}}),params({event:{eventId:'9',kind:'banned',userId:'77',at:new Date((ROOT+7000)*1000).toISOString()}}),
  params({part:'both'}),params({scope:scope({channelId:'-1005555555'}),membershipExtraChannelId:''}),params({scope:scope({activatedAt:'x'})}),params({scope:scope({welcomeEmoji:{text:'two',entities:[]}})})];
 for(const p of cases){let connected=false;await assert.rejects(runOperation('sendChannelMemberDirect',c,p,{createClient:async()=>{connected=true;return joined().client;},now:NOW}),/NNA_(CHANNELDM|MEMBER)_/);assert.equal(connected,false,JSON.stringify(p.event)+p.part);}
 await assert.rejects(run(fake({events:[join(9,77)],users:[user(77)],admin:false})),/ADMIN_REQUIRED/);
});
test('recipient-side refusals are returned as rejected; unknown failures are unconfirmed and never retried',async()=>{
 for(const code of ['USER_PRIVACY_RESTRICTED','USER_IS_BLOCKED','PEER_FLOOD','FLOOD_WAIT_30']){
  const f=fake({events:[join(9,77)],users:[user(77)],sendError:code});const r=await run(f);assert.equal(r.status,'rejected');assert.match(r.code,/USER_PRIVACY_RESTRICTED|USER_IS_BLOCKED|PEER_FLOOD|FLOOD_WAIT/);assert.equal(f.sent.length,0);
 }
 const f=fake({events:[join(9,77)],users:[user(77)],sendError:'SOMETHING_ELSE'});await assert.rejects(run(f),/NNA_CHANNELDM_DELIVERY_UNCONFIRMED/);
});
test('a failed readback never turns an accepted message into a failure',async()=>{
 for(const opts of [{readbackText:'other'},{noReadback:true}]){const f=fake({events:[join(9,77)],users:[user(77)],...opts});const r=await run(f);assert.equal(r.status,'sent');assert.equal(r.verified,false);}
});
test('node exposes the operation and its parameters',()=>{
 const props=new NnaTelegramSender().description.properties;
 assert.ok(props.find(x=>x.name==='operation').options.some(o=>o.value==='sendChannelMemberDirect'));
 for(const n of ['channelDmScopeJSON','channelDmEventJSON','channelDmPart','channelDmClaimValidated','channelDmClaimRequestKey','channelDmClaimRecipientId','channelDmClaimExecutionId'])assert.ok(props.some(x=>x.name===n),n);
});
