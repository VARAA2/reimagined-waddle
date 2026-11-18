'use strict';
const bigInt=require('big-integer');
const {Api}=require('teleproto');
// READ-ONLY view of the personal account's private (one-to-one) chats (Claude, 14 Nov 2026).
// mode "dialogs": newest private chats with unread count + last message. mode "history": messages of ONE private chat.
// Never sends, never marks anything as read (only messages.GetDialogs / messages.GetHistory are used), no groups/channels.
const id=v=>v==null?'':String(v);
const check=(ok,code)=>{if(!ok)throw Error('NNA_PRIVREAD_'+code);};
const cut=(s,n)=>{s=String(s||'');return s.length>n?s.slice(0,n)+'…':s;};
function request(p){
 const r=p.privateRead;
 check(r&&typeof r==='object','REQUEST_INVALID');
 const mode=String(r.mode||'dialogs');
 check(['dialogs','history'].includes(mode),'MODE_INVALID');
 const limit=Number(r.limit||(mode==='dialogs'?20:30));
 check(Number.isInteger(limit)&&limit>=1&&limit<=(mode==='dialogs'?100:200),'LIMIT_INVALID');
 const out={mode,limit,unreadOnly:r.unreadOnly===true,includeBots:r.includeBots===true};
 if(mode==='history'){
  const peer=id(r.peer).trim();
  check(/^[1-9]\d{0,15}$/.test(peer)||/^@[A-Za-z][A-Za-z0-9_]{3,31}$/.test(peer),'PEER_INVALID');
  out.peer=peer;
  const off=Number(r.offsetId||0);check(Number.isInteger(off)&&off>=0,'OFFSET_INVALID');out.offsetId=off;
 }
 return out;
}
function nameOf(u){return [u?.firstName,u?.lastName].filter(Boolean).join(' ')||(u?.username?'@'+u.username:id(u?.id));}
function mediaOf(m){
 const x=m?.media;if(!x)return '';
 const k=x.className||'';
 if(k==='MessageMediaPhoto')return 'photo';
 if(k==='MessageMediaDocument'){const a=(x.document?.attributes||[]).map(a=>a.className);
  if(a.includes('DocumentAttributeAudio'))return x.document?.attributes?.find(a=>a.className==='DocumentAttributeAudio')?.voice?'voice':'audio';
  if(a.includes('DocumentAttributeVideo'))return 'video';if(a.includes('DocumentAttributeSticker'))return 'sticker';return 'file';}
 if(k==='MessageMediaWebPage')return '';
 return k.replace(/^MessageMedia/,'').toLowerCase()||'media';
}
function msgOf(m,meId){
 return {id:m.id,date:new Date((m.date||0)*1000).toISOString(),out:Boolean(m.out),fromId:id(m.out?meId:(m.fromId?.userId??m.peerId?.userId)),
  text:cut(m.message,4000),media:mediaOf(m),replyToId:m.replyTo?.replyToMsgId||0,edited:Boolean(m.editDate),service:m.className==='MessageService'};
}
async function run(operation,client,c,p,bounded){
 check(operation==='readPrivateChats','OPERATION');
 const q=request(p);const meId=id(c.expectedUserId);
 if(q.mode==='dialogs'){
  const dialogs=await bounded(client.getDialogs({limit:Math.min(500,Math.max(150,q.limit*10))}));
  const chats=[];
  for(const d of dialogs||[]){
   const u=d.entity;
   if(!u||u.className!=='User'||u.self||u.deleted||id(u.id)===meId||id(u.id)==='777000')continue;
   if(u.bot&&!q.includeBots)continue;
   if(q.unreadOnly&&!(d.unreadCount>0))continue;
   const m=d.message;
   chats.push({userId:id(u.id),name:nameOf(u),username:u.username||'',bot:Boolean(u.bot),unreadCount:d.unreadCount||0,
    lastMessage:m?{id:m.id,date:new Date((m.date||0)*1000).toISOString(),out:Boolean(m.out),text:cut(m.message,500),media:mediaOf(m)}:null});
   if(chats.length>=q.limit)break;
  }
  return {status:'ok',mode:'dialogs',account:meId,count:chats.length,chats,markedRead:false};
 }
 let u;
 try{u=await bounded(client.getEntity(q.peer.startsWith('@')?q.peer.slice(1):bigInt(q.peer)));}catch{u=null;}
 if(!u&&!q.peer.startsWith('@'))u=((await bounded(client.getDialogs({limit:500})))||[]).map(x=>x.entity).find(x=>x?.className==='User'&&id(x.id)===q.peer)||null;
 check(u?.className==='User'&&!u.self&&id(u.id)!==meId,'NOT_A_PRIVATE_CHAT');
 const peer=await bounded(client.getInputEntity(u));
 const r=await bounded(client.invoke(new Api.messages.GetHistory({peer,offsetId:q.offsetId,offsetDate:0,addOffset:0,limit:q.limit,maxId:0,minId:0,hash:bigInt.zero})));
 const msgs=(r?.messages||[]).filter(m=>m&&(m.className==='Message'||m.className==='MessageService')).map(m=>msgOf(m,meId));
 return {status:'ok',mode:'history',account:meId,user:{userId:id(u.id),name:nameOf(u),username:u.username||'',bot:Boolean(u.bot)},count:msgs.length,
  messages:msgs,nextOffsetId:msgs.length===q.limit?msgs[msgs.length-1].id:0,markedRead:false};
}
module.exports={request,run};
