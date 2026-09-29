'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Api}=require('teleproto'),bigInt=require('big-integer');
const {config,event,template,randomId,sendPart}=require('../dist/nodes/NnaTelegramSender/membership-dm');
const now=Date.parse('2026-09-25T05:00:00Z');
const body={text:'Hello 🌷',entities:[{type:'MessageEntityBold',offset:0,length:5}]};
const emoji={text:'🙏',entities:[{type:'MessageEntityCustomEmoji',offset:0,length:2,documentId:'5458774648621643551'}]};
const p=()=>({membershipGroupId:'-1001234500000',membershipActivatedAt:'2026-09-25T04:00:00Z',membershipWelcomeJSON:body,membershipLeftJSON:body,membershipWelcomeEmojiJSON:emoji,membershipLeftEmojiJSON:emoji});
const update=(kind='welcome')=>({update_id:123,chat_member:{chat:{id:-1001234500000,type:'supergroup'},from:{id:99},date:now/1000-60,old_chat_member:{status:kind==='welcome'?'left':'member',user:{id:99,is_bot:false}},new_chat_member:{status:kind==='welcome'?'member':'left',user:{id:99,is_bot:false}}}});
const creds={allowedGroupId:'-1001234500000',allowedGroupUsername:'testgroup',expectedUserId:'42'};
function clientMock(kind='welcome',error=null){
 let writes=0;let request;
 return {get writes(){return writes;},get request(){return request;},
 getEntity:async()=>new Api.Channel({id:bigInt(1234500000),megagroup:true,adminRights:{},title:'Test',photo:new Api.ChatPhotoEmpty(),date:0}),getInputEntity:async()=>new Api.InputChannel({channelId:bigInt(1234500000),accessHash:bigInt(1)}),
 invoke:async req=>{
  if(req.className==='channels.GetAdminLog')return {events:[{id:bigInt(4),date:now/1000-60,userId:bigInt(99),action:{className:kind==='welcome'?'ChannelAdminLogEventActionParticipantJoin':'ChannelAdminLogEventActionParticipantLeave'}}],users:[{className:'User',id:bigInt(99),accessHash:bigInt(8)}]};
  if(req.className==='channels.GetParticipant')return {participant:{className:kind==='welcome'?'ChannelParticipant':'ChannelParticipantLeft'}};
  assert.equal(req.className,'messages.SendMessage');writes++;request=req;if(error)throw error;return {className:'UpdateShortSentMessage',id:777};
 },getMessages:async()=>[{out:true,peerId:{userId:bigInt(99)},message:request.message,entities:request.entities}]};
}
const bounded=x=>x;
function sendParams(kind='welcome',part='text'){const z=p();z.update=update(kind);z.claimValidated=true;z.claimRecipientId='99';z.claimRequestKey=event(z.update,z,now).eventKey;z.part=part;return z;}
test('only fresh post-activation human joins and voluntary leaves qualify',()=>{
 const z=p(),u=update();assert.equal(event(u,z,now).kind,'welcome');assert.equal(event(update('left'),z,now).kind,'left');
 u.chat_member.new_chat_member.user.is_bot=true;assert.equal(event(u,z,now),null);u.chat_member.new_chat_member.user.is_bot=false;
 u.chat_member.chat.id=-100555;assert.equal(event(u,z,now),null);
 const removed=update('left');removed.chat_member.from.id=55;assert.equal(event(removed,z,now),null);
 const old=update();old.chat_member.date-=3600;assert.equal(event(old,z,now),null);
 const future=update();future.chat_member.date+=3600;assert.equal(event(future,z,now),null);
});
test('custom emoji preserves exact ID and UTF16 offsets; invalid entities fail',()=>{
 const e=template(emoji,true).entities[0];assert.equal(String(e.documentId),emoji.entities[0].documentId);assert.equal(e.length,2);
 assert.throws(()=>template({...emoji,entities:[{...emoji.entities[0],length:3}]},true),/ENTITY_INVALID/);
 assert.throws(()=>template(body,true),/SINGLE_CUSTOM_EMOJI_REQUIRED/);
 assert.throws(()=>config({...p(),membershipActivatedAt:'tomorrow'}),/ACTIVATION_INVALID/);
});
test('part delivery uses verified target and stable distinct random IDs',async()=>{
 const z=sendParams(),c=clientMock();const r=await sendPart(c,creds,z,bounded,now);assert.equal(r.recipientId,'99');assert.equal(c.writes,1);assert.equal(c.request.message,body.text);
 assert.equal(String(c.request.randomId),String(randomId('42',z.claimRequestKey,'text')));assert.notEqual(String(c.request.randomId),String(randomId('42',z.claimRequestKey,'emoji')));
});
test('departure custom emoji is separate and exact',async()=>{
 const z=sendParams('left','emoji'),c=clientMock('left');const r=await sendPart(c,creds,z,bounded,now);assert.equal(r.part,'emoji');assert.equal(c.request.message,'🙏');assert.equal(String(c.request.entities[0].documentId),emoji.entities[0].documentId);
});
test('recipient tampering and scope mismatch cannot send',async()=>{
 const z=sendParams(),c=clientMock();z.claimRecipientId='777';await assert.rejects(sendPart(c,creds,z,bounded,now),/CLAIM_REQUIRED/);assert.equal(c.writes,0);
 await assert.rejects(sendPart(c,{...creds,allowedGroupId:'-100888'},sendParams(),bounded,now),/SCOPE_MISMATCH/);assert.equal(c.writes,0);
});
test('missing log evidence or changed membership cannot send',async()=>{
 const c=clientMock();const invoke=c.invoke;c.invoke=async req=>req.className==='channels.GetAdminLog'?{events:[],users:[]}:invoke(req);
 await assert.rejects(sendPart(c,creds,sendParams(),bounded,now),/EVENT_NOT_VERIFIED/);assert.equal(c.writes,0);
 const c2=clientMock('left');await assert.rejects(sendPart(c2,creds,sendParams(),bounded,now),/EVENT_NOT_VERIFIED/);assert.equal(c2.writes,0);
});
test('uncertain delivery is one write, never an automatic retry',async()=>{
 const c=clientMock('welcome',Error('timeout'));await assert.rejects(sendPart(c,creds,sendParams(),bounded,now),/DELIVERY_UNCONFIRMED/);assert.equal(c.writes,1);
});
test('privacy rejection is sanitized and stops sending',async()=>{
 const c=clientMock('welcome',{errorMessage:'USER_PRIVACY_RESTRICTED',message:'secret'});await assert.rejects(sendPart(c,creds,sendParams(),bounded,now),/^Error: NNA_MEMBER_SEND_REJECTED_USER_PRIVACY_RESTRICTED$/);assert.equal(c.writes,1);
});
