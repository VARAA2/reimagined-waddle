'use strict';
const {Api,utils}=require('teleproto');
// Open or close one configured forum topic as the personal account. Idempotent: an already
// matching state is reported and never rewritten. The result is read back before success.
function topicStateConfig(p,operation){
 if(!/^-100[1-9]\d{0,12}$/.test(p.topicStateGroupId||'')||!Number.isSafeInteger(p.topicStateTopicId)||p.topicStateTopicId<=1)throw Error('NNA_TOPIC_STATE_CONFIG_INVALID');
 if(operation==='setTopicState'&&!['open','close'].includes(p.topicStateAction))throw Error('NNA_TOPIC_STATE_ACTION_INVALID');
 return {groupId:p.topicStateGroupId,topicId:p.topicStateTopicId,action:p.topicStateAction};
}
async function readTopic(client,peer,topicId,bounded){
 const r=await bounded(client.invoke(new Api.messages.GetForumTopicsByID({peer,topics:[topicId]})));
 const topic=r.topics?.find(t=>t.id===topicId&&t.className==='ForumTopic');
 if(!topic)throw Error('NNA_TOPIC_STATE_TOPIC_NOT_FOUND');
 return topic;
}
async function runTopicState(operation,client,c,p,bounded){
 const cfg=topicStateConfig(p,operation);if(cfg.groupId!==c.allowedGroupId)throw Error('NNA_TOPIC_STATE_GROUP_NOT_ALLOWED');
 const g=await bounded(client.getEntity(c.allowedGroupUsername));
 if(g?.className!=='Channel'||!g.megagroup||!g.forum||g.left||g.kicked||String(utils.getPeerId(g))!==cfg.groupId)throw Error('NNA_TOPIC_STATE_GROUP_UNAVAILABLE');
 const peer=await bounded(client.getInputEntity(g)),canManageTopics=g.creator===true||g.adminRights?.manageTopics===true;
 const topic=await readTopic(client,peer,cfg.topicId,bounded),closed=topic.closed===true;
 const info={senderId:String(c.expectedUserId),groupId:cfg.groupId,topicId:cfg.topicId,topicName:topic.title};
 if(operation==='inspectTopicState')return {verified:true,...info,closed,canManageTopics};
 const wantClosed=cfg.action==='close';
 if(closed===wantClosed)return {status:wantClosed?'already_closed':'already_open',action:cfg.action,...info,closed};
 if(!canManageTopics)throw Error('NNA_TOPIC_STATE_ADMIN_REQUIRED');
 try{await bounded(client.invoke(new Api.messages.EditForumTopic({peer,topicId:cfg.topicId,closed:wantClosed})));}
 catch(err){
  if(['CHAT_ADMIN_REQUIRED','RIGHT_FORBIDDEN'].includes(err.errorMessage))throw Error('NNA_TOPIC_STATE_ADMIN_REQUIRED');
  if(err.errorMessage!=='TOPIC_NOT_MODIFIED')throw Error('NNA_TOPIC_STATE_UNCONFIRMED');
 }
 let after;try{after=(await readTopic(client,peer,cfg.topicId,bounded)).closed===true;}catch{throw Error('NNA_TOPIC_STATE_UNCONFIRMED');}
 if(after!==wantClosed)throw Error('NNA_TOPIC_STATE_UNCONFIRMED');
 return {status:wantClosed?'closed':'opened',action:cfg.action,...info,closed:after};
}
module.exports={topicStateConfig,runTopicState};
