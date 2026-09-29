'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseDirectRequest,sendDirect}=require('../dist/nodes/NnaTelegramSender/direct');
const {runOperation}=require('../dist/nodes/NnaTelegramSender/sender');
const {Api}=require('teleproto'),bigInt=require('big-integer');
const now=Date.parse('2026-09-24T00:00:00Z');
const cfg={allowedOperatorIds:'12345,67890',reviewChatId:'-1001234567',botId:'88888'};
const event=text=>({update_id:7,message:{message_id:8,date:now/1000,from:{id:67890,is_bot:false},chat:{id:67890,type:'private'},text}});
const credentials={apiId:12345,apiHash:'a'.repeat(32),sessionString:'1'+'A'.repeat(352),expectedUserId:'12345',allowedGroupId:'-1001234567',allowedGroupUsername:'example_group',allowedTopicIds:'10,20'};
const URL='https://t.me/example_group/10/30';
const author=new Api.User({id:bigInt(555),firstName:'Anbu',lastName:'Selvan',accessHash:bigInt(9)});
const other=(over={})=>new Api.User({id:bigInt(777),firstName:'Vara',accessHash:bigInt(1777),...over});
function params(text){const update=event(text);const e=parseDirectRequest(update,cfg,now);return {...cfg,update,claimValidated:true,claimRequestKey:e.requestKey,claimOperatorId:e.operatorId,claimBody:e.body,claimUrl:e.targetUrl};}
function client({fromId=new Api.PeerUser({userId:bigInt(555)}),sender=author,members=[other()],pageSize=200,cache=false,dropEntities=false}={}){
 const sent=[],calls=[];const peerId=new Api.PeerChannel({channelId:bigInt(1234567)});
 const source=new Api.Message({id:30,peerId,fromId,message:'Question',replyTo:new Api.MessageReplyHeader({forumTopic:true,replyToTopId:10,replyToMsgId:10})});
 source.getSender=async()=>sender;
 return {sent,calls,connect:async()=>{},destroy:async()=>{},getMe:async()=>new Api.User({id:bigInt(12345)}),
  getEntity:async e=>{if(e&&e.className==='Channel')return e;if(typeof e==='string')return new Api.Channel({id:bigInt(1234567),username:'example_group',megagroup:true,forum:true});
   if(cache&&String(e)==='777')return other();throw Error('unknown');},
  getInputEntity:async()=>new Api.InputPeerChannel({channelId:bigInt(1234567),accessHash:bigInt(1)}),getMessages:async()=>[source],
  invoke:async r=>{calls.push(r.className);
   if(r.className==='channels.GetParticipants'){const page=members.slice(r.offset,r.offset+r.limit);return {participants:page.map(u=>({userId:u.id})),users:page};}
   assert.equal(r.className,'messages.SendMessage');assert.equal(r.sendAs.className,'InputPeerSelf');assert.equal(r.replyTo.replyToMsgId,30);
   sent.push({message:r.message,entities:r.entities});
   const echoed=dropEntities?[]:r.entities.map(e=>new Api.MessageEntityMentionName({offset:e.offset,length:e.length,userId:e.userId.userId}));
   return {updates:[{className:'UpdateMessageID',randomId:r.randomId,id:40},{message:new Api.Message({id:40,out:true,fromId:new Api.PeerUser({userId:bigInt(12345)}),peerId,message:r.message,entities:echoed,replyTo:new Api.MessageReplyHeader({forumTopic:true,replyToMsgId:30,replyToTopId:10})})}]};}};
}
const run=(text,c)=>runOperation('sendDirectReply',credentials,params(text),{now,createClient:async()=>c});

test('parse: ID lines are removed from the body and counted against the @ places',()=>{
 const e=parseDirectRequest(event(URL+'\nID:777\nவணக்கம் @ ஐயா'),cfg,now);
 assert.equal(e.kind,'direct');assert.equal(e.body,'வணக்கம் @ ஐயா');assert.deepEqual(e.mentionIds,['777']);
 assert.deepEqual(parseDirectRequest(event('ID : 777\nHi @ there\n'+URL),cfg,now).mentionIds,['777']);
 assert.deepEqual(parseDirectRequest(event(URL+'\nID::777\nid：888\n@ and @'),cfg,now).mentionIds,['777','888']);
 assert.deepEqual(parseDirectRequest(event(URL+'\nHi @ there'),cfg,now).mentionIds,[]);
});
test('parse: only a lone @ is a place; @username, e-mail and @@ stay literal',()=>{
 for(const t of ['Thanks @nna_user','write a@b.com','@@','a@']) assert.equal(parseDirectRequest(event(URL+'\n'+t),cfg,now).kind,'direct');
 const e=parseDirectRequest(event(URL+'\nHi @ and @nna_user'),cfg,now);assert.equal(e.body,'Hi @ and @nna_user');
 assert.equal(require('../dist/nodes/NnaTelegramSender/direct').slotsOf(e.body).length,1);
});
test('parse: ID without @, count mismatch and too many places are invalid before anything is sent',()=>{
 assert.equal(parseDirectRequest(event(URL+'\nID:777\nno place here'),cfg,now).kind,'direct');
 assert.equal(parseDirectRequest(event(URL+'\nID:777\nID:888\nonly @ one'),cfg,now).error,'NNA_MENTION_COUNT_MISMATCH');
 assert.equal(parseDirectRequest(event(URL+'\nID:777\n@ and @'),cfg,now).error,'NNA_MENTION_COUNT_MISMATCH');
 assert.equal(parseDirectRequest(event(URL+'\n'+'@ '.repeat(11)),cfg,now).error,'NNA_MENTION_TOO_MANY');
 assert.equal(parseDirectRequest(event(URL+'\nID:12'),cfg,now).kind,'invalid');
});
test('without ID the @ becomes a real mention of the author of the replied-to post',async()=>{
 const c=client();const r=await run(URL+'\nவணக்கம் @ ஐயா, நன்றி',c);
 assert.equal(r.status,'sent');assert.deepEqual(r.mentioned,['555']);
 assert.equal(c.sent[0].message,'வணக்கம் Anbu Selvan, நன்றி');
 const m=c.sent[0].entities[0];assert.equal(m.className,'InputMessageEntityMentionName');assert.equal(m.offset,'வணக்கம் '.length);assert.equal(m.length,'Anbu Selvan'.length);
 assert.equal(m.userId.className,'InputUserFromMessage');assert.equal(String(m.userId.userId),'555');
 assert.equal(c.calls.filter(x=>x==='channels.GetParticipants').length,0);
});
test('offsets stay correct after emoji and for several places',async()=>{
 const c=client();await run(URL+'\n🙏 @ and 🌸 @ end',c);
 assert.equal(c.sent[0].message,'🙏 Anbu Selvan 🌸 Anbu Selvan');
 for(const e of c.sent[0].entities)assert.equal(c.sent[0].message.slice(e.offset,e.offset+e.length),'Anbu Selvan');
});
test('with an ID line the person is found in the group and mentioned next to the @',async()=>{
 const c=client();const r=await run(URL+'\nID:777\nநன்றி @ 🙏',c);
 assert.equal(r.status,'sent');assert.deepEqual(r.mentioned,['777']);assert.equal(c.sent[0].message,'நன்றி Vara 🙏');
 const m=c.sent[0].entities[0];assert.equal(m.userId.className,'InputUser');assert.equal(String(m.userId.userId),'777');assert.equal(String(m.userId.accessHash),'1777');
});
test('member search pages through large groups; a session that already knows the person needs no paging',async()=>{
 const many=Array.from({length:450},(_,i)=>new Api.User({id:bigInt(10000+i),firstName:'U'+i,accessHash:bigInt(1)}));
 const c=client({members:[...many,other()]});await run(URL+'\nID:777\nHi @',c);assert.equal(c.calls.filter(x=>x==='channels.GetParticipants').length,3);
 const d=client({cache:true});await run(URL+'\nID:777\nHi @',d);assert.equal(d.calls.filter(x=>x==='channels.GetParticipants').length,0);
});
test('unknown ID, deleted person, or a post without a user stops before sending',async()=>{
 const a=client({members:[]});await assert.rejects(run(URL+'\nID:777\nHi @',a),/NNA_MENTION_USER_NOT_FOUND/);assert.equal(a.sent.length,0);
 const b=client({members:[other({deleted:true})]});await assert.rejects(run(URL+'\nID:777\nHi @',b),/NNA_MENTION_USER_NOT_FOUND/);assert.equal(b.sent.length,0);
 const c=client({members:[other({min:true})]});await assert.rejects(run(URL+'\nID:777\nHi @',c),/NNA_MENTION_USER_NOT_FOUND/);assert.equal(c.sent.length,0);
 const d=client({fromId:new Api.PeerChannel({channelId:bigInt(5)})});await assert.rejects(run(URL+'\nHi @',d),/NNA_MENTION_TARGET_HAS_NO_USER/);assert.equal(d.sent.length,0);
 const e=client({sender:new Api.User({id:bigInt(555),deleted:true})});await assert.rejects(run(URL+'\nHi @',e),/NNA_MENTION_TARGET_HAS_NO_USER/);assert.equal(e.sent.length,0);
});
test('plain replies without @ are byte-for-byte as before; a mention Telegram did not keep is reported as unconfirmed',async()=>{
 const c=client();const r=await run(URL+'\nLiteral reply 🤍 @nna_user',c);assert.equal(r.status,'sent');assert.deepEqual(r.mentioned,[]);assert.equal(c.sent[0].message,'Literal reply 🤍 @nna_user');assert.deepEqual(c.sent[0].entities,[]);
 const d=client({dropEntities:true});await assert.rejects(run(URL+'\nHi @',d),/NNA_DELIVERY_UNCONFIRMED/);assert.equal(d.sent.length,1);
});
test('claim body is the text with the ID lines removed, so tampering is still caught',async()=>{
 const p=params(URL+'\nID:777\nHi @');assert.equal(p.claimBody,'Hi @');
 let opened=false;await assert.rejects(runOperation('sendDirectReply',credentials,{...p,claimBody:'Hi @\nID:777'},{now,createClient:async()=>{opened=true;return client();}}),/CLAIM/);assert.equal(opened,false);
});
test('the ID line may stand before the link, after it, or on the other side of the text',()=>{
 for(const t of ['ID:777\n'+URL+'\nHi @','\n'+URL+'\n\nID:777\nHi @','Hi @\nID:777\n'+URL,'Hi @\n'+URL+'\nID:777']){
  const e=parseDirectRequest(event(t),cfg,now);assert.equal(e.kind,'direct',t);assert.equal(e.body,'Hi @');assert.deepEqual(e.mentionIds,['777']);assert.equal(e.targetUrl,URL);
 }
});

test('the one word after "@ " is a dummy and is replaced too; punctuation, emoji and a second word stay',async()=>{
 const c=client();await run(URL+'\nவணக்கம் @ ஐயா, நன்றி. @ 🙏 வாழ்க @ name!\n@ x வாழ்த்துகள்',c);
 assert.equal(c.sent[0].message,'வணக்கம் Anbu Selvan, நன்றி. Anbu Selvan 🙏 வாழ்க Anbu Selvan!\nAnbu Selvan வாழ்த்துகள்');
 assert.equal(c.sent[0].entities.length,4);
 for(const e of c.sent[0].entities)assert.equal(c.sent[0].message.slice(e.offset,e.offset+e.length),'Anbu Selvan');
 const {slotsOf}=require('../dist/nodes/NnaTelegramSender/direct');
 assert.deepEqual(slotsOf('a @ ஐயா, b @ c @').map(m=>m[0]),['@ ஐயா','@ c','@']);
 assert.deepEqual(slotsOf('mail a@b.com and @user and @@ and x@ y').map(m=>m[0]),[]);
 assert.equal(slotsOf('@\nword').map(m=>m[0])[0],'@');
});
test('the dummy word works with an ID line too, and counts still match',async()=>{
 const c=client();await run(URL+'\nID:777\nநன்றி @ ஐயா 🙏',c);
 assert.equal(c.sent[0].message,'நன்றி Vara 🙏');
 assert.equal(parseDirectRequest(event(URL+'\nID:777\nID:888\n@ a @ b'),cfg,now).kind,'direct');
 assert.equal(parseDirectRequest(event(URL+'\nID:777\n@ a @ b'),cfg,now).error,'NNA_MENTION_COUNT_MISMATCH');
});
test('ID line without any @: the person is mentioned at the start of the reply',async()=>{
 const c=client();const r=await run(URL+'\nID: 777 \n\nvannakam',c);
 assert.equal(r.status,'sent');assert.deepEqual(r.mentioned,['777']);assert.equal(c.sent[0].message,'Vara vannakam');
 const m=c.sent[0].entities[0];assert.equal(m.offset,0);assert.equal(m.length,4);assert.equal(String(m.userId.userId),'777');
 const d=client({members:[other(),new Api.User({id:bigInt(888),firstName:'Sri',accessHash:bigInt(5)})]});await run(URL+'\nID:777\nID:888\nநன்றி 🙏',d);
 assert.equal(d.sent[0].message,'Vara Sri நன்றி 🙏');assert.equal(d.sent[0].entities.length,2);assert.equal(d.sent[0].entities[1].offset,5);
 const e=client({members:[]});await assert.rejects(run(URL+'\nID:777\nvannakam',e),/NNA_MENTION_USER_NOT_FOUND/);assert.equal(e.sent.length,0);
 assert.equal(parseDirectRequest(event(URL+'\n'+Array.from({length:11},(_,i)=>'ID:'+(1000+i)).join('\n')+'\nhi'),cfg,now).error,'NNA_MENTION_TOO_MANY');
 assert.equal(parseDirectRequest(event(URL+'\nID:777\nID:888\n@ only one'),cfg,now).error,'NNA_MENTION_COUNT_MISMATCH');
});
