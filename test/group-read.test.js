'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Api}=require('teleproto'),bigInt=require('big-integer');
const gr=require('../dist/nodes/NnaTelegramSender/group-read');
const ch=(i,x={})=>new Api.Channel({id:bigInt(i),title:'G'+i,megagroup:true,forum:true,photo:new Api.ChatPhotoEmpty(),date:0,...x});
test('request checks',()=>{
 assert.equal(gr.request({groupRead:{}}).mode,'groups');
 assert.throws(()=>gr.request({groupRead:{mode:'send'}}),/MODE_INVALID/);
 assert.throws(()=>gr.request({groupRead:{mode:'history',group:'x'}}),/GROUP_INVALID/);
 assert.throws(()=>gr.request({groupRead:{mode:'history',group:'-1001',limit:500}}),/LIMIT_INVALID/);
});
test('groups: only groups/channels the account is in, no users; nothing invoked',async()=>{
 const calls=[];const client={invoke:async r=>calls.push(r.className),getDialogs:async()=>[
  {entity:ch(11),unreadCount:3,message:{id:5,date:1,message:'hi'}},{entity:new Api.User({id:bigInt(5)}),unreadCount:1},{entity:ch(12,{left:true}),unreadCount:0}]};
 const r=await gr.run('readGroupChats',client,{},{groupRead:{mode:'groups'}},x=>x);
 assert.deepEqual(r.groups.map(g=>g.groupId),['-10011']);assert.equal(r.groups[0].type,'forum_group');assert.equal(calls.length,0);assert.equal(r.markedRead,false);
});
test('history of a topic uses GetReplies; search uses Search; never ReadHistory',async()=>{
 const calls=[];const e=ch(4373500275,{username:'NNATEMP'});
 const client={getEntity:async()=>e,getInputEntity:async()=>new Api.InputPeerChannel({channelId:e.id,accessHash:bigInt(1)}),
  invoke:async r=>{calls.push(r.className);return {users:[new Api.User({id:bigInt(9),firstName:'R'})],messages:[{className:'Message',id:50,date:2,message:'vanakkam',fromId:new Api.PeerUser({userId:bigInt(9)}),replyTo:new Api.MessageReplyHeader({forumTopic:true,replyToMsgId:1123})}]};}};
 let r=await gr.run('readGroupChats',client,{},{groupRead:{mode:'history',group:'-1004373500275',topic:1123}},x=>x);
 assert.equal(r.messages[0].fromName,'R');assert.equal(r.messages[0].topicId,1123);assert.equal(r.messages[0].link,'https://t.me/NNATEMP/1123/50');
 await gr.run('readGroupChats',client,{},{groupRead:{mode:'history',group:'-1004373500275',query:'அருள்'}},x=>x);
 await gr.run('readGroupChats',client,{},{groupRead:{mode:'topics',group:'@NNATEMP'}},x=>x);
 assert.deepEqual(calls,['messages.GetReplies','messages.Search','messages.GetForumTopics']);
 const u={...client,getEntity:async()=>new Api.User({id:bigInt(5)})};
 await assert.rejects(gr.run('readGroupChats',u,{},{groupRead:{mode:'history',group:'@someone'}},x=>x),/GROUP_UNAVAILABLE/);
});
test('0.54.1: message mode returns custom emoji ids and sticker',async()=>{
 const e=ch(4373500275,{username:'NNATEMP'});
 const msg={className:'Message',id:77,date:2,message:'அ ✨ x',entities:[new Api.MessageEntityCustomEmoji({offset:2,length:1,documentId:bigInt('5373251851074415873')}),new Api.MessageEntityCustomEmoji({offset:2,length:1,documentId:bigInt('5373251851074415873')})],
  fromId:new Api.PeerUser({userId:bigInt(9)}),getSender:async()=>new Api.User({id:bigInt(9),firstName:'V'})};
 const client={getEntity:async()=>e,getInputEntity:async()=>new Api.InputPeerChannel({channelId:e.id,accessHash:bigInt(1)}),getMessages:async()=>[msg],invoke:async()=>{throw Error('no rpc');}};
 const r=await gr.run('readGroupChats',client,{},{groupRead:{mode:'message',group:'-1004373500275',messageId:77}},x=>x);
 assert.equal(r.mode,'message');assert.deepEqual(r.messages[0].customEmojis,[{id:'5373251851074415873',char:'✨'}]);assert.equal(r.messages[0].fromName,'V');assert.equal(r.messages[0].sticker,null);
 assert.throws(()=>gr.request({groupRead:{mode:'message',group:'-1001'}}),/MESSAGE_ID_INVALID/);
});

test('0.60.0: rich messages (cards) return their text; plain messages unchanged',()=>{
 const RM=require('teleproto/richMessage');
 assert.equal(typeof RM.toPlainText,'function');
 assert.equal(gr.textOf({message:'hello',richMessage:{blocks:[]}}),'hello');
 assert.equal(gr.textOf({message:'',richMessage:null}),'');
 const fake={blocks:[{className:'RichBlockParagraph',text:{className:'RichTextConcat',texts:[{className:'RichTextPlain',text:'Dear Vk Soul '},{className:'RichTextBold',text:{className:'RichTextPlain',text:'🤍'}}]}},
  {className:'RichBlockList',items:[{blocks:[{className:'RichBlockParagraph',text:{className:'RichTextPlain',text:'one'}}]},{blocks:[{className:'RichBlockParagraph',text:{className:'RichTextPlain',text:'two'}}]}]}]};
 const t=gr.richPlain(fake.blocks);
 assert.match(t,/Dear Vk Soul 🤍/);assert.match(t,/one\ntwo/);
 assert.ok(gr.textOf({message:'',richMessage:fake}).includes('Dear Vk Soul'));
});
