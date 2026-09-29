'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Api}=require('teleproto'),bigInt=require('big-integer');
const {Service,authenticate,parseMedia,keyboard}=require('../dist/nodes/NnaMediaCollection/core');
const {Store,jobKey}=require('../dist/nodes/NnaMediaCollection/store');
const creds={apiId:1,apiHash:'a'.repeat(32),sessionString:'1fake',expectedUserId:'42',allowedGroupId:'-1001234500000',allowedGroupUsername:'examplegroup',allowedTopicIds:'10'};
const scope={groupId:'-1001234500000',botUsername:'example_bot',operatorIds:['42','43'],topicIds:[10],allTopics:true};
const incoming=(id,extra={})=>({update_id:id,message:{message_id:id,date:Math.floor(Date.now()/1000),chat:{id:42,type:'private'},from:{id:42,is_bot:false},...extra}});
const asset={photo:[{file_id:'file',file_unique_id:'unique',file_size:100}]};
const summary=['The image depicts Jesus.','Love and compassion are its main themes.','The spiritual artwork emphasizes peace.'];
const analysisResult=()=>({summaryLines:summary,candidates:['Jesus','Christianity','Faith','Prayer','Peace','Love','Compassion','Devotion','Spirituality','Hope'].map(tag=>({tag,confidence:.9,evidence:'Synthetic supported example'}))});
const cb=(d,action,owner=42)=>({update_id:1000,callback_query:{id:'callback',from:{id:owner,is_bot:false},data:`mc:${d.key}:${d.rev}:${action}`,message:{message_id:d.controlId,chat:{id:owner,type:'private'},from:{id:99,is_bot:true}}}});
function setup(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'nna-media-test-'));
 t.after(()=>{assert.equal(path.dirname(root),os.tmpdir());assert(path.basename(root).startsWith('nna-media-test-'));fs.rmSync(root,{recursive:true,force:true});});
 const s=new Service({helpers:{prepareBinaryData:async b=>({data:b.toString('base64')})}},creds,{},scope,{root});
 s.me={id:99,username:'example_bot',is_bot:true};s.store=new Store(99,root);s.calls=[];let id=200;
 s.bot=async(method,body)=>{s.calls.push({method,body});return {message_id:++id};};
 s.personal=async fn=>fn({}, {premium:false});s.topics=async()=>[{id:10,title:'Cinema',emoji:'🎬'}];
 return s;
}
test('ordinary media only offers topics, preserves caption, never invokes analysis',async t=>{
 const s=setup(t);s.analyze=()=>{throw Error('MUST_NOT_ANALYZE');};
 const r=await s.handle(incoming(1,{...asset,caption:'🙏 Text',caption_entities:[{type:'bold',offset:3,length:4}]}));
 const d=s.store.read(r.json.jobKey);assert.equal(d.analysisApproved,false);assert.equal(d.analysisConsent,null);assert.equal(d.caption,'🙏 Text');
 const msg=s.calls.find(x=>x.method==='sendMessage').body;assert.equal(msg.text,'📍 எந்த topic-ல் பதிவிட வேண்டும்?');assert(!JSON.stringify(msg.reply_markup).includes('analy'));
 assert.equal((await s.handle(incoming(1,asset))).json.status,'duplicate');
});
test('all topics retain order and one emoji in rows of four buttons',()=>{
 const ts=Array.from({length:33},(_,i)=>({id:i+1,title:'Topic '+i,emoji:'🎬'}));
 const rows=keyboard({key:'a'.repeat(20),rev:1},ts).inline_keyboard;
 assert.equal(rows.length,10);assert.deepEqual(rows.slice(0,-1).map(row=>row.length),[4,4,4,4,4,4,4,4,1]);
 const buttons=rows.slice(0,-1).flat();ts.forEach((x,i)=>{assert.equal(buttons[i].text,'🎬 '+x.title);assert(Buffer.byteLength(buttons[i].callback_data)<=64);assert(buttons[i].callback_data.endsWith(':t'+x.id));});
 assert(rows[1][0].callback_data.endsWith(':t5'));assert(rows.at(-1)[0].callback_data.endsWith(':cancel'));
});
test('layout refresh only edits an existing pending operator draft',async t=>{
 const s=setup(t),r=await s.handle(incoming(1,asset));const result=await s.refreshTopicButtons(r.json.jobKey);assert.equal(result.columns,4);assert.equal(s.calls.at(-1).method,'editMessageText');
 s.store.change(r.json.jobKey,d=>({...d,status:'sent'}));await assert.rejects(s.refreshTopicButtons(r.json.jobKey),/PENDING_DRAFT_REQUIRED/);
});
test('/analyze arms exactly one media and /cancel clears the mode',async t=>{
 const s=setup(t);let analyses=0;s.analyze=async d=>{analyses++;assert.equal(d.analysisConsent.revision,d.rev);return {json:{next:1}};};
 await s.handle(incoming(1,{text:'/analyze'}));assert.equal((await s.handle(incoming(2,asset))).json.next,1);
 assert.equal((await s.handle(incoming(3,asset))).json.status,'topic_choice');assert.equal(analyses,1);
 await s.handle(incoming(4,{text:'/analyze'}));await s.handle(incoming(5,{text:'/cancel'}));await s.handle(incoming(6,asset));assert.equal(analyses,1);
});
test('reply /analyze targets the pending original and discards canceled results',async t=>{
 const s=setup(t);const r=await s.handle(incoming(1,asset));s.analyze=async()=>({json:{next:1}});
 await s.handle(incoming(2,{text:'/analyze',reply_to_message:{message_id:1}}));let d=s.store.read(r.json.jobKey);const revision=d.rev;
 await s.handle(cb(d,'off'));assert.equal((await s.finish(d.key,revision,{candidates:[]})).status,'stale_analysis');
 d=s.store.read(d.key);assert.equal(d.analysisApproved,false);assert.deepEqual(d.tags,[]);
});
test('forged actor, bot, stale revisions, group input and future input are rejected',async t=>{
 const s=setup(t),r=await s.handle(incoming(1,asset)),d=s.store.read(r.json.jobKey);
 await assert.rejects(s.handle(cb(d,'t10',43)),/STALE_BUTTON/);
 const forged=cb(d,'t10');forged.callback_query.message.from.id=98;await assert.rejects(s.handle(forged),/CALLBACK_BOT/);
 const group=incoming(2,asset);group.message.chat.type='supergroup';assert.throws(()=>authenticate(group,scope,99),/PRIVATE_OPERATOR_ONLY/);
 const future=incoming(2,asset);future.message.date+=60;assert.throws(()=>authenticate(future,scope,99),/STALE_INPUT/);
});
test('only one topic click can claim a draft',async t=>{
 const s=setup(t),r=await s.handle(incoming(1,asset)),d=s.store.read(r.json.jobKey);let writes=0;
 s.publish=async()=>{writes++;return {status:'sent'};};await s.handle(cb(d,'t10'));await assert.rejects(s.handle(cb(d,'t10')),/ALREADY_HANDLED/);assert.equal(writes,1);
});
test('analysis slots are bounded and recovered when initial bot status fails',async t=>{
 const s=setup(t),r=await s.handle(incoming(1,asset)),d=s.store.read(r.json.jobKey),base=s.bot;
 s.bot=async(method,b)=>{if(method==='editMessageText')throw Error('offline');return base(method,b);};
 await assert.rejects(s.startAnalysis(d,{owner:'42'}),/offline/);assert.equal(s.store.read('analysis_slots').slots.length,0);assert.equal(s.store.read(d.key).status,'pending');
 s.store.change('analysis_slots',()=>({slots:[{key:'a',until:Date.now()+10000},{key:'b',until:Date.now()+10000}]}));
 await assert.rejects(s.startAnalysis(s.store.read(d.key),{owner:'42'}),/ANALYSIS_BUSY/);
});
function sender(s,uncertain=false){
 const photo=new Api.Photo({id:bigInt(321),accessHash:bigInt(654),fileReference:Buffer.from('x'),date:0,sizes:[],dcId:1});const media=new Api.MessageMediaPhoto({photo});let req,writes=0;
 const client={invoke:async x=>{req=x;writes++;if(uncertain)throw Error('network');return {updates:[{className:'UpdateMessageID',id:88,randomId:x.randomId}]};},getMessages:async()=>[{className:'Message',message:req.message,entities:req.entities,fromId:new Api.PeerUser({userId:bigInt(42)}),peerId:new Api.PeerChannel({channelId:bigInt(1234500000)}),replyTo:{replyToTopId:10},media}]};
 s.personal=async fn=>fn(client,{premium:false});s.group=async()=>new Api.InputPeerChannel({channelId:bigInt(1234500000),accessHash:bigInt(1)});s.stage=async()=>({source:{media},botMessageId:300});s.cleanup=async()=>{};
 return {get req(){return req;},get writes(){return writes;}};
}
test('captionless and formatted media post as personal sender into selected topic',async t=>{
 for(const caption of ['', '🙏 Text']){
  const s=setup(t),r=await s.handle(incoming(1,{...asset,caption,caption_entities:caption?[{type:'bold',offset:3,length:4}]:[]})),d=s.store.read(r.json.jobKey),m=sender(s);
  assert.equal((await s.handle(cb(d,'t10'))).json.status,'sent');assert.equal(m.writes,1);assert.equal(m.req.message,caption);assert.equal(m.req.sendAs.className,'InputPeerSelf');assert.equal(m.req.replyTo.topMsgId,10);
  assert.equal(s.store.read(d.key).receipt.messageId,88);
  const receipt=s.calls.find(x=>x.method==='sendMessage'&&x.body.text.startsWith('https://t.me/c/'));assert(receipt);assert(receipt.body.text.startsWith('https://t.me/c/1234500000/10/88\n\n✅'));assert(receipt.body.text.includes('படம்'));assert.equal(receipt.body.reply_to_message_id,1);assert.equal(receipt.body.disable_web_page_preview,true);
 }
});
test('uncertain delivery is persisted and cannot automatically send again',async t=>{
 const s=setup(t),r=await s.handle(incoming(1,asset)),d=s.store.read(r.json.jobKey),m=sender(s,true);
 assert.equal((await s.handle(cb(d,'t10'))).json.status,'uncertain');await assert.rejects(s.handle(cb(d,'t10')),/ALREADY_HANDLED/);assert.equal(m.writes,1);
});
test('hidden/closed topics remain visible but do not start a send',async t=>{
 const s=setup(t),r=await s.handle(incoming(1,asset)),d=s.store.read(r.json.jobKey),m=sender(s);s.topics=async()=>[{id:10,title:'Closed',closed:true,emoji:'📁'}];
 assert.equal((await s.handle(cb(d,'t10'))).json.status,'failed');assert.equal(m.writes,0);
});
test('unsupported albums and files are rejected before media handling',()=>{assert.throws(()=>parseMedia({...asset,media_group_id:'album'}),/ALBUM/);assert.throws(()=>parseMedia({document:{file_id:'f',file_unique_id:'u',mime_type:'application/pdf'}}),/MEDIA_TYPE/);});
test('successful analysis only updates this draft and requires a later topic tap',async t=>{
 const s=setup(t),r=await s.handle(incoming(1,asset));s.analyze=async()=>({json:{next:1}});await s.handle(incoming(2,{text:'/analyze',reply_to_message:{message_id:1}}));
 const d=s.store.read(r.json.jobKey),candidates=['Jesus','Christianity','Faith','Prayer','Peace','Love','Bible','Compassion','Forgiveness','Devotion','Spirituality','Hope','SermonOnTheMount'].map(tag=>({tag,confidence:.9,evidence:'Synthetic supported example'}));
 const result=await s.finish(d.key,d.rev,{candidates:[{content:{parts:[{text:JSON.stringify({candidates,summaryLines:summary})}]}}]});
 assert.equal(result.status,'analysis_ready');const next=s.store.read(d.key);assert.equal(next.status,'pending');assert(next.tags.includes('#Gods'));assert(next.tags.includes('#Deities'));assert.equal(next.receipt,undefined);
 assert.deepEqual(next.summaryLines,summary);assert(s.calls.at(-1).body.text.includes(summary.join('\n')+'\n\n#'));assert(s.reusedTags().includes('#Jesus'));
 assert(s.calls.at(-1).body.reply_markup.inline_keyboard.some(row=>row[0].text.includes('Hashtags நீக்கு')));
});
test('completed summary and hashtags stay private while group caption remains original',async t=>{
 const s=setup(t),r=await s.handle(incoming(1,{...asset,caption:'🙏 Original',caption_entities:[{type:'bold',offset:3,length:8}]}));
 s.analyze=async()=>({json:{next:1}});await s.handle(incoming(2,{text:'/analyze',reply_to_message:{message_id:1}}));
 let d=s.store.read(r.json.jobKey);await s.finish(d.key,d.rev,analysisResult());d=s.store.read(d.key);
 const mock=sender(s);await s.handle(cb(d,'t10'));assert.equal(mock.req.message,'🙏 Original');assert(!mock.req.entities.some(x=>x.className==='MessageEntityHashtag'));
 assert.equal(s.store.read(d.key).receipt.caption,'🙏 Original');
});
test('reply analysis of a posted upload gives one combined reply without modifying or reposting it',async t=>{
 const s=setup(t),r=await s.handle(incoming(1,asset)),original=s.store.read(r.json.jobKey);sender(s);await s.handle(cb(original,'t10'));const saved=s.store.read(original.key);
 let selected;s.analyze=async d=>{selected=d;return {json:{next:1}};};s.publish=async()=>{throw Error('MUST_NOT_POST');};
 const command=incoming(2,{text:'/analyze',reply_to_message:{message_id:1,from:{id:42,is_bot:false},...asset}});
 assert.equal((await s.handle(command)).json.next,1);assert.equal(selected.sourceMessageId,1);assert.equal(selected.analysisOnly,true);
 assert.equal((await s.handle(command)).json.status,'duplicate_analysis');
 assert.equal((await s.finish(selected.key,selected.rev,analysisResult())).status,'analysis_ready');
 const result=s.calls.at(-1).body;assert(result.text.includes(summary.join('\n')));assert(result.text.includes('#Jesus'));assert.deepEqual(result.reply_markup.inline_keyboard,[]);
 const progress=s.calls.find(x=>x.method==='sendMessage'&&x.body.text.includes('தயாராகின்றன'));assert.equal(progress.body.reply_to_message_id,1);
 assert.deepEqual(s.store.read(original.key),saved);assert.equal(s.store.read(selected.key).status,'analysed');
 await assert.rejects(s.publish(selected,10),/MUST_NOT_POST/);
});
test('reply selects the exact old video, including when no original draft exists',async t=>{
 const s=setup(t);let chosen;s.analyze=async d=>{chosen=d;return {json:{next:2}};};
 const reply={message_id:73,from:{id:42,is_bot:false},video:{file_id:'old_video',file_unique_id:'video_unique',mime_type:'video/mp4',file_size:500,duration:30},caption:'Video caption'};
 const result=await s.handle(incoming(100,{text:'/analysis',reply_to_message:reply}));assert.equal(result.json.next,2);assert.equal(chosen.sourceMessageId,73);assert.equal(chosen.fileId,'old_video');assert.equal(chosen.caption,'Video caption');assert.equal(chosen.analysisOnly,true);
 await assert.rejects(Service.prototype.publish.call(s,chosen,10),/ANALYSIS_ONLY/);
});
test('reply analysis rejects nonmedia and another private sender before download',async t=>{
 const s=setup(t);s.analyze=async()=>{throw Error('MUST_NOT_ANALYZE');};
 for(const reply of [{message_id:10,from:{id:43},...asset},{message_id:11,from:{id:42},text:'not media'}]){
  assert.equal((await s.handle(incoming(20,{text:'/analyze',reply_to_message:reply}))).json.status,'reply_media_required');
 }
});
test('missing or oversized summary never produces a hashtags-only success',async t=>{
 for(const invalid of [undefined,['One line.'],['A'.repeat(161),'Second line.','Third line.'],['படத்தில் ஒரு விளக்கு உள்ளது.','மேகங்கள் உள்ளன.','அமைதி நிலவுகிறது.']]){
  const s=setup(t),r=await s.handle(incoming(1,asset));s.analyze=async()=>({json:{next:1}});await s.handle(incoming(2,{text:'/analyze',reply_to_message:{message_id:1}}));
  const d=s.store.read(r.json.jobKey);assert.equal((await s.finish(d.key,d.rev,{...analysisResult(),summaryLines:invalid})).status,'analysis_failed');
  assert.equal(s.store.read(d.key).analysisApproved,false);assert.equal(s.reusedTags().length,0);
 }
});
test('repeated pending analyze command cannot run AI twice and paired results clear together',async t=>{
 const s=setup(t),r=await s.handle(incoming(1,asset));let count=0;s.analyze=async()=>{count++;return {json:{next:1}};};
 const command=incoming(2,{text:'/analyze',reply_to_message:{message_id:1}});await s.handle(command);let d=s.store.read(r.json.jobKey);
 await s.finish(d.key,d.rev,analysisResult());assert.equal((await s.handle(command)).json.status,'duplicate_analysis');assert.equal(count,1);
 d=s.store.read(d.key);await s.handle(cb(d,'off'));d=s.store.read(d.key);assert.deepEqual(d.summaryLines,[]);assert.deepEqual(d.tags,[]);assert.equal(d.analysisApproved,false);
});
test('standalone analysis cancellation discards late AI output without creating a topic picker',async t=>{
 const s=setup(t);let d;s.analyze=async x=>{d=x;return {json:{next:1}};};
 await s.handle(incoming(2,{text:'/analyze',reply_to_message:{message_id:1,from:{id:42},...asset}}));
 await s.handle(cb(d,'off'));assert.equal((await s.finish(d.key,d.rev,analysisResult())).status,'stale_analysis');
 assert.equal(s.store.read(d.key).status,'cancelled');assert(!s.calls.some(x=>x.body.text?.includes('எந்த topic')));
});
test('caption editing verifies the existing post and supports empty text',async t=>{
 const s=setup(t),r=await s.handle(incoming(1,{...asset,caption:'Original'})),d=s.store.read(r.json.jobKey);sender(s);await s.handle(cb(d,'t10'));let live=s.store.read(d.key);
 await s.requestEdit(live);
 // Resolve the synthetic force-reply prompt through the persistent link, not assumptions about IDs.
 const refFile=fs.readdirSync(s.store.root).find(f=>f.startsWith('reply_42_')&&f.endsWith('.json'));const refId=Number(refFile.slice(9,-5));let text='Original',writes=0;
 s.personal=async fn=>fn({getMessages:async()=>[{className:'Message',message:text,entities:[],fromId:new Api.PeerUser({userId:bigInt(42)}),replyTo:{replyToTopId:10}}],invoke:async x=>{assert.equal(x.className,'messages.EditMessage');text=x.message;writes++;}},{premium:false});
 const edited=await s.editReply({text:'/empty',reply_to_message:{message_id:refId,from:{id:99}}},'42');assert.equal(edited.status,'edited');assert.equal(writes,1);assert.equal(s.store.read(d.key).receipt.caption,'');
 await assert.rejects(s.editReply({text:'stale',reply_to_message:{message_id:refId,from:{id:99}}},'42'),/STALE_EDIT/);
});
test('download with consent revoked cannot return bytes to an AI node',async t=>{
 const s=setup(t),r=await s.handle(incoming(1,asset));s.store.change(r.json.jobKey,x=>({...x,status:'analysing',rev:2,analysisConsent:{owner:'42',revision:2}}));const d=s.store.read(r.json.jobKey);
 s.stage=async()=>({source:{},botMessageId:1});s.cleanup=async()=>{};s.personal=async fn=>fn({downloadMedia:async()=>{s.store.change(d.key,x=>({...x,status:'pending',rev:3,analysisConsent:null}));return Buffer.from('image');}});
 const result=await s.analyze(d);assert.equal(result.json.next,0);assert.equal(result.binary,undefined);
});
test('private bot staging accepts a resolved sender when Telegram omits fromId',async t=>{
 for(const variant of ['implicit','foreign','outgoing','wrong_peer']){
  const s=setup(t);let marker,cleaned=0;s.cleanup=async()=>{cleaned++;};
  s.bot=async(method,body)=>{assert.equal(method,'sendPhoto');marker=body.caption;return {message_id:55,photo:[{file_unique_id:'unique'}]};};
  const client={getInputEntity:async()=>({userId:bigInt(99)}),getMessages:async()=>[{className:'Message',id:55,message:marker,peerId:{userId:variant==='wrong_peer'?98:99},senderId:bigInt(variant==='foreign'?98:99),out:variant==='outgoing',media:{photo:{id:321}}}]};
  const d={key:'a'.repeat(20),kind:'photo',fileId:'file',uniqueId:'unique'};
  if(variant==='implicit'){const result=await s.stage(d,client);assert.equal(result.source.senderId.toString(),'99');assert.equal(result.source.fromId,undefined);assert.equal(cleaned,0);}
  else{await assert.rejects(s.stage(d,client),/STAGE_UNAVAILABLE/);assert.equal(cleaned,1);}
 }
});
