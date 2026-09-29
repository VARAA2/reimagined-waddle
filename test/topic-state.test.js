'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{Api}=require('teleproto'),bigInt=require('big-integer');
const {runOperation}=require('../dist/nodes/NnaTelegramSender/sender');
const {NnaTelegramSender}=require('../dist/nodes/NnaTelegramSender/NnaTelegramSender.node');
const c={apiId:12345,apiHash:'a'.repeat(32),sessionString:'1'+'A'.repeat(352),expectedUserId:'12345',allowedGroupId:'-1001234567',allowedGroupUsername:'example_group',allowedTopicIds:'20'};
const cfg={topicStateGroupId:'-1001234567',topicStateTopicId:10};
function fake({closed=false,admin=true,creator=false,editError,ignoreEdit=false}={}){let state=closed,edits=0;
 const me=new Api.User({id:bigInt(12345),premium:true});
 const channel=new Api.Channel({id:bigInt(1234567),megagroup:true,forum:true,creator,adminRights:admin?new Api.ChatAdminRights({manageTopics:true}):undefined});
 const client={connect:async()=>{},destroy:async()=>{},getMe:async()=>me,getEntity:async()=>channel,getInputEntity:async()=>new Api.InputPeerChannel({channelId:bigInt(1234567),accessHash:bigInt(1)}),invoke:async r=>{
  if(r.className==='messages.GetForumTopicsByID'){assert.deepEqual(r.topics,[10]);return {topics:[{className:'ForumTopic',id:10,title:'Example topic',closed:state}]};}
  if(r.className==='messages.EditForumTopic'){edits++;assert.equal(r.topicId,10);assert.equal(r.title,undefined);if(editError){const e=Error(editError);e.errorMessage=editError;throw e;}if(!ignoreEdit)state=r.closed;return {};}
  throw Error('Unexpected RPC');
 }};return {client,get edits(){return edits;},get state(){return state;}};
}
const run=(f,op,p)=>runOperation(op,c,p,{createClient:async()=>f.client});

test('inspect reports state and permission without writing',async()=>{
 const f=fake({closed:true});const r=await run(f,'inspectTopicState',cfg);
 assert.deepEqual(r,{verified:true,senderId:'12345',groupId:'-1001234567',topicId:10,topicName:'Example topic',closed:true,canManageTopics:true});assert.equal(f.edits,0);
});
test('close then open changes state once each and verifies readback',async()=>{
 const f=fake();assert.equal((await run(f,'setTopicState',{...cfg,topicStateAction:'close'})).status,'closed');assert.equal(f.state,true);
 assert.equal((await run(f,'setTopicState',{...cfg,topicStateAction:'open'})).status,'opened');assert.equal(f.state,false);assert.equal(f.edits,2);
});
test('already matching state is skipped without any write',async()=>{
 const open=fake();assert.equal((await run(open,'setTopicState',{...cfg,topicStateAction:'open'})).status,'already_open');assert.equal(open.edits,0);
 const shut=fake({closed:true});assert.equal((await run(shut,'setTopicState',{...cfg,topicStateAction:'close'})).status,'already_closed');assert.equal(shut.edits,0);
});
test('creator may change state; missing admin right fails before writing',async()=>{
 assert.equal((await run(fake({admin:false,creator:true}),'setTopicState',{...cfg,topicStateAction:'close'})).status,'closed');
 const f=fake({admin:false});await assert.rejects(run(f,'setTopicState',{...cfg,topicStateAction:'close'}),/NNA_TOPIC_STATE_ADMIN_REQUIRED/);assert.equal(f.edits,0);
});
test('Telegram errors and unconfirmed readback fail closed',async()=>{
 await assert.rejects(run(fake({editError:'CHAT_ADMIN_REQUIRED'}),'setTopicState',{...cfg,topicStateAction:'close'}),/NNA_TOPIC_STATE_ADMIN_REQUIRED/);
 await assert.rejects(run(fake({editError:'FLOOD_WAIT_X'}),'setTopicState',{...cfg,topicStateAction:'close'}),/NNA_TOPIC_STATE_UNCONFIRMED/);
 await assert.rejects(run(fake({ignoreEdit:true}),'setTopicState',{...cfg,topicStateAction:'close'}),/NNA_TOPIC_STATE_UNCONFIRMED/);
});
test('invalid configuration is rejected before connecting',async()=>{
 for(const p of [{...cfg,topicStateGroupId:'-1009999999',topicStateAction:'close'},{...cfg,topicStateTopicId:1,topicStateAction:'close'},{...cfg,topicStateAction:'toggle'}]){
  let connected=false;await assert.rejects(runOperation('setTopicState',c,p,{createClient:async()=>{connected=true;return fake().client;}}));assert.equal(connected,false);
 }
});
test('node exposes both operations and passes parameters',async()=>{
 const node=new NnaTelegramSender(),ops=node.description.properties.find(x=>x.name==='operation').options.map(o=>o.value);
 assert.ok(ops.includes('inspectTopicState')&&ops.includes('setTopicState'));
 const action=node.description.properties.find(x=>x.name==='topicStateAction');assert.deepEqual(action.options.map(o=>o.value),['open','close']);
});
