'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{Api}=require('teleproto'),bigInt=require('big-integer');
const {runOperation}=require('../dist/nodes/NnaTelegramSender/sender');
const {NnaTelegramSender}=require('../dist/nodes/NnaTelegramSender/NnaTelegramSender.node');
const c={apiId:12345,apiHash:'a'.repeat(32),sessionString:'1'+'A'.repeat(352),expectedUserId:'12345',allowedGroupId:'-1001234567',allowedGroupUsername:'example_group',allowedTopicIds:'20'};
const G='-1009876543';
function msg(id,text,entities,extra={}){
 return new Api.Message({id,peerId:new Api.PeerChannel({channelId:bigInt('9876543')}),date:1790000000,message:text,entities,out:true,...extra});
}
function fake(messages){
 const me=new Api.User({id:bigInt(12345),premium:true});
 const ch=n=>new Api.Channel({id:bigInt(String(n).replace(/^-100/,'')),megagroup:true,forum:true,title:'Review',photo:new Api.ChatPhotoEmpty(),date:0});
 return {connect:async()=>{},destroy:async()=>{},getMe:async()=>me,getEntity:async n=>ch(n),getInputEntity:async g=>new Api.InputPeerChannel({channelId:g.id,accessHash:bigInt(1)}),
  getMessages:async(peer,{ids})=>ids.map(i=>messages[i])};
}
const run=(client,p)=>runOperation('readMessageTemplate',c,p,{createClient:async()=>client});
const base={templateGroupId:G,membershipExtraChannelId:G,templateMessageIds:'[337,338,999]'};

test('text, formatting and Premium custom emoji ids are returned in the template format',async()=>{
 const client=fake({
  337:msg(337,'Welcome 🙏 friend\nhttps://example.org/rules',[new Api.MessageEntityBold({offset:0,length:7}),new Api.MessageEntityCustomEmoji({offset:8,length:2,documentId:bigInt('5233436883039559649')}),new Api.MessageEntityUrl({offset:19,length:24}),new Api.MessageEntityMentionName({offset:0,length:3,userId:bigInt(5)})],{replyTo:new Api.MessageReplyHeader({forumTopic:true,replyToTopId:249,replyToMsgId:249})}),
  338:msg(338,'🙏',[new Api.MessageEntityCustomEmoji({offset:0,length:2,documentId:bigInt('5458774648621643551')})],{replyTo:new Api.MessageReplyHeader({forumTopic:true,replyToTopId:249,replyToMsgId:249})})
 });
 const r=await run(client,base);
 assert.equal(r.status,'ok');assert.equal(r.count,3);
 const [a,b,gone]=r.messages;
 assert.equal(a.found,true);assert.equal(a.topicId,249);assert.equal(a.kind,'text');assert.equal(a.text,'Welcome 🙏 friend\nhttps://example.org/rules');
 assert.deepEqual(a.entities.map(e=>[e.type,e.offset,e.length]),[['MessageEntityBold',0,7],['MessageEntityCustomEmoji',8,2],['MessageEntityUrl',19,24]]);
 assert.equal(a.entities[1].documentId,'5233436883039559649');assert.deepEqual(a.customEmojiIds,['5233436883039559649']);assert.deepEqual(a.droppedEntityTypes,['MessageEntityMentionName']);
 assert.deepEqual(b.entities,[{type:'MessageEntityCustomEmoji',offset:0,length:2,documentId:'5458774648621643551'}]);
 assert.equal(gone.found,false);
});
test('a real sticker message is reported as a sticker so it is not mistaken for a text template',async()=>{
 const doc=new Api.Document({id:bigInt(1),accessHash:bigInt(2),fileReference:Buffer.alloc(0),date:0,mimeType:'image/webp',size:bigInt(10),dcId:1,attributes:[new Api.DocumentAttributeSticker({alt:'🙏',stickerset:new Api.InputStickerSetEmpty()})]});
 const client=fake({338:msg(338,'',[],{media:new Api.MessageMediaDocument({document:doc})})});
 const r=await run(client,{...base,templateMessageIds:'[338]'});
 assert.equal(r.messages[0].kind,'sticker');assert.deepEqual(r.messages[0].entities,[]);
});
test('only allowed groups and 1 to 8 numeric ids are accepted, before connecting',async()=>{
 for(const p of [{...base,templateGroupId:'-1005555555',membershipExtraChannelId:''},{...base,templateGroupId:'abc'},{...base,templateMessageIds:'[]'},{...base,templateMessageIds:'[1,2,3,4,5,6,7,8,9]'},{...base,templateMessageIds:'["a"]'},{...base,templateMessageIds:'not json'},{...base,templateMessageIds:'[0]'}]){
  let connected=false;await assert.rejects(runOperation('readMessageTemplate',c,p,{createClient:async()=>{connected=true;return fake({}) ;}}),/NNA_TEMPLATE_/);assert.equal(connected,false);
 }
 const own={templateGroupId:c.allowedGroupId,templateMessageIds:[1]};assert.equal((await runOperation('readMessageTemplate',c,own,{createClient:async()=>fake({1:msg(1,'x',[])})})).status,'ok');
});
test('the node exposes the operation and its parameters',()=>{
 const props=new NnaTelegramSender().description.properties;
 assert.ok(props.find(x=>x.name==='operation').options.some(o=>o.value==='readMessageTemplate'));
 for(const n of ['templateGroupId','templateMessageIds'])assert.ok(props.some(x=>x.name===n),n);
});
