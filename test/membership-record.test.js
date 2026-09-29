'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Api}=require('teleproto'),bigInt=require('big-integer');
const {HTMLParser}=require('teleproto/extensions/html');
const record=require('../dist/nodes/NnaTelegramSender/membership-record');
const now=Date.parse('2026-09-25T00:00:00Z');
const c={allowedGroupId:'-10011111',allowedGroupUsername:'sample_group',expectedUserId:'111'};
function parameters(action='joined'){
 const word=action==='joined'?'Joined':'Left',text=`👤 Name: Example\n🔖 Username: -\n🆔 ID: 222\n📍 ${word} by: Example\n📝 Bio: -\n📅 Group ${word} Date: 25/9/2026, 05:30:00 IST`;
 const html=`👤 <b>Name:</b> Example\n🔖 <b>Username:</b> -\n🆔 <b>ID:</b> <code>222</code>\n📍 <b>${word} by:</b> Example\n📝 <b>Bio:</b> -\n📅 <b>Group ${word} Date:</b> 25/9/2026, 05:30:00 IST`;
 return {scope:{sourceGroupId:c.allowedGroupId,targetGroupId:'-10022222',joinedTopicId:4,leftTopicId:6,activatedAt:'2026-09-24T23:00:00Z'},record:{event_key:'admin-member:-10011111:123',action,user_id:'222',person:{id:222,is_bot:false},topic_id:action==='joined'?4:6,happened_at:new Date(now).toISOString(),log_id:1,text,html},claim:{validated:true,logId:1,eventKey:'admin-member:-10011111:123'}};
}
test('membership records enforce source, claimed identity, destination and body',()=>{
 const p=parameters();assert.equal(record.validate(c,p,now).r.topic_id,4);
 assert.equal(record.validate(c,parameters('left'),now).r.topic_id,6);
 for(const change of [x=>x.scope.sourceGroupId='-10033333',x=>x.claim.validated=false,x=>x.claim.logId=2,x=>x.claim.eventKey='other',x=>x.record.topic_id=6,x=>x.record.person.id=333,x=>x.record.person.is_bot=true,x=>x.record.text+='changed',x=>x.record.html+='<script>x</script>',x=>x.record.event_key+=':suffix',x=>x.record.happened_at='2026-09-23T00:00:00Z']){
  const next=structuredClone(p);change(next);assert.throws(()=>record.validate(c,next,now));
 }
});
test('trial records require explicit static scope and visible label',()=>{
 const p=parameters();p.scope.allowTrial=true;p.record.is_test=true;p.record.event_key='format-test-personal:joined:1';p.claim.eventKey=p.record.event_key;
 p.record.user_id='-';p.record.text=p.record.text.replace('ID: 222','ID: -');p.record.html=p.record.html.replace('<code>222</code>','<code>-</code>');
 assert.throws(()=>record.validate(c,p,now),/TRIAL_LABEL/);
 p.record.text='🧪 சோதனைப் பதிவு — உண்மையான உறுப்பினர் நிகழ்வு அல்ல\n\n'+p.record.text;
 p.record.html='🧪 <b>சோதனைப் பதிவு — உண்மையான உறுப்பினர் நிகழ்வு அல்ல</b>\n\n'+p.record.html;
 assert.equal(record.validate(c,p,now).isTrial,true);p.scope.allowTrial=false;assert.throws(()=>record.validate(c,p,now));
});
test('random IDs are stable for one event and differ between accounts and events',()=>{
 assert.equal(record.randomId('1','a').toString(),record.randomId('1','a').toString());
 assert.notEqual(record.randomId('1','a').toString(),record.randomId('1','b').toString());
 assert.notEqual(record.randomId('1','a').toString(),record.randomId('2','a').toString());
});
function mock(p,change=()=>{}){
 let sent,writeCount=0;
 const group=new Api.Channel({id:bigInt(22222),accessHash:bigInt(1),title:'Example',photo:new Api.ChatPhotoEmpty(),date:1,megagroup:true,forum:true});
 const client={getEntity:async()=>group,getInputEntity:async()=>new Api.InputPeerChannel({channelId:group.id,accessHash:group.accessHash}),invoke:async req=>{
  if(req.className==='messages.GetForumTopicsByID')return {topics:[{className:'ForumTopic',id:4,title:'Joined'},{className:'ForumTopic',id:6,title:'Left'}]};
  if(req.className==='messages.SendMessage'){
   writeCount++;assert.equal(req.sendAs.className,'InputPeerSelf');assert.equal(req.replyTo.topMsgId,p.record.topic_id);
   sent={className:'Message',id:100,out:true,fromId:{userId:bigInt(c.expectedUserId)},peerId:new Api.PeerChannel({channelId:group.id}),replyTo:{replyToTopId:p.record.topic_id},message:req.message,entities:req.entities};change(sent);
   return {updates:[{className:'UpdateMessageID',randomId:req.randomId,id:100}]};
  }throw Error('UNEXPECTED_REQUEST');
 },getMessages:async()=>[sent]};return {client,count:()=>writeCount};
}
test('personal send reads back exact sender, text, destination, topic and entities',async()=>{
 const p=parameters(),m=mock(p);const r=await record.run('sendMembershipRecord',m.client,c,p,x=>x,now);
 assert.equal(r.senderId,'111');assert.equal(r.messageId,100);assert.equal(r.topicId,4);assert.equal(r.formatVerified,true);assert.equal(m.count(),1);
});
test('wrong sender, text or topic is uncertain after exactly one write',async()=>{
 for(const change of [m=>m.fromId.userId=bigInt(333),m=>m.message+='wrong',m=>m.replyTo.replyToTopId=6,m=>m.entities=[]]){
  const p=parameters(),m=mock(p,change);await assert.rejects(record.run('sendMembershipRecord',m.client,c,p,x=>x,now),/DELIVERY_UNCONFIRMED/);assert.equal(m.count(),1);
 }
});
test('scope inspection never writes',async()=>{
 const p=parameters(),m=mock(p);const r=await record.run('inspectMembershipRecordScope',m.client,c,{scope:p.scope},x=>x,now);assert.equal(r.verified,true);assert.equal(m.count(),0);
});
test('unresolvable profile mentions preserve text without blocking records',async()=>{
 const [,entities]=HTMLParser.parse('<b>Name:</b> <a href="tg://user?id=222">Example</a>');
 const client={getInputEntity:async()=>{throw Error('MISSING');},getEntity:async()=>{throw Error('MISSING');}};
 const result=await record.mentions(client,c,entities,x=>x);assert.equal(result.length,1);assert.equal(result[0].className,'MessageEntityBold');
});
test('node rejects execution mismatch before invoking Telegram',async()=>{
 const {NnaTelegramSender}=require('../dist/nodes/NnaTelegramSender/NnaTelegramSender.node');const node=new NnaTelegramSender();
 const values={operation:'sendMembershipRecord',membershipRecordScopeJSON:JSON.stringify(parameters().scope),membershipRecordExecutionId:'wrong'};
 const context={getNodeParameter:k=>values[k],getInputData:()=>[{}],getCredentials:async()=>({}),getNode:()=>({retryOnFail:false}),getExecutionId:()=> 'actual'};
 await assert.rejects(node.execute.call(context),/CLAIM_EXECUTION_MISMATCH/);
});
test('self mentions verify against the fixed sender numeric ID',()=>{
 const entity=new Api.InputMessageEntityMentionName({offset:0,length:4,userId:new Api.InputUserSelf()});
 assert.equal(record.entityMatches([{className:'MessageEntityMentionName',offset:0,length:4,userId:bigInt(111)}],entity,'111'),true);
 assert.equal(record.entityMatches([{className:'MessageEntityMentionName',offset:0,length:4,userId:bigInt(222)}],entity,'111'),false);
});
