'use strict';
const {Api,utils}=require('teleproto'),bigInt=require('big-integer'),{createHash}=require('node:crypto');
const check=(ok,code)=>{if(!ok)throw Error('NNA_MEDIA_'+code);};
const sid=v=>String(v??''),int=v=>Number.isSafeInteger(v)&&v>0;
function caption(text,raw){
 check(typeof text==='string'&&text.length>0&&text.length<=4096&&Array.isArray(raw)&&raw.length<=200,'CAPTION_INVALID');
 const map={bold:'MessageEntityBold',italic:'MessageEntityItalic',underline:'MessageEntityUnderline',strikethrough:'MessageEntityStrike',spoiler:'MessageEntitySpoiler',code:'MessageEntityCode',pre:'MessageEntityPre',blockquote:'MessageEntityBlockquote',expandable_blockquote:'MessageEntityBlockquote',text_link:'MessageEntityTextUrl',custom_emoji:'MessageEntityCustomEmoji',url:'MessageEntityUrl',mention:'MessageEntityMention',hashtag:'MessageEntityHashtag',email:'MessageEntityEmail',phone_number:'MessageEntityPhone',bot_command:'MessageEntityBotCommand',cashtag:'MessageEntityCashtag'};
 return raw.map(e=>{check(map[e.type]&&Number.isInteger(e.offset)&&e.offset>=0&&int(e.length)&&e.offset+e.length<=text.length,'ENTITY_INVALID');const p={offset:e.offset,length:e.length};
 if(e.type==='custom_emoji'){check(/^[1-9]\d{0,19}$/.test(e.custom_emoji_id||''),'EMOJI_INVALID');p.documentId=bigInt(e.custom_emoji_id);}
 if(e.type==='text_link'){check(typeof e.url==='string'&&/^https?:\/\//.test(e.url),'LINK_INVALID');p.url=e.url;}
 if(e.type==='pre')p.language=String(e.language||'');if(e.type==='expandable_blockquote')p.collapsed=true;
 return new Api[map[e.type]](p);});
}
function validate(c,p,now=Date.now()){
 const cfg=p.config,d=p.delivery,u=d?.update,cb=u?.callback_query;
 check(cfg&&/^\-100[1-9]\d+$/.test(cfg.reviewGroupId||'')&&int(cfg.reviewTopicId)&&/^[1-9]\d+$/.test(cfg.botId||'')&&Array.isArray(cfg.operatorIds)&&cfg.operatorIds.every(x=>/^[1-9]\d+$/.test(x)),'CONFIG_INVALID');
 check(Array.isArray(cfg.targets)&&cfg.targets.length>0&&cfg.targets.every(t=>[c.allowedGroupId,cfg.reviewGroupId].includes(t.groupId)&&int(t.topicId)),'TARGET_CONFIG_INVALID');
 check(d&&d.claimValidated===true&&typeof d.requestKey==='string'&&d.requestKey===`media:${d.operatorId}:${d.chatId}:${d.topicId}:${d.revision}`,'CLAIM_REQUIRED');
 check(cfg.operatorIds.includes(d.operatorId)&&Number.isSafeInteger(u?.update_id)&&cb?.from?.is_bot===false&&sid(cb.from.id)===d.operatorId&&cb.data===`mp:${d.operatorId}:${d.revision}:publish`,'APPROVAL_REQUIRED');
 check(sid(cb.message?.from?.id)===cfg.botId&&cb.message.from.is_bot===true&&sid(cb.message.chat?.id)===d.chatId,'APPROVAL_CHAT_INVALID');
 check(cb.message.chat.type==='private'&&d.chatId===d.operatorId||cb.message.chat.type==='supergroup'&&d.chatId===cfg.reviewGroupId&&Number(cb.message.message_thread_id||0)===d.topicId,'OPERATOR_CHAT_INVALID');
 const at=Date.parse(d.approvedAt);check(Number.isFinite(at)&&at<=now+30000&&now-at<=600000,'APPROVAL_EXPIRED');
 check(cfg.targets.some(t=>t.groupId===d.targetGroupId&&t.topicId===d.targetTopicId),'DESTINATION_NOT_ALLOWED');
 check(int(d.sourceMessageId)&&['photo','video'].includes(d.kind),'SOURCE_INVALID');
 check(d.scheduleAt===0||Number.isSafeInteger(d.scheduleAt)&&d.scheduleAt*1000>=now+120000&&d.scheduleAt*1000<=now+366*86400000,'SCHEDULE_INVALID');
 return {cfg,d,entities:caption(d.captionText,d.captionEntities)};
}
function randomId(sender,key){const h=createHash('sha256').update('nna-media-v1\0'+sender+'\0'+key).digest();return bigInt((h.readBigInt64BE(0)||1n).toString());}
async function groupPeer(client,groupId,bounded){
 let g;try{g=await bounded(client.getEntity(bigInt(groupId)));}catch{g=(await bounded(client.getDialogs({limit:500}))).map(x=>x.entity).find(x=>x?.className==='Channel'&&sid(utils.getPeerId(x))===groupId);}
 check(g?.className==='Channel'&&g.megagroup&&g.forum&&!g.left&&!g.kicked&&sid(utils.getPeerId(g))===groupId,'GROUP_UNAVAILABLE');return await bounded(client.getInputEntity(g));
}
function entityMatches(actual,e){return actual?.some(a=>a.className===e.className&&a.offset===e.offset&&a.length===e.length&&(e.className!=='MessageEntityCustomEmoji'||sid(a.documentId)===sid(e.documentId))&&(e.className!=='MessageEntityTextUrl'||a.url===e.url)&&(e.className!=='MessageEntityBlockquote'||Boolean(a.collapsed)===Boolean(e.collapsed)));}
async function publish(client,c,p,bounded,now=Date.now()){
 const {cfg,d,entities}=validate(c,p,now);
 if(d.captionText.length>1024){
  const me=await bounded(client.getMe());check(me.premium===true,'PREMIUM_CAPTION_REQUIRED');
  const app=await bounded(client.invoke(new Api.help.GetAppConfig({hash:0})));
  const limit=app.config?.value?.find(x=>x.key==='caption_length_limit_premium')?.value?.value;
  check(Number.isInteger(limit)&&limit>=d.captionText.length,'ACCOUNT_CAPTION_LIMIT');
 }
 const sourcePeer=await groupPeer(client,cfg.reviewGroupId,bounded);
 const [source]=await bounded(client.getMessages(sourcePeer,{ids:[d.sourceMessageId]}));
 check(source?.className==='Message'&&sid(utils.getPeerId(source.peerId))===cfg.reviewGroupId&&sid(source.fromId?.userId)===cfg.botId&&source.message==='NNA_MEDIA_STAGE:'+d.requestKey&&Number(source.replyTo?.replyToTopId||source.replyTo?.replyToMsgId)===cfg.reviewTopicId&&!source.groupedId,'STAGE_UNVERIFIED');
 const original=d.kind==='photo'?source.media?.photo:source.media?.document;
 check(original&&int(Number(source.id))&&(d.kind==='photo'?source.media.className==='MessageMediaPhoto':original.mimeType==='video/mp4'),'MEDIA_INVALID');
 const targetPeer=d.targetGroupId===cfg.reviewGroupId?sourcePeer:await groupPeer(client,d.targetGroupId,bounded);
 const topics=await bounded(client.invoke(new Api.messages.GetForumTopicsByID({peer:targetPeer,topics:[d.targetTopicId]})));
 const topic=topics.topics?.find(t=>t.className==='ForumTopic'&&t.id===d.targetTopicId);
 check(topic,'TOPIC_UNAVAILABLE');
 if(topic.closed){
  const self=await bounded(client.invoke(new Api.channels.GetParticipant({channel:targetPeer,participant:new Api.InputPeerSelf()})));
  check(self.participant?.className==='ChannelParticipantCreator'||self.participant?.className==='ChannelParticipantAdmin'&&self.participant.adminRights?.manageTopics===true,'CLOSED_TOPIC_PERMISSION_REQUIRED');
 }
 if(d.scheduleAt)check(d.scheduleAt*1000>=Date.now()+120000,'SCHEDULE_TOO_NEAR');
 const rid=randomId(c.expectedUserId,d.requestKey),media=utils.getInputMedia(source.media);
 let result;
 try{result=await bounded(client.invoke(new Api.messages.SendMedia({peer:targetPeer,media,message:d.captionText,entities,randomId:rid,sendAs:new Api.InputPeerSelf(),replyTo:new Api.InputReplyToMessage({replyToMsgId:d.targetTopicId,topMsgId:d.targetTopicId}),...(d.scheduleAt?{scheduleDate:d.scheduleAt}:{})})));}
 catch{throw Error('NNA_MEDIA_DELIVERY_UNCONFIRMED');}
 try{
  const updates=result.updates||[];
  let message;
  if(d.scheduleAt)message=updates.find(x=>x.className==='UpdateNewScheduledMessage')?.message;
  else{
   const mid=updates.find(x=>x.className==='UpdateMessageID'&&sid(x.randomId)===sid(rid))?.id||(result.className==='UpdateShortSentMessage'?result.id:0);
   message=updates.map(x=>x.message).find(m=>m?.id===mid);if(!message&&int(mid))message=(await bounded(client.getMessages(targetPeer,{ids:[mid]})))[0];
  }
  check(message?.className==='Message'&&int(message.id)&&message.out&&sid(message.fromId?.userId)===sid(c.expectedUserId)&&sid(utils.getPeerId(message.peerId))===d.targetGroupId&&message.message===d.captionText&&Number(message.replyTo?.replyToTopId||message.replyTo?.replyToMsgId)===d.targetTopicId,'DELIVERY_UNCONFIRMED');
  check(!d.scheduleAt||message.date===d.scheduleAt,'SCHEDULE_UNCONFIRMED');
  const sentMedia=d.kind==='photo'?message.media?.photo:message.media?.document;check(sid(sentMedia?.id)===sid(original.id),'MEDIA_UNCONFIRMED');
  check(entities.every(e=>entityMatches(message.entities,e)),'ENTITIES_UNCONFIRMED');
  return {status:d.scheduleAt?'scheduled':'sent',requestKey:d.requestKey,senderId:sid(c.expectedUserId),targetGroupId:d.targetGroupId,targetTopicId:d.targetTopicId,scheduleAt:d.scheduleAt,...(d.scheduleAt?{scheduledMessageId:message.id}:{sentMessageId:message.id})};
 }catch{throw Error('NNA_MEDIA_DELIVERY_UNCONFIRMED');}
}
module.exports={caption,validate,randomId,groupPeer,entityMatches,publish};
