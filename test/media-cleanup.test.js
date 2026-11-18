'use strict';
// 0.58.0 (owner, 14 Nov 2026): after a post the private chat keeps only the media and ONE "பதிவிடப்பட்டது" card.
// Reply to that card -> topics again -> a second topic -> same media posted there, the in-between messages deleted,
// one new card naming both topics. A caption edit changes every topic's post and also leaves one card.
const {shown}=require('./rich-shown');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Api}=require('teleproto'),bigInt=require('big-integer');
const {Service}=require('../dist/nodes/NnaMediaCollection/core');
const {Store}=require('../dist/nodes/NnaMediaCollection/store');
const creds={apiId:1,apiHash:'a'.repeat(32),sessionString:'1fake',expectedUserId:'42',allowedGroupId:'-1001234500000',allowedGroupUsername:'examplegroup',allowedTopicIds:'10'};
const scope={groupId:'-1001234500000',botUsername:'example_bot',operatorIds:['42'],topicIds:[10],allTopics:true,albums:true,replyKeyboard:true,buttonCustomEmoji:false};
const photo=id=>({photo:[{file_id:'file'+id,file_unique_id:'unique'+id,file_size:100}],caption:'Hello'});
const input=(id,body={})=>({update_id:id,message:{message_id:id,date:Math.floor(Date.now()/1000),chat:{id:42,type:'private'},from:{id:42,is_bot:false},...body}});
const fromBot={id:99,is_bot:true};
function setup(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'nna-cleanup-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const s=new Service({},creds,{},scope,{root});s.me={id:99,is_bot:true,username:'example_bot'};s.store=new Store(99,root);s.calls=[];let mid=1000;
 s.bot=async(method,body)=>{s.calls.push({method,body});return method.startsWith('delete')?true:{message_id:++mid};};
 s.topics=async()=>[{id:10,title:'Cinema',emoji:'🎬'},{id:11,title:'News',emoji:'📰'}];
 // personal account: SendMedia / EditMessage / getMessages against a small in-memory group
 const posts=new Map();let next=500;
 s.stage=async d=>({source:{media:new Api.MessageMediaPhoto({photo:new Api.Photo({id:bigInt(Number(d.sourceMessageId)+700),accessHash:bigInt(1),fileReference:Buffer.from('a'),date:0,sizes:[],dcId:1})})},botMessageId:9});
 s.cleanup=async()=>{};s.group=async()=>new Api.InputPeerChannel({channelId:bigInt(1234500000),accessHash:bigInt(1)});
 const client={
  invoke:async r=>{
   if(r.className==='messages.SendMedia'){const id=++next;posts.set(id,{message:r.message,entities:r.entities,topicId:r.replyTo.topMsgId,media:new Api.MessageMediaPhoto({photo:r.media.id?new Api.Photo({id:r.media.id.id,accessHash:bigInt(1),fileReference:Buffer.from('a'),date:0,sizes:[],dcId:1}):undefined})});return {updates:[{className:'UpdateMessageID',id,randomId:r.randomId}]};}
   if(r.className==='messages.EditMessage'){const p=posts.get(r.id);p.message=r.message;p.entities=r.entities;return {};}
   throw Error('unexpected '+r.className);
  },
  getMessages:async(_peer,{ids})=>ids.map(id=>{const p=posts.get(id);return p&&{className:'Message',id,fromId:new Api.PeerUser({userId:bigInt(42)}),peerId:new Api.PeerChannel({channelId:bigInt(1234500000)}),replyTo:{replyToTopId:p.topicId},message:p.message,entities:p.entities,media:p.media};}),
 };
 s.personal=async fn=>fn(client,{premium:true});s.posts=posts;
 return s;
}
const press=(s,action,id)=>{const ui=s.store.read('ui_42');const c=ui.choices.find(x=>x.action===action);assert(c,action);return s.handle(input(id,{text:c.text}));};
const deleted=s=>s.calls.filter(c=>c.method==='deleteMessages').flatMap(c=>c.body.message_ids);
const cards=s=>s.calls.filter(c=>c.method==='sendRichMessage'&&/பதிவிடப்பட்டது|திருத்தப்பட்டது/.test(shown(c.body)||'')&&/MEDIA|CAPTION/.test(shown(c.body)));

async function posted(t){
 const s=setup(t);const r=await s.handle(input(1,photo(1)));const key=r.json.jobKey;
 const question=s.store.read('ui_42').controlId;
 assert.equal((await press(s,'t10',100)).json.status,'sent');
 return {s,key,question};
}
test('after the first post only the media and the one receipt card stay: topic question and topic tap are deleted',async t=>{
 const {s,key,question}=await posted(t);const d=s.store.read(key);
 assert.equal(s.posts.size,1);
 const del=deleted(s);assert(del.includes(question),'topic question deleted');assert(del.includes(100),'owner topic tap deleted');
 assert(!del.includes(1),'media kept');assert(!del.includes(d.receiptControlId),'receipt kept');assert(!del.includes(s.store.read('ui_42').controlId),'keyboard line kept');
 assert.equal(cards(s).length,1);assert.equal(d.controlId,0);
 // the keyboard line came before the delete, so the reply keyboard never vanishes
 const i=s.calls.findIndex(c=>c.method==='deleteMessages'),j=s.calls.findIndex(c=>c.body?.text==='👇 அடுத்த media அனுப்பலாம்');assert(j>=0&&j<i);
});
test('Reply to the receipt card re-opens topics; a second topic posts the same media, deletes the in-between messages and the old card, one new card names both topics',async t=>{
 const {s,key}=await posted(t);const first=s.store.read(key).receiptControlId,firstLine=s.store.read('after_post_42').messageId;
 const shownAgain=await s.handle(input(101,{text:'இன்னொரு topic',reply_to_message:{message_id:first,from:fromBot}}));assert.equal(shownAgain.json.status,'draft_selected');
 const question2=s.store.read('ui_42').controlId;assert.equal(s.store.read('ui_42').key,key);
 const before=s.calls.length;
 assert.equal((await press(s,'t11',102)).json.status,'sent');
 assert.equal(s.posts.size,2);assert.deepEqual([...s.posts.values()].map(p=>p.topicId),[10,11]);
 const del=s.calls.slice(before).filter(c=>c.method==='deleteMessages').flatMap(c=>c.body.message_ids);
 for(const id of [101,question2,102,first,firstLine])assert(del.includes(id),'deleted '+id);
 const o=s.store.read(key);assert(!del.includes(o.receiptControlId));assert(!del.includes(1));
 const card=cards(s).at(-1);const text=shown(card.body);
 assert(text.includes('2 TOPICS'));assert(text.includes('Cinema')&&text.includes('News'));
 assert.equal(card.body.reply_parameters.message_id,1);
 const html=card.body.rich_message.html;assert(html.includes('📄 Cinema')&&html.includes('📄 News'));assert(html.includes('mc:'+key+':'+o.rev+':edit'));
 assert.equal(o.copies.length,1);assert.equal(s.store.read(o.copies[0].key).receiptControlId,o.receiptControlId);
 // the same topic again is refused, nothing posted
 await s.handle(input(103,{text:'again',reply_to_message:{message_id:o.receiptControlId,from:fromBot}}));
 assert.equal((await press(s,'t10',104)).json.status,'already_in_topic');assert.equal(s.posts.size,2);
});
test('caption edit from the two-topic card changes both posts and leaves one card (prompt and owner reply deleted)',async t=>{
 const {s,key}=await posted(t);
 await s.handle(input(101,{text:'again',reply_to_message:{message_id:s.store.read(key).receiptControlId,from:fromBot}}));await press(s,'t11',102);
 const o=s.store.read(key),oldCard=o.receiptControlId;
 await s.requestEdit(o);const prompt=s.calls.at(-1);const promptId=1000+s.calls.filter(c=>!c.method.startsWith('delete')).length;
 const r=await s.handle(input(110,{text:'New caption',reply_to_message:{message_id:promptId,from:fromBot}}));
 assert.equal(r.json.status,'edited');assert.equal(r.json.copies,1);
 assert.deepEqual([...s.posts.values()].map(p=>p.message),['New caption','New caption']);
 const del=deleted(s);for(const id of [oldCard,promptId,110])assert(del.includes(id),'deleted '+id);
 const card=cards(s).at(-1);assert(shown(card.body).includes('CAPTION UPDATED'));assert(shown(card.body).includes('2 TOPICS'));
 assert(prompt.body);
});
test('each new post keeps only the newest "next media" keyboard line',async t=>{
 const {s}=await posted(t);const line1=s.store.read('after_post_42').messageId;
 await s.handle(input(2,photo(2)));await press(s,'t11',200);
 assert(deleted(s).includes(line1));assert.notEqual(s.store.read('after_post_42').messageId,line1);
});
test('a failed post deletes nothing',async t=>{
 const s=setup(t);await s.handle(input(1,photo(1)));s.group=async()=>{throw Error('no group');};
 assert.equal((await press(s,'t10',100)).json.status,'failed');assert.equal(deleted(s).length,0);
});
