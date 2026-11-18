'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Api}=require('teleproto'),bigInt=require('big-integer');
const sm=require('../dist/nodes/NnaTelegramSender/scheduled-message');
const {runOperation}=require('../dist/nodes/NnaTelegramSender/sender');
const c={expectedUserId:'5845920581'};
const scope={allowedGroupIds:['-1001234567'],allowPrivate:true};
const html='<b>Title</b>\n\nHello <i>it</i> <u>u</u> <s>s</s> <a href="https://nnanetwork.com/?a=1&amp;b=2">link</a>\n<blockquote>verse</blockquote>\n<tg-spoiler>hid</tg-spoiler>';
const p=(m={},extra={})=>({scope,message:{schedKey:'sm-ABC123XYZ',chatId:'5845920581',topicId:0,html,...m},claimValidated:true,claimRequestKey:'sm-ABC123XYZ',claimExecutionId:'77',...extra});

test('HTML keeps every format as Telegram entities',()=>{
 const {text,entities}=sm.parseHtml(html);
 assert.equal(text,'Title\n\nHello it u s link\nverse\nhid');
 const kinds=entities.map(e=>e.className);
 for(const k of ['MessageEntityBold','MessageEntityItalic','MessageEntityUnderline','MessageEntityStrike','MessageEntityTextUrl','MessageEntityBlockquote','MessageEntitySpoiler'])assert.ok(kinds.includes(k),k);
 assert.equal(entities.find(e=>e.className==='MessageEntityTextUrl').url,'https://nnanetwork.com/?a=1&b=2');
});
test('unknown tags, bad links and unbalanced HTML are refused, never sent as plain text',()=>{
 assert.throws(()=>sm.parseHtml('<p>x</p>'),/HTML_UNSUPPORTED_TAG/);
 assert.throws(()=>sm.parseHtml('<a href="javascript:x">y</a>'),/HTML_LINK_INVALID/);
 assert.throws(()=>sm.parseHtml('<b>x<i>y</b></i>'),/HTML_UNBALANCED/);
});
test('targets: self, private, allowed group topic; other groups and missing claims refused',()=>{
 assert.equal(sm.precheck(c,p()).m.kind,'self');
 assert.equal(sm.precheck(c,p({chatId:'@someone'})).m.kind,'private');
 assert.equal(sm.precheck(c,p({chatId:'-1001234567',topicId:54992})).m.topic,54992);
 assert.throws(()=>sm.precheck(c,p({chatId:'-1009999999'})),/GROUP_NOT_ALLOWED/);
 assert.throws(()=>sm.precheck(c,p({chatId:'123456',topicId:5})),/TOPIC_ONLY_IN_GROUPS/);
 assert.throws(()=>sm.precheck(c,p({},{claimRequestKey:'sm-OTHER0001'})),/CLAIM_REQUIRED/);
 assert.throws(()=>sm.precheck(c,p({},{claimValidated:false})),/CLAIM_REQUIRED/);
});
test('sends once to Saved Messages with a fixed random id and the parsed entities',async()=>{
 const sent=[];
 const client={invoke:async r=>{sent.push(r);return {className:'Updates',updates:[{className:'UpdateMessageID',id:91,randomId:r.randomId}]};},
  getMessages:async()=>[{id:91,message:sm.parseHtml(html).text,entities:[1,2,3]}]};
 const r=await sm.run('sendScheduledMessage',client,c,p(),x=>x);
 assert.equal(r.status,'sent');assert.equal(r.messageId,91);assert.equal(r.verified,true);
 assert.ok(sent[0].peer instanceof Api.InputPeerSelf);assert.equal(sent[0].replyTo,undefined);
 assert.equal(String(sent[0].randomId),String(sm.randomId('5845920581','sm-ABC123XYZ')));
 assert.ok(sent[0].entities.length>=7);
});
test('group topic send replies to the topic root; a Telegram refusal is reported, not retried',async()=>{
 const g=new Api.Channel({id:bigInt(1234567),title:'g',photo:new Api.ChatPhotoEmpty(),date:0,forum:true,megagroup:true});
 const client={getEntity:async()=>g,getInputEntity:async()=>new Api.InputPeerChannel({channelId:bigInt(1234567),accessHash:bigInt(1)}),
  invoke:async r=>{assert.equal(r.replyTo.topMsgId,54992);const e=new Error('x');e.errorMessage='CHAT_WRITE_FORBIDDEN';throw e;}};
 const r=await sm.run('sendScheduledMessage',client,c,p({chatId:'-1001234567',topicId:54992}),x=>x);
 assert.equal(r.status,'rejected');assert.equal(r.code,'CHAT_WRITE_FORBIDDEN');
});
test('runOperation refuses before connecting when the claim is missing',async()=>{
 const creds={apiId:'1',apiHash:'a'.repeat(32),sessionString:'1abc',expectedUserId:'5845920581',allowedGroupId:'-1001234567',allowedGroupUsername:'example_group',allowedTopicIds:'1'};
 let connected=false;
 await assert.rejects(runOperation('sendScheduledMessage',creds,p({},{claimValidated:false}),{createClient:async()=>{connected=true;}}),/NNA_SCHEDMSG_CLAIM_REQUIRED/);
 assert.equal(connected,false);
});
test('rich mode sends InputRichMessageHTML (tables, details) and refuses unsafe HTML',async()=>{
 const rich='<p><b>Title</b></p><aside><i>verse</i></aside><details><summary>more</summary><table bordered striped><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table></details>';
 const sent=[];
 const client={invoke:async r=>{sent.push(r);return {className:'Updates',updates:[{className:'UpdateMessageID',id:92,randomId:r.randomId}]};},
  getMessages:async()=>[{id:92,out:true,message:'',richMessage:{blocks:[1,2,3]}}]};
 const r=await sm.run('sendScheduledMessage',client,c,p({html:rich,rich:true}),x=>x);
 assert.equal(r.status,'sent');assert.equal(r.rich,true);assert.equal(r.verified,true);assert.equal(r.entityCount,3);
 assert.equal(sent[0].message,'');assert.equal(sent[0].richMessage.className,'InputRichMessageHTML');assert.equal(sent[0].richMessage.html,rich);
 assert.throws(()=>sm.precheck(c,p({html:'<p>x</p><script>1</script>',rich:true})),/RICH_HTML_UNSAFE/);
 assert.throws(()=>sm.precheck(c,p({html:'<a href="javascript:x">y</a>',rich:true})),/RICH_HTML_UNSAFE/);
 assert.throws(()=>sm.precheck(c,p({html:'<p>x</p>'})),/HTML_UNSUPPORTED_TAG/);
});
test('native Telegram schedule: scheduleDate set, scheduled id returned, limits enforced',async()=>{
 const now=Date.now(),at=Math.floor(now/1000)+3600;const sent=[];
 const client={invoke:async r=>{sent.push(r);
  if(r.className==='messages.GetScheduledHistory')return {messages:[{className:'Message',id:7}]};
  return {className:'Updates',updates:[{className:'UpdateMessageID',id:7,randomId:r.randomId},{className:'UpdateNewScheduledMessage',message:{id:7,richMessage:{blocks:[1,2]}}}]};}};
 const r=await sm.run('sendScheduledMessage',client,c,p({html:'<p>x</p><table><tr><td>1</td></tr></table>',rich:true,scheduleAt:at}),x=>x,now);
 assert.equal(r.status,'telegram_scheduled');assert.equal(r.scheduledId,7);assert.equal(r.verified,true);assert.equal(r.entityCount,2);
 assert.equal(sent[0].scheduleDate,at);assert.equal(sent[0].richMessage.className,'InputRichMessageHTML');
 assert.throws(()=>sm.precheck(c,p({scheduleAt:Math.floor(now/1000)+30}),undefined,'sendScheduledMessage',now),/SCHEDULE_AT_INVALID/);
 assert.throws(()=>sm.precheck(c,p({scheduleAt:Math.floor(now/1000)+366*86400}),undefined,'sendScheduledMessage',now),/SCHEDULE_AT_INVALID/);
});
test('cancel deletes from the Scheduled list and proves it; missing id = not_found; check reports presence',async()=>{
 let list=[7,9];const calls=[];
 const client={invoke:async r=>{calls.push(r.className);
  if(r.className==='messages.GetScheduledHistory')return {messages:list.map(id=>({className:'Message',id}))};
  if(r.className==='messages.DeleteScheduledMessages'){list=list.filter(x=>!r.id.includes(x));return {};}}};
 const q=m=>p({scheduledId:7,...m});
 assert.equal((await sm.run('checkScheduledMessage',client,c,q(),x=>x)).status,'still_scheduled');
 const r=await sm.run('cancelScheduledMessage',client,c,q(),x=>x);assert.equal(r.status,'cancelled');assert.ok(calls.includes('messages.DeleteScheduledMessages'));
 assert.equal((await sm.run('cancelScheduledMessage',client,c,q(),x=>x)).status,'not_found');
 assert.equal((await sm.run('checkScheduledMessage',client,c,q(),x=>x)).status,'not_in_scheduled_list');
 assert.throws(()=>sm.precheck(c,p({scheduledId:0}),undefined,'cancelScheduledMessage'),/SCHEDULED_ID_INVALID/);
});
test('0.52.0: private reply-to a message; groups refused',async()=>{
 const sent=[];
 const client={getEntity:async()=>({className:'User',id:555}),getInputEntity:async()=>new Api.InputPeerUser({userId:555,accessHash:1}),
  invoke:async r=>{sent.push(r);return {className:'Updates',updates:[{className:'UpdateMessageID',id:7,randomId:r.randomId}]};},getMessages:async()=>[{id:7,message:'Title\n\nHello it u s link\nverse\nhid',entities:[1]}]};
 const r=await sm.run('sendScheduledMessage',client,c,p({chatId:'555',replyToId:4321}),x=>x);
 assert.equal(r.status,'sent');assert.equal(r.replyToId,4321);assert.equal(sent[0].replyTo.replyToMsgId,4321);assert.equal(sent[0].replyTo.topMsgId,undefined);
 assert.throws(()=>sm.precheck(c,p({chatId:'555',replyToId:-1})),/REPLY_TO_INVALID/);
});
test('0.55.0: reply to a message inside an allowed group topic',async()=>{
 const sent=[];
 const g=new Api.Channel({id:bigInt(1234567),title:'g',photo:new Api.ChatPhotoEmpty(),date:0,forum:true,megagroup:true});
 const client={getEntity:async()=>g,getInputEntity:async()=>new Api.InputPeerChannel({channelId:1234567,accessHash:1}),
  invoke:async r=>{sent.push(r);return {className:'Updates',updates:[{className:'UpdateMessageID',id:8,randomId:r.randomId}]};},getMessages:async()=>[{id:8,out:true,message:'x',entities:[1]}]};
 {const r=await sm.run('sendScheduledMessage',client,c,p({chatId:'-1001234567',topicId:54992,replyToId:153300}),x=>x);
  assert.equal(r.status,'sent');assert.equal(sent[0].replyTo.replyToMsgId,153300);assert.equal(sent[0].replyTo.topMsgId,54992);}
});
// 0.57.0: photo of a Media Collection post + caption, scheduled natively (owner, 14 Nov 2026)
test('media: allowed source group only, never rich, caption parsed',()=>{
 const sc={allowedGroupIds:['-1001234567'],allowPrivate:true,mediaSourceGroupIds:['-1002550760684']};
 const m=sm.precheck(c,{...p({media:{chatId:'-1002550760684',messageId:4321},html:'<b>Short</b> teaser'}),scope:sc}).m;
 assert.deepEqual(m.media,{chat:'-1002550760684',messageId:4321});assert.equal(m.body.text,'Short teaser');
 assert.throws(()=>sm.precheck(c,{...p({media:{chatId:'-1009999999',messageId:1}}),scope:sc}),/MEDIA_GROUP_NOT_ALLOWED/);
 assert.throws(()=>sm.precheck(c,{...p({media:{chatId:'-1002550760684',messageId:0}}),scope:sc}),/MEDIA_MESSAGE_INVALID/);
 assert.throws(()=>sm.precheck(c,{...p({media:{chatId:'-1002550760684',messageId:5},rich:true}),scope:sc}),/MEDIA_INVALID/);
 assert.throws(()=>sm.precheck(c,p({media:{chatId:'-1002550760684',messageId:5}})),/MEDIA_GROUP_NOT_ALLOWED/);
});
test('media: SendMedia re-uses the post photo with the caption and the schedule date',async()=>{
 const sc={allowedGroupIds:['-1001234567'],allowPrivate:true,mediaSourceGroupIds:['-1002550760684']};
 const sent=[];const now=Date.now();const at=Math.floor(now/1000)+3600;
 const photo=new Api.MessageMediaPhoto({photo:new Api.Photo({id:bigInt(5),accessHash:bigInt(6),fileReference:Buffer.from([1]),date:1,sizes:[],dcId:1})});
 const group=new Api.Channel({id:bigInt(2550760684),title:'MC',photo:new Api.ChatPhotoEmpty(),date:1,forum:true,megagroup:true});
 const client={invoke:async r=>{sent.push(r);if(r.className==='messages.GetScheduledHistory')return {messages:[{className:'Message',id:55}]};
   return {className:'Updates',updates:[{className:'UpdateNewScheduledMessage',message:{id:55,entities:[]}}]};},
  getEntity:async()=>group,getInputEntity:async()=>new Api.InputPeerChannel({channelId:bigInt(2550760684),accessHash:bigInt(1)}),
  getMessages:async()=>[{className:'Message',id:4321,media:photo}]};
 const r=await sm.run('sendScheduledMessage',client,c,{...p({media:{chatId:'-1002550760684',messageId:4321},html:'<b>Short</b> teaser',scheduleAt:at}),scope:sc},x=>x,now);
 assert.equal(r.status,'telegram_scheduled');assert.equal(r.media,true);assert.equal(r.scheduledId,55);
 const req=sent.find(x=>x.className==='messages.SendMedia');assert.ok(req,'SendMedia used');
 assert.equal(req.message,'Short teaser');assert.equal(req.scheduleDate,at);assert.ok(req.media instanceof Api.InputMediaPhoto);
});
test('0.61.0: an album post re-sends the WHOLE album (order kept, caption on the first item)',async()=>{
 const sc={allowedGroupIds:['-1001234567'],allowPrivate:true,mediaSourceGroupIds:['-1002550760684']};
 const sent=[];const now=Date.now();const at=Math.floor(now/1000)+3600;
 const ph=n=>new Api.MessageMediaPhoto({photo:new Api.Photo({id:bigInt(n),accessHash:bigInt(6),fileReference:Buffer.from([1]),date:1,sizes:[],dcId:1})});
 const g=bigInt(777);
 const posts=[{className:'Message',id:4320,groupedId:g,media:ph(1)},{className:'Message',id:4321,groupedId:g,media:ph(2)},{className:'Message',id:4322,groupedId:g,media:ph(3)},{className:'Message',id:4323,media:ph(4)}];
 const group=new Api.Channel({id:bigInt(2550760684),title:'MC',photo:new Api.ChatPhotoEmpty(),date:1,forum:true,megagroup:true});
 const client={invoke:async r=>{sent.push(r);if(r.className==='messages.GetScheduledHistory')return {messages:[{className:'Message',id:60}]};
   return {className:'Updates',updates:[{className:'UpdateNewScheduledMessage',message:{id:60,entities:[]}},{className:'UpdateNewScheduledMessage',message:{id:61}},{className:'UpdateNewScheduledMessage',message:{id:62}}]};},
  getEntity:async()=>group,getInputEntity:async()=>new Api.InputPeerChannel({channelId:bigInt(2550760684),accessHash:bigInt(1)}),
  getMessages:async(_,{ids})=>posts.filter(x=>ids.includes(x.id)).reverse()};
 const r=await sm.run('sendScheduledMessage',client,c,{...p({media:{chatId:'-1002550760684',messageId:4321},html:'<b>Short</b> teaser',scheduleAt:at}),scope:sc},x=>x,now);
 assert.equal(r.status,'telegram_scheduled');assert.equal(r.albumCount,3);assert.equal(r.scheduledId,60);
 const req=sent.find(x=>x.className==='messages.SendMultiMedia');assert.ok(req,'SendMultiMedia used');
 assert.equal(req.multiMedia.length,3);assert.equal(req.scheduleDate,at);
 assert.equal(req.multiMedia[0].message,'Short teaser');assert.equal(req.multiMedia[1].message,'');
 assert.deepEqual(req.multiMedia.map(x=>x.media.id.id.toString()),['1','2','3']);
 assert.equal(new Set(req.multiMedia.map(x=>x.randomId.toString())).size,3);
 assert.ok(!sent.some(x=>x.className==='messages.SendMedia'),'never only one photo');
});
// 0.59.0: quote-reply inside a group topic (File Share flow, owner 15 Nov 2026)
test('0.59.0: quote-reply sends quoteText with the reply; quote needs replyToId',async()=>{
 const sent=[];
 const g=new Api.Channel({id:bigInt(1234567),title:'g',photo:new Api.ChatPhotoEmpty(),date:0,forum:true,megagroup:true});
 const client={getEntity:async()=>g,getInputEntity:async()=>new Api.InputPeerChannel({channelId:1234567,accessHash:1}),
  invoke:async r=>{sent.push(r);return {className:'Updates',updates:[{className:'UpdateMessageID',id:9,randomId:r.randomId}]};},getMessages:async()=>[{id:9,out:true,message:'x',entities:[1]}]};
 {const r=await sm.run('sendScheduledMessage',client,c,p({chatId:'-1001234567',topicId:54080,replyToId:151184,quoteText:'## Title\n\nFirst para'}),x=>x);
  assert.equal(r.status,'sent');assert.equal(r.quoted,true);assert.equal(sent[0].replyTo.replyToMsgId,151184);assert.equal(sent[0].replyTo.topMsgId,54080);assert.equal(sent[0].replyTo.quoteText,'## Title\n\nFirst para');
  const r2=await sm.run('sendScheduledMessage',client,c,p({chatId:'-1001234567',topicId:54080,replyToId:151184}),x=>x);
  assert.equal(r2.quoted,false);assert.equal(sent[1].replyTo.quoteText,undefined);
  const bad={...client,invoke:async()=>{const e=new Error('x');e.errorMessage='QUOTE_TEXT_INVALID';throw e;}};
  assert.equal((await sm.run('sendScheduledMessage',bad,c,p({chatId:'-1001234567',topicId:54080,replyToId:151184,quoteText:'nope'}),x=>x)).code,'QUOTE_TEXT_INVALID');}
 assert.throws(()=>sm.precheck(c,p({chatId:'-1001234567',topicId:54080,quoteText:'x'})),/QUOTE_INVALID/);
 assert.throws(()=>sm.precheck(c,p({chatId:'-1001234567',topicId:54080,replyToId:5,quoteText:'x'.repeat(1025)})),/QUOTE_INVALID/);
});
// ---- 0.62.0 - 0.66.0 (VPS dist edits 15-18 Nov 2026, carried into the repo) ----
const grp=()=>new Api.Channel({id:bigInt(1234567),title:'g',photo:new Api.ChatPhotoEmpty(),date:0,forum:true,megagroup:true});
const grpPeer=()=>new Api.InputPeerChannel({channelId:bigInt(1234567),accessHash:bigInt(1)});
const okSend=(sent,mid,extra={})=>({getEntity:async()=>grp(),getInputEntity:async()=>grpPeer(),
 invoke:async r=>{sent.push(r);return {className:'Updates',updates:[{className:'UpdateMessageID',id:mid,randomId:r.randomId}]};},...extra});
test('0.62.0: document = one .plugin/.py file, only to a group (topic) or Saved Messages; name/size/target guarded',()=>{
 const doc={name:'nna_voice.plugin',dataBase64:Buffer.from('print(1)').toString('base64')};
 const m=sm.precheck(c,p({chatId:'-1001234567',topicId:1137,html:'<b>v1.2</b>',document:doc})).m;
 assert.equal(m.document.name,'nna_voice.plugin');assert.equal(m.document.data.toString(),'print(1)');assert.equal(m.document.replaceOld,false);
 assert.equal(sm.precheck(c,p({document:doc})).m.kind,'self');
 assert.throws(()=>sm.precheck(c,p({chatId:'555',document:doc})),/DOCUMENT_TARGET_NOT_ALLOWED/);
 assert.throws(()=>sm.precheck(c,p({chatId:'-1001234567',document:{...doc,name:'x.exe'}})),/DOCUMENT_NAME_INVALID/);
 assert.throws(()=>sm.precheck(c,p({chatId:'-1001234567',document:{...doc,name:'../a.py'}})),/DOCUMENT_NAME_INVALID/);
 assert.throws(()=>sm.precheck(c,p({chatId:'-1001234567',document:{...doc,dataBase64:'%%%'}})),/DOCUMENT_DATA_INVALID/);
 assert.throws(()=>sm.precheck(c,p({chatId:'-1001234567',document:{...doc,dataBase64:Buffer.alloc(2*1024*1024+1).toString('base64')}})),/DOCUMENT_SIZE_INVALID/);
 assert.throws(()=>sm.precheck(c,p({chatId:'-1001234567',document:doc,rich:true})),/DOCUMENT_INVALID/);
});
test('0.62.0: document is uploaded (teleproto/client/uploads CustomFile) and sent as a file with the caption',async()=>{
 const {CustomFile}=require('teleproto/client/uploads');assert.equal(typeof CustomFile,'function');
 const sent=[],uploads=[];
 const client=okSend(sent,31,{uploadFile:async o=>{uploads.push(o);return new Api.InputFile({id:bigInt(9),parts:1,name:o.file.name,md5Checksum:''});},
  getMessages:async()=>[{id:31,out:true,message:'v1.2',entities:[1]}]});
 const r=await sm.run('sendScheduledMessage',client,c,p({chatId:'-1001234567',topicId:1137,html:'<b>v1.2</b>',document:{name:'nna_voice.plugin',dataBase64:Buffer.from('abc').toString('base64')}}),x=>x);
 assert.equal(r.status,'sent');assert.equal(r.document,true);assert.equal(r.verified,true);
 assert.ok(uploads[0].file instanceof CustomFile);assert.equal(uploads[0].file.name,'nna_voice.plugin');assert.equal(uploads[0].file.size,3);
 const req=sent.find(x=>x.className==='messages.SendMedia');assert.ok(req,'SendMedia used');
 assert.ok(req.media instanceof Api.InputMediaUploadedDocument);assert.equal(req.media.forceFile,true);
 assert.equal(req.media.attributes[0].fileName,'nna_voice.plugin');assert.equal(req.message,'v1.2');assert.equal(req.replyTo.topMsgId,1137);
 const bad=okSend([],31,{uploadFile:async()=>{throw new Error('net');}});
 await assert.rejects(sm.run('sendScheduledMessage',bad,c,p({chatId:'-1001234567',topicId:1137,html:'x',document:{name:'a.py',dataBase64:'YQ=='}}),x=>x),/NNA_SCHEDMSG_UPLOAD_FAILED/);
});
test('0.63.0: a person found through their message in an allowed group ("<user>@<group>/<msg>")',async()=>{
 assert.equal(sm.precheck(c,p({chatId:'777@-1001234567/42'})).m.kind,'private');
 assert.throws(()=>sm.precheck(c,p({chatId:'777@-1009999999/42'})),/GROUP_NOT_ALLOWED/);
 assert.throws(()=>sm.precheck(c,{...p({chatId:'777@-1001234567/42'}),scope:{allowedGroupIds:['-1001234567'],allowPrivate:false}}),/PRIVATE_NOT_ALLOWED/);
 const user=new Api.User({id:bigInt(777),accessHash:bigInt(5),firstName:'S'});
 const sent=[];
 const client={getEntity:async x=>{if(String(x)==='777')throw new Error('unknown');return grp();},
  getMessages:async(peer,{ids})=>ids[0]===42?[{id:42,senderId:bigInt(777),sender:user}]:[{id:5,message:'Title\n\nHello it u s link\nverse\nhid',entities:[1]}],
  getInputEntity:async u=>{assert.equal(u,user);return new Api.InputPeerUser({userId:bigInt(777),accessHash:bigInt(5)});},
  invoke:async r=>{sent.push(r);return {className:'Updates',updates:[{className:'UpdateMessageID',id:5,randomId:r.randomId}]};}};
 const r=await sm.run('sendScheduledMessage',client,c,p({chatId:'777@-1001234567/42'}),x=>x);
 assert.equal(r.status,'sent');assert.ok(sent[0].peer instanceof Api.InputPeerUser);
 const other={...client,getMessages:async()=>[{id:42,senderId:bigInt(888)}]};
 await assert.rejects(sm.run('sendScheduledMessage',other,c,p({chatId:'777@-1001234567/42'}),x=>x),/VIA_MESSAGE_NOT_FROM_USER/);
});
test('0.64.0: replaceOld deletes only OLDER own posts with the same file name in that topic',async()=>{
 const doc=n=>new Api.MessageMediaDocument({document:new Api.Document({id:bigInt(1),accessHash:bigInt(1),fileReference:Buffer.from([1]),date:1,mimeType:'x',size:bigInt(1),dcId:1,attributes:[new Api.DocumentAttributeFilename({fileName:n})]})});
 const sent=[],deleted=[];
 const client=okSend(sent,50,{uploadFile:async()=>new Api.InputFile({id:bigInt(9),parts:1,name:'a',md5Checksum:''}),
  getMessages:async()=>[{id:50,out:true,message:'v2',entities:[]}],
  deleteMessages:async(peer,ids,o)=>{deleted.push({ids,o});}});
 const inv=client.invoke;client.invoke=async r=>{if(r.className==='messages.Search'){sent.push(r);return {messages:[
  {className:'Message',id:40,out:true,media:doc('nna.plugin')},{className:'Message',id:41,out:false,media:doc('nna.plugin')},
  {className:'Message',id:42,out:true,media:doc('other.plugin')},{className:'Message',id:50,out:true,media:doc('nna.plugin')}]};}return inv(r);};
 const d={name:'nna.plugin',dataBase64:'YQ==',replaceOld:true};
 const r=await sm.run('sendScheduledMessage',client,c,p({chatId:'-1001234567',topicId:1137,html:'v2',document:d}),x=>x);
 assert.equal(r.status,'sent');assert.deepEqual(r.replacedOld,[40]);assert.equal(r.replaceError,'');
 assert.deepEqual(deleted,[{ids:[40],o:{revoke:true}}]);
 const s=sent.find(x=>x.className==='messages.Search');assert.equal(s.topMsgId,1137);assert.ok(s.fromId instanceof Api.InputPeerSelf);
 assert.equal(sm.precheck(c,p({chatId:'-1001234567',topicId:0,document:d})).m.document.replaceOld,false,'no topic -> no replace');
 assert.equal(sm.precheck(c,p({document:d})).m.document.replaceOld,false,'Saved Messages -> no replace');
});
test('0.65.0: quoteText may be Telegram HTML -> plain quoteText + quoteEntities (bold title quoted WITH its bold)',async()=>{
 const m=sm.precheck(c,p({chatId:'-1001234567',topicId:153539,replyToId:2454,quoteText:'<b>Big title</b>'})).m;
 assert.equal(m.quote,'Big title');assert.equal(m.quoteEntities.length,1);assert.equal(m.quoteEntities[0].className,'MessageEntityBold');
 const plain=sm.precheck(c,p({chatId:'-1001234567',topicId:153539,replyToId:2454,quoteText:'a < b and <3'})).m;
 assert.equal(plain.quote,'a < b and <3');assert.deepEqual(plain.quoteEntities,[]);
 const sent=[];
 const client=okSend(sent,60,{getMessages:async(peer,{ids})=>ids[0]===2454?[{id:2454,message:'Big title',entities:[]}]:[{id:60,out:true,message:'x',entities:[],replyTo:{quote:true}}]});
 const r=await sm.run('sendScheduledMessage',client,c,p({chatId:'-1001234567',topicId:153539,replyToId:2454,quoteText:'<b>Big title</b>',html:'x'}),x=>x);
 assert.equal(r.status,'sent');assert.equal(r.quoted,true);assert.equal(r.quoteShown,true);
 const rt=sent[0].replyTo;assert.equal(rt.quoteText,'Big title');assert.equal(rt.quoteEntities[0].className,'MessageEntityBold');
 assert.equal(rt.quoteRich,undefined);assert.equal(rt.replyToPeerId,undefined,'same topic: no replyToPeerId');
});
test('0.65.0: replyTopicId = reply to a message in ANOTHER topic of the same group (replyToPeerId)',async()=>{
 const sent=[];
 const client=okSend(sent,61,{getMessages:async()=>[{id:61,out:true,message:'x',entities:[]}]});
 const r=await sm.run('sendScheduledMessage',client,c,p({chatId:'-1001234567',topicId:153539,replyToId:2454,replyTopicId:54080,html:'x'}),x=>x);
 assert.equal(r.status,'sent');assert.equal(r.quoteShown,false);
 const rt=sent[0].replyTo;assert.equal(rt.replyToMsgId,2454);assert.equal(rt.topMsgId,153539);assert.ok(rt.replyToPeerId instanceof Api.InputPeerChannel);
 const same=[];await sm.run('sendScheduledMessage',okSend(same,62,{getMessages:async()=>[{id:62,out:true,message:'x',entities:[]}]}),c,p({chatId:'-1001234567',topicId:153539,replyToId:2454,replyTopicId:153539,html:'x'}),x=>x);
 assert.equal(same[0].replyTo.replyToPeerId,undefined,'same topic id: no replyToPeerId');
 assert.throws(()=>sm.precheck(c,p({chatId:'-1001234567',topicId:153539,replyTopicId:54080})),/REPLY_TOPIC_INVALID/);
 assert.throws(()=>sm.precheck(c,p({chatId:'555',replyToId:4,replyTopicId:54080})),/REPLY_TOPIC_INVALID/);
 assert.throws(()=>sm.precheck(c,p({chatId:'-1001234567',topicId:1,replyToId:4,replyTopicId:-3})),/REPLY_TOPIC_INVALID/);
});
test('0.66.0: richQuote turns text + entities into TextPlain wrapped in Bold/Italic/Underline/Strike',()=>{
 const {text,entities}=sm.parseHtml('<b>Big <u>title</u></b> and <i>more</i> <s>x</s> <code>c</code>');
 const out=sm.richQuote(text,entities);
 const show=n=>{let s='';let x=n;while(x&&x.className!=='TextPlain'){s+=x.className+'>';x=x.text;}return s+JSON.stringify(x.text);};
 assert.equal(out.map(show).join(' | '),'TextBold>"Big " | TextBold>TextUnderline>"title" | " and " | TextItalic>"more" | " " | TextStrike>"x" | " " | "c"');
 assert.equal(out.map(n=>{let x=n;while(x.className!=='TextPlain')x=x.text;return x.text;}).join(''),text);
 assert.deepEqual(sm.richQuote('plain',[]).map(n=>n.className),['TextPlain']);
});
test('0.66.0: quoting a RICH post sends quoteRich WITHOUT quoteText/quoteEntities; lookup failure keeps quoteText',async()=>{
 const sent=[];
 const client=okSend(sent,70,{getMessages:async(peer,{ids})=>ids[0]===2454?[{id:2454,message:'',richMessage:{blocks:[1]}}]:[{id:70,out:true,richMessage:{blocks:[1,2]},replyTo:{quote:true}}]});
 const r=await sm.run('sendScheduledMessage',client,c,p({chatId:'-1001234567',topicId:153539,replyToId:2454,replyTopicId:54080,quoteText:'<b>Big title</b>',html:'<p>detail</p>',rich:true}),x=>x);
 assert.equal(r.status,'sent');assert.equal(r.verified,true);assert.equal(r.quoteShown,true);assert.equal(r.entityCount,2);
 const rt=sent[0].replyTo;assert.ok(rt instanceof Api.InputReplyToMessage);
 assert.equal(rt.quoteText,undefined);assert.equal(rt.quoteEntities,undefined);assert.ok(rt.replyToPeerId instanceof Api.InputPeerChannel);
 assert.equal(rt.quoteRich.length,1);assert.equal(rt.quoteRich[0].className,'TextBold');assert.equal(rt.quoteRich[0].text.text,'Big title');
 assert.equal(sent[0].richMessage.className,'InputRichMessageHTML');
 const s2=[];const flaky=okSend(s2,71,{getMessages:async(peer,{ids})=>{if(ids[0]===2454)throw new Error('x');return [{id:71,out:true,message:'x',entities:[]}];}});
 const r2=await sm.run('sendScheduledMessage',flaky,c,p({chatId:'-1001234567',topicId:153539,replyToId:2454,quoteText:'<b>Big title</b>',html:'x'}),x=>x);
 assert.equal(r2.status,'sent');assert.equal(s2[0].replyTo.quoteText,'Big title');assert.equal(s2[0].replyTo.quoteRich,undefined);
});
test('0.66.0: the bundled teleproto layer knows quoteRich and the rich text classes',()=>{
 const r=new Api.InputReplyToMessage({replyToMsgId:1,quoteRich:[new Api.TextPlain({text:'a'})]});
 assert.equal(r.quoteRich.length,1);
 for(const k of ['TextPlain','TextBold','TextItalic','TextUnderline','TextStrike','InputRichMessageHTML'])assert.equal(typeof Api[k],'function',k);
 assert.equal(require('teleproto/package.json').version,require('../package.json').dependencies.teleproto);
});
