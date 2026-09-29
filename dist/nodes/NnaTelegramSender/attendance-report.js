'use strict';
const {Api,utils}=require('teleproto');
const {HTMLParser}=require('teleproto/extensions/html');
const bigInt=require('big-integer');
const {createHash}=require('node:crypto');
const {groupPeer}=require('./media-publish');
// Sends the weekly Live attendance report as the personal account so that people without a username
// become real clickable mentions (a bot can only mention users it has met). Destination is either the
// account's Saved Messages or one configured group topic. Mentions that cannot be resolved degrade to
// plain text; they never block the report. Nothing is retried automatically.
const id=v=>String(v??''),positive=v=>Number.isSafeInteger(v)&&v>0;
const check=(ok,code)=>{if(!ok)throw Error('NNA_REPORT_'+code);};
const MAX_PARTS=10,MAX_TEXT=4096;

function config(c,p){
 const r=p.report,extra=p.attendanceExtraGroupId||'';
 check(r&&typeof r==='object'&&/^[A-Za-z0-9:|._-]{3,200}$/.test(r.reportKey||''),'KEY_INVALID');
 check(extra===''||/^-100[1-9]\d{0,12}$/.test(extra),'SCOPE_INVALID');
 const target=r.targetGroupId||'';
 check(target===''||(/^-100[1-9]\d{0,12}$/.test(target)&&(target===c.allowedGroupId||target===extra)),'TARGET_NOT_ALLOWED');
 check(Number.isSafeInteger(r.topicId||0)&&(r.topicId||0)>=0&&(target!==''||!r.topicId),'TOPIC_INVALID');
 check(Array.isArray(r.parts)&&r.parts.length>=1&&r.parts.length<=MAX_PARTS,'PARTS_INVALID');
 return {target,topicId:r.topicId||0,reportKey:r.reportKey};
}
function parsePart(html){
 check(typeof html==='string'&&html.length>0&&html.length<=16000,'BODY_INVALID');
 const stack=[];
 for(const m of html.matchAll(/<[^>]*>/g)){
  const t=/^<(\/)?(b|code|a)(?: href="(tg:\/\/user\?id=[1-9]\d{0,15}|https:\/\/t\.me\/[A-Za-z0-9_]{4,32})")?>$/.exec(m[0]);
  check(t&&(t[2]==='a'?(t[1]?!t[3]:!!t[3]):!t[3]),'HTML_INVALID');
  if(t[1])check(stack.pop()===t[2],'HTML_INVALID');else stack.push(t[2]);
 }
 check(stack.length===0,'HTML_INVALID');
 const [text,entities]=HTMLParser.parse(html);
 check(text.length>0&&text.length<=MAX_TEXT&&entities.every(e=>['MessageEntityBold','MessageEntityCode','MessageEntityMentionName','MessageEntityTextUrl'].includes(e.className)),'BODY_INVALID');
 return {text,entities};
}
function randomId(sender,reportKey,part){const b=createHash('sha256').update('attendance-report-v1\0'+sender+'\0'+reportKey+'\0'+part).digest();return bigInt((b.readBigInt64BE(0)||1n).toString());}

// Tiers, cheapest first: session cache, stored access hash (verified), a message the person wrote
// (returns the full user), then a member search by name. Each network step is skipped once resolved.
async function resolveUsers(client,c,userIds,hints,bounded){
 const found=new Map(),wanted=[...new Set(userIds.map(id))];
 const tryCache=async u=>{if(found.has(u))return;try{found.set(u,utils.getInputUser(await bounded(client.getInputEntity(bigInt(u)))));}catch{}};
 for(const u of wanted)await tryCache(u);
 for(const u of wanted){
  const h=hints?.[u];if(found.has(u)||!h?.accessHash||!/^-?\d{1,20}$/.test(String(h.accessHash)))continue;
  try{
   const input=new Api.InputUser({userId:bigInt(u),accessHash:bigInt(String(h.accessHash))});
   const r=await bounded(client.invoke(new Api.users.GetUsers({id:[input]})));
   if(r?.[0]?.className==='User'&&id(r[0].id)===u&&!r[0].min)found.set(u,input);
  }catch{}
 }
 const open=()=>wanted.filter(u=>!found.has(u));
 if(open().length){
  let peer;try{peer=await groupPeer(client,c.allowedGroupId,bounded);}catch{peer=null;}
  if(peer){
   for(const u of open()){
    const mid=hints?.[u]?.messageId;if(!positive(mid))continue;
    try{await bounded(client.getMessages(peer,{ids:[mid]}));}catch{continue;}
    await tryCache(u);
   }
   for(const u of open()){
    const q=String(hints?.[u]?.name||'').trim().slice(0,60);if(!q)continue;
    for(let offset=0;offset<1000&&!found.has(u);offset+=200){
     let r;try{r=await bounded(client.invoke(new Api.channels.GetParticipants({channel:peer,filter:new Api.ChannelParticipantsSearch({q}),offset,limit:200,hash:bigInt.zero})));}catch{break;}
     const list=r?.participants||[];
     await tryCache(u);
     if(list.length<200)break;
    }
   }
  }
 }
 return {found,unresolved:open()};
}
function entityMatches(actual,e){return actual?.some(a=>a.offset===e.offset&&a.length===e.length&&(e.className==='InputMessageEntityMentionName'?a.className==='MessageEntityMentionName'&&id(a.userId)===id(e.userId.userId):a.className===e.className));}

// Best-effort proof that the sent message is what we intended. Saved Messages are read with the raw request
// because the high level helper filters by peer and can hide a message that was really delivered.
async function readBack(client,peer,mid,text,entities,bounded){
 try{
  let m;
  if(peer.className==='InputPeerSelf'){
   const r=await bounded(client.invoke(new Api.messages.GetMessages({id:[new Api.InputMessageID({id:mid})]})));
   m=(r?.messages||[]).find(x=>x.id===mid);
  }else m=(await bounded(client.getMessages(peer,{ids:[mid]})))[0];
  if(!m||m.className!=='Message')return 'READBACK_MISSING';
  // Saved Messages are not flagged outgoing by Telegram, so the flag is only required for group topics.
  if(peer.className!=='InputPeerSelf'&&m.out!==true)return 'READBACK_NOT_OUTGOING';
  if(String(m.message||'').trimEnd()!==text.trimEnd())return 'READBACK_TEXT_DIFFERS';
  // Telegram may split bold spans that contain hashtags or links, so only mentions, links and code are compared.
  if(!entities.filter(e=>e.className!=='MessageEntityBold').every(e=>entityMatches(m.entities,e)))return 'READBACK_ENTITIES_DIFFER';
  return 'ok';
 }catch{return 'READBACK_FAILED';}
}

async function run(operation,client,c,p,bounded){
 check(operation==='sendAttendanceReport','OPERATION_INVALID');
 const cfg=config(c,p),r=p.report,parts=r.parts.map(parsePart);
 const mentionIds=parts.flatMap(x=>x.entities.filter(e=>e.className==='MessageEntityMentionName').map(e=>id(e.userId)));
 const {found,unresolved}=await resolveUsers(client,c,mentionIds,r.hints,bounded);
 const peer=cfg.target===''?new Api.InputPeerSelf():await groupPeer(client,cfg.target,bounded);
 const replyTo=cfg.topicId?new Api.InputReplyToMessage({replyToMsgId:cfg.topicId,topMsgId:cfg.topicId}):undefined;
 const sent=[],notes=[];let verifiedAll=true;
 for(let i=0;i<parts.length;i++){
  const {text}=parts[i];
  const entities=parts[i].entities.flatMap(e=>e.className!=='MessageEntityMentionName'?[e]:found.has(id(e.userId))?[new Api.InputMessageEntityMentionName({offset:e.offset,length:e.length,userId:found.get(id(e.userId))})]:[]);
  const rid=randomId(c.expectedUserId,cfg.reportKey,i+1);
  const send=list=>bounded(client.invoke(new Api.messages.SendMessage({peer,message:text,entities:list,randomId:rid,noWebpage:true,...(replyTo?{replyTo}:{})})));
  const errorName=e=>/^[A-Z0-9_]{3,40}$/.test(e?.errorMessage||'')?e.errorMessage:'';
  let result,sentEntities=entities;
  try{result=await send(entities);}
  catch(e){
   // A refused mention is a definite failure (nothing was created), so the same text may go once without mentions.
   const plain=entities.filter(x=>x.className!=='InputMessageEntityMentionName');
   if(/^(USER_ID_INVALID|PEER_ID_INVALID|ENTITY_MENTION_USER_INVALID|ENTITIES_TOO_LONG)$/.test(errorName(e))&&plain.length<entities.length){
    notes.push('MENTIONS_DROPPED_'+errorName(e));sentEntities=plain;
    try{result=await send(plain);}catch(e2){throw Error(errorName(e2)?'NNA_REPORT_SEND_REJECTED_'+errorName(e2):'NNA_REPORT_DELIVERY_UNCONFIRMED');}
   }else throw Error(errorName(e)?'NNA_REPORT_SEND_REJECTED_'+errorName(e):'NNA_REPORT_DELIVERY_UNCONFIRMED');
  }
  const updates=result?.updates||[],mid=updates.find(u=>u.className==='UpdateMessageID'&&id(u.randomId)===id(rid))?.id||(result?.className==='UpdateShortSentMessage'?result.id:0);
  check(positive(mid),'DELIVERY_UNCONFIRMED');
  // Telegram accepted the message. Reading it back is only extra proof and never turns a sent report into a failure.
  const proof=await readBack(client,peer,mid,text,sentEntities,bounded);
  sent.push(mid);verifiedAll=verifiedAll&&proof==='ok';if(proof!=='ok')notes.push(proof);
 }
 return {status:'sent',senderId:id(c.expectedUserId),reportKey:cfg.reportKey,destination:cfg.target===''?'saved_messages':cfg.target,topicId:cfg.topicId,messageIds:sent,parts:sent.length,mentionsResolved:found.size,mentionsUnresolved:unresolved,verified:verifiedAll&&!notes.length,verifyNotes:notes};
}
module.exports={config,parsePart,randomId,resolveUsers,entityMatches,run};
