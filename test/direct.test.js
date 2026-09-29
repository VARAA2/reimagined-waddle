'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseDirectRequest,targetFromUrl,randomId,sendDirect}=require('../dist/nodes/NnaTelegramSender/direct');
const {runOperation}=require('../dist/nodes/NnaTelegramSender/sender');
const {Api}=require('teleproto'),bigInt=require('big-integer');
const now=Date.parse('2026-09-24T00:00:00Z');
const cfg={allowedOperatorIds:'12345,67890',reviewChatId:'-1001234567',botId:'88888'};
const event=text=>({update_id:7,message:{message_id:8,date:now/1000,from:{id:67890,is_bot:false},chat:{id:67890,type:'private'},text}});
test('both operator accounts, private or review topics, exact literal text and either link order',()=>{
 for(const text of ['https://t.me/example_group/10/30\n\nஅன்பு 🤍\nsecond line','அன்பு 🤍\nsecond line\nhttps://t.me/example_group/10/30']){
  const e=parseDirectRequest(event(text),cfg,now);assert.equal(e.body,'அன்பு 🤍\nsecond line');assert.equal(e.operatorId,'67890');assert.equal(e.target.topicId,10);
 }
 const u=event('https://t.me/c/1234567/30\nHello');u.message.chat={id:-1001234567,type:'supergroup'};u.message.message_thread_id=3;assert.equal(parseDirectRequest(u,cfg,now).kind,'direct');
 u.message.from.id=12345;assert.equal(parseDirectRequest(u,cfg,now).kind,'direct');
});
test('rejects untrusted actors, unrelated chats, forwarded instructions, edits, stale and ambiguous bodies',()=>{
 const base=event('https://t.me/example_group/30\nHello');
 for(const m of [{from:{id:99999,is_bot:false}},{from:{id:67890,is_bot:true}},{chat:{id:99999,type:'private'}},{sender_chat:{id:5}}])assert.equal(parseDirectRequest({...base,message:{...base.message,...m}},cfg,now),null);
 for(const m of [{forward_origin:{type:'user'}},{date:now/1000-86401},{text:'https://t.me/example_group/30'},{text:'https://t.me/example_group/30\nHello\nhttps://t.me/example_group/31'},{text:'https://t.me/example_group/30\n'+'x'.repeat(4097)}])assert.equal(parseDirectRequest({...base,message:{...base.message,...m}},cfg,now).kind,'invalid');
 assert.equal(parseDirectRequest({...base,edited_message:base.message},cfg,now),null);
 assert.equal(parseDirectRequest(event('just normal chat'),cfg,now),null);
});
test('message URLs must be actual supported Telegram message links',()=>{
 for(const u of ['https://evil.com/a/1','https://t.me/+invite','https://t.me/name_only','https://t.me/user/3?x=1','https://t.me/c/1234/0','https://t.me/example/1/2/3'])assert.throws(()=>targetFromUrl(u));
 assert.equal(targetFromUrl('https://t.me/c/1234567/30').peer,'-1001234567');
 assert.equal(randomId('1','request1').toString(),randomId('1','request1').toString());assert.notEqual(randomId('1','request1').toString(),randomId('1','request2').toString());
});
const credentials={apiId:12345,apiHash:'a'.repeat(32),sessionString:'1'+'A'.repeat(352),expectedUserId:'12345',allowedGroupId:'-1001234567',allowedGroupUsername:'example_group',allowedTopicIds:'10,20'};
function params(){const update=event('https://t.me/example_group/10/30\nLiteral reply 🤍');const e=parseDirectRequest(update,cfg,now);return {...cfg,update,claimValidated:true,claimRequestKey:e.requestKey,claimOperatorId:e.operatorId,claimBody:e.body,claimUrl:e.targetUrl};}
function client(){let calls=0;const peerId=new Api.PeerChannel({channelId:bigInt(1234567)});const source=new Api.Message({id:30,peerId,message:'Question',replyTo:new Api.MessageReplyHeader({forumTopic:true,replyToTopId:10,replyToMsgId:10})});return {get count(){return calls;},connect:async()=>{},destroy:async()=>{},getMe:async()=>new Api.User({id:bigInt(12345)}),getEntity:async()=>new Api.Channel({id:bigInt(1234567),username:'example_group',megagroup:true,forum:true}),getInputEntity:async()=>new Api.InputPeerChannel({channelId:bigInt(1234567),accessHash:bigInt(1)}),getMessages:async()=>[source],invoke:async r=>{calls++;assert.equal(r.sendAs.className,'InputPeerSelf');assert.equal(r.replyTo.replyToMsgId,30);assert.equal(r.replyTo.topMsgId,10);assert.equal(r.message,'Literal reply 🤍');return {updates:[{className:'UpdateMessageID',randomId:r.randomId,id:40},{message:new Api.Message({id:40,out:true,fromId:new Api.PeerUser({userId:bigInt(12345)}),peerId,message:r.message,replyTo:new Api.MessageReplyHeader({forumTopic:true,replyToMsgId:30,replyToTopId:10})})}]};}};}
test('direct send preserves body and personal identity without calling approval or LLM',async()=>{const c=client();const result=await runOperation('sendDirectReply',credentials,params(),{now,createClient:async()=>c});assert.equal(result.status,'sent');assert.equal(result.operatorId,'67890');assert.equal(result.senderId,'12345');assert.equal(c.count,1);});
test('claim tampering fails before connection',async()=>{for(const patch of [{claimValidated:false},{claimBody:'changed'},{claimUrl:'https://t.me/example_group/31'},{claimOperatorId:'12345'}]){let opened=false;await assert.rejects(runOperation('sendDirectReply',credentials,{...params(),...patch},{now,createClient:async()=>{opened=true;return client();}}),/CLAIM/);assert.equal(opened,false);}});
test('wrong topic or inaccessible group cannot send; uncertain RPC never retries',async()=>{
 const c=client();const p=params();p.update.message.text=p.update.message.text.replace('/10/30','/99/30');p.claimUrl=p.claimUrl.replace('/10/30','/99/30');await assert.rejects(sendDirect(c,credentials,p,x=>x,now),/WRONG_TOPIC/);assert.equal(c.count,0);
 const d=client();let count=0;d.invoke=async()=>{count++;throw new Error('network');};await assert.rejects(sendDirect(d,credentials,params(),x=>x,now),/UNCONFIRMED/);assert.equal(count,1);
});
