'use strict';
const {Api,utils}=require('teleproto'),bigInt=require('big-integer');
const {getReactions,reactionKey}=require('./reactions');
function imageReactionConfig(p){
 const ids=String(p.imageEmojiIds||'').split(',').map(x=>x.trim());
 if(!/^-100[1-9]\d{0,12}$/.test(p.imageGroupId||'')||!Number.isSafeInteger(p.imageTopicId)||p.imageTopicId<=0||ids.length!==3||new Set(ids).size!==3||!ids.every(x=>/^[1-9]\d{0,19}$/.test(x))||!Number.isInteger(p.imageStartHour)||!Number.isInteger(p.imageEndHour)||p.imageStartHour<0||p.imageEndHour>24||p.imageStartHour>=p.imageEndHour||!Number.isFinite(Date.parse(p.imageActivatedAt)))throw Error('NNA_INVALID_IMAGE_CONFIG');
 return ids;
}
function imageReactionEvent(u,p,now=Date.now()){
 imageReactionConfig(p);const m=u?.message;
 if(!Number.isSafeInteger(u?.update_id)||u.update_id<0||!m||u.edited_message||u.callback_query||m.chat?.type!=='supergroup'||String(m.chat.id)!==p.imageGroupId||m.message_thread_id!==p.imageTopicId||m.is_topic_message!==true||!Number.isSafeInteger(m.message_id)||m.message_id<=0||!Number.isSafeInteger(m.date))return null;
 const t=m.date*1000,local=new Date(t+19800000),current=new Date(now+19800000);
 if(t<Date.parse(p.imageActivatedAt)||t>now+30000||now-t>1800000||local.toISOString().slice(0,10)!==current.toISOString().slice(0,10)||local.getUTCHours()<p.imageStartHour||local.getUTCHours()>=p.imageEndHour)return null;
 const photo=Array.isArray(m.photo)&&m.photo.length>0,doc=m.document;
 if(!photo&&!(doc&&/^image\/(?:jpeg|png|webp|heic|heif|bmp|tiff)$/i.test(doc.mime_type||'')&&!m.sticker&&!m.animation))return null;
 return {requestKey:`image:${p.imageGroupId}:${m.message_id}`,messageId:m.message_id,topicId:p.imageTopicId,chatId:p.imageGroupId,messageDate:m.date,mediaKind:photo?'photo':'document',targetUrl:`https://t.me/c/${p.imageGroupId.slice(4)}/${p.imageTopicId}/${m.message_id}`,update:u};
}
async function imageScope(client,c,p,bounded){
 const ids=imageReactionConfig(p);if(p.imageGroupId!==c.allowedGroupId)throw Error('NNA_IMAGE_GROUP_NOT_ALLOWED');
 const g=await bounded(client.getEntity(c.allowedGroupUsername));
 if(g?.className!=='Channel'||!g.megagroup||!g.forum||g.left||g.kicked||String(utils.getPeerId(g))!==p.imageGroupId)throw Error('NNA_IMAGE_GROUP_NOT_ACCESSIBLE');
 const peer=await bounded(client.getInputEntity(g));const full=await bounded(client.invoke(new Api.channels.GetFullChannel({channel:peer})));
 if(!full.fullChat||(full.fullChat.defaultSendAs&&String(full.fullChat.defaultSendAs.userId)!==String(c.expectedUserId)))throw Error('NNA_REACTION_SENDER_IS_NOT_PERSONAL_ACCOUNT');
 const topics=await bounded(client.invoke(new Api.messages.GetForumTopicsByID({peer,topics:[p.imageTopicId]})));
 const topic=topics.topics?.find(t=>t.id===p.imageTopicId&&t.className==='ForumTopic');if(!topic)throw Error('NNA_IMAGE_TOPIC_NOT_FOUND');
 const docs=await bounded(client.invoke(new Api.messages.GetCustomEmojiDocuments({documentId:ids.map(x=>bigInt(x))})));
 if(!ids.every(id=>docs.some(d=>d.className==='Document'&&String(d.id)===id&&d.attributes?.some(a=>a.className==='DocumentAttributeCustomEmoji'))))throw Error('NNA_CUSTOM_EMOJI_UNAVAILABLE');
 return {peer,ids,topicName:topic.title};
}
async function scheduledImageReaction(operation,client,c,p,bounded,now=Date.now()){
 let e;if(operation==='reactToScheduledImage'){e=imageReactionEvent(p.update,p,now);if(!e||p.claimValidated!==true||p.claimRequestKey!==e.requestKey)throw Error('NNA_IMAGE_CLAIM_REQUIRED');}
 const {peer,ids,topicName}=await imageScope(client,c,p,bounded);
 if(operation==='inspectImageReactionScope')return {verified:true,senderId:String(c.expectedUserId),groupId:p.imageGroupId,topicId:p.imageTopicId,topicName,customEmojiIds:ids,startHour:p.imageStartHour,endHour:p.imageEndHour,timezone:'Asia/Kolkata'};
 const m=(await bounded(client.getMessages(peer,{ids:[e.messageId]})))[0];
 if(m?.className!=='Message'||m.id!==e.messageId||String(utils.getPeerId(m.peerId))!==p.imageGroupId||!m.replyTo?.forumTopic||Number(m.replyTo.replyToTopId||m.replyTo.replyToMsgId)!==p.imageTopicId||Number(m.date)!==e.messageDate)throw Error('NNA_IMAGE_SOURCE_MISMATCH');
 const doc=m.media?.document;const valid=e.mediaKind==='photo'?m.media?.className==='MessageMediaPhoto':m.media?.className==='MessageMediaDocument'&&/^image\/(?:jpeg|png|webp|heic|heif|bmp|tiff)$/i.test(doc?.mimeType||'')&&!doc.attributes?.some(a=>['DocumentAttributeSticker','DocumentAttributeAnimated','DocumentAttributeVideo'].includes(a.className));
 if(!valid||m.editDate)throw Error('NNA_IMAGE_SOURCE_CHANGED');
 const before=m.reactions?.results?.some(r=>Number(r.count)>0)?await getReactions(client,peer,e.messageId,bounded):[];
 const own=before.filter(r=>String(r.peerId?.userId)===String(c.expectedUserId)).map(r=>r.reaction).filter(reactionKey),wanted=ids.map(id=>new Api.ReactionCustomEmoji({documentId:bigInt(id)}));
 const info={senderId:String(c.expectedUserId),requestKey:e.requestKey,targetChatId:p.imageGroupId,targetMessageId:e.messageId,topicId:p.imageTopicId,customEmojiIds:ids};
 if(wanted.every(w=>own.some(r=>reactionKey(r)===reactionKey(w))))return {status:'already_present',...info};
 const combined=[...new Map([...own,...wanted].map(r=>[reactionKey(r),r])).values()];if(combined.length>3)throw Error('NNA_EXISTING_REACTIONS_NEED_REVIEW');
 try{await bounded(client.invoke(new Api.messages.SendReaction({peer,msgId:e.messageId,reaction:combined,big:false,addToRecent:false})));
 const after=await getReactions(client,peer,e.messageId,bounded);if(!wanted.every(w=>after.some(r=>String(r.peerId?.userId)===String(c.expectedUserId)&&reactionKey(r.reaction)===reactionKey(w))))throw Error('NNA_REACTION_UNCONFIRMED');
 return {status:'reacted',...info};
 }catch(err){if(['REACTION_INVALID','REACTIONS_TOO_MANY','PREMIUM_ACCOUNT_REQUIRED','CHAT_WRITE_FORBIDDEN'].includes(err.errorMessage))throw Error('NNA_'+err.errorMessage);throw Error('NNA_REACTION_UNCONFIRMED');}
}
module.exports={imageReactionConfig,imageReactionEvent,scheduledImageReaction};
