'use strict';
const {Api}=require('teleproto'),{createHash}=require('node:crypto'),{groupPeer}=require('./media-publish');
const need=(ok,code)=>{if(!ok)throw Error('NNA_LIVE_'+code);};
function validateLive(c,p,now=Date.now()){
 const cfg=p.config,d=p.delivery,cb=d?.update?.callback_query;
 need(d?.mode==='live'&&d.claimValidated===true&&d.requestKey===`live:${d.operatorId}:${d.chatId}:${d.topicId}:${d.revision}`,'CLAIM');
 need(cfg?.operatorIds?.includes(d.operatorId)&&Number.isSafeInteger(d.update.update_id)&&cb?.from?.is_bot===false&&String(cb.from.id)===d.operatorId&&cb.data===`lv:${d.operatorId}:${d.revision}:publish`,'APPROVAL');
 need(cb.message?.from?.is_bot===true&&String(cb.message.from.id)===cfg.botId&&String(cb.message.chat?.id)===d.chatId,'APPROVAL_CHAT');
 need(cb.message.chat.type==='private'&&d.chatId===d.operatorId||cb.message.chat.type==='supergroup'&&d.chatId===cfg.reviewGroupId&&Number(cb.message.message_thread_id||0)===d.topicId,'OPERATOR_CHAT');
 const at=Date.parse(d.approvedAt);need(Number.isFinite(at)&&at<=now+30000&&now-at<=600000,'EXPIRED');
 need(cfg.liveTargets?.some(t=>[c.allowedGroupId,cfg.reviewGroupId].includes(t.groupId)&&t.groupId===d.targetGroupId),'DESTINATION');
 need(typeof d.title==='string'&&d.title===d.title.trim()&&d.title.length>0&&d.title.length<=128&&!/[\u0000-\u001f\u007f]/.test(d.title),'TITLE');
 need(Number.isSafeInteger(d.liveAt)&&d.liveAt*1000>=now+10000&&d.liveAt*1000<=now+8*86400000&&d.rtmp===false,'TIME');
 return d;
}
function liveRandomId(sender,request){return createHash('sha256').update(`nna-live-v1\0${sender}\0${request}`).digest().readInt32BE(0)||1;}
async function scheduleLive(client,c,p,bounded,now=Date.now()){
 const d=validateLive(c,p,now),peer=await groupPeer(client,d.targetGroupId,bounded);
 const rights=await bounded(client.invoke(new Api.channels.GetParticipant({channel:peer,participant:new Api.InputPeerSelf()})));
 need(rights.participant?.className==='ChannelParticipantCreator'||rights.participant?.adminRights?.manageCall===true,'ADMIN_REQUIRED');
 const before=await bounded(client.invoke(new Api.channels.GetFullChannel({channel:peer})));need(!before.fullChat?.call,'ALREADY_EXISTS');
 let result;
 try{result=await bounded(client.invoke(new Api.phone.CreateGroupCall({peer,title:d.title,scheduleDate:d.liveAt,randomId:liveRandomId(c.expectedUserId,d.requestKey),rtmpStream:false})));}catch{throw Error('NNA_LIVE_DELIVERY_UNCONFIRMED');}
 try{
  const created=result.updates?.map(x=>x.call).find(x=>x?.className==='GroupCall'&&x.title===d.title&&x.scheduleDate===d.liveAt);need(created,'DELIVERY_UNCONFIRMED');
  const full=await bounded(client.invoke(new Api.channels.GetFullChannel({channel:peer})));need(String(full.fullChat?.call?.id)===String(created.id),'DELIVERY_UNCONFIRMED');
  const info=await bounded(client.invoke(new Api.phone.GetGroupCall({call:full.fullChat.call,limit:1}))),call=info.call;
  need(call?.className==='GroupCall'&&String(call.id)===String(created.id)&&call.title===d.title&&call.scheduleDate===d.liveAt&&!call.rtmpStream,'DELIVERY_UNCONFIRMED');
  return {status:'live_scheduled',mode:'live',requestKey:d.requestKey,senderId:String(c.expectedUserId),targetGroupId:d.targetGroupId,callId:String(call.id),title:d.title,liveAt:d.liveAt,autoStart:false};
 }catch{throw Error('NNA_LIVE_DELIVERY_UNCONFIRMED');}
}
module.exports={validateLive,liveRandomId,scheduleLive};
