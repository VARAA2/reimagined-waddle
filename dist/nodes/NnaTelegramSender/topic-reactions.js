'use strict';
const {Api,utils}=require('teleproto'),bigInt=require('big-integer');
const {getReactions,reactionKey}=require('./reactions');
function topicReactionConfig(p){
 const ids=String(p.topicReactionEmojiPool||'').split(',').map(x=>x.trim());
 if(!/^-100[1-9]\d{0,12}$/.test(p.topicReactionGroupId||'')||!Number.isSafeInteger(p.topicReactionTopicId)||p.topicReactionTopicId<=0||ids.length<3||ids.length>50||new Set(ids).size!==ids.length||!ids.every(x=>/^[1-9]\d{0,19}$/.test(x))||!Number.isFinite(Date.parse(p.topicReactionActivatedAt)))throw Error('NNA_TOPIC_REACTION_CONFIG_INVALID');
 return ids;
}
function topicReactionEvent(u,p,now=Date.now()){
 topicReactionConfig(p);const m=u?.message;
 if(!Number.isSafeInteger(u?.update_id)||u.update_id<0||!m||u.edited_message||u.callback_query||m.chat?.type!=='supergroup'||String(m.chat.id)!==p.topicReactionGroupId||m.message_thread_id!==p.topicReactionTopicId||m.is_topic_message!==true||!Number.isSafeInteger(m.message_id)||m.message_id<=0||m.message_id===p.topicReactionTopicId||!Number.isSafeInteger(m.date))return null;
 const t=m.date*1000;if(t<Date.parse(p.topicReactionActivatedAt)||t>now+30000||now-t>1800000)return null;
 const hasContent=typeof m.text==='string'&&m.text.length>0||Array.isArray(m.photo)&&m.photo.length>0||['video','document','audio','voice','animation','sticker','video_note','poll','contact','location','venue','dice'].some(k=>m[k]&&typeof m[k]==='object');
 if(!hasContent)return null;
 return {requestKey:`topic-reaction:${p.topicReactionGroupId}:${m.message_id}`,messageId:m.message_id,topicId:p.topicReactionTopicId,chatId:p.topicReactionGroupId,messageDate:m.date,targetUrl:`https://t.me/c/${p.topicReactionGroupId.slice(4)}/${p.topicReactionTopicId}/${m.message_id}`,update:u};
}
function chooseThree(pool,random=Math.random){
 if(!Array.isArray(pool)||pool.length<3||new Set(pool).size!==pool.length)throw Error('NNA_TOPIC_REACTION_POOL_INVALID');
 const remaining=pool.slice(),chosen=[];
 for(let i=0;i<3;i++){const r=random();if(!Number.isFinite(r)||r<0||r>=1)throw Error('NNA_TOPIC_REACTION_RANDOM_INVALID');chosen.push(remaining.splice(Math.floor(r*remaining.length),1)[0]);}
 return chosen;
}
function topicReactionClaim(p,now=Date.now()){
 const pool=topicReactionConfig(p),e=topicReactionEvent(p.update,p,now),ids=p.selectedEmojiIds;
 if(!e||p.claimValidated!==true||p.claimRequestKey!==e.requestKey||!Array.isArray(ids)||ids.length!==3||new Set(ids).size!==3||!ids.every(x=>pool.includes(x))||p.claimEmojiIds!==ids.join(','))throw Error('NNA_TOPIC_REACTION_CLAIM_REQUIRED');
 return {e,ids};
}
async function topicReactionScope(client,c,p,bounded){
 const pool=topicReactionConfig(p);if(p.topicReactionGroupId!==c.allowedGroupId)throw Error('NNA_TOPIC_REACTION_GROUP_NOT_ALLOWED');
 const g=await bounded(client.getEntity(c.allowedGroupUsername));
 if(g?.className!=='Channel'||!g.megagroup||!g.forum||g.left||g.kicked||String(utils.getPeerId(g))!==p.topicReactionGroupId)throw Error('NNA_TOPIC_REACTION_GROUP_UNAVAILABLE');
 const peer=await bounded(client.getInputEntity(g)),full=await bounded(client.invoke(new Api.channels.GetFullChannel({channel:peer})));
 if(!full.fullChat||(full.fullChat.defaultSendAs&&String(full.fullChat.defaultSendAs.userId)!==String(c.expectedUserId)))throw Error('NNA_REACTION_SENDER_IS_NOT_PERSONAL_ACCOUNT');
 const r=await bounded(client.invoke(new Api.messages.GetForumTopicsByID({peer,topics:[p.topicReactionTopicId]}))),topic=r.topics?.find(t=>t.id===p.topicReactionTopicId&&t.className==='ForumTopic');
 if(!topic||topic.closed)throw Error('NNA_TOPIC_REACTION_TOPIC_UNAVAILABLE');
 const docs=await bounded(client.invoke(new Api.messages.GetCustomEmojiDocuments({documentId:pool.map(x=>bigInt(x))})));
 if(!pool.every(id=>docs.some(d=>d.className==='Document'&&String(d.id)===id&&d.attributes?.some(a=>a.className==='DocumentAttributeCustomEmoji'))))throw Error('NNA_CUSTOM_EMOJI_UNAVAILABLE');
 return {peer,pool,topicName:topic.title};
}
async function reactToTopicPost(operation,client,c,p,bounded,now=Date.now()){
 const claim=operation==='reactToTopicPost'?topicReactionClaim(p,now):null;
 const {peer,pool,topicName}=await topicReactionScope(client,c,p,bounded);
 if(!claim)return {verified:true,senderId:String(c.expectedUserId),groupId:p.topicReactionGroupId,topicId:p.topicReactionTopicId,topicName,customEmojiPool:pool};
 const {e,ids}=claim,m=(await bounded(client.getMessages(peer,{ids:[e.messageId]})))[0];
 if(m?.className!=='Message'||m.id!==e.messageId||String(utils.getPeerId(m.peerId))!==p.topicReactionGroupId||!m.replyTo?.forumTopic||Number(m.replyTo.replyToTopId||m.replyTo.replyToMsgId)!==p.topicReactionTopicId||Number(m.date)!==e.messageDate)throw Error('NNA_TOPIC_REACTION_SOURCE_MISMATCH');
 const source=e.update.message;if(m.editDate||!(m.message||m.media)||m.message!==(source.text||source.caption||''))throw Error('NNA_TOPIC_REACTION_SOURCE_CHANGED');
 const before=m.reactions?.results?.some(r=>Number(r.count)>0)?await getReactions(client,peer,e.messageId,bounded):[];
 const own=before.filter(r=>String(r.peerId?.userId)===String(c.expectedUserId)).map(r=>r.reaction).filter(reactionKey),wanted=ids.map(id=>new Api.ReactionCustomEmoji({documentId:bigInt(id)}));
 const info={senderId:String(c.expectedUserId),requestKey:e.requestKey,targetChatId:p.topicReactionGroupId,targetMessageId:e.messageId,topicId:p.topicReactionTopicId,customEmojiIds:ids};
 if(wanted.every(w=>own.some(r=>reactionKey(r)===reactionKey(w))))return {status:'already_present',...info};
 const combined=[...new Map([...own,...wanted].map(r=>[reactionKey(r),r])).values()];if(combined.length>3)throw Error('NNA_EXISTING_REACTIONS_NEED_REVIEW');
 try{
  await bounded(client.invoke(new Api.messages.SendReaction({peer,msgId:e.messageId,reaction:combined,big:false,addToRecent:false})));
  const after=await getReactions(client,peer,e.messageId,bounded);
  if(!wanted.every(w=>after.some(r=>String(r.peerId?.userId)===String(c.expectedUserId)&&reactionKey(r.reaction)===reactionKey(w))))throw Error('NNA_REACTION_UNCONFIRMED');
  return {status:'reacted',...info};
 }catch(err){if(['REACTION_INVALID','REACTIONS_TOO_MANY','CUSTOM_REACTIONS_TOO_MANY','PREMIUM_ACCOUNT_REQUIRED','CHAT_WRITE_FORBIDDEN','DOCUMENT_INVALID','USER_BANNED_IN_CHANNEL'].includes(err.errorMessage))throw Error('NNA_'+err.errorMessage);throw Error('NNA_REACTION_UNCONFIRMED');}
}
module.exports={topicReactionConfig,topicReactionEvent,chooseThree,topicReactionClaim,reactToTopicPost};
