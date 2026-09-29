'use strict';
const {createHash}=require('node:crypto');
const {Api,utils}=require('teleproto');
const bigInt=require('big-integer');
const id=v=>v==null?'':String(v);
function check(ok,code){if(!ok)throw Error('NNA_MEMBER_'+code);}
const safeId=v=>/^[1-9][0-9]*$/.test(id(v))&&Number.isSafeInteger(Number(v));
const entityTypes=new Set(['MessageEntityBold','MessageEntityItalic','MessageEntityUnderline','MessageEntityStrike','MessageEntitySpoiler','MessageEntityCode','MessageEntityPre','MessageEntityBlockquote','MessageEntityHashtag','MessageEntityMention','MessageEntityUrl','MessageEntityTextUrl','MessageEntityEmail','MessageEntityCustomEmoji']);
function template(value,emojiOnly=false){
 const t=typeof value==='string'?JSON.parse(value):value;
 check(t&&typeof t.text==='string'&&t.text.length>0&&t.text.length<=3500&&Array.isArray(t.entities),'TEMPLATE_INVALID');
 const entities=t.entities.map(e=>{
  check(e&&entityTypes.has(e.type)&&Number.isInteger(e.offset)&&Number.isInteger(e.length)&&e.offset>=0&&e.length>0&&e.offset+e.length<=t.text.length,'ENTITY_INVALID');
  const p={offset:e.offset,length:e.length};
  if(e.type==='MessageEntityCustomEmoji'){check(safeId(e.documentId)||/^[1-9][0-9]{1,19}$/.test(id(e.documentId)),'EMOJI_INVALID');p.documentId=bigInt(e.documentId);}
  if(e.type==='MessageEntityTextUrl'){check(typeof e.url==='string'&&/^https:\/\//.test(e.url),'URL_INVALID');p.url=e.url;}
  if(e.type==='MessageEntityPre')p.language=e.language||'';
  if(e.type==='MessageEntityBlockquote'&&e.collapsed===true)p.collapsed=true;
  return new Api[e.type](p);
 });
 if(emojiOnly)check(entities.length===1&&entities[0].className==='MessageEntityCustomEmoji'&&entities[0].offset===0&&entities[0].length===t.text.length,'SINGLE_CUSTOM_EMOJI_REQUIRED');
 return {text:t.text,entities};
}
function config(p){
 check(/^-100[1-9][0-9]+$/.test(p.membershipGroupId||''),'GROUP_INVALID');
 check(typeof p.membershipActivatedAt==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(p.membershipActivatedAt)&&Number.isFinite(Date.parse(p.membershipActivatedAt)),'ACTIVATION_INVALID');
 return {groupId:p.membershipGroupId,activated:Date.parse(p.membershipActivatedAt),welcome:template(p.membershipWelcomeJSON),left:template(p.membershipLeftJSON),welcomeEmoji:template(p.membershipWelcomeEmojiJSON,true),leftEmoji:template(p.membershipLeftEmojiJSON,true)};
}
function event(update,p,now=Date.now()){
 const c=config(p),m=update?.chat_member;
 if(!m||!Number.isSafeInteger(update.update_id)||id(m.chat?.id)!==c.groupId||m.chat.type!=='supergroup')return null;
 const old=m.old_chat_member,next=m.new_chat_member,user=next?.user;
 check(safeId(user?.id)&&old?.user?.id===user.id&&Number.isSafeInteger(m.date),'EVENT_INVALID');
 if(user.is_bot===true)return null;
 const date=m.date*1000;if(date<c.activated||date>now+30000||now-date>1800000)return null;
 const present=x=>['creator','administrator','member'].includes(x?.status)||(x?.status==='restricted'&&x.is_member===true);
 let kind;
 if(!present(old)&&present(next))kind='welcome';
 else if(present(old)&&next.status==='left'&&m.from?.id===user.id)kind='left';
 else return null;
 return {kind,userId:id(user.id),date:m.date,eventKey:'member-dm:'+c.groupId+':'+update.update_id+':'+kind,groupId:c.groupId};
}
function randomId(senderId,eventKey,part){const d=createHash('sha256').update('member-dm-v1\0'+senderId+'\0'+eventKey+'\0'+part).digest();return bigInt((d.readBigInt64BE(0)||1n).toString());}
function logTarget(e){const a=e.action;
 if(['ChannelAdminLogEventActionParticipantJoin','ChannelAdminLogEventActionParticipantLeave'].includes(a?.className))return id(e.userId);
 if(a?.className==='ChannelAdminLogEventActionParticipantInvite')return id(a.participant?.userId||a.participant?.peer?.userId);
 if(['ChannelAdminLogEventActionParticipantJoinByInvite','ChannelAdminLogEventActionParticipantJoinByRequest'].includes(a?.className))return id(e.userId);
 return '';
}
async function resolvePeer(client,channel,e,bounded){
 let maxId=bigInt.zero;
 for(let page=0;page<5;page++){
  const logs=await bounded(client.invoke(new Api.channels.GetAdminLog({channel,q:'',eventsFilter:new Api.ChannelAdminLogEventsFilter({join:true,leave:true,invite:true}),maxId,minId:bigInt.zero,limit:100})));
  const match=(logs.events||[]).find(x=>logTarget(x)===e.userId&&Math.abs(x.date-e.date)<=5&&(e.kind==='left'?x.action.className==='ChannelAdminLogEventActionParticipantLeave':x.action.className!=='ChannelAdminLogEventActionParticipantLeave'));
  if(match){
   const user=(logs.users||[]).find(u=>id(u.id)===e.userId);
   check(user?.className==='User'&&!user.deleted&&!user.bot&&!user.min&&user.accessHash,'PEER_UNAVAILABLE');
   return new Api.InputPeerUser({userId:user.id,accessHash:user.accessHash});
  }
  if(!logs.events?.length||logs.events.at(-1).date<e.date-5)break;
  maxId=logs.events.at(-1).id;
 }
 throw Error('NNA_MEMBER_EVENT_NOT_VERIFIED');
}
async function sendPart(client,credentials,p,bounded,now=Date.now()){
 const cfg=config(p),e=event(p.update,p,now);
 check(cfg.groupId===credentials.allowedGroupId,'SCOPE_MISMATCH');
 check(e&&p.claimValidated===true&&p.claimRequestKey===e.eventKey&&p.claimRecipientId===e.userId,'CLAIM_REQUIRED');
 check(['text','emoji'].includes(p.part),'PART_INVALID');
 check(e.userId!==id(credentials.expectedUserId),'SELF_EXCLUDED');
 const body=e.kind==='welcome'?(p.part==='text'?cfg.welcome:cfg.welcomeEmoji):(p.part==='text'?cfg.left:cfg.leftEmoji);
 const group=await bounded(client.getEntity(credentials.allowedGroupUsername));
 check(group?.className==='Channel'&&group.megagroup&&id(utils.getPeerId(group))===cfg.groupId&&(group.creator||group.adminRights),'ADMIN_REQUIRED');
 const channel=await bounded(client.getInputEntity(group));
 const peer=await resolvePeer(client,channel,e,bounded);
 let current;
 try{current=(await bounded(client.invoke(new Api.channels.GetParticipant({channel,participant:peer})))).participant;}
 catch(err){if(!/USER_NOT_PARTICIPANT/.test(err.errorMessage||err.message||''))throw Error('NNA_MEMBER_STATUS_UNAVAILABLE');}
 const present=current&&['ChannelParticipant','ChannelParticipantSelf','ChannelParticipantAdmin','ChannelParticipantCreator'].includes(current.className);
 check(e.kind==='welcome'?present:!present,'STATUS_CHANGED');
 if(e.kind==='left')check(!current||current.className==='ChannelParticipantLeft','NO_LONGER_VOLUNTARY_LEFT');
 const rid=randomId(credentials.expectedUserId,e.eventKey,p.part);
 let result;
 try{result=await bounded(client.invoke(new Api.messages.SendMessage({peer,message:body.text,entities:body.entities,noWebpage:true,randomId:rid})));}
 catch(err){
  const code=err.errorMessage||'';
  if(/^(USER_PRIVACY_RESTRICTED|USER_IS_BLOCKED|YOU_BLOCKED_USER|INPUT_USER_DEACTIVATED|CHAT_WRITE_FORBIDDEN|USER_RESTRICTED|PEER_FLOOD|FLOOD_WAIT_\d+|PREMIUM_ACCOUNT_REQUIRED|ALLOW_PAYMENT_REQUIRED)$/.test(code))throw Error('NNA_MEMBER_SEND_REJECTED_'+code);
  throw Error('NNA_MEMBER_DELIVERY_UNCONFIRMED');
 }
 try{
  const updates=result.updates||[],mapping=updates.find(x=>x.className==='UpdateMessageID'&&id(x.randomId)===id(rid));
  const mid=mapping?.id||(result.className==='UpdateShortSentMessage'?result.id:undefined);
  check(safeId(mid),'DELIVERY_UNCONFIRMED');
  const sent=(await bounded(client.getMessages(peer,{ids:[mid]})))[0];
  check(sent?.out===true&&id(sent.peerId?.userId)===e.userId&&sent.message===body.text,'DELIVERY_UNCONFIRMED');
  for(const ent of body.entities)if(ent.className==='MessageEntityCustomEmoji')check(sent.entities?.some(x=>x.className===ent.className&&x.offset===ent.offset&&x.length===ent.length&&id(x.documentId)===id(ent.documentId)),'DELIVERY_UNCONFIRMED');
  return {status:'sent',eventKey:e.eventKey,recipientId:e.userId,kind:e.kind,part:p.part,messageId:mid,senderId:id(credentials.expectedUserId)};
 }catch{throw Error('NNA_MEMBER_DELIVERY_UNCONFIRMED');}
}
module.exports={config,template,event,randomId,logTarget,resolvePeer,sendPart};
