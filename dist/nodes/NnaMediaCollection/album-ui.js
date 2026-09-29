'use strict';
// Optional persistent private keyboard and album composer. Legacy callbacks remain valid.
const {Api,utils}=require('teleproto');
const {jobKey}=require('./store');
const media=require('../NnaTelegramSender/media-publish');
const destinations=require('./destinations');
const {composeAnalysisReport}=require('./hashtag-policy.cjs');
const check=(ok,code)=>{if(!ok)throw Error('MEDIA_'+code);};
const sid=x=>String(x??'');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const bound=async promise=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('MEDIA_TIMEOUT')),30000))]);}finally{clearTimeout(timer);}};
const PAGE_SIZE=8;
function topicKeyboard(d,topics,page=0,icons=true,full=false){
 const size=full?Math.max(1,topics.length):PAGE_SIZE;
 const pages=Math.max(1,Math.ceil(topics.length/size));page=Math.max(0,Math.min(pages-1,page));
 const choices=topics.slice(page*size,(page+1)*size).map(t=>{
  const custom=icons&&/^[1-9]\d+$/.test(t.iconCustomEmojiId||'')?t.iconCustomEmojiId:null;
  const text=(custom?'':(t.emoji||'📁')+' ')+destinations.topicTitle(t,topics)+(t.hidden?' (மறைக்கப்பட்டது)':t.closed?' (மூடப்பட்டது)':'');
  return {button:{text,...(custom?{icon_custom_emoji_id:custom}:{})},action:'t'+destinations.topicKey(t),fullWidth:!!t.fullWidth};
 });
 const rows=[];let row=[],used=0;
 const flush=()=>{if(row.length)rows.push(row);row=[];used=0;};
 const segmenter=new Intl.Segmenter(undefined,{granularity:'grapheme'});
 for(const {button,fullWidth} of choices){
  const length=[...segmenter.segment(button.text)].length;
  const width=fullWidth||!full||length>22?3:length>12?1.5:1;
  if(used+width>3)flush();row.push(button);used+=width;if(used===3)flush();
 }
 flush();
 const nav=[];
 if(page>0){nav.push({text:'⬅️ முந்தைய பக்கம்'});choices.push({button:nav.at(-1),action:'p'+(page-1)});}
 if(page+1<pages){nav.push({text:'➡️ அடுத்த பக்கம்'});choices.push({button:nav.at(-1),action:'p'+(page+1)});}
 if(nav.length)rows.push(nav);
 if(d.analysisApproved){const button={text:'🚫 சுருக்கம் + Hashtags நீக்கு'};rows.push([button]);choices.push({button,action:'off'});}
 const cancel={text:'❌ இந்த பதிவை ரத்து செய்'},pending={text:'🗂 காத்திருக்கும் பதிவுகள்'};
 rows.push([pending],[cancel]);choices.push({button:pending,action:'pending'},{button:cancel,action:'cancel'});
 return {page,pages,choices,markup:{keyboard:rows,resize_keyboard:true,is_persistent:false,one_time_keyboard:false,input_field_placeholder:'கீழே topic தேர்வு செய்யுங்கள்'}};
}
function install(Service,parseMedia){
 const legacy={handle:Service.prototype.handle,display:Service.prototype.display,publish:Service.prototype.publish,requestEdit:Service.prototype.requestEdit,startAnalysis:Service.prototype.startAnalysis};
 Service.prototype.startAnalysis=function(original,consent){
  // Telegram cannot edit a message carrying a reply keyboard. Start the
  // analysis status in a new message; its inline cancel control stays in chat.
  const ui=this.store.read('ui_'+original.owner);
  if(this.scope.replyKeyboard&&original.controlId&&ui?.controlId===original.controlId){
   original=this.store.change(original.key,x=>{check(x.rev===original.rev&&x.status==='pending','STALE_ANALYZE');return {...x,controlId:0};});
  }
  return legacy.startAnalysis.call(this,original,consent);
 };
 Service.prototype.keyboardSend=async function(owner,text,extra){
  // Retry only an explicit Telegram rejection before a message was sent, never a transport error.
  try{return await this.tell(owner,text,extra);}catch(e){
   if(!e.customEmojiRejected)throw e;
   this.store.change('keyboard_icons',()=>({disabled:true}));
   const clean=JSON.parse(JSON.stringify(extra));
   for(const row of clean.reply_markup?.keyboard||[])for(const b of row)delete b.icon_custom_emoji_id;
   return this.tell(owner,text,clean);
  }
 };
 Service.prototype.showKeyboard=async function(owner,text,choices,rows,extra={},state={}){
  const m=await this.keyboardSend(owner,text,{...extra,reply_markup:{keyboard:rows,resize_keyboard:true,is_persistent:false,one_time_keyboard:false}});
  this.store.change('ui_'+owner,()=>({...state,owner,controlId:m.message_id,shownAt:Date.now(),choices:choices.map(x=>({text:x.button.text,action:x.action}))}));
  return m;
 };
 Service.prototype.addPending=function(d){this.store.change('pending_'+d.owner,old=>({keys:[d.key,...(old?.keys||[]).filter(k=>k!==d.key)].slice(0,100)}));};
 Service.prototype.pendingDrafts=function(owner){return (this.store.read('pending_'+owner)?.keys||[]).map(k=>this.store.read(k)).filter(d=>d&&d.owner===owner&&['pending','collecting','analysing'].includes(d.status));};
 Service.prototype.orderedTopics=async function(owner){
  const topics=await this.personal(client=>this.topics(client));
  const saved=this.store.read('topic_order_'+owner);
  const ids=(saved&&saved.orderRevision===this.scope.topicOrderRevision?saved.ids:this.scope.defaultTopicOrder)||[];
  const ordered=[...ids.map(id=>topics.find(t=>String(destinations.topicKey(t))===String(id))).filter(Boolean),...topics.filter(t=>!ids.some(id=>String(id)===String(destinations.topicKey(t))))];
  return ordered.map(t=>({...t,fullWidth:(this.scope.fullWidthTopicKeys||[]).some(id=>String(id)===String(destinations.topicKey(t)))}));
 };
 Service.prototype.showOrder=async function(owner){
  const topics=await this.orderedTopics(owner);
  const choices=[{button:{text:'🔄 Group வரிசைக்கு மாற்று'},action:'resetorder'},{button:{text:'🏠 Main Menu'},action:'home'}];
  await this.showKeyboard(owner,'↕️ உங்களுக்கான topic வரிசை\n\n'+topics.map((t,i)=>(i+1)+'. '+destinations.topicTitle(t,topics)).join('\n')+'\n\nவேண்டிய வரிசையில் எண்களை அனுப்புங்கள். உதாரணம்: 3, 1, 5, 2\nகுறிப்பிடாத topics அதன் பிறகு வரும். எந்த topic-மும் நீக்கப்படாது.',choices,choices.map(x=>[x.button]),{}, {kind:'order',topicIds:topics.map(destinations.topicKey)});
 };
 Service.prototype.home=async function(owner,lastKey){
  const choices=[{button:{text:'📷 Image / Video / Album'},action:'upload'},{button:{text:'🗂 காத்திருக்கும் பதிவுகள்'},action:'pending'},{button:{text:'↕️ Topic வரிசை மாற்று'},action:'order'},{button:{text:'✨ சுருக்கம் + Hashtags'},action:'analyze'},{button:{text:'ℹ️ உதவி'},action:'help'}];
  const last=this.store.read(lastKey||this.store.read('last_sent_'+owner)?.key||'none');
  if(last?.owner===owner&&last.status==='sent')choices.push({button:{text:last.albumId?'✏️ கடைசி Album முதல் Caption':'✏️ கடைசி Caption திருத்து'},action:'edit:'+last.key});
  return this.showKeyboard(owner,'📷 Image, video அல்லது 2–10 படங்கள்/வீடியோக்கள் கொண்ட Album அனுப்புங்கள்.\nTopic தேர்வு செய்ததும் @'+(this.scope.senderLabel||'personal_account')+' மூலம் பதிவிடப்படும்.\n\n✨ சுருக்கம் + Hashtags: ஒரு media-க்கு Reply செய்து /analyze அனுப்புங்கள்.',choices,choices.map(x=>[x.button]),{}, {kind:'home'});
 };
 Service.prototype.showPending=async function(owner){
  const drafts=this.pendingDrafts(owner);
  const choices=drafts.slice(0,20).map(d=>({button:{text:(d.albumId?'🖼 Album '+d.assets.length:'📷 Media')+' · '+d.sourceMessageId+(d.caption?' — '+d.caption.slice(0,35):'')},action:'draft:'+d.key}));
  choices.push({button:{text:'🏠 Main Menu'},action:'home'});
  return this.showKeyboard(owner,drafts.length?'தொடர வேண்டிய பதிவைத் தேர்வு செய்யுங்கள்.':'காத்திருக்கும் பதிவுகள் இல்லை. புதிய media அனுப்பலாம்.',choices,choices.map(x=>[x.button]),{}, {kind:'drafts'});
 };
 Service.prototype.showAlbumCollecting=async function(d){
  const choices=[{button:{text:'✅ Album தயார் — Topics காட்டு'},action:'ready'},{button:{text:'❌ இந்த பதிவை ரத்து செய்'},action:'cancel'},{button:{text:'🗂 காத்திருக்கும் பதிவுகள்'},action:'pending'}];
  const m=await this.showKeyboard(d.owner,'🖼 Album பெறப்படுகிறது. எல்லா படங்கள்/வீடியோக்களும் அனுப்பி முடிந்ததும் கீழே “Album தயார்” அழுத்துங்கள்.\nஅடுத்து முழு எண்ணிக்கையும் topic பெயர்களும் காட்டப்படும்.',choices,choices.map(x=>[x.button]),{reply_to_message_id:d.sourceMessageId,allow_sending_without_reply:true},{kind:'collecting',key:d.key,rev:d.rev});
  this.store.change(d.key,x=>({...x,controlId:m.message_id}));
 };
 Service.prototype.display=async function(d,page=0){
  if(!this.scope.replyKeyboard||d.analysisOnly)return legacy.display.call(this,d,page);
  this.addPending(d);
  if(d.status==='collecting')return this.showAlbumCollecting(d);
  const topics=await this.orderedTopics(d.owner);
  const icons=this.scope.buttonCustomEmoji!==false&&!this.store.read('keyboard_icons')?.disabled;
  const menu=topicKeyboard(d,topics,page,icons,this.scope.fullTopicKeyboard===true);
  const report=composeAnalysisReport(d),analysis=report.text?report.text+'\n':'';
  const label=d.albumId?'🖼 Album: '+d.assets.length+' media':'📷 Media';
  const text=analysis+label+'\n📍 எந்த topic-ல் பதிவிட வேண்டும்?'+(menu.pages>1?' ('+(menu.page+1)+'/'+menu.pages+')':'\n'+topics.length+' topics — ஒரே பட்டியல்')+(d.albumId?'\nஎல்லா '+d.assets.length+' media-வும் ஒரே album ஆக வெளியாகும்.':'');
  const sent=await this.showKeyboard(d.owner,text,menu.choices,menu.markup.keyboard,{entities:report.entities,reply_to_message_id:d.sourceMessageId,allow_sending_without_reply:true},{kind:'topics',key:d.key,rev:d.rev,page:menu.page});
  this.store.change(d.key,x=>({...x,controlId:sent.message_id}));
 };
 Service.prototype.receiveAlbum=async function(u,owner,m){
  check(/^[A-Za-z0-9_-]{1,100}$/.test(sid(m.media_group_id)),'ALBUM_ID');
  const key=this.jobKey(owner,'album:'+m.media_group_id);let created=false,added=false,late=false;
  let asset;
  try{asset=parseMedia({...m,media_group_id:undefined});}catch{
   this.store.change(key,old=>old&&!['pending','collecting','blocked'].includes(old.status)?undefined:({...old,key,owner,status:'blocked',assets:old?.assets||[],lastError:'MEDIA_ALBUM_UNSUPPORTED_ITEM'}));
   await this.tell(owner,'⚠️ Album-ல் ஆதரிக்கப்படாத file உள்ளது. இந்த album முழுவதும் பதிவிடப்படவில்லை. Image/video மட்டும் கொண்ட album அனுப்புங்கள்.');return {json:{next:0,status:'album_blocked',jobKey:key}};
  }
  const d=this.store.change(key,old=>{
   if(old?.assets?.some(x=>x.sourceMessageId===m.message_id))return undefined;
   if(old&&!['collecting','pending'].includes(old.status)){late=true;return undefined;}
   const assets=[...(old?.assets||[]),asset].sort((a,b)=>a.sourceMessageId-b.sourceMessageId);
   if(assets.length>10)return {...old,status:'blocked',lastError:'MEDIA_ALBUM_TOO_LARGE'};
   const documents=assets.filter(x=>x.kind==='document').length;
   if(documents&&documents!==assets.length)return {...old,key,owner,assets,status:'blocked',lastError:'MEDIA_ALBUM_MIXED_DOCUMENTS'};
   created=!old;added=true;
   return {...old,...assets[0],key,owner,albumId:sid(m.media_group_id),assets,rev:(old?.rev||0)+1,status:old?.status||'collecting',createdAt:old?.createdAt||Date.now(),lastAssetAt:Date.now(),analysisApproved:false,tags:[]};
  });
  if(d?.status==='blocked'){await this.tell(owner,'⚠️ Album-ல் 2–10 media மட்டும் இருக்க வேண்டும். File/document வகையையும் photo/video வகையையும் ஒரே album-ல் கலக்க முடியாது. இந்த album பதிவிடப்படவில்லை.');return {json:{next:0,status:'album_blocked',jobKey:key}};}
  if(late){await this.tell(owner,'⚠️ இந்த Album ஏற்கெனவே முடிக்கப்பட்டதால் தாமதமாக வந்த media சேர்க்கப்படவில்லை. முழு album எண்ணிக்கையைச் சரிபாருங்கள்.');return {json:{next:0,status:'album_late',jobKey:key}};}
  if(created){
   this.addPending(d);await this.showAlbumCollecting(d);
   let armed=false;this.store.change('mode_'+owner,x=>{if(!x?.armed)return undefined;armed=true;return {...x,armed:false};});
   if(armed)await this.tell(owner,'Album-க்கு ஒவ்வொரு media-வையும் Reply செய்து /analyze கொடுக்கலாம். முழு Album தானாக AI-க்கு அனுப்பப்படாது.');
  }else if(added&&d.status==='pending')await this.display(d);
  return {json:{next:0,status:added?'album_collecting':'duplicate',jobKey:key,count:d.assets.length}};
 };
 Service.prototype.readyAlbum=async function(d){
  const until=Date.now()+20000;
  while(Date.now()-d.lastAssetAt<2500&&Date.now()<until){await (this.deps.wait||sleep)(Math.min(500,2500-(Date.now()-d.lastAssetAt)));d=this.store.read(d.key);}
  check(d.status==='collecting'&&d.assets.length>=2&&d.assets.length<=10&&Date.now()-d.lastAssetAt>=2500,'ALBUM_STILL_ARRIVING');
  const ready=this.store.change(d.key,x=>{check(x.status==='collecting'&&x.rev===d.rev,'ALBUM_CHANGED');return {...x,status:'pending',rev:x.rev+1};});
  await this.display(ready);return {json:{next:0,status:'topic_choice',jobKey:d.key,count:d.assets.length}};
 };
 Service.prototype.handle=async function(u){
  if(!this.scope.replyKeyboard&&!this.scope.albums)return legacy.handle.call(this,u);
  const {authenticate}=require('./core');const auth=authenticate(u,this.scope,this.me.id);const {owner,message:m,callback:cb}=auth;
  if(cb)return legacy.handle.call(this,u);
  if(m.media_group_id&&this.scope.albums)return this.receiveAlbum(u,owner,m);
  if(m.reply_to_message?.media_group_id&&/^\/(analyze|analysis)(?:@\w+)?$/.test((m.text||'').trim()))return legacy.handle.call(this,{...u,message:{...m,reply_to_message:{...m.reply_to_message,media_group_id:undefined}}});
  if(!this.scope.replyKeyboard)return legacy.handle.call(this,u);
  if(m.reply_to_message&&this.store.read('reply_'+owner+'_'+m.reply_to_message.message_id))return legacy.handle.call(this,u);
  const text=(m.text||'').trim();
  const ui=this.store.read('ui_'+owner),choice=ui?.choices?.find(x=>x.text===text);
  if(/^\/topicorder(?:@\w+)?$/.test(text)){await this.showOrder(owner);return {json:{next:0,status:'topic_order'}};}
  if(choice){
   check(m.date>=Math.floor(ui.shownAt/1000)-1,'STALE_KEYBOARD');
   if(m.reply_to_message&&m.reply_to_message.message_id!==ui.controlId)throw Error('MEDIA_STALE_KEYBOARD');
   const action=choice.action;let d=ui.key?this.store.read(ui.key):null;
   if(action==='home'||action==='upload'||action==='help'){await this.home(owner);return {json:{next:0,status:'menu'}};}
   if(action==='pending'){await this.showPending(owner);return {json:{next:0,status:'draft_list'}};}
   if(action==='order'){await this.showOrder(owner);return {json:{next:0,status:'topic_order'}};}
   if(action==='resetorder'){this.store.change('topic_order_'+owner,()=>({ids:[],orderRevision:this.scope.topicOrderRevision,updatedAt:Date.now()}));await this.tell(owner,'✅ Group-ல் தற்போது உள்ள வரிசைக்கு மாற்றப்பட்டது.');await this.home(owner);return {json:{next:0,status:'order_reset'}};}
   if(action==='analyze')return legacy.handle.call(this,{...u,message:{...m,text:'/analyze'}});
   if(action.startsWith('draft:')){d=this.store.read(action.slice(6));check(d?.owner===owner&&['collecting','pending'].includes(d.status),'DRAFT_NOT_READY');await this.display(d);return {json:{next:0,status:'draft_selected'}};}
   if(action.startsWith('edit:')){d=this.store.read(action.slice(5));check(d?.owner===owner&&d.status==='sent','STALE_EDIT');await this.requestEdit(d);return {json:{next:0,status:'await_caption'}};}
   check(d&&d.owner===owner,'STALE_KEYBOARD');
   if(action==='ready')return this.readyAlbum(d);
   if(action==='cancel'){
    check(d.controlId===ui.controlId&&(d.status==='collecting'||d.rev===ui.rev),'STALE_KEYBOARD');
    this.store.change(d.key,x=>{check(x.rev===d.rev&&['collecting','pending','analysing'].includes(x.status),'ALREADY_HANDLED');return {...x,status:'cancelled',rev:x.rev+1};});
    await this.tell(owner,'❌ இந்த draft ரத்து செய்யப்பட்டது.');await this.home(owner);return {json:{next:0,status:'cancelled'}};
   }
   check(d.rev===ui.rev&&d.controlId===ui.controlId,'STALE_KEYBOARD');
   const event={update_id:u.update_id,callback_query:{id:'keyboard-'+u.update_id,from:m.from,data:'mc:'+d.key+':'+d.rev+':'+action,message:{message_id:d.controlId,chat:m.chat,from:this.me}}};
   // These are authenticated text button presses. There is no Bot API callback to acknowledge.
   const bot=this.bot;this.bot=async(method,body)=>method==='answerCallbackQuery'&&body.callback_query_id===event.callback_query.id?{}:bot.call(this,method,body);
   try{const result=await legacy.handle.call(this,event);if(action==='cancel')await this.home(owner);return result;}finally{this.bot=bot;}
  }
  if(ui?.kind==='order'&&text&&!text.startsWith('/')){
   const valid=/^\d+(?:[\s,]+\d+)*$/.test(text);const numbers=valid?text.split(/[\s,]+/).map(Number):[];
   if(!numbers.length||numbers.some(n=>!Number.isInteger(n)||n<1||n>ui.topicIds.length)||new Set(numbers).size!==numbers.length){await this.tell(owner,'⚠️ பட்டியலில் உள்ள எண்களை மட்டும், ஒவ்வொன்றையும் ஒருமுறை அனுப்புங்கள். உதாரணம்: 3, 1, 5, 2');return {json:{next:0,status:'order_invalid'}};}
   const selected=numbers.map(n=>ui.topicIds[n-1]),ids=[...selected,...ui.topicIds.filter(id=>!selected.includes(id))];
   this.store.change('topic_order_'+owner,()=>({ids,orderRevision:this.scope.topicOrderRevision,updatedAt:Date.now()}));await this.tell(owner,'✅ உங்களுக்கான topic வரிசை சேமிக்கப்பட்டது. அடுத்த topic தேர்வில் இந்த வரிசை வரும்.');await this.home(owner);return {json:{next:0,status:'order_saved'}};
  }
  if(/^\/(start|help|menu)(?:@\w+)?(?:\s|$)/.test(text)){await this.home(owner);return {json:{next:0,status:'menu'}};}
  return legacy.handle.call(this,u);
 };
 Service.prototype.publish=async function(d,topicId,groupId=this.scope.groupId){
  const result=d.albumId?await this.publishAlbum(d,topicId,groupId):await legacy.publish.call(this,d,topicId,groupId);
  if(result.status==='sent'){this.store.change('last_sent_'+d.owner,()=>({key:d.key}));if(this.scope.replyKeyboard)await this.home(d.owner,d.key).catch(()=>{});}
  return result;
 };
 Service.prototype.publishAlbum=async function(d,topicId,groupId=this.scope.groupId){
  check(d.assets?.length>=2&&d.assets.length<=10,'ALBUM_SIZE');
  let started=false,confirmed=false;const stages=[];
  try{
   const receipt=await this.personal(async(client,me)=>{
    destinations.assertDestination(this.scope,groupId,topicId);
    const topics=await this.topics(client,groupId);check(topics.some(t=>destinations.matchesTopic(t,this.scope,groupId,topicId)),'TOPIC_UNAVAILABLE');
    if(d.assets.some(a=>a.caption.length>1024)){check(me.premium===true,'PREMIUM_CAPTION_REQUIRED');const cfg=await bound(client.invoke(new Api.help.GetAppConfig({hash:0})));const max=cfg.config?.value?.find(x=>x.key==='caption_length_limit_premium')?.value?.value;check(Number.isInteger(max)&&d.assets.every(a=>a.caption.length<=max),'CAPTION_LIMIT');}
    const parts=[];
    for(const [index,asset] of d.assets.entries()){
     const entities=asset.caption?media.caption(asset.caption,asset.entities):[];
     const staged=await this.stage({...asset,key:d.key+'-'+index},client);stages.push(staged);
     const input=utils.getInputMedia(staged.source.media);input.spoiler=!!asset.hasSpoiler;
     const rid=media.randomId(this.c.expectedUserId,'album:'+d.key+':'+d.rev+':'+asset.sourceMessageId);
     parts.push({asset,entities,staged,rid,input:new Api.InputSingleMedia({media:input,randomId:rid,message:asset.caption,entities})});
    }
    const peer=await this.group(client,groupId);started=true;
    const response=await bound(client.invoke(new Api.messages.SendMultiMedia({peer,multiMedia:parts.map(p=>p.input),sendAs:new Api.InputPeerSelf(),invertMedia:d.assets.some(a=>a.showAbove),replyTo:new Api.InputReplyToMessage({replyToMsgId:topicId,topMsgId:topicId})})));
    const ids=parts.map(p=>(response.updates||[]).find(x=>x.className==='UpdateMessageID'&&sid(x.randomId)===sid(p.rid))?.id);
    check(ids.every(x=>Number.isSafeInteger(x)&&x>0)&&new Set(ids).size===ids.length,'ALBUM_DELIVERY_UNCONFIRMED');
    const sent=await bound(client.getMessages(peer,{ids}));let groupedId;
    const items=parts.map((p,i)=>{
     const message=sent.find(x=>x.id===ids[i]);
     check(message?.className==='Message'&&sid(message.fromId?.userId)===sid(this.c.expectedUserId)&&sid(utils.getPeerId(message.peerId))===groupId&&Number(message.replyTo?.replyToTopId||message.replyTo?.replyToMsgId)===topicId&&!message.fwdFrom&&message.message===p.asset.caption,'ALBUM_DELIVERY_UNCONFIRMED');
     check(message.groupedId&&(!groupedId||groupedId===sid(message.groupedId)),'ALBUM_GROUP_UNCONFIRMED');groupedId=sid(message.groupedId);
     check(sid((message.media?.photo||message.media?.document)?.id)===sid((p.staged.source.media.photo||p.staged.source.media.document)?.id),'ALBUM_MEDIA_UNCONFIRMED');
     check(p.entities.every(e=>media.entityMatches(message.entities,e)),'ALBUM_FORMATTING_UNCONFIRMED');
     return {messageId:ids[i],sourceMessageId:p.asset.sourceMessageId,caption:p.asset.caption,entities:p.asset.entities};
    });
    confirmed=true;return {...items[0],messageIds:ids,items,groupedId,topicId,groupId,url:'https://t.me/c/'+groupId.slice(4)+'/'+topicId+'/'+ids[0]};
   });
   this.store.change(d.key,x=>({...x,status:'sent',receipt,sentAt:Date.now()}));
   await this.tell(d.owner,receipt.url+'\n\n✅ '+d.assets.length+' media கொண்ட முழு Album தேர்ந்தெடுத்த topic-ல் பதிவிடப்பட்டது.',{reply_to_message_id:d.sourceMessageId,allow_sending_without_reply:true,disable_web_page_preview:true}).catch(()=>{});
   return {next:0,status:'sent',jobKey:d.key,topicId,groupId,messageIds:receipt.messageIds,count:receipt.items.length};
  }catch(e){
   this.store.change(d.key,x=>({...x,status:started?'uncertain':'pending',lastError:/^MEDIA_[A-Z_]+$/.test(e.message)?e.message:'MEDIA_ALBUM_SEND_FAILED'}));
   await this.tell(d.owner,started?'⚠️ Album பதிவின் முடிவை உறுதிப்படுத்த முடியவில்லை. மீண்டும் அனுப்புவதற்கு முன் group-ல் சரிபாருங்கள்.':'⚠️ Album பதிவிடப்படவில்லை. Topic கிடைக்கிறதா, caption அளவு சரியா என்று சரிபார்த்து மீண்டும் தேர்வு செய்யலாம்.').catch(()=>{});
   if(!started)await this.display(this.store.read(d.key)).catch(()=>{});
   return {next:0,status:started?'uncertain':'failed',jobKey:d.key};
  }finally{if(!started||confirmed)for(const stage of stages)await this.cleanup(stage.botMessageId).catch(()=>{});}
 };
}
module.exports={install,topicKeyboard,PAGE_SIZE};
