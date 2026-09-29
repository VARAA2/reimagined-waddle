'use strict';
const { Api, utils } = require('teleproto');
const bigInt = require('big-integer');

function historyQuery(c, p, check) {
  const topic = Number(p.historyTopicId);
  check(Number.isSafeInteger(topic) && c.topics.includes(topic), 'NNA_HISTORY_TOPIC_NOT_ALLOWED');
  const parse = value => {
    check(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), 'NNA_HISTORY_DATE_REQUIRED');
    const utc = Date.parse(value + 'T00:00:00Z');
    check(Number.isFinite(utc) && new Date(utc).toISOString().slice(0, 10) === value, 'NNA_HISTORY_INVALID_DATE');
    return utc - 19800000;
  };
  const start = parse(p.startDate), end = parse(p.endDate) + 86400000;
  check(end > start && end - start <= 366 * 86400000, 'NNA_HISTORY_RANGE_MAX_366_DAYS');
  const cursor = Number(p.offsetId || 0);
  check(Number.isSafeInteger(cursor) && cursor >= 0 && cursor <= 2147483647, 'NNA_HISTORY_INVALID_CURSOR');
  check(p.historyFullReport === undefined || typeof p.historyFullReport === 'boolean', 'NNA_HISTORY_REPORT_FLAG');
  check(!p.historyFullReport || cursor === 0, 'NNA_HISTORY_REPORT_START_REQUIRED');
  return { topic, start, end, cursor };
}

function mediaKind(m) {
  const media=m.media, type=media?.className;
  if(!media || type==='MessageMediaEmpty' || type==='MessageMediaWebPage')return 'text';
  if(type==='MessageMediaPhoto')return 'photo';
  if(type==='MessageMediaPoll')return 'poll';
  if(type==='MessageMediaDocument'){
    const attrs=media.document?.attributes||[], has=name=>attrs.find(a=>a.className===name);
    if(has('DocumentAttributeSticker')||has('DocumentAttributeCustomEmoji'))return 'sticker';
    if(has('DocumentAttributeAnimated'))return 'animation';
    const audio=has('DocumentAttributeAudio');if(audio)return audio.voice?'voice':'audio';
    const video=has('DocumentAttributeVideo');if(video)return video.roundMessage?'video_note':'video';
    const mime=String(media.document?.mimeType||'');
    if(mime.startsWith('image/'))return 'image_document';
    if(mime.startsWith('video/'))return 'video';
    if(mime.startsWith('audio/'))return 'audio';
    return 'document';
  }
  return 'other';
}

function groupPosts(messages, check) {
  const grouped=new Map();
  for(const m of messages){
    const key=m.grouped_id?'album:'+m.topic_id+':'+m.grouped_id:'message:'+m.topic_id+':'+m.message_id;
    if(!grouped.has(key))grouped.set(key,[]);
    grouped.get(key).push(m);
  }
  return [...grouped.values()].map(items=>{
    items.sort((a,b)=>Date.parse(a.time)-Date.parse(b.time)||a.message_id-b.message_id);
    const first=items[0];
    check(items.every(x=>x.topic_id===first.topic_id&&x.sender_id===first.sender_id),'NNA_HISTORY_ALBUM_CONFLICT');
    const counts={};for(const m of items)counts[m.media_kind]=(counts[m.media_kind]||0)+1;
    return {post_id:first.grouped_id?'album:'+first.grouped_id:'message:'+first.message_id,topic_id:first.topic_id,
      sender_id:first.sender_id,sender:first.sender,username:first.username,time:first.time,
      edited:items.some(x=>!!x.edited_at),kind:first.grouped_id?'album':first.media_kind,
      item_count:items.length,media_counts:counts,message_ids:items.map(x=>x.message_id),
      message_url:first.message_url,text:items.map(x=>x.text).filter(Boolean).join('\n')};
  }).sort((a,b)=>Date.parse(a.time)-Date.parse(b.time)||a.message_ids[0]-b.message_ids[0]);
}

async function readHistoryPage(client, peer, c, p, q, check, bounded) {
  const result = await bounded(client.invoke(new Api.messages.GetReplies({
    peer, msgId: q.topic, offsetId: q.cursor, offsetDate: q.cursor ? 0 : Math.floor(q.end / 1000),
    addOffset: 0, limit: 100, maxId: 0, minId: 0, hash: bigInt.zero,
  })));
  check(Array.isArray(result.messages), 'NNA_HISTORY_INVALID_RESPONSE');
  const entities = new Map();
  for (const e of [...(result.users || []), ...(result.chats || [])]) {
    const key = utils.getPeerId(e).toString();
    entities.set(key, { name: [e.firstName, e.lastName].filter(Boolean).join(' ') || e.title || e.username || 'Unknown', username: e.username || '' });
  }
  const messages = [], seen = new Set();
  let oldestId = q.cursor || Infinity, boundaryReached = false;
  for (const m of result.messages) {
    if (!Number.isSafeInteger(m.id) || m.id <= 0) continue;
    if (q.cursor && m.id >= q.cursor) continue;
    oldestId = Math.min(oldestId, m.id);
    if (!['Message', 'MessageService'].includes(m.className)) continue;
    check(utils.getPeerId(m.peerId).toString() === c.allowedGroupId, 'NNA_HISTORY_WRONG_GROUP');
    const time = Number(m.date) * 1000;
    check(Number.isFinite(time) && time > 0, 'NNA_HISTORY_INVALID_TIMESTAMP');
    if (time < q.start) { boundaryReached = true; continue; }
    if (time >= q.end || m.className !== 'Message') continue;
    const reply = m.replyTo;
    const topic = reply?.forumTopic === true ? Number(reply.replyToTopId || reply.replyToMsgId || 0) : 0;
    check(topic === q.topic || m.id === q.topic, 'NNA_HISTORY_WRONG_TOPIC');
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    const senderId = m.fromId ? utils.getPeerId(m.fromId).toString() : '';
    const sender = entities.get(senderId) || { name: m.postAuthor || 'Unknown', username: '' };
    messages.push({ message_id: m.id, topic_id: q.topic, sender_id: senderId, sender: sender.name,
      username: sender.username, text: m.message || '', time: new Date(time).toISOString(),
      grouped_id:m.groupedId?String(m.groupedId):'',media_kind:mediaKind(m),
      edited_at:m.editDate?new Date(Number(m.editDate)*1000).toISOString():'',
      reply_to_id: Number(reply?.replyToMsgId || 0), media_type: m.media?.className || '',
      media_content_available: false,
      message_url: 'https://t.me/' + c.allowedGroupUsername + '/' + q.topic + '/' + m.id });
  }
  const complete = result.messages.length === 0 || boundaryReached;
  check(complete || Number.isFinite(oldestId) && (!q.cursor || oldestId < q.cursor), 'NNA_HISTORY_CURSOR_STALLED');
  messages.sort((a, b) => Date.parse(a.time) - Date.parse(b.time) || a.message_id - b.message_id);
  return { status: 'ok', source: 'telegram_personal_account_history', timezone: 'Asia/Kolkata',
    topic_id: q.topic, start_date: p.startDate, end_date_inclusive: p.endDate,
    complete, next_offset_id: complete ? 0 : oldestId, count: messages.length, messages,
    coverage: 'Only history visible to the connected account. Deleted or hidden messages are unavailable. Read next_offset_id pages until complete before claiming full date coverage. Media content is not downloaded by this operation.' };
}

async function readHistory(client, peer, c, p, q, check, bounded) {
  if(!p.historyFullReport)return readHistoryPage(client,peer,c,p,q,check,bounded);
  const messages=new Map();let cursor=0,result;
  for(let page=0;page<20;page++){
    result=await readHistoryPage(client,peer,c,p,{...q,cursor},check,bounded);
    for(const m of result.messages)messages.set(m.topic_id+':'+m.message_id,m);
    if(result.complete){
      const all=[...messages.values()].sort((a,b)=>Date.parse(a.time)-Date.parse(b.time)||a.message_id-b.message_id);
      const posts=groupPosts(all,check),counts={};for(const post of posts)counts[post.kind]=(counts[post.kind]||0)+1;
      return {...result,messages:all,count:all.length,post_count:posts.length,post_counts:counts,posts,
        count_unit:'posts; each Telegram media group is one album post',pages_read:page+1};
    }
    cursor=result.next_offset_id;
    if(page<19)await new Promise(resolve=>setTimeout(resolve,500));
  }
  check(false,'NNA_HISTORY_REPORT_TOO_LARGE');
}
module.exports = { historyQuery, readHistory, mediaKind, groupPosts };
