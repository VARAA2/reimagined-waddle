'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Service,config}=require('../dist/nodes/NnaMediaCollection/core'),feedback=require('../dist/nodes/NnaMediaCollection/processing-feedback'),{Store}=require('../dist/nodes/NnaMediaCollection/store');
const gid='-1001234500000',c={apiId:1,apiHash:'a'.repeat(32),sessionString:'1fake',expectedUserId:'42',expectedUsername:'nna_enthiran',allowedGroupId:gid,allowedGroupUsername:'examplegroup',allowedTopicIds:'10'};
const emoji=(customEmojiId,emoji)=>({customEmojiId,emoji});
const settings={enabled:true,indicator:emoji('100','🤖'),reaction:emoji('101','👀'),delayMs:2000,timeoutMs:60000};
const scope={groupId:gid,botUsername:'example_bot',operatorIds:['42'],topicIds:[10],groupReplies:true,adminCommandGroupIds:[gid],processingFeedback:settings};
const raw={summaryLines:['A lamp illuminates the room.','Warm light surrounds it.','The scene is peaceful.'],candidates:['Peace','Light','Spirituality'].map(tag=>({tag,confidence:.9,evidence:'Sample'}))};
const message=(id,cmd,group=false)=>({update_id:id,message:{message_id:id,date:Math.floor(Date.now()/1000),chat:{id:group?Number(gid):42,type:group?'supergroup':'private'},...(group?{message_thread_id:10}:{}),from:{id:42,is_bot:false},text:cmd,reply_to_message:{message_id:90,from:{id:42,is_bot:false},photo:[{file_id:'photo',file_unique_id:'unique',file_size:100}]}}});
function clock(){let now=10000,seq=0;const timers=new Map();return {now:()=>now,setTimeout:(fn,ms)=>{const id=++seq;timers.set(id,{fn,at:now+ms});return id;},clearTimeout:id=>timers.delete(id),advance:async ms=>{const end=now+ms;for(;;){const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end)break;now=next[1].at;timers.delete(next[0]);await next[1].fn();}now=end;},drop:()=>timers.clear()};}
function setup(t,kind='media',overrides={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'nna-feedback-')),time=clock(),calls=[],jobs=[];let seq=500,reject=()=>false;
 const ctx={helpers:{httpRequest:async r=>{const method=r.url.split('/').at(-1),body=r.body;calls.push({method,body,timeout:r.timeout});const problem=await reject(method,body);if(problem){if(problem instanceof Error)throw problem;throw Error('injected failure');}let result=true;if(method==='getMe')result={id:99,is_bot:true,username:'example_bot'};else if(method==='getChatMember')result={status:'administrator',user:{id:42}};else if(method==='sendMessage')result={message_id:++seq,chat:{id:body.chat_id},from:{id:99,is_bot:true},entities:body.entities};return {ok:true,result};}}};
 const create=()=>{const s=new Service(ctx,c,{accessToken:'99:test'},{...scope,...(kind==='reply'?{analysisCommand:'mediareport',processingFeedback:{...settings,indicator:emoji('200','🙏'),...overrides}}:{processingFeedback:{...settings,...overrides}})},{root,feedbackClock:time});s.me={id:99,is_bot:true,username:'example_bot'};s.store=new Store(99,root);s.analyze=async d=>{jobs.push(d);return {json:{next:1,jobKey:d.key,revision:d.rev}};};return s;};
 const s=create(),invoke=u=>kind==='reply'?s.handleAnalysis(u):s.handle(u);
 t.after(async()=>{for(const j of jobs)await feedback.complete(s,j.key,j.rev,'cancelled');time.drop();assert.equal(path.dirname(root),os.tmpdir());assert(path.basename(root).startsWith('nna-feedback-'));fs.rmSync(root,{recursive:true,force:true});});
 return {s,create,invoke,time,calls,jobs,reject:f=>reject=f};
}
const reactions=x=>x.calls.filter(c=>c.method==='setMessageReaction');
const indicators=x=>x.calls.filter(c=>c.method==='sendMessage'&&c.body.entities?.some(e=>e.type==='custom_emoji'));
for(const kind of ['media','reply'])for(const group of [false,true])test(kind+' '+(group?'topic':'private')+' delayed indicator, one eyes reaction, final report and cleanup',async t=>{
 const x=setup(t,kind),command=kind==='reply'?'/mediareport':'/analyze';await x.invoke(message(101,command,group));const d=x.jobs[0];
 await x.time.advance(1999);assert.equal(indicators(x).length,0);assert.equal(reactions(x).length,0);
 await x.time.advance(1);assert.equal(indicators(x).length,1);assert.equal(indicators(x)[0].body.entities[0].custom_emoji_id,kind==='reply'?'200':'100');
 await x.time.advance(40000);assert.deepEqual(reactions(x).map(c=>c.body.reaction[0]?.custom_emoji_id),['101']);
 for(const r of reactions(x)){assert.equal(r.body.message_id,101);assert.equal(r.body.chat_id,group?gid:'42');assert.equal(r.timeout,4000);}
 const b=indicators(x)[0].body;assert.equal(b.reply_parameters.message_id,90);assert.equal(b.message_thread_id,group?10:undefined);
 assert.equal((await x.create().finish(d.key,d.rev,raw)).status,'analysis_ready');
 assert(x.calls.some(c=>c.method==='deleteMessage'&&c.body.chat_id===(group?gid:'42')));
 assert.equal(reactions(x).at(-1).body.reaction[0].custom_emoji_id,'101');
 const report=x.calls.findLast(c=>c.method==='editMessageText'&&c.body.entities?.some(e=>e.type==='code'));assert(report);
 assert.equal(report.body.entities.length,2);const count=x.calls.length;await x.time.advance(120000);assert.equal(x.calls.length,count);
 await x.create().finish(d.key,d.rev,raw);assert.equal(x.calls.length,count+(group?1:0));
});
test('fast analysis and ordinary commands show no processing emoji',async t=>{const x=setup(t);await x.invoke(message(10,'/menu'));await x.time.advance(5000);assert.equal(indicators(x).length,0);await x.invoke(message(11,'/analyze'));const d=x.jobs[0];await x.s.finish(d.key,d.rev,raw);await x.time.advance(5000);assert.equal(indicators(x).length,0);assert.equal(reactions(x).length,0);});
test('AI error removes indicator and leaves eyes unchanged',async t=>{const x=setup(t);await x.invoke(message(10,'/analyze'));await x.time.advance(2000);const d=x.jobs[0];assert.equal((await x.s.finish(d.key,d.rev,{error:'provider unavailable'})).status,'analysis_failed');assert.equal(reactions(x).at(-1).body.reaction[0].custom_emoji_id,'101');assert.equal(x.calls.filter(c=>c.method==='deleteMessage').length,1);});
test('download error cannot leave background feedback running',async t=>{const x=setup(t);x.s.analyze=async()=>{await x.time.advance(2000);throw Error('MEDIA_DOWNLOAD_SIZE');};assert.equal((await x.invoke(message(10,'/analyze'))).json.status,'analysis_failed');assert.equal(reactions(x).at(-1).body.reaction[0].custom_emoji_id,'101');const count=x.calls.length;await x.time.advance(60000);assert.equal(x.calls.length,count);});
test('failed report delivery never produces a success tick',async t=>{const x=setup(t);await x.invoke(message(10,'/analyze'));const d=x.jobs[0];await x.time.advance(2000);x.reject((m,b)=>m==='editMessageText'&&b.entities?.some(e=>e.type==='code'));await assert.rejects(x.s.finish(d.key,d.rev,raw));assert.equal(reactions(x).at(-1).body.reaction[0].custom_emoji_id,'101');});
test('rejected custom reactions do not stop Gemini result delivery or emoji deletion',async t=>{const x=setup(t);x.reject(m=>m==='setMessageReaction');await x.invoke(message(10,'/analyze'));await x.time.advance(22000);const d=x.jobs[0];assert.equal((await x.s.finish(d.key,d.rev,raw)).status,'analysis_ready');assert.equal(x.calls.filter(c=>c.method==='deleteMessage').length,1);});
test('rejected custom emoji send does not stop analysis or retry forever',async t=>{const x=setup(t);x.reject((m,b)=>m==='sendMessage'&&b.entities?.some(e=>e.type==='custom_emoji'));await x.invoke(message(10,'/analyze'));await x.time.advance(22000);const d=x.jobs[0];assert.equal((await x.s.finish(d.key,d.rev,raw)).status,'analysis_ready');assert.equal(indicators(x).length,1);});
test('cancel button removes the animation, keeps eyes and rejects late Gemini completion',async t=>{const x=setup(t);await x.invoke(message(10,'/analyze'));await x.time.advance(2000);const d=x.jobs[0];const u={update_id:11,callback_query:{id:'callback',data:'mc:'+d.key+':'+d.rev+':off',from:{id:42,is_bot:false},message:{message_id:d.controlId,chat:{id:42,type:'private'},from:{id:99,is_bot:true}}}};await x.s.handle(u);assert.equal(reactions(x).at(-1).body.reaction[0].custom_emoji_id,'101');const n=reactions(x).length;await x.s.finish(d.key,d.rev,raw);assert.equal(reactions(x).length,n);});
test('reply cancelmedia command settles the original command reaction',async t=>{const x=setup(t,'reply');await x.invoke(message(10,'/mediareport'));await x.time.advance(2000);const u=message(11,'/cancelmedia');delete u.message.reply_to_message;await x.invoke(u);assert.equal(reactions(x).at(-1).body.message_id,10);assert.equal(reactions(x).at(-1).body.reaction[0].custom_emoji_id,'101');});
test('watchdog removes animation without modifying eyes when provider never finishes',async t=>{const x=setup(t);await x.invoke(message(10,'/analyze'));await x.time.advance(60000);assert.equal(reactions(x).at(-1).body.reaction[0].custom_emoji_id,'101');assert.equal(x.calls.filter(c=>c.method==='deleteMessage').length,1);});
test('old job cannot clear a new job in another topic',async t=>{const x=setup(t);await x.invoke(message(10,'/analyze',true));const a=x.jobs[0],u=message(11,'/analyze',true);u.message.message_thread_id=20;await x.invoke(u);const b=x.jobs[1];await x.time.advance(2000);await x.s.finish(a.key,a.rev,raw);await x.time.advance(10000);const r=reactions(x).at(-1);assert.equal(r.body.message_id,11);assert.equal(r.body.reaction[0].custom_emoji_id,'101');await x.s.finish(b.key,b.rev,raw);});
test('restart recovery reads stored origin and finishes cleanup',async t=>{const x=setup(t);await x.invoke(message(10,'/analyze',true));await x.time.advance(2000);const d=x.jobs[0];x.time.drop();const modulePath=require.resolve('../dist/nodes/NnaMediaCollection/processing-feedback'),cached=require.cache[modulePath];delete require.cache[modulePath];const restarted=require(modulePath);require.cache[modulePath]=cached;const s=x.create();restarted.recover(s);await x.time.advance(1000);await restarted.complete(s,d.key,d.rev,'cancelled');assert.equal(reactions(x).at(-1).body.chat_id,gid);assert.equal(reactions(x).at(-1).body.message_id,10);assert.equal(x.calls.filter(c=>c.method==='deleteMessage').length,1);});
test('feedback config rejects unsafe interval or malformed custom emoji',()=>{assert.throws(()=>config(c,{...scope,processingFeedback:{...settings,delayMs:1}}),/FEEDBACK_CONFIG/);assert.throws(()=>config(c,{...scope,processingFeedback:{...settings,indicator:{customEmojiId:'bad',emoji:'x'}}}),/FEEDBACK_CONFIG/);});
test('approved native fallback is used only after explicit custom reaction rejection',async t=>{
 const x=setup(t,'media',{reaction:{...settings.reaction,fallbackEmoji:'👀'}});
 x.reject((m,b)=>m==='setMessageReaction'&&b.reaction[0]?.type==='custom_emoji'?Object.assign(Error('Telegram rejected custom reaction'),{statusCode:400,response:{body:{description:'Bad Request: REACTION_INVALID'}}}):false);
 await x.invoke(message(10,'/analyze'));await x.time.advance(22000);
 assert.deepEqual(reactions(x).filter(c=>c.body.reaction[0]?.type==='emoji').map(c=>c.body.reaction[0].emoji),['👀']);
 const d=x.jobs[0];await x.s.finish(d.key,d.rev,raw);assert.equal(reactions(x).at(-1).body.reaction[0].emoji,'👀');assert.equal(reactions(x).length,2);
});
test('network errors do not silently replace the selected emoji with fallback',async t=>{const x=setup(t,'media',{reaction:{...settings.reaction,fallbackEmoji:'👀'}});x.reject(m=>m==='setMessageReaction');await x.invoke(message(10,'/analyze'));await x.time.advance(22000);assert(!reactions(x).some(c=>c.body.reaction[0]?.type==='emoji'));});
test('completion drains an in-flight emoji send before deleting it; no late working reaction',async t=>{
 const x=setup(t);await x.invoke(message(10,'/analyze'));const d=x.jobs[0];let release;const gate=new Promise(r=>release=r);x.reject(async(m,b)=>{if(m==='sendMessage'&&b.entities?.some(e=>e.type==='custom_emoji'))await gate;return false;});
 const advancing=x.time.advance(2000);await Promise.resolve();await Promise.resolve();const finishing=x.s.finish(d.key,d.rev,raw);release();await advancing;await finishing;
 assert.equal(indicators(x).length,1);assert.equal(x.calls.filter(c=>c.method==='deleteMessage').length,1);assert.deepEqual(reactions(x).filter(c=>c.body.reaction.length).map(c=>c.body.reaction[0].custom_emoji_id),[]);
});
test('failed indicator deletion is retried without removing persistent eyes reaction',async t=>{const x=setup(t);await x.invoke(message(10,'/analyze'));await x.time.advance(2000);const d=x.jobs[0];let remaining=1;x.reject(m=>m==='deleteMessage'&&remaining-->0);await x.s.finish(d.key,d.rev,raw);const count=reactions(x).length;await x.time.advance(5000);assert.equal(x.calls.filter(c=>c.method==='deleteMessage').length,2);assert.equal(reactions(x).length,count);});

test('Reply indicator uses Media fallback on explicit custom emoji rejection',async t=>{
 const x=setup(t,'reply',{indicatorFallback:settings.indicator});
 x.reject((m,b)=>m==='sendMessage'&&b.entities?.[0]?.custom_emoji_id==='200'?Object.assign(Error('Custom emoji unavailable'),{statusCode:400,response:{body:{description:'Bad Request: CUSTOM_EMOJI_INVALID'}}}):false);
 await x.invoke(message(10,'/mediareport'));await x.time.advance(2000);
 assert.deepEqual(indicators(x).map(c=>c.body.entities[0].custom_emoji_id),['200','100']);
 const d=x.jobs[0];await x.s.finish(d.key,d.rev,raw);assert.equal(x.calls.filter(c=>c.method==='deleteMessage').length,1);
 assert.deepEqual(reactions(x).map(c=>c.body.reaction[0].custom_emoji_id),['101']);
});
test('stripped Reply custom emoji is replaced in the same message using Media fallback',async t=>{
 const x=setup(t,'reply',{indicatorFallback:settings.indicator});
 x.reject((m,b)=>{if(m==='sendMessage'&&b.entities?.[0]?.custom_emoji_id==='200')delete b.entities;return false;});
 await x.invoke(message(10,'/mediareport',true));await x.time.advance(2000);
 const edits=x.calls.filter(c=>c.method==='editMessageText'&&c.body.entities?.[0]?.type==='custom_emoji');
 assert.equal(edits.length,1);assert.equal(edits[0].body.entities[0].custom_emoji_id,'100');assert.equal(edits[0].body.chat_id,gid);
 const sent=x.calls.findLast(c=>c.method==='sendMessage');assert.equal(sent.body.message_thread_id,10);
 const d=x.jobs[0];await x.s.finish(d.key,d.rev,raw);assert(x.calls.some(c=>c.method==='deleteMessage'&&c.body.message_id===edits[0].body.message_id));
});
