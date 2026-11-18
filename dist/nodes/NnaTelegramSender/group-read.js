'use strict';
const bigInt=require('big-integer');
const {Api,utils}=require('teleproto');
// READ-ONLY view of the groups / channels the personal account is in (Claude, 14 Nov 2026), for the owner's Grok tool.
// mode "groups": list; "topics": forum topics of one group; "history": messages of one group (optional topic, optional search text).
// Only GetDialogs / GetForumTopics / GetHistory / GetReplies / Search are used: never sends, never marks anything as read, never joins.
const id=v=>v==null?'':String(v);
const check=(ok,code)=>{if(!ok)throw Error('NNA_GROUPREAD_'+code);};
const cut=(s,n)=>{s=String(s||'');return s.length>n?s.slice(0,n)+'…':s;};
const iso=d=>new Date((Number(d)||0)*1000).toISOString();
function request(p){
 const r=p.groupRead;
 check(r&&typeof r==='object','REQUEST_INVALID');
 const mode=String(r.mode||'groups');
 check(['groups','topics','history','message'].includes(mode),'MODE_INVALID');
 const max={groups:200,topics:100,history:100,message:1}[mode];
 const limit=Number(r.limit||{groups:50,topics:50,history:30,message:1}[mode]);
 check(Number.isInteger(limit)&&limit>=1&&limit<=max,'LIMIT_INVALID');
 const out={mode,limit};
 if(mode!=='groups'){
  const g=id(r.group).trim();
  check(/^-100[1-9]\d{0,12}$/.test(g)||/^-[1-9]\d{0,12}$/.test(g)||/^@?[A-Za-z][A-Za-z0-9_]{3,31}$/.test(g),'GROUP_INVALID');
  out.group=g;
 }
 if(mode==='history'){
  const t=Number(r.topic||0),off=Number(r.offsetId||0);
  check(Number.isSafeInteger(t)&&t>=0,'TOPIC_INVALID');check(Number.isSafeInteger(off)&&off>=0,'OFFSET_INVALID');
  const q=String(r.query||'').trim();check(q.length<=100,'QUERY_INVALID');
  Object.assign(out,{topic:t,offsetId:off,query:q});
 }
 if(mode==='message'){const mid=Number(r.messageId||0);check(Number.isSafeInteger(mid)&&mid>0,'MESSAGE_ID_INVALID');out.messageId=mid;}
 if(mode==='groups')out.unreadOnly=r.unreadOnly===true;
 return out;
}
const isGroupish=e=>e&&((e.className==='Channel'&&!e.left)||(e.className==='Chat'&&!e.left&&!e.deactivated&&!e.migratedTo));
const peerId=e=>id(utils.getPeerId(e));
function linkOf(e,msgId,topic){
 if(e.className!=='Channel')return '';
 const t=e.forum&&topic>1?topic+'/':'';
 return e.username?'https://t.me/'+e.username+'/'+t+msgId:'https://t.me/c/'+id(e.id)+'/'+t+msgId;
}
function mediaOf(m){
 const x=m?.media;if(!x)return '';const k=x.className||'';
 if(k==='MessageMediaPhoto')return 'photo';
 if(k==='MessageMediaDocument'){const a=x.document?.attributes||[];const au=a.find(y=>y.className==='DocumentAttributeAudio');
  if(au)return au.voice?'voice':'audio';if(a.some(y=>y.className==='DocumentAttributeVideo'))return 'video';if(a.some(y=>y.className==='DocumentAttributeSticker'))return 'sticker';return 'file';}
 if(k==='MessageMediaWebPage')return '';return k.replace(/^MessageMedia/,'').toLowerCase()||'media';
}
async function groupOf(client,g,bounded){
 let e=null;
 if(/^-/.test(g)){
  try{e=await bounded(client.getEntity(bigInt(g)));}catch{e=null;}
  if(!e)e=((await bounded(client.getDialogs({limit:500})))||[]).map(x=>x.entity).find(x=>isGroupish(x)&&peerId(x)===g)||null;
 }else{try{e=await bounded(client.getEntity(g.replace(/^@/,'')));}catch{e=null;}}
 check(isGroupish(e),'GROUP_UNAVAILABLE');
 return e;
}
// Custom (animated) emoji in the text: id = Telegram document id (use as <tg-emoji emoji-id="ID">CHAR</tg-emoji>); sticker = the message is a sticker.
function emojisOf(m){
 const t=String(m.message||'');
 const list=(m.entities||[]).filter(x=>x.className==='MessageEntityCustomEmoji').map(x=>({id:id(x.documentId),char:t.substr(x.offset,x.length)}));
 const seen=new Set();const uniq=list.filter(x=>!seen.has(x.id)&&seen.add(x.id));
 const doc=m.media?.className==='MessageMediaDocument'?m.media.document:null;
 const st=doc?(doc.attributes||[]).find(a=>a.className==='DocumentAttributeSticker'||a.className==='DocumentAttributeCustomEmoji'):null;
 return {customEmojis:uniq,sticker:st?{id:id(doc.id),alt:st.alt||'',animated:/tgsticker|webm/.test(String(doc.mimeType||''))}:null};
}
// Rich messages (cards, rich posts) have message '' and the content in richMessage.blocks: return their plain text too (15 Nov 2026).
const RICH_BLOCK_KEYS=['blocks','items','rows','cells'];
function richPlain(x,depth=0){
 if(x==null||depth>40)return '';
 if(typeof x==='string')return x;
 if(typeof x==='number'||typeof x==='boolean')return '';
 if(Array.isArray(x))return x.map(v=>richPlain(v,depth+1)).join('');
 if(typeof x!=='object')return '';
 if(/CustomEmoji/i.test(String(x.className||x.type||''))&&typeof x.alt==='string')return x.alt;
 if(typeof x.alternativeText==='string'&&/emoji/i.test(String(x.className||'')))return x.alternativeText;
 let out='';
 for(const k of ['title','summary','text','texts','caption']){if(x[k]!=null&&typeof x[k]!=='function')out+=richPlain(x[k],depth+1);}
 for(const k of RICH_BLOCK_KEYS){if(Array.isArray(x[k])){const parts=x[k].map(v=>richPlain(v,depth+1)).filter(Boolean);if(parts.length)out+=(out?'\n':'')+parts.join(k==='cells'?' | ':'\n');}}
 return out;
}
let RM=null;try{RM=require('teleproto/richMessage');}catch{}
function textOf(m){const t=String(m.message||'');if(t||!m.richMessage)return t;let r='';
 try{if(RM&&RM.toPlainText)r=String(RM.toPlainText(m.richMessage)||'');}catch{}
 if(!r.trim())r=richPlain(m.richMessage.blocks||m.richMessage);return r.replace(/\n{3,}/g,'\n\n').trim();}
async function run(operation,client,c,p,bounded){
 check(operation==='readGroupChats','OPERATION');
 const q=request(p);
 if(q.mode==='groups'){
  const ds=await bounded(client.getDialogs({limit:500}));
  const list=[];
  for(const d of ds||[]){
   const e=d.entity;if(!isGroupish(e))continue;
   if(q.unreadOnly&&!(d.unreadCount>0))continue;
   list.push({groupId:peerId(e),title:e.title||'',username:e.username||'',type:e.className==='Chat'?'group':e.megagroup?(e.forum?'forum_group':'group'):'channel',
    unreadCount:d.unreadCount||0,lastMessage:d.message?{id:d.message.id,date:iso(d.message.date),text:cut(textOf(d.message),200)}:null});
   if(list.length>=q.limit)break;
  }
  return {status:'ok',mode:'groups',count:list.length,groups:list,markedRead:false};
 }
 const e=await groupOf(client,q.group,bounded);
 const peer=await bounded(client.getInputEntity(e));
 const gInfo={groupId:peerId(e),title:e.title||'',username:e.username||'',forum:Boolean(e.forum)};
 if(q.mode==='topics'){
  check(e.className==='Channel'&&e.forum,'NOT_A_FORUM');
  const r=await bounded(client.invoke(new Api.messages.GetForumTopics({peer,offsetDate:0,offsetId:0,offsetTopic:0,limit:q.limit})));
  const topics=(r?.topics||[]).filter(t=>t.className==='ForumTopic').map(t=>({topicId:t.id,title:t.title||'',closed:Boolean(t.closed),unreadCount:t.unreadCount||0,topMessageId:t.topMessage||0,link:linkOf(e,t.id,0)}));
  return {status:'ok',mode:'topics',group:gInfo,count:topics.length,topics,markedRead:false};
 }
 const common={offsetId:q.offsetId||0,addOffset:0,limit:q.limit,maxId:0,minId:0,hash:bigInt.zero};
 let r;
 if(q.mode==='message'){const ms=await bounded(client.getMessages(peer,{ids:[q.messageId]}));r={messages:ms||[],users:[]};
  const one=(ms||[])[0];if(one?.getSender){try{const u=await bounded(one.getSender());if(u?.className==='User')r.users=[u];}catch{}}}
 else if(q.query)r=await bounded(client.invoke(new Api.messages.Search({peer,q:q.query,filter:new Api.InputMessagesFilterEmpty(),minDate:0,maxDate:0,...(q.topic>1?{topMsgId:q.topic}:{}),...common})));
 else if(q.topic>1)r=await bounded(client.invoke(new Api.messages.GetReplies({peer,msgId:q.topic,offsetDate:0,...common})));
 else r=await bounded(client.invoke(new Api.messages.GetHistory({peer,offsetDate:0,...common})));
 const users=new Map((r?.users||[]).map(u=>[id(u.id),u]));
 const msgs=(r?.messages||[]).filter(m=>m&&m.className==='Message').map(m=>{
  const fid=id(m.fromId?.userId||m.fromId?.channelId||'');const u=users.get(fid);
  const topic=m.replyTo?.forumTopic?(m.replyTo.replyToTopId||m.replyTo.replyToMsgId):(e.forum?1:0);
  return {id:m.id,date:iso(m.date),fromId:fid,fromName:u?[u.firstName,u.lastName].filter(Boolean).join(' ')||u.username||fid:'',fromUsername:u?.username||'',
   topicId:topic,replyToId:m.replyTo&&!(m.replyTo.forumTopic&&!m.replyTo.replyToTopId)?(m.replyTo.replyToMsgId||0):0,text:cut(textOf(m),4000),rich:Boolean(m.richMessage),media:mediaOf(m),link:linkOf(e,m.id,topic),...emojisOf(m)};
 });
 return {status:'ok',mode:q.mode,group:gInfo,topic:q.topic,query:q.query,count:msgs.length,messages:msgs,nextOffsetId:msgs.length===q.limit?msgs[msgs.length-1].id:0,markedRead:false};
}
module.exports={request,run,richPlain,textOf};
