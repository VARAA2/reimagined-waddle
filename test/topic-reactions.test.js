'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{Api}=require('teleproto'),bigInt=require('big-integer');
const {topicReactionEvent,topicReactionClaim,chooseThree}=require('../dist/nodes/NnaTelegramSender/topic-reactions');
const {runOperation}=require('../dist/nodes/NnaTelegramSender/sender');
const {NnaTelegramSender}=require('../dist/nodes/NnaTelegramSender/NnaTelegramSender.node');
const now=Date.parse('2026-09-25T12:00:00Z'),pool=Array.from({length:10},(_,i)=>String(100+i));
const cfg={topicReactionGroupId:'-1001234567',topicReactionTopicId:10,topicReactionEmojiPool:pool.join(','),topicReactionActivatedAt:'2026-09-24T00:00:00Z'};
const c={apiId:12345,apiHash:'a'.repeat(32),sessionString:'1'+'A'.repeat(352),expectedUserId:'12345',allowedGroupId:'-1001234567',allowedGroupUsername:'example_group',allowedTopicIds:'20'};
const event=()=>({update_id:1,message:{message_id:30,date:now/1000,chat:{id:-1001234567,type:'supergroup'},message_thread_id:10,is_topic_message:true,text:'Example'}});
const params=()=>({...cfg,update:event(),claimValidated:true,claimRequestKey:'topic-reaction:-1001234567:30',selectedEmojiIds:pool.slice(0,3),claimEmojiIds:pool.slice(0,3).join(',')});
function fake(){let own=[],writes=0;const peer=new Api.PeerChannel({channelId:bigInt(1234567)}),me=new Api.User({id:bigInt(12345),premium:true});
 const m=new Api.Message({id:30,date:now/1000,peerId:peer,message:'Example',replyTo:new Api.MessageReplyHeader({forumTopic:true,replyToTopId:10,replyToMsgId:10})});
 const client={connect:async()=>{},destroy:async()=>{},getMe:async()=>me,getEntity:async()=>new Api.Channel({id:bigInt(1234567),megagroup:true,forum:true}),getInputEntity:async()=>new Api.InputPeerChannel({channelId:bigInt(1234567),accessHash:bigInt(1)}),getMessages:async()=>{m.reactions=own.length?{results:own.map(reaction=>({reaction,count:1}))}:undefined;return [m];},invoke:async r=>{
  if(r.className==='channels.GetFullChannel')return {fullChat:{}};
  if(r.className==='messages.GetForumTopicsByID')return {topics:[{className:'ForumTopic',id:10,title:'Example topic'}]};
  if(r.className==='messages.GetCustomEmojiDocuments')return pool.map(id=>({className:'Document',id:bigInt(id),attributes:[{className:'DocumentAttributeCustomEmoji'}]}));
  if(r.className==='messages.GetMessageReactionsList')return {reactions:own.map(reaction=>({peerId:new Api.PeerUser({userId:bigInt(12345)}),reaction}))};
  if(r.className==='messages.SendReaction'){writes++;own=r.reaction;return {};}
  throw Error('Unexpected RPC');
 }};return {client,m,me,get writes(){return writes;},set own(v){own=v;}};
}
const run=(f,p=params(),op='reactToTopicPost')=>runOperation(op,c,p,{now,createClient:async()=>f.client});
test('ten emoji pool yields each of 120 combinations equally across all 720 ordered choices',()=>{
 const counts=new Map();for(let a=0;a<10;a++)for(let b=0;b<9;b++)for(let c=0;c<8;c++){
  const seq=[(a+.5)/10,(b+.5)/9,(c+.5)/8],chosen=chooseThree(pool,()=>seq.shift());assert.equal(new Set(chosen).size,3);
  const key=chosen.sort().join(',');counts.set(key,(counts.get(key)||0)+1);
 }assert.equal(counts.size,120);assert.ok([...counts.values()].every(n=>n===6));
});
test('all hours and common post types qualify, unrelated topics and service edits do not',()=>{
 for(const hour of [0,4,10,15,23]){const u=event();u.message.date=now/1000+hour*3600;assert.ok(topicReactionEvent(u,cfg,u.message.date*1000));}
 for(const type of ['photo','video','document','audio','voice','animation','sticker','video_note','poll','contact','location','venue','dice']){const u=event();delete u.message.text;u.message[type]=type==='photo'?[{}]:{};assert.ok(topicReactionEvent(u,cfg,now));}
 for(const change of [m=>m.message_thread_id=20,m=>m.chat.id=-1002222222,m=>m.is_topic_message=false,m=>delete m.text,m=>m.message_id=10]){const u=event();change(u.message);assert.equal(topicReactionEvent(u,cfg,now),null);}
 const u=event();u.edited_message=u.message;assert.equal(topicReactionEvent(u,cfg,now),null);
 assert.equal(topicReactionEvent(event(),cfg,now+1800001),null);assert.equal(topicReactionEvent(event(),{...cfg,topicReactionActivatedAt:new Date(now+1).toISOString()},now),null);
});
test('claims reject duplicate, out-of-pool, changed selection and wrong request before connection',async()=>{
 for(const patch of [{selectedEmojiIds:['100','100','101']},{selectedEmojiIds:['100','101','999']},{claimEmojiIds:'107,108,109'},{claimRequestKey:'wrong'},{claimValidated:false}]){
  assert.throws(()=>topicReactionClaim({...params(),...patch},now),/CLAIM/);let connected=false;
  await assert.rejects(runOperation('reactToTopicPost',c,{...params(),...patch},{now,createClient:async()=>{connected=true;return fake().client;}}));assert.equal(connected,false);
 }
});
test('only persisted chosen three are sent and repeat preserves them without another write',async()=>{
 const f=fake(),p={...params(),selectedEmojiIds:['103','107','109'],claimEmojiIds:'103,107,109'};
 const r=await run(f,p);assert.equal(r.status,'reacted');assert.deepEqual(r.customEmojiIds,p.selectedEmojiIds);
 assert.equal((await run(f,p)).status,'already_present');assert.equal(f.writes,1);
});
test('media and text get actual source readback; changed or wrong sources cannot write',async()=>{
 const f=fake(),p=params();delete p.update.message.text;p.update.message.video={};f.m.message='';f.m.media=new Api.MessageMediaDocument({});assert.equal((await run(f,p)).status,'reacted');
 for(const change of [m=>m.date--,m=>m.message='changed',m=>m.editDate=1,m=>m.replyTo.replyToTopId=20,m=>m.peerId=new Api.PeerChannel({channelId:bigInt(999)})]){const f=fake();change(f.m);await assert.rejects(run(f),/SOURCE/);assert.equal(f.writes,0);}
});
test('scope is read-only and validates premium, personal send-as, topic and custom documents',async()=>{
 const f=fake();assert.equal((await run(f,cfg,'inspectTopicReactionScope')).customEmojiPool.length,10);assert.equal(f.writes,0);
 const g=fake();g.me.premium=false;await assert.rejects(run(g),/PREMIUM/);assert.equal(g.writes,0);
 for(const [method,response,error] of [['channels.GetFullChannel',{fullChat:{defaultSendAs:new Api.PeerChannel({channelId:bigInt(1)})}},/PERSONAL/],['messages.GetForumTopicsByID',{topics:[{className:'ForumTopic',id:10,closed:true}]},/TOPIC_UNAVAILABLE/],['messages.GetCustomEmojiDocuments',[],/EMOJI_UNAVAILABLE/]]){
  const f=fake(),invoke=f.client.invoke;f.client.invoke=async r=>r.className===method?response:invoke(r);await assert.rejects(run(f),error);assert.equal(f.writes,0);
 }
});
test('unrelated existing own reactions are preserved; partial subset can be completed',async()=>{
 const f=fake();f.own=[new Api.ReactionEmoji({emoticon:'🙏'})];await assert.rejects(run(f),/EXISTING_REACTIONS/);assert.equal(f.writes,0);
 const g=fake();g.own=[new Api.ReactionCustomEmoji({documentId:bigInt(100)})];assert.equal((await run(g)).status,'reacted');assert.equal(g.writes,1);
});
test('uncertain write and readback are never retried or reported successful',async()=>{
 for(const kind of ['write','readback']){const f=fake(),invoke=f.client.invoke;let attempts=0;f.client.invoke=async r=>{
  if(r.className==='messages.SendReaction'){attempts++;if(kind==='write')throw Error('network');}
  if(kind==='readback'&&r.className==='messages.GetMessageReactionsList')return {reactions:[]};return invoke(r);
 };await assert.rejects(run(f),/UNCONFIRMED/);assert.equal(attempts,1);}
});
test('node prevents retry and cross-execution claims without reading credentials into outputs',async()=>{
 const node=new NnaTelegramSender();const values={operation:'reactToTopicPost',...cfg,topicReactionClaimExecutionId:'different'};
 const ctx={getNodeParameter:k=>values[k],getInputData:()=>[{json:{}}],getCredentials:async()=>c,getNode:()=>({retryOnFail:false}),getExecutionId:()=> 'current'};
 await assert.rejects(node.execute.call(ctx),/EXECUTION_MISMATCH/);ctx.getNode=()=>({retryOnFail:true});await assert.rejects(node.execute.call(ctx),/DISABLE_RETRY/);
});
