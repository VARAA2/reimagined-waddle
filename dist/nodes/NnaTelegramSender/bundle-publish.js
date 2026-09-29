'use strict';
const {Api,utils}=require('teleproto'),mp=require('./media-publish'),{fillLink,checkPart}=require('./bundle-content');
const check=(ok,code)=>{if(!ok)throw Error('NNA_BUNDLE_'+code);};
const sid=x=>String(x??''),link=(g,t,m)=>`https://t.me/c/${g.slice(4)}/${t}/${m}`;
function validateBundle(c,p,now=Date.now()){
 const d=p.delivery,cfg=p.config;check(d?.mode==='bundle','MODE');
 check(Array.isArray(cfg?.bundlePairs)&&cfg.bundlePairs.some(x=>x.groupId===d.targetGroupId&&x.mediaTopicId===d.targetTopicId&&x.articleTopicId===d.articleTopicId),'PAIR_NOT_ALLOWED');
 const at=Date.parse(d.approvedAt),due=d.scheduleAt?d.scheduleAt*1000:at;
 check(Number.isFinite(at)&&at<=now+30000&&due>=at-30000&&due<=at+366*86400000&&now>=due-3000&&now-due<=600000,'APPROVAL_OR_SCHEDULE');
 checkPart(d.mediaPart);checkPart(d.articlePart);
 mp.caption(d.mediaPart.text,d.mediaPart.entities);mp.caption(d.articlePart.text,d.articlePart.entities);
 // Reuse every existing operator, callback, source, destination and claim guard.
 mp.validate(c,{config:cfg,delivery:{...d,approvedAt:new Date(now).toISOString(),scheduleAt:0,captionText:d.mediaPart.text,captionEntities:d.mediaPart.entities}},now);
 return d;
}
async function permittedTopic(client,peer,topicId,bounded){
 const r=await bounded(client.invoke(new Api.messages.GetForumTopicsByID({peer,topics:[topicId]})));
 const t=r.topics?.find(x=>x.className==='ForumTopic'&&x.id===topicId);check(t,'TOPIC_UNAVAILABLE');
 if(t.closed){const r=await bounded(client.invoke(new Api.channels.GetParticipant({channel:peer,participant:new Api.InputPeerSelf()})));check(r.participant?.className==='ChannelParticipantCreator'||r.participant?.adminRights?.manageTopics===true,'TOPIC_PERMISSION');}
}
async function publishBundle(client,c,p,bounded,now=Date.now()){
 const d=validateBundle(c,p,now),cfg=p.config;
 const outcome={status:'unconfirmed',mode:'bundle',requestKey:d.requestKey,senderId:sid(c.expectedUserId),targetGroupId:d.targetGroupId,targetTopicId:d.targetTopicId,articleTopicId:d.articleTopicId,scheduleAt:d.scheduleAt,articleMessageId:null,sentMessageId:null,phase:'preflight'};
 try{
  const peer=await mp.groupPeer(client,d.targetGroupId,bounded);
  await permittedTopic(client,peer,d.targetTopicId,bounded);await permittedTopic(client,peer,d.articleTopicId,bounded);
  if(d.mediaPart.text.length-d.mediaPart.linkLength+90>1024){const me=await bounded(client.getMe());check(me.premium,'PREMIUM_CAPTION_REQUIRED');const cfg=await bounded(client.invoke(new Api.help.GetAppConfig({hash:0})));check(cfg.config?.value?.find(x=>x.key==='caption_length_limit_premium')?.value?.value>=d.mediaPart.text.length-d.mediaPart.linkLength+90,'CAPTION_LIMIT');}
  const sourcePeer=await mp.groupPeer(client,cfg.reviewGroupId,bounded),[source]=await bounded(client.getMessages(sourcePeer,{ids:[d.sourceMessageId]}));
  check(source?.className==='Message'&&sid(source.fromId?.userId)===cfg.botId&&source.message==='NNA_MEDIA_STAGE:'+d.requestKey&&Number(source.replyTo?.replyToTopId||source.replyTo?.replyToMsgId)===cfg.reviewTopicId&&!source.groupedId,'SOURCE_UNVERIFIED');
  check(d.kind==='photo'?source.media?.photo:source.media?.document?.mimeType==='video/mp4','SOURCE_MEDIA');
  // Publish article first. Its temporary link line is replaced after media succeeds.
  const a=d.articlePart,placeholder='⏳ Media link இணைக்கப்படுகிறது…',delta=placeholder.length-a.linkLength;
  const initial={text:a.text.slice(0,a.linkOffset)+placeholder+a.text.slice(a.linkOffset+a.linkLength),entities:a.entities.map(e=>({...e,offset:e.offset>=a.linkOffset+a.linkLength?e.offset+delta:e.offset}))};
  const entities=mp.caption(initial.text,initial.entities),rid=mp.randomId(c.expectedUserId,d.requestKey+':article');
  outcome.phase='article';
  const result=await bounded(client.invoke(new Api.messages.SendMessage({peer,message:initial.text,entities,noWebpage:true,randomId:rid,sendAs:new Api.InputPeerSelf(),replyTo:new Api.InputReplyToMessage({replyToMsgId:d.articleTopicId,topMsgId:d.articleTopicId})})));
  const mid=result.updates?.find(x=>x.className==='UpdateMessageID'&&sid(x.randomId)===sid(rid))?.id||(result.className==='UpdateShortSentMessage'?result.id:0);
  check(Number.isSafeInteger(mid)&&mid>0,'ARTICLE_UNCONFIRMED');outcome.articleMessageId=mid;outcome.articleUrl=link(d.targetGroupId,d.articleTopicId,mid);
  let [posted]=await bounded(client.getMessages(peer,{ids:[mid]}));
  const verified=(m,text,es)=>m?.className==='Message'&&m.out&&sid(m.fromId?.userId)===sid(c.expectedUserId)&&sid(utils.getPeerId(m.peerId))===d.targetGroupId&&Number(m.replyTo?.replyToTopId||m.replyTo?.replyToMsgId)===d.articleTopicId&&m.message===text&&es.every(e=>mp.entityMatches(m.entities,e));
  check(verified(posted,initial.text,entities),'ARTICLE_UNCONFIRMED');
  const media=fillLink(d.mediaPart,outcome.articleUrl);outcome.phase='media';
  const mr=await mp.publish(client,c,{config:cfg,delivery:{...d,approvedAt:new Date().toISOString(),scheduleAt:0,captionText:media.text,captionEntities:media.entities}},bounded);
  outcome.sentMessageId=mr.sentMessageId;outcome.mediaUrl=link(d.targetGroupId,d.targetTopicId,mr.sentMessageId);
  const final=fillLink(d.articlePart,outcome.mediaUrl),finalEntities=mp.caption(final.text,final.entities);outcome.phase='backlink';
  await bounded(client.invoke(new Api.messages.EditMessage({peer,id:mid,message:final.text,entities:finalEntities,noWebpage:true})));
  [posted]=await bounded(client.getMessages(peer,{ids:[mid]}));check(verified(posted,final.text,finalEntities),'BACKLINK_UNCONFIRMED');
  return {...outcome,status:'sent',phase:'complete'};
 }catch(e){return {...outcome,status:outcome.articleMessageId?'partial':'unconfirmed',error:/^NNA_(BUNDLE|MEDIA)_[A-Z_]+$/.test(e.message)?e.message:'NNA_BUNDLE_DELIVERY_UNCONFIRMED'};}
}
module.exports={validateBundle,publishBundle};
