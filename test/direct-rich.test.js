'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseDirectRequest,sendDirect}=require('../dist/nodes/NnaTelegramSender/direct');
const {runOperation}=require('../dist/nodes/NnaTelegramSender/sender');
const {Api}=require('teleproto'),bigInt=require('big-integer');
const now=Date.parse('2026-10-26T17:40:00Z');
const cfg={allowedOperatorIds:'12345,67890',reviewChatId:'-1001234567',botId:'88888'};
const link=url=>({type:'paragraph',text:{type:'url',text:url,url}});
// Same shape as the real request of 26 Oct 2026 (a #NNA Text Editor rich message pasted with the link on top).
const blocks=()=>[
 link('https://t.me/example_group/10/30'),
 {type:'paragraph',text:'அருட்பெருஞ்ஜோதி🔥'},
 {type:'paragraph',text:{type:'bold',text:'📝 R K பகிர்வு'}},
 {type:'pullquote',text:'அரனடி சொல்லி அரற்றி அழுது\nபரனடி நாடியே பாவிப்ப நாளும்'},
 {type:'details',summary:'📖 முழுமையான பாடல் விளக்கம்',blocks:[
  {type:'table',cells:[[{text:'📜 பாடற்பகுதி',is_header:true,align:'left',valign:'top'},{text:'🪔 பொருள்',is_header:true,align:'left',valign:'top'}],[{text:'அரனடி <சொல்லி>',align:'left',valign:'top'},{text:['🙏 ',{type:'italic',text:'சிவம்'},' & அன்பு'],align:'left',valign:'top'}]],is_bordered:true},
  {type:'paragraph',text:{type:'bold',text:'🌸🪔 மொத்தப் பொருள்'}}]},
 {type:'list',items:[{label:'•',blocks:[{type:'paragraph',text:'🙏 ஒன்று'}]},{label:'•',blocks:[{type:'paragraph',text:'💧 இரண்டு'}]}]},
 {type:'divider'},
 {type:'paragraph',text:['நன்றி ',{type:'custom_emoji',custom_emoji_id:'5188678912883827293',alternative_text:'🤖'},' ',{type:'url',text:'site',url:'https://nnanetwork.com/?a=1&b=2'}]},
];
const event=(rich_message,patch={})=>({update_id:7,message:{message_id:8,date:now/1000,from:{id:67890,is_bot:false},chat:{id:67890,type:'private'},rich_message,...patch}});

test('a rich message with the link as its first paragraph becomes a rich reply with every block kept',()=>{
 const e=parseDirectRequest(event({blocks:blocks()}),cfg,now);
 assert.equal(e.kind,'direct');assert.equal(e.rich,true);assert.equal(e.targetUrl,'https://t.me/example_group/10/30');assert.deepEqual(e.mentionIds,[]);
 assert.equal(e.html,
  '<p>அருட்பெருஞ்ஜோதி🔥</p><p><b>📝 R K பகிர்வு</b></p><aside>அரனடி சொல்லி அரற்றி அழுது<br>பரனடி நாடியே பாவிப்ப நாளும்</aside>'+
  '<details><summary>📖 முழுமையான பாடல் விளக்கம்</summary><table bordered><tr><th align="left" valign="top">📜 பாடற்பகுதி</th><th align="left" valign="top">🪔 பொருள்</th></tr>'+
  '<tr><td align="left" valign="top">அரனடி &lt;சொல்லி&gt;</td><td align="left" valign="top">🙏 <i>சிவம்</i> &amp; அன்பு</td></tr></table><p><b>🌸🪔 மொத்தப் பொருள்</b></p></details>'+
  '<ul><li>🙏 ஒன்று</li><li>💧 இரண்டு</li></ul><hr/>'+
  '<p>நன்றி <tg-emoji emoji-id="5188678912883827293">🤖</tg-emoji> <a href="https://nnanetwork.com/?a=1&amp;b=2">site</a></p>');
 assert.match(e.body,/^அருட்பெருஞ்ஜோதி🔥\n📝 R K பகிர்வு\n/);assert.ok(!e.body.includes('https://t.me/example_group'));
});
test('link as the last paragraph, empty edge paragraphs, ordered and checkbox lists, quotes and headings',()=>{
 const b=[{type:'paragraph',text:''},{type:'heading',text:'தலைப்பு',size:2},{type:'blockquote',blocks:[{type:'paragraph',text:'a'},{type:'paragraph',text:'b'}],credit:'VARA'},
  {type:'expandable_blockquote',text:'long'},{type:'list',items:[{label:'1.',value:1,blocks:[{type:'paragraph',text:'x'}]},{label:'2.',value:2,blocks:[{type:'paragraph',text:'y'}]}]},
  {type:'list',items:[{label:'•',has_checkbox:true,is_checked:true,blocks:[{type:'paragraph',text:'done'}]}]},{type:'pre',text:'a<b',language:'js'},
  link('https://t.me/c/1234567/30'),{type:'paragraph',text:''}];
 const e=parseDirectRequest(event({blocks:b}),cfg,now);
 assert.equal(e.target.peer,'-1001234567');
 assert.equal(e.html,'<h2>தலைப்பு</h2><blockquote>a<br>b<cite>VARA</cite></blockquote><blockquote expandable>long</blockquote><ol><li value="1">x</li><li value="2">y</li></ol><ul><li><input type="checkbox" checked>done</li></ul><pre><code class="language-js">a&lt;b</code></pre>');
});
test('rich requests are refused clearly: no link, two links, link only, photos; normal rich chat is ignored',()=>{
 assert.equal(parseDirectRequest(event({blocks:[{type:'paragraph',text:'just chat'}]}),cfg,now),null);
 const bad=[[link('https://t.me/example_group/30'),{type:'paragraph',text:'x'},link('https://t.me/example_group/31')],[{type:'paragraph',text:'see https://t.me/example_group/30 here'}]];
 for(const x of bad)assert.equal(parseDirectRequest(event({blocks:x}),cfg,now).error,'NNA_PUT_ONE_TARGET_LINK_ON_FIRST_OR_LAST_LINE');
 assert.equal(parseDirectRequest(event({blocks:[link('https://t.me/example_group/30')]}),cfg,now).error,'NNA_REPLY_TEXT_1_TO_4096_REQUIRED');
 assert.equal(parseDirectRequest(event({blocks:[link('https://t.me/example_group/30'),{type:'photo',photo:[]}]}),cfg,now).error,'NNA_RICH_MEDIA_NOT_SUPPORTED');
 assert.equal(parseDirectRequest(event({blocks:blocks()},{forward_origin:{type:'user'}}),cfg,now).error,'NNA_FORWARD_NOT_DIRECT_INSTRUCTION');
});
const credentials={apiId:12345,apiHash:'a'.repeat(32),sessionString:'1'+'A'.repeat(352),expectedUserId:'12345',allowedGroupId:'-1001234567',allowedGroupUsername:'example_group',allowedTopicIds:'10,20'};
function params(){const update=event({blocks:blocks()});const e=parseDirectRequest(update,cfg,now);return {...cfg,update,claimValidated:true,claimRequestKey:e.requestKey,claimOperatorId:e.operatorId,claimBody:e.body,claimUrl:e.targetUrl};}
function client(sentRich=true){let last;const peerId=new Api.PeerChannel({channelId:bigInt(1234567)});const source=new Api.Message({id:30,peerId,message:'Question',replyTo:new Api.MessageReplyHeader({forumTopic:true,replyToTopId:10,replyToMsgId:10})});
 return {get last(){return last;},connect:async()=>{},destroy:async()=>{},getMe:async()=>new Api.User({id:bigInt(12345)}),getEntity:async()=>new Api.Channel({id:bigInt(1234567),username:'example_group',megagroup:true,forum:true}),getInputEntity:async()=>new Api.InputPeerChannel({channelId:bigInt(1234567),accessHash:bigInt(1)}),getMessages:async()=>[source],
  invoke:async r=>{last=r;return {updates:[{className:'UpdateMessageID',randomId:r.randomId,id:40},{message:new Api.Message({id:40,out:true,fromId:new Api.PeerUser({userId:bigInt(12345)}),peerId,message:'',richMessage:sentRich?new Api.RichMessage({blocks:[],photos:[],documents:[]}):undefined,replyTo:new Api.MessageReplyHeader({forumTopic:true,replyToMsgId:30,replyToTopId:10})})}]};}};}
test('rich reply is sent as InputRichMessageHTML from the personal account, as a reply in the right topic',async()=>{
 const c=client();const result=await runOperation('sendDirectReply',credentials,params(),{now,createClient:async()=>c});
 assert.equal(result.status,'sent');assert.equal(result.sentId,40);assert.deepEqual(result.mentioned,[]);
 const r=c.last;assert.equal(r.className,'messages.SendMessage');assert.equal(r.message,'');assert.equal(r.richMessage.className,'InputRichMessageHTML');
 assert.equal(r.richMessage.html,parseDirectRequest(params().update,cfg,now).html);assert.equal(r.replyTo.replyToMsgId,30);assert.equal(r.replyTo.topMsgId,10);assert.equal(r.sendAs.className,'InputPeerSelf');
 assert.ok(Buffer.isBuffer(r.getBytes()));
});
test('a sent message without rich content is not counted as delivered',async()=>{
 await assert.rejects(sendDirect(client(false),credentials,params(),x=>x,now),/UNCONFIRMED/);
});
