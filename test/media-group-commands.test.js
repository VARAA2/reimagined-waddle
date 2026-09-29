'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Service,config}=require('../dist/nodes/NnaMediaCollection/core');
const {Store}=require('../dist/nodes/NnaMediaCollection/store');
const {NnaTelegramMonitor,tokenFor}=require('../dist/nodes/NnaTelegramMonitor/NnaTelegramMonitor.node');
const creds={apiId:1,apiHash:'a'.repeat(32),sessionString:'1fake',expectedUserId:'42',allowedGroupId:'-1001234500000',allowedGroupUsername:'examplegroup',allowedTopicIds:'10'};
const scope={groupId:'-1001234500000',botUsername:'example_bot',operatorIds:['42','43'],topicIds:[10],allTopics:true,albums:true,replyKeyboard:true,adminCommandGroupIds:['-1001234500000','-1002345600000']};
const incoming=(id,text='/menu@example_bot',extra={})=>({update_id:id,message:{message_id:id,date:Math.floor(Date.now()/1000),chat:{id:-1001234500000,type:'supergroup'},from:{id:42,is_bot:false},is_topic_message:true,message_thread_id:10,text,...extra}});
function setup(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'nna-group-menu-'));t.after(()=>{assert.equal(path.dirname(root),os.tmpdir());assert(path.basename(root).startsWith('nna-group-menu-'));fs.rmSync(root,{recursive:true,force:true});});
 const s=new Service({},creds,{},scope,{root});s.me={id:99,is_bot:true,username:'example_bot'};s.store=new Store(99,root);s.calls=[];const menus=new Map();s.menus=menus;
 s.bot=async(method,body)=>{s.calls.push({method,body});const key=JSON.stringify(body.scope);if(method==='getChatMember')return {status:'administrator',user:{id:42}};if(method==='getMyCommands')return menus.get(key)||[];if(method==='setMyCommands'){menus.set(key,body.commands);return true;}if(method==='deleteMyCommands'){menus.delete(key);return true;}return {message_id:200};};
 return s;
}
test('group slash launch verifies current admin, preserves topic and routes to exact private feature',async t=>{
 const s=setup(t);assert.equal((await s.handle(incoming(1,'/analyze@EXAMPLE_BOT'))).json.status,'group_menu');
 assert.equal(s.calls[0].method,'getChatMember');const sent=s.calls[1].body;assert.equal(sent.chat_id,-1001234500000);assert.equal(sent.message_thread_id,10);assert.equal(sent.reply_parameters.message_id,1);assert.equal(sent.reply_markup.inline_keyboard[0][0].url,'https://t.me/example_bot?start=analyze');
 assert.equal(s.store.read('mode_42'),null);assert.equal((await s.handle(incoming(1,'/analyze'))).json.status,'duplicate_group_command');assert.equal(s.calls.filter(c=>c.method==='sendMessage').length,1);
});
test('normal group media, another bot, unknown commands and arguments do not enter private workflow',async t=>{
 const s=setup(t);for(const text of ['hello','/menu@different_bot','/menu blah','/unknown'])assert.equal((await s.handle(incoming(1,text))).json.status,'ignored_group');
 assert.equal((await s.handle(incoming(2,undefined,{text:undefined,photo:[{file_id:'f'}]}))).json.status,'ignored_group');assert.equal(s.calls.length,0);
});
test('unconfigured groups, nonoperators, nonadmins, forwarded anonymous and old commands cannot launch',async t=>{
 const s=setup(t);for(const extra of [{chat:{id:-1009999900000,type:'supergroup'}},{from:{id:88,is_bot:false}},{from:{id:42,is_bot:true}},{sender_chat:{id:-1001234500000}},{forward_origin:{type:'user'}},{edit_date:1},{date:1}]){await s.handle(incoming(1,'/menu',extra));}assert.equal(s.calls.length,0);
 s.bot=async()=>({status:'member',user:{id:42}});assert.equal((await s.handle(incoming(2))).json.status,'admin_required');
 s.bot=async()=>({status:'administrator',user:{id:43}});assert.equal((await s.handle(incoming(3))).json.status,'admin_required');
});
test('uncertain group launcher delivery never automatically repeats',async t=>{
 const s=setup(t),bot=s.bot;let sends=0;s.bot=async(method,body)=>{if(method==='sendMessage'){sends++;throw Error('timeout');}return bot(method,body);};await assert.rejects(s.handle(incoming(1)),/timeout/);assert.equal((await s.handle(incoming(1))).json.status,'duplicate_group_command');assert.equal(sends,1);
});
test('private deep links activate requested feature and still enforce operator identity',async t=>{
 const s=setup(t);let order=0,home=0;s.showOrder=async()=>order++;s.home=async()=>home++;
 const p=(id,text)=>incoming(id,text,{chat:{id:42,type:'private'},is_topic_message:false,message_thread_id:undefined});
 assert.equal((await s.handle(p(1,'/start topicorder'))).json.status,'topic_order');assert.equal(order,1);
 assert.equal((await s.handle(p(2,'/start analyze'))).json.status,'analysis_armed');assert.equal(s.store.read('mode_42').armed,true);
 assert.equal((await s.handle(p(3,'/start cancel'))).json.status,'analysis_disarmed');assert.equal(s.store.read('mode_42').armed,false);
 assert.equal((await s.handle(p(4,'/start menu'))).json.status,'menu');assert.equal(home,1);
 await assert.rejects(s.handle({...p(5,'/start analyze'),message:{...p(5,'/start analyze').message,from:{id:43,is_bot:false}}}),/OPERATOR/);
});
test('command setup registers only admin scopes, retains unrelated commands and removes retired groups',async t=>{
 const s=setup(t),scopeKey=JSON.stringify({type:'chat_administrators',chat_id:scope.adminCommandGroupIds[0]});s.menus.set(scopeKey,[{command:'custom',description:'Existing'}]);
 await s.configureCommands();assert(s.menus.get(scopeKey).some(x=>x.command==='custom'));assert(s.menus.get(scopeKey).some(x=>x.command==='analyze'));
 assert(s.calls.filter(x=>x.method==='setMyCommands').every(x=>['all_private_chats','chat_administrators'].includes(x.body.scope.type)));
 s.scope={...s.scope,adminCommandGroupIds:[]};await s.configureCommands();assert.deepEqual(s.menus.get(scopeKey),[{command:'custom',description:'Existing'}]);assert.deepEqual(s.store.read('admin_command_scopes').groups,[]);
});
test('group allowlist rejects malformed or duplicate ids; omitted config stays private',()=>{
 for(const ids of ['all',['42'],['-1001234500000','-1001234500000'],Array(21).fill('-1001234500000')])assert.throws(()=>config(creds,{...scope,adminCommandGroupIds:ids}),/ADMIN_COMMAND_GROUPS/);
 assert.doesNotThrow(()=>config(creds,{...scope,adminCommandGroupIds:undefined}));
});
test('extra monitor groups admit messages only with valid webhook signature and preserve membership scope',async()=>{
 const node=new NnaTelegramMonitor(),url='https://host.example/webhook/demo',key='fake';let body=incoming(1);body.message.chat.id=-1002345600000;
 const params={ownerId:42,membershipChatId:-1001234500000,reviewChatId:-1001234500000,additionalGroupIds:'-1002345600000'};
 const ctx={getNodeParameter:(n,d)=>params[n]??d,getCredentials:async()=>({accessToken:key}),getNodeWebhookUrl:()=>url,getHeaderData:()=>({'x-telegram-bot-api-secret-token':tokenFor(key,url)}),getBodyData:()=>body};
 assert.equal((await node.webhook.call(ctx)).workflowData[0][0].json.message.chat.id,-1002345600000);
 body={update_id:2,chat_member:{chat:{id:-1002345600000,type:'supergroup'}}};assert.deepEqual(await node.webhook.call(ctx),{});
 params.additionalGroupIds='42';await assert.rejects(node.webhook.call(ctx),/INVALID_GROUPS/);
});
test('both private display paths emit exactly two independent complete native monospace spans',async t=>{
 const summary=['A café sign glows beside a lamp 💡 and symbols < > & ` stay literal.','The scene has a peaceful mood.','Light contrasts with the dark background.'];const tags=['#Peace','#Light','#தமிழ்','#Art'];
 for(const analysisOnly of [true,false]){
  const s=setup(t);s.personal=async f=>f({});s.topics=async()=>[{id:10,title:'Art'}];const d={key:'a'.repeat(20),owner:'42',rev:1,status:analysisOnly?'analysed':'pending',analysisOnly,analysisApproved:true,summaryLines:summary,tags,sourceMessageId:100};s.store.change(d.key,()=>d);await s.display(d);
  const b=s.calls.at(-1).body;assert.equal(b.entities.length,2);assert.deepEqual(b.entities.map(e=>e.type),['code','code']);assert.deepEqual(b.entities.map(e=>b.text.slice(e.offset,e.offset+e.length)),[summary.join('\n'),tags.join(' ')]);assert(!b.parse_mode);
  if(!analysisOnly)assert(b.reply_markup.keyboard.length>0);
 }
});
