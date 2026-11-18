'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Api}=require('teleproto');
const pc=require('../dist/nodes/NnaTelegramSender/private-chats');
const c={expectedUserId:'111'};
const u=(i,x={})=>({className:'User',id:i,firstName:'N'+i,username:'u'+i,...x});
test('request checks',()=>{
 assert.equal(pc.request({privateRead:{mode:'dialogs'}}).limit,20);
 assert.throws(()=>pc.request({privateRead:{mode:'send'}}),/MODE_INVALID/);
 assert.throws(()=>pc.request({privateRead:{mode:'history',peer:'-100123'}}),/PEER_INVALID/);
 assert.throws(()=>pc.request({privateRead:{mode:'dialogs',limit:500}}),/LIMIT_INVALID/);
});
test('dialogs: only private users, no self/bots/groups, unread filter, never invokes anything',async()=>{
 const calls=[];
 const client={invoke:async r=>{calls.push(r);},getDialogs:async()=>[
  {entity:u(5,{}),unreadCount:2,message:{id:9,date:1,out:false,message:'hi'}},
  {entity:{className:'Channel',id:7},unreadCount:3},
  {entity:u(111),unreadCount:0},{entity:u(8,{bot:true}),unreadCount:1},
  {entity:u(6),unreadCount:0,message:{id:3,date:1,out:true,message:'ok'}}]};
 let r=await pc.run('readPrivateChats',client,c,{privateRead:{mode:'dialogs'}},x=>x);
 assert.deepEqual(r.chats.map(x=>x.userId),['5','6']);assert.equal(r.markedRead,false);assert.equal(calls.length,0);
 r=await pc.run('readPrivateChats',client,c,{privateRead:{mode:'dialogs',unreadOnly:true}},x=>x);
 assert.deepEqual(r.chats.map(x=>x.userId),['5']);
});
test('history: GetHistory only (no ReadHistory), private user only',async()=>{
 const calls=[];
 const client={getEntity:async()=>u(5),getInputEntity:async()=>new Api.InputPeerUser({userId:5,accessHash:1}),
  invoke:async r=>{calls.push(r.className);return {messages:[{className:'Message',id:12,date:2,out:false,message:'vanakkam',peerId:{userId:5}}]};}};
 const r=await pc.run('readPrivateChats',client,c,{privateRead:{mode:'history',peer:'5',limit:10}},x=>x);
 assert.equal(r.messages[0].text,'vanakkam');assert.deepEqual(calls,['messages.GetHistory']);
 const g={...client,getEntity:async()=>({className:'Channel',id:9})};
 await assert.rejects(pc.run('readPrivateChats',g,c,{privateRead:{mode:'history',peer:'9'}},x=>x),/NOT_A_PRIVATE_CHAT/);
});
