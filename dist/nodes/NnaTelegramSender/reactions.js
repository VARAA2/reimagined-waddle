'use strict';
const {Api,utils}=require('teleproto');const bigInt=require('big-integer');
const {targetFromUrl,operatorIds,parseDirectRequest,resolveTarget}=require('./direct');
function need(ok,code){if(!ok)throw new Error(code);}
function reactionKey(r){if(r?.className==='ReactionEmoji')return 'emoji:'+r.emoticon;if(r?.className==='ReactionCustomEmoji')return 'custom:'+String(r.documentId);return '';}
function reactionValue(r){return r.className==='ReactionEmoji'?{type:'emoji',emoji:r.emoticon}:{type:'custom_emoji',customEmojiId:String(r.documentId)};}
function request(p){
 const source=targetFromUrl(p.reactionSourceUrl),target=targetFromUrl(p.reactionTargetUrl);
 need(/^-100[1-9]\d+$/.test(p.reactionGroupId||''),'NNA_INVALID_REACTION_GROUP');
 need(source.peer===p.reactionGroupId&&target.peer===p.reactionGroupId&&source.messageId!==target.messageId,'NNA_REACTION_SCOPE_MISMATCH');
 return {source,target,operators:operatorIds(p.reactionOperatorIds).map(String)};
}
async function getReactions(client,peer,messageId,bounded){
 let offset='',rows=[];const seen=new Set();
 for(let page=0;page<10;page++){
  const r=await bounded(client.invoke(new Api.messages.GetMessageReactionsList({peer,id:messageId,limit:100,...(offset?{offset}:{})})));
  need(Array.isArray(r.reactions),'NNA_REACTION_LIST_UNAVAILABLE');rows.push(...r.reactions);
  if(!r.nextOffset)return rows;
  need(!seen.has(r.nextOffset),'NNA_REACTION_CURSOR_STALLED');seen.add(r.nextOffset);offset=r.nextOffset;
 }
 throw new Error('NNA_REACTION_LIST_PARTIAL');
}
async function prepareReaction(client,c,p,bounded){
 const q=request(p);let group;
 try{group=await bounded(client.getEntity(bigInt(p.reactionGroupId)));}catch{
  const dialogs=await bounded(client.getDialogs({limit:500}));group=dialogs.map(d=>d.entity).find(e=>e?.className==='Channel'&&String(utils.getPeerId(e))===p.reactionGroupId);
 }
 need(group?.className==='Channel'&&group.megagroup===true&&!group.left&&!group.kicked&&String(utils.getPeerId(group))===p.reactionGroupId,'NNA_REACTION_GROUP_NOT_ACCESSIBLE');
 const peer=await bounded(client.getInputEntity(group));
 const messages=await bounded(client.getMessages(peer,{ids:[q.source.messageId,q.target.messageId]}));
 for(const t of [q.source,q.target]){
  const m=messages.find(m=>m?.id===t.messageId);
  need(m?.className==='Message'&&String(utils.getPeerId(m.peerId))===p.reactionGroupId,'NNA_REACTION_MESSAGE_MISSING');
  need(!t.topicId||(m.replyTo?.forumTopic&&Number(m.replyTo.replyToTopId||m.replyTo.replyToMsgId)===t.topicId),'NNA_REACTION_WRONG_TOPIC');
 }
 const sourceRows=await getReactions(client,peer,q.source.messageId,bounded);
 const sourceUserRows=sourceRows.filter(r=>q.operators.includes(String(r.peerId?.userId)));
 const keys=[...new Set(sourceUserRows.map(r=>reactionKey(r.reaction)).filter(Boolean))];
 need(keys.length===1,keys.length?'NNA_REACTION_SOURCE_AMBIGUOUS':'NNA_NO_OPERATOR_REACTION_ON_SOURCE');
 const selected=sourceUserRows.find(r=>reactionKey(r.reaction)===keys[0]).reaction;
 const full=await bounded(client.invoke(new Api.channels.GetFullChannel({channel:peer})));
 const sendAs=full.fullChat?.defaultSendAs;
 need(full.fullChat&&(!sendAs||String(sendAs.userId)===String(c.expectedUserId)),'NNA_REACTION_SENDER_IS_NOT_PERSONAL_ACCOUNT');
 // Telegram may return MSG_ID_INVALID for a valid message with no reactions.
 // Use the freshly fetched message summary to skip that empty-list RPC only;
 // never reinterpret a failed listing on a nonempty message as an empty result.
 const targetMessage=messages.find(m=>m.id===q.target.messageId);
 const hasTargetReactions=targetMessage.reactions?.results?.some(r=>Number(r.count)>0)===true;
 const targetRows=hasTargetReactions?await getReactions(client,peer,q.target.messageId,bounded):[];
 const current=targetRows.filter(r=>String(r.peerId?.userId)===String(c.expectedUserId)).map(r=>r.reaction).filter(r=>reactionKey(r));
 const result={senderId:String(c.expectedUserId),groupId:p.reactionGroupId,sourceMessageId:q.source.messageId,targetMessageId:q.target.messageId,sourceUrl:p.reactionSourceUrl,targetUrl:p.reactionTargetUrl,sourceReactorIds:[...new Set(sourceUserRows.filter(r=>reactionKey(r.reaction)===keys[0]).map(r=>String(r.peerId.userId)))],reaction:reactionValue(selected),alreadyPresent:current.some(r=>reactionKey(r)===keys[0])};
 return {q,peer,selected,current,result};
}
async function runReaction(operation,client,c,p,bounded){
 const prep=await prepareReaction(client,c,p,bounded);
 if(operation==='inspectReactionCopy')return {status:'ready',...prep.result};
 if(prep.result.alreadyPresent)return {status:'already_present',...prep.result};
 const wanted=reactionKey(prep.selected);
 // Preserve any existing personal reactions; never remove another selection.
 const reactions=[...new Map([...prep.current,prep.selected].map(r=>[reactionKey(r),r])).values()];
 try{
  await bounded(client.invoke(new Api.messages.SendReaction({peer:prep.peer,msgId:prep.q.target.messageId,reaction:reactions,big:false,addToRecent:false})));
  const after=await getReactions(client,prep.peer,prep.q.target.messageId,bounded);
  need(after.some(r=>String(r.peerId?.userId)===String(c.expectedUserId)&&reactionKey(r.reaction)===wanted),'NNA_REACTION_UNCONFIRMED');
  return {status:'reacted',...prep.result};
 }catch{throw new Error('NNA_REACTION_UNCONFIRMED');}
}
async function sendDirectReaction(client,c,p,bounded,now=Date.now()){
 const e=parseDirectRequest(p.update,p,now);
 need(e?.kind==='reaction','NNA_INVALID_REACTION_REQUEST');
 need(p.claimValidated===true&&p.claimRequestKey===e.requestKey&&p.claimOperatorId===e.operatorId&&p.claimBody===e.body&&p.claimUrl===e.targetUrl,'NNA_DIRECT_CLAIM_REQUIRED');
 const {group,peer,source,topic}=await resolveTarget(client,e.target,bounded);
 const full=await bounded(client.invoke(new Api.channels.GetFullChannel({channel:peer})));
 const sendAs=full.fullChat?.defaultSendAs;need(full.fullChat&&(!sendAs||String(sendAs.userId)===String(c.expectedUserId)),'NNA_REACTION_SENDER_IS_NOT_PERSONAL_ACCOUNT');
 const rows=source.reactions?.results?.some(r=>Number(r.count)>0)?await getReactions(client,peer,e.target.messageId,bounded):[];
 const own=rows.filter(r=>String(r.peerId?.userId)===String(c.expectedUserId)).map(r=>r.reaction).filter(reactionKey);
 const wanted=e.reaction.type==='emoji'?new Api.ReactionEmoji({emoticon:e.reaction.emoji}):new Api.ReactionCustomEmoji({documentId:bigInt(e.reaction.customEmojiId)});
 const info={requestKey:e.requestKey,operatorId:e.operatorId,senderId:String(c.expectedUserId),targetChatId:String(utils.getPeerId(group)),targetMessageId:e.target.messageId,topicId:topic,targetUrl:e.targetUrl,reaction:e.reaction};
 if(own.some(r=>reactionKey(r)===reactionKey(wanted)))return {status:'already_present',...info};
 try{
  await bounded(client.invoke(new Api.messages.SendReaction({peer,msgId:e.target.messageId,reaction:[...own,wanted],big:false,addToRecent:false})));
  const after=await getReactions(client,peer,e.target.messageId,bounded);
  need(after.some(r=>String(r.peerId?.userId)===String(c.expectedUserId)&&reactionKey(r.reaction)===reactionKey(wanted)),'NNA_REACTION_UNCONFIRMED');
  return {status:'reacted',...info};
 }catch(error){
  const safeRpc=['REACTION_INVALID','REACTIONS_TOO_MANY','PREMIUM_ACCOUNT_REQUIRED','CHAT_WRITE_FORBIDDEN'];
  if(safeRpc.includes(error.errorMessage))throw Error('NNA_'+error.errorMessage);
  throw Error('NNA_REACTION_UNCONFIRMED');
 }
}
module.exports={request,reactionKey,getReactions,prepareReaction,runReaction,sendDirectReaction};
