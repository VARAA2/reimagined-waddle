'use strict';
const {createHash}=require('node:crypto');
const {Api}=require('teleproto');
const {HTMLParser}=require('teleproto/extensions/html');
const bigInt=require('big-integer');
const {groupPeer}=require('./media-publish');
const {resolveUsers}=require('./attendance-report');
// Sends a fresh copy of ONE new photo (or of a whole photo album posted at once) from a configured forum topic to one configured
// person, as the personal account, with a caption naming the sender and linking the post (the post URL already names the group).
// The photo(s), their topic and their sender are proven again from Telegram, one claim per post (or per album) and recipient, a
// deterministic random id, and no automatic retry. Recipient-side refusals (privacy, blocked) come back as status "rejected".
// All identities live in the scope JSON.
const id=v=>v==null?'':String(v);
const check=(ok,code)=>{if(!ok)throw Error('NNA_TOPICFWD_'+code);};
const safeId=v=>/^[1-9]\d{0,15}$/.test(id(v))&&Number.isSafeInteger(Number(v));
const REJECTED=/^(USER_PRIVACY_RESTRICTED|USER_IS_BLOCKED|YOU_BLOCKED_USER|INPUT_USER_DEACTIVATED|USER_DEACTIVATED|USER_RESTRICTED|PEER_FLOOD|PREMIUM_ACCOUNT_REQUIRED|ALLOW_PAYMENT_REQUIRED|PRIVACY_PREMIUM_REQUIRED|CHAT_SEND_PHOTOS_FORBIDDEN|CHAT_FORWARDS_RESTRICTED)$/;
const esc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const plain=(v,max,code)=>{check(typeof v==='string'&&v.length>0&&v.length<=max&&!/[\u0000-\u001f\u007f<>]/.test(v),code);return v;};
const MAX_ALBUM=10,SCAN=19;
function scope(c,p){
 const s=p.scope;
 check(s&&typeof s==='object','SCOPE_INVALID');
 check(/^-100[1-9]\d{0,12}$/.test(s.groupId||'')&&s.groupId===c.allowedGroupId,'GROUP_NOT_ALLOWED');
 check(Number.isSafeInteger(s.topicId)&&s.topicId>0,'SCOPE_INVALID');
 check(safeId(s.recipientId)&&id(s.recipientId)!==id(c.expectedUserId),'RECIPIENT_INVALID');
 check(s.recipientUsername===undefined||s.recipientUsername===''||/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(s.recipientUsername),'RECIPIENT_INVALID');
 check(typeof s.activatedAt==='string'&&Number.isFinite(Date.parse(s.activatedAt)),'ACTIVATION_INVALID');
 const maxAge=Number.isInteger(s.maxAgeMinutes)?s.maxAgeMinutes:30;check(maxAge>=1&&maxAge<=360,'MAX_AGE_INVALID');
 // Album members arrive as separate updates; the operation waits this long so that the whole album exists before it is read.
 const wait=s.albumWaitMs===undefined?4000:s.albumWaitMs;check(Number.isInteger(wait)&&wait>=0&&wait<=15000,'SCOPE_INVALID');
 return {groupId:s.groupId,topicId:s.topicId,recipientId:id(s.recipientId),recipientUsername:s.recipientUsername||'',activated:Date.parse(s.activatedAt),maxAgeMs:maxAge*60000,albumWaitMs:wait,
  title:plain(s.captionTitle,120,'CAPTION_INVALID'),senderLabel:plain(s.senderLabel||'From',40,'CAPTION_INVALID')};
}
function eventOf(p,cfg,now){
 const u=p.update,m=u?.message;
 check(Number.isSafeInteger(u?.update_id)&&u.update_id>=0&&m&&!u.edited_message&&!u.callback_query,'EVENT_INVALID');
 check(m.chat?.type==='supergroup'&&String(m.chat.id)===cfg.groupId&&m.message_thread_id===cfg.topicId&&m.is_topic_message===true&&Number.isSafeInteger(m.message_id)&&m.message_id>0&&m.message_id!==cfg.topicId&&Number.isSafeInteger(m.date),'EVENT_NOT_IN_TOPIC');
 check(Array.isArray(m.photo)&&m.photo.length>0,'NOT_A_PHOTO');
 const t=m.date*1000;check(t>=cfg.activated&&t<=now+30000&&now-t<=cfg.maxAgeMs,'EVENT_STALE');
 const fromId=m.from&&!m.from.is_bot&&safeId(m.from.id)?id(m.from.id):'';
 const mediaGroupId=m.media_group_id==null?'':id(m.media_group_id);
 check(mediaGroupId===''||/^\d{1,20}$/.test(mediaGroupId),'EVENT_INVALID');
 // One claim per album: every member of the album resolves to the same key, so only the first update sends.
 const requestKey=mediaGroupId?'topic-image-forward:'+cfg.groupId+':album:'+mediaGroupId+':'+cfg.recipientId:'topic-image-forward:'+cfg.groupId+':'+m.message_id+':'+cfg.recipientId;
 return {messageId:m.message_id,at:t,fromId,mediaGroupId,requestKey};
}
function precheck(c,p,now=Date.now()){
 const cfg=scope(c,p),e=eventOf(p,cfg,now);
 check(p.claimValidated===true&&p.claimRequestKey===e.requestKey,'CLAIM_REQUIRED');
 return {cfg,e};
}
const randomId=(sender,key)=>bigInt((createHash('sha256').update('topic-image-forward-v1\0'+sender+'\0'+key).digest().readBigInt64BE(0)||1n).toString());
const topicOf=m=>m.replyTo?.forumTopic?(m.replyTo.replyToTopId||m.replyTo.replyToMsgId):1;
const isPhoto=m=>m&&m.className==='Message'&&m.photo&&m.photo.className==='Photo'&&Boolean(m.photo.fileReference);
function captionHtml(c,cfg,e,msg,from,postUrl){
 const when=new Date(e.at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:true})+' IST';
 let who='Unknown';
 if(from){
  const name=[from.firstName,from.lastName].filter(Boolean).join(' ')||from.username||id(from.id);
  who='<a href="tg://user?id='+id(from.id)+'">'+esc(name)+'</a>'+(from.username?' (@'+esc(from.username)+')':'')+' — ID <code>'+id(from.id)+'</code>';
 }
 return ['🖼️ <b>'+esc(cfg.title)+'</b>','👤 '+esc(cfg.senderLabel)+': '+who,'🕒 '+esc(when),'🔗 Post: '+postUrl].join('\n');
}
async function recipientPeer(client,c,cfg,bounded){
 const {found}=await resolveUsers(client,c,[cfg.recipientId],{[cfg.recipientId]:{name:cfg.recipientUsername}},bounded);
 let input=found.get(cfg.recipientId);
 if(!input&&cfg.recipientUsername){
  try{const r=await bounded(client.invoke(new Api.contacts.ResolveUsername({username:cfg.recipientUsername})));const u=(r?.users||[]).find(x=>id(x.id)===cfg.recipientId);if(u?.className==='User'&&!u.bot&&!u.deleted&&u.accessHash)input=new Api.InputUser({userId:u.id,accessHash:u.accessHash});}catch{}
 }
 check(input,'RECIPIENT_UNAVAILABLE');
 return new Api.InputPeerUser({userId:input.userId,accessHash:input.accessHash});
}
// The photos of the album the update belongs to: same grouped id, same topic, same sender, oldest first, at most ten.
async function albumPhotos(client,peer,msg,cfg,fromId,bounded){
 const gid=id(msg.groupedId);
 if(!gid)return [msg];
 const ids=[];for(let i=Math.max(1,msg.id-SCAN);i<=msg.id+SCAN;i++)ids.push(i);
 const found=(await bounded(client.getMessages(peer,{ids}))).filter(m=>isPhoto(m)&&id(m.groupedId)===gid&&topicOf(m)===cfg.topicId&&(fromId===''||id(m.fromId?.userId)===fromId));
 const unique=[...new Map([msg,...found].map(m=>[m.id,m])).values()].sort((a,b)=>a.id-b.id);
 return unique.slice(0,MAX_ALBUM);
}
async function run(operation,client,c,p,bounded,now=Date.now()){
 check(operation==='sendTopicImageForward','OPERATION');
 const {cfg,e}=precheck(c,p,now);
 if(e.mediaGroupId&&cfg.albumWaitMs>0)await new Promise(r=>setTimeout(r,cfg.albumWaitMs));
 const peer=await groupPeer(client,cfg.groupId,bounded);
 const msg=(await bounded(client.getMessages(peer,{ids:[e.messageId]})))[0];
 check(msg&&msg.className==='Message'&&msg.id===e.messageId,'SOURCE_MISSING');
 check(msg.photo&&msg.photo.className==='Photo'&&msg.photo.fileReference,'SOURCE_NOT_PHOTO');
 check(topicOf(msg)===cfg.topicId,'SOURCE_WRONG_TOPIC');
 const fromId=id(msg.fromId?.userId);
 check(e.fromId===''||fromId===''||fromId===e.fromId,'SOURCE_SENDER_MISMATCH');
 const photos=e.mediaGroupId?await albumPhotos(client,peer,msg,cfg,fromId,bounded):[msg];
 const anchor=photos[0];
 let from=null;
 if(fromId){
  const {found}=await resolveUsers(client,c,[fromId],{[fromId]:{messageId:anchor.id}},bounded);
  const sender=await bounded(anchor.getSender?anchor.getSender():Promise.resolve(null)).catch(()=>null);
  if(sender?.className==='User'&&id(sender.id)===fromId)from={id:sender.id,firstName:sender.firstName,lastName:sender.lastName,username:sender.username,mention:found.get(fromId)};
  else from={id:fromId,firstName:'',lastName:'',username:'',mention:found.get(fromId)};
 }
 const postUrl='https://t.me/'+c.allowedGroupUsername+'/'+cfg.topicId+'/'+anchor.id;
 const at=anchor.id===msg.id||!Number.isSafeInteger(anchor.date)?e.at:anchor.date*1000;
 const html=captionHtml(c,cfg,{at},anchor,from&&{...from,id:from.id},postUrl);
 const [text,parsed]=HTMLParser.parse(html);
 check(text.length>0&&text.length<=1024,'CAPTION_INVALID');
 const entities=parsed.flatMap(x=>x.className!=='MessageEntityMentionName'?[x]:from?.mention?[new Api.InputMessageEntityMentionName({offset:x.offset,length:x.length,userId:from.mention})]:[]);
 const to=await recipientPeer(client,c,cfg,bounded);
 const photoOf=m=>new Api.InputMediaPhoto({id:new Api.InputPhoto({id:m.photo.id,accessHash:m.photo.accessHash,fileReference:m.photo.fileReference})});
 const rid=randomId(c.expectedUserId,e.requestKey);
 const base={requestKey:e.requestKey,recipientId:cfg.recipientId,sourceMessageId:e.messageId,senderId:id(c.expectedUserId),postUrl};
 const album=photos.length>1;
 const rids=album?photos.map((_,i)=>randomId(c.expectedUserId,e.requestKey+'#'+i)):[rid];
 let result;
 try{
  result=album
   ?await bounded(client.invoke(new Api.messages.SendMultiMedia({peer:to,multiMedia:photos.map((m,i)=>new Api.InputSingleMedia({media:photoOf(m),randomId:rids[i],message:i===0?text:'',entities:i===0?entities:[]}))})))
   :await bounded(client.invoke(new Api.messages.SendMedia({peer:to,media:photoOf(msg),message:text,entities,randomId:rid})));
 }
 catch(err){
  const code=err?.errorMessage||'';
  if(REJECTED.test(code))return {status:'rejected',code,...base};
  if(/^FLOOD_WAIT_\d+$/.test(code))return {status:'rejected',code:'FLOOD_WAIT',...base};
  throw Error('NNA_TOPICFWD_DELIVERY_UNCONFIRMED');
 }
 const updates=result?.updates||[];
 const mids=rids.map(r=>updates.find(x=>x.className==='UpdateMessageID'&&id(x.randomId)===id(r))?.id||(!album&&result?.className==='UpdateShortSentMessage'?result.id:0));
 check(mids.every(m=>Number.isSafeInteger(m)&&m>0),'DELIVERY_UNCONFIRMED');
 let verified=false;
 try{const sent=(await bounded(client.getMessages(to,{ids:[mids[0]]})))[0];verified=Boolean(sent&&sent.out===true&&sent.photo&&String(sent.message||'').trimEnd()===text.trimEnd());}catch{verified=false;}
 return {status:'sent',...base,messageId:mids[0],...(album?{messageIds:mids,albumCount:mids.length}:{}),verified,mentionResolved:Boolean(from?.mention)};
}
module.exports={scope,eventOf,precheck,randomId,captionHtml,albumPhotos,run};
