'use strict';
// Operator albums and audio for a separate private bot flow. Single photo/video drafts keep
// their original path. Albums are collected race-free in the persistent store, previewed by the
// bot, then published by the fixed personal account after the claimed approval.
const {Api,utils}=require('teleproto');
const crypto=require('node:crypto');
const media=require('../NnaTelegramSender/media-publish');
const {createClient,validateCredentials}=require('../NnaTelegramSender/sender');
const {Store,jobKey}=require('./store');
const {fillLink,checkPart}=require('../NnaTelegramSender/bundle-content');
const OPERATIONS=['collectOperatorAlbum','previewOperatorMedia','publishOperatorMedia'];
const QUIET_MS=4000,MAX_COLLECT_MS=30000,MAX_ITEMS=10;
const check=(ok,code)=>{if(!ok)throw Error('NNA_SET_'+code);};
const sid=x=>String(x??'');
const int=x=>Number.isSafeInteger(x)&&x>0;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const bounded=async(p,ms=25000)=>{let timer;try{return await Promise.race([p,new Promise((_,r)=>timer=setTimeout(()=>r(Error('NNA_SET_TIMEOUT')),ms))]);}finally{clearTimeout(timer);}};
const METHOD={photo:'sendPhoto',video:'sendVideo',audio:'sendAudio',voice:'sendVoice'};
const LABEL={photo:'படம்',video:'வீடியோ',audio:'audio',voice:'voice'};
function scopeOf(raw){
 const s=typeof raw==='string'?JSON.parse(raw):raw;
 check(s&&/^[1-9]\d+$/.test(s.botId||'')&&Array.isArray(s.operatorIds)&&s.operatorIds.length>0&&s.operatorIds.every(x=>/^[1-9]\d+$/.test(x)),'SCOPE');
 return s;
}
function item(m){
 const p=m.photo?.at(-1),v=m.video,a=m.audio,vo=m.voice,f=p||v||a||vo;
 check(f&&typeof f.file_id==='string'&&typeof f.file_unique_id==='string'&&int(m.message_id),'MEDIA_REQUIRED');
 const caption=typeof m.caption==='string'?m.caption:'';check(caption.length<=4096,'CAPTION_LENGTH');
 return {kind:p?'photo':v?'video':a?'audio':'voice',fileId:f.file_id,uniqueId:f.file_unique_id,messageId:m.message_id,caption,entities:caption&&Array.isArray(m.caption_entities)?m.caption_entities:[],hasSpoiler:!!m.has_media_spoiler,size:Number(f.file_size||0),duration:Number(f.duration||0)};
}
// Telegram albums mix photos and videos, or contain only audio files. Voice notes are never grouped.
function composition(items){
 check(Array.isArray(items)&&items.length>=1&&items.length<=MAX_ITEMS,'COUNT');
 check(items.every(x=>METHOD[x?.kind]&&typeof x.fileId==='string'&&typeof x.uniqueId==='string'&&int(x.messageId)),'ITEM');
 check(new Set(items.map(x=>x.messageId)).size===items.length,'DUPLICATE_ITEM');
 if(items.length===1)return items[0].kind;
 const kinds=new Set(items.map(x=>x.kind));
 check(!kinds.has('voice'),'VOICE_ALBUM');
 check([...kinds].every(k=>k==='photo'||k==='video')||[...kinds].every(k=>k==='audio'),'MIXED_ALBUM');
 return kinds.has('audio')?'audio_album':'visual_album';
}
function summary(items){
 const counts={};for(const x of items)counts[x.kind]=(counts[x.kind]||0)+1;
 return Object.entries(counts).map(([k,n])=>n+' '+LABEL[k]).join(' + ');
}
async function collect(scope,context,deps={}){
 const u=context?.event,m=u?.message;
 if(!m?.media_group_id||u.callback_query)return context;
 if(!/^[A-Za-z0-9_-]{1,100}$/.test(sid(m.media_group_id)))return {...context,operatorAlbum:{role:'invalid'}};
 const store=new Store(scope.botId,deps.root),clock=deps.now||Date.now,wait=deps.wait||sleep;
 const key='opalbum_'+jobKey(scope.botId,context.operatorId,[context.chatId,context.topicId,m.media_group_id].join(':'));
 let entry;try{entry=item(m);}catch{entry={unsupported:true,messageId:m.message_id};}
 let role;
 store.change(key,old=>{
  if(old?.closed){role='late';return undefined;}
  if(old?.items?.some(x=>x.messageId===m.message_id)){role='duplicate';return undefined;}
  role=old?'follower':'leader';
  return {operatorId:context.operatorId,chatId:context.chatId,topicId:context.topicId,albumId:sid(m.media_group_id),createdAt:old?.createdAt||clock(),lastAt:clock(),closed:false,items:[...(old?.items||[]),entry].sort((a,b)=>a.messageId-b.messageId)};
 });
 if(role!=='leader')return {...context,operatorAlbum:{role}};
 // The first arrival waits until the album has been quiet, then closes it for every later update.
 const start=clock();let d=store.read(key);
 while(clock()-d.lastAt<QUIET_MS&&clock()-start<MAX_COLLECT_MS){await wait(Math.min(500,QUIET_MS-(clock()-d.lastAt)));d=store.read(key);}
 d=store.change(key,x=>({...x,closed:true,closedAt:clock()}));
 let error=d.items.some(x=>x.unsupported)?'UNSUPPORTED':null;
 if(!error)try{composition(d.items);}catch(e){error=e.message.replace(/^NNA_SET_/,'');}
 return {...context,operatorAlbum:{role:'leader',albumId:d.albumId,count:d.items.length,items:error?[]:d.items,error}};
}
function botCaller(ctx,b){
 check(typeof b?.accessToken==='string'&&/^\d+:[A-Za-z0-9_-]+$/.test(b.accessToken),'BOT_TOKEN');
 return async(method,body)=>{
  let r;try{r=await ctx.helpers.httpRequest({method:'POST',url:'https://api.telegram.org/bot'+b.accessToken+'/'+method,body,json:true,timeout:30000});}catch{throw Error('NNA_SET_BOT_'+method.toUpperCase()+'_FAILED');}
  check(r?.ok,'BOT_'+method.toUpperCase()+'_FAILED');return r.result;
 };
}
const sentFile=(r,kind)=>kind==='photo'?r?.photo?.at(-1):r?.[kind];
function inlineButtons(buttons){
 check(Array.isArray(buttons)&&buttons.length>0&&buttons.every(x=>typeof x?.label==='string'&&typeof x.data==='string'&&Buffer.byteLength(x.data)<=64),'BUTTONS');
 return {inline_keyboard:buttons.map(x=>[{text:x.label,callback_data:x.data}])};
}
async function preview(bot,scope,p){
 check(scope.operatorIds.includes(sid(p?.operatorId))&&typeof p.chatId==='string'&&typeof p.text==='string'&&p.text.length>0&&p.text.length<=4096&&Array.isArray(p.entities),'PREVIEW_INPUT');
 const items=p.items,kind=composition(items),thread=Number(p.topicId)?{message_thread_id:Number(p.topicId)}:{};
 const header=(items.length>1?'🖼 Album preview — '+items.length+' media ('+summary(items)+').':'🎵 '+LABEL[kind]+' preview.')+' முழு caption அடுத்த message-ல் உள்ளது. Group-ல் '+(items.length>1?'ஒரே album-ஆக':'அதே media + caption-ஆக')+' @'+(scope.senderUsername||'personal_account')+' வழியாகப் பதிவிடப்படும்.';
 let first;
 if(items.length===1){
  const x=items[0],r=await bot(METHOD[x.kind],{chat_id:p.chatId,[x.kind]:x.fileId,caption:header,...thread,disable_notification:true});
  check(sid(r?.chat?.id)===p.chatId&&sid(r.from?.id)===scope.botId&&sentFile(r,x.kind)?.file_unique_id===x.uniqueId,'PREVIEW_MISMATCH');first=r.message_id;
 }else{
  const r=await bot('sendMediaGroup',{chat_id:p.chatId,media:items.map((x,i)=>({type:x.kind,media:x.fileId,...(i===0?{caption:header}:{}),...(x.hasSpoiler?{has_spoiler:true}:{})})),...thread,disable_notification:true});
  check(Array.isArray(r)&&r.length===items.length&&r.every((m,i)=>sid(m.chat?.id)===p.chatId&&sid(m.from?.id)===scope.botId&&sentFile(m,items[i].kind)?.file_unique_id===items[i].uniqueId)&&new Set(r.map(m=>sid(m.media_group_id))).size===1,'PREVIEW_MISMATCH');first=r[0].message_id;
 }
 // A Media + Article bundle carries its approval buttons on the article preview that follows.
 const bundle=p.mode==='bundle';
 const t=await bot('sendMessage',{chat_id:p.chatId,text:p.text,entities:p.entities,...thread,reply_to_message_id:first,allow_sending_without_reply:true,link_preview_options:{is_disabled:true},...(bundle?{}:{reply_markup:inlineButtons(p.buttons)})});
 check(sid(t?.chat?.id)===p.chatId&&sid(t.from?.id)===scope.botId&&t.text===p.text,'CAPTION_PREVIEW_MISMATCH');
 const keys=(t.reply_markup?.inline_keyboard||[]).flat().map(x=>x.callback_data);check(bundle?keys.length===0:p.buttons.every(x=>keys.includes(x.data)),'PREVIEW_BUTTON_MISSING');
 return {...p,previewMessageId:first,captionPreviewMessageId:t.message_id,longCaption:false};
}
// The claimed delivery mirrors the single-media contract, with an ordered item list instead of one file.
function approval(c,cfg,d,mode){
 const u=d?.update,cb=u?.callback_query;
 check(cfg&&/^-100[1-9]\d+$/.test(cfg.reviewGroupId||'')&&/^[a-z][a-z0-9_]{4,31}$/i.test(cfg.botUsername||'')&&Array.isArray(cfg.targets)&&cfg.targets.length>0&&cfg.targets.every(t=>[c.allowedGroupId,cfg.reviewGroupId].includes(t.groupId)&&int(t.topicId)),'CONFIG');
 check(d&&d.mode===mode&&d.claimValidated===true&&typeof d.requestKey==='string'&&d.requestKey===`media:${d.operatorId}:${d.chatId}:${d.topicId}:${d.revision}`,'CLAIM_REQUIRED');
 check(cfg.operatorIds.includes(d.operatorId)&&Number.isSafeInteger(u?.update_id)&&cb?.from?.is_bot===false&&sid(cb.from.id)===d.operatorId&&cb.data===`mp:${d.operatorId}:${d.revision}:publish`,'APPROVAL_REQUIRED');
 check(sid(cb.message?.from?.id)===cfg.botId&&cb.message.from.is_bot===true&&sid(cb.message.chat?.id)===d.chatId,'APPROVAL_CHAT');
 check(cb.message.chat.type==='private'&&d.chatId===d.operatorId||cb.message.chat.type==='supergroup'&&d.chatId===cfg.reviewGroupId&&Number(cb.message.message_thread_id||0)===Number(d.topicId),'OPERATOR_CHAT');
 check(cfg.targets.some(t=>t.groupId===d.targetGroupId&&t.topicId===d.targetTopicId),'DESTINATION');
 composition(d.items);
 check(Number.isInteger(d.captionIndex)&&d.captionIndex>=0&&d.captionIndex<d.items.length,'CAPTION_INDEX');
}
const ownCaption=x=>({text:x.caption||'',entities:x.caption?media.caption(x.caption,x.entities.filter(supported)):[]});
function validate(c,cfg,d,now=Date.now()){
 approval(c,cfg,d,'set');
 const at=Date.parse(d.approvedAt);check(Number.isFinite(at)&&at<=now+30000&&now-at<=600000,'APPROVAL_EXPIRED');
 check(d.scheduleAt===0||Number.isSafeInteger(d.scheduleAt)&&d.scheduleAt*1000>=now+120000&&d.scheduleAt*1000<=now+366*86400000,'SCHEDULE');
 const captions=d.items.map((x,i)=>i===d.captionIndex?{text:d.captionText,entities:media.caption(d.captionText,d.captionEntities)}:ownCaption(x));
 return {captions};
}
// Media + Article with an album: same pair, timing and link-slot rules as the single-media bundle.
function validateBundle(c,cfg,d,now=Date.now()){
 approval(c,cfg,d,'bundle');
 check(d.items.every(x=>x.kind==='photo'||x.kind==='video'),'BUNDLE_MEDIA');
 check(Array.isArray(cfg.bundlePairs)&&cfg.bundlePairs.some(x=>x.groupId===d.targetGroupId&&x.mediaTopicId===d.targetTopicId&&x.articleTopicId===d.articleTopicId),'PAIR_NOT_ALLOWED');
 const at=Date.parse(d.approvedAt),due=d.scheduleAt?d.scheduleAt*1000:at;
 check(Number.isFinite(at)&&at<=now+30000&&due>=at-30000&&due<=at+366*86400000&&now>=due-3000&&now-due<=600000,'APPROVAL_OR_SCHEDULE');
 checkPart(d.mediaPart);checkPart(d.articlePart);
 media.caption(d.mediaPart.text,d.mediaPart.entities);media.caption(d.articlePart.text,d.articlePart.entities);
 return {captions:d.items.map(ownCaption)};
}
const SUPPORTED=['bold','italic','underline','strikethrough','spoiler','code','pre','blockquote','expandable_blockquote','text_link','custom_emoji','url','mention','hashtag','email','phone_number','bot_command','cashtag'];
const supported=e=>SUPPORTED.includes(e?.type);
async function personal(c,deps,fn){
 validateCredentials(c);let client;
 try{client=await (deps.createClient||createClient)(c);await bounded(client.connect());const me=await bounded(client.getMe());check(!me.bot&&sid(me.id)===sid(c.expectedUserId),'WRONG_SENDER');return await fn(client,me);}
 finally{if(client)await bounded(client.destroy(),10000).catch(()=>{});}
}
async function stage(bot,client,c,cfg,d,index){
 const x=d.items[index],marker='NNA_SET_STAGE:'+crypto.createHash('sha256').update(d.requestKey).digest('hex').slice(0,16)+':'+index;
 const r=await bot(METHOD[x.kind],{chat_id:sid(c.expectedUserId),[x.kind]:x.fileId,caption:marker,disable_notification:true});
 const stageId=r?.message_id;
 check(sentFile(r,x.kind)?.file_unique_id===x.uniqueId,'STAGE_MISMATCH');
 const peer=await bounded(client.getInputEntity(cfg.botUsername));check(sid(peer.userId)===cfg.botId,'STAGE_BOT');
 let source;
 for(let i=0;i<3&&!source;i++){const ms=await bounded(client.getMessages(peer,{limit:50}));source=ms.find(m=>m.className==='Message'&&!m.out&&m.message===marker&&sid(m.senderId||m.fromId?.userId||m.peerId?.userId)===cfg.botId);}
 check(source?.media&&(source.media.photo||source.media.document),'STAGE_UNAVAILABLE');
 return {source,stageId};
}
async function captionLimit(client,me,captions){
 const longest=Math.max(...captions.map(x=>x.text.length));
 if(longest>1024){check(me.premium===true,'PREMIUM_CAPTION_REQUIRED');const app=await bounded(client.invoke(new Api.help.GetAppConfig({hash:0})));const limit=app.config?.value?.find(x=>x.key==='caption_length_limit_premium')?.value?.value;check(Number.isInteger(limit)&&limit>=longest,'ACCOUNT_CAPTION_LIMIT');}
}
async function openTopic(client,peer,topicId){
 const topics=await bounded(client.invoke(new Api.messages.GetForumTopicsByID({peer,topics:[topicId]})));
 const topic=topics.topics?.find(t=>t.className==='ForumTopic'&&t.id===topicId);check(topic,'TOPIC_UNAVAILABLE');
 if(topic.closed){const self=await bounded(client.invoke(new Api.channels.GetParticipant({channel:peer,participant:new Api.InputPeerSelf()})));check(self.participant?.className==='ChannelParticipantCreator'||self.participant?.className==='ChannelParticipantAdmin'&&self.participant.adminRights?.manageTopics===true,'CLOSED_TOPIC_PERMISSION_REQUIRED');}
}
// One SendMedia/SendMultiMedia write, then readback of sender, topic, captions, formatting, media and grouping.
async function sendItems(client,c,d,peer,stages,captions,scheduleAt,state){
 const replyTo=new Api.InputReplyToMessage({replyToMsgId:d.targetTopicId,topMsgId:d.targetTopicId}),schedule=scheduleAt?{scheduleDate:scheduleAt}:{};
 const parts=d.items.map((x,i)=>{const input=utils.getInputMedia(stages[i].source.media);if(x.hasSpoiler&&'spoiler' in input)input.spoiler=true;return {input,rid:media.randomId(c.expectedUserId,d.requestKey+':'+i),original:stages[i].source.media.photo||stages[i].source.media.document};});
 state.started=true;
 let result;
 try{
  result=d.items.length===1
   ?await bounded(client.invoke(new Api.messages.SendMedia({peer,media:parts[0].input,message:captions[0].text,entities:captions[0].entities,randomId:parts[0].rid,sendAs:new Api.InputPeerSelf(),replyTo,...schedule})),60000)
   :await bounded(client.invoke(new Api.messages.SendMultiMedia({peer,multiMedia:parts.map((p,i)=>new Api.InputSingleMedia({media:p.input,randomId:p.rid,message:captions[i].text,entities:captions[i].entities})),sendAs:new Api.InputPeerSelf(),replyTo,...schedule})),60000);
 }catch{throw Error('NNA_SET_DELIVERY_UNCONFIRMED');}
 const updates=result.updates||[],mediaId=m=>sid((m?.media?.photo||m?.media?.document)?.id);
 let ids,sent;
 if(scheduleAt){
  const scheduled=updates.filter(x=>x.className==='UpdateNewScheduledMessage').map(x=>x.message);
  sent=parts.map(p=>scheduled.find(m=>mediaId(m)===sid(p.original.id)));ids=sent.map(m=>m?.id);
  check(ids.every(int)&&new Set(ids).size===ids.length,'DELIVERY_UNCONFIRMED');
 }else{
  ids=parts.map(p=>updates.find(x=>x.className==='UpdateMessageID'&&sid(x.randomId)===sid(p.rid))?.id||0);
  check(ids.every(int)&&new Set(ids).size===ids.length,'DELIVERY_UNCONFIRMED');
  const read=await bounded(client.getMessages(peer,{ids}));sent=ids.map(id=>read.find(m=>m?.id===id));
 }
 let grouped;
 sent.forEach((m,i)=>{
  check(m?.className==='Message'&&sid(m.fromId?.userId)===sid(c.expectedUserId)&&sid(utils.getPeerId(m.peerId))===d.targetGroupId&&Number(m.replyTo?.replyToTopId||m.replyTo?.replyToMsgId)===d.targetTopicId&&!m.fwdFrom&&m.message===captions[i].text,'DELIVERY_UNCONFIRMED');
  check(!scheduleAt||m.date===scheduleAt,'SCHEDULE_UNCONFIRMED');
  check(mediaId(m)===sid(parts[i].original.id),'MEDIA_UNCONFIRMED');
  check(captions[i].entities.every(e=>media.entityMatches(m.entities,e)),'ENTITIES_UNCONFIRMED');
  if(d.items.length>1){check(m.groupedId&&(!grouped||grouped===sid(m.groupedId)),'ALBUM_GROUP_UNCONFIRMED');grouped=sid(m.groupedId);}
 });
 state.confirmed=true;
 return ids;
}
async function publish(ctx,c,b,cfg,d,deps={}){
 if(d?.mode==='bundle')return publishBundle(ctx,c,b,cfg,d,deps);
 const bot=deps.bot||botCaller(ctx,b),now=(deps.now||Date.now)();
 const {captions}=validate(c,cfg,d,now);
 const stages=[],state={started:false,confirmed:false};
 try{
  return await personal(c,deps,async(client,me)=>{
   await captionLimit(client,me,captions);
   const peer=await media.groupPeer(client,d.targetGroupId,bounded);
   await openTopic(client,peer,d.targetTopicId);
   for(let i=0;i<d.items.length;i++)stages.push(await stage(bot,client,c,cfg,d,i));
   if(d.scheduleAt)check(d.scheduleAt*1000>=(deps.now||Date.now)()+120000,'SCHEDULE_TOO_NEAR');
   const ids=await sendItems(client,c,d,peer,stages,captions,d.scheduleAt,state);
   return {status:d.scheduleAt?'scheduled':'sent',mode:'set',requestKey:d.requestKey,senderId:sid(c.expectedUserId),targetGroupId:d.targetGroupId,targetTopicId:d.targetTopicId,scheduleAt:d.scheduleAt,count:ids.length,messageIds:ids,...(d.scheduleAt?{scheduledMessageId:ids[0]}:{sentMessageId:ids[0]})};
  });
 }catch(e){
  if(state.started&&!state.confirmed)throw Error('NNA_SET_DELIVERY_UNCONFIRMED');
  throw Error(/^NNA_SET_[A-Z_]+$/.test(e.message)?e.message:'NNA_SET_FAILED');
 }finally{
  // Uncertain sends keep the stage messages as evidence; everything else is cleaned up.
  if(!state.started||state.confirmed)for(const s of stages)await bot('deleteMessage',{chat_id:sid(c.expectedUserId),message_id:s.stageId}).catch(()=>{});
 }
}
// Article first with a placeholder, then the album carrying the article link, then the article backlink edit.
// Returns the single-media bundle outcome shape; a started bundle is never retried.
async function publishBundle(ctx,c,b,cfg,d,deps={}){
 const bot=deps.bot||botCaller(ctx,b),now=(deps.now||Date.now)();
 const {captions}=validateBundle(c,cfg,d,now);
 const outcome={status:'unconfirmed',mode:'bundle',requestKey:d.requestKey,senderId:sid(c.expectedUserId),targetGroupId:d.targetGroupId,targetTopicId:d.targetTopicId,articleTopicId:d.articleTopicId,scheduleAt:d.scheduleAt,articleMessageId:null,sentMessageId:null,count:d.items.length,phase:'preflight'};
 const link=(t,m)=>`https://t.me/c/${d.targetGroupId.slice(4)}/${t}/${m}`;
 const stages=[],state={started:false,confirmed:false};
 try{
  return await personal(c,deps,async(client,me)=>{
   const peer=await media.groupPeer(client,d.targetGroupId,bounded);
   await openTopic(client,peer,d.targetTopicId);await openTopic(client,peer,d.articleTopicId);
   const mediaLength=d.mediaPart.text.length-d.mediaPart.linkLength+90;
   await captionLimit(client,me,[...captions,{text:'x'.repeat(Math.min(mediaLength,4096))}]);
   outcome.phase='stage';
   for(let i=0;i<d.items.length;i++)stages.push(await stage(bot,client,c,cfg,d,i));
   const a=d.articlePart,placeholder='⏳ Media link இணைக்கப்படுகிறது…',delta=placeholder.length-a.linkLength;
   const initial={text:a.text.slice(0,a.linkOffset)+placeholder+a.text.slice(a.linkOffset+a.linkLength),entities:a.entities.map(e=>({...e,offset:e.offset>=a.linkOffset+a.linkLength?e.offset+delta:e.offset}))};
   const entities=media.caption(initial.text,initial.entities),rid=media.randomId(c.expectedUserId,d.requestKey+':article');
   outcome.phase='article';
   const result=await bounded(client.invoke(new Api.messages.SendMessage({peer,message:initial.text,entities,noWebpage:true,randomId:rid,sendAs:new Api.InputPeerSelf(),replyTo:new Api.InputReplyToMessage({replyToMsgId:d.articleTopicId,topMsgId:d.articleTopicId})})));
   const mid=result.updates?.find(x=>x.className==='UpdateMessageID'&&sid(x.randomId)===sid(rid))?.id||(result.className==='UpdateShortSentMessage'?result.id:0);
   check(int(mid),'ARTICLE_UNCONFIRMED');outcome.articleMessageId=mid;outcome.articleUrl=link(d.articleTopicId,mid);
   const verified=(m,text,es)=>m?.className==='Message'&&m.out&&sid(m.fromId?.userId)===sid(c.expectedUserId)&&sid(utils.getPeerId(m.peerId))===d.targetGroupId&&Number(m.replyTo?.replyToTopId||m.replyTo?.replyToMsgId)===d.articleTopicId&&m.message===text&&es.every(e=>media.entityMatches(m.entities,e));
   let [posted]=await bounded(client.getMessages(peer,{ids:[mid]}));check(verified(posted,initial.text,entities),'ARTICLE_UNCONFIRMED');
   const filled=fillLink(d.mediaPart,outcome.articleUrl);
   captions[d.captionIndex]={text:filled.text,entities:media.caption(filled.text,filled.entities)};
   outcome.phase='media';
   const ids=await sendItems(client,c,d,peer,stages,captions,0,state);
   outcome.sentMessageId=ids[0];outcome.messageIds=ids;outcome.mediaUrl=link(d.targetTopicId,ids[0]);
   const final=fillLink(d.articlePart,outcome.mediaUrl),finalEntities=media.caption(final.text,final.entities);outcome.phase='backlink';
   await bounded(client.invoke(new Api.messages.EditMessage({peer,id:mid,message:final.text,entities:finalEntities,noWebpage:true})));
   [posted]=await bounded(client.getMessages(peer,{ids:[mid]}));check(verified(posted,final.text,finalEntities),'BACKLINK_UNCONFIRMED');
   return {...outcome,status:'sent',phase:'complete'};
  });
 }catch(e){
  return {...outcome,status:outcome.articleMessageId?'partial':'unconfirmed',error:/^NNA_(SET|BUNDLE|MEDIA)_[A-Z_]+$/.test(e.message)?e.message:'NNA_BUNDLE_DELIVERY_UNCONFIRMED'};
 }finally{
  if(!state.started||state.confirmed)for(const s of stages)await bot('deleteMessage',{chat_id:sid(c.expectedUserId),message_id:s.stageId}).catch(()=>{});
 }
}
async function run(ctx,operation,deps={}){
 const scope=scopeOf(ctx.getNodeParameter('scopeJSON',0));
 if(operation==='collectOperatorAlbum')return collect(scope,JSON.parse(ctx.getNodeParameter('contextJSON',0)),deps);
 const b=await ctx.getCredentials('telegramApi');
 if(operation==='previewOperatorMedia')return preview(deps.bot||botCaller(ctx,b),scope,JSON.parse(ctx.getNodeParameter('contextJSON',0)));
 if(String(ctx.getNodeParameter('claimExecutionId',0))!==String(ctx.getExecutionId()))throw Error('NNA_SET_CLAIM_EXECUTION_MISMATCH');
 const c=await ctx.getCredentials('nnaTelegramSender');
 return publish(ctx,c,b,scope,JSON.parse(ctx.getNodeParameter('deliveryJSON',0)),deps);
}
module.exports={OPERATIONS,QUIET_MS,MAX_ITEMS,item,composition,summary,collect,preview,validate,validateBundle,publish,publishBundle,run};
