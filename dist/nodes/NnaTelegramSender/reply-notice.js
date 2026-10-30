'use strict';
const {createHash}=require('node:crypto');
const {Api}=require('teleproto');
const {HTMLParser}=require('teleproto/extensions/html');
const bigInt=require('big-integer');
const {groupPeer}=require('./media-publish');
const {resolveUsers}=require('./attendance-report');
// Tells one person, in a private message from the personal account, that a configured operator account replied to their group
// message, and gives the URL of each reply. Every reply is proven again from Telegram (it exists, its sender is an operator, it
// replies to this person's message), one claim per notice, a deterministic random id, and no automatic retry. Refusals from the
// recipient or from Telegram's limits come back as status "rejected"; a notice with no provable reply left comes back as "skipped".
const id=v=>v==null?'':String(v);
const check=(ok,code)=>{if(!ok)throw Error('NNA_REPLYNOTICE_'+code);};
const safeId=v=>/^[1-9]\d{0,15}$/.test(id(v))&&Number.isSafeInteger(Number(v));
const positive=v=>Number.isSafeInteger(v)&&v>0;
const REJECTED=/^(USER_PRIVACY_RESTRICTED|USER_IS_BLOCKED|YOU_BLOCKED_USER|INPUT_USER_DEACTIVATED|USER_DEACTIVATED|USER_RESTRICTED|PEER_FLOOD|PREMIUM_ACCOUNT_REQUIRED|ALLOW_PAYMENT_REQUIRED|PRIVACY_PREMIUM_REQUIRED)$/;
const esc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const MAX_ITEMS=5;
function scope(c,p){
 const s=p.scope;
 check(s&&typeof s==='object','SCOPE_INVALID');
 check(/^-100[1-9]\d{0,12}$/.test(s.groupId||'')&&s.groupId===c.allowedGroupId,'GROUP_NOT_ALLOWED');
 check(typeof s.activatedAt==='string'&&Number.isFinite(Date.parse(s.activatedAt)),'ACTIVATION_INVALID');
 const maxAge=Number.isInteger(s.maxAgeMinutes)?s.maxAgeMinutes:2880;check(maxAge>=1&&maxAge<=10080,'MAX_AGE_INVALID');
 const ops=s.operators;
 check(ops&&typeof ops==='object'&&Object.keys(ops).length>0&&Object.keys(ops).length<=20,'OPERATORS_INVALID');
 for(const [k,v] of Object.entries(ops))check(safeId(k)&&typeof v==='string'&&v.length>0&&v.length<=60&&!/[\u0000-\u001f\u007f<>]/.test(v),'OPERATORS_INVALID');
 return {groupId:s.groupId,activated:Date.parse(s.activatedAt),maxAgeMs:maxAge*60000,operators:ops};
}
const cleanName=v=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().replace(/\s+soul$/i,'').slice(0,60).trim();
function noticeOf(cfg,p){
 const n=p.notice;
 check(n&&typeof n==='object'&&safeId(n.recipientId)&&!cfg.operators[id(n.recipientId)],'RECIPIENT_INVALID');
 check(n.recipientUsername===undefined||n.recipientUsername===''||/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(n.recipientUsername),'RECIPIENT_INVALID');
 const name=cleanName(n.recipientName);check(name.length>0,'RECIPIENT_INVALID');
 check(Array.isArray(n.items)&&n.items.length>=1&&n.items.length<=MAX_ITEMS,'ITEMS_INVALID');
 for(const i of n.items)check(i&&positive(i.replyMessageId)&&positive(i.repliedToMessageId)&&i.replyMessageId>i.repliedToMessageId,'ITEMS_INVALID');
 const items=[...new Map(n.items.map(i=>[i.replyMessageId,{replyMessageId:i.replyMessageId,repliedToMessageId:i.repliedToMessageId}])).values()].sort((a,b)=>a.replyMessageId-b.replyMessageId);
 const requestKey='reply-notice:'+cfg.groupId+':'+id(n.recipientId)+':'+items[0].replyMessageId;
 return {recipientId:id(n.recipientId),recipientUsername:n.recipientUsername||'',name,items,requestKey};
}
function precheck(c,p){
 const cfg=scope(c,p),n=noticeOf(cfg,p);
 check(p.claimValidated===true&&p.claimRequestKey===n.requestKey,'CLAIM_REQUIRED');
 return {cfg,n};
}
const randomId=(sender,key)=>bigInt((createHash('sha256').update('reply-notice-v1\0'+sender+'\0'+key).digest().readBigInt64BE(0)||1n).toString());
const topicOf=m=>m.replyTo?.forumTopic?(m.replyTo.replyToTopId||m.replyTo.replyToMsgId):1;
function replyUrl(handle,topic,messageId){return 'https://t.me/'+handle+'/'+(topic>1?topic+'/':'')+messageId;}
// Bold labels, short lines, the link alone after a line ending in the pointing hand, the signature last. One reply or many.
function noticeHtml(name,replies){
 const many=replies.length>1,accounts=[...new Set(replies.map(r=>r.account))];
 const lines=['Dear <b>'+esc(name)+'</b> Soul 🤍','','💬 <b>Reply</b> : உங்கள் செய்திக்கு','பதில் வந்துள்ளது Soul 🎉',''];
 lines.push('👤 <b>'+(accounts.length>1?'Accounts':'Account')+'</b> : '+accounts.map(esc).join(', '),'');
 if(many){
  lines.push('📖 <b>Open</b> : இந்த URL-களைத் திறந்து','பதில்களைப் பாருங்க Soul 👇','');
  for(const r of replies)lines.push('👤 '+esc(r.account)+' 👇','🔗 '+r.url,'');
 }else lines.push('📖 <b>Open</b> : இந்த URL-ஐத் திறந்து','பதிலைப் பாருங்க Soul 👇','','🔗 '+replies[0].url,'');
 lines.push('#NNA_BOT🤖');
 return lines.join('\n');
}
async function recipientPeer(client,c,n,hint,bounded){
 const {found}=await resolveUsers(client,c,[n.recipientId],{[n.recipientId]:hint},bounded);
 let input=found.get(n.recipientId);
 if(!input&&n.recipientUsername){
  try{const r=await bounded(client.invoke(new Api.contacts.ResolveUsername({username:n.recipientUsername})));const u=(r?.users||[]).find(x=>id(x.id)===n.recipientId);if(u?.className==='User'&&!u.bot&&!u.deleted&&u.accessHash)input=new Api.InputUser({userId:u.id,accessHash:u.accessHash});}catch{}
 }
 check(input,'RECIPIENT_UNAVAILABLE');
 return new Api.InputPeerUser({userId:input.userId,accessHash:input.accessHash});
}
// Only replies Telegram itself still confirms count; a deleted reply or a changed target is left out of the notice.
async function provenReplies(client,c,cfg,n,peer,bounded,now){
 const ids=n.items.flatMap(i=>[i.replyMessageId,i.repliedToMessageId]);
 const got=new Map((await bounded(client.getMessages(peer,{ids}))).filter(m=>m&&m.className==='Message').map(m=>[m.id,m]));
 const out=[];
 for(const i of n.items){
  const m=got.get(i.replyMessageId),t=got.get(i.repliedToMessageId);
  if(!m||!t||m.replyTo?.replyToMsgId!==t.id||m.replyTo.replyToPeerId)continue;
  const account=cfg.operators[id(m.fromId?.userId)];
  if(!account||id(t.fromId?.userId)!==n.recipientId)continue;
  const at=m.date*1000;
  if(!(at>=cfg.activated)||at>now+30000||now-at>cfg.maxAgeMs)continue;
  out.push({account,messageId:m.id,repliedToMessageId:t.id,url:replyUrl(c.allowedGroupUsername,topicOf(m),m.id)});
 }
 return out;
}
async function run(operation,client,c,p,bounded,now=Date.now()){
 check(operation==='sendReplyNotice','OPERATION');
 const {cfg,n}=precheck(c,p);
 const base={requestKey:n.requestKey,recipientId:n.recipientId,senderId:id(c.expectedUserId)};
 const peer=await groupPeer(client,cfg.groupId,bounded);
 const replies=await provenReplies(client,c,cfg,n,peer,bounded,now);
 if(!replies.length)return {status:'skipped',code:'NO_PROVEN_REPLY',...base};
 const to=await recipientPeer(client,c,n,{messageId:replies[0].repliedToMessageId,name:n.name},bounded);
 const [text,entities]=HTMLParser.parse(noticeHtml(n.name,replies));
 check(text.length>0&&text.length<=4096,'TEXT_INVALID');
 const rid=randomId(c.expectedUserId,n.requestKey);
 const proven={replyMessageIds:replies.map(r=>r.messageId),urls:replies.map(r=>r.url),accounts:[...new Set(replies.map(r=>r.account))]};
 let result;
 try{result=await bounded(client.invoke(new Api.messages.SendMessage({peer:to,message:text,entities,randomId:rid,noWebpage:true})));}
 catch(err){
  const code=err?.errorMessage||'';
  if(REJECTED.test(code))return {status:'rejected',code,...base,...proven};
  if(/^FLOOD_WAIT_\d+$/.test(code))return {status:'rejected',code:'FLOOD_WAIT',...base,...proven};
  throw Error('NNA_REPLYNOTICE_DELIVERY_UNCONFIRMED');
 }
 const updates=result?.updates||[];
 const mid=updates.find(x=>x.className==='UpdateMessageID'&&id(x.randomId)===id(rid))?.id||(result?.className==='UpdateShortSentMessage'?result.id:0);
 check(positive(mid),'DELIVERY_UNCONFIRMED');
 let verified=false;
 try{const sent=(await bounded(client.getMessages(to,{ids:[mid]})))[0];verified=Boolean(sent&&sent.out===true&&String(sent.message||'').trimEnd()===text.trimEnd());}catch{verified=false;}
 return {status:'sent',...base,...proven,messageId:mid,verified};
}
module.exports={scope,noticeOf,precheck,randomId,replyUrl,noticeHtml,provenReplies,run};
