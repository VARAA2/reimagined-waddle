'use strict';
const {Api}=require('teleproto'),bigInt=require('big-integer');
const {attendancePeer}=require('./live-attendance');
// Read-only: who joined or left a channel/group the account administers, taken from the admin ("Recent actions") log.
// The log keeps about 48 hours and gives every event a unique, increasing id, which the workflow stores as its cursor.
// Nothing is written to Telegram and invite links (which are secrets) are never returned.
const need=(ok,code)=>{if(!ok)throw Error('NNA_MEMBERSHIP_'+code);};
const id=v=>String(v??'');
const PAGE=100,MAX_PAGES=5;
function membershipConfig(c,p){
 need(/^-100[1-9]\d{0,12}$/.test(p.membershipChannelId||''),'CONFIG_INVALID');
 const extra=p.membershipExtraChannelId||'';
 need(extra===''||/^-100[1-9]\d{0,12}$/.test(extra),'CONFIG_INVALID');
 need(p.membershipChannelId===c.allowedGroupId||(extra!==''&&p.membershipChannelId===extra),'CHANNEL_NOT_ALLOWED');
 const since=String(p.membershipSinceEventId??'0');
 need(/^(-1|0|[1-9]\d{0,19})$/.test(since),'CURSOR_INVALID');
 const at=p.membershipActivatedAt||'';
 need(at===''||Number.isFinite(Date.parse(at)),'ACTIVATION_INVALID');
 return {channelId:p.membershipChannelId,since,activatedAt:at};
}
const username=u=>u.username||u.usernames?.find(x=>x.active)?.username||'';
function person(u){
 return u?{userId:id(u.id),username:username(u),firstName:u.firstName||'',lastName:u.lastName||'',bot:u.bot===true,deleted:u.deleted===true,premium:u.premium===true,accessHash:!u.min&&u.accessHash?id(u.accessHash):''}:null;
}
const peerUser=p=>p?.userId!==undefined?id(p.userId):p?.peer?.userId!==undefined?id(p.peer.userId):'';
function normalize(e,users){
 const a=e.action?.className,actor=id(e.userId),at=new Date(Number(e.date)*1000).toISOString(),base={eventId:id(e.id),at};
 let r=null;
 if(a==='ChannelAdminLogEventActionParticipantJoin')r={kind:'joined',via:'self',userId:actor,actorId:actor};
 else if(a==='ChannelAdminLogEventActionParticipantJoinByInvite')r={kind:'joined',via:e.action.viaChatlist?'chat_folder_link':'invite_link',userId:actor,actorId:actor};
 else if(a==='ChannelAdminLogEventActionParticipantJoinByRequest')r={kind:'joined',via:'join_request',userId:actor,actorId:id(e.action.approvedBy)};
 else if(a==='ChannelAdminLogEventActionParticipantInvite')r={kind:'joined',via:'added',userId:peerUser(e.action.participant),actorId:actor};
 else if(a==='ChannelAdminLogEventActionParticipantLeave')r={kind:'left',via:'self',userId:actor,actorId:actor};
 else if(a==='ChannelAdminLogEventActionParticipantToggleBan'){
  const now=e.action.newParticipant;
  if(now?.className==='ChannelParticipantBanned'&&now.bannedRights?.viewMessages===true)r={kind:'removed',via:'removed_by_admin',userId:peerUser(now),actorId:actor};
 }
 if(!r||!/^\d+$/.test(r.userId))return null;
 return {...base,...r,user:person(users.get(r.userId))};
}
async function readMembership(client,c,p,bounded,now=Date.now()){
 const cfg=membershipConfig(c,p),{peer,channel}=await attendancePeer(client,cfg.channelId,bounded);
 const me=await bounded(client.invoke(new Api.channels.GetParticipant({channel:peer,participant:new Api.InputPeerSelf()})));
 need(me.participant?.className==='ChannelParticipantCreator'||me.participant?.className==='ChannelParticipantAdmin','ADMIN_REQUIRED');
 const filter=new Api.ChannelAdminLogEventsFilter({join:true,leave:true,invite:true,ban:true,kick:true});
 const ask=(minId,maxId,limit)=>bounded(client.invoke(new Api.channels.GetAdminLog({channel:peer,q:'',eventsFilter:filter,maxId:bigInt(maxId),minId:bigInt(minId),limit})));
 const base={channelId:cfg.channelId,channel,polledAt:new Date(now).toISOString(),senderId:id(c.expectedUserId)};
 if(cfg.since==='-1'){
  // Cursor initialisation: report the newest event id without returning any event, so nothing old is ever processed.
  const r=await ask(0,0,1);const top=(r.events||[]).reduce((m,x)=>bigInt(m).greater(x.id)?m:id(x.id),'0');
  return {...base,status:'cursor_initialised',events:[],count:0,maxEventId:top,complete:true};
 }
 const users=new Map(),seen=new Map();let maxId='0',pages=0,complete=false;
 for(;pages<MAX_PAGES;pages++){
  let r;try{r=await ask(cfg.since,maxId,PAGE);}catch(e){throw Error('NNA_MEMBERSHIP_READ_FAILED');}
  for(const u of r.users||[])users.set(id(u.id),u);
  const list=r.events||[];
  for(const e of list)seen.set(id(e.id),e);
  if(list.length<PAGE){complete=true;break;}
  maxId=list.reduce((m,x)=>bigInt(x.id).lesser(m)?id(x.id):m,id(list[0].id));
 }
 const floor=cfg.activatedAt?Date.parse(cfg.activatedAt):0;
 const rows=[...seen.values()].sort((a,b)=>bigInt(a.id).compare(bigInt(b.id)));
 const events=[];
 for(const e of rows){const n=normalize(e,users);if(n&&Date.parse(n.at)>=floor)events.push(n);}
 const top=rows.reduce((m,x)=>bigInt(m).greater(x.id)?m:id(x.id),cfg.since==='0'?'0':cfg.since);
 return {...base,status:'ok',events,count:events.length,maxEventId:top,complete};
}
async function runMembership(operation,client,c,p,bounded,now=Date.now()){
 need(operation==='readChannelMembership','OPERATION');
 return readMembership(client,c,p,bounded,now);
}
module.exports={membershipConfig,normalize,readMembership,runMembership};
