'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Service:Media}=require('../dist/nodes/NnaMediaCollection/core'),{Service:Poll}=require('../dist/nodes/NnaPollStudio/service'),{Store}=require('../dist/nodes/NnaMediaCollection/store');
const {Api}=require('teleproto'),bigInt=require('big-integer');
const gid='-1001234500000',c={apiId:1,apiHash:'a'.repeat(32),sessionString:'1fake',expectedUserId:'42',expectedUsername:'nna_enthiran',allowedGroupId:gid,allowedGroupUsername:'examplegroup',allowedTopicIds:'10'};
const scope={groupId:gid,botId:'99',botUsername:'example_bot',operatorIds:['42','43'],topicIds:[10],groupReplies:true,adminCommandGroupIds:[gid],groups:[{id:gid,title:'Group'}],defaultTargets:[{groupId:gid,topicId:10,title:'Daily'}],adminKeyboard:true,albums:true,replyKeyboard:true};
const photo={photo:[{file_id:'image',file_unique_id:'image-unique',file_size:100}]},video={video:{file_id:'video',file_unique_id:'video-unique',file_size:300,mime_type:'video/mp4',duration:5}};
const incoming=(id,text,extra={})=>({update_id:id,message:{message_id:id,date:Math.floor(Date.now()/1000),chat:{id:Number(gid),type:'supergroup'},message_thread_id:10,is_topic_message:true,from:{id:42,is_bot:false},text,...extra}});
const replied=(id,text,asset=photo,extra={})=>incoming(id,text,{reply_to_message:{message_id:90,from:{id:77,is_bot:false},...asset},...extra});
const privateInput=(id,text,extra={})=>incoming(id,text,{chat:{id:42,type:'private'},message_thread_id:undefined,is_topic_message:false,...extra});
const raw={summaryLines:['The artwork shows a lamp.','Soft light fills the scene.','The mood is calm and peaceful.'],candidates:['Peace','Light','Spirituality'].map(tag=>({tag,confidence:.9,evidence:'Sample'}))};
function setup(t,kind='media'){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'nna-inplace-'));t.after(()=>{assert.equal(path.dirname(root),os.tmpdir());assert(path.basename(root).startsWith('nna-inplace-'));fs.rmSync(root,{recursive:true,force:true});});
 const calls=[],jobs=[];let seq=500,role='administrator';
 const bot=async(method,body={})=>{calls.push({method,body});if(method==='getMe')return {id:99,is_bot:true,username:'example_bot'};if(method==='getChatMember')return {status:role,user:{id:body.user_id}};return {message_id:++seq,chat:{id:body.chat_id,type:'supergroup'},from:{id:99,is_bot:true},message_thread_id:body.message_thread_id};};
 const ctx={helpers:{httpRequest:async r=>({ok:true,result:await bot(r.url.split('/').at(-1),r.body)}),prepareBinaryData:async b=>({data:b.toString('base64')})}};
 const create=()=>{const s=new (kind==='poll'?Poll:Media)(ctx,c,{accessToken:'99:test'},{...scope,...(kind==='reply'?{analysisCommand:'mediareport'}:{})},{root});if(kind!=='poll'){s.me={id:99,is_bot:true,username:'example_bot'};s.store=new Store(99,root);s.analyze=async d=>{jobs.push(d);return {json:{next:d.mime.startsWith('image/')?1:2,jobKey:d.key,revision:d.rev}};};}s.bot=bot;return s;};
 return {s:create(),create,calls,jobs,role:r=>role=r};
}
const invoke=(s,kind,u)=>kind==='reply'?s.handleAnalysis(u):s.handle(u);
const sends=calls=>calls.filter(c=>/^(send|edit)/.test(c.method));
const callback=(id,message,button,owner=42,topic=10)=>({update_id:id,callback_query:{id:'cb'+id,data:button.callback_data,from:{id:owner,is_bot:false},message:{message_id:message.message_id,chat:{id:Number(gid),type:'supergroup'},message_thread_id:topic,from:{id:99,is_bot:true}}}});
for(const kind of ['media','reply']){
 for(const [label,asset,next] of [['image',photo,1],['video',video,2]])test(kind+' group '+label+' report resumes after restart into exact topic and source, with separate copy spans',async t=>{
  const {s,create,calls,jobs}=setup(t,kind),command=kind==='reply'?'/mediareport':'/analyze',u=replied(1,command,asset);
  assert.equal((await invoke(s,kind,u)).json.next,next);assert.equal(jobs[0].analysisOnly,true);assert.equal(jobs[0].sourceMessageId,90);
  await invoke(s,kind,u);assert.equal(jobs.length,1);
  const d=jobs[0],r=create();assert.equal((await r.finish(d.key,d.rev,raw)).status,'analysis_ready');
  for(const x of sends(calls)){assert.equal(String(x.body.chat_id),gid);if(x.method==='sendMessage'){assert.equal(x.body.message_thread_id,10);assert.equal(x.body.reply_parameters.message_id,90);assert.equal(x.body.reply_parameters.allow_sending_without_reply,false);}}
  const report=sends(calls).at(-1).body;assert.deepEqual(report.entities.map(e=>e.type),['code','code']);assert.equal(report.text.slice(report.entities[0].offset,report.entities[0].offset+report.entities[0].length),raw.summaryLines.join('\n'));assert.equal(report.reply_markup.inline_keyboard.length,0);
 });
 test(kind+' routes cannot leak into another topic or private chat on reuse',async t=>{
  const {s,jobs,calls}=setup(t,kind),cmd=kind==='reply'?'/mediareport':'/analyze';
  await invoke(s,kind,replied(1,cmd));const first=jobs[0];
  await invoke(s,kind,replied(2,cmd,photo,{message_thread_id:11}));assert.notEqual(jobs[1].key,first.key);
  s.releaseAnalysis(first.key,first.rev);
  await invoke(s,kind,privateInput(3,cmd,{reply_to_message:{message_id:90,from:{id:42,is_bot:false},...photo}}));
  assert.notEqual(jobs[2].key,first.key);assert(!jobs[2].replyContext);assert.equal(sends(calls).at(-1).body.chat_id,'42');
 });
 test(kind+' rejects unapproved actors, other bot commands and stale/forwarded input',async t=>{
  const {s,calls,jobs,role}=setup(t,kind),cmd=kind==='reply'?'/mediareport':'/analyze';
  for(const extra of [{from:{id:88,is_bot:false}},{sender_chat:{id:-1001}},{forward_origin:{type:'user'}},{date:1},{chat:{type:'supergroup',id:-1009999900000}}])await invoke(s,kind,replied(1,cmd,photo,extra));
  await invoke(s,kind,replied(2,cmd+'@other_bot'));role('member');await invoke(s,kind,replied(3,cmd));assert.equal(jobs.length,0);assert.equal(sends(calls).length,0);
 });
 test(kind+' no completed report is posted after admin permission revocation',async t=>{
  const {s,create,role,jobs,calls}=setup(t,kind);await invoke(s,kind,replied(1,kind==='reply'?'/mediareport':'/analyze'));const d=jobs[0],count=sends(calls).length;role('member');assert.equal((await create().finish(d.key,d.rev,raw)).status,'group_admin_revoked');assert.equal(sends(calls).length,count);
 });
 test(kind+' armed group media must reply to this bot; private mode stays independent',async t=>{
  const {s,jobs}=setup(t,kind),cmd=kind==='reply'?'/mediareport':'/analyze';await invoke(s,kind,incoming(1,cmd));
  await invoke(s,kind,incoming(2,undefined,photo));assert.equal(jobs.length,0);
  await invoke(s,kind,incoming(3,undefined,{...photo,reply_to_message:{message_id:501,from:{id:99,is_bot:true}}}));assert.equal(jobs.length,1);assert.equal(jobs[0].sourceMessageId,3);assert.equal(jobs[0].analysisOnly,true);
 });
}
test('group analysis callback cannot operate on same owner draft from another topic or private chat',async t=>{
 const {s,jobs,create}=setup(t);await s.handle(replied(1,'/analyze'));const d=jobs[0],control={message_id:d.controlId},button={callback_data:'mc:'+d.key+':'+d.rev+':off'};
 await assert.rejects(create().handle(callback(2,control,button,42,11)),/STALE_BUTTON/);
 const u=callback(3,control,button);u.callback_query.message.chat={id:42,type:'private'};delete u.callback_query.message.message_thread_id;await assert.rejects(create().handle(u),/STALE_BUTTON/);
 assert.equal((await create().handle(callback(4,control,button))).json.status,'analysis_off');
});
test('group source download verifies topic and uses no private copy/staging',async t=>{
 const {s,jobs,calls}=setup(t);await s.handle(replied(1,'/analyze'));const d=jobs[0];delete s.analyze;let topic=10,downloads=0;
 s.personal=async fn=>fn({getEntity:async()=>new Api.Channel({id:bigInt(1234500000),megagroup:true,forum:true,title:'Group',photo:new Api.ChatPhotoEmpty(),date:0}),getInputEntity:async g=>new Api.InputPeerChannel({channelId:g.id,accessHash:bigInt(1)}),getMessages:async()=>[{id:90,media:{},replyTo:{replyToTopId:topic}}],downloadMedia:async()=>{downloads++;return Buffer.from('test');}});
 assert.equal((await s.analyze(d)).json.next,1);topic=11;await assert.rejects(s.analyze(d),/TOPIC_MISMATCH/);assert.equal(downloads,1);assert(!calls.some(c=>c.method==='copyMessage'));
});
test('media group menu is analysis-only and topic order retains private launcher',async t=>{
 const {s,calls}=setup(t);await s.handle(incoming(1,'/menu'));assert.match(sends(calls).at(-1).body.text,/Group Image/);await s.handle(incoming(2,'/topicorder'));assert.match(sends(calls).at(-1).body.reply_markup.inline_keyboard[0][0].url,/start=topicorder/);
});
test('reply group home report button starts only the requested bot report',async t=>{
 const p=setup(t,'poll'),m=setup(t,'reply');await p.s.handle(incoming(1,'/menu'));const b=sends(p.calls).at(-1).body.reply_markup.inline_keyboard.flat().find(x=>x.text.includes('Report'));
 assert.equal((await m.s.handleAnalysis(callback(2,{message_id:501},b))).json.status,'report_armed');assert.equal(String(sends(m.calls).at(-1).body.chat_id),gid);
});
for(const kind of ['quiz','checklist'])test('group '+kind+' wizard uses actor-bound inline controls, same-topic destination and private management',async t=>{
 const {s,calls}=setup(t,'poll');await s.handle(incoming(1,'/poll'));const body=sends(calls).at(-1).body;assert(!body.reply_markup.keyboard);const btn=body.reply_markup.inline_keyboard.flat().find(x=>x.text.includes(kind==='quiz'?'Quiz':'Checklist'));
 const prompt={message_id:501};assert.equal((await s.handle(callback(2,prompt,btn,43))).status,'stale_group_button');assert.equal((await s.handle(callback(3,prompt,btn,42,11))).status,'stale_group_button');
 assert.equal((await s.handle(callback(4,prompt,btn))).status,'handled');assert.equal(s.draft('42').stage,'content');assert.match(sends(calls).at(-1).body.text,/Reply/);
 const reply={reply_to_message:{message_id:502,from:{id:99,is_bot:true}}},content=kind==='quiz'?'Question?\nA) Yes\nB) No':'Tasks\n1. Read\n2. Write';
 const sentBefore=sends(calls).length;await s.handle(incoming(5,content));assert.equal(sends(calls).length,sentBefore);
 await s.handle(incoming(6,content,reply));if(kind==='quiz')await s.handle(incoming(7,'B',reply));assert.equal(s.draft('42').stage,'settings');assert.equal(s.draft('42').settings.revote,false);
 assert.equal((await s.handle(callback(8,prompt,btn))).status,'stale_group_button');
 const d=s.draft('42');await s.destinations(d);assert.equal(d.destinations.length,1);assert.equal(d.destinations[0].topicId,10);
 await s.topicGroups('42');assert.match(sends(calls).at(-1).body.reply_markup.inline_keyboard[0][0].url,/start=polltopics/);
 for(const x of sends(calls)){assert.equal(String(x.body.chat_id),gid);assert.equal(x.body.message_thread_id,10);}
 await s.handle(privateInput(20,'/menu'));assert(sends(calls).at(-1).body.reply_markup.keyboard);assert.equal(sends(calls).at(-1).body.chat_id,'42');
});
test('private-only group commands do not enter the legacy dispatcher; unrelated group conversation is ignored',async t=>{
 const {s,calls}=setup(t,'poll');for(const name of ['history','templates','save','edit','share','bundle','live','polltopics']){const r=await s.handle(incoming(calls.length+1,'/'+name));assert.equal(r.status,'private_feature');assert.match(sends(calls).at(-1).body.reply_markup.inline_keyboard[0][0].url,new RegExp('start='+name+'$'));}
 const count=calls.length;assert.equal((await s.handle(incoming(100,'ordinary chat'))).handled,false);assert.equal(calls.length,count);
 assert.equal((await s.handle(incoming(101,'/start history'))).status,'private_feature');
 assert.equal((await s.handle(incoming(102,'📄 User Chat History',{reply_to_message:{message_id:501,from:{id:99,is_bot:true}}}))).status,'private_feature');
});
