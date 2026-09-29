'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{Api}=require('teleproto'),bigInt=require('big-integer');
const {runOperation}=require('../dist/nodes/NnaTelegramSender/sender');
const {NnaTelegramSender}=require('../dist/nodes/NnaTelegramSender/NnaTelegramSender.node');
const c={apiId:12345,apiHash:'a'.repeat(32),sessionString:'1'+'A'.repeat(352),expectedUserId:'12345',allowedGroupId:'-1001234567',allowedGroupUsername:'example_group',allowedTopicIds:'20'};
const G='-1001234567',TOPIC=40,ROOT=1790000000,NOW=(ROOT+600)*1000,MSG=900,SENDER=555,RECIPIENT=777;
const scope=(over={})=>({groupId:G,topicId:TOPIC,recipientId:String(RECIPIENT),recipientUsername:'recipient_x',activatedAt:new Date((ROOT-3600)*1000).toISOString(),maxAgeMinutes:30,albumWaitMs:0,captionTitle:'Example topic — new image',senderLabel:'From',...over});
const update=(over={})=>({update_id:1,message:{message_id:MSG,message_thread_id:TOPIC,is_topic_message:true,date:ROOT+300,chat:{id:Number(G),type:'supergroup'},from:{id:SENDER,first_name:'A<b>',last_name:'Z',username:'sender_a'},photo:[{file_id:'s'},{file_id:'BIG'}],...over}});
const key=(m=MSG)=>'topic-image-forward:'+G+':'+m+':'+RECIPIENT;
const params=(over={})=>({scope:scope(),update:update(),claimValidated:true,claimRequestKey:key(),...over});
const user=(id,extra={})=>new Api.User({id:bigInt(id),firstName:'N'+id,accessHash:bigInt(1000+id),...extra});
function fake({photo=true,topic=TOPIC,fromId=SENDER,resolveRecipient=true,sendError,readback=true,memberSearch=true,album=0,albumOthers=[]}={}){
 const sent=[],calls=[];const me=new Api.User({id:bigInt(12345)});
 const ch=n=>new Api.Channel({id:bigInt(String(n).replace(/^-100/,'')),megagroup:true,forum:true,title:'G',photo:new Api.ChatPhotoEmpty(),date:0});
 const msg={className:'Message',id:MSG,fromId:fromId?new Api.PeerUser({userId:bigInt(fromId)}):undefined,replyTo:new Api.MessageReplyHeader({forumTopic:true,replyToTopId:topic,replyToMsgId:topic}),
  photo:photo?new Api.Photo({id:bigInt(4242),accessHash:bigInt(77),fileReference:Buffer.from('ref'),date:ROOT,sizes:[],dcId:2}):undefined,
  getSender:async()=>user(SENDER,{firstName:'A<b>',lastName:'Z',username:'sender_a'})};
 const byId=new Map([[MSG,msg]]);
 if(album){msg.groupedId=bigInt(999);msg.date=ROOT+300;for(let i=1;i<album;i++){const m={...msg,id:MSG+i,photo:new Api.Photo({id:bigInt(4242+i),accessHash:bigInt(77),fileReference:Buffer.from('ref'),date:ROOT,sizes:[],dcId:2}),getSender:msg.getSender};byId.set(m.id,m);}}
 for(const o of albumOthers){byId.set(o.id,{...msg,groupedId:bigInt(999),...o});}
 const known=new Map([[String(SENDER),true]]);if(memberSearch)known.set(String(RECIPIENT),false);
 const client={connect:async()=>{},destroy:async()=>{},getMe:async()=>me,getEntity:async n=>ch(n),getInputEntity:async e=>{
   if(e&&e.className==='Channel')return new Api.InputPeerChannel({channelId:e.id,accessHash:bigInt(1)});
   const k=String(e);if(k===String(SENDER)&&known.get(k)===true)return new Api.InputPeerUser({userId:bigInt(SENDER),accessHash:bigInt(1005)});
   if(k===String(RECIPIENT)&&resolveRecipient&&known.get(k)===true)return new Api.InputPeerUser({userId:bigInt(RECIPIENT),accessHash:bigInt(1777)});
   throw Error('unknown '+k);},
  getMessages:async(peer,{ids})=>{calls.push('getMessages');if(peer.className==='InputPeerUser'){const s=sent.find(x=>x.id===ids[0]);return [readback&&s?{className:'Message',id:s.id,out:true,photo:{},message:s.message}:undefined];}return ids.map(i=>byId.get(i));},
  invoke:async r=>{
   calls.push(r.className);
   if(r.className==='channels.GetParticipants'){known.set(String(RECIPIENT),true);return {participants:[]};}
   if(r.className==='contacts.ResolveUsername')return {users:[user(RECIPIENT)]};
   if(r.className==='messages.SendMedia'){
    if(sendError){const e=Error('x');e.errorMessage=sendError;throw e;}
    const id=600+sent.length;sent.push({id,message:r.message,entities:r.entities,peer:r.peer,media:r.media,randomId:r.randomId});
    return {updates:[new Api.UpdateMessageID({id,randomId:r.randomId})]};
   }
   if(r.className==='messages.SendMultiMedia'){
    if(sendError){const e=Error('x');e.errorMessage=sendError;throw e;}
    const ups=r.multiMedia.map((x,i)=>{const id=700+sent.length;sent.push({id,message:x.message,entities:x.entities,peer:r.peer,media:x.media,randomId:x.randomId,multi:true});return new Api.UpdateMessageID({id,randomId:x.randomId});});
    return {updates:ups};
   }
   throw Error('Unexpected RPC '+r.className);
  }};
 return {client,sent,calls};
}
const run=(f,p=params())=>runOperation('sendTopicImageForward',c,p,{createClient:async()=>f.client,now:NOW});

test('a new topic photo is sent as a fresh photo with sender mention and the post link',async()=>{
 const f=fake();const r=await run(f);
 assert.equal(r.status,'sent');assert.equal(r.verified,true);assert.equal(r.recipientId,String(RECIPIENT));assert.equal(r.sourceMessageId,MSG);assert.equal(r.mentionResolved,true);
 const m=f.sent[0];assert.equal(m.peer.className,'InputPeerUser');assert.equal(String(m.peer.userId),String(RECIPIENT));
 assert.equal(m.media.className,'InputMediaPhoto');assert.equal(String(m.media.id.id),'4242');
 assert.match(m.message,/Example topic — new image/);assert.match(m.message,/From: A<b> Z \(@sender_a\) — ID 555/);
 assert.match(m.message,/https:\/\/t\.me\/example_group\/40\/900/);assert.doesNotMatch(m.message,/Group:/);assert.match(m.message,/Post: https:\/\/t\.me\/example_group\/40\/900$/);
 const mention=m.entities.find(e=>e.className==='InputMessageEntityMentionName');assert.ok(mention);assert.equal(String(mention.userId.userId),String(SENDER));
 assert.equal(r.postUrl,'https://t.me/example_group/40/900');
});
test('the recipient is found through a member search when the session does not know them',async()=>{
 const f=fake();await run(f);assert.ok(f.calls.includes('channels.GetParticipants'));
 const g=fake({resolveRecipient:false,memberSearch:false});const r=await run(g);assert.equal(r.status,'sent');assert.ok(g.calls.includes('contacts.ResolveUsername'));
});
test('the same post gives the same random id; another post gives another',async()=>{
 const a=fake(),b=fake();await run(a);await run(b);assert.equal(String(a.sent[0].randomId),String(b.sent[0].randomId));
 const {randomId}=require('../dist/nodes/NnaTelegramSender/topic-image-forward');assert.notEqual(String(randomId('12345',key(901))),String(a.sent[0].randomId));
});
test('the source is proven from Telegram: photo, topic and sender must match',async()=>{
 await assert.rejects(run(fake({photo:false})),/SOURCE_NOT_PHOTO/);
 await assert.rejects(run(fake({topic:7})),/SOURCE_WRONG_TOPIC/);
 await assert.rejects(run(fake({fromId:999})),/SOURCE_SENDER_MISMATCH/);
});
test('claim, scope, freshness and content guards stop before anything is read or sent',async()=>{
 const cases=[params({claimValidated:false}),params({claimRequestKey:key(901)}),params({scope:scope({groupId:'-1005555555'})}),params({scope:scope({recipientId:'12345'})}),params({scope:scope({recipientId:'abc'})}),
  params({scope:scope({activatedAt:'x'})}),params({scope:scope({captionTitle:''})}),params({scope:scope({captionTitle:'<b>x'})}),params({scope:scope({recipientUsername:'a b'})}),
  params({update:update({date:ROOT-7200})}),params({update:update({date:ROOT+90000})}),params({update:update({message_thread_id:1})}),params({update:update({photo:undefined})}),params({update:update({message_id:TOPIC})}),
  params({update:{...update(),edited_message:{}}})];
 for(const p of cases){let connected=false;await assert.rejects(runOperation('sendTopicImageForward',c,p,{createClient:async()=>{connected=true;return fake().client;},now:NOW}),/NNA_TOPICFWD_/);assert.equal(connected,false,JSON.stringify(p).slice(0,120));}
});
test('recipient-side refusals are rejected; unknown failures are unconfirmed and never retried',async()=>{
 for(const code of ['USER_PRIVACY_RESTRICTED','USER_IS_BLOCKED','PEER_FLOOD','FLOOD_WAIT_30','CHAT_FORWARDS_RESTRICTED']){const f=fake({sendError:code});const r=await run(f);assert.equal(r.status,'rejected');assert.equal(f.sent.length,0);}
 await assert.rejects(run(fake({sendError:'SOMETHING_ELSE'})),/NNA_TOPICFWD_DELIVERY_UNCONFIRMED/);
 await assert.rejects(run(fake({resolveRecipient:false,memberSearch:false}),params({scope:scope({recipientUsername:''})})),/RECIPIENT_UNAVAILABLE/);
});
test('a failed readback never turns an accepted message into a failure',async()=>{
 const f=fake({readback:false});const r=await run(f);assert.equal(r.status,'sent');assert.equal(r.verified,false);
});
test('node exposes the operation and its parameters',()=>{
 const props=new NnaTelegramSender().description.properties;
 assert.ok(props.find(x=>x.name==='operation').options.some(o=>o.value==='sendTopicImageForward'));
 for(const n of ['topicFwdScopeJSON','topicFwdUpdateJSON','topicFwdClaimValidated','topicFwdClaimRequestKey','topicFwdClaimExecutionId'])assert.ok(props.some(x=>x.name===n),n);
});

const albumUpdate=(over={})=>update({media_group_id:'999',...over});
const albumKey=()=>'topic-image-forward:'+G+':album:999:'+RECIPIENT;
const albumParams=(over={})=>({scope:scope(),update:albumUpdate(),claimValidated:true,claimRequestKey:albumKey(),...over});
test('an album posted at once is sent to the person as ONE album with a single caption on the first photo',async()=>{
 const f=fake({album:4});const r=await run(f,albumParams());
 assert.equal(r.status,'sent');assert.equal(r.albumCount,4);assert.equal(r.messageIds.length,4);assert.equal(r.messageId,r.messageIds[0]);assert.equal(r.verified,true);
 assert.equal(f.sent.length,4);assert.ok(f.sent.every(x=>x.multi));
 assert.deepEqual(f.sent.map(x=>String(x.media.id.id)),['4242','4243','4244','4245']);
 assert.match(f.sent[0].message,/Post: https:\/\/t\.me\/example_group\/40\/900$/);assert.ok(f.sent[0].entities.some(e=>e.className==='InputMessageEntityMentionName'));
 assert.ok(f.sent.slice(1).every(x=>x.message===''&&x.entities.length===0));
 assert.equal(new Set(f.sent.map(x=>String(x.randomId))).size,4);
 assert.equal(f.calls.filter(x=>x==='messages.SendMultiMedia').length,1);assert.equal(f.calls.filter(x=>x==='messages.SendMedia').length,0);
 assert.equal(r.requestKey,albumKey());
});
test('every member of the album has the same claim key, so only one update sends; the caption always names the oldest photo',async()=>{
 const key1=require('../dist/nodes/NnaTelegramSender/topic-image-forward').eventOf(albumParams(),require('../dist/nodes/NnaTelegramSender/topic-image-forward').scope(c,albumParams()),NOW).requestKey;
 const other=albumParams({update:albumUpdate({message_id:MSG+2})});
 const key2=require('../dist/nodes/NnaTelegramSender/topic-image-forward').eventOf(other,require('../dist/nodes/NnaTelegramSender/topic-image-forward').scope(c,other),NOW).requestKey;
 assert.equal(key1,key2);
 const f=fake({album:3});const r=await run(f,other);assert.equal(r.albumCount,3);assert.match(f.sent[0].message,/\/40\/900$/);
});
test('the album is limited to photos of the same album, topic and sender, oldest first, at most ten',async()=>{
 const others=[{id:MSG+5,groupedId:bigInt(111)},{id:MSG+6,replyTo:new Api.MessageReplyHeader({forumTopic:true,replyToTopId:7,replyToMsgId:7})},{id:MSG+7,fromId:new Api.PeerUser({userId:bigInt(999)})},{id:MSG+8,photo:undefined}];
 const f=fake({album:3,albumOthers:others});const r=await run(f,albumParams());assert.equal(r.albumCount,3);
 const big=fake({album:12});const b=await run(big,albumParams());assert.equal(b.albumCount,10);
 const start=fake({album:12});const c2=albumParams({update:albumUpdate({message_id:MSG+11})});const d=await run(start,c2);assert.ok(d.albumCount>=1&&d.albumCount<=10);
});
test('a message with a media group id but no other photos is sent as a normal single photo; plain photos are unchanged',async()=>{
 const f=fake();const r=await run(f,albumParams());assert.equal(r.status,'sent');assert.equal(r.albumCount,undefined);assert.equal(f.calls.filter(x=>x==='messages.SendMedia').length,1);assert.equal(r.requestKey,albumKey());
 const g=fake();const q=await run(g);assert.equal(q.requestKey,key());assert.equal(q.albumCount,undefined);
});
test('album guards: wrong claim key, bad media group id, bad wait, refusals and unknown failures',async()=>{
 await assert.rejects(run(fake({album:2}),albumParams({claimRequestKey:key()})),/CLAIM_REQUIRED/);
 await assert.rejects(run(fake({album:2}),albumParams({update:albumUpdate({media_group_id:'abc'})})),/EVENT_INVALID/);
 for(const w of [-1,20000,1.5,'4'])await assert.rejects(run(fake({album:2}),albumParams({scope:scope({albumWaitMs:w})})),/SCOPE_INVALID/);
 const r=await run(fake({album:3,sendError:'USER_PRIVACY_RESTRICTED'}),albumParams());assert.equal(r.status,'rejected');
 await assert.rejects(run(fake({album:3,sendError:'SOMETHING_ELSE'}),albumParams()),/NNA_TOPICFWD_DELIVERY_UNCONFIRMED/);
});
test('the operation waits for the rest of the album before reading it',async()=>{
 const t0=Date.now();await run(fake({album:2}),albumParams({scope:scope({albumWaitMs:150})}));assert.ok(Date.now()-t0>=140);
 const t1=Date.now();await run(fake(),params({scope:scope({albumWaitMs:2000})}));assert.ok(Date.now()-t1<1000);
});
