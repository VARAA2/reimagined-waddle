'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{Api}=require('teleproto'),bigInt=require('big-integer');
const {runOperation}=require('../dist/nodes/NnaTelegramSender/sender');
const {NnaTelegramSender}=require('../dist/nodes/NnaTelegramSender/NnaTelegramSender.node');
const {randomId}=require('../dist/nodes/NnaTelegramSender/reply-notice');
const c={apiId:12345,apiHash:'a'.repeat(32),sessionString:'1'+'A'.repeat(352),expectedUserId:'12345',allowedGroupId:'-1001234567',allowedGroupUsername:'example_group',allowedTopicIds:'20'};
const G='-1001234567',TOPIC=40,ROOT=1790000000,NOW=(ROOT+600)*1000,OP=111,OP2=222,MEMBER=777;
const scope=(over={})=>({groupId:G,activatedAt:new Date((ROOT-3600)*1000).toISOString(),maxAgeMinutes:2880,operators:{[OP]:'@op_one',[OP2]:'Op Two'},...over});
const notice=(over={})=>({recipientId:String(MEMBER),recipientUsername:'member_x',recipientName:'Kumar <b> Soul',items:[{replyMessageId:900,repliedToMessageId:800}],...over});
const key=(first=900)=>'reply-notice:'+G+':'+MEMBER+':'+first;
const params=(over={})=>({scope:scope(),notice:notice(),claimValidated:true,claimRequestKey:key(),...over});
const reply=(mid,to,from=OP,extra={})=>({className:'Message',id:mid,date:ROOT+300,fromId:new Api.PeerUser({userId:bigInt(from)}),replyTo:new Api.MessageReplyHeader({forumTopic:true,replyToTopId:TOPIC,replyToMsgId:to}),...extra});
const post=(mid,from=MEMBER)=>({className:'Message',id:mid,date:ROOT+200,fromId:new Api.PeerUser({userId:bigInt(from)})});
const user=(id,extra={})=>new Api.User({id:bigInt(id),firstName:'N'+id,accessHash:bigInt(1000+id),...extra});
function fake({messages=[reply(900,800),post(800)],resolveRecipient=true,sendError,readback=true}={}){
 const sent=[],calls=[];const me=new Api.User({id:bigInt(12345)});
 const ch=n=>new Api.Channel({id:bigInt(String(n).replace(/^-100/,'')),megagroup:true,forum:true,title:'G',photo:new Api.ChatPhotoEmpty(),date:0});
 const byId=new Map(messages.map(m=>[m.id,m]));
 const client={connect:async()=>{},destroy:async()=>{},getMe:async()=>me,getEntity:async n=>ch(n),getInputEntity:async e=>{
   if(e&&e.className==='Channel')return new Api.InputPeerChannel({channelId:e.id,accessHash:bigInt(1)});
   if(String(e)===String(MEMBER)&&resolveRecipient)return new Api.InputPeerUser({userId:bigInt(MEMBER),accessHash:bigInt(1777)});
   throw Error('unknown '+e);},
  getMessages:async(peer,{ids})=>{calls.push('getMessages');if(peer.className==='InputPeerUser'){const s=sent.find(x=>x.id===ids[0]);return [readback&&s?{className:'Message',id:s.id,out:true,message:s.message}:undefined];}return ids.map(i=>byId.get(i));},
  invoke:async r=>{
   calls.push(r.className);
   if(r.className==='channels.GetParticipants')return {participants:[]};
   if(r.className==='contacts.ResolveUsername')return {users:[user(MEMBER)]};
   if(r.className==='messages.SendMessage'){
    if(sendError){const e=Error('x');e.errorMessage=sendError;throw e;}
    const id=600+sent.length;sent.push({id,...r});sent[sent.length-1].id=id;
    return {updates:[new Api.UpdateMessageID({id,randomId:r.randomId})]};
   }
   throw Error('Unexpected RPC '+r.className);
  }};
 return {client,sent,calls};
}
const run=(f,p=params())=>runOperation('sendReplyNotice',c,p,{createClient:async()=>f.client,now:NOW});

test('one reply: a private notice names the account and gives the reply URL',async()=>{
 const f=fake();const r=await run(f);
 assert.equal(r.status,'sent');assert.equal(r.verified,true);assert.equal(r.recipientId,String(MEMBER));assert.deepEqual(r.urls,['https://t.me/example_group/40/900']);assert.deepEqual(r.accounts,['@op_one']);
 const m=f.sent[0];assert.equal(m.peer.className,'InputPeerUser');assert.equal(String(m.peer.userId),String(MEMBER));assert.equal(m.noWebpage,true);
 assert.match(m.message,/^Dear Kumar <b> Soul 🤍\n/);assert.doesNotMatch(m.message,/Soul Soul/);
 assert.match(m.message,/Account : @op_one/);assert.match(m.message,/👇\n\n🔗 https:\/\/t\.me\/example_group\/40\/900\n\n#NNA_BOT🤖$/);
 assert.ok(m.entities.some(e=>e.className==='MessageEntityBold'));
});
test('several replies from several accounts are listed in one notice, each URL under its account',async()=>{
 const f=fake({messages:[reply(900,800),post(800),reply(905,801,OP2),post(801)]});
 const p=params({notice:notice({items:[{replyMessageId:905,repliedToMessageId:801},{replyMessageId:900,repliedToMessageId:800}]})});
 const r=await run(f,p);
 assert.equal(r.status,'sent');assert.deepEqual(r.accounts,['@op_one','Op Two']);assert.equal(f.sent.length,1);
 const t=f.sent[0].message;assert.match(t,/Accounts : @op_one, Op Two/);assert.match(t,/👤 @op_one 👇\n🔗 https:\/\/t\.me\/example_group\/40\/900/);assert.match(t,/👤 Op Two 👇\n🔗 https:\/\/t\.me\/example_group\/40\/905/);
});
test('a reply in the General topic gets a URL without a topic number',async()=>{
 const f=fake({messages:[{...reply(900,800),replyTo:new Api.MessageReplyHeader({replyToMsgId:800})},post(800)]});
 const r=await run(f);assert.deepEqual(r.urls,['https://t.me/example_group/900']);
});
test('replies Telegram no longer confirms are left out, and nothing is sent when none remains',async()=>{
 for(const messages of [
  [post(800)],                                  // reply deleted
  [reply(900,800)],                             // target deleted
  [reply(900,800,999),post(800)],               // not an operator
  [reply(900,800),post(800,555)],               // someone else's message
  [reply(900,799),post(800)],                   // replies to another message
  [reply(900,800,OP,{date:ROOT-90000}),post(800)] // too old
 ]){const f=fake({messages});const r=await run(f);assert.equal(r.status,'skipped');assert.equal(r.code,'NO_PROVEN_REPLY');assert.equal(f.sent.length,0);}
 const f=fake({messages:[reply(900,800),post(800),reply(905,801,999),post(801)]});
 const r=await run(f,params({notice:notice({items:[{replyMessageId:900,repliedToMessageId:800},{replyMessageId:905,repliedToMessageId:801}]})}));
 assert.deepEqual(r.urls,['https://t.me/example_group/40/900']);assert.doesNotMatch(f.sent[0].message,/905/);
});
test('the recipient is found through their username when the session does not know them',async()=>{
 const f=fake({resolveRecipient:false});const r=await run(f);assert.equal(r.status,'sent');assert.ok(f.calls.includes('contacts.ResolveUsername'));
 await assert.rejects(run(fake({resolveRecipient:false}),params({notice:notice({recipientUsername:''}),})),/NNA_REPLYNOTICE_RECIPIENT_UNAVAILABLE/);
});
test('refusals and limits come back as rejected; other send errors stay unconfirmed',async()=>{
 for(const [err,code] of [['USER_PRIVACY_RESTRICTED','USER_PRIVACY_RESTRICTED'],['USER_IS_BLOCKED','USER_IS_BLOCKED'],['PEER_FLOOD','PEER_FLOOD'],['FLOOD_WAIT_120','FLOOD_WAIT']]){
  const r=await run(fake({sendError:err}));assert.equal(r.status,'rejected');assert.equal(r.code,code);
 }
 await assert.rejects(run(fake({sendError:'RANDOM_ERROR'})),/NNA_REPLYNOTICE_DELIVERY_UNCONFIRMED/);
});
test('a sent notice stays sent when reading it back fails',async()=>{
 const r=await run(fake({readback:false}));assert.equal(r.status,'sent');assert.equal(r.verified,false);
});
test('nothing connects without a valid scope, notice and claim',async()=>{
 const cases=[
  params({claimValidated:false}),params({claimRequestKey:key(901)}),
  params({scope:scope({groupId:'-1009999'})}),params({scope:scope({operators:{}})}),params({scope:scope({operators:{abc:'x'}})}),params({scope:scope({activatedAt:'x'})}),
  params({notice:notice({recipientId:String(OP)})}),params({notice:notice({recipientId:'x'})}),params({notice:notice({recipientName:'  '})}),params({notice:notice({recipientUsername:'a b'})}),
  params({notice:notice({items:[]})}),params({notice:notice({items:Array.from({length:6},(_,i)=>({replyMessageId:900+i,repliedToMessageId:800}))})}),
  params({notice:notice({items:[{replyMessageId:800,repliedToMessageId:900}]})})
 ];
 for(const p of cases){let connected=false;await assert.rejects(runOperation('sendReplyNotice',c,p,{createClient:async()=>{connected=true;return fake().client;},now:NOW}),/NNA_REPLYNOTICE_/);assert.equal(connected,false,JSON.stringify(p).slice(0,160));}
});
test('the same notice always uses the same random id, another notice a different one',async()=>{
 const a=fake(),b=fake();await run(a);await run(b);assert.equal(String(a.sent[0].randomId),String(b.sent[0].randomId));
 assert.equal(String(a.sent[0].randomId),String(randomId('12345',key())));assert.notEqual(String(randomId('12345',key(901))),String(a.sent[0].randomId));
});
test('the node offers the operation with its fields',()=>{
 const props=new NnaTelegramSender().description.properties;
 assert.ok(props.find(x=>x.name==='operation').options.some(o=>o.value==='sendReplyNotice'));
 for(const n of ['replyNoticeScopeJSON','replyNoticeJSON','replyNoticeClaimValidated','replyNoticeClaimRequestKey','replyNoticeClaimExecutionId'])assert.ok(props.find(x=>x.name===n),n);
});
