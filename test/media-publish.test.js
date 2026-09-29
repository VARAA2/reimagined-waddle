'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{Api}=require('teleproto'),bigInt=require('big-integer');
const {validate,caption,publish,randomId}=require('../dist/nodes/NnaTelegramSender/media-publish');
const now=Date.now(),c={expectedUserId:'42',allowedGroupId:'-1001234500000'};
function params(scheduleAt=0){return {config:{reviewGroupId:'-1009876500000',reviewTopicId:3,botId:'99',operatorIds:['42'],targets:[{groupId:c.allowedGroupId,topicId:10}]},delivery:{claimValidated:true,operatorId:'42',chatId:'42',topicId:0,revision:'123',requestKey:'media:42:42:0:123',approvedAt:new Date(now).toISOString(),update:{update_id:124,callback_query:{from:{id:42,is_bot:false},data:'mp:42:123:publish',message:{chat:{id:42,type:'private'},from:{id:99,is_bot:true}}}},targetGroupId:c.allowedGroupId,targetTopicId:10,sourceMessageId:55,kind:'photo',captionText:'Title\nQuote 🙂',captionEntities:[{type:'bold',offset:0,length:5},{type:'expandable_blockquote',offset:6,length:8},{type:'custom_emoji',offset:12,length:2,custom_emoji_id:'12345'}],scheduleAt}};}
function mock(p,uncertain=false){let req,writes=0;const photo=new Api.Photo({id:bigInt(321),accessHash:bigInt(654),fileReference:Buffer.from('x'),date:0,sizes:[],dcId:1}),media=new Api.MessageMediaPhoto({photo});return {
 get writes(){return writes;},get request(){return req;},getEntity:async n=>new Api.Channel({id:bigInt(String(n).slice(4)),megagroup:true,forum:true,title:'Test',photo:new Api.ChatPhotoEmpty(),date:0}),
 getInputEntity:async g=>new Api.InputPeerChannel({channelId:g.id,accessHash:bigInt(1)}),
 getMessages:async()=>[{className:'Message',id:55,peerId:new Api.PeerChannel({channelId:bigInt(9876500000)}),fromId:new Api.PeerUser({userId:bigInt(99)}),message:'NNA_MEDIA_STAGE:'+p.delivery.requestKey,replyTo:{replyToTopId:3},media}],
 invoke:async x=>{if(x.className==='messages.GetForumTopicsByID')return {topics:[{className:'ForumTopic',id:10,closed:false}]};assert.equal(x.className,'messages.SendMedia');req=x;writes++;if(uncertain)throw Error('network');return {updates:[{className:'UpdateMessageID',id:88,randomId:x.randomId},{className:p.delivery.scheduleAt?'UpdateNewScheduledMessage':'UpdateNewChannelMessage',message:{className:'Message',id:88,out:true,fromId:new Api.PeerUser({userId:bigInt(42)}),peerId:new Api.PeerChannel({channelId:bigInt(1234500000)}),message:x.message,entities:x.entities,replyTo:{replyToTopId:10},media,date:p.delivery.scheduleAt||now/1000}}]};}
 };}
test('immediate media preserves caption, custom emojis, topic and personal sender',async()=>{const p=params(),m=mock(p),r=await publish(m,c,p,x=>x,now);assert.equal(r.status,'sent');assert.equal(r.sentMessageId,88);assert.equal(m.request.sendAs.className,'InputPeerSelf');assert.equal(m.request.replyTo.topMsgId,10);assert.equal(m.writes,1);});
test('scheduled media uses native queue and distinct scheduled ID field',async()=>{const p=params(Math.floor(now/1000)+300),m=mock(p),r=await publish(m,c,p,x=>x,now);assert.equal(r.status,'scheduled');assert.equal(r.scheduledMessageId,88);assert.equal(r.sentMessageId,undefined);assert.equal(m.request.scheduleDate,p.delivery.scheduleAt);});
test('tampered approval, scope, times and entities fail before writing',()=>{for(const change of [p=>p.delivery.claimValidated=false,p=>p.delivery.update.callback_query.from.id=43,p=>p.delivery.targetTopicId=11,p=>p.delivery.scheduleAt=Math.floor(now/1000)+9,p=>p.delivery.scheduleAt=Math.floor(now/1000)-1,p=>p.delivery.captionEntities[0].length=100,p=>p.delivery.revision='other']){const p=params();change(p);assert.throws(()=>validate(c,p,now),/NNA_MEDIA_/);}});
test('wrong staging author prevents send',async()=>{const p=params(),m=mock(p),get=m.getMessages;m.getMessages=async()=>{const a=await get();a[0].fromId=new Api.PeerUser({userId:bigInt(100)});return a;};await assert.rejects(publish(m,c,p,x=>x,now),/STAGE_UNVERIFIED/);assert.equal(m.writes,0);});
test('uncertain write is reported without retry',async()=>{const p=params(),m=mock(p,true);await assert.rejects(publish(m,c,p,x=>x,now),/DELIVERY_UNCONFIRMED/);assert.equal(m.writes,1);});
test('claim gives stable media random ID and quote collapsed flag survives',()=>{assert.equal(String(randomId('42','key')),String(randomId('42','key')));assert.notEqual(String(randomId('42','key')),String(randomId('42','key2')));assert.equal(caption('quote',[{type:'expandable_blockquote',offset:0,length:5}])[0].collapsed,true);});
test('closed topic accepts owner or manage-topics admin and denies ordinary member',async()=>{
 for(const participant of [{className:'ChannelParticipantCreator'},{className:'ChannelParticipantAdmin',adminRights:{manageTopics:true}},{className:'ChannelParticipantAdmin',adminRights:{manageTopics:false}},{className:'ChannelParticipant'}]){
  const p=params(),m=mock(p),invoke=m.invoke;
  m.invoke=async x=>x.className==='messages.GetForumTopicsByID'?{topics:[{className:'ForumTopic',id:10,closed:true}]}:x.className==='channels.GetParticipant'?{participant}:invoke(x);
  const allowed=participant.className==='ChannelParticipantCreator'||participant.adminRights?.manageTopics;
  if(allowed){assert.equal((await publish(m,c,p,x=>x,now)).status,'sent');assert.equal(m.writes,1);}
  else{await assert.rejects(publish(m,c,p,x=>x,now),/CLOSED_TOPIC_PERMISSION_REQUIRED/);assert.equal(m.writes,0);}
 }
});
test('long caption requires live Premium and account limit, preserving all text',async()=>{
 for(const [premium,limit,allowed] of [[true,4096,true],[false,4096,false],[true,1024,false]]){
  const p=params();p.delivery.captionText='x'.repeat(1456);p.delivery.captionEntities=[];const m=mock(p),invoke=m.invoke;
  m.getMe=async()=>({premium});m.invoke=async x=>x.className==='help.GetAppConfig'?{config:{value:[{key:'caption_length_limit_premium',value:{value:limit}}]}}:invoke(x);
  if(allowed){assert.equal((await publish(m,c,p,x=>x,now)).status,'sent');assert.equal(m.request.message.length,1456);}
  else{await assert.rejects(publish(m,c,p,x=>x,now),/PREMIUM_CAPTION_REQUIRED|ACCOUNT_CAPTION_LIMIT/);assert.equal(m.writes,0);}
 }
 assert.throws(()=>caption('x'.repeat(4097),[]),/CAPTION_INVALID/);
});
