'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Api}=require('teleproto'),bigInt=require('big-integer');
const exporter=require('../dist/nodes/NnaTelegramSender/user-history-export');
const {runOperation}=require('../dist/nodes/NnaTelegramSender/sender');
const c={apiId:12345,apiHash:'a'.repeat(32),sessionString:'1'+'A'.repeat(352),expectedUserId:'1234567890',allowedGroupId:'-1001234567890',allowedGroupUsername:'example_group',allowedTopicIds:'10,20'};
const make=(query='77')=>({scope:{sourceGroupId:c.allowedGroupId,topicIds:[10,20,30],operatorIds:['1234567890'],botUsername:'example_bot'},update:{update_id:42,message:{date:Math.floor(Date.now()/1000),message_id:9,from:{id:1234567890,is_bot:false},chat:{id:1234567890,type:'private'},text:'/history '+query}}});
const msg=(id,topic,user=77,patch={})=>new Api.Message({id,date:Math.floor(Date.now()/1000)-id,message:'தமிழ் முழு உரை\nSecond line',peerId:new Api.PeerChannel({channelId:bigInt(1234567890)}),fromId:new Api.PeerUser({userId:bigInt(user)}),replyTo:new Api.MessageReplyHeader({forumTopic:true,replyToMsgId:topic}),...patch});
function fake(pages){
 const calls=[],state={destroyed:false};const client={connect:async()=>{},getMe:async()=>new Api.User({id:bigInt(c.expectedUserId)}),getInputEntity:async u=>u.className==='User'?new Api.InputPeerUser({userId:u.id,accessHash:bigInt.one}):new Api.InputPeerChannel({channelId:bigInt(1234567890),accessHash:bigInt.one}),getEntity:async q=>q===c.allowedGroupUsername?new Api.Channel({id:bigInt(1234567890),megagroup:true,forum:true,title:'Example'}):new Api.User({id:bigInt(77),firstName:'Example',username:'example_user'}),invoke:async r=>{
  calls.push(r);assert.ok(r.getBytes().length);
  if(r.className==='messages.GetForumTopicsByID')return {topics:[10,20,30].map(id=>({id,className:'ForumTopic',title:'Topic '+id}))};
  if(r.className==='messages.GetHistory')return {messages:[msg(999,10)]};
  if(r.className==='channels.GetParticipant')throw Error('USER_NOT_PARTICIPANT');
  assert.ok(['messages.GetReplies','messages.Search'].includes(r.className));const next=pages[r.msgId||r.topMsgId].shift();if(next instanceof Error)throw next;return {messages:next,users:[new Api.User({id:bigInt(77),firstName:'Example',username:'example_user'})]};
 },destroy:async()=>{state.destroyed=true;}};return {client,calls,state,deps:{createClient:async()=>client,sleep:async()=>{}}};
}
test('complete export follows even short pages to empty and filters target, snapshot and duplicates',async()=>{
 const f=fake({10:[[msg(50,10),msg(49,10,88)],[msg(50,10),msg(40,10)],[]],20:[[msg(70,20)],[]],30:[[]]});
 const r=await runOperation('exportUserHistory',c,make(),f.deps);
 assert.equal(r.totalMessages,3);assert.equal(r.complete,true);assert.equal(r.pages,6);assert.deepEqual(r.topics.map(t=>t.count),[2,1,0]);assert.ok(r.fileText.includes('தமிழ் முழு உரை\nSecond line'));assert.ok(r.fileText.includes('https://t.me/c/1234567890/10/50'));assert.match(r.fileName,/^telegram_history_77_.*\.txt$/);assert.equal(Buffer.byteLength(r.fileText),r.fileBytes);assert.equal(f.state.destroyed,true);assert.ok(r.fileText.indexOf('Message ID: 70')<r.fileText.indexOf('Message ID: 40'));assert.ok(f.calls.filter(x=>x.className==='messages.GetReplies').every(x=>x.maxId===1000));
});
test('username and numeric identity return same target; unknown numeric needs no access hash',async()=>{
 for(const query of ['77','@example_user']){const f=fake({10:[[msg(50,10)],[]],20:[[]],30:[[]]});assert.equal((await runOperation('exportUserHistory',c,make(query),f.deps)).targetUserId,'77');}
});
test('private operator, group, query, freshness and forwarding guards reject before session',async()=>{
 const changes=[p=>p.update.message.chat.type='supergroup',p=>p.update.message.from.id=99,p=>p.scope.sourceGroupId='-100999',p=>p.update.message.text='/history invalid query',p=>p.update.message.date-=90000,p=>p.update.message.forward_origin={},p=>p.scope.topicIds=[10,10]];
 for(const change of changes){const p=make();change(p);let created=false;await assert.rejects(runOperation('exportUserHistory',c,p,{createClient:async()=>{created=true;}}),/NNA_EXPORT_/);assert.equal(created,false);}
});
test('foreign topic, foreign group, stalled cursor and RPC failures never become a complete file',async()=>{
 for(const message of [msg(50,20),msg(50,10,77,{peerId:new Api.PeerChannel({channelId:bigInt(999)})})]){const f=fake({10:[[message]],20:[[]],30:[[]]});await assert.rejects(runOperation('exportUserHistory',c,make(),f.deps),/NNA_EXPORT_RESPONSE_/);}
 const f=fake({10:[[msg(50,10)],[msg(50,10)]],20:[[]],30:[[]]});await assert.rejects(runOperation('exportUserHistory',c,make(),f.deps),/NNA_EXPORT_CURSOR_STALLED/);
 const g=fake({10:[new Error('private session data')],20:[[]],30:[[]]});await assert.rejects(runOperation('exportUserHistory',c,make(),g.deps),e=>e.message==='NNA_EXPORT_READ_FAILED');
});
test('bounded flood wait retries the same read page without losing data',async()=>{
 const e=Object.assign(new Error('wait'),{errorMessage:'FLOOD_WAIT',seconds:1});const f=fake({10:[e,[msg(50,10)],[]],20:[[]],30:[[]]});let waited=0;f.deps.sleep=async ms=>{waited+=ms;};assert.equal((await runOperation('exportUserHistory',c,make(),f.deps)).totalMessages,1);assert.ok(waited>=2000);
});
test('media are represented by links and captions, including voice/audio/PDF/video/photo',()=>{
 const cases=[['MessageMediaPhoto',{},'Image'],['MessageMediaDocument',{mimeType:'audio/ogg',attributes:[{className:'DocumentAttributeAudio',voice:true}]},'Voice message'],['MessageMediaDocument',{mimeType:'audio/mpeg',attributes:[]},'Audio'],['MessageMediaDocument',{mimeType:'application/pdf',attributes:[]},'PDF'],['MessageMediaDocument',{mimeType:'video/mp4',attributes:[]},'Video']];
 for(const [className,document,kind] of cases){const m=msg(50,10);m.media={className,document};const text=exporter.formatRecord(m,{id:10,title:'Topic'},c.allowedGroupId);assert.ok(text.includes(kind+': https://t.me/c/1234567890/10/50'));assert.ok(text.includes(m.message));}
});
test('embedded text URLs and poll options remain in plain text',()=>{
 const m=msg(50,10);m.entities=[{className:'MessageEntityTextUrl',url:'https://example.org/resource'}];m.media={className:'MessageMediaPoll',poll:{question:{text:'Question?'},answers:[{text:{text:'Option A'}}]}};const text=exporter.formatRecord(m,{id:10,title:'Topic'},c.allowedGroupId);assert.ok(text.includes('Question?'));assert.ok(text.includes('Option A'));assert.ok(text.includes('https://example.org/resource'));
});
test('request parser recognizes commands/bare IDs/usernames without hijacking ordinary chat',()=>{
 for(const text of ['/history 77','/userhistory @example_user','123456','@example_user','/history@example_bot @example_user'])assert.equal(exporter.parseQuery(text,'example_bot').kind,'export');
 assert.equal(exporter.parseQuery('hello there','example_bot'),null);assert.equal(exporter.parseQuery('/history@other_bot 77','example_bot'),null);assert.equal(exporter.parseQuery('/history','example_bot').kind,'help');
});
test('legacy post without reply header retains the server-scoped forum topic',async()=>{
 const f=fake({10:[[msg(50,10,77,{replyTo:undefined})],[]],20:[[]],30:[[]]});const out=await runOperation('exportUserHistory',c,make(),f.deps);assert.equal(out.totalMessages,1);assert.ok(out.fileText.includes('Topic: Topic 10'));assert.ok(out.fileText.includes('/10/50'));
});
test('sender-search cannot silently ignore the user filter',async()=>{
 const f=fake({10:[[msg(50,10,88)]],20:[[]],30:[[]]});await assert.rejects(runOperation('exportUserHistory',c,make('@example_user'),f.deps),/SENDER_FILTER_MISMATCH/);
});
