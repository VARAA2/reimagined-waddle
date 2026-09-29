'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Api}=require('teleproto'),bi=require('big-integer');
const {Service,keyboard}=require('../dist/nodes/NnaMediaCollection/core');
const {Store}=require('../dist/nodes/NnaMediaCollection/store');
const {topicKeyboard}=require('../dist/nodes/NnaMediaCollection/album-ui');
const {resolveDestination}=require('../dist/nodes/NnaMediaCollection/destinations');
const primary='-1001234500000',extra='-1002234500000';
const creds={apiId:1,apiHash:'a'.repeat(32),sessionString:'1fake',expectedUserId:'42',allowedGroupId:primary,allowedGroupUsername:'examplegroup',allowedTopicIds:'10'};
const scope={groupId:primary,botUsername:'example_bot',operatorIds:['42'],topicIds:[10],allTopics:true,albums:true,replyKeyboard:true,fullTopicKeyboard:true,additionalGroups:[{groupId:extra,label:'Editor',topicIds:[10,20]}]};
const photo=id=>({photo:[{file_id:'f'+id,file_unique_id:'u'+id,file_size:10}]});
const input=(id,body)=>({update_id:id,message:{message_id:id,date:Math.floor(Date.now()/1000),chat:{id:42,type:'private'},from:{id:42,is_bot:false},...body}});
function setup(t,change={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'nna-multigroup-'));
 t.after(()=>{assert.equal(path.dirname(root),os.tmpdir());assert(path.basename(root).startsWith('nna-multigroup-'));fs.rmSync(root,{recursive:true,force:true});});
 const s=new Service({},creds,{}, {...structuredClone(scope),...change},{root});s.me={id:99,is_bot:true,username:'example_bot'};s.store=new Store(99,root);s.calls=[];let mid=500;
 s.bot=async(method,body)=>{s.calls.push({method,body});return {message_id:++mid};};
 s.group=async(client,id=primary)=>new Api.InputPeerChannel({channelId:bi(id.slice(4)),accessHash:bi(1)});
 const client={invoke:async req=>{
  const groupId='-100'+req.peer.channelId;
  assert(['messages.GetForumTopics','messages.GetForumTopicsByID'].includes(req.className));
  const ids=groupId===primary?[10,30]:req.topics;
  return {count:ids.length,topics:ids.map(id=>({className:'ForumTopic',id,title:id===10?'Same topic':'Topic '+id,iconEmojiId:bi(groupId===primary?'501':'502')}))};
 }};
 s.personal=async fn=>fn(client,{premium:true});return s;
}
async function press(s,action,id){const ui=s.store.read('ui_42'),choice=ui.choices.find(x=>x.action===action);assert(choice,action);return s.handle(input(id,{text:choice.text}));}
function transport(s,{wrongReadback=false,uncertain=false}={}){
 let request,writes=0,stages=0;const mediaById=new Map();
 s.stage=async d=>{stages++;const photo=new Api.Photo({id:bi(1000+d.sourceMessageId),accessHash:bi(1),fileReference:Buffer.from('x'),date:0,sizes:[],dcId:1}),media=new Api.MessageMediaPhoto({photo});mediaById.set(String(photo.id),media);return {source:{media},botMessageId:stages};};s.cleanup=async()=>{};
 const selected=[];s.group=async(client,id=primary)=>{selected.push(id);return new Api.InputPeerChannel({channelId:bi(id.slice(4)),accessHash:bi(1)});};
 const topics=[{id:10,key:10,groupId:primary,title:'Same topic'},{id:10,key:'g2234500000_10',groupId:extra,title:'Same topic'},{id:20,key:'g2234500000_20',groupId:extra,title:'Topic 20'}];s.topics=async(client,id)=>topics.filter(t=>!id||t.groupId===id);
 const client={invoke:async req=>{request=req;writes++;req.getBytes();if(uncertain)throw Error('network lost');const items=req.multiMedia||[req];return {updates:items.map((m,i)=>({className:'UpdateMessageID',id:800+i,randomId:m.randomId}))};},getMessages:async peer=>(request.multiMedia||[request]).map((m,i)=>({className:'Message',id:800+i,fromId:new Api.PeerUser({userId:bi(42)}),peerId:new Api.PeerChannel({channelId:wrongReadback?bi(primary.slice(4)):peer.channelId}),replyTo:{replyToTopId:request.replyTo.topMsgId},message:m.message,entities:m.entities,media:mediaById.get(String(m.media.id.id)),groupedId:bi(777)}))};
 s.personal=async fn=>fn(client,{premium:true});return {get request(){return request;},get writes(){return writes;},get stages(){return stages;},selected};
}
test('multi-group topic discovery fetches only allowed external topics and preserves primary numeric keys',async t=>{
 const s=setup(t),topics=await s.personal(c=>s.topics(c));assert.deepEqual(topics.map(t=>t.key),[10,30,'g2234500000_10','g2234500000_20']);assert.equal(topics[2].iconCustomEmojiId,'502');
 const menu=topicKeyboard({key:'a'.repeat(20),rev:1},topics,0,true,true);assert.equal(menu.pages,1);assert.equal(new Set(menu.choices.map(c=>c.button.text)).size,menu.choices.length);assert.notEqual(menu.choices[0].action,menu.choices[2].action);
 for(const b of keyboard({key:'a'.repeat(20),rev:1},topics).inline_keyboard.flat())assert(Buffer.byteLength(b.callback_data)<=64);
 const duplicated=topics.map(t=>({...t,title:'Duplicate',groupLabel:'Same label'}));assert.equal(new Set(topicKeyboard({},duplicated,0,true,true).choices.map(c=>c.button.text)).size,duplicated.length+2);
});
test('group configuration rejects duplicate groups and unsafe destinations',()=>{
 for(const additionalGroups of [[{groupId:primary,topicIds:[10]}],[{groupId:extra,topicIds:[]}],[{groupId:extra,topicIds:[10,10]}],[{groupId:'123',topicIds:[10]}]])assert.throws(()=>new Service({},creds,{}, {...scope,additionalGroups}),/MEDIA_ADDITIONAL/);
 for(const key of ['g3234500000_10','g2234500000_999','g2234500000_0','g2234500000_1e2','-10'])assert.throws(()=>resolveDestination(scope,key),/DESTINATION/);
 assert.deepEqual(resolveDestination(scope,10),{groupId:primary,topicId:10});
});
test('single media routes same numeric topic ID to the selected external group, with correct receipt and replay guard',async t=>{
 const s=setup(t),r=await s.handle(input(1,{...photo(1),caption:'Original',caption_entities:[{type:'bold',offset:0,length:8}]})),m=transport(s);
 assert.equal((await press(s,'tg2234500000_10',2)).json.status,'sent');assert.equal(String(m.request.peer.channelId),extra.slice(4));assert.equal(m.request.sendAs.className,'InputPeerSelf');assert.equal(m.request.replyTo.topMsgId,10);assert.equal(m.writes,1);
 const d=s.store.read(r.json.jobKey);assert.equal(d.targetGroupId,extra);assert.equal(d.receipt.groupId,extra);assert.equal(d.receipt.url,'https://t.me/c/2234500000/10/800');assert.equal(d.receipt.caption,'Original');assert.equal(d.receipt.entities[0].type,'bold');
 await s.handle(input(3,{text:'Same topic'}));assert.equal(m.writes,1);
});
test('external albums use the selected peer, exact topic, captions and verified grouped receipt',async t=>{
 const s=setup(t);await s.handle(input(1,{...photo(1),media_group_id:'album',caption:'First'}));const r=await s.handle(input(2,{...photo(2),media_group_id:'album',caption:'Second'}));s.store.change(r.json.jobKey,d=>({...d,lastAssetAt:Date.now()-3000}));await press(s,'ready',3);const m=transport(s);
 assert.equal((await press(s,'tg2234500000_20',4)).json.status,'sent');assert.equal(m.request.className,'messages.SendMultiMedia');assert.equal(String(m.request.peer.channelId),extra.slice(4));assert.equal(m.request.replyTo.topMsgId,20);assert.deepEqual(m.request.multiMedia.map(m=>m.message),['First','Second']);assert.equal(s.store.read(r.json.jobKey).receipt.groupId,extra);assert.equal(s.store.read(r.json.jobKey).receipt.url,'https://t.me/c/2234500000/20/800');
});
test('wrong-group readback is uncertain and cannot resend',async t=>{
 const s=setup(t),r=await s.handle(input(1,photo(1))),m=transport(s,{wrongReadback:true});assert.equal((await press(s,'tg2234500000_10',2)).json.status,'uncertain');assert.equal(s.store.read(r.json.jobKey).status,'uncertain');await assert.rejects(press(s,'tg2234500000_10',3),/ALREADY_HANDLED/);assert.equal(m.writes,1);
});
test('removed group and closed external topic fail before staging or sending',async t=>{
 for(const kind of ['removed','closed']){
  const s=setup(t);await s.handle(input(1,photo(1)));const m=transport(s);
  if(kind==='removed'){s.scope.additionalGroups=[];await assert.rejects(press(s,'tg2234500000_10',2),/DESTINATION/);}
  else{s.topics=async()=>[{id:10,groupId:extra,closed:true}];assert.equal((await press(s,'tg2234500000_10',2)).json.status,'failed');}
  assert.equal(m.stages,0);assert.equal(m.writes,0);
 }
});
test('existing numeric topic order survives group addition, and identical topic IDs reorder independently',async t=>{
 const s=setup(t);s.store.change('topic_order_42',()=>({ids:[30,10]}));assert.deepEqual((await s.orderedTopics('42')).map(t=>t.key),[30,10,'g2234500000_10','g2234500000_20']);
 await s.handle(input(1,{text:'/topicorder'}));await s.handle(input(2,{text:'3, 2'}));assert.deepEqual((await s.orderedTopics('42')).map(t=>t.key),['g2234500000_10',10,30,'g2234500000_20']);
 s.scope.additionalGroups.push({groupId:'-1003234500000',topicIds:[10],label:'Third'});assert.equal((await s.orderedTopics('42')).at(-1).key,'g3234500000_10');
});
test('caption edit uses stored external group instead of primary group after publication',async t=>{
 const s=setup(t),r=await s.handle(input(1,{...photo(1),caption:'Original'}));transport(s);await press(s,'tg2234500000_10',2);const d=s.store.read(r.json.jobKey);await s.requestEdit(d);const prompt=s.calls.at(-1);const file=fs.readdirSync(s.store.root).find(f=>f.startsWith('reply_42_'));const id=Number(file.slice(9,-5));let current='Original',writes=0;
 s.group=async(c,g)=>{assert.equal(g,extra);return new Api.InputPeerChannel({channelId:bi(extra.slice(4)),accessHash:bi(1)});};
 s.personal=async fn=>fn({getMessages:async()=>[{className:'Message',message:current,entities:[],fromId:new Api.PeerUser({userId:bi(42)}),peerId:new Api.PeerChannel({channelId:bi(extra.slice(4))}),replyTo:{replyToTopId:10}}],invoke:async req=>{assert.equal(req.className,'messages.EditMessage');assert.equal(String(req.peer.channelId),extra.slice(4));current=req.message;writes++;}},{premium:true});
 assert.equal((await s.editReply({text:'Edited',reply_to_message:{message_id:id,from:{id:99}}},'42')).status,'edited');assert.equal(writes,1);assert.equal(s.store.read(d.key).receipt.groupId,extra);
});
test('cloud layout revision applies requested default once, retains subsequent personal edits and forces a full-width topic row',async t=>{
 const order=[30,'g2234500000_20','g2234500000_10',10];
 const s=setup(t,{defaultTopicOrder:order,topicOrderRevision:'new-layout',fullWidthTopicKeys:[30]});
 s.store.change('topic_order_42',()=>({ids:[10,30]}));
 assert.deepEqual((await s.orderedTopics('42')).map(t=>t.key),order);
 const rows=topicKeyboard({},await s.orderedTopics('42'),0,true,true).markup.keyboard;
 assert.equal(rows[0].length,1);assert.equal(rows[0][0].text,'Topic 30');
 await s.handle(input(1,{text:'/topicorder'}));await s.handle(input(2,{text:'4,1'}));
 assert.deepEqual((await s.orderedTopics('42')).map(t=>t.key),[10,30,'g2234500000_20','g2234500000_10']);
 assert.equal(s.store.read('topic_order_42').orderRevision,'new-layout');
 await s.handle(input(3,{text:'/topicorder'}));await press(s,'resetorder',4);
 assert.deepEqual((await s.orderedTopics('42')).map(t=>t.key),[10,30,'g2234500000_10','g2234500000_20']);
});
