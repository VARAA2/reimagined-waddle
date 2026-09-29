'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Api } = require('teleproto');
const bigInt = require('big-integer');
const { runOperation } = require('../dist/nodes/NnaTelegramSender/sender');
const {mediaKind,groupPosts}=require('../dist/nodes/NnaTelegramSender/history');
const c = { apiId: 12345, apiHash: 'a'.repeat(32), sessionString: '1' + 'A'.repeat(352), expectedUserId: '1234567890', expectedUsername: 'example_owner', allowedGroupId: '-1001234567890', allowedGroupUsername: 'example_group', allowedTopicIds: '10,20' };
const p = { historyTopicId: 10, startDate: '2026-09-15', endDate: '2026-09-15', offsetId: 0 };
const stamp = s => Date.parse(s) / 1000;
const message = (id, date, patch = {}) => new Api.Message({ id, date: stamp(date), message: 'கேள்வி?', peerId: new Api.PeerChannel({ channelId: bigInt(1234567890) }), fromId: new Api.PeerUser({ userId: bigInt(77) }), replyTo: new Api.MessageReplyHeader({ forumTopic: true, replyToMsgId: 10 }), ...patch });
function fake(pages) {
  const calls = [], state = { destroyed: 0 };
  const client = {
    connect: async () => {}, getMe: async () => new Api.User({ id: bigInt(c.expectedUserId), username: c.expectedUsername }),
    getEntity: async () => new Api.Channel({ id: bigInt(1234567890), megagroup: true, forum: true }),
    getInputEntity: async () => new Api.InputPeerChannel({ channelId: bigInt(1234567890), accessHash: bigInt(1) }),
    invoke: async req => { assert.equal(req.className, 'messages.GetReplies'); assert.ok(req.getBytes().length); calls.push(req); return { messages: pages.shift(), users: [new Api.User({ id: bigInt(77), firstName: 'Example', username: 'example_user' })] }; },
    destroy: async () => { state.destroyed++; },
  };
  return { client, calls, state, deps: { createClient: async () => client } };
}
test('history enforces inclusive IST dates and excludes other dates', async () => {
  const f = fake([[message(24, '2026-09-15T18:30:00Z'), message(23, '2026-09-15T18:29:59Z'), message(22, '2026-09-14T18:30:00Z'), message(21, '2026-09-14T18:29:59Z')]]);
  const r = await runOperation('readTopicHistory', c, p, f.deps);
  assert.deepEqual(r.messages.map(m => m.message_id), [22, 23]); assert.equal(r.complete, true); assert.equal(r.next_offset_id, 0);
  assert.equal(r.messages[0].sender, 'Example'); assert.equal(r.messages[0].message_url, 'https://t.me/example_group/10/22');
  assert.equal(f.calls[0].offsetDate, stamp('2026-09-15T18:30:00Z')); assert.equal(f.state.destroyed, 1);
  assert.ok(!JSON.stringify(r).includes(c.sessionString));
});
test('short pages remain incomplete until boundary or empty page, and paginate without skipping', async () => {
  const f = fake([[message(22, '2026-09-15T10:00:00Z')], [message(21, '2026-09-15T09:00:00Z')], []]);
  const a = await runOperation('readTopicHistory', c, p, f.deps);
  assert.equal(a.complete, false); assert.equal(a.next_offset_id, 22);
  const b = await runOperation('readTopicHistory', c, { ...p, offsetId: a.next_offset_id }, f.deps);
  assert.equal(b.next_offset_id, 21); assert.equal(f.calls[1].offsetDate, 0); assert.equal(f.calls[1].offsetId, 22);
  const d = await runOperation('readTopicHistory', c, { ...p, offsetId: b.next_offset_id }, f.deps);
  assert.equal(d.complete, true); assert.equal(d.count, 0);
});
test('foreign topic and invalid dates/range/cursor fail before opening session', async () => {
  for (const patch of [{ historyTopicId: 99 }, { startDate: '2026-02-30' }, { startDate: '15/09/2026' }, { endDate: '2026-09-14' }, { endDate: '2028-09-15' }, { offsetId: -1 }]) {
    let created = false;
    await assert.rejects(runOperation('readTopicHistory', c, { ...p, ...patch }, { createClient: async () => { created = true; } }), /NNA_HISTORY/);
    assert.equal(created, false);
  }
});
test('history refuses cross-topic/group data and stalled cursors', async () => {
  for (const patch of [{ replyTo: new Api.MessageReplyHeader({ forumTopic: true, replyToMsgId: 20 }) }, { peerId: new Api.PeerChannel({ channelId: bigInt(999) }) }]) {
    const f = fake([[message(22, '2026-09-15T10:00:00Z', patch)]]);
    await assert.rejects(runOperation('readTopicHistory', c, p, f.deps), /NNA_HISTORY_WRONG/); assert.equal(f.state.destroyed, 1);
  }
  const f = fake([[message(22, '2026-09-15T10:00:00Z')]]);
  await assert.rejects(runOperation('readTopicHistory', c, { ...p, offsetId: 22 }, f.deps), /NNA_HISTORY_CURSOR_STALLED/);
});
test('history RPC failures are sanitized and never produce an empty success', async () => {
  const f = fake([]); f.client.invoke = async () => { throw new Error('secret session'); };
  await assert.rejects(runOperation('readTopicHistory', c, p, f.deps), e => /NNA_TELEGRAM_CHECK_FAILED/.test(e.message) && !e.message.includes('secret'));
  assert.equal(f.state.destroyed, 1);
});

test('complete report groups albums across pages and counts posts separately from media',async()=>{
 const album=id=>({groupedId:bigInt('1234567890123456789'),media:{className:'MessageMediaPhoto',photo:{id:bigInt(id)}}});
 const f=fake([[message(24,'2026-09-15T10:00:00Z',album(24))],[message(23,'2026-09-15T10:00:00Z',album(23)),message(22,'2026-09-15T09:00:00Z')],[]]);
 const r=await runOperation('readTopicHistory',c,{...p,historyFullReport:true},f.deps);
 assert.equal(r.complete,true);assert.equal(r.count,3);assert.equal(r.post_count,2);assert.deepEqual(r.post_counts,{text:1,album:1});
 assert.equal(r.posts[1].item_count,2);assert.deepEqual(r.posts[1].media_counts,{photo:2});
 assert.equal(r.posts[1].message_url,'https://t.me/example_group/10/23');assert.equal(r.pages_read,3);
 assert.equal(f.state.destroyed,1);assert.deepEqual(f.calls.map(x=>x.offsetId),[0,24,22]);
});

test('two-day report keeps edited metadata and chronological order across IST midnight',async()=>{
 const f=fake([[message(25,'2026-09-15T18:30:00Z',{editDate:stamp('2026-09-16T10:00:00Z')}),message(24,'2026-09-15T18:29:59Z'),message(1,'2026-09-14T18:29:59Z')]]);
 const r=await runOperation('readTopicHistory',c,{...p,endDate:'2026-09-16',historyFullReport:true},f.deps);
 assert.deepEqual(r.posts.map(x=>x.message_ids[0]),[24,25]);assert.equal(r.posts[1].edited,true);
 assert.equal(r.messages[1].edited_at,'2026-09-16T10:00:00.000Z');assert.equal(r.post_count,2);
});

test('same-time same-sender separate photos are not invented albums',async()=>{
 const f=fake([[message(23,'2026-09-15T10:00:00Z',{media:{className:'MessageMediaPhoto'}}),message(22,'2026-09-15T10:00:00Z',{media:{className:'MessageMediaPhoto'}})],[]]);
 const r=await runOperation('readTopicHistory',c,{...p,historyFullReport:true},f.deps);
 assert.equal(r.post_count,2);assert.deepEqual(r.post_counts,{photo:2});
});

test('document media types come from Telegram attributes and MIME rather than caption guesses',()=>{
 const doc=(attrs=[],mimeType='application/pdf')=>({message:'This is a video',media:{className:'MessageMediaDocument',document:{attributes:attrs,mimeType}}});
 assert.equal(mediaKind(doc()),'document');assert.equal(mediaKind(doc([{className:'DocumentAttributeVideo'}])),'video');
 assert.equal(mediaKind(doc([{className:'DocumentAttributeAudio',voice:true}])),'voice');
 assert.equal(mediaKind(doc([{className:'DocumentAttributeAudio'}])),'audio');
 assert.equal(mediaKind(doc([{className:'DocumentAttributeSticker'}])),'sticker');
 assert.equal(mediaKind(doc([{className:'DocumentAttributeAnimated'},{className:'DocumentAttributeVideo'}])),'animation');
 assert.equal(mediaKind(doc([],'image/png')),'image_document');
 assert.equal(mediaKind({media:{className:'MessageMediaWebPage'}}),'text');
});

test('full report validates flag and first cursor before opening a session',async()=>{
 for(const patch of [{historyFullReport:'true'},{historyFullReport:true,offsetId:20}]){
  let created=false;await assert.rejects(runOperation('readTopicHistory',c,{...p,...patch},{createClient:async()=>{created=true}}),/NNA_HISTORY_REPORT/);assert.equal(created,false);
 }
});

test('album grouping refuses inconsistent senders and keeps mixed photo/video counts',()=>{
 const check=(ok,msg)=>{if(!ok)throw Error(msg)};
 const m={message_id:22,topic_id:10,sender_id:'77',sender:'Example',time:'2026-09-15T10:00:00Z',media_kind:'photo',grouped_id:'88',message_url:'https://t.me/example_group/10/22'};
 const posts=groupPosts([m,{...m,message_id:23,media_kind:'video',edited_at:'2026-09-15T10:01:00Z'}],check);
 assert.deepEqual(posts[0].media_counts,{photo:1,video:1});assert.equal(posts[0].edited,true);
 assert.throws(()=>groupPosts([m,{...m,message_id:24,sender_id:'78'}],check),/ALBUM_CONFLICT/);
});

test('empty complete report is a verified zero; RPC failure never becomes a report',async()=>{
 const f=fake([[]]);const r=await runOperation('readTopicHistory',c,{...p,historyFullReport:true},f.deps);assert.equal(r.post_count,0);assert.equal(r.count,0);
 const g=fake([]);g.client.invoke=async()=>{throw Error('RPC failed')};await assert.rejects(runOperation('readTopicHistory',c,{...p,historyFullReport:true},g.deps),/NNA_TELEGRAM_CHECK_FAILED/);
});

test('legacy paged history keeps the same pagination contract with added metadata',async()=>{
 const f=fake([[message(22,'2026-09-15T10:00:00Z',{groupedId:bigInt('9007199254740993')})]]);
 const r=await runOperation('readTopicHistory',c,p,f.deps);assert.equal(r.complete,false);assert.equal(r.next_offset_id,22);assert.equal(r.post_count,undefined);assert.equal(r.messages[0].grouped_id,'9007199254740993');
});
