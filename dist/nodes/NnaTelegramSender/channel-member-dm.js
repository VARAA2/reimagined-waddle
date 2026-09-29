'use strict';
const {createHash}=require('node:crypto');
const {Api}=require('teleproto');
const bigInt=require('big-integer');
const {template}=require('./membership-dm');
const {attendancePeer}=require('./live-attendance');
const {normalize}=require('./channel-membership');
// Sends one welcome or departure message (text or single custom emoji) as the personal account to a person who
// just joined or left a channel/group the account administers. Same rules as the group version: the event is
// proven again from the admin log, the person's current status must still match, one claim per event and part,
// a deterministic random id, and no automatic retry. Recipient-side refusals (privacy, blocked) are returned as
// status "rejected" so that one unreachable person never stops the others.
const id=v=>v==null?'':String(v);
const check=(ok,code)=>{if(!ok)throw Error('NNA_CHANNELDM_'+code);};
const safeId=v=>/^[1-9]\d{0,15}$/.test(id(v))&&Number.isSafeInteger(Number(v));
const REJECTED=/^(USER_PRIVACY_RESTRICTED|USER_IS_BLOCKED|YOU_BLOCKED_USER|INPUT_USER_DEACTIVATED|USER_DEACTIVATED|USER_RESTRICTED|PEER_FLOOD|PREMIUM_ACCOUNT_REQUIRED|ALLOW_PAYMENT_REQUIRED|USER_BANNED_IN_CHANNEL|PRIVACY_PREMIUM_REQUIRED)$/;
function scope(c,p){
 const s=p.scope;
 check(s&&/^-100[1-9]\d{0,12}$/.test(s.channelId||''),'SCOPE_INVALID');
 const extra=p.membershipExtraChannelId||'';
 check(extra===''||/^-100[1-9]\d{0,12}$/.test(extra),'SCOPE_INVALID');
 check(s.channelId===c.allowedGroupId||(extra!==''&&s.channelId===extra),'CHANNEL_NOT_ALLOWED');
 check(typeof s.activatedAt==='string'&&Number.isFinite(Date.parse(s.activatedAt)),'ACTIVATION_INVALID');
 const maxAge=Number.isInteger(s.maxAgeMinutes)?s.maxAgeMinutes:60;check(maxAge>=1&&maxAge<=360,'MAX_AGE_INVALID');
 return {channelId:s.channelId,activated:Date.parse(s.activatedAt),maxAgeMs:maxAge*60000,
  welcome:template(s.welcome),welcomeEmoji:template(s.welcomeEmoji,true),left:template(s.left),leftEmoji:template(s.leftEmoji,true)};
}
function eventOf(p,cfg,c,now){
 const e=p.event;
 check(e&&/^[1-9]\d{0,19}$/.test(id(e.eventId))&&['joined','left'].includes(e.kind)&&safeId(e.userId),'EVENT_INVALID');
 const at=Date.parse(e.at);
 check(Number.isFinite(at)&&at>=cfg.activated&&at<=now+30000&&now-at<=cfg.maxAgeMs,'EVENT_STALE');
 check(id(e.userId)!==id(c.expectedUserId),'SELF_EXCLUDED');
 return {eventId:id(e.eventId),kind:e.kind,userId:id(e.userId),at,eventKey:'channel-member-dm:'+cfg.channelId+':'+id(e.eventId)+':'+e.kind};
}
const randomId=(sender,key,part)=>bigInt((createHash('sha256').update('channel-member-dm-v1\0'+sender+'\0'+key+'\0'+part).digest().readBigInt64BE(0)||1n).toString());
async function verifyEvent(client,peer,e,bounded){
 const r=await bounded(client.invoke(new Api.channels.GetAdminLog({channel:peer,q:'',eventsFilter:new Api.ChannelAdminLogEventsFilter({join:true,leave:true,invite:true}),maxId:bigInt(e.eventId).add(1),minId:bigInt(e.eventId).subtract(1),limit:5})));
 const users=new Map((r.users||[]).map(u=>[id(u.id),u]));
 const hit=(r.events||[]).find(x=>id(x.id)===e.eventId);
 check(hit,'EVENT_NOT_VERIFIED');
 const n=normalize(hit,users);
 check(n&&n.userId===e.userId&&n.kind===e.kind,'EVENT_MISMATCH');
 // A departure message only follows a voluntary leave; a welcome follows any join (including added by an admin).
 check(e.kind==='joined'||n.via==='self','NOT_VOLUNTARY');
 const u=users.get(e.userId);
 check(u?.className==='User'&&!u.bot&&!u.deleted&&!u.min&&u.accessHash,'PEER_UNAVAILABLE');
 return new Api.InputPeerUser({userId:u.id,accessHash:u.accessHash});
}
// Everything that can be proven without Telegram: scope, event freshness, part and the upstream claim.
function precheck(c,p,now=Date.now()){
 const cfg=scope(c,p),e=eventOf(p,cfg,c,now);
 check(['text','emoji'].includes(p.part),'PART_INVALID');
 check(p.claimValidated===true&&p.claimRequestKey===e.eventKey&&p.claimRecipientId===e.userId,'CLAIM_REQUIRED');
 return {cfg,e};
}
async function sendPart(client,c,p,bounded,now=Date.now()){
 const {cfg,e}=precheck(c,p,now);
 const body=e.kind==='joined'?(p.part==='text'?cfg.welcome:cfg.welcomeEmoji):(p.part==='text'?cfg.left:cfg.leftEmoji);
 const {peer:channel}=await attendancePeer(client,cfg.channelId,bounded);
 const mine=(await bounded(client.invoke(new Api.channels.GetParticipant({channel,participant:new Api.InputPeerSelf()})))).participant;
 check(mine?.className==='ChannelParticipantCreator'||mine?.className==='ChannelParticipantAdmin','ADMIN_REQUIRED');
 const peer=await verifyEvent(client,channel,e,bounded);
 let current;
 try{current=(await bounded(client.invoke(new Api.channels.GetParticipant({channel,participant:peer})))).participant;}
 catch(err){if(!/USER_NOT_PARTICIPANT/.test(err.errorMessage||err.message||''))throw Error('NNA_CHANNELDM_STATUS_UNAVAILABLE');}
 const present=Boolean(current)&&['ChannelParticipant','ChannelParticipantSelf','ChannelParticipantAdmin','ChannelParticipantCreator'].includes(current.className);
 check(e.kind==='joined'?present:!present,'STATUS_CHANGED');
 const rid=randomId(c.expectedUserId,e.eventKey,p.part);
 let result;
 try{result=await bounded(client.invoke(new Api.messages.SendMessage({peer,message:body.text,entities:body.entities,noWebpage:true,randomId:rid})));}
 catch(err){
  const code=err?.errorMessage||'';
  if(REJECTED.test(code))return {status:'rejected',code,eventKey:e.eventKey,recipientId:e.userId,kind:e.kind,part:p.part,senderId:id(c.expectedUserId)};
  if(/^FLOOD_WAIT_\d+$/.test(code))return {status:'rejected',code:'FLOOD_WAIT',eventKey:e.eventKey,recipientId:e.userId,kind:e.kind,part:p.part,senderId:id(c.expectedUserId)};
  throw Error('NNA_CHANNELDM_DELIVERY_UNCONFIRMED');
 }
 const updates=result?.updates||[],mid=updates.find(x=>x.className==='UpdateMessageID'&&id(x.randomId)===id(rid))?.id||(result?.className==='UpdateShortSentMessage'?result.id:0);
 check(Number.isSafeInteger(mid)&&mid>0,'DELIVERY_UNCONFIRMED');
 let verified=false;
 try{
  const sent=(await bounded(client.getMessages(peer,{ids:[mid]})))[0];
  verified=Boolean(sent&&sent.out===true&&sent.message===body.text&&body.entities.filter(x=>x.className==='MessageEntityCustomEmoji').every(x=>sent.entities?.some(y=>y.className===x.className&&y.offset===x.offset&&y.length===x.length&&id(y.documentId)===id(x.documentId))));
 }catch{verified=false;}
 return {status:'sent',eventKey:e.eventKey,recipientId:e.userId,kind:e.kind,part:p.part,messageId:mid,verified,senderId:id(c.expectedUserId)};
}
async function runDirect(operation,client,c,p,bounded,now=Date.now()){
 check(operation==='sendChannelMemberDirect','OPERATION');
 return sendPart(client,c,p,bounded,now);
}
module.exports={scope,eventOf,precheck,randomId,sendPart,runDirect};
