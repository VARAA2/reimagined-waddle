'use strict';
// User rule (21 Oct 2026): buttons inside a conversation use the RICH look (<tg-button> rows in the html), never
// Telegram's default inline keyboard; the inline keyboard is only kept when Telegram refuses the rich buttons.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Service}=require('../dist/nodes/NnaMediaCollection/core');
const {Store}=require('../dist/nodes/NnaMediaCollection/store');
const RF=require('../dist/nodes/NnaMediaCollection/rich-format');
const RN=require('../dist/nodes/NnaMediaCollection/rich-notices');
const {buttonsOf}=require('./rich-shown');
const creds={apiId:1,apiHash:'a'.repeat(32),sessionString:'1fake',expectedUserId:'42',allowedGroupId:'-1001234500000',allowedGroupUsername:'examplegroup',allowedTopicIds:'10'};
const scope={groupId:'-1001234500000',botUsername:'example_bot',operatorIds:['42'],topicIds:[10],allTopics:true};
const asset={photo:[{file_id:'file',file_unique_id:'unique',file_size:100}]};
const incoming=(id,extra={})=>({update_id:id,message:{message_id:id,date:Math.floor(Date.now()/1000),chat:{id:42,type:'private'},from:{id:42,is_bot:false},...extra}});
// real Service.bot; only the HTTP call to Telegram is replaced
function setup(t,refuse=()=>false){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'nna-media-test-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const calls=[];let id=200;
 const ctx={helpers:{httpRequest:async r=>{const method=r.url.split('/').pop();calls.push({method,body:r.body});const no=refuse(method,r.body);if(no)throw no;return {ok:true,result:{message_id:++id,chat:{id:42},from:{id:99,is_bot:true}}};}}};
 const s=new Service(ctx,creds,{accessToken:'1:abc'},scope,{root});
 s.me={id:99,username:'example_bot',is_bot:true};s.store=new Store(99,root);
 s.personal=async fn=>fn({}, {premium:false});s.topics=async()=>[{id:10,title:'Cinema',emoji:'🎬'}];
 return {s,calls};
}
test('topic buttons are drawn inside the rich question, no default inline keyboard',async t=>{
 const {s,calls}=setup(t),r=await s.handle(incoming(1,asset));
 const sent=calls.find(c=>c.method==='sendRichMessage').body,d=s.store.read(r.json.jobKey);
 assert.equal(sent.reply_markup,undefined);
 const b=buttonsOf(sent);assert(b.some(x=>x.callback_data===`mc:${d.key}:${d.rev}:t10`&&x.text.includes('Cinema')));
 assert(b.some(x=>x.callback_data===`mc:${d.key}:${d.rev}:cancel`));
 assert.match(sent.rich_message.html,/<tg-button type="callback_data" style="danger" data="mc:[^"]+:cancel">❌/);
});
test('Telegram refusing the rich buttons -> the same rich message with the inline keyboard, once',async t=>{
 const {s,calls}=setup(t,(method,body)=>method==='sendRichMessage'&&!body.reply_markup?{statusCode:400}:false);
 await s.handle(incoming(1,asset));
 const rich=calls.filter(c=>c.method==='sendRichMessage');assert.equal(rich.length,2);
 assert(rich[1].body.reply_markup.inline_keyboard.flat().some(x=>x.callback_data.endsWith(':t10')));
 assert(!rich[1].body.rich_message.html.includes('<tg-button '));
});
test('a transport error is never retried (no duplicate message)',async()=>{
 const calls=[];const s=new Service({helpers:{httpRequest:async r=>{calls.push(r);throw Error('socket hang up');}}},creds,{accessToken:'1:abc'},scope,{});
 await assert.rejects(s.bot('sendRichMessage',{chat_id:42,rich_message:{html:'<p>x</p>'},reply_markup:{inline_keyboard:[[{text:'a',callback_data:'b'}]]}}));
 assert.equal(calls.length,1);
});
test('moveButtons: callback / url / copy, edit clears the old keyboard, plain and unknown kinds untouched',()=>{
 const kb={inline_keyboard:[[{text:'🎬 A',callback_data:'x:1'},{text:'🔗 Link',url:'https://t.me/a?b=1&c=2'}],[{text:'📋 Copy',copy_text:{text:'#NNA "x"'}}]]};
 const sent=RF.moveButtons('sendRichMessage',{chat_id:1,rich_message:{html:'<p>x</p>'},reply_markup:kb});
 assert.equal(sent.reply_markup,undefined);assert.deepEqual(buttonsOf(sent),kb.inline_keyboard.flat());
 assert.equal((sent.rich_message.html.match(/<tg-button-row/g)||[]).length,2);
 assert.deepEqual(RF.moveButtons('editMessageText',{message_id:5,rich_message:{html:'h'},reply_markup:kb}).reply_markup,{inline_keyboard:[]});
 assert.equal(RF.moveButtons('sendMessage',{text:'x',reply_markup:kb}),null);
 assert.equal(RF.moveButtons('sendRichMessage',{rich_message:{html:'h'},reply_markup:{keyboard:[[{text:'menu'}]]}}),null);
 assert.equal(RF.moveButtons('sendRichMessage',{rich_message:{html:'h'},reply_markup:{inline_keyboard:[[{text:'w',web_app:{url:'https://a'}}]]}}),null);
 assert.equal(RF.moveButtons('editMessageText',{rich_message:{html:'h'},reply_markup:{inline_keyboard:[]}}),null);
});
test('after a post the topic question becomes a short posted page without buttons',()=>{
 const html=RN.topicDone('🎬 Cinema'),shown=RF.plain(html);
 assert(!html.includes('<tg-button'));assert.match(shown,/POSTED IN THE CHOSEN TOPIC/);assert(shown.includes('Cinema'));
});
