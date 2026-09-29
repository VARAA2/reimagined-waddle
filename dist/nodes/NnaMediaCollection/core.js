'use strict';
const {createClient,validateCredentials}=require('../NnaTelegramSender/sender');
const media=require('../NnaTelegramSender/media-publish');
const destinations=require('./destinations');
const {Api,utils}=require('teleproto');
const bigInt=require('big-integer');
const crypto=require('node:crypto');
const {Store,jobKey}=require('./store');
const {selectHashtags,composeCaption,summaryLines,composeAnalysisCaption,composeAnalysisReport}=require('./hashtag-policy.cjs');
const bank=require('./hashtag-bank.json');
const prompt=require('./prompt.json');
const feedback=require('./processing-feedback');
const check=(ok,code)=>{if(!ok)throw Error('MEDIA_'+code);};
const sid=x=>String(x??'');
const positive=x=>Number.isSafeInteger(x)&&x>0;
const bounded=async(p,ms=25000)=>{let timer;try{return await Promise.race([p,new Promise((_,r)=>timer=setTimeout(()=>r(Error('MEDIA_TIMEOUT')),ms))]);}finally{clearTimeout(timer);}};
function config(c,scope){
 validateCredentials(c);
 check(scope&&/^-100[1-9]\d+$/.test(scope.groupId||'')&&/^[a-z][a-z0-9_]{4,31}$/i.test(scope.botUsername||''),'SCOPE');
 check(Array.isArray(scope.operatorIds)&&scope.operatorIds.length>0&&scope.operatorIds.every(x=>/^[1-9]\d{0,15}$/.test(x)),'OPERATORS');
 check(scope.operatorIds.includes(sid(c.expectedUserId)),'SENDER_OPERATOR_REQUIRED');
 check(Array.isArray(scope.topicIds)&&scope.topicIds.length>0&&scope.topicIds.every(positive),'TOPICS');
 check([scope.maxAnalysisBytes,scope.maxVideoSeconds].every(x=>x===undefined||positive(x)),'ANALYSIS_LIMITS');
 check(scope.includeAnalysisInCaption===undefined||typeof scope.includeAnalysisInCaption==='boolean','ANALYSIS_CAPTION_SETTING');
 check(['albums','replyKeyboard','buttonCustomEmoji','fullTopicKeyboard','groupReplies'].every(k=>scope[k]===undefined||typeof scope[k]==='boolean'),'INTERFACE_SETTING');
 feedback.validate(scope);
 destinations.validateGroups(scope);
 require('./group-commands').validate(scope);
 return {...scope,maxAnalysisBytes:Math.min(scope.maxAnalysisBytes||50*1024*1024,100*1024*1024),maxVideoSeconds:Math.min(scope.maxVideoSeconds||300,600)};
}
function authenticate(u,scope,botId){
 check(Number.isSafeInteger(u?.update_id)&&u.update_id>=0,'UPDATE');
 const cb=u.callback_query,m=cb?.message||u.message;
 const group=require('./group-context').matches(u,scope[require('./group-context').CONTEXT],botId);
 check(m&&(group||m.chat?.type==='private'&&scope.operatorIds.includes(sid(m.chat.id))),'PRIVATE_OPERATOR_ONLY');
 const actor=cb?.from||m.from;
 check(actor&&!actor.is_bot&&(group||sid(actor.id)===sid(m.chat.id)),'OPERATOR');
 if(cb)check(m.from?.is_bot===true&&sid(m.from.id)===sid(botId),'CALLBACK_BOT');
 else check(!m.edit_date&&Number.isFinite(m.date)&&m.date<=Date.now()/1000+30&&Date.now()/1000-m.date<86400,'STALE_INPUT');
 return {owner:sid(actor.id),message:m,callback:cb};
}
function parseMedia(m){
 check(!m.media_group_id,'ALBUM_NOT_SUPPORTED');
 const photo=m.photo?.at(-1),v=m.video,d=m.document;
 const f=photo||v||d;
 check(f&&typeof f.file_id==='string'&&typeof f.file_unique_id==='string','PHOTO_OR_VIDEO_REQUIRED');
 const mime=photo?'image/jpeg':v?(v.mime_type||'video/mp4'):d.mime_type;
 check(/^(image\/(jpeg|png|webp)|video\/(mp4|quicktime|webm))$/.test(mime||''),'MEDIA_TYPE');
 const caption=m.caption||'',entities=m.caption_entities||[];
 check(typeof caption==='string'&&caption.length<=4096,'CAPTION_LENGTH');
 return {kind:photo?'photo':v?'video':'document',mime,fileId:f.file_id,uniqueId:f.file_unique_id,size:Number(f.file_size||0),duration:Number(v?.duration||0),caption,entities,sourceMessageId:m.message_id,hasSpoiler:!!m.has_media_spoiler,showAbove:!!m.show_caption_above_media};
}
function keyboard(d,topics,page=0){
 const cb=action=>'mc:'+d.key+':'+d.rev+':'+action;
 const buttons=topics.map(t=>({text:(t.emoji||'📁')+' '+destinations.topicTitle(t,topics)+(t.hidden?' (மறைக்கப்பட்டது)':t.closed?' (மூடப்பட்டது)':''),callback_data:cb('t'+destinations.topicKey(t))}));
 const rows=[];for(let i=0;i<buttons.length;i+=4)rows.push(buttons.slice(i,i+4));
 if(d.analysisApproved)rows.push([{text:'🚫 சுருக்கம் + Hashtags நீக்கு',callback_data:cb('off')}]);
 rows.push([{text:'❌ ரத்து',callback_data:cb('cancel')}]);
 return {inline_keyboard:rows};
}
function parseResult(raw){
 if(raw?.error)throw Error('MEDIA_AI_FAILED');
 if(Array.isArray(raw?.candidates)&&raw.candidates[0]?.tag)return raw;
 const text=raw?.content?.parts?.map(p=>p.text||'').join('')||raw?.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('')||raw?.text||raw?.output;
 check(typeof text==='string'&&text.length<=30000,'AI_RESULT');
 try{return JSON.parse(text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}catch{throw Error('MEDIA_AI_JSON');}
}
class Service{
 constructor(ctx,c,b,scope,deps={}){this.ctx=ctx;this.c=c;this.b=b;this.scope=config(c,scope);this.deps=deps;}
 async bot(method,body={},timeout=25000){
  check(typeof this.b.accessToken==='string'&&/^\d+:[A-Za-z0-9_-]+$/.test(this.b.accessToken),'TOKEN');
  try{const r=await this.ctx.helpers.httpRequest({method:'POST',url:'https://api.telegram.org/bot'+this.b.accessToken+'/'+method,body,json:true,timeout});check(r?.ok,'BOT_RESPONSE');return r.result;}catch(cause){const e=Error('MEDIA_BOT_'+method.toUpperCase()+'_FAILED');const status=cause.statusCode||cause.response?.status||cause.response?.statusCode;const description=JSON.stringify(cause.response?.body||cause.response?.data||cause.description||cause.message||'');if(status===400&&/CUSTOM_EMOJI|custom emoji|icon_custom_emoji/i.test(description))e.customEmojiRejected=true;if(status===400&&/REACTION_INVALID|REACTIONS_TOO_MANY|REACTION_EMPTY/i.test(description))e.reactionRejected=true;throw e;}
 }
 async init(){
  check(process.env.EXECUTIONS_MODE!=='queue','SINGLE_INSTANCE_REQUIRED');
  this.me=await this.bot('getMe');check(this.me.is_bot&&this.me.username?.toLowerCase()===this.scope.botUsername.toLowerCase(),'WRONG_BOT');
  this.store=new Store(this.me.id,this.deps.root);try{feedback.recover(this);}catch{}return this;
 }
 async personal(fn){let client;try{client=await (this.deps.createClient||createClient)(this.c);await bounded(client.connect());const me=await bounded(client.getMe());check(!me.bot&&sid(me.id)===sid(this.c.expectedUserId),'WRONG_SENDER');return await fn(client,me);}finally{if(client)await bounded(client.destroy(),10000).catch(()=>{});}}
 async group(client,groupId=this.scope.groupId){check(destinations.groups(this.scope).some(g=>g.groupId===groupId),'DESTINATION');return media.groupPeer(client,groupId,bounded);}
 async topics(client,targetGroupId){
  const selected=destinations.groups(this.scope).filter(g=>!targetGroupId||g.groupId===targetGroupId);check(selected.length>0,'DESTINATION');
  const topics=[];for(const g of selected)topics.push(...await this.groupTopics(client,g));
  check(topics.length<=90,'TOO_MANY_TOPICS');return topics;
 }
 async groupTopics(client,g){
  const peer=await this.group(client,g.groupId);let topics=[];
  if(g.allTopics===true){
   let offsetDate=0,offsetId=0,offsetTopic=0;
   for(let page=0;page<10;page++){
    const r=await bounded(client.invoke(new Api.messages.GetForumTopics({peer,offsetDate,offsetId,offsetTopic,limit:100})));
    const found=(r.topics||[]).filter(t=>t.className==='ForumTopic');
    for(const t of found)if(!topics.some(x=>x.id===t.id))topics.push(t);
    if(topics.length>=r.count||found.length<100)break;
    const last=found.at(-1),date=r.orderByCreateDate?last.date:r.messages?.find(m=>m.id===last.topMessage)?.date;
    check(date&&last.id!==offsetTopic,'TOPIC_PAGINATION');offsetDate=date;offsetId=last.topMessage;offsetTopic=last.id;
   }
  }else{const r=await bounded(client.invoke(new Api.messages.GetForumTopicsByID({peer,topics:g.topicIds})));topics=(r.topics||[]).filter(t=>t.className==='ForumTopic');}
  check(topics.length<=90,'TOO_MANY_TOPICS');
  return topics.map(t=>({id:t.id,key:g.groupId===this.scope.groupId?t.id:'g'+g.groupId.slice(4)+'_'+t.id,groupId:g.groupId,groupLabel:g.label||g.groupId,title:t.title,hidden:!!t.hidden,closed:!!t.closed,emoji:g.topicEmojis?.[String(t.id)]||'📁',iconCustomEmojiId:t.iconEmojiId&&String(t.iconEmojiId)!=='0'?String(t.iconEmojiId):null}));
 }
 async inspect(){return this.personal(async client=>{const topics=await this.topics(client);check(topics.length>0,'NO_TOPICS');const hook=await this.bot('getWebhookInfo');return {status:'verified',botId:this.me.id,botUsername:this.me.username,senderId:sid(this.c.expectedUserId),groupId:this.scope.groupId,topics,analysisDefault:false,webhookUrl:hook.url||'',pendingUpdateCount:hook.pending_update_count||0};});}
 async configureCommands(){
  const commands=[{command:'start',description:'Media அனுப்பி topic தேர்வு செய்யுங்கள்'},{command:'menu',description:'Media buttons காட்டு'},{command:'topicorder',description:'உங்களுக்கான topic வரிசையை மாற்று'},{command:'analyze',description:'Media-க்கு சுருக்கம் + Hashtags (Reply செய்யலாம்)'},{command:'cancel',description:'அடுத்த media analysis-ஐ ரத்து செய்'},{command:'help',description:'பயன்பாட்டு உதவி'}];
  await this.bot('setMyCommands',{commands,scope:{type:'all_private_chats'}});
  const found=await this.bot('getMyCommands',{scope:{type:'all_private_chats'}});check(JSON.stringify(found)===JSON.stringify(commands),'COMMANDS_UNCONFIRMED');return {status:'commands_configured',commands};
 }
 async tell(owner,text,extra={}){return this.bot('sendMessage',{chat_id:owner,text,...extra});}
 async refreshTopicButtons(key){
  const d=this.store.read(key);check(d&&d.status==='pending'&&this.scope.operatorIds.includes(d.owner)&&positive(d.controlId),'PENDING_DRAFT_REQUIRED');
  await this.display(d);return {status:'topics_refreshed',jobKey:key,columns:this.scope.fullTopicKeyboard?3:this.scope.replyKeyboard?1:4};
 }
 async display(d,page=0){
  const report=composeAnalysisReport(d),state=report.text;
  const topics=d.analysisOnly?[]:await this.personal(client=>this.topics(client));
  const retryCommand=this.scope.analysisCommand==='mediareport'?'/mediareport':'/analyze';
  const text=d.analysisOnly?(state||'Analysis முடிவு கிடைக்கவில்லை. இந்த media-க்கு Reply செய்து '+retryCommand+' கொடுத்து மீண்டும் முயற்சிக்கலாம்.'):(state?state+'\n\n':'')+'📍 எந்த topic-ல் பதிவிட வேண்டும்?';
  const markup=d.analysisOnly?{inline_keyboard:[]}:keyboard(d,topics,page);
  if(d.controlId)await this.bot('editMessageText',{chat_id:d.owner,message_id:d.controlId,text,entities:report.entities,reply_markup:markup});
  else{const m=await this.tell(d.owner,text,{entities:report.entities,reply_to_message_id:d.sourceMessageId,reply_markup:markup});this.store.change(d.key,x=>({...x,controlId:m.message_id}));}
 }
 reusedTags(){return (this.store.read('used_hashtags')?.tags||[]).filter(x=>typeof x==='string').slice(0,300);}
 rememberTags(tags){
  this.store.change('used_hashtags',old=>{const all=new Map();for(const tag of [...(old?.tags||[]),...tags]){if(typeof tag==='string'&&/^#[\p{L}_][\p{L}\p{N}\p{M}_]{0,63}$/u.test(tag)){const key=tag.toLocaleLowerCase('en-US');if(!all.has(key)&&all.size<300)all.set(key,tag);}}return {tags:[...all.values()]};});
 }
 async stage(d,client){
  const marker='⏳ Media processing '+d.key+' '+crypto.randomBytes(5).toString('hex');
  const response=await (this.transportBot||this.bot.bind(this))(d.kind==='photo'?'sendPhoto':d.kind==='video'?'sendVideo':'sendDocument',{chat_id:sid(this.c.expectedUserId),[d.kind]:d.fileId,caption:marker,disable_notification:true});
  const sentFile=response.photo?.at(-1)||response.video||response.document;
  try{
   check(sentFile?.file_unique_id===d.uniqueId,'STAGE_MEDIA_MISMATCH');
   const peer=await bounded(client.getInputEntity(this.scope.botUsername));
   check(sid(peer.userId)===sid(this.me.id),'STAGE_BOT_MISMATCH');
   let source;
   for(let i=0;i<3&&!source;i++){const ms=await bounded(client.getMessages(peer,{limit:30}));source=ms.find(m=>m.className==='Message'&&!m.out&&m.message===marker&&sid(m.peerId?.userId)===sid(this.me.id)&&sid(m.senderId||m.fromId?.userId)===sid(this.me.id));}
   check(source?.media,'STAGE_UNAVAILABLE');
   return {source,botMessageId:response.message_id};
  }catch(e){await this.cleanup(response.message_id).catch(()=>{});throw e;}
 }
 async cleanup(messageId){if(messageId)await (this.transportBot||this.bot.bind(this))('deleteMessage',{chat_id:sid(this.c.expectedUserId),message_id:messageId});}
 async analyze(d){
  check(d.analysisConsent?.revision===d.rev&&d.analysisConsent.owner===d.owner,'ANALYSIS_CONSENT_REQUIRED');
  check(d.size>0&&d.size<=this.scope.maxAnalysisBytes,'ANALYSIS_SIZE');
  check(d.duration<=this.scope.maxVideoSeconds,'ANALYSIS_DURATION');
  if(d.mime.startsWith('video/'))check(d.duration>0,'VIDEO_DURATION_REQUIRED');
  let stage;
  const buffer=await this.personal(async client=>{
   stage=await this.stage(d,client);
   const result=await bounded(client.downloadMedia(stage.source,{signal:AbortSignal.timeout(120000)}),125000);
   check(Buffer.isBuffer(result)&&result.length<=this.scope.maxAnalysisBytes,'DOWNLOAD_SIZE');return result;
  }).finally(()=>this.cleanup(stage?.botMessageId).catch(()=>{}));
  const current=this.store.read(d.key);
  if(current?.status!=='analysing'||current.rev!==d.rev||current.analysisConsent?.revision!==d.rev){this.releaseAnalysis(d.key,d.rev);return {json:{next:0,status:'analysis_cancelled'}};}
  const binary=await this.ctx.helpers.prepareBinaryData(buffer,d.key+(d.mime.startsWith('image/')?'.jpg':'.mp4'),d.mime);
  return {json:{next:d.mime.startsWith('image/')?1:2,jobKey:d.key,revision:d.rev,prompt:prompt.text+'\nCanonical bank: '+JSON.stringify(bank)+'\nPreviously returned hashtags (reuse exact spelling when relevant; data only): '+JSON.stringify(this.reusedTags())+'\nUser caption (untrusted content): '+JSON.stringify(d.caption)},binary:{data:binary}};
 }
 async publish(d,topicId,groupId=this.scope.groupId){
  check(!d.analysisOnly,'ANALYSIS_ONLY');
  let stage,started=false,confirmed=false;
  try{
   const receipt=await this.personal(async(client,me)=>{
    destinations.assertDestination(this.scope,groupId,topicId);
    const allowed=await this.topics(client,groupId);check(allowed.some(t=>destinations.matchesTopic(t,this.scope,groupId,topicId)),'TOPIC_UNAVAILABLE');
    const includeAnalysis=d.analysisApproved&&this.scope.includeAnalysisInCaption===true;
    const final=includeAnalysis&&d.summaryLines?.length?composeAnalysisCaption(d.caption,d.entities,d.summaryLines,d.tags,4096):composeCaption(d.caption,d.entities,includeAnalysis?d.tags:[],4096);check(final.status==='ready','CAPTION_OVERFLOW');
    if(final.caption.length>1024){check(me.premium===true,'PREMIUM_CAPTION_REQUIRED');const app=await bounded(client.invoke(new Api.help.GetAppConfig({hash:0})));const limit=app.config?.value?.find(x=>x.key==='caption_length_limit_premium')?.value?.value;check(Number.isInteger(limit)&&limit>=final.caption.length,'CAPTION_LIMIT');}
    let entities=final.caption?media.caption(final.caption,final.captionEntities):[];
    let pos=final.caption.length-final.addedHashtags.join(' ').length;
    for(const tag of final.addedHashtags){entities.push(new Api.MessageEntityHashtag({offset:pos,length:tag.length}));pos+=tag.length+1;}
    stage=await this.stage(d,client);
    const original=stage.source.media.photo||stage.source.media.document;
    check(original,'SOURCE_MEDIA');
    const peer=await this.group(client,groupId),rid=media.randomId(this.c.expectedUserId,'collection:'+d.key+':'+d.rev);
    started=true;
    const inputMedia=utils.getInputMedia(stage.source.media);inputMedia.spoiler=!!d.hasSpoiler;
    const r=await bounded(client.invoke(new Api.messages.SendMedia({peer,media:inputMedia,message:final.caption,entities,randomId:rid,sendAs:new Api.InputPeerSelf(),invertMedia:!!d.showAbove,replyTo:new Api.InputReplyToMessage({replyToMsgId:topicId,topMsgId:topicId})})));
    const mid=(r.updates||[]).find(x=>x.className==='UpdateMessageID'&&sid(x.randomId)===sid(rid))?.id||(r.className==='UpdateShortSentMessage'?r.id:0);
    check(positive(mid),'DELIVERY_UNCONFIRMED');
    const [sent]=await bounded(client.getMessages(peer,{ids:[mid]}));
    check(sent?.className==='Message'&&sid(sent.fromId?.userId)===sid(this.c.expectedUserId)&&sid(utils.getPeerId(sent.peerId))===groupId&&Number(sent.replyTo?.replyToTopId||sent.replyTo?.replyToMsgId)===topicId&&sent.message===final.caption&&!sent.fwdFrom,'DELIVERY_UNCONFIRMED');
    check(sid((sent.media?.photo||sent.media?.document)?.id)===sid(original.id),'MEDIA_UNCONFIRMED');
    check(entities.every(e=>media.entityMatches(sent.entities,e)),'FORMATTING_UNCONFIRMED');
    confirmed=true;return {messageId:mid,topicId,groupId,caption:final.caption,entities:final.captionEntities,url:'https://t.me/c/'+groupId.slice(4)+'/'+topicId+'/'+mid};
   });
   this.store.change(d.key,x=>({...x,status:'sent',receipt,sentAt:Date.now()}));
   const mediaLabel=d.mime.startsWith('image/')?'படம்':'வீடியோ';
   await this.tell(d.owner,receipt.url+'\n\n✅ நீங்கள் அனுப்பிய '+mediaLabel+' தேர்ந்தெடுத்த topic-ல் பதிவிடப்பட்டது.',{reply_to_message_id:d.sourceMessageId,allow_sending_without_reply:true,disable_web_page_preview:true,reply_markup:{inline_keyboard:[[{text:'✏️ Caption திருத்து',callback_data:'mc:'+d.key+':'+d.rev+':edit'}]]}}).then(m=>this.store.change(d.key,x=>({...x,receiptControlId:m.message_id}))).catch(()=>{});
   await this.bot('editMessageReplyMarkup',{chat_id:d.owner,message_id:d.controlId,reply_markup:{inline_keyboard:[]}}).catch(()=>{});
   return {next:0,status:'sent',jobKey:d.key,messageId:receipt.messageId,topicId,groupId};
  }catch(e){
   this.store.change(d.key,x=>({...x,status:started?'uncertain':'pending',lastError:/^MEDIA_[A-Z_]+$/.test(e.message)?e.message:'MEDIA_SEND_FAILED'}));
   await this.tell(d.owner,started?'⚠️ பதிவின் முடிவு உறுதியாகவில்லை. Group-ல் சரிபார்த்த பிறகே மீண்டும் முயற்சிக்க வேண்டும்.':'⚠️ இப்போது பதிவிட முடியவில்லை. Bot-ஐ @'+this.scope.botUsername+' என்ற பெயரில் sender account-ல் Start செய்துள்ளீர்களா என்பதையும் topic கிடைக்கிறதா என்பதையும் சரிபாருங்கள்.').catch(()=>{});
   if(!started)await this.display(this.store.read(d.key)).catch(()=>{});
   return {next:0,status:started?'uncertain':'failed',jobKey:d.key};
  }finally{if(!started||confirmed)await this.cleanup(stage?.botMessageId).catch(()=>{});}
 }
 async requestEdit(d){
  const p=await this.tell(d.owner,'✏️ புதிய caption-ஐ இந்த message-க்கு Reply செய்து அனுப்புங்கள்.\nCaption முழுவதையும் நீக்க: /empty\nHashtags தேவைப்பட்டால் புதிய caption-லேயே சேர்க்கவும்.',{reply_markup:{force_reply:true,selective:true}});
  this.store.change('reply_'+d.owner+'_'+p.message_id,()=>({key:d.key,rev:d.rev,owner:d.owner}));
 }
 async editReply(m,owner){
  const ref=m.reply_to_message;if(!ref||sid(ref.from?.id)!==sid(this.me.id))return null;
  const link=this.store.read('reply_'+owner+'_'+ref.message_id);if(!link)return null;
  const caption=m.text==='/empty'?'':m.text;if(typeof caption!=='string')return null;
  check(caption.length<=4096,'CAPTION_LENGTH');
  let d=this.store.change(link.key,x=>{check(x&&x.owner===owner&&x.rev===link.rev&&['pending','sent'].includes(x.status),'STALE_EDIT');return {...x,status:x.status==='sent'?'editing':'pending',caption,entities:m.text==='/empty'?[]:m.entities||[],tags:[],summaryLines:[],analysisApproved:false,analysisConsent:null,rev:x.rev+1};});
  if(d.status==='pending'){await this.display(d);return {next:0,status:'caption_updated'};}
  let started=false;
  try{
   await this.personal(async(client,me)=>{
    const groupId=d.receipt.groupId||this.scope.groupId;destinations.assertDestination(this.scope,groupId,d.receipt.topicId);
    const peer=await this.group(client,groupId),[old]=await bounded(client.getMessages(peer,{ids:[d.receipt.messageId]}));
    check(old?.className==='Message'&&sid(old.fromId?.userId)===sid(this.c.expectedUserId)&&old.message===d.receipt.caption&&Number(old.replyTo?.replyToTopId||old.replyTo?.replyToMsgId)===d.receipt.topicId,'EDIT_TARGET_CHANGED');
    if(caption.length>1024)check(me.premium===true,'PREMIUM_CAPTION_REQUIRED');
    const entities=caption?media.caption(caption,d.entities):[];
    if(old.message===caption&&(old.entities||[]).length===entities.length&&entities.every(e=>media.entityMatches(old.entities,e)))return;
    started=true;
    await bounded(client.invoke(new Api.messages.EditMessage({peer,id:d.receipt.messageId,message:caption,entities})));
    const [sent]=await bounded(client.getMessages(peer,{ids:[d.receipt.messageId]}));check(sent?.message===caption&&entities.every(e=>media.entityMatches(sent.entities,e)),'EDIT_UNCONFIRMED');
   });
   this.store.change(d.key,x=>({...x,status:'sent',receipt:{...x.receipt,caption,entities:x.entities}}));
   const r=await this.tell(owner,d.receipt.url+'\n\n✅ இந்தப் பதிவின் caption திருத்தப்பட்டது.',{reply_to_message_id:d.sourceMessageId,allow_sending_without_reply:true,disable_web_page_preview:true,reply_markup:{inline_keyboard:[[{text:'✏️ மீண்டும் திருத்து',callback_data:'mc:'+d.key+':'+d.rev+':edit'}]]}});
   this.store.change(d.key,x=>({...x,receiptControlId:r.message_id}));return {next:0,status:'edited'};
  }catch{this.store.change(d.key,x=>({...x,status:started?'uncertain':'sent'}));await this.tell(owner,'⚠️ Caption மாற்றத்தை உறுதிப்படுத்த முடியவில்லை. Group பதிவைச் சரிபாருங்கள்.');return {next:0,status:'edit_failed'};}
 }
 async handle(u){
  const auth=authenticate(u,this.scope,this.me.id),{owner,message:m,callback:cb}=auth;
  if(!cb){
   if(/^\/(?:analyze|analysis)(?:@\w+)?$/.test((m.text||'').trim())){
    if(m.reply_to_message){
     const ref=m.reply_to_message,key=this.jobKey(owner,ref.message_id),existing=this.store.read(key);
     if(existing?.owner===owner&&existing.lastAnalysisCommandId===m.message_id)return {json:{next:0,status:'duplicate_analysis'}};
     if(existing?.owner===owner&&existing.status==='analysing'){await this.tell(owner,'⏳ இந்த media-க்கு analysis ஏற்கெனவே நடக்கிறது.');return {json:{next:0,status:'analysis_pending'}};}
     if(existing?.owner===owner&&existing.status==='pending')return await this.startAnalysis(existing,{owner,updateId:u.update_id,commandMessageId:m.message_id});
     let asset;try{check(this.replyContext||sid(ref.from?.id)===owner&&!ref.from.is_bot,'REPLY_MEDIA_OWNER');asset=parseMedia(this.replyContext?{...ref,media_group_id:undefined}:ref);}catch{await this.tell(owner,'நீங்கள் இந்த bot-க்கு அனுப்பிய image அல்லது video-க்கு Reply செய்து /analyze அனுப்புங்கள்.');return {json:{next:0,status:'reply_media_required'}};}
     const analysisKey=this.jobKey(owner,'analysis:'+ref.message_id+':'+m.message_id);let created=false;
     const d=this.store.change(analysisKey,old=>{if(old)return undefined;created=true;return {key:analysisKey,owner,rev:1,status:'pending',analysisOnly:true,createdAt:Date.now(),...asset,analysisApproved:false,analysisConsent:null,tags:[],summaryLines:[]};});
     if(!created)return {json:{next:0,status:'duplicate_analysis'}};
     return await this.startAnalysis(d,{owner,updateId:u.update_id,commandMessageId:m.message_id});
    }
    this.store.change('mode_'+owner,x=>x&&x.updateId>=u.update_id?undefined:{armed:true,updateId:u.update_id,commandMessageId:m.message_id,expiresAt:Date.now()+15*60000});
    await this.tell(owner,'✨ அடுத்து ஒரு image அல்லது video அனுப்புங்கள். அந்த ஒரு media-க்கு 3–4 வரிச் சுருக்கமும் hashtags-மும் ஒரே பதிலாகத் தரப்படும்.\nஏற்கெனவே அனுப்பிய media-க்கு Reply செய்து /analyze கொடுக்கலாம்.\nரத்து செய்ய: /cancel');
    return {json:{next:0,status:'analysis_armed'}};
   }
   if(/^\/cancel(?:@\w+)?$/.test((m.text||'').trim())){this.store.change('mode_'+owner,x=>x&&x.updateId>=u.update_id?undefined:{...x,armed:false,updateId:u.update_id});await this.tell(owner,'Analysis mode ரத்து செய்யப்பட்டது. இனி நேரடியாக media அனுப்பினால் topic மட்டும் கேட்கப்படும்.');return {json:{next:0,status:'analysis_disarmed'}};}
   const edited=await this.editReply(m,owner);if(edited)return {json:edited};
   if(/^\/(start|help|menu)(?:@\w+)?(?:\s|$)/.test(m.text||'')){await this.tell(owner,'📷 Image அல்லது video அனுப்புங்கள்; caption இருந்தாலும் இல்லாவிட்டாலும் பரவாயில்லை.\nTopic தேர்வு செய்தால் @'+(this.scope.senderLabel||'personal_account')+' பெயரில் பதிவிடப்படும்.\n\n✨ 3–4 வரிச் சுருக்கம் + Hashtags வேண்டுமென்றால் media-க்கு Reply செய்து /analyze அனுப்புங்கள். அல்லது /analyze கொடுத்துவிட்டு அடுத்த ஒரு media அனுப்புங்கள்.\nஏற்கெனவே group-ல் பதிவிட்ட media-க்கு Reply செய்து analyze செய்யலாம்; அது மீண்டும் பதிவாகாது.');return {json:{next:0,status:'help'}};}
   let asset;try{asset=parseMedia(m);}catch(e){await this.tell(owner,e.message==='MEDIA_ALBUM_NOT_SUPPORTED'?'ஒரு image அல்லது video-வைத் தனியாக அனுப்புங்கள். Album support இன்னும் இல்லை.':'Image அல்லது video அனுப்புங்கள். Caption-ஐ media உடன் சேர்க்கலாம்.');return {json:{next:0,status:'unsupported'}};}
   const key=this.jobKey(owner,m.message_id);let created=false;
   const d=this.store.change(key,old=>{if(old)return undefined;created=true;return {key,owner,rev:1,status:'pending',createdAt:Date.now(),...asset,analysisApproved:false,analysisConsent:null,tags:[]};});
   if(created){
    await this.display(d);let consent;
    this.store.change('mode_'+owner,x=>{if(x?.armed&&x.expiresAt>Date.now()){consent={owner,updateId:x.updateId,commandMessageId:x.commandMessageId};return {...x,armed:false,consumedBy:key};}return undefined;});
    if(consent)return await this.startAnalysis(this.store.read(key),consent);
   }
   return {json:{next:0,status:created?'topic_choice':'duplicate',jobKey:key}};
  }
  await this.bot('answerCallbackQuery',{callback_query_id:cb.id}).catch(()=>{});
  const match=/^mc:([a-f0-9]{20}):(\d+):(off|edit|cancel|p\d+|t(?:\d+|g\d+_\d+))$/.exec(cb.data||'');check(match,'CALLBACK');
  const key=match[1],rev=Number(match[2]),action=match[3];let d=this.store.read(key);
  check(d&&d.owner===owner&&d.rev===rev&&[d.controlId,d.receiptControlId].includes(m.message_id)&&(d.replyContext?.tag||'')===(this.replyContext?.tag||''),'STALE_BUTTON');
  if(action==='edit'&&['pending','sent'].includes(d.status)){await this.requestEdit(d);return {json:{next:0,status:'await_caption'}};}
  check(['pending','analysing'].includes(d.status),'ALREADY_HANDLED');
  if(action==='cancel'){this.store.change(key,x=>{check(x.rev===rev&&['pending','analysing'].includes(x.status),'STALE_BUTTON');return {...x,status:'cancelled',rev:x.rev+1};});await feedback.complete(this,key,rev,'cancelled').catch(()=>{});await this.bot('editMessageText',{chat_id:owner,message_id:d.controlId,text:'❌ இந்த draft ரத்து செய்யப்பட்டது.',reply_markup:{inline_keyboard:[]}});return {json:{next:0,status:'cancelled'}};}
  if(action==='off'){d=this.store.change(key,x=>{check(x.rev===rev&&['pending','analysing'].includes(x.status),'STALE_BUTTON');return {...x,status:x.analysisOnly?'cancelled':'pending',rev:x.rev+1,analysisApproved:false,analysisConsent:null,tags:[],summaryLines:[]};});await feedback.complete(this,key,rev,'cancelled').catch(()=>{});if(d.analysisOnly)await this.bot('editMessageText',{chat_id:owner,message_id:d.controlId,text:'❌ Analysis ரத்து செய்யப்பட்டது.',reply_markup:{inline_keyboard:[]}});else await this.display(d);return {json:{next:0,status:'analysis_off'}};}
  if(action[0]==='p'){check(d.status==='pending','ANALYSIS_PENDING');await this.display(d,Number(action.slice(1)));return {json:{next:0,status:'page'}};}
  check(action[0]==='t','DESTINATION');const {topicId,groupId}=destinations.resolveDestination(this.scope,action.slice(1));
  d=this.store.change(key,x=>{check(x.rev===rev&&x.status==='pending','STALE_BUTTON');return {...x,status:'sending',topicId,targetGroupId:groupId,selectedAt:Date.now(),selectedUpdateId:u.update_id};});
  return {json:await this.publish(d,topicId,groupId)};
 }
 async startAnalysis(original,consent){
  this.store.change('analysis_slots',x=>{const slots=(x?.slots||[]).filter(s=>s.until>Date.now());check(slots.length<2,'ANALYSIS_BUSY');return {slots:[...slots,{key:original.key,rev:original.rev+1,until:Date.now()+10*60000}]};});
  let d;
  try{
   d=this.store.change(original.key,x=>{check(x.rev===original.rev&&x.status==='pending','STALE_ANALYZE');return {...x,status:'analysing',rev:x.rev+1,tags:[],summaryLines:[],analysisApproved:false,lastAnalysisCommandId:consent.commandMessageId,analysisConsent:{...consent,revision:x.rev+1,at:Date.now()}};});
   const progress={text:'⏳ சுருக்கமும் hashtags-மும் தயாராகின்றன…',reply_markup:{inline_keyboard:[[{text:d.analysisOnly?'❌ Analysis ரத்து':'AI வேண்டாம் — அசல் பதிவைப் பயன்படுத்து',callback_data:'mc:'+d.key+':'+d.rev+':off'}]]}};
   if(d.controlId)await this.bot('editMessageText',{chat_id:d.owner,message_id:d.controlId,...progress});
   else{const m=await this.tell(d.owner,progress.text,{reply_to_message_id:d.sourceMessageId,...progress});d=this.store.change(d.key,x=>({...x,controlId:m.message_id}));}
   await feedback.start(this,d).catch(()=>{});
   return await this.analyze(d);
  }catch(e){
   this.releaseAnalysis(original.key,original.rev+1);
   if(!d)throw e;
   await feedback.complete(this,d.key,d.rev,'failure').catch(()=>{});
   this.store.change(d.key,x=>x.rev===d.rev&&x.status==='analysing'?{...x,status:'pending',analysisConsent:null,lastError:/^MEDIA_[A-Z_]+$/.test(e.message)?e.message:'MEDIA_ANALYSIS_FAILED'}:undefined);
   await this.tell(d.owner,'⚠️ Analysis செய்ய முடியவில்லை. அளவு/நீள வரம்பு அல்லது download பிரச்சினையாக இருக்கலாம்.'+(d.analysisOnly?'':' அசல் media-வை topic தேர்வு செய்து பதிவிடலாம்.'));
   const current=this.store.read(d.key);if(current.status==='pending')await this.display(current);return {json:{next:0,status:'analysis_failed'}};
  }
 }
 releaseAnalysis(key,rev){this.store.change('analysis_slots',x=>({slots:(x?.slots||[]).filter(s=>s.key!==key||s.rev!==rev)}));}
 async finish(key,revision,raw){
  this.releaseAnalysis(key,revision);
  const d=this.store.read(key);if(!d||d.status!=='analysing'||d.rev!==revision||d.analysisConsent?.revision!==revision)return {next:0,status:'stale_analysis'};
  let result,summary;try{const parsed=parseResult(raw);summary=summaryLines(parsed);result=selectHashtags(parsed,this.reusedTags());check(!result.needsReview&&result.tags.length>0,'AI_REVIEW_REQUIRED');}catch{
   this.store.change(key,x=>x.rev===revision&&x.status==='analysing'?{...x,status:'pending',analysisConsent:null}:undefined);await this.tell(d.owner,'⚠️ சுருக்கமும் பொருத்தமான hashtags-மும் நம்பகமாக உருவாக்க முடியவில்லை. இந்த media-க்கு Reply செய்து /analyze கொடுத்து மீண்டும் முயற்சிக்கலாம்.');const current=this.store.read(key);if(current.status==='pending')await this.display(current);return {next:0,status:'analysis_failed'};
  }
  const next=this.store.change(key,x=>x.rev===revision&&x.status==='analysing'?{...x,status:x.analysisOnly?'analysed':'pending',analysisApproved:true,summaryLines:summary,tags:result.tags,rev:x.rev+1}:undefined);
  if(['pending','analysed'].includes(next.status)&&next.analysisApproved){await this.display(next);try{this.rememberTags(result.tags);}catch{}}
  return {next:0,status:'analysis_ready',knownCount:result.knownCount,novelCount:result.novelCount};
 }
}
require('./album-ui').install(Service,parseMedia);
require('./group-commands').install(Service);
require('./reply-analysis').install(Service,authenticate,parseMedia);
require('./group-analysis').install(Service);
feedback.install(Service);
require('./audio-summary').install(Service,authenticate);
module.exports={Service,config,authenticate,parseMedia,keyboard,parseResult};
