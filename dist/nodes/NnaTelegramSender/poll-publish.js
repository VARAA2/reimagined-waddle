'use strict';
const {Api,utils}=require('teleproto'),bigInt=require('big-integer'),{groupPeer,caption,entityMatches,randomId}=require('./media-publish'),{parsePollText}=require('./poll-content');
const check=(ok,code)=>{if(!ok)throw Error('NNA_POLL_'+code);},sid=x=>String(x??'');
function validatePoll(c,p,now=Date.now()){
 const cfg=p.config,d=p.delivery,cb=d?.update?.callback_query;
 check(d?.mode==='poll'&&d.claimValidated===true&&d.requestKey===`poll:${d.operatorId}:${d.chatId}:${d.topicId}:${d.revision}`,'CLAIM');
 check(cfg?.operatorIds?.includes(d.operatorId)&&Number.isSafeInteger(d.update.update_id)&&cb?.from?.is_bot===false&&sid(cb.from.id)===d.operatorId&&cb.data===`pp:${d.operatorId}:${d.revision}:publish`,'APPROVAL');
 check(cb.message?.from?.is_bot===true&&sid(cb.message.from.id)===cfg.botId&&sid(cb.message.chat?.id)===d.chatId,'APPROVAL_CHAT');
 check(cb.message.chat.type==='private'&&d.chatId===d.operatorId||cb.message.chat.type==='supergroup'&&d.chatId===cfg.reviewGroupId&&Number(cb.message.message_thread_id||0)===d.topicId,'OPERATOR_CHAT');
 const at=Date.parse(d.approvedAt);check(Number.isFinite(at)&&at<=now+30000&&now-at<=600000,'EXPIRED');
 check(cfg.pollTargets?.some(t=>[c.allowedGroupId,cfg.reviewGroupId].includes(t.groupId)&&t.groupId===d.targetGroupId&&t.topicId===d.targetTopicId&&Number.isSafeInteger(t.topicId)&&t.topicId>0),'DESTINATION');
 check(typeof d.anonymous==='boolean'&&cfg.pollShuffle===true,'SETTINGS');
 const original=parsePollText(d.sourceText,d.sourceEntities||[]);check(JSON.stringify(original)===JSON.stringify(d.poll),'CONTENT_CHANGED');
 for(const field of [original.question,...original.answers]){check(field.entities.every(e=>e.type==='custom_emoji'),'FORMAT');caption(field.text,field.entities);}
 return {cfg,d,original};
}
function pollMatches(actual,d){
 const eq=(got,want)=>got?.text===want.text&&caption(want.text,want.entities).every(e=>entityMatches(got.entities,e));
 return actual?.className==='Poll'&&!actual.closed&&Boolean(actual.publicVoters)===!d.anonymous&&!actual.multipleChoice&&!actual.quiz&&!actual.openAnswers&&actual.shuffleAnswers===true&&!actual.closePeriod&&!actual.closeDate&&!actual.hideResultsUntilClose&&actual.revotingDisabled===true&&!actual.subscribersOnly&&!(actual.countriesIso2||[]).length&&eq(actual.question,d.poll.question)&&actual.answers.length===d.poll.answers.length&&d.poll.answers.every((a,i)=>actual.answers.some(g=>Buffer.from(g.option).equals(Buffer.from([i]))&&eq(g.text,a)));
}
async function publishPoll(client,c,p,bounded,now=Date.now()){
 const {d}=validatePoll(c,p,now),peer=await groupPeer(client,d.targetGroupId,bounded);
 const r=await bounded(client.invoke(new Api.messages.GetForumTopicsByID({peer,topics:[d.targetTopicId]}))),t=r.topics?.find(x=>x.className==='ForumTopic'&&x.id===d.targetTopicId);check(t,'TOPIC_UNAVAILABLE');
 if(t.closed){const s=await bounded(client.invoke(new Api.channels.GetParticipant({channel:peer,participant:new Api.InputPeerSelf()})));check(s.participant?.className==='ChannelParticipantCreator'||s.participant?.adminRights?.manageTopics===true,'TOPIC_PERMISSION');}
 if([d.poll.question,...d.poll.answers].some(x=>x.entities.length)){check((await bounded(client.getMe())).premium,'PREMIUM_EMOJI_REQUIRED');}
 const ac=await bounded(client.invoke(new Api.help.GetAppConfig({hash:0}))),kv=Object.fromEntries((ac.config?.value||[]).map(x=>[x.key,x.value?.value]));
 if(Number.isFinite(kv.poll_answers_max))check(d.poll.answers.length<=kv.poll_answers_max,'OPTIONS_LIMIT');
 const text=x=>new Api.TextWithEntities({text:x.text,entities:caption(x.text,x.entities)});
 const poll=new Api.Poll({id:bigInt(0),hash:bigInt(0),closed:false,publicVoters:!d.anonymous,multipleChoice:false,quiz:false,openAnswers:false,revotingDisabled:true,shuffleAnswers:true,hideResultsUntilClose:false,subscribersOnly:false,question:text(d.poll.question),answers:d.poll.answers.map((a,i)=>new Api.PollAnswer({text:text(a),option:Buffer.from([i])}))});
 const rid=randomId(c.expectedUserId,d.requestKey);let result;
 try{result=await bounded(client.invoke(new Api.messages.SendMedia({peer,media:new Api.InputMediaPoll({poll}),message:'',randomId:rid,sendAs:new Api.InputPeerSelf(),replyTo:new Api.InputReplyToMessage({replyToMsgId:d.targetTopicId,topMsgId:d.targetTopicId})})));}catch{throw Error('NNA_POLL_DELIVERY_UNCONFIRMED');}
 try{
  const mid=result.updates?.find(x=>x.className==='UpdateMessageID'&&sid(x.randomId)===sid(rid))?.id||(result.className==='UpdateShortSentMessage'?result.id:0);check(Number.isSafeInteger(mid)&&mid>0,'DELIVERY_UNCONFIRMED');
  const [m]=await bounded(client.getMessages(peer,{ids:[mid]}));
  check(m?.className==='Message'&&m.out&&sid(m.fromId?.userId)===sid(c.expectedUserId)&&sid(utils.getPeerId(m.peerId))===d.targetGroupId&&Number(m.replyTo?.replyToTopId||m.replyTo?.replyToMsgId)===d.targetTopicId&&m.media?.className==='MessageMediaPoll'&&pollMatches(m.media.poll,d),'DELIVERY_UNCONFIRMED');
  return {status:'sent',mode:'poll',requestKey:d.requestKey,senderId:sid(c.expectedUserId),targetGroupId:d.targetGroupId,targetTopicId:d.targetTopicId,sentMessageId:m.id,pollId:sid(m.media.poll.id),anonymous:d.anonymous,shuffle:true,multipleAnswers:false,addingOptions:false,quiz:false,autoClose:false,revotingDisabled:true};
 }catch{throw Error('NNA_POLL_DELIVERY_UNCONFIRMED');}
}
module.exports={validatePoll,pollMatches,publishPoll};
