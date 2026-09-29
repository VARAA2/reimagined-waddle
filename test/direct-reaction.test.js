'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Api}=require('teleproto'),bigInt=require('big-integer');
const {parseDirectRequest}=require('../dist/nodes/NnaTelegramSender/direct');
const {runOperation}=require('../dist/nodes/NnaTelegramSender/sender');
const now=Date.parse('2026-09-24T00:00:00Z');
const cfg={allowedOperatorIds:'12345,67890',reviewChatId:'-1001234567',botId:'88888'};
const c={apiId:12345,apiHash:'a'.repeat(32),sessionString:'1'+'A'.repeat(352),expectedUserId:'12345',allowedGroupId:'-1001234567',allowedGroupUsername:'example_group',allowedTopicIds:'10,20'};
const ev=(body='🙏',link='https://t.me/c/1234567/10/30')=>({update_id:77,message:{message_id:8,date:now/1000,from:{id:67890,is_bot:false},chat:{id:67890,type:'private'},text:body+'\n'+link}});
function params(update=ev()){const e=parseDirectRequest(update,cfg,now);return {...cfg,update,claimValidated:true,claimRequestKey:e.requestKey,claimOperatorId:e.operatorId,claimBody:e.body,claimUrl:e.targetUrl};}
function fake(){let own=[],sends=0;const peer=new Api.PeerChannel({channelId:bigInt(1234567)});const client={connect:async()=>{},destroy:async()=>{},getMe:async()=>new Api.User({id:bigInt(12345)}),getEntity:async()=>new Api.Channel({id:bigInt(1234567),megagroup:true,forum:true,username:'example_group'}),getInputEntity:async()=>new Api.InputPeerChannel({channelId:bigInt(1234567),accessHash:bigInt(1)}),getMessages:async()=>[new Api.Message({id:30,peerId:peer,message:'target',replyTo:new Api.MessageReplyHeader({forumTopic:true,replyToTopId:10,replyToMsgId:10}),reactions:own.length?new Api.MessageReactions({results:own.map(reaction=>new Api.ReactionCount({reaction,count:1}))}):undefined})],invoke:async r=>{
 if(r.className==='channels.GetFullChannel')return {fullChat:{}};
 if(r.className==='messages.GetMessageReactionsList')return {reactions:own.map(reaction=>({peerId:new Api.PeerUser({userId:bigInt(12345)}),reaction}))};
 if(r.className==='messages.SendReaction'){sends++;own=r.reaction;return {updates:[]};}
 throw Error('Unexpected RPC');
 }};return {client,get sends(){return sends;},get own(){return own;},set own(x){own=x;}};}
test('single emoji routes to reaction while prose stays literal reply',()=>{
 for(const e of ['🙏','🙏🏼','⚡️','❤️','👨‍👩‍👧','🇮🇳','1️⃣'])assert.equal(parseDirectRequest(ev(e),cfg,now).kind,'reaction');
 for(const text of ['நன்றி 🙏','hello','123'])assert.equal(parseDirectRequest(ev(text),cfg,now).kind,'direct');
 for(const text of ['🙏👍','🙏 👍'])assert.equal(parseDirectRequest(ev(text),cfg,now).kind,'invalid');
});
test('custom emoji entity must cover exact emoji and valid ID',()=>{const u=ev('🙏');u.message.entities=[{type:'custom_emoji',offset:0,length:2,custom_emoji_id:'1234567890'}];assert.equal(parseDirectRequest(u,cfg,now).reaction.customEmojiId,'1234567890');u.message.entities[0].custom_emoji_id='bad';assert.equal(parseDirectRequest(u,cfg,now).kind,'invalid');});
test('reaction uses fixed personal sender, preserves others, and is idempotent',async()=>{const f=fake();f.own=[new Api.ReactionEmoji({emoticon:'❤'})];const r=await runOperation('sendDirectReaction',c,params(),{now,createClient:async()=>f.client});assert.equal(r.status,'reacted');assert.equal(r.targetMessageId,30);assert.equal(r.senderId,'12345');assert.equal(f.own.length,2);assert.equal((await runOperation('sendDirectReaction',c,params(),{now,createClient:async()=>f.client})).status,'already_present');assert.equal(f.sends,1);});
test('reaction custom ID comes from authenticated original entity',async()=>{const u=ev('🙏');u.message.entities=[{type:'custom_emoji',offset:0,length:2,custom_emoji_id:'1234567890123456789'}];const f=fake();await runOperation('sendDirectReaction',c,params(u),{now,createClient:async()=>f.client});assert.equal(String(f.own[0].documentId),'1234567890123456789');});
test('reaction rejects tampered claims and reply/reaction operation confusion before connection',async()=>{for(const p of [{...params(),claimValidated:false},{...params(),claimBody:'👍'},params(ev('Literal reply'))]){let connected=false;await assert.rejects(runOperation('sendDirectReaction',c,p,{now,createClient:async()=>{connected=true;return fake().client;}}),/CLAIM/);assert.equal(connected,false);}await assert.rejects(runOperation('sendDirectReply',c,params(),{now,createClient:async()=>fake().client}),/CLAIM/);});
test('wrong topic and channel sender cannot mutate',async()=>{const p=params(ev('🙏','https://t.me/c/1234567/99/30'));const f=fake();await assert.rejects(runOperation('sendDirectReaction',c,p,{now,createClient:async()=>f.client}),/WRONG_TOPIC/);assert.equal(f.sends,0);const g=fake(),invoke=g.client.invoke;g.client.invoke=async r=>r.className==='channels.GetFullChannel'?{fullChat:{defaultSendAs:new Api.PeerChannel({channelId:bigInt(1)})}}:invoke(r);await assert.rejects(runOperation('sendDirectReaction',c,params(),{now,createClient:async()=>g.client}),/NOT_PERSONAL/);assert.equal(g.sends,0);});
test('reaction ambiguity never retries or reports success',async()=>{const f=fake(),invoke=f.client.invoke;let calls=0;f.client.invoke=async r=>{if(r.className==='messages.SendReaction'){calls++;throw Error('transport');}return invoke(r);};await assert.rejects(runOperation('sendDirectReaction',c,params(),{now,createClient:async()=>f.client}),/UNCONFIRMED/);assert.equal(calls,1);});
