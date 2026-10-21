'use strict';
// User rule (21 Oct 2026): buttons inside a conversation use the RICH look (<tg-button> rows in the html), never
// Telegram's default inline keyboard; the inline keyboard is only kept when Telegram refuses the rich buttons.
// Exception (user, same day): the media parts (@nna_media_bot, media previews, media report / audio) keep their
// buttons exactly as before, so NnaMediaCollection does not move them.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Service:Poll}=require('../dist/nodes/NnaPollStudio/service');
const {Service:Media}=require('../dist/nodes/NnaMediaCollection/core');
const RF=require('../dist/nodes/NnaMediaCollection/rich-format');
const {buttonsOf}=require('./rich-shown');
const c={apiId:1,apiHash:'a'.repeat(32),sessionString:'1AAAA',expectedUserId:'42',expectedUsername:'tester',allowedGroupId:'-1001234500000',allowedGroupUsername:'testgroup',allowedTopicIds:'10'};
const scope={botId:'99',botUsername:'test_bot',operatorIds:['42'],groups:[{id:c.allowedGroupId,title:'Group'}],defaultTargets:[]};
const kb={inline_keyboard:[[{text:'💾 Template',callback_data:'ps:42:ab:save'},{text:'❌ ரத்து',callback_data:'ps:42:ab:cancel'}],[{text:'↗️ open',url:'https://t.me/test_bot?start=menu'}]]};
// real Service.bot; only the HTTP call to Telegram is replaced
function poll(t,refuse=()=>false){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'nna-rich-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const calls=[];const ctx={helpers:{httpRequest:async r=>{const method=r.url.split('/').at(-1);calls.push({method,body:r.body});const no=refuse(method,r.body);if(no)throw no;return {ok:true,result:{message_id:100+calls.length}};}}};
 return {s:new Poll(ctx,c,{accessToken:'99:test'},scope,{root}),calls};
}
test('Poll Studio: buttons of a rich card are drawn inside it, no default inline keyboard',async t=>{
 const {s,calls}=poll(t);await s.tell('42','plain text',kb.inline_keyboard,'<h1>CARD</h1>');
 const sent=calls.at(-1);assert.equal(sent.method,'sendRichMessage');assert.equal(sent.body.reply_markup,undefined);
 assert.deepEqual(buttonsOf(sent.body),kb.inline_keyboard.flat());
 assert.match(sent.body.rich_message.html,/style="danger" data="ps:42:ab:cancel">❌/);
});
test('Poll Studio: Telegram refusing the rich buttons -> the same rich card with the inline keyboard, once',async t=>{
 const {s,calls}=poll(t,(method,body)=>method==='sendRichMessage'&&!body.reply_markup?{statusCode:400}:false);
 await s.tell('42','plain text',kb.inline_keyboard,'<h1>CARD</h1>');
 assert.deepEqual(calls.map(x=>x.method),['sendRichMessage','sendRichMessage']);
 assert.deepEqual(calls[1].body.reply_markup,kb);assert(!calls[1].body.rich_message.html.includes('<tg-button '));
});
test('Poll Studio: a transport error is never retried (no duplicate message)',async t=>{
 const {s,calls}=poll(t,()=>Error('socket hang up'));
 await assert.rejects(s.bot('sendRichMessage',{chat_id:42,rich_message:{html:'<p>x</p>'},reply_markup:kb}));
 assert.equal(calls.length,1);
});
test('media parts keep their buttons exactly as before (user, 21 Oct 2026)',async()=>{
 const calls=[];const s=new Media({helpers:{httpRequest:async r=>{calls.push(r);return {ok:true,result:{message_id:1}};}}},c,{accessToken:'1:abc'},{groupId:c.allowedGroupId,botUsername:'nna_media_bot',operatorIds:['42'],topicIds:[10]},{});
 await s.bot('sendRichMessage',{chat_id:42,rich_message:{html:'<p>x</p>'},reply_markup:kb});
 assert.deepEqual(calls[0].body.reply_markup,kb);assert.equal(calls[0].body.rich_message.html,'<p>x</p>');
});
test('moveButtons: callback / url / copy, edit clears the old keyboard, plain and unknown kinds untouched',()=>{
 const k={inline_keyboard:[[{text:'🎬 A',callback_data:'x:1'},{text:'🔗 Link',url:'https://t.me/a?b=1&c=2'}],[{text:'📋 Copy',copy_text:{text:'#NNA "x"'}}]]};
 const sent=RF.moveButtons('sendRichMessage',{chat_id:1,rich_message:{html:'<p>x</p>'},reply_markup:k});
 assert.equal(sent.reply_markup,undefined);assert.deepEqual(buttonsOf(sent),k.inline_keyboard.flat());
 assert.equal((sent.rich_message.html.match(/<tg-button-row/g)||[]).length,2);
 assert.deepEqual(RF.moveButtons('editMessageText',{message_id:5,rich_message:{html:'h'},reply_markup:k}).reply_markup,{inline_keyboard:[]});
 assert.equal(RF.moveButtons('sendMessage',{text:'x',reply_markup:k}),null);
 assert.equal(RF.moveButtons('sendRichMessage',{rich_message:{html:'h'},reply_markup:{keyboard:[[{text:'menu'}]]}}),null);
 assert.equal(RF.moveButtons('sendRichMessage',{rich_message:{html:'h'},reply_markup:{inline_keyboard:[[{text:'w',web_app:{url:'https://a'}}]]}}),null);
 assert.equal(RF.moveButtons('editMessageText',{rich_message:{html:'h'},reply_markup:{inline_keyboard:[]}}),null);
});
