'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Api}=require('teleproto'),bigInt=require('big-integer');
const {Service}=require('../dist/nodes/NnaMediaCollection/core');
const {Store}=require('../dist/nodes/NnaMediaCollection/store');
const {topicKeyboard}=require('../dist/nodes/NnaMediaCollection/album-ui');
const creds={apiId:1,apiHash:'a'.repeat(32),sessionString:'1fake',expectedUserId:'42',allowedGroupId:'-1001234500000',allowedGroupUsername:'examplegroup',allowedTopicIds:'10'};
const scope={groupId:'-1001234500000',botUsername:'example_bot',operatorIds:['42','43'],topicIds:[10],allTopics:true,albums:true,replyKeyboard:true,buttonCustomEmoji:true};
const photo=id=>({photo:[{file_id:'file'+id,file_unique_id:'unique'+id,file_size:100}]});
test('full topic keyboard contains every topic once, preserves order and icons, without paging',()=>{const titles=['One','Two','Three','Medium topic name','Another medium','A very long topic name that needs its own row'];const topics=Array.from({length:33},(_,i)=>({id:i+1,title:titles[i]||'Topic '+i,iconCustomEmojiId:String(5000+i)}));const menu=topicKeyboard({},topics,4,true,true);assert.equal(menu.pages,1);assert.equal(menu.page,0);assert.deepEqual(menu.choices.filter(x=>/^t\d+$/.test(x.action)).map(x=>x.action),topics.map(t=>'t'+t.id));assert(!menu.choices.some(x=>/^p\d+$/.test(x.action)));const rows=menu.markup.keyboard;assert.deepEqual(rows[0].map(x=>x.text),titles.slice(0,3));assert.deepEqual(rows[1].map(x=>x.text),titles.slice(3,5));assert.equal(rows[2].length,1);assert.equal(rows[2][0].text,titles[5]);assert.deepEqual(rows.flat().slice(0,33).map(x=>x.icon_custom_emoji_id),topics.map(t=>t.iconCustomEmojiId));assert.equal(menu.markup.is_persistent,false);});
const input=(id,body={},owner=42)=>({update_id:id,message:{message_id:id,date:Math.floor(Date.now()/1000),chat:{id:owner,type:'private'},from:{id:owner,is_bot:false},...body}});
function setup(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'nna-album-test-'));t.after(()=>{assert.equal(path.dirname(root),os.tmpdir());assert(path.basename(root).startsWith('nna-album-test-'));fs.rmSync(root,{recursive:true,force:true});});
 const s=new Service({},creds,{},scope,{root});s.me={id:99,is_bot:true,username:'example_bot'};s.store=new Store(99,root);s.calls=[];let mid=1000;
 s.bot=async(method,body)=>{s.calls.push({method,body});return {message_id:++mid};};s.personal=async fn=>fn({},{});s.topics=async()=>[{id:10,title:'Cinema',emoji:'🎬',iconCustomEmojiId:'5000000000000000001'}];
 return s;
}
function press(s,action,id=100){const ui=s.store.read('ui_42');const choice=ui.choices.find(x=>x.action===action);assert(choice,action);return s.handle(input(id,{text:choice.text}));}
test('full keyboard routes the last topic directly without an intervening page action',async t=>{const s=setup(t);s.scope={...s.scope,fullTopicKeyboard:true};s.topics=async()=>Array.from({length:33},(_,i)=>({id:i+10,title:'Topic '+i}));let selected;s.publish=async(d,id)=>{selected=id;return {next:0,status:'sent'};};await s.handle(input(1,photo(1)));assert.equal(s.store.read('ui_42').choices.filter(x=>/^t\d+$/.test(x.action)).length,33);await press(s,'t42',2);assert.equal(selected,42);});
async function ready(t){const s=setup(t);await s.handle(input(2,{...photo(2),media_group_id:'groupA',caption:'Second'}));const r=await s.handle(input(1,{...photo(1),media_group_id:'groupA',caption:'First',caption_entities:[{type:'bold',offset:0,length:5}]}));s.store.change(r.json.jobKey,x=>({...x,lastAssetAt:Date.now()-3000}));await press(s,'ready',90);return {s,key:r.json.jobKey};}
test('ready album cancellation sends a new status and never edits reply-keyboard message',async t=>{const {s,key}=await ready(t);const bot=s.bot;s.bot=async(method,body)=>{assert.notEqual(method,'editMessageText');return bot(method,body);};assert.equal((await press(s,'cancel')).json.status,'cancelled');assert.equal(s.store.read(key).status,'cancelled');assert.equal(s.store.read('ui_42').kind,'home');});
test('collecting album can be cancelled after subsequent assets increment its revision',async t=>{const s=setup(t);const r=await s.handle(input(1,{...photo(1),media_group_id:'collect'}));await s.handle(input(2,{...photo(2),media_group_id:'collect'}));assert.equal((await press(s,'cancel')).json.status,'cancelled');assert.equal(s.store.read(r.json.jobKey).status,'cancelled');});
test('analysis starts a new status message when original control uses reply keyboard',async t=>{const {s,key}=await ready(t);const d=s.store.read(key);s.analyze=async x=>({json:{next:1,status:x.status}});const bot=s.bot;s.bot=async(method,body)=>{assert.notEqual(method,'editMessageText');return bot(method,body);};const r=await s.startAnalysis(d,{commandMessageId:200});assert.equal(r.json.status,'analysing');assert.notEqual(s.store.read(key).controlId,d.controlId);});
function transport(s,{uncertain=false,badGroup=false}={}){
 let request,writes=0,stages=0,cleaned=0;
 const src=new Map();s.stage=async d=>{const id=Number(d.sourceMessageId)+500;const media=d.kind==='video'?new Api.MessageMediaDocument({document:new Api.Document({id:bigInt(id),accessHash:bigInt(1),fileReference:Buffer.from('a'),date:0,mimeType:'video/mp4',size:bigInt(100),dcId:1,attributes:[new Api.DocumentAttributeVideo({duration:1,w:640,h:480,supportsStreaming:true})]})}):new Api.MessageMediaPhoto({photo:new Api.Photo({id:bigInt(id),accessHash:bigInt(1),fileReference:Buffer.from('a'),date:0,sizes:[],dcId:1})});src.set(id,media);stages++;return {source:{media},botMessageId:id};};s.cleanup=async()=>{cleaned++;};s.group=async()=>new Api.InputPeerChannel({channelId:bigInt(1234500000),accessHash:bigInt(1)});
 const client={invoke:async r=>{request=r;writes++;assert.equal(r.className,'messages.SendMultiMedia');r.getBytes();if(uncertain)throw Error('network lost');return {updates:r.multiMedia.map((m,i)=>({className:'UpdateMessageID',id:100+i,randomId:m.randomId}))};},getMessages:async()=>request.multiMedia.map((m,i)=>({className:'Message',id:100+i,fromId:new Api.PeerUser({userId:bigInt(42)}),peerId:new Api.PeerChannel({channelId:bigInt(1234500000)}),replyTo:{replyToTopId:10},message:m.message,entities:m.entities,groupedId:bigInt(badGroup?800+i:800),media:src.get(Number(String(m.media.id.id)))}))};
 s.personal=async fn=>fn(client,{premium:true});return {get request(){return request;},get writes(){return writes;},get stages(){return stages;},get cleaned(){return cleaned;}};
}
test('topic keyboard uses real custom icon identifiers and one topic per row without cutting titles',()=>{
 const long='A very long topic name that must be shown on its own full width row';
 const topics=[{id:1,title:'One',iconCustomEmojiId:'555'},{id:2,title:'Two'},{id:3,title:'Three'},{id:4,title:long},...Array.from({length:12},(_,i)=>({id:i+5,title:'Topic '+i}))];
 const menu=topicKeyboard({},topics);assert.equal(menu.pages,2);assert.equal(menu.markup.keyboard[0].length,1);assert.equal(menu.markup.keyboard[3].length,1);assert.equal(menu.markup.keyboard[3][0].text,'📁 '+long);assert.equal(menu.markup.keyboard[0][0].icon_custom_emoji_id,'555');assert.equal(menu.markup.is_persistent,false);assert.equal(menu.choices.filter(c=>/^t\d+$/.test(c.action)).length,8);
});
test('album collects out of order and duplicate updates into one draft before any send',async t=>{
 const s=setup(t);let published=0;s.publish=async()=>{published++;};const one=await s.handle(input(2,{...photo(2),media_group_id:'g'}));await s.handle(input(1,{...photo(1),media_group_id:'g'}));await s.handle(input(2,{...photo(2),media_group_id:'g'}));
 const d=s.store.read(one.json.jobKey);assert.equal(d.status,'collecting');assert.deepEqual(d.assets.map(x=>x.sourceMessageId),[1,2]);assert.equal(published,0);assert.equal(s.calls.filter(c=>c.method==='sendMessage').length,1);
});
test('two operators and album identifiers never share composer state',async t=>{
 const s=setup(t);const a=await s.handle(input(1,{...photo(1),media_group_id:'same'},42)),b=await s.handle(input(1,{...photo(1),media_group_id:'same'},43));assert.notEqual(a.json.jobKey,b.json.jobKey);assert.equal(s.store.read(a.json.jobKey).owner,'42');assert.equal(s.store.read(b.json.jobKey).owner,'43');
});
test('ready button shows complete count and text topic selection publishes one native album as personal account',async t=>{
 const {s,key}=await ready(t),mock=transport(s);assert(s.calls.at(-1).body.text.includes('2 media'));const result=await press(s,'t10');assert.equal(result.json.status,'sent');assert.equal(mock.writes,1);assert.equal(mock.request.sendAs.className,'InputPeerSelf');assert.equal(mock.request.replyTo.topMsgId,10);assert.deepEqual(mock.request.multiMedia.map(x=>x.message),['First','Second']);assert.equal(mock.request.multiMedia[0].entities[0].className,'MessageEntityBold');assert.equal(mock.cleaned,2);assert.equal(s.store.read(key).receipt.items.length,2);assert.equal(s.store.read('ui_42').kind,'home');
 await s.handle(input(101,{text:'Cinema'}));assert.equal(mock.writes,1);
});
test('album with no captions is supported',async t=>{
 const {s,key}=await ready(t);s.store.change(key,x=>({...x,assets:x.assets.map(a=>({...a,caption:'',entities:[]}))}));const mock=transport(s);assert.equal((await press(s,'t10')).json.status,'sent');assert(mock.request.multiMedia.every(m=>m.message===''&&m.entities.length===0));
});
test('multiple videos and mixed photo/video albums preserve original order and native media types',async t=>{
 for(const kinds of [['video','video'],['photo','video','photo']]){
  const s=setup(t);let r;for(const [i,kind] of kinds.entries()){const media=kind==='photo'?photo(i+1):{video:{file_id:'video'+i,file_unique_id:'video'+i,mime_type:'video/mp4',file_size:100,duration:1}};r=await s.handle(input(i+1,{...media,media_group_id:'mixed',caption:'Item '+i}));}
  s.store.change(r.json.jobKey,x=>({...x,lastAssetAt:Date.now()-3000}));await press(s,'ready',90);const mock=transport(s);assert.equal((await press(s,'t10')).json.status,'sent');assert.deepEqual(mock.request.multiMedia.map(x=>x.media.className),kinds.map(k=>k==='photo'?'InputMediaPhoto':'InputMediaDocument'));assert.deepEqual(mock.request.multiMedia.map(x=>x.message),kinds.map((_,i)=>'Item '+i));assert.equal(mock.writes,1);
 }
});
test('uncertain album send retains receipts guard and cannot resend through old keyboard',async t=>{
 const {s,key}=await ready(t),mock=transport(s,{uncertain:true});assert.equal((await press(s,'t10')).json.status,'uncertain');assert.equal(s.store.read(key).status,'uncertain');assert.equal(mock.cleaned,0);await assert.rejects(press(s,'t10',101),/ALREADY_HANDLED/);assert.equal(mock.writes,1);
});
test('separate grouped identifiers fail album verification instead of reporting success',async t=>{
 const {s,key}=await ready(t),mock=transport(s,{badGroup:true});assert.equal((await press(s,'t10')).json.status,'uncertain');assert.equal(mock.writes,1);assert.equal(s.store.read(key).lastError,'MEDIA_ALBUM_GROUP_UNCONFIRMED');
});
test('unavailable topic rejects before staging or posting any album item',async t=>{
 const {s,key}=await ready(t),mock=transport(s);s.topics=async()=>[{id:10,title:'Cinema',closed:true}];assert.equal((await press(s,'t10')).json.status,'failed');assert.equal(mock.stages,0);assert.equal(mock.writes,0);assert.equal(s.store.read(key).status,'pending');
});
test('late arrival refreshes pending album keyboard and is blocked after sending',async t=>{
 const {s,key}=await ready(t);await s.handle(input(3,{...photo(3),media_group_id:'groupA'}));assert.equal(s.store.read(key).assets.length,3);assert.equal(s.store.read('ui_42').rev,s.store.read(key).rev);transport(s);assert.equal((await press(s,'t10')).json.status,'sent');assert.equal((await s.handle(input(4,{...photo(4),media_group_id:'groupA'}))).json.status,'album_late');assert.equal(s.store.read(key).assets.length,3);
});
test('oversized and unsupported album members block the whole draft, not partial publication',async t=>{
 const s=setup(t);let last;for(let i=1;i<=11;i++)last=await s.handle(input(i,{...photo(i),media_group_id:'large'}));assert.equal(last.json.status,'album_blocked');assert.equal(s.store.read(last.json.jobKey).status,'blocked');
 await s.handle(input(20,{...photo(20),media_group_id:'bad'}));const bad=await s.handle(input(21,{document:{file_id:'pdf',file_unique_id:'pdf',mime_type:'application/pdf'},media_group_id:'bad'}));assert.equal(bad.json.status,'album_blocked');
});
test('topic pages preserve selected draft and old replied-to keyboard is rejected',async t=>{
 const s=setup(t);s.topics=async()=>Array.from({length:30},(_,i)=>({id:10+i,title:'Topic '+i}));await s.handle(input(1,photo(1)));const old=s.store.read('ui_42');await press(s,'p1',2);const next=s.store.read('ui_42');assert.equal(next.key,old.key);assert.equal(next.page,1);assert.notEqual(next.controlId,old.controlId);await assert.rejects(s.handle(input(3,{text:next.choices[0].text,reply_to_message:{message_id:old.controlId}})),/STALE_KEYBOARD/);
});
test('custom emoji fallback only retries an explicit rejection and keeps button text mapping',async t=>{
 const s=setup(t);let tries=0;const base=s.tell;s.tell=async function(...args){tries++;if(tries===1){const e=Error('rejected');e.customEmojiRejected=true;throw e;}return base.apply(this,args);};await s.handle(input(1,photo(1)));assert.equal(tries,2);assert.equal(s.store.read('keyboard_icons').disabled,true);assert(!s.calls.at(-1).body.reply_markup.keyboard[0][0].icon_custom_emoji_id);
 const s2=setup(t);let calls=0;s2.tell=async()=>{calls++;throw Error('timeout');};await assert.rejects(s2.handle(input(1,photo(1))),/timeout/);assert.equal(calls,1);
});
test('album cancellation and pending draft switch use only the owning private keyboard',async t=>{
 const s=setup(t);const a=await s.handle(input(1,{...photo(1),media_group_id:'cancel'}));await press(s,'cancel',2);assert.equal(s.store.read(a.json.jobKey).status,'cancelled');assert.equal(s.store.read('ui_42').kind,'home');await s.handle(input(3,photo(3)));await press(s,'pending',4);assert.equal(s.store.read('ui_42').kind,'drafts');const choice=s.store.read('ui_42').choices.find(x=>x.action.startsWith('draft:'));await s.handle(input(5,{text:choice.text}));assert.equal(s.store.read('ui_42').kind,'topics');
});
test('operator can persist partial topic order, new topics follow, and reset without changing another operator',async t=>{
 const s=setup(t);s.topics=async()=>[{id:10,title:'First'},{id:20,title:'Second'},{id:30,title:'Third'}];await s.handle(input(1,{text:'/topicorder'}));assert.equal((await s.handle(input(2,{text:'3, 1'}))).json.status,'order_saved');assert.deepEqual((await s.orderedTopics('42')).map(t=>t.id),[30,10,20]);assert.deepEqual((await s.orderedTopics('43')).map(t=>t.id),[10,20,30]);
 s.topics=async()=>[{id:10,title:'Renamed'},{id:20,title:'Second'},{id:30,title:'Third'},{id:40,title:'New'}];assert.deepEqual((await s.orderedTopics('42')).map(t=>t.id),[30,10,20,40]);await s.handle(input(3,{text:'/topicorder'}));assert.equal((await s.handle(input(4,{text:'1,1'}))).json.status,'order_invalid');await press(s,'resetorder',5);assert.deepEqual((await s.orderedTopics('42')).map(t=>t.id),[10,20,30,40]);
});
