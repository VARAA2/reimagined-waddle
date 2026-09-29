'use strict';
const {Api,utils}=require('teleproto');
const {HTMLParser}=require('teleproto/extensions/html');
const bigInt=require('big-integer');
const {createHash}=require('node:crypto');
const {groupPeer}=require('./media-publish');
const id=v=>String(v??''),positive=v=>Number.isSafeInteger(v)&&v>0;
const check=(ok,code)=>{if(!ok)throw Error('NNA_RECORD_'+code);};
function config(c,p){
 const s=p.scope;
 check(s&&s.sourceGroupId===c.allowedGroupId&&/^-100[1-9]\d+$/.test(s.targetGroupId||'')&&positive(s.joinedTopicId)&&positive(s.leftTopicId)&&s.joinedTopicId!==s.leftTopicId,'SCOPE_INVALID');
 check(typeof s.activatedAt==='string'&&Number.isFinite(Date.parse(s.activatedAt)),'ACTIVATION_INVALID');
 check(s.allowTrial===undefined||typeof s.allowTrial==='boolean','TRIAL_SCOPE_INVALID');
 return s;
}
function validate(c,p,now=Date.now()){
 const s=config(c,p),r=p.record,claim=p.claim;
 check(r&&claim?.validated===true&&positive(r.log_id)&&claim.logId===r.log_id&&claim.eventKey===r.event_key,'CLAIM_REQUIRED');
 check(['joined','left','removed','departure_unknown'].includes(r.action)&&r.topic_id===(r.action==='joined'?s.joinedTopicId:s.leftTopicId),'TOPIC_MISMATCH');
 const time=Date.parse(r.happened_at);check(Number.isFinite(time)&&time>=Date.parse(s.activatedAt)&&time<=now+30000&&now-time<=86400000,'EVENT_EXPIRED');
 const isTrial=s.allowTrial===true&&r.is_test===true;
 if(isTrial)check(/^format-test-personal:[A-Za-z0-9:._-]{1,150}$/.test(r.event_key||'')&&r.user_id==='-','TRIAL_INVALID');
 else{
  check(r.is_test!==true&&r.event_key?.startsWith('admin-member:'+s.sourceGroupId+':')&&/^\d+$/.test(r.event_key.slice(('admin-member:'+s.sourceGroupId+':').length)),'EVENT_KEY_INVALID');
  check(/^[1-9]\d*$/.test(r.user_id||'')&&Number.isSafeInteger(Number(r.user_id))&&r.person?.id===Number(r.user_id)&&r.person.is_bot===false,'PERSON_INVALID');
 }
 check(typeof r.html==='string'&&r.html.length>0&&r.html.length<=16000&&typeof r.text==='string'&&r.text.length>0&&r.text.length<=3500,'BODY_INVALID');
 const stack=[];for(const m of r.html.matchAll(/<[^>]*>/g)){
  const t=/^<(\/)?(b|code|a)(?: href="tg:\/\/user\?id=([1-9]\d*)")?>$/.exec(m[0]);
  check(t&&(!t[3]||t[2]==='a')&&(t[2]!=='a'||t[1]||t[3]),'HTML_INVALID');
  if(t[1])check(stack.pop()===t[2],'HTML_INVALID');else stack.push(t[2]);
 }
 check(stack.length===0,'HTML_INVALID');
 const [text,entities]=HTMLParser.parse(r.html);check(text===r.text&&entities.every(e=>['MessageEntityBold','MessageEntityCode','MessageEntityMentionName'].includes(e.className)),'BODY_MISMATCH');
 check(!isTrial||text.startsWith('🧪 சோதனைப் பதிவு — உண்மையான உறுப்பினர் நிகழ்வு அல்ல\n\n'),'TRIAL_LABEL_REQUIRED');
 const expectedLabels=['Name:','Username:','ID:',r.action==='joined'?'Joined by:':'Left by:','Bio:',r.action==='joined'?'Group Joined Date:':'Group Left Date:'];
 const bold=entities.filter(e=>e.className==='MessageEntityBold').map(e=>text.slice(e.offset,e.offset+e.length));
 check(expectedLabels.every(label=>bold.includes(label))&&entities.some(e=>e.className==='MessageEntityCode'&&text.slice(e.offset,e.offset+e.length)===r.user_id),'FORMAT_INVALID');
 return {s,r,text,entities,isTrial};
}
function randomId(sender,key){const b=createHash('sha256').update('membership-record-v1\0'+sender+'\0'+key).digest();return bigInt((b.readBigInt64BE(0)||1n).toString());}
async function scope(client,c,p,bounded){
 const s=config(c,p),peer=await groupPeer(client,s.targetGroupId,bounded);
 const result=await bounded(client.invoke(new Api.messages.GetForumTopicsByID({peer,topics:[s.joinedTopicId,s.leftTopicId]})));
 const topics=[s.joinedTopicId,s.leftTopicId].map(n=>result.topics?.find(t=>t.className==='ForumTopic'&&t.id===n));
 check(topics.every(Boolean),'TOPIC_UNAVAILABLE');
 if(topics.some(t=>t.closed)){
  const self=await bounded(client.invoke(new Api.channels.GetParticipant({channel:peer,participant:new Api.InputPeerSelf()})));
  check(self.participant?.className==='ChannelParticipantCreator'||self.participant?.adminRights?.manageTopics===true,'TOPIC_CLOSED');
 }
 return {peer,topics};
}
async function mentions(client,c,entities,bounded){
 const needed=entities.filter(e=>e.className==='MessageEntityMentionName'),users=new Map();
 for(const e of needed)try{users.set(id(e.userId),utils.getInputUser(await bounded(client.getInputEntity(e.userId))));}catch{}
 if(needed.some(e=>!users.has(id(e.userId))))try{
  const group=await bounded(client.getEntity(c.allowedGroupUsername));
  check(id(utils.getPeerId(group))===c.allowedGroupId,'SOURCE_MISMATCH');
  const channel=await bounded(client.getInputEntity(group));
  const logs=await bounded(client.invoke(new Api.channels.GetAdminLog({channel,q:'',maxId:bigInt.zero,minId:bigInt.zero,limit:100})));
  for(const u of logs.users||[])if(u.className==='User'&&!u.min&&u.accessHash)users.set(id(u.id),new Api.InputUser({userId:u.id,accessHash:u.accessHash}));
 }catch{}
 return entities.flatMap(e=>e.className!=='MessageEntityMentionName'?[e]:users.has(id(e.userId))?[new Api.InputMessageEntityMentionName({offset:e.offset,length:e.length,userId:users.get(id(e.userId))})]:[]);
}
function entityMatches(actual,e,senderId){return actual?.some(a=>a.offset===e.offset&&a.length===e.length&&(e.className==='InputMessageEntityMentionName'?a.className==='MessageEntityMentionName'&&id(a.userId)===id(e.userId.className==='InputUserSelf'?senderId:e.userId.userId):a.className===e.className));}
async function run(operation,client,c,p,bounded,now=Date.now()){
 const s=config(c,p);
 const parsed=operation==='sendMembershipRecord'?validate(c,p,now):null;
 const target=await scope(client,c,p,bounded);
 if(operation==='inspectMembershipRecordScope')return {verified:true,senderId:id(c.expectedUserId),targetGroupId:s.targetGroupId,topics:target.topics.map(t=>({id:t.id,title:t.title,closed:!!t.closed}))};
 check(operation==='sendMembershipRecord'&&parsed,'OPERATION_INVALID');
 const {r,text}=parsed,entities=await mentions(client,c,parsed.entities,bounded),rid=randomId(c.expectedUserId,r.event_key);
 let result;
 try{result=await bounded(client.invoke(new Api.messages.SendMessage({peer:target.peer,message:text,entities,randomId:rid,noWebpage:true,sendAs:new Api.InputPeerSelf(),silent:parsed.isTrial,replyTo:new Api.InputReplyToMessage({replyToMsgId:r.topic_id,topMsgId:r.topic_id})})));}
 catch{throw Error('NNA_RECORD_DELIVERY_UNCONFIRMED');}
 try{
  const updates=result.updates||[],mid=updates.find(u=>u.className==='UpdateMessageID'&&id(u.randomId)===id(rid))?.id||(result.className==='UpdateShortSentMessage'?result.id:0);
  check(positive(mid),'DELIVERY_UNCONFIRMED');
  const m=(await bounded(client.getMessages(target.peer,{ids:[mid]})))[0];
  check(m?.className==='Message'&&m.id===mid&&m.out&&id(m.fromId?.userId)===id(c.expectedUserId)&&id(utils.getPeerId(m.peerId))===s.targetGroupId&&Number(m.replyTo?.replyToTopId||m.replyTo?.replyToMsgId)===r.topic_id&&m.message===text&&entities.every(e=>entityMatches(m.entities,e,c.expectedUserId)),'DELIVERY_UNCONFIRMED');
  return {status:'sent',senderId:id(c.expectedUserId),eventKey:r.event_key,targetGroupId:s.targetGroupId,topicId:r.topic_id,messageId:mid,formatVerified:true};
 }catch{throw Error('NNA_RECORD_DELIVERY_UNCONFIRMED');}
}
module.exports={config,validate,randomId,scope,mentions,entityMatches,run};
