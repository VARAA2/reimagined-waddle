'use strict';
const {createHash}=require('node:crypto');
const {Api,utils}=require('teleproto');
const {HTMLParser}=require('teleproto/extensions/html');
const bigInt=require('big-integer');
// Sends ONE owner-scheduled rich message (Telegram HTML) as the personal account (Claude, 13 Nov 2026).
// Targets: the account's own chat (Saved Messages), a private user (numeric id the account knows, or @username),
// or a group / forum topic listed in the node's fixed scope. One claim per message (the n8n row lock + this execution),
// a deterministic random id from the schedule key (Telegram drops a second copy), and no automatic retry.
const id=v=>v==null?'':String(v);
const check=(ok,code)=>{if(!ok)throw Error('NNA_SCHEDMSG_'+code);};
const safeId=v=>/^[1-9]\d{0,15}$/.test(id(v))&&Number.isSafeInteger(Number(v));
const REJECTED=/^(USER_PRIVACY_RESTRICTED|USER_IS_BLOCKED|YOU_BLOCKED_USER|INPUT_USER_DEACTIVATED|USER_DEACTIVATED|USER_RESTRICTED|PEER_FLOOD|CHAT_WRITE_FORBIDDEN|CHAT_SEND_PLAIN_FORBIDDEN|USER_BANNED_IN_CHANNEL|TOPIC_CLOSED|TOPIC_DELETED|REPLY_MESSAGE_ID_INVALID|REPLY_TO_INVALID|MSG_ID_INVALID|ALLOW_PAYMENT_REQUIRED|PRIVACY_PREMIUM_REQUIRED|QUOTE_TEXT_INVALID)$/;
const TAGS=/^<(\/)?(b|strong|i|em|u|ins|s|strike|del|code|pre|blockquote|spoiler|tg-spoiler|a|tg-emoji)(\s[^<>]*)?>$/;
function scope(p){
 const s=p.scope;
 check(s&&typeof s==='object','SCOPE_INVALID');
 const groups=Array.isArray(s.allowedGroupIds)?s.allowedGroupIds.map(id):[];
 check(groups.length<=50&&groups.every(g=>/^-100[1-9]\d{0,12}$/.test(g)),'SCOPE_INVALID');
 check(typeof s.allowPrivate==='boolean','SCOPE_INVALID');
 // 0.57.0 (14 Nov 2026): groups whose posts may give the photo of a scheduled message (e.g. #NNA Media Collection).
 const mediaGroups=Array.isArray(s.mediaSourceGroupIds)?s.mediaSourceGroupIds.map(id):[];
 check(mediaGroups.length<=20&&mediaGroups.every(g=>/^-100[1-9]\d{0,12}$/.test(g)),'SCOPE_INVALID');
 return {groups,allowPrivate:s.allowPrivate,mediaGroups};
}
// Only Telegram's own formatting tags; anything else is refused (never silently dropped to plain text).
function parseHtml(html){
 check(typeof html==='string'&&html.length>0&&html.length<=40000,'HTML_INVALID');
 const stack=[];
 for(const m of html.matchAll(/<[^>]*>/g)){
  const t=TAGS.exec(m[0]);check(t,'HTML_UNSUPPORTED_TAG');
  const name=t[2],attrs=t[3]||'';
  if(t[1]){check(!attrs&&stack.pop()===name,'HTML_UNBALANCED');continue;}
  if(name==='a')check(/^\s+href="(?:https?:\/\/|tg:\/\/|mailto:)[^"<>]*"$/.test(attrs),'HTML_LINK_INVALID');
  else if(name==='tg-emoji')check(/^\s+emoji-id="\d{1,20}"$/.test(attrs),'HTML_EMOJI_INVALID');
  else if(name==='blockquote')check(!attrs||/^\s+expandable$/.test(attrs),'HTML_UNSUPPORTED_TAG');
  else check(!attrs,'HTML_UNSUPPORTED_TAG');
  stack.push(name);
 }
 check(!stack.length,'HTML_UNBALANCED');
 const norm=html.replace(/<(\/?)tg-spoiler>/g,'<$1spoiler>');
 const [text,entities]=HTMLParser.parse(norm);
 check(text.trim().length>0&&text.length<=4096,'TEXT_LENGTH');
 return {text,entities};
}
function messageOf(cfg,p,c,op='sendScheduledMessage',now=Date.now()){
 const m=p.message;
 check(m&&typeof m==='object','MESSAGE_INVALID');
 check(/^sm-[A-Z0-9]{6,20}$/.test(m.schedKey||''),'KEY_INVALID');
 const chat=id(m.chatId).trim();
 const topic=Number(m.topicId||0);check(Number.isSafeInteger(topic)&&topic>=0,'TOPIC_INVALID');
 let kind;
 if(chat===id(c.expectedUserId))kind='self';
 else if(/^-100[1-9]\d{0,12}$/.test(chat)){check(cfg.groups.includes(chat),'GROUP_NOT_ALLOWED');kind='group';}
 else if(safeId(chat)||/^@[A-Za-z][A-Za-z0-9_]{3,31}$/.test(chat)){check(cfg.allowPrivate,'PRIVATE_NOT_ALLOWED');kind='private';}
 else if(/^[1-9]\d{0,15}@-100[1-9]\d{0,12}\/[1-9]\d{0,9}$/.test(chat)){check(cfg.allowPrivate,'PRIVATE_NOT_ALLOWED');check(cfg.groups.includes(chat.split('@')[1].split('/')[0]),'GROUP_NOT_ALLOWED');kind='private';}
 else check(false,'CHAT_INVALID');
 check(kind==='group'||topic===0,'TOPIC_ONLY_IN_GROUPS');
 // Reply to one message in a private chat (0.52.0, Codex private reply cards). Groups keep topic replies only.
 const replyTo=Number(m.replyToId||0);check(Number.isSafeInteger(replyTo)&&replyTo>=0&&replyTo<=2147483647,'REPLY_TO_INVALID');// 0.55.0: reply-to also inside an allowed group (with its topic when it is a forum topic).
 // Quote-reply (0.59.0, File Share flow): quoteText = an exact piece of the replied message (Telegram checks it), only with replyToId.
 let quote=m.quoteText==null||m.quoteText===''?'':String(m.quoteText);
 check(quote===''||(replyTo>0&&quote.trim().length>0&&quote.length<=1024),'QUOTE_INVALID');
 // 0.65.0 (owner 18 Nov 2026, Article posts): the quote may be Telegram HTML (a bold title must be quoted WITH its bold,
 // Telegram checks entities too) and the replied message may sit in ANOTHER topic of the same group (replyTopicId).
 let quoteEntities=[];if(quote&&/<\/?(?:b|strong|i|em|u|ins|s|strike|del|code|spoiler|tg-spoiler|tg-emoji|a)[\s>]/.test(quote)){const q=parseHtml(quote);quote=q.text;quoteEntities=q.entities;}
 const replyTopic=Number(m.replyTopicId||0);check(Number.isSafeInteger(replyTopic)&&replyTopic>=0&&(replyTopic===0||(kind==='group'&&replyTo>0)),'REPLY_TOPIC_INVALID');
 const quoteOffset=Number(m.quoteOffset||0);check(Number.isSafeInteger(quoteOffset)&&quoteOffset>=0&&quoteOffset<=100000,'QUOTE_INVALID');
 // Cancel / check of a message Telegram holds in the account's Scheduled list (0.50.0).
 if(op==='cancelScheduledMessage'||op==='checkScheduledMessage'){
  check(Number.isSafeInteger(m.scheduledId)&&m.scheduledId>0,'SCHEDULED_ID_INVALID');
  return {schedKey:m.schedKey,chat,topic,kind,scheduledId:m.scheduledId};
 }
 // Native Telegram schedule (0.50.0): scheduleAt = unix seconds, 2 min .. 365 days ahead; 0/absent = send now.
 const scheduleAt=Number(m.scheduleAt||0);
 check(scheduleAt===0||(Number.isSafeInteger(scheduleAt)&&scheduleAt*1000>=now+110000&&scheduleAt*1000<=now+365*86400000),'SCHEDULE_AT_INVALID');
 // Rich mode (13 Nov 2026): Telegram rich message HTML (tables, details, aside...) sent as InputRichMessageHTML, the same way as rich direct replies.
 // Photo with caption (0.57.0): the photo of an existing post in an allowed media-source group is re-used
 // (no upload); m.html = the caption (Telegram formatting tags only).
 // Document file (0.62.0, owner 15 Nov 2026): ONE small file (exteraGram .plugin / .py) uploaded and sent with a caption,
 // only into an allowed group (or its topic) or the account's own Saved Messages. Never to private users.
 if(m.document!=null){
  check(typeof m.document==='object'&&m.media==null&&m.rich!==true,'DOCUMENT_INVALID');
  check(kind==='group'||kind==='self','DOCUMENT_TARGET_NOT_ALLOWED');
  const name=String(m.document.name||'');
  check(/^[A-Za-z0-9][A-Za-z0-9_.\-]{0,60}\.(plugin|py)$/.test(name),'DOCUMENT_NAME_INVALID');
  const b64=String(m.document.dataBase64||'');
  check(b64.length>0&&b64.length<=3000000&&/^[A-Za-z0-9+/=]+$/.test(b64),'DOCUMENT_DATA_INVALID');
  const data=Buffer.from(b64,'base64');
  check(data.length>0&&data.length<=2*1024*1024,'DOCUMENT_SIZE_INVALID');
  // 0.64.0 (owner 16 Nov 2026): replaceOld = after a verified send into a group topic, delete THIS account's own
  // earlier posts in the same topic that carry a file with exactly the same name (old plugin versions).
  const replaceOld=m.document.replaceOld===true&&kind==='group'&&scheduleAt===0&&Number(topic)>0;
  return {schedKey:m.schedKey,chat,topic,kind,scheduleAt,replyTo,quote,quoteEntities,replyTopic,quoteOffset,document:{name,data,replaceOld},body:parseHtml(m.html)};
 }
 if(m.media!=null){
  check(typeof m.media==='object'&&m.rich!==true,'MEDIA_INVALID');
  const mc=id(m.media.chatId).trim(),mm=Number(m.media.messageId);
  check(/^-100[1-9]\d{0,12}$/.test(mc)&&(cfg.mediaGroups.includes(mc)||cfg.groups.includes(mc)),'MEDIA_GROUP_NOT_ALLOWED');
  check(Number.isSafeInteger(mm)&&mm>0&&mm<=2147483647,'MEDIA_MESSAGE_INVALID');
  return {schedKey:m.schedKey,chat,topic,kind,scheduleAt,replyTo,quote,quoteEntities,replyTopic,quoteOffset,media:{chat:mc,messageId:mm},body:parseHtml(m.html)};
 }
 if(m.rich===true){
  check(typeof m.html==='string'&&m.html.trim().length>0&&m.html.length<=100000,'RICH_HTML_INVALID');
  check(!/<\s*(script|style|iframe|object|embed|form|input|button)\b/i.test(m.html)&&!/\son[a-z]+\s*=/i.test(m.html)&&!/javascript:/i.test(m.html),'RICH_HTML_UNSAFE');
  return {schedKey:m.schedKey,chat,topic,kind,scheduleAt,replyTo,quote,quoteEntities,replyTopic,quoteOffset,rich:true,html:m.html.trim()};
 }
 return {schedKey:m.schedKey,chat,topic,kind,scheduleAt,replyTo,quote,quoteEntities,replyTopic,quoteOffset,body:parseHtml(m.html)};
}
function precheck(c,p,executionId,op='sendScheduledMessage',now=Date.now()){
 const cfg=scope(p),m=messageOf(cfg,p,c,op,now);
 check(p.claimValidated===true&&p.claimRequestKey===m.schedKey&&id(p.claimExecutionId)!==''&&(executionId===undefined||id(p.claimExecutionId)===id(executionId)),'CLAIM_REQUIRED');
 return {cfg,m};
}
const randomId=(sender,key)=>bigInt((createHash('sha256').update('nna-scheduled-v1\0'+sender+'\0'+key).digest().readBigInt64BE(0)||1n).toString());
async function peerOf(client,m,bounded){
 if(m.kind==='self')return new Api.InputPeerSelf();
 if(m.kind==='group'){
  let g;try{g=await bounded(client.getEntity(bigInt(m.chat)));}catch{g=(await bounded(client.getDialogs({limit:500}))).map(x=>x.entity).find(x=>x?.className==='Channel'&&id(utils.getPeerId(x))===m.chat);}
  check(g?.className==='Channel'&&!g.left&&!g.kicked&&id(utils.getPeerId(g))===m.chat,'GROUP_UNAVAILABLE');
  check(!m.topic||g.forum===true,'NOT_A_FORUM');
  return await bounded(client.getInputEntity(g));
 }
 let u;
 // 0.63.0: "<userId>@-100<group>/<msgId>" = a person found through their message in an allowed group.
 if(/@-100/.test(m.chat)){
  const [uid,rest]=m.chat.split('@'),[gid,mid]=rest.split('/');
  try{u=await bounded(client.getEntity(bigInt(uid)));}catch{u=null;}
  if(!u){
   let g;try{g=await bounded(client.getEntity(bigInt(gid)));}catch{g=(await bounded(client.getDialogs({limit:500}))).map(x=>x.entity).find(x=>x?.className==='Channel'&&id(utils.getPeerId(x))===gid);}
   check(g?.className==='Channel','GROUP_UNAVAILABLE');
   const msgs=await bounded(client.getMessages(g,{ids:[Number(mid)]}));const x=msgs&&msgs[0];
   check(x&&id(x.senderId)===uid,'VIA_MESSAGE_NOT_FROM_USER');
   u=x.sender||await bounded(x.getSender());
  }
  check(u?.className==='User'&&!u.deleted&&!u.bot&&id(u.id)===uid,'USER_UNAVAILABLE');
  return await bounded(client.getInputEntity(u));
 }
 try{u=await bounded(client.getEntity(m.chat.startsWith('@')?m.chat.slice(1):bigInt(m.chat)));}catch{u=null;}
 if(!u&&!m.chat.startsWith('@')){const d=(await bounded(client.getDialogs({limit:500}))).map(x=>x.entity).find(x=>x?.className==='User'&&id(x.id)===m.chat);u=d||null;}
 check(u?.className==='User'&&!u.deleted&&!u.bot,'USER_UNAVAILABLE');
 return await bounded(client.getInputEntity(u));
}
// The account's own Scheduled list for this chat (ids only).
async function scheduledIds(client,peer,bounded){
 const r=await bounded(client.invoke(new Api.messages.GetScheduledHistory({peer,hash:bigInt.zero})));
 return (r?.messages||[]).filter(x=>x&&x.className==='Message').map(x=>x.id);
}
// 0.66.0 (owner 18 Nov 2026): quoting a RICH post needs quoteRich (RichText[], teleproto 1.233 / new layer); plain quoteText
// on a rich post gives QUOTE_TEXT_INVALID. The quote text + entities become TextPlain pieces wrapped in Bold/Italic/Underline/Strike.
function richQuote(text,entities){
 const cuts=new Set([0,text.length]);
 for(const e of entities||[]){cuts.add(e.offset);cuts.add(e.offset+e.length);}
 const pts=[...cuts].filter(x=>x>=0&&x<=text.length).sort((a,b)=>a-b),out=[];
 for(let i=0;i<pts.length-1;i++){
  const a=pts[i],b=pts[i+1];if(b<=a)continue;
  let node=new Api.TextPlain({text:text.slice(a,b)});
  for(const e of entities||[]){
   if(e.offset<=a&&e.offset+e.length>=b){
    const W={MessageEntityBold:Api.TextBold,MessageEntityItalic:Api.TextItalic,MessageEntityUnderline:Api.TextUnderline,MessageEntityStrike:Api.TextStrike}[e.className];
    if(W)node=new W({text:node});
   }
  }
  out.push(node);
 }
 return out;
}
async function run(operation,client,c,p,bounded,now=Date.now()){
 check(['sendScheduledMessage','cancelScheduledMessage','checkScheduledMessage'].includes(operation),'OPERATION');
 const {m}=precheck(c,p,undefined,operation,now);
 const base={schedKey:m.schedKey,chatId:m.chat,topicId:m.topic,replyToId:m.replyTo||0,quoted:Boolean(m.quote),senderId:id(c.expectedUserId)};
 const peer=await peerOf(client,m,bounded);
 if(operation==='checkScheduledMessage'){
  const ids=await scheduledIds(client,peer,bounded);
  return {status:ids.includes(m.scheduledId)?'still_scheduled':'not_in_scheduled_list',...base,scheduledId:m.scheduledId};
 }
 if(operation==='cancelScheduledMessage'){
  const ids=await scheduledIds(client,peer,bounded);
  if(!ids.includes(m.scheduledId))return {status:'not_found',...base,scheduledId:m.scheduledId};
  try{await bounded(client.invoke(new Api.messages.DeleteScheduledMessages({peer,id:[m.scheduledId]})));}catch{throw Error('NNA_SCHEDMSG_CANCEL_UNCONFIRMED');}
  const after=await scheduledIds(client,peer,bounded);
  check(!after.includes(m.scheduledId),'CANCEL_UNCONFIRMED');
  return {status:'cancelled',...base,scheduledId:m.scheduledId};
 }
 const rid=randomId(c.expectedUserId,m.schedKey);
 if(m.media){
  if(m.body.text.length>1024){
   const me=await bounded(client.getMe());check(me.premium===true,'CAPTION_OVER_1024');
   const app=await bounded(client.invoke(new Api.help.GetAppConfig({hash:0})));
   const limit=app.config?.value?.find(x=>x.key==='caption_length_limit_premium')?.value?.value;
   check(Number.isInteger(limit)&&limit>=m.body.text.length,'CAPTION_TOO_LONG');
  }
  const src=await peerOf(client,{kind:'group',chat:m.media.chat,topic:0},bounded);
  const [post]=await bounded(client.getMessages(src,{ids:[m.media.messageId]}));
  check(post?.className==='Message'&&post.media&&(post.media.className==='MessageMediaPhoto'||post.media.document?.mimeType?.startsWith('video/')),'MEDIA_NOT_FOUND');
  var mediaInput=utils.getInputMedia(post.media);
  // Album (0.61.0, owner 15 Nov 2026): a post that belongs to an album re-sends the WHOLE album (2-10 photos/videos,
  // in the original order) with the caption on the first item, never only one photo.
  if(post.groupedId!=null){
   const near=[];for(let i=Math.max(1,m.media.messageId-10);i<=m.media.messageId+10;i++)near.push(i);
   const all=(await bounded(client.getMessages(src,{ids:near}))).filter(x=>x?.className==='Message'&&x.groupedId!=null&&id(x.groupedId)===id(post.groupedId));
   all.sort((a,b)=>a.id-b.id);
   check(all.length>=2&&all.length<=10&&all.every(x=>x.media&&(x.media.className==='MessageMediaPhoto'||x.media.document?.mimeType?.startsWith('video/'))),'ALBUM_INVALID');
   var album=all.map((x,i)=>new Api.InputSingleMedia({media:utils.getInputMedia(x.media),randomId:i===0?rid:randomId(c.expectedUserId,m.schedKey+'#'+i),message:i===0?m.body.text:'',entities:i===0?m.body.entities:[]}));
  }
 }
 if(m.document){
  const {CustomFile}=require('teleproto/client/uploads');
  let file;
  try{file=await bounded(client.uploadFile({file:new CustomFile(m.document.name,m.document.data.length,'',m.document.data),workers:1}),60000);}
  catch{throw Error('NNA_SCHEDMSG_UPLOAD_FAILED');}
  var mediaInput=new Api.InputMediaUploadedDocument({file,mimeType:'application/octet-stream',forceFile:true,
   attributes:[new Api.DocumentAttributeFilename({fileName:m.document.name})]});
 }
 const req=album?{peer,multiMedia:album}:(m.media||m.document)?{peer,media:mediaInput,message:m.body.text,entities:m.body.entities,randomId:rid}:m.rich?{peer,message:'',richMessage:new Api.InputRichMessageHTML({html:m.html}),randomId:rid}:{peer,message:m.body.text,entities:m.body.entities,randomId:rid};
 if(m.replyTo>0){const r=m.topic>1?{replyToMsgId:m.replyTo,topMsgId:m.topic}:{replyToMsgId:m.replyTo};if(m.replyTopic>0&&m.replyTopic!==m.topic)r.replyToPeerId=peer;if(m.quote){r.quoteText=m.quote;if(m.quoteEntities&&m.quoteEntities.length)r.quoteEntities=m.quoteEntities;if(m.quoteOffset)r.quoteOffset=m.quoteOffset;let rich=false;try{const[x]=await bounded(client.getMessages(peer,{ids:[m.replyTo]}));rich=Boolean(x&&x.richMessage);}catch{rich=false;}if(rich){r.quoteRich=richQuote(m.quote,m.quoteEntities);delete r.quoteText;delete r.quoteEntities;}}req.replyTo=new Api.InputReplyToMessage(r);}
 else if(m.topic>1)req.replyTo=new Api.InputReplyToMessage({replyToMsgId:m.topic,topMsgId:m.topic});
 if(m.scheduleAt){
  req.scheduleDate=m.scheduleAt;
  let result;
  try{result=await bounded(client.invoke(album?new Api.messages.SendMultiMedia(req):(m.media||m.document)?new Api.messages.SendMedia(req):new Api.messages.SendMessage(req)));}
  catch(err){
   const code=err?.errorMessage||'';
   if(REJECTED.test(code)||/^SCHEDULE_/.test(code)||/^(MEDIA_|PHOTO_|CHAT_SEND_MEDIA_FORBIDDEN)/.test(code))return {status:'rejected',code,...base};
   if(/^FLOOD_WAIT_\d+$/.test(code))return {status:'rejected',code:'FLOOD_WAIT',...base};
   throw Error('NNA_SCHEDMSG_DELIVERY_UNCONFIRMED');
  }
  const updates=result?.updates||[];
  const msg=updates.find(x=>x.className==='UpdateNewScheduledMessage')?.message;
  const sid=msg?.id||updates.find(x=>x.className==='UpdateMessageID'&&id(x.randomId)===id(rid))?.id||0;
  check(Number.isSafeInteger(sid)&&sid>0,'DELIVERY_UNCONFIRMED');
  let listed=false;try{listed=(await scheduledIds(client,peer,bounded)).includes(sid);}catch{listed=false;}
  return {status:'telegram_scheduled',...base,rich:Boolean(m.rich),media:Boolean(m.media),document:Boolean(m.document),albumCount:album?album.length:0,scheduledId:sid,scheduleAt:m.scheduleAt,verified:listed,entityCount:m.rich?(msg?.richMessage?.blocks||[]).length:(msg?.entities||[]).length};
 }
 let result;
 try{result=await bounded(client.invoke(album?new Api.messages.SendMultiMedia(req):(m.media||m.document)?new Api.messages.SendMedia(req):new Api.messages.SendMessage(req)));}
 catch(err){
  const code=err?.errorMessage||'';
  if(REJECTED.test(code)||/^(MEDIA_|PHOTO_|CHAT_SEND_MEDIA_FORBIDDEN)/.test(code))return {status:'rejected',code,...base};
  if(/^FLOOD_WAIT_\d+$/.test(code))return {status:'rejected',code:'FLOOD_WAIT',...base};
  throw Error('NNA_SCHEDMSG_DELIVERY_UNCONFIRMED');
 }
 const updates=result?.updates||[];
 const mid=updates.find(x=>x.className==='UpdateMessageID'&&id(x.randomId)===id(rid))?.id||(result?.className==='UpdateShortSentMessage'?result.id:0);
 check(Number.isSafeInteger(mid)&&mid>0,'DELIVERY_UNCONFIRMED');
 let verified=false,entityCount=0,quoteShown=false;
 try{const sent=(await bounded(client.getMessages(peer,{ids:[mid]})))[0];entityCount=m.rich?(sent?.richMessage?.blocks||[]).length:(sent?.entities||[]).length;quoteShown=Boolean(sent?.replyTo?.quote);verified=Boolean(sent&&(m.rich?(sent.out===true||m.kind==='self')&&Boolean(sent.richMessage):String(sent.message||'').trimEnd()===m.body.text.trimEnd()));}catch{verified=false;}
 let replaced=[],replaceError='';
 if(verified&&m.document&&m.document.replaceOld){
  try{
   const r=await bounded(client.invoke(new Api.messages.Search({peer,q:'',fromId:new Api.InputPeerSelf(),topMsgId:Number(m.topic),
    filter:new Api.InputMessagesFilterEmpty(),minDate:0,maxDate:0,offsetId:0,addOffset:0,limit:100,maxId:0,minId:0,hash:0})));
   const fname=x=>((x?.media?.document?.attributes)||[]).find(a=>a.className==='DocumentAttributeFilename')?.fileName||'';
   const ids=(r?.messages||[]).filter(x=>x&&x.className==='Message'&&x.out===true&&x.id<mid&&fname(x)===m.document.name).map(x=>x.id).slice(0,50);
   if(ids.length){await bounded(client.deleteMessages(peer,ids,{revoke:true}));replaced=ids;}
  }catch(err){replaceError=String(err?.errorMessage||err?.message||err).slice(0,120);}
 }
 return {status:'sent',...base,rich:Boolean(m.rich),media:Boolean(m.media),document:Boolean(m.document),albumCount:album?album.length:0,messageId:mid,verified,entityCount,quoteShown,replacedOld:replaced,replaceError};
}
module.exports={scope,parseHtml,messageOf,precheck,randomId,richQuote,run};
