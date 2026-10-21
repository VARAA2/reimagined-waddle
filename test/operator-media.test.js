'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Api}=require('teleproto'),bigInt=require('big-integer');
const om=require('../dist/nodes/NnaMediaCollection/operator-media');
const {Service}=require('../dist/nodes/NnaMediaCollection/core');
const {Store}=require('../dist/nodes/NnaMediaCollection/store');
const creds={apiId:1,apiHash:'a'.repeat(32),sessionString:'1fake',expectedUserId:'42',allowedGroupId:'-1001234500000',allowedGroupUsername:'examplegroup',allowedTopicIds:'10'};
const scope={botId:'99',botUsername:'example_bot',senderUsername:'sender',operatorIds:['42','43'],reviewGroupId:'-1009876500000',reviewTopicId:3,targets:[{key:'main',label:'Main',groupId:creds.allowedGroupId,topicId:10}]};
const now=Date.now();
function root(t){const r=fs.mkdtempSync(path.join(os.tmpdir(),'nna-opmedia-test-'));t.after(()=>{assert(path.basename(r).startsWith('nna-opmedia-test-'));fs.rmSync(r,{recursive:true,force:true});});return r;}
const photo=id=>({photo:[{file_id:'small'+id,file_unique_id:'s'+id},{file_id:'photo'+id,file_unique_id:'p'+id,file_size:100}]});
const video=id=>({video:{file_id:'video'+id,file_unique_id:'v'+id,duration:2,mime_type:'video/mp4'}});
const audio=id=>({audio:{file_id:'audio'+id,file_unique_id:'a'+id,duration:60,mime_type:'audio/mpeg'}});
const voice=id=>({voice:{file_id:'voice'+id,file_unique_id:'o'+id,duration:9,mime_type:'audio/ogg'}});
const ctx=(id,body,operator='42')=>({operatorId:operator,chatId:operator,topicId:0,event:{update_id:id,message:{message_id:id,date:Math.floor(now/1000),chat:{id:Number(operator),type:'private'},from:{id:Number(operator),is_bot:false},...body}}});
function clock(){let t=now;const later=[];return {now:()=>t,wait:async ms=>{t+=ms;while(later.length)await later.shift()();},later};}

test('non-album updates pass through unchanged',async t=>{const c=ctx(1,photo(1));assert.deepEqual(await om.collect(scope,c,{root:root(t)}),c);});
test('album updates arriving out of order produce exactly one leader with every item in message order',async t=>{
 const r=root(t),k=clock(),results=[];
 k.later.push(async()=>{results.push(await om.collect(scope,ctx(12,{...video(12),media_group_id:'g1'}),{root:r,now:k.now}));results.push(await om.collect(scope,ctx(11,{...photo(11),media_group_id:'g1'}),{root:r,now:k.now}));results.push(await om.collect(scope,ctx(12,{...video(12),media_group_id:'g1'}),{root:r,now:k.now}));});
 const leader=await om.collect(scope,ctx(13,{...photo(13),media_group_id:'g1',caption:'Title',caption_entities:[{type:'bold',offset:0,length:5}]}),{root:r,...k});
 assert.deepEqual(results.map(x=>x.operatorAlbum.role),['follower','follower','duplicate']);
 assert.equal(leader.operatorAlbum.role,'leader');assert.equal(leader.operatorAlbum.error,null);
 assert.deepEqual(leader.operatorAlbum.items.map(x=>[x.messageId,x.kind,x.fileId]),[[11,'photo','photo11'],[12,'video','video12'],[13,'photo','photo13']]);
 assert.deepEqual(leader.operatorAlbum.items[2].entities,[{type:'bold',offset:0,length:5}]);
 assert.equal((await om.collect(scope,ctx(14,{...photo(14),media_group_id:'g1'}),{root:r,now:k.now})).operatorAlbum.role,'late');
});
test('operators and chats never share an album key',async t=>{
 const r=root(t),k=clock();const a=await om.collect(scope,ctx(1,{...photo(1),media_group_id:'same'},'42'),{root:r,...k}),b=await om.collect(scope,ctx(1,{...photo(1),media_group_id:'same'},'43'),{root:r,...k});
 assert.equal(a.operatorAlbum.role,'leader');assert.equal(b.operatorAlbum.role,'leader');assert.equal(b.operatorAlbum.items.length,1);
});
test('audio albums are accepted while mixed audio, documents and oversized albums are reported',async t=>{
 const r=root(t);
 const run=async(id,items)=>{const k=clock();k.later.push(async()=>{for(const [i,body] of items.slice(1).entries())await om.collect(scope,ctx(id+i+1,{...body,media_group_id:'m'+id}),{root:r,now:k.now});});return (await om.collect(scope,ctx(id,{...items[0],media_group_id:'m'+id}),{root:r,...k})).operatorAlbum;};
 const audioAlbum=await run(100,[audio(1),audio(2),audio(3)]);assert.equal(audioAlbum.error,null);assert.equal(om.composition(audioAlbum.items),'audio_album');
 assert.equal((await run(200,[photo(1),audio(2)])).error,'MIXED_ALBUM');
 assert.equal((await run(300,[photo(1),{document:{file_id:'d',file_unique_id:'d',mime_type:'application/pdf'}}])).error,'UNSUPPORTED');
 assert.equal((await run(400,Array.from({length:11},(_,i)=>photo(i)))).error,'COUNT');
 assert.throws(()=>om.composition([om.item({message_id:1,...voice(1)}),om.item({message_id:2,...voice(2)})]),/VOICE_ALBUM/);
 assert.equal(om.composition([om.item({message_id:1,...voice(1)})]),'voice');
});
function bot(){const calls=[];let mid=500;const fn=async(method,body)=>{calls.push({method,body});const base={message_id:++mid,chat:{id:Number(body.chat_id)},from:{id:99,is_bot:true}};
 if(method==='sendMediaGroup')return body.media.map((m,i)=>({...base,message_id:mid+i,media_group_id:'x',...(m.type==='photo'?{photo:[{file_unique_id:'p'+m.media.slice(5)}]}:{[m.type]:{file_unique_id:{video:'v',audio:'a'}[m.type]+m.media.replace(/^\D+/,'')}})}));
 const kind=['photo','video','audio','voice'].find(k=>body[k]);if(kind){const id=body[kind].replace(/^\D+/,'');return {...base,caption:body.caption,...(kind==='photo'?{photo:[{file_unique_id:'p'+id}]}:{[kind]:{file_unique_id:{video:'v',audio:'a',voice:'o'}[kind]+id}})};}
 if(method==='sendMessage')return {...base,text:body.text,reply_markup:body.reply_markup};return true;};fn.calls=calls;return fn;}
const buttons=[{label:'✅ Draft உறுதி செய்',data:'mp:42:7:confirm'},{label:'❌ ரத்து செய்',data:'mp:42:7:cancel'}];
test('album preview sends one native media group and a caption message with approval buttons',async()=>{
 const b=bot(),items=[om.item({message_id:1,...photo(1)}),om.item({message_id:2,...video(2)})];
 const r=await om.preview(b,scope,{operatorId:'42',chatId:'42',topicId:0,text:'Caption',entities:[{type:'bold',offset:0,length:7}],buttons,items});
 assert.deepEqual(b.calls.map(x=>x.method),['sendMediaGroup','sendMessage']);assert.equal(b.calls[0].body.media.length,2);assert.match(b.calls[0].body.media[0].caption,/2 media/);
 assert.equal(b.calls[1].body.reply_to_message_id,r.previewMessageId);assert.deepEqual(b.calls[1].body.reply_markup.inline_keyboard.flat().map(x=>x.callback_data),buttons.map(x=>x.data));assert.equal(r.longCaption,false);
});
test('single audio and voice previews use their native Bot API methods',async()=>{
 for(const [body,method] of [[audio(3),'sendAudio'],[voice(4),'sendVoice']]){const b=bot();await om.preview(b,scope,{operatorId:'42',chatId:'42',topicId:0,text:'Caption',entities:[],buttons,items:[om.item({message_id:1,...body})]});assert.equal(b.calls[0].method,method);}
});
test('preview rejects a Bot API response for different media',async()=>{const b=bot(),base=b;const wrong=async(m,body)=>{const r=await base(m,body);if(r.audio)r.audio.file_unique_id='other';return r;};await assert.rejects(om.preview(wrong,scope,{operatorId:'42',chatId:'42',topicId:0,text:'x',entities:[],buttons,items:[om.item({message_id:1,...audio(1)})]}),/PREVIEW_MISMATCH/);});
function delivery(items,extra={}){return {mode:'set',claimValidated:true,operatorId:'42',chatId:'42',topicId:0,revision:'7',requestKey:'media:42:42:0:7',approvedAt:new Date(now).toISOString(),update:{update_id:8,callback_query:{from:{id:42,is_bot:false},data:'mp:42:7:publish',message:{chat:{id:42,type:'private'},from:{id:99,is_bot:true}}}},targetGroupId:creds.allowedGroupId,targetTopicId:10,scheduleAt:0,items,captionIndex:0,captionText:'Main caption',captionEntities:[{type:'bold',offset:0,length:4}],...extra};}
function personal({uncertain=false,badGroup=false}={}){
 const staged=[];let request,writes=0;
 const docFor=x=>x.kind==='photo'?new Api.MessageMediaPhoto({photo:new Api.Photo({id:bigInt(1000+staged.length),accessHash:bigInt(1),fileReference:Buffer.from('a'),date:0,sizes:[],dcId:1})}):new Api.MessageMediaDocument({document:new Api.Document({id:bigInt(1000+staged.length),accessHash:bigInt(1),fileReference:Buffer.from('a'),date:0,mimeType:x.kind==='video'?'video/mp4':x.kind==='voice'?'audio/ogg':'audio/mpeg',size:bigInt(10),dcId:1,attributes:[]})});
 const b=bot(),stagingBot=async(method,body)=>{const r=await b(method,body);if(/^send(Photo|Video|Audio|Voice)$/.test(method)){const kind=method.slice(4).toLowerCase();staged.push({marker:body.caption,media:docFor({kind})});}return r;};stagingBot.calls=b.calls;
 const sent=new Map();
 const client={connect:async()=>{},destroy:async()=>{},getMe:async()=>({id:bigInt(42),bot:false,premium:true}),
  getEntity:async n=>new Api.Channel({id:bigInt(String(n).slice(4)),megagroup:true,forum:true,title:'Test',photo:new Api.ChatPhotoEmpty(),date:0}),
  getInputEntity:async g=>g==='example_bot'?new Api.InputPeerUser({userId:bigInt(99),accessHash:bigInt(1)}):new Api.InputPeerChannel({channelId:g.id,accessHash:bigInt(1)}),
  getMessages:async(peer,opts)=>opts.limit?staged.map((s,i)=>({className:'Message',id:i+1,out:false,message:s.marker,senderId:bigInt(99),media:s.media})):opts.ids.map(id=>sent.get(id)),
  invoke:async x=>{
   if(x.className==='messages.GetForumTopicsByID')return {topics:[{className:'ForumTopic',id:10,closed:false}]};
   if(x.className==='help.GetAppConfig')return {config:{value:[{key:'caption_length_limit_premium',value:{value:4096}}]}};
   assert(['messages.SendMedia','messages.SendMultiMedia'].includes(x.className));request=x;writes++;x.getBytes();if(uncertain)throw Error('network');
   const parts=x.className==='messages.SendMedia'?[{media:x.media,randomId:x.randomId,message:x.message,entities:x.entities}]:x.multiMedia;const updates=[];
   parts.forEach((p,i)=>{const id=700+i,source=staged.find(s=>String((s.media.photo||s.media.document).id)===String(p.media.id.id));const m={className:'Message',id,out:true,fromId:new Api.PeerUser({userId:bigInt(42)}),peerId:new Api.PeerChannel({channelId:bigInt(1234500000)}),replyTo:{replyToTopId:10},message:p.message,entities:p.entities,media:source.media,date:x.scheduleDate||Math.floor(now/1000),groupedId:parts.length>1?bigInt(badGroup?900+i:900):undefined};sent.set(id,m);updates.push({className:'UpdateMessageID',id,randomId:p.randomId});if(x.scheduleDate)updates.push({className:'UpdateNewScheduledMessage',message:m});});
   return {updates};
  }};
 return {client,bot:stagingBot,get request(){return request;},get writes(){return writes;},staged};
}
const deps=m=>({createClient:()=>m.client,bot:m.bot});
test('claimed album publishes once as the personal account with main and original item captions',async()=>{
 const items=[om.item({message_id:1,...photo(1)}),om.item({message_id:2,...video(2),caption:'Second own',caption_entities:[{type:'italic',offset:0,length:6},{type:'text_mention',offset:0,length:3}]}),om.item({message_id:3,...photo(3)})];
 const m=personal(),r=await om.publish({},creds,{},scope,delivery(items),deps(m));
 assert.equal(r.status,'sent');assert.equal(r.count,3);assert.deepEqual(r.messageIds,[700,701,702]);assert.equal(r.sentMessageId,700);assert.equal(m.writes,1);
 assert.equal(m.request.className,'messages.SendMultiMedia');assert.equal(m.request.sendAs.className,'InputPeerSelf');assert.equal(m.request.replyTo.topMsgId,10);
 assert.deepEqual(m.request.multiMedia.map(x=>x.message),['Main caption','Second own','']);assert.equal(m.request.multiMedia[0].entities[0].className,'MessageEntityBold');assert.deepEqual(m.request.multiMedia[1].entities.map(e=>e.className),['MessageEntityItalic']);
 assert.equal(m.bot.calls.filter(x=>x.method==='deleteMessage').length,3);
});
test('single audio and voice publish natively and scheduled albums use the Telegram queue',async()=>{
 for(const body of [audio(1),voice(2)]){const m=personal(),r=await om.publish({},creds,{},scope,delivery([om.item({message_id:1,...body})]),deps(m));assert.equal(r.status,'sent');assert.equal(m.request.className,'messages.SendMedia');assert.equal(m.request.message,'Main caption');}
 const at=Math.floor(now/1000)+600,m=personal(),r=await om.publish({},creds,{},scope,delivery([om.item({message_id:1,...audio(1)}),om.item({message_id:2,...audio(2)})],{scheduleAt:at}),deps(m));
 assert.equal(r.status,'scheduled');assert.equal(r.scheduledMessageId,700);assert.equal(m.request.scheduleDate,at);
});
test('tampered claims are rejected before any staging or sending',async()=>{
 const items=[om.item({message_id:1,...photo(1)}),om.item({message_id:2,...photo(2)})];
 for(const change of [d=>d.claimValidated=false,d=>d.update.callback_query.data='mp:42:8:publish',d=>d.update.callback_query.from.id=43,d=>d.targetTopicId=11,d=>d.approvedAt=new Date(now-700000).toISOString(),d=>d.mode='bundle',d=>d.captionIndex=5,d=>d.items=[...d.items,om.item({message_id:3,...audio(3)})]]){
  const d=delivery(items);change(d);const m=personal();await assert.rejects(om.publish({},creds,{},scope,d,deps(m)),/NNA_SET_/);assert.equal(m.writes,0);assert.equal(m.staged.length,0);
 }
});
test('uncertain writes and split album readback are unconfirmed and never retried',async()=>{
 const items=[om.item({message_id:1,...photo(1)}),om.item({message_id:2,...photo(2)})];
 const u=personal({uncertain:true});await assert.rejects(om.publish({},creds,{},scope,delivery(items),deps(u)),/DELIVERY_UNCONFIRMED/);assert.equal(u.writes,1);assert.equal(u.bot.calls.filter(x=>x.method==='deleteMessage').length,0);
 const g=personal({badGroup:true});await assert.rejects(om.publish({},creds,{},scope,delivery(items),deps(g)),/DELIVERY_UNCONFIRMED/);assert.equal(g.writes,1);
});
test('node execution requires the claim execution id to match',async()=>{
 const node={getNodeParameter:n=>({scopeJSON:JSON.stringify(scope),claimExecutionId:'1',deliveryJSON:'{}'}[n]),getExecutionId:()=>'2',getCredentials:async()=>({accessToken:'1:a'})};
 await assert.rejects(om.run(node,'publishOperatorMedia'),/CLAIM_EXECUTION_MISMATCH/);
});
test('plain audio continues to posting when plainAudioSummary is false, but the armed Audio Summary still works',async t=>{
 const r=root(t);const s=new Service({},creds,{},{groupId:'-1001234500000',botUsername:'example_bot',operatorIds:['42'],topicIds:[10],plainAudioSummary:false},{root:r});s.me={id:99,is_bot:true,username:'example_bot'};s.store=new Store(99,r);s.bot=async()=>({message_id:1});
 const u={update_id:5,message:{message_id:5,date:Math.floor(Date.now()/1000),chat:{id:42,type:'private'},from:{id:42,is_bot:false},...audio(1)}};
 const passed=await s.handleAudio(u);assert.equal(passed.json.audioHandled,false);
 s.store.change('audio_mode_42',()=>({armed:true,updateId:1,expiresAt:Date.now()+60000}));
 const handled=await s.handleAudio({...u,update_id:6,message:{...u.message,message_id:6}}).catch(e=>({error:e.message}));
 assert.notEqual(handled.json?.audioHandled,false);
});
const bundleScope={...scope,bundlePairs:[{groupId:creds.allowedGroupId,mediaTopicId:10,articleTopicId:20}]};
function part(text){const label='[LINK]';return {text:text+'\n'+label,entities:[{type:'bold',offset:0,length:4}],linkOffset:text.length+1,linkLength:label.length};}
function bundleDelivery(items,extra={}){return {...delivery(items),mode:'bundle',articleTopicId:20,mediaPart:part('File caption'),articlePart:part('Full article'),...extra};}
function bundleClient(opts){
 const m=personal(opts),inv=m.client.invoke,get=m.client.getMessages,article=new Map(),order=[];
 m.client.invoke=async x=>{
  if(x.className==='messages.GetForumTopicsByID')return {topics:[{className:'ForumTopic',id:x.topics[0],closed:false}]};
  if(x.className==='messages.SendMessage'){order.push('article');article.set(650,{className:'Message',id:650,out:true,fromId:new Api.PeerUser({userId:bigInt(42)}),peerId:new Api.PeerChannel({channelId:bigInt(1234500000)}),replyTo:{replyToTopId:x.replyTo.topMsgId},message:x.message,entities:x.entities});return {updates:[{className:'UpdateMessageID',id:650,randomId:x.randomId}]};}
  if(x.className==='messages.EditMessage'){order.push('backlink');Object.assign(article.get(x.id),{message:x.message,entities:x.entities});return {};}
  order.push('media');return inv(x);
 };
 m.client.getMessages=async(peer,o)=>o.ids&&article.has(o.ids[0])?o.ids.map(id=>article.get(id)):get(peer,o);
 m.article=article;m.order=order;return m;
}
test('Media + Article album posts article, one album with the article link, then the backlink',async()=>{
 const items=[om.item({message_id:1,...photo(1)}),om.item({message_id:2,...video(2),caption:'Own'}),om.item({message_id:3,...photo(3)})];
 const m=bundleClient(),r=await om.publish({},creds,{},bundleScope,bundleDelivery(items),deps(m));
 assert.equal(r.status,'sent');assert.equal(r.phase,'complete');assert.equal(r.mode,'bundle');assert.deepEqual(m.order,['article','media','backlink']);
 assert.equal(r.sentMessageId,700);assert.deepEqual(r.messageIds,[700,701,702]);assert.equal(r.articleMessageId,650);
 assert.equal(m.request.className,'messages.SendMultiMedia');assert.equal(m.request.multiMedia.length,3);
 assert.equal(m.request.multiMedia[0].message,'File caption\nhttps://t.me/c/1234500000/20/650');assert.equal(m.request.multiMedia[1].message,'Own');assert.equal(m.request.multiMedia[2].message,'');
 assert.equal(m.article.get(650).message,'Full article\nhttps://t.me/c/1234500000/10/700');assert.equal(r.mediaUrl,'https://t.me/c/1234500000/10/700');
 assert.equal(m.bot.calls.filter(x=>x.method==='deleteMessage').length,3);
});
test('Media + Article album rejects unapproved pairs, audio and stale approvals before any write',async()=>{
 const items=[om.item({message_id:1,...photo(1)}),om.item({message_id:2,...photo(2)})];
 for(const [d,s] of [[bundleDelivery(items,{articleTopicId:21}),bundleScope],[bundleDelivery([om.item({message_id:1,...audio(1)}),om.item({message_id:2,...audio(2)})]),bundleScope],[bundleDelivery(items,{approvedAt:new Date(now-700000).toISOString()}),bundleScope],[bundleDelivery(items),scope]]){
  const m=bundleClient();await assert.rejects(om.publish({},creds,{},s,d,deps(m)),/NNA_SET_/);assert.deepEqual(m.order,[]);assert.equal(m.staged.length,0);
 }
});
test('album write failure after the article is reported partial and never retried',async()=>{
 const items=[om.item({message_id:1,...photo(1)}),om.item({message_id:2,...photo(2)})];
 const m=bundleClient({uncertain:true}),r=await om.publish({},creds,{},bundleScope,bundleDelivery(items),deps(m));
 assert.equal(r.status,'partial');assert.equal(r.phase,'media');assert.deepEqual(m.order,['article','media']);assert.equal(m.bot.calls.filter(x=>x.method==='deleteMessage').length,0);
});
test('bundle album preview carries no approval buttons; the article preview does',async()=>{
 const b=bot();await om.preview(b,scope,{operatorId:'42',chatId:'42',topicId:0,mode:'bundle',text:'File caption',entities:[],buttons,items:[om.item({message_id:1,...photo(1)}),om.item({message_id:2,...photo(2)})]});
 assert.equal(b.calls[1].body.reply_markup,undefined);
});
